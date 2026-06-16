import { getDb, schema } from "../db"
import { nowSeconds } from "./expiry"

export async function notifyUser(
  db: ReturnType<typeof getDb>,
  input: { userId: string; type: string; title: string; message?: string | null; targetType?: string | null; targetId?: string | null },
): Promise<void> {
  try {
    await db.insert(schema.notifications).values({
      id: crypto.randomUUID(),
      userId: input.userId,
      type: input.type.slice(0, 80),
      title: input.title.slice(0, 160),
      message: input.message?.slice(0, 1000) ?? null,
      targetType: input.targetType?.slice(0, 80) ?? null,
      targetId: input.targetId?.slice(0, 160) ?? null,
      readAt: null,
      createdAt: nowSeconds(),
    }).run()
  } catch {}
}
