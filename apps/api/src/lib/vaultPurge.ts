import { and, eq, lte } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { Bindings } from "../types";
import { nowSeconds } from "./expiry";
import { deleteOneFileObjects } from "./fileObjects";

type PurgeFile = {
  id: string;
  ownerId: string;
  r2Key: string;
};

type StoredPurgeFile = PurgeFile & {
  purgeRequestedAt: number | null;
  shareToken: string | null;
};

export type VaultPurgeJob = {
  fileId: string;
  ownerId: string;
};

export type VaultPurgeResult =
  | "removed"
  | "retry"
  | "quarantined"
  | "missing";

export type VaultPurgeOperations = {
  loadFile: (fileId: string) => Promise<StoredPurgeFile | null>;
  abortActiveUpload: (file: StoredPurgeFile) => Promise<void>;
  deleteObjects: (file: StoredPurgeFile) => Promise<void>;
  deleteMarkedFile: (file: StoredPurgeFile) => Promise<boolean>;
  removeJob: (job: VaultPurgeJob) => Promise<void>;
  quarantineJob: (job: VaultPurgeJob, reason: string) => Promise<void>;
  scheduleRetry: (job: VaultPurgeJob, error: unknown) => Promise<void>;
};

export function retryDelay(attempts: number): number {
  return Math.min(3600, 30 * 2 ** Math.min(attempts, 7));
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function multipartAlreadyGone(error: unknown): boolean {
  return /(?:not.?found|no such|already (?:aborted|completed)|invalid upload)/i.test(
    errorText(error),
  );
}

/**
 * Destructive storage calls are reachable only after this guard establishes
 * that the job still belongs to the file owner and the file is still marked
 * for purge. Keeping the orchestration dependency-injected makes the guard,
 * ordering, and retry behavior directly testable without an R2 emulator.
 */
export async function runGuardedVaultPurge(
  job: VaultPurgeJob,
  operations: VaultPurgeOperations,
): Promise<VaultPurgeResult> {
  const file = await operations.loadFile(job.fileId);
  if (!file) {
    await operations.removeJob(job);
    return "missing";
  }
  if (file.ownerId !== job.ownerId || file.purgeRequestedAt == null) {
    await operations.quarantineJob(
      job,
      file.ownerId !== job.ownerId
        ? "purge owner guard mismatch"
        : "file is not marked for purge",
    );
    return "quarantined";
  }
  try {
    await operations.abortActiveUpload(file);
    await operations.deleteObjects(file);
    if (!(await operations.deleteMarkedFile(file)))
      throw new Error("purge marker changed before metadata deletion");
    return "removed";
  } catch (error) {
    await operations.scheduleRetry(job, error);
    return "retry";
  }
}

function purgeOperations(
  env: Bindings,
  db: ReturnType<typeof getDb>,
): VaultPurgeOperations {
  return {
    loadFile: async (fileId) => {
      const row = await env.DB.prepare(
        `SELECT id, owner_id AS ownerId, r2_key AS r2Key,
                purge_requested_at AS purgeRequestedAt,
                share_token AS shareToken
         FROM files WHERE id = ?`,
      )
        .bind(fileId)
        .first<StoredPurgeFile>();
      return row ?? null;
    },
    abortActiveUpload: async (file) => {
      const session = await env.DB.prepare(
        `SELECT id, upload_id AS uploadId
         FROM upload_sessions
         WHERE file_id = ? AND status = 'active' LIMIT 1`,
      )
        .bind(file.id)
        .first<{ id: string; uploadId: string }>();
      if (!session?.uploadId) return;
      try {
        await env.FILES.resumeMultipartUpload(file.r2Key, session.uploadId).abort();
      } catch (error) {
        if (!multipartAlreadyGone(error)) throw error;
      }
      await env.DB.prepare(
        "UPDATE upload_sessions SET status = 'aborted', updated_at = ? WHERE id = ?",
      )
        .bind(nowSeconds(), session.id)
        .run();
    },
    deleteObjects: (file) => deleteOneFileObjects(env.FILES, db, file),
    deleteMarkedFile: async (file) => {
      const result = await env.DB.prepare(
        `DELETE FROM files
         WHERE id = ? AND owner_id = ? AND purge_requested_at IS NOT NULL`,
      )
        .bind(file.id, file.ownerId)
        .run();
      return Number(result.meta?.changes ?? 0) === 1;
    },
    removeJob: async (job) => {
      await env.DB.prepare(
        "DELETE FROM vault_purge_jobs WHERE file_id = ? AND owner_id = ?",
      )
        .bind(job.fileId, job.ownerId)
        .run();
    },
    quarantineJob: async (job, reason) => {
      await env.DB.prepare(
        `UPDATE vault_purge_jobs
         SET state = 'quarantined', last_error = ?
         WHERE file_id = ? AND owner_id = ?`,
      )
        .bind(reason.slice(0, 500), job.fileId, job.ownerId)
        .run();
    },
    scheduleRetry: async (job, error) => {
      const current = await env.DB.prepare(
        `SELECT attempts FROM vault_purge_jobs
         WHERE file_id = ? AND owner_id = ?`,
      )
        .bind(job.fileId, job.ownerId)
        .first<{ attempts: number }>();
      const attempts = Number(current?.attempts ?? 0) + 1;
      await env.DB.prepare(
        `UPDATE vault_purge_jobs
         SET state = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?
         WHERE file_id = ? AND owner_id = ?`,
      )
        .bind(
          attempts,
          nowSeconds() + retryDelay(attempts),
          errorText(error),
          job.fileId,
          job.ownerId,
        )
        .run();
    },
  };
}

async function finishPurge(
  env: Bindings,
  job: VaultPurgeJob,
): Promise<boolean> {
  const db = getDb(env.DB);
  return (
    (await runGuardedVaultPurge(job, purgeOperations(env, db))) === "removed"
  );
}

/**
 * Immediately hides a duress-purged file from every owner view, revokes all
 * sharing, and cryptographically erases recovery envelopes before touching R2.
 * The D1 row remains as a hidden tombstone until every object and version has
 * been deleted successfully; the cron retry closes any transient R2 failure.
 */
export async function requestVaultPurge(
  env: Bindings,
  file: PurgeFile,
  defer?: (work: Promise<unknown>) => void,
): Promise<boolean> {
  const canonical = await env.DB.prepare(
    `SELECT id, owner_id AS ownerId, r2_key AS r2Key,
            purge_requested_at AS purgeRequestedAt,
            share_token AS shareToken
     FROM files WHERE id = ? AND owner_id = ?`,
  )
    .bind(file.id, file.ownerId)
    .first<StoredPurgeFile>();
  if (!canonical) return false;

  const now = nowSeconds();
  const shareToken = canonical.shareToken;
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE files
       SET purge_requested_at = COALESCE(purge_requested_at, ?),
           purge_reason = 'duress', folder_id = NULL, team_id = NULL,
           deleted_at = NULL,
           share_token = NULL, share_password = NULL,
           share_download_limit = NULL, share_download_count = 0,
           share_expires_at = NULL, share_access_mode = 'download',
           share_one_time = 0, share_allowlist = NULL,
           share_ip_allowlist = NULL, share_country_allowlist = NULL,
           share_embed = 1
       WHERE id = ? AND owner_id = ?`,
    ).bind(now, file.id, file.ownerId),
    env.DB.prepare(
      "DELETE FROM file_key_recovery WHERE file_id = ? AND owner_id = ?",
    ).bind(file.id, file.ownerId),
    env.DB.prepare(
      "DELETE FROM share_events WHERE file_id = ? OR (? IS NOT NULL AND token = ?)",
    ).bind(file.id, shareToken, shareToken),
    env.DB.prepare(
      "DELETE FROM file_flags WHERE file_id = ? OR (? IS NOT NULL AND token = ?)",
    ).bind(file.id, shareToken, shareToken),
    env.DB.prepare(
      "DELETE FROM guest_access_codes WHERE ? IS NOT NULL AND share_token = ?",
    ).bind(shareToken, shareToken),
    env.DB.prepare(
      "DELETE FROM guest_access_tokens WHERE ? IS NOT NULL AND share_token = ?",
    ).bind(shareToken, shareToken),
    env.DB.prepare(
      "DELETE FROM activity_log WHERE target_type = 'file' AND target_id = ?",
    ).bind(file.id),
    env.DB.prepare(
      "DELETE FROM audit_log WHERE target_type = 'file' AND target_id = ?",
    ).bind(file.id),
    env.DB.prepare(
      "DELETE FROM notifications WHERE target_type = 'file' AND target_id = ?",
    ).bind(file.id),
    env.DB.prepare(
      `INSERT INTO vault_purge_jobs
        (file_id, owner_id, state, attempts, requested_at, next_attempt_at, last_error)
       VALUES (?, ?, 'pending', 0, ?, ?, NULL)
       ON CONFLICT(file_id) DO UPDATE SET
         owner_id = excluded.owner_id, state = 'pending',
         attempts = CASE WHEN vault_purge_jobs.state = 'quarantined'
                         THEN 0 ELSE vault_purge_jobs.attempts END,
         requested_at = MIN(vault_purge_jobs.requested_at, excluded.requested_at),
         next_attempt_at = MIN(vault_purge_jobs.next_attempt_at, excluded.next_attempt_at),
         last_error = NULL`,
    ).bind(file.id, file.ownerId, now, now),
  ]);
  const purge = finishPurge(env, {
    fileId: canonical.id,
    ownerId: canonical.ownerId,
  });
  if (defer) {
    defer(purge);
    return true;
  }
  return purge;
}

export async function sweepPendingVaultPurges(
  env: Bindings,
  limit = 50,
): Promise<number> {
  const db = getDb(env.DB);
  const jobs = await db
    .select()
    .from(schema.vaultPurgeJobs)
    .where(
      and(
        eq(schema.vaultPurgeJobs.state, "pending"),
        lte(schema.vaultPurgeJobs.nextAttemptAt, nowSeconds()),
      ),
    )
    .limit(limit)
    .all();
  let removed = 0;
  for (const job of jobs) {
    if (
      await finishPurge(env, { fileId: job.fileId, ownerId: job.ownerId })
    )
      removed += 1;
  }
  return removed;
}
