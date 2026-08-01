import { describe, expect, it } from "vitest";
import {
  retryDelay,
  runGuardedVaultPurge,
  type VaultPurgeOperations,
} from "./vaultPurge";

type TestFile = {
  id: string;
  ownerId: string;
  r2Key: string;
  purgeRequestedAt: number | null;
  shareToken: string | null;
};

const markedFile: TestFile = {
  id: "file-1",
  ownerId: "owner-1",
  r2Key: "owner-1/file-1",
  purgeRequestedAt: 1_700_000_000,
  shareToken: null,
};

function operations(options?: {
  file?: TestFile | null;
  abortError?: Error;
  objectError?: Error;
  deleteMarked?: boolean;
}) {
  const events: string[] = [];
  const ops: VaultPurgeOperations = {
    loadFile: async (fileId) => {
      events.push(`load:${fileId}`);
      return options && "file" in options ? options.file ?? null : markedFile;
    },
    abortActiveUpload: async () => {
      events.push("abort-upload");
      if (options?.abortError) throw options.abortError;
    },
    deleteObjects: async () => {
      events.push("delete-r2");
      if (options?.objectError) throw options.objectError;
    },
    deleteMarkedFile: async () => {
      events.push("delete-d1");
      return options?.deleteMarked !== false;
    },
    removeJob: async (job) => {
      events.push(`remove-job:${job.fileId}:${job.ownerId}`);
    },
    quarantineJob: async (job, reason) => {
      events.push(`quarantine:${job.fileId}:${job.ownerId}:${reason}`);
    },
    scheduleRetry: async (job, error) => {
      events.push(
        `retry:${job.fileId}:${job.ownerId}:${error instanceof Error ? error.message : String(error)}`,
      );
    },
  };
  return { events, ops };
}

describe("guarded vault purge", () => {
  it("aborts an active upload before R2 and deletes D1 only after R2", async () => {
    const { events, ops } = operations();
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("removed");
    expect(events).toEqual([
      "load:file-1",
      "abort-upload",
      "delete-r2",
      "delete-d1",
    ]);
  });

  it("quarantines an owner-mismatched job without any destructive call", async () => {
    const { events, ops } = operations();
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: "attacker" },
        ops,
      ),
    ).resolves.toBe("quarantined");
    expect(events).toEqual([
      "load:file-1",
      "quarantine:file-1:attacker:purge owner guard mismatch",
    ]);
  });

  it("quarantines a job for a live unmarked file without touching R2", async () => {
    const { events, ops } = operations({
      file: { ...markedFile, purgeRequestedAt: null },
    });
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("quarantined");
    expect(events).toEqual([
      "load:file-1",
      "quarantine:file-1:owner-1:file is not marked for purge",
    ]);
  });

  it("removes an orphaned job without touching storage", async () => {
    const { events, ops } = operations({ file: null });
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("missing");
    expect(events).toEqual(["load:file-1", "remove-job:file-1:owner-1"]);
  });

  it("preserves the tombstone and schedules a retry after an R2 failure", async () => {
    const { events, ops } = operations({ objectError: new Error("R2 timeout") });
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("retry");
    expect(events).toEqual([
      "load:file-1",
      "abort-upload",
      "delete-r2",
      "retry:file-1:owner-1:R2 timeout",
    ]);
    expect(events).not.toContain("delete-d1");
  });

  it("does not touch objects if aborting multipart must retry", async () => {
    const { events, ops } = operations({
      abortError: new Error("multipart service unavailable"),
    });
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("retry");
    expect(events).toEqual([
      "load:file-1",
      "abort-upload",
      "retry:file-1:owner-1:multipart service unavailable",
    ]);
  });

  it("retries idempotently if the guarded D1 delete loses its marker", async () => {
    const { events, ops } = operations({ deleteMarked: false });
    await expect(
      runGuardedVaultPurge(
        { fileId: markedFile.id, ownerId: markedFile.ownerId },
        ops,
      ),
    ).resolves.toBe("retry");
    expect(events).toEqual([
      "load:file-1",
      "abort-upload",
      "delete-r2",
      "delete-d1",
      "retry:file-1:owner-1:purge marker changed before metadata deletion",
    ]);
  });

  it("backs off exponentially with a one-hour cap", () => {
    expect(retryDelay(0)).toBe(30);
    expect(retryDelay(1)).toBe(60);
    expect(retryDelay(7)).toBe(3_600);
    expect(retryDelay(100)).toBe(3_600);
  });
});
