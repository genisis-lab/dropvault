import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Bindings } from "../types";
import { deliverPendingEvents, enqueueEvent } from "./delivery";
import { nowSeconds } from "./expiry";
import { notifyUser } from "./notifications";
import { completeReservation } from "./quota";

export type UploadCompleteMessage = {
  type: "upload-complete";
  fileId: string;
};

const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/;

export async function enqueueUploadComplete(
  env: Bindings,
  fileId: string,
): Promise<void> {
  if (!SAFE_ID.test(fileId)) throw new Error("invalid upload-complete file id");
  await env.UPLOAD_EVENTS.send({ type: "upload-complete", fileId });
}

export async function processUploadComplete(
  env: Bindings,
  fileId: string,
): Promise<void> {
  if (!SAFE_ID.test(fileId)) return;
  const db = getDb(env.DB);
  const file = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, fileId))
    .get()
    .catch(() => null);

  if (!file) {
    // A failed/aborted upload can leave harmless metadata behind. The queue
    // repairs it without ever carrying or reading file contents.
    await env.DB.batch([
      env.DB.prepare("DELETE FROM upload_reservations WHERE file_id = ?").bind(fileId),
      env.DB.prepare("DELETE FROM upload_sessions WHERE file_id = ?").bind(fileId),
    ]);
    return;
  }
  if (file.status !== "ready" && file.status !== "quarantined") return;

  await completeReservation(env.DB, fileId);
  await db
    .update(schema.uploadSessions)
    .set({ status: "completed", updatedAt: nowSeconds() })
    .where(eq(schema.uploadSessions.fileId, fileId))
    .run()
    .catch(() => {});

  const existingNotification = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, file.ownerId),
        eq(schema.notifications.type, "upload_complete"),
        eq(schema.notifications.targetId, fileId),
      ),
    )
    .get()
    .catch(() => null);
  if (!existingNotification) {
    await notifyUser(db, {
      userId: file.ownerId,
      type: "upload_complete",
      title: `${file.filename} is ready`,
      message: "Your upload finished and is available in DropVault.",
      targetType: "file",
      targetId: fileId,
    });
  }

  const existingEvent = await env.DB.prepare(
    "SELECT id FROM outgoing_events WHERE type = 'upload_complete' AND json_extract(payload, '$.fileId') = ? LIMIT 1",
  ).bind(fileId).first<{ id: string }>();
  const eventId = existingEvent?.id ?? await enqueueEvent(db, {
    type: "upload_complete",
    userId: file.ownerId,
    payload: { fileId, filename: file.filename, status: file.status },
  });
  await deliverPendingEvents(env, 1, [eventId]);
}
