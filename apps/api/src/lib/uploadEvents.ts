import { and, desc, eq, gte, isNull } from "drizzle-orm";
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

// Uploads that finish while an unread upload notification is this fresh are
// folded into it, so a 30-file batch produces one notification instead of 30.
// The window slides: each folded upload refreshes the notification's time.
export const UPLOAD_BATCH_WINDOW_SECONDS = 15 * 60;
const UPLOAD_BATCH_TARGET = "upload_batch";

export function uploadBatchNotice(
  count: number,
  latestFilename: string,
): { title: string; message: string } {
  if (count <= 1)
    return {
      title: `${latestFilename} is ready`,
      message: "Your upload finished and is available in Dropvault.",
    };
  const others = count - 1;
  return {
    title: `${count} uploads are ready`,
    message: `${latestFilename} and ${others} other file${others === 1 ? "" : "s"} finished uploading and are available in Dropvault.`,
  };
}

// The batch counts every ready file created since its earliest member. Files
// in one batch start concurrently, so a later completion can belong to a file
// created slightly before the first one that finished.
export function uploadBatchStart(
  storedStart: string | null | undefined,
  fileCreatedAt: number,
): number {
  const stored = Number(storedStart);
  return Number.isFinite(stored) && stored > 0
    ? Math.min(stored, fileCreatedAt)
    : fileCreatedAt;
}

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
    .get();

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
    .run();

  await notifyUploadBatch(env, file);

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

// Keeps one rolling "uploads are ready" notification per burst of uploads.
// The count is recomputed from the files table each time, so queue retries
// and out-of-order completions converge on the right number.
async function notifyUploadBatch(
  env: Bindings,
  file: { ownerId: string; filename: string; createdAt: number },
): Promise<void> {
  const db = getDb(env.DB);
  const now = nowSeconds();
  const open = await db
    .select({
      id: schema.notifications.id,
      targetId: schema.notifications.targetId,
    })
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.userId, file.ownerId),
        eq(schema.notifications.type, "upload_complete"),
        eq(schema.notifications.targetType, UPLOAD_BATCH_TARGET),
        isNull(schema.notifications.readAt),
        gte(
          schema.notifications.createdAt,
          now - UPLOAD_BATCH_WINDOW_SECONDS,
        ),
      ),
    )
    .orderBy(desc(schema.notifications.createdAt))
    .get()
    .catch(() => null);
  const start = uploadBatchStart(open?.targetId, file.createdAt);
  const ready = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM files WHERE owner_id = ? AND created_at >= ? AND status IN ('ready', 'quarantined') AND deleted_at IS NULL",
  )
    .bind(file.ownerId, start)
    .first<{ n: number }>()
    .catch(() => null);
  const notice = uploadBatchNotice(Math.max(1, ready?.n ?? 1), file.filename);
  if (open) {
    await db
      .update(schema.notifications)
      .set({
        title: notice.title.slice(0, 160),
        message: notice.message.slice(0, 1000),
        targetId: String(start),
        createdAt: now,
      })
      .where(eq(schema.notifications.id, open.id))
      .run()
      .catch(() => {});
    return;
  }
  await notifyUser(db, {
    userId: file.ownerId,
    type: "upload_complete",
    title: notice.title,
    message: notice.message,
    targetType: UPLOAD_BATCH_TARGET,
    targetId: String(start),
  });
}
