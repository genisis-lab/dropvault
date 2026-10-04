import { and, asc, eq, inArray, lte, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { nowSeconds } from "./expiry";
import {
  resendConfigured,
  resendEmailForEvent,
  sendWithResend,
} from "./email";
import { isSafeWebhookUrl } from "./url";
import type { Bindings } from "../types";

export type OutgoingEvent = {
  type: string;
  userId?: string | null;
  payload: Record<string, unknown>;
};

export async function enqueueEvent(
  db: ReturnType<typeof getDb>,
  event: OutgoingEvent,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = nowSeconds();
  await db
    .insert(schema.outgoingEvents)
    .values({
      id,
      userId: event.userId ?? null,
      type: event.type,
      payload: JSON.stringify(event.payload),
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      createdAt: now,
    })
    .run();
  return id;
}

function hex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function signature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return hex(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );
}

export async function deliverPendingEvents(
  env: Bindings,
  limit = 25,
  eventIds: string[] = [],
): Promise<number> {
  const db = getDb(env.DB);
  const now = nowSeconds();
  const events = await db
    .select()
    .from(schema.outgoingEvents)
    .where(
      and(
        eq(schema.outgoingEvents.status, "pending"),
        lte(schema.outgoingEvents.nextAttemptAt, now),
        eventIds.length ? inArray(schema.outgoingEvents.id, eventIds) : undefined,
      ),
    )
    .orderBy(asc(schema.outgoingEvents.createdAt))
    .limit(limit)
    .all();
  const legacyTarget = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "notifyWebhookUrl"))
    .get()
    .catch(() => null);
  const globalTarget =
    env.NOTIFICATION_WEBHOOK_URL || legacyTarget?.value || null;
  let delivered = 0;
  for (const event of events) {
    const prefs = event.userId
      ? await db
          .select()
          .from(schema.notificationPreferences)
          .where(eq(schema.notificationPreferences.userId, event.userId))
          .get()
          .catch(() => null)
      : null;
    const authRequired = [
      "verify_email",
      "password_reset",
      "guest_access_code",
      "account_approved",
    ].includes(event.type);
    const categoryAllowed =
      !prefs ||
      authRequired ||
      (event.type === "expiry_warning"
        ? prefs.expiryWarnings
        : event.type.includes("upload")
          ? prefs.uploadEvents
          : prefs.securityEvents);
    const payload = JSON.parse(event.payload) as Record<string, unknown>;
    const resendEmail = resendConfigured(env)
      ? resendEmailForEvent(env, event.type, payload)
      : null;
    const target =
      prefs?.webhookEnabled && prefs.webhookUrl
        ? prefs.webhookUrl
        : !prefs || prefs.emailEnabled || authRequired
          ? globalTarget
          : null;
    if (
      !categoryAllowed ||
      (!resendEmail && (!target || !isSafeWebhookUrl(target)))
    ) {
      if (
        prefs &&
        (!categoryAllowed ||
          (!prefs.emailEnabled && !prefs.webhookEnabled && !authRequired))
      ) {
        await db
          .update(schema.outgoingEvents)
          .set({
            status: "delivered",
            deliveredAt: now,
            lastError: "skipped by notification preferences",
          })
          .where(eq(schema.outgoingEvents.id, event.id))
          .run()
          .catch(() => {});
      }
      continue;
    }
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      createdAt: event.createdAt,
      payload,
    });
    try {
      if (resendEmail) {
        await sendWithResend(env, event.id, resendEmail);
      } else {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "Idempotency-Key": event.id,
        };
        if (env.NOTIFICATION_WEBHOOK_SECRET)
          headers["X-Dropvault-Signature"] =
            `sha256=${await signature(env.NOTIFICATION_WEBHOOK_SECRET, body)}`;
        const response = await fetch(target!, { method: "POST", headers, body, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw new Error(`webhook returned ${response.status}`);
      }
      await db
        .update(schema.outgoingEvents)
        .set({
          status: "delivered",
          deliveredAt: now,
          attempts: sql`${schema.outgoingEvents.attempts} + 1`,
          lastError: null,
        })
        .where(eq(schema.outgoingEvents.id, event.id))
        .run();
      delivered++;
    } catch (error) {
      const attempts = event.attempts + 1;
      const terminal = attempts >= 8;
      await db
        .update(schema.outgoingEvents)
        .set({
          status: terminal ? "failed" : "pending",
          attempts,
          nextAttemptAt: now + Math.min(86400, 30 * 2 ** attempts),
          lastError: (error instanceof Error
            ? error.message
            : String(error)
          ).slice(0, 500),
        })
        .where(eq(schema.outgoingEvents.id, event.id))
        .run()
        .catch(() => {});
    }
  }
  return delivered;
}
