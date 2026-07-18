import { nowSeconds } from "./expiry";

export type ReservationResult = {
  reserved: boolean;
  reservationId: string | null;
};

// Reserve quota in one SQLite statement. D1 serializes the conditional INSERT,
// so concurrent presigns cannot all observe the same free bytes and oversubscribe
// the account. Unlimited accounts still get a reservation for cleanup tracking.
export async function reserveUpload(
  db: D1Database,
  input: {
    userId: string;
    fileId: string;
    bytes: number;
    quotaBytes: number | null;
    ttlSeconds?: number;
  },
): Promise<ReservationResult> {
  const now = nowSeconds();
  const id = crypto.randomUUID();
  const expiresAt = now + (input.ttlSeconds ?? 24 * 3600);
  const quota =
    input.quotaBytes == null || input.quotaBytes <= 0
      ? Number.MAX_SAFE_INTEGER
      : input.quotaBytes;
  const result = await db
    .prepare(
      `
    INSERT INTO upload_reservations (id, user_id, file_id, bytes, status, created_at, expires_at)
    SELECT ?, ?, ?, ?, 'active', ?, ?
    WHERE (
      COALESCE((SELECT SUM(size_bytes) FROM files WHERE owner_id = ? AND status IN ('ready', 'quarantined') AND deleted_at IS NULL), 0)
      + COALESCE((SELECT SUM(bytes) FROM upload_reservations WHERE user_id = ? AND status = 'active' AND expires_at > ?), 0)
      + ?
    ) <= ?
  `,
    )
    .bind(
      id,
      input.userId,
      input.fileId,
      input.bytes,
      now,
      expiresAt,
      input.userId,
      input.userId,
      now,
      input.bytes,
      quota,
    )
    .run();
  const changed = Number(result.meta?.changes ?? 0);
  return { reserved: changed === 1, reservationId: changed === 1 ? id : null };
}

export async function completeReservation(
  db: D1Database,
  fileId: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE upload_reservations SET status = 'completed' WHERE file_id = ? AND status = 'active'",
    )
    .bind(fileId)
    .run();
}

export async function releaseReservation(
  db: D1Database,
  fileId: string,
): Promise<void> {
  await db
    .prepare("DELETE FROM upload_reservations WHERE file_id = ?")
    .bind(fileId)
    .run();
}
