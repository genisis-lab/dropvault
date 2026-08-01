import { and, eq, gt, isNull, lt, lte } from "drizzle-orm";
import { getDb, schema } from "../db";
import { notifyUser } from "./notifications";
import { enqueueEvent } from "./delivery";
import { nowSeconds } from "./expiry";
import type { Bindings } from "../types";

function days(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(Math.floor(parsed), 3650)
    : fallback;
}

export async function cleanupMetadata(env: Bindings): Promise<void> {
  const db = getDb(env.DB);
  const settings = await db
    .select()
    .from(schema.appSettings)
    .all()
    .catch(() => []);
  const map = new Map(settings.map((row) => [row.key, row.value] as const));
  const now = nowSeconds();
  const cutoffs = {
    ip: now - days(map.get("ipRetentionDays"), 30) * 86400,
    activity: now - days(map.get("activityRetentionDays"), 180) * 86400,
    shares: now - days(map.get("shareEventRetentionDays"), 90) * 86400,
    notifications: now - days(map.get("notificationRetentionDays"), 90) * 86400,
    delivery: now - days(map.get("deliveryRetentionDays"), 30) * 86400,
  };
  await env.DB.batch([
    env.DB.prepare("DELETE FROM ip_observations WHERE created_at < ?").bind(
      cutoffs.ip,
    ),
    env.DB.prepare("DELETE FROM activity_log WHERE created_at < ?").bind(
      cutoffs.activity,
    ),
    env.DB.prepare("DELETE FROM share_events WHERE created_at < ?").bind(
      cutoffs.shares,
    ),
    env.DB.prepare("DELETE FROM notifications WHERE created_at < ?").bind(
      cutoffs.notifications,
    ),
    env.DB.prepare(
      "DELETE FROM outgoing_events WHERE status IN ('delivered','failed') AND created_at < ?",
    ).bind(cutoffs.delivery),
    env.DB.prepare("DELETE FROM rate_limits WHERE reset_at < ?").bind(now),
    env.DB.prepare("DELETE FROM guest_access_codes WHERE expires_at < ?").bind(
      now,
    ),
    env.DB.prepare("DELETE FROM guest_access_tokens WHERE expires_at < ?").bind(
      now,
    ),
    env.DB.prepare(
      "DELETE FROM upload_reservations WHERE status != 'active' OR expires_at < ?",
    ).bind(now),
    env.DB.prepare(
      "DELETE FROM upload_sessions WHERE status != 'active' OR expires_at < ?",
    ).bind(now),
  ]);
}

export async function scheduleExpiryWarnings(env: Bindings): Promise<number> {
  const db = getDb(env.DB);
  const now = nowSeconds();
  const soon = now + 24 * 3600;
  const rows = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.status, "ready"),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
        gt(schema.files.expiresAt, now),
        lte(schema.files.expiresAt, soon),
        eq(schema.files.keepForever, false),
      ),
    )
    .limit(200)
    .all()
    .catch(() => []);
  let created = 0;
  for (const file of rows) {
    const existing = await db
      .select({ id: schema.notifications.id })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, file.ownerId),
          eq(schema.notifications.type, "expiry_warning"),
          eq(schema.notifications.targetId, file.id),
          gt(schema.notifications.createdAt, now - 2 * 86400),
        ),
      )
      .get()
      .catch(() => null);
    if (existing) continue;
    await notifyUser(db, {
      userId: file.ownerId,
      type: "expiry_warning",
      title: `${file.filename} expires soon`,
      message: "This file expires within 24 hours.",
      targetType: "file",
      targetId: file.id,
    });
    await enqueueEvent(db, {
      type: "expiry_warning",
      userId: file.ownerId,
      payload: {
        fileId: file.id,
        filename: file.filename,
        expiresAt: file.expiresAt,
      },
    });
    created++;
  }
  return created;
}
