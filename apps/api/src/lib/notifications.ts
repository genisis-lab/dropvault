import { getDb, schema } from "../db";
import { effectiveAdmins } from "../middleware/admin";
import type { Bindings } from "../types";
import { enqueueEvent } from "./delivery";
import { nowSeconds } from "./expiry";

type NotificationInput = {
  userId: string;
  type: string;
  title: string;
  message?: string | null;
  targetType?: string | null;
  targetId?: string | null;
};

export async function notifyUser(
  db: ReturnType<typeof getDb>,
  input: NotificationInput,
): Promise<void> {
  try {
    await db
      .insert(schema.notifications)
      .values({
        id: crypto.randomUUID(),
        userId: input.userId,
        type: input.type.slice(0, 80),
        title: input.title.slice(0, 160),
        message: input.message?.slice(0, 1000) ?? null,
        targetType: input.targetType?.slice(0, 80) ?? null,
        targetId: input.targetId?.slice(0, 160) ?? null,
        readAt: null,
        createdAt: nowSeconds(),
      })
      .run();
  } catch {}
}

export async function notifyAdmins(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  try {
    const admins = await effectiveAdmins(env, db);
    if (!admins.size) return;
    const users = await db
      .select()
      .from(schema.user)
      .all()
      .catch(() => []);
    const adminUsers = users.filter((u) =>
      admins.has(String(u.email ?? "").toLowerCase()),
    );
    await Promise.all(
      adminUsers.map((u) => notifyUser(db, { ...input, userId: u.id })),
    );
  } catch {}
}

export async function notifyOwners(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  input: Omit<NotificationInput, "userId">,
): Promise<void> {
  try {
    const admins = await effectiveAdmins(env, db);
    const ownerEmails = new Set(
      Array.from(admins.entries())
        .filter(([, role]) => role === "owner")
        .map(([email]) => email),
    );
    if (!ownerEmails.size) return;
    const users = await db.select().from(schema.user).all().catch(() => []);
    const owners = users.filter((u) =>
      ownerEmails.has(String(u.email ?? "").toLowerCase()),
    );
    await Promise.all(
      owners.map(async (owner) => {
        await notifyUser(db, { ...input, userId: owner.id });
        await enqueueEvent(db, {
          type: input.type,
          userId: owner.id,
          payload: {
            title: input.title,
            message: input.message ?? null,
            targetType: input.targetType ?? null,
            targetId: input.targetId ?? null,
          },
        });
      }),
    );
  } catch {}
}
