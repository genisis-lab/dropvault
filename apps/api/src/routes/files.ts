import { Hono } from "hono";
import { and, desc, eq, gt, inArray, isNull, lt, lte, or } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
  computeExpiresAt,
  clampExtension,
  isExpired,
  nowSeconds,
  DAY_SECONDS,
  FOREVER_EXPIRES_AT,
} from "../lib/expiry";
import { hashSecret, sha256StreamHex } from "../lib/hash";
import { clientIp } from "../lib/rateLimit";
import {
  completeReservation,
  releaseReservation,
  reserveUpload,
} from "../lib/quota";
import { deleteFileObjects, deleteOneFileObjects } from "../lib/fileObjects";
import { scanFile } from "../lib/scanner";
import { requireAuth } from "../middleware/auth";
import { adminRole } from "../middleware/admin";
import type { Bindings, Variables } from "../types";

type ShareBody = {
  password?: string | null;
  downloadLimit?: number | null;
  expiresInDays?: number | null;
  accessMode?: "download" | "preview" | "disabled";
  oneTime?: boolean;
  embed?: boolean;
  allowlist?: string[] | string | null;
  ipAllowlist?: string[] | string | null;
  countryAllowlist?: string[] | string | null;
};

const files = new Hono<{ Bindings: Bindings; Variables: Variables }>();
files.use("*", requireAuth);

function normalizeUploadSize(value: unknown): number | null {
  const n = Math.floor(Number(value));
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
function base64UrlByteLength(value: unknown): number | null {
  const raw = String(value ?? "");
  if (!raw || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const padded =
      raw.replace(/-/g, "+").replace(/_/g, "/") +
      "===".slice((raw.length + 3) % 4);
    return atob(padded).length;
  } catch {
    return null;
  }
}
function validEncryptedEnvelope(
  sizeBytes: number,
  nonce: unknown,
  metadata: unknown,
): boolean {
  if (sizeBytes <= 16 || base64UrlByteLength(nonce) !== 12) return false;
  try {
    const value = JSON.parse(String(metadata ?? "")) as {
      nonce?: unknown;
      ciphertext?: unknown;
    };
    const ciphertextBytes = base64UrlByteLength(value.ciphertext);
    return (
      base64UrlByteLength(value.nonce) === 12 &&
      ciphertextBytes != null &&
      ciphertextBytes >= 16
    );
  } catch {
    return false;
  }
}
function isInlineSafeContentType(type: string | null): boolean {
  return !!type && (type.startsWith("image/") || type.includes("pdf"));
}
function isImageContentType(type: string | null): boolean {
  return !!type && type.startsWith("image/");
}
function thumbKey(r2Key: string): string {
  return `${r2Key}/thumb`;
}
const THUMB_MAX_BYTES = 2 * 1024 * 1024;
function addInlineSecurityHeaders(headers: Headers): void {
  headers.set(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; base-uri 'none'; frame-ancestors 'none'; sandbox",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
}
// Parse a single-range HTTP Range header ("bytes=start-end" or suffix
// "bytes=-N"). Returns null for absent/unsatisfiable/multi-range requests so the
// caller falls back to a normal 200 full-body response.
function parseRange(
  header: string | null,
  size: number,
): { offset: number; length: number; end: number } | null {
  if (!header || size <= 0) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const startRaw = m[1];
  const endRaw = m[2];
  if (startRaw === "" && endRaw === "") return null;
  let start: number;
  let end: number;
  if (startRaw === "") {
    const n = Number(endRaw);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(startRaw);
    if (!Number.isFinite(start) || start < 0) return null;
    end = endRaw === "" ? size - 1 : Number(endRaw);
    if (!Number.isFinite(end)) return null;
    end = Math.min(end, size - 1);
  }
  if (start > end || start >= size) return null;
  return { offset: start, length: end - start + 1, end };
}
async function settings(db: ReturnType<typeof getDb>) {
  const rows = await db
    .select()
    .from(schema.appSettings)
    .all()
    .catch(() => []);
  const map = new Map(rows.map((r) => [r.key, r.value] as const));
  return {
    maxUploadBytes: Number(map.get("maxUploadBytes") || 0),
    allowedTypes: (map.get("allowedTypes") || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean),
    requirePasswordForShares: map.get("requirePasswordForShares") === "true",
    publicSharingEnabled: map.get("publicSharingEnabled") !== "false",
    defaultQuotaBytes: Number(map.get("defaultQuotaBytes") || 1073741824),
  };
}
function roleGetsForever(role: string | null): boolean {
  return role === "owner" || role === "admin";
}
async function canKeepForever(
  c: any,
  db: ReturnType<typeof getDb>,
  userId: string,
  email?: string | null,
): Promise<boolean> {
  const role = await adminRole(c.env, db, email ?? "");
  if (roleGetsForever(role)) return true;
  const u = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get()
    .catch(() => null);
  return !!u?.keepFilesForever;
}
function typeAllowed(type: string | null, allowed: string[]): boolean {
  if (!allowed.length) return true;
  const t = (type || "").toLowerCase();
  return allowed.some((a) => {
    const v = a.toLowerCase();
    return v.endsWith("/*") ? t.startsWith(v.slice(0, -1)) : t === v;
  });
}
async function logActivity(
  c: any,
  db: ReturnType<typeof getDb>,
  action: string,
  targetId: string,
  detail: string | null,
) {
  try {
    await db
      .insert(schema.activityLog)
      .values({
        id: crypto.randomUUID(),
        userId: c.get("userId") ?? null,
        actorEmail: c.get("userEmail") ?? null,
        action,
        targetType: "file",
        targetId,
        detail,
        ip: clientIp(c),
        userAgent: c.req.header("User-Agent") ?? null,
        createdAt: nowSeconds(),
      })
      .run();
  } catch {}
}
function parseTags(raw: string | null): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.filter((x: unknown): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}
function serializeTags(input: unknown): string | null {
  if (!Array.isArray(input)) return null;
  const tags = input
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 20);
  return JSON.stringify(Array.from(new Set(tags)).map((x) => x.slice(0, 40)));
}
function serializeList(input: unknown): string | null {
  if (input == null) return null;
  const arr = Array.isArray(input) ? input : String(input).split(/[\n,]/);
  const values = arr
    .map((x) => String(x).trim())
    .filter(Boolean)
    .slice(0, 100);
  return values.length ? JSON.stringify(Array.from(new Set(values))) : null;
}
function accessMode(input: unknown): string {
  return ["download", "preview", "disabled"].includes(String(input))
    ? String(input)
    : "download";
}
function safeFile(row: any) {
  const { sharePassword, tags, ...r } = row;
  return {
    ...r,
    tags: parseTags(tags ?? null),
    shareHasPassword: !!sharePassword,
    shareEmbed: row.shareEmbed !== false,
    keepForever: !!row.keepForever,
  };
}

files.get("/capabilities", async (c) => {
  try {
    await c.env.DB.prepare(
      "SELECT encryption_mode, encryption_nonce, encrypted_metadata FROM files LIMIT 0",
    ).run();
    return c.json({ e2eEncryption: true });
  } catch {
    return c.json({ e2eEncryption: false });
  }
});

files.post("/presign", async (c) => {
  const userId = c.get("userId");
  const body = await c.req.json<{
    filename: string;
    contentType?: string;
    sizeBytes?: number;
    expiryDays?: number;
    folderId?: string | null;
    contentHash?: string | null;
    checksum?: string | null;
    keepForever?: boolean;
    encryptionMode?: "none" | "aes-gcm";
    encryptionNonce?: string | null;
    encryptedMetadata?: string | null;
    releaseAt?: number | null;
    expireAfterDownload?: boolean;
  }>();
  if (!body?.filename) return c.json({ error: "filename required" }, 400);
  const sizeBytes = normalizeUploadSize(body.sizeBytes);
  if (sizeBytes == null)
    return c.json({ error: "valid file size required" }, 400);
  const db = getDb(c.env.DB);
  const policy = await settings(db);
  if (policy.maxUploadBytes > 0 && sizeBytes > policy.maxUploadBytes)
    return c.json({ error: "file exceeds workspace upload limit" }, 413);
  const contentType = body.contentType
    ? String(body.contentType).slice(0, 255)
    : null;
  if (!typeAllowed(contentType, policy.allowedTypes))
    return c.json({ error: "file type is not allowed" }, 415);
  const suspension = await db
    .select()
    .from(schema.userSuspensions)
    .where(eq(schema.userSuspensions.userId, userId))
    .get()
    .catch(() => null);
  if (suspension) return c.json({ error: "account suspended" }, 403);
  let folderId: string | null = null;
  if (body.folderId) {
    const folder = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, body.folderId),
          eq(schema.folders.ownerId, userId),
        ),
      )
      .get();
    if (!folder) return c.json({ error: "folder not found" }, 404);
    folderId = body.folderId;
    if (body.expiryDays == null && folder.defaultExpiryDays)
      body.expiryDays = folder.defaultExpiryDays;
    if (body.expireAfterDownload == null && folder.expireAfterDownload)
      body.expireAfterDownload = true;
  }
  const account = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .get();
  const role = await adminRole(c.env, db, account?.email ?? "");
  const quotaLimit =
    role === "owner" || role === "admin"
      ? null
      : (account?.quotaBytes ?? policy.defaultQuotaBytes);
  const wantsForever = !!body.keepForever;
  if (wantsForever && !(await canKeepForever(c, db, userId, account?.email)))
    return c.json({ error: "keep-forever permission required" }, 403);
  const encryptionMode = body.encryptionMode === "aes-gcm" ? "aes-gcm" : "none";
  if (
    encryptionMode === "aes-gcm" &&
    !validEncryptedEnvelope(
      sizeBytes,
      body.encryptionNonce,
      body.encryptedMetadata,
    )
  )
    return c.json({ error: "valid AES-GCM encryption metadata required" }, 400);
  const storedFilename =
    encryptionMode === "aes-gcm"
      ? "Encrypted file"
      : body.filename.trim().slice(0, 255);
  const contentHash = body.contentHash
    ? String(body.contentHash).trim().toLowerCase()
    : null;
  if (contentHash && !/^[a-f0-9]{64}$/.test(contentHash))
    return c.json({ error: "contentHash must be a SHA-256 hex digest" }, 400);
  if (encryptionMode === "none" && !contentHash)
    return c.json(
      { error: "SHA-256 contentHash is required for unencrypted uploads" },
      400,
    );
  const requestedChecksum = body.checksum
    ? String(body.checksum).trim().toLowerCase()
    : null;
  if (requestedChecksum && !/^[a-f0-9]{64}$/.test(requestedChecksum))
    return c.json({ error: "checksum must be a SHA-256 hex digest" }, 400);
  if (
    encryptionMode === "none" &&
    requestedChecksum &&
    requestedChecksum !== contentHash
  )
    return c.json({ error: "checksum and contentHash must match" }, 400);
  if (contentHash) {
    const banned = await db
      .select()
      .from(schema.bannedFileHashes)
      .where(eq(schema.bannedFileHashes.hash, contentHash))
      .get()
      .catch(() => null);
    if (banned)
      return c.json(
        { error: "This file is blocked by workspace security policy." },
        451,
      );
  }
  const duplicate = contentHash
    ? await db
        .select()
        .from(schema.files)
        .where(
          and(
            eq(schema.files.ownerId, userId),
            eq(schema.files.contentHash, contentHash),
            eq(schema.files.sizeBytes, sizeBytes),
            eq(schema.files.status, "ready"),
            isNull(schema.files.deletedAt),
          ),
        )
        .get()
        .catch(() => null)
    : null;
  const id = crypto.randomUUID();
  const r2Key = `${userId}/${id}`;
  const createdAt = nowSeconds();
  const expiresAt = wantsForever
    ? FOREVER_EXPIRES_AT
    : computeExpiresAt(c.env, createdAt, body.expiryDays);
  const releaseAt =
    Number.isSafeInteger(body.releaseAt) && Number(body.releaseAt) > createdAt
      ? Math.min(Number(body.releaseAt), expiresAt - 1)
      : null;
  await db
    .insert(schema.files)
    .values({
      id,
      ownerId: userId,
      filename: storedFilename,
      r2Key,
      sizeBytes,
      contentType,
      contentHash,
      checksum: contentHash,
      checksumAlgorithm: contentHash ? "sha-256" : null,
      status: "pending",
      folderId,
      versionGroupId: id,
      createdAt,
      expiresAt,
      keepForever: wantsForever,
      encryptionMode,
      encryptionNonce:
        encryptionMode === "aes-gcm"
          ? (body.encryptionNonce?.slice(0, 256) ?? null)
          : null,
      encryptedMetadata:
        encryptionMode === "aes-gcm"
          ? (body.encryptedMetadata?.slice(0, 4096) ?? null)
          : null,
      releaseAt,
      expireAfterDownload: !!body.expireAfterDownload,
    })
    .run();
  const reservation = await reserveUpload(c.env.DB, {
    userId,
    fileId: id,
    bytes: sizeBytes,
    quotaBytes: quotaLimit,
  });
  if (!reservation.reserved) {
    await db
      .delete(schema.files)
      .where(eq(schema.files.id, id))
      .run()
      .catch(() => {});
    return c.json({ error: "storage quota exceeded" }, 413);
  }
  await logActivity(
    c,
    db,
    duplicate
      ? "file.presign.duplicate"
      : wantsForever
        ? "file.presign.forever"
        : "file.presign",
    id,
    storedFilename,
  );
  return c.json({
    id,
    uploadUrl: `/api/files/${id}/upload`,
    expiresAt,
    keepForever: wantsForever,
    duplicateOf: duplicate?.id ?? null,
  });
});

async function loadPendingOwned(c: any, id: string) {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        eq(schema.files.ownerId, userId),
        isNull(schema.files.deletedAt),
      ),
    )
    .get();
  return { db, row };
}
async function markReady(
  c: any,
  db: ReturnType<typeof getDb>,
  row: any,
  id: string,
) {
  await completeReservation(c.env.DB, id);
  await db
    .insert(schema.fileVersions)
    .values({
      id: crypto.randomUUID(),
      fileId: id,
      versionGroupId: row.versionGroupId ?? id,
      versionNumber: 1,
      r2Key: row.r2Key,
      sizeBytes: row.sizeBytes,
      checksum: row.checksum ?? row.contentHash ?? null,
      contentType: row.contentType,
      filename: row.filename,
      createdAt: nowSeconds(),
    })
    .run()
    .catch(() => {});
  // Publish the file only after its quota reservation and version record are
  // finalized. If an earlier write fails, a retry still sees a pending file
  // and can safely resume finalization.
  await db
    .update(schema.files)
    .set({
      status: c.env.SCANNER ? "quarantined" : "ready",
      scanStatus: c.env.SCANNER ? "pending" : "not_required",
    })
    .where(eq(schema.files.id, id))
    .run();
  await db
    .update(schema.uploadSessions)
    .set({ status: "completed", updatedAt: nowSeconds() })
    .where(eq(schema.uploadSessions.fileId, id))
    .run()
    .catch(() => {});
  await logActivity(c, db, "file.upload", id, row.filename);
  if (c.env.SCANNER) c.executionCtx.waitUntil(scanFile(c.env, id));
  return c.json({ ok: true });
}

async function discardPendingUpload(
  c: any,
  db: ReturnType<typeof getDb>,
  row: typeof schema.files.$inferSelect,
): Promise<void> {
  await c.env.FILES.delete(row.r2Key).catch(() => {});
  await releaseReservation(c.env.DB, row.id).catch(() => {});
  await db
    .delete(schema.files)
    .where(eq(schema.files.id, row.id))
    .run()
    .catch(() => {});
}

async function verifyMultipartIntegrity(
  c: any,
  db: ReturnType<typeof getDb>,
  row: typeof schema.files.$inferSelect,
): Promise<Response | null> {
  // E2E uploads intentionally omit a server-visible plaintext hash. AES-GCM
  // authenticates their ciphertext in the browser during decryption.
  if (row.encryptionMode === "aes-gcm" && !row.contentHash) return null;
  const object = await c.env.FILES.get(row.r2Key);
  if (!object) return c.json({ error: "upload missing" }, 409);
  const actual = await sha256StreamHex(object.body);
  const expected = String(row.contentHash ?? "").toLowerCase();
  if (!expected || actual !== expected) {
    await discardPendingUpload(c, db, row);
    return c.json(
      { error: "upload integrity check failed; retry the file" },
      409,
    );
  }
  if (row.encryptionMode !== "aes-gcm") {
    const banned = await db
      .select()
      .from(schema.bannedFileHashes)
      .where(eq(schema.bannedFileHashes.hash, actual))
      .get()
      .catch(() => null);
    if (banned) {
      await discardPendingUpload(c, db, row);
      return c.json(
        { error: "This file is blocked by workspace security policy." },
        451,
      );
    }
  }
  await db
    .update(schema.files)
    .set({
      contentHash: actual,
      checksum: actual,
      checksumAlgorithm: "sha-256",
    })
    .where(eq(schema.files.id, row.id))
    .run();
  return null;
}

files.put("/:id/upload", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.status === "ready" || row.status === "quarantined")
    return c.json({ completed: true });
  if (row.status !== "pending")
    return c.json({ error: "upload unavailable" }, 409);
  if (isExpired(row.expiresAt)) {
    await db.delete(schema.files).where(eq(schema.files.id, id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty upload" }, 400);
  const declared = c.req.header("Content-Length");
  if (!declared) return c.json({ error: "Content-Length is required" }, 411);
  if (Number(declared) !== row.sizeBytes)
    return c.json(
      { error: "Content-Length does not match reserved upload size" },
      409,
    );
  const putOptions: R2PutOptions = {};
  if (row.contentType)
    putOptions.httpMetadata = { contentType: row.contentType };
  if (row.checksum && /^[a-f0-9]{64}$/i.test(row.checksum))
    putOptions.sha256 = row.checksum;
  try {
    await c.env.FILES.put(row.r2Key, body, putOptions);
  } catch {
    // R2 rejects a body whose SHA-256 does not match the presigned digest.
    // Keep the reservation pending so a legitimate interrupted client can
    // retry, but never expose the provider exception or mark the file ready.
    await c.env.FILES.delete(row.r2Key).catch(() => {});
    return c.json(
      { error: "upload integrity check failed; retry the file" },
      409,
    );
  }
  const object = await c.env.FILES.head(row.r2Key);
  if (!object || object.size !== row.sizeBytes) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    return c.json({ error: "upload size mismatch" }, 409);
  }
  return c.json({ ok: true });
});
files.post("/:id/multipart/start", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.status === "ready" || row.status === "quarantined")
    return c.json({ completed: true });
  if (row.status !== "pending")
    return c.json({ error: "upload unavailable" }, 409);
  if (isExpired(row.expiresAt)) {
    await db.delete(schema.files).where(eq(schema.files.id, id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const existing = await db
    .select()
    .from(schema.uploadSessions)
    .where(eq(schema.uploadSessions.fileId, id))
    .get()
    .catch(() => null);
  if (existing?.status === "active" && existing.expiresAt > nowSeconds())
    return c.json({
      uploadId: existing.uploadId,
      key: row.r2Key,
      parts: JSON.parse(existing.parts || "[]"),
    });
  const mpu = await c.env.FILES.createMultipartUpload(
    row.r2Key,
    row.contentType
      ? { httpMetadata: { contentType: row.contentType } }
      : undefined,
  );
  const now = nowSeconds();
  if (existing)
    await db
      .delete(schema.uploadSessions)
      .where(eq(schema.uploadSessions.id, existing.id))
      .run()
      .catch(() => {});
  await db
    .insert(schema.uploadSessions)
    .values({
      id: crypto.randomUUID(),
      fileId: id,
      userId: row.ownerId,
      uploadId: mpu.uploadId,
      parts: "[]",
      status: "active",
      createdAt: now,
      updatedAt: now,
      expiresAt: now + 24 * 3600,
    })
    .run();
  return c.json({ uploadId: mpu.uploadId, key: row.r2Key, parts: [] });
});
files.get("/:id/multipart/status", async (c) => {
  const { db, row } = await loadPendingOwned(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  const session = await db
    .select()
    .from(schema.uploadSessions)
    .where(eq(schema.uploadSessions.fileId, row.id))
    .get()
    .catch(() => null);
  if (
    !session ||
    session.status !== "active" ||
    session.expiresAt <= nowSeconds()
  )
    return c.json({ session: null });
  return c.json({
    session: {
      uploadId: session.uploadId,
      parts: JSON.parse(session.parts || "[]"),
      expiresAt: session.expiresAt,
    },
  });
});
files.put("/:id/multipart/part", async (c) => {
  const id = c.req.param("id");
  const uploadId = c.req.query("uploadId");
  const partNumber = Number(c.req.query("partNumber"));
  if (
    !uploadId ||
    !Number.isInteger(partNumber) ||
    partNumber < 1 ||
    partNumber > 10_000
  )
    return c.json(
      { error: "uploadId and a valid partNumber are required" },
      400,
    );
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.status !== "pending")
    return c.json({ error: "upload already completed" }, 409);
  if (isExpired(row.expiresAt)) return c.json({ error: "expired" }, 410);
  const session = await db
    .select()
    .from(schema.uploadSessions)
    .where(eq(schema.uploadSessions.fileId, id))
    .get()
    .catch(() => null);
  if (
    !session ||
    session.status !== "active" ||
    session.uploadId !== uploadId ||
    session.expiresAt <= nowSeconds()
  )
    return c.json({ error: "upload session expired" }, 410);
  const declared = Number(c.req.header("Content-Length"));
  if (!Number.isSafeInteger(declared) || declared <= 0)
    return c.json({ error: "valid Content-Length is required" }, 411);
  if (declared > 100 * 1024 * 1024)
    return c.json({ error: "multipart part exceeds 100 MiB" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty part" }, 400);
  const uploaded = await c.env.FILES.resumeMultipartUpload(
    row.r2Key,
    uploadId,
  ).uploadPart(partNumber, body);
  const parts = (
    JSON.parse(session.parts || "[]") as Array<{
      partNumber: number;
      etag: string;
    }>
  ).filter((part) => part.partNumber !== uploaded.partNumber);
  parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
  parts.sort((a, b) => a.partNumber - b.partNumber);
  await db
    .update(schema.uploadSessions)
    .set({ parts: JSON.stringify(parts), updatedAt: nowSeconds() })
    .where(eq(schema.uploadSessions.id, session.id))
    .run();
  return c.json({ partNumber: uploaded.partNumber, etag: uploaded.etag });
});
files.post("/:id/multipart/complete", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.status === "ready" || row.status === "quarantined")
    return c.json({ ok: true });
  if (row.status !== "pending")
    return c.json({ error: "upload unavailable" }, 409);
  const body = await c.req.json<{
    uploadId?: string;
    parts?: { partNumber: number; etag: string }[];
  }>();
  const session = await db
    .select()
    .from(schema.uploadSessions)
    .where(eq(schema.uploadSessions.fileId, id))
    .get()
    .catch(() => null);
  if (
    !body?.uploadId ||
    !session ||
    session.uploadId !== body.uploadId ||
    session.status !== "active" ||
    session.expiresAt <= nowSeconds()
  )
    return c.json({ error: "active upload session required" }, 400);
  // Complete only the parts the Worker itself recorded. Client-provided ETags
  // are progress hints, not trusted completion authority.
  const parts = (
    JSON.parse(session.parts || "[]") as Array<{
      partNumber: number;
      etag: string;
    }>
  )
    .map((p: { partNumber: number; etag: string }) => ({
      partNumber: Number(p.partNumber),
      etag: String(p.etag),
    }))
    .sort(
      (a: { partNumber: number }, b: { partNumber: number }) =>
        a.partNumber - b.partNumber,
    );
  if (
    !parts.length ||
    parts.some(
      (part: { partNumber: number; etag: string }) =>
        !Number.isInteger(part.partNumber) || part.partNumber < 1 || !part.etag,
    )
  )
    return c.json({ error: "valid parts are required" }, 400);
  let object = await c.env.FILES.head(row.r2Key);
  try {
    if (!object) {
      await c.env.FILES.resumeMultipartUpload(
        row.r2Key,
        body.uploadId,
      ).complete(parts);
      object = await c.env.FILES.head(row.r2Key);
    }
  } catch (e) {
    return c.json(
      {
        error: `multipart complete failed: ${(e as Error)?.message ?? "unknown"}`,
      },
      400,
    );
  }
  if (!object || object.size !== row.sizeBytes) {
    await discardPendingUpload(c, db, row);
    return c.json({ error: "upload size mismatch" }, 409);
  }
  const integrityError = await verifyMultipartIntegrity(c, db, row);
  if (integrityError) return integrityError;
  return markReady(c, db, row, id);
});
files.post("/:id/multipart/abort", async (c) => {
  const id = c.req.param("id");
  const uploadId = c.req.query("uploadId");
  if (!uploadId) return c.json({ error: "uploadId required" }, 400);
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  try {
    await c.env.FILES.resumeMultipartUpload(row.r2Key, uploadId).abort();
  } catch {}
  await db
    .update(schema.uploadSessions)
    .set({ status: "aborted", updatedAt: nowSeconds() })
    .where(eq(schema.uploadSessions.fileId, id))
    .run()
    .catch(() => {});
  await releaseReservation(c.env.DB, id);
  await db
    .delete(schema.files)
    .where(eq(schema.files.id, id))
    .run()
    .catch(() => {});
  return c.json({ ok: true });
});
files.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadPendingOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.status === "ready" || row.status === "quarantined")
    return c.json({ ok: true });
  if (row.status !== "pending")
    return c.json({ error: "upload unavailable" }, 409);
  const object = await c.env.FILES.head(row.r2Key);
  if (!object) return c.json({ error: "upload missing" }, 409);
  if (object.size !== row.sizeBytes) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    return c.json({ error: "upload size mismatch" }, 409);
  }
  return markReady(c, db, row, id);
});

files.get("/", async (c) => {
  const userId = c.get("userId");
  const includeTrash = c.req.query("trash") === "true";
  const db = getDb(c.env.DB);
  const limitParam = Number(c.req.query("limit"));
  const limit =
    Number.isFinite(limitParam) && limitParam > 0
      ? Math.min(Math.floor(limitParam), 200)
      : null;
  const now = nowSeconds();
  const conds: any[] = [
    eq(schema.files.ownerId, userId),
    eq(schema.files.status, "ready"),
    gt(schema.files.expiresAt, now),
    or(isNull(schema.files.releaseAt), lte(schema.files.releaseAt, now)),
    includeTrash
      ? gt(schema.files.deletedAt, 0)
      : isNull(schema.files.deletedAt),
  ];
  // Keyset cursor: `${createdAt}_${id}`. With createdAt DESC, id DESC ordering,
  // the next page is everything strictly "after" the cursor row.
  const cursorRaw = limit ? c.req.query("cursor") || "" : "";
  if (limit && cursorRaw) {
    const sep = cursorRaw.lastIndexOf("_");
    const cTime = Number(cursorRaw.slice(0, sep));
    const cId = cursorRaw.slice(sep + 1);
    if (sep > 0 && Number.isFinite(cTime) && cId) {
      conds.push(
        or(
          lt(schema.files.createdAt, cTime),
          and(eq(schema.files.createdAt, cTime), lt(schema.files.id, cId)),
        ),
      );
    }
  }
  let query: any = db
    .select()
    .from(schema.files)
    .where(and(...conds))
    .orderBy(desc(schema.files.createdAt), desc(schema.files.id));
  if (limit) query = query.limit(limit + 1);
  const rowsAll = await query.all();
  let rows = rowsAll;
  let nextCursor: string | null = null;
  if (limit && rowsAll.length > limit) {
    rows = rowsAll.slice(0, limit);
    const last = rows[rows.length - 1];
    nextCursor = `${last.createdAt}_${last.id}`;
  }
  return c.json({ files: rows.map(safeFile), nextCursor });
});
async function loadReadyOwned(c: any, id: string) {
  const userId = c.get("userId");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        eq(schema.files.ownerId, userId),
        isNull(schema.files.deletedAt),
      ),
    )
    .get();
  return { db, row };
}
files.get("/:id/download", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadReadyOwned(c, id);
  if (!row || row.status !== "ready")
    return c.json({ error: "not found" }, 404);
  if (row.releaseAt && row.releaseAt > nowSeconds())
    return c.json(
      { error: "file is not available yet", releaseAt: row.releaseAt },
      423,
    );
  if (isExpired(row.expiresAt)) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const head = await c.env.FILES.head(row.r2Key);
  if (!head) return c.json({ error: "not found" }, 404);
  const size = head.size;
  const range = parseRange(c.req.header("Range") ?? null, size);
  const object = await c.env.FILES.get(
    row.r2Key,
    range
      ? { range: { offset: range.offset, length: range.length } }
      : undefined,
  );
  if (!object) return c.json({ error: "not found" }, 404);
  if (!range || range.offset === 0) {
    await logActivity(c, db, "file.download", id, row.filename);
    if (row.expireAfterDownload)
      await db
        .update(schema.files)
        .set({ expiresAt: nowSeconds() })
        .where(eq(schema.files.id, row.id))
        .run();
  }
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set(
    "Content-Disposition",
    `attachment; filename=\"${row.filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Accept-Ranges", "bytes");
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(object.body, { headers });
});
files.get("/:id/inline", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadReadyOwned(c, id);
  if (!row || row.status !== "ready")
    return c.json({ error: "not found" }, 404);
  if (row.releaseAt && row.releaseAt > nowSeconds())
    return c.json(
      { error: "file is not available yet", releaseAt: row.releaseAt },
      423,
    );
  if (!isInlineSafeContentType(row.contentType))
    return c.json({ error: "inline preview not allowed" }, 415);
  if (isExpired(row.expiresAt)) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const meta = await c.env.FILES.head(row.r2Key);
  if (!meta) return c.json({ error: "not found" }, 404);
  const etag = meta.httpEtag;
  const inm = c.req.header("If-None-Match");
  if (etag && inm && inm === etag)
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, max-age=3600" },
    });
  const size = meta.size;
  const range = parseRange(c.req.header("Range") ?? null, size);
  const object = await c.env.FILES.get(
    row.r2Key,
    range
      ? { range: { offset: range.offset, length: range.length } }
      : undefined,
  );
  if (!object) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set(
    "Content-Disposition",
    `inline; filename=\"${row.filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("Cache-Control", "private, max-age=3600");
  headers.set("Accept-Ranges", "bytes");
  if (etag) headers.set("ETag", etag);
  addInlineSecurityHeaders(headers);
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(object.body, { headers });
});
files.put("/:id/thumbnail", async (c) => {
  const id = c.req.param("id");
  const { row } = await loadReadyOwned(c, id);
  if (!row) return c.json({ error: "not found" }, 404);
  if (!isImageContentType(row.contentType))
    return c.json({ error: "thumbnail only for images" }, 415);
  const declared = Number(c.req.header("Content-Length") || 0);
  if (!Number.isSafeInteger(declared) || declared <= 0)
    return c.json({ error: "valid Content-Length is required" }, 411);
  if (declared > THUMB_MAX_BYTES)
    return c.json({ error: "thumbnail too large" }, 413);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty thumbnail" }, 400);
  const key = thumbKey(row.r2Key);
  await c.env.FILES.put(key, body, {
    httpMetadata: { contentType: "image/jpeg" },
  });
  const stored = await c.env.FILES.head(key);
  if (stored && stored.size > THUMB_MAX_BYTES) {
    try {
      await c.env.FILES.delete(key);
    } catch {}
    return c.json({ error: "thumbnail too large" }, 413);
  }
  return c.json({ ok: true });
});
files.get("/:id/thumbnail", async (c) => {
  const id = c.req.param("id");
  const { db, row } = await loadReadyOwned(c, id);
  if (!row || row.status !== "ready")
    return c.json({ error: "not found" }, 404);
  if (!isImageContentType(row.contentType))
    return c.json({ error: "no thumbnail" }, 415);
  if (isExpired(row.expiresAt)) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const tKey = thumbKey(row.r2Key);
  let meta = await c.env.FILES.head(tKey);
  const usingThumb = !!meta;
  const key = usingThumb ? tKey : row.r2Key;
  if (!meta) meta = await c.env.FILES.head(row.r2Key);
  if (!meta) return c.json({ error: "not found" }, 404);
  const etag = meta.httpEtag;
  const inm = c.req.header("If-None-Match");
  if (etag && inm && inm === etag)
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, max-age=604800" },
    });
  const object = await c.env.FILES.get(key);
  if (!object) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set(
    "Content-Type",
    usingThumb ? "image/jpeg" : row.contentType || "application/octet-stream",
  );
  headers.set("Content-Length", String(object.size));
  headers.set("Content-Disposition", "inline");
  headers.set("Cache-Control", "private, max-age=604800");
  if (etag) headers.set("ETag", etag);
  addInlineSecurityHeaders(headers);
  return new Response(object.body, { headers });
});
files.post("/:id/share", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<ShareBody>().catch(() => ({}) as ShareBody);
  const db = getDb(c.env.DB);
  const policy = await settings(db);
  if (!policy.publicSharingEnabled)
    return c.json({ error: "public sharing is disabled" }, 403);
  if (policy.requirePasswordForShares && !body.password)
    return c.json({ error: "password required by workspace policy" }, 400);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, id),
        eq(schema.files.ownerId, userId),
        isNull(schema.files.deletedAt),
      ),
    )
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const token = row.shareToken ?? crypto.randomUUID().replace(/-/g, "");
  const update: Record<string, unknown> = { shareToken: token };
  const hasOptions =
    "password" in body ||
    "downloadLimit" in body ||
    "expiresInDays" in body ||
    "accessMode" in body ||
    "oneTime" in body ||
    "embed" in body ||
    "allowlist" in body ||
    "ipAllowlist" in body ||
    "countryAllowlist" in body;
  if (hasOptions) {
    update.sharePassword = body.password
      ? await hashSecret(String(body.password))
      : null;
    update.shareDownloadLimit =
      typeof body.downloadLimit === "number" && body.downloadLimit > 0
        ? Math.floor(body.downloadLimit)
        : null;
    update.shareExpiresAt =
      typeof body.expiresInDays === "number" && body.expiresInDays > 0
        ? nowSeconds() + Math.round(body.expiresInDays * DAY_SECONDS)
        : null;
    update.shareAccessMode = accessMode(body.accessMode);
    update.shareOneTime = !!body.oneTime;
    update.shareEmbed = body.embed !== false;
    update.shareAllowlist = serializeList(body.allowlist);
    update.shareIpAllowlist = serializeList(body.ipAllowlist);
    update.shareCountryAllowlist = serializeList(body.countryAllowlist);
    update.shareDownloadCount = 0;
  }
  await db
    .update(schema.files)
    .set(update)
    .where(eq(schema.files.id, id))
    .run();
  await logActivity(c, db, "file.share", id, row.filename);
  return c.json({
    token,
    url: `${c.env.PUBLIC_APP_URL}/api/share/${token}`,
    hasPassword: hasOptions ? !!body.password : !!row.sharePassword,
    downloadLimit: hasOptions
      ? (update.shareDownloadLimit as number | null)
      : (row.shareDownloadLimit ?? null),
    shareExpiresAt: hasOptions
      ? (update.shareExpiresAt as number | null)
      : (row.shareExpiresAt ?? null),
    accessMode: hasOptions
      ? update.shareAccessMode
      : (row.shareAccessMode ?? "download"),
    oneTime: hasOptions ? !!update.shareOneTime : !!row.shareOneTime,
    embed: hasOptions
      ? (update.shareEmbed as boolean)
      : row.shareEmbed !== false,
  });
});
files.delete("/:id/share", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.files)
    .set({
      shareToken: null,
      sharePassword: null,
      shareDownloadLimit: null,
      shareDownloadCount: 0,
      shareExpiresAt: null,
      shareAccessMode: "download",
      shareOneTime: false,
      shareEmbed: true,
      shareAllowlist: null,
      shareIpAllowlist: null,
      shareCountryAllowlist: null,
    })
    .where(eq(schema.files.id, id))
    .run();
  await logActivity(c, db, "file.revoke", id, row.filename);
  return c.json({ ok: true });
});
files.get("/:id/share/events", async (c) => {
  const { db, row } = await loadReadyOwned(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  const events = await db
    .select()
    .from(schema.shareEvents)
    .where(eq(schema.shareEvents.fileId, row.id))
    .orderBy(desc(schema.shareEvents.createdAt))
    .limit(200)
    .all()
    .catch(() => []);
  const summary = events.reduce(
    (acc, ev) => {
      acc[ev.event] = (acc[ev.event] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );
  return c.json({ events, summary });
});
files.get("/:id/versions", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const versions = await db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.versionGroupId, row.versionGroupId ?? row.id))
    .orderBy(desc(schema.fileVersions.versionNumber))
    .all()
    .catch(() => []);
  return c.json({ versions });
});
files.put("/:id/versions", async (c) => {
  const { db, row } = await loadReadyOwned(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  if (row.encryptionMode === "aes-gcm")
    return c.json(
      {
        error:
          "E2E file versions require browser-side encryption and are not supported yet.",
      },
      409,
    );
  const sizeBytes = normalizeUploadSize(c.req.header("Content-Length"));
  if (sizeBytes == null)
    return c.json({ error: "Content-Length is required" }, 411);
  const policy = await settings(db);
  if (policy.maxUploadBytes > 0 && sizeBytes > policy.maxUploadBytes)
    return c.json({ error: "file exceeds workspace upload limit" }, 413);
  const contentType = (
    c.req.header("Content-Type") || "application/octet-stream"
  ).slice(0, 255);
  if (!typeAllowed(contentType, policy.allowedTypes))
    return c.json({ error: "file type is not allowed" }, 415);
  const rawName = c.req.header("X-File-Name") || row.filename;
  let filename = rawName;
  try {
    filename = decodeURIComponent(rawName);
  } catch {}
  filename = filename.trim().slice(0, 255) || row.filename;
  const checksum = (c.req.header("X-Checksum-Sha256") || "")
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(checksum))
    return c.json({ error: "valid SHA-256 checksum required" }, 400);
  const banned = await db
    .select()
    .from(schema.bannedFileHashes)
    .where(eq(schema.bannedFileHashes.hash, checksum))
    .get()
    .catch(() => null);
  if (banned)
    return c.json(
      { error: "This file is blocked by workspace security policy." },
      451,
    );
  const account = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, row.ownerId))
    .get();
  const role = await adminRole(c.env, db, account?.email ?? "");
  const delta = Math.max(0, sizeBytes - row.sizeBytes);
  let reserved = false;
  if (delta > 0 && role !== "owner" && role !== "admin") {
    await db
      .delete(schema.uploadReservations)
      .where(
        and(
          eq(schema.uploadReservations.fileId, row.id),
          eq(schema.uploadReservations.status, "completed"),
        ),
      )
      .run()
      .catch(() => {});
    const reservation = await reserveUpload(c.env.DB, {
      userId: row.ownerId,
      fileId: row.id,
      bytes: delta,
      quotaBytes: account?.quotaBytes ?? policy.defaultQuotaBytes,
    });
    reserved = reservation.reserved;
    if (!reserved) return c.json({ error: "storage quota exceeded" }, 413);
  }
  const nextKey = `${row.ownerId}/${row.id}/version-${crypto.randomUUID()}`;
  try {
    const options: R2PutOptions = { httpMetadata: { contentType } };
    if (checksum) options.sha256 = checksum;
    const object = await c.env.FILES.put(nextKey, c.req.raw.body, options);
    if (!object || object.size !== sizeBytes)
      throw new Error("uploaded size did not match Content-Length");
    const versions = await db
      .select({ versionNumber: schema.fileVersions.versionNumber })
      .from(schema.fileVersions)
      .where(
        eq(schema.fileVersions.versionGroupId, row.versionGroupId ?? row.id),
      )
      .all();
    const nextVersion =
      Math.max(0, ...versions.map((version) => version.versionNumber)) + 1;
    await db
      .insert(schema.fileVersions)
      .values({
        id: crypto.randomUUID(),
        fileId: row.id,
        versionGroupId: row.versionGroupId ?? row.id,
        versionNumber: nextVersion,
        r2Key: nextKey,
        sizeBytes,
        checksum: checksum || null,
        contentType,
        filename,
        createdAt: nowSeconds(),
      })
      .run();
    await db
      .update(schema.files)
      .set({
        r2Key: nextKey,
        sizeBytes,
        contentType,
        filename,
        checksum: checksum || null,
        checksumAlgorithm: checksum ? "sha-256" : null,
        status: c.env.SCANNER ? "quarantined" : "ready",
        scanStatus: c.env.SCANNER ? "pending" : "not_required",
      })
      .where(eq(schema.files.id, row.id))
      .run();
    if (reserved) await completeReservation(c.env.DB, row.id);
    await logActivity(
      c,
      db,
      "file.version.upload",
      row.id,
      `uploaded v${nextVersion}`,
    );
    if (c.env.SCANNER) c.executionCtx.waitUntil(scanFile(c.env, row.id));
    return c.json({ ok: true, versionNumber: nextVersion });
  } catch (error) {
    await c.env.FILES.delete(nextKey).catch(() => {});
    if (reserved) await releaseReservation(c.env.DB, row.id);
    return c.json(
      {
        error: error instanceof Error ? error.message : "version upload failed",
      },
      500,
    );
  }
});
files.get("/:id/versions/:versionId/download", async (c) => {
  const { db, row } = await loadReadyOwned(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  const version = await db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.id, c.req.param("versionId")))
    .get()
    .catch(() => null);
  if (!version || version.versionGroupId !== (row.versionGroupId ?? row.id))
    return c.json({ error: "version not found" }, 404);
  const object = await c.env.FILES.get(version.r2Key);
  if (!object) return c.json({ error: "version object missing" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Length", String(object.size));
  headers.set(
    "Content-Disposition",
    `attachment; filename=\"v${version.versionNumber}-${row.filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
});
files.post("/:id/versions/:versionId/restore", async (c) => {
  const { db, row } = await loadReadyOwned(c, c.req.param("id"));
  if (!row) return c.json({ error: "not found" }, 404);
  const version = await db
    .select()
    .from(schema.fileVersions)
    .where(eq(schema.fileVersions.id, c.req.param("versionId")))
    .get()
    .catch(() => null);
  if (!version || version.versionGroupId !== (row.versionGroupId ?? row.id))
    return c.json({ error: "version not found" }, 404);
  const object = await c.env.FILES.get(version.r2Key);
  if (!object) return c.json({ error: "version object missing" }, 404);
  const newKey = `${row.ownerId}/${row.id}/restore-${crypto.randomUUID()}`;
  const policy = await settings(db);
  const account = await db
    .select()
    .from(schema.user)
    .where(eq(schema.user.id, row.ownerId))
    .get();
  const role = await adminRole(c.env, db, account?.email ?? "");
  const delta = Math.max(0, version.sizeBytes - row.sizeBytes);
  let reserved = false;
  if (delta > 0 && role !== "owner" && role !== "admin") {
    await db
      .delete(schema.uploadReservations)
      .where(
        and(
          eq(schema.uploadReservations.fileId, row.id),
          eq(schema.uploadReservations.status, "completed"),
        ),
      )
      .run()
      .catch(() => {});
    reserved = (
      await reserveUpload(c.env.DB, {
        userId: row.ownerId,
        fileId: row.id,
        bytes: delta,
        quotaBytes: account?.quotaBytes ?? policy.defaultQuotaBytes,
      })
    ).reserved;
    if (!reserved) return c.json({ error: "storage quota exceeded" }, 413);
  }
  try {
    const contentType = version.contentType ?? row.contentType;
    await c.env.FILES.put(
      newKey,
      object.body,
      contentType ? { httpMetadata: { contentType } } : undefined,
    );
    const versions = await db
      .select()
      .from(schema.fileVersions)
      .where(
        eq(schema.fileVersions.versionGroupId, row.versionGroupId ?? row.id),
      )
      .all()
      .catch(() => []);
    const nextVersion =
      Math.max(0, ...versions.map((v) => v.versionNumber)) + 1;
    await db
      .update(schema.files)
      .set({
        r2Key: newKey,
        sizeBytes: version.sizeBytes,
        filename: version.filename ?? row.filename,
        contentType,
        checksum: version.checksum,
        status: c.env.SCANNER ? "quarantined" : "ready",
        scanStatus: c.env.SCANNER ? "pending" : "not_required",
      })
      .where(eq(schema.files.id, row.id))
      .run();
    await db
      .insert(schema.fileVersions)
      .values({
        id: crypto.randomUUID(),
        fileId: row.id,
        versionGroupId: row.versionGroupId ?? row.id,
        versionNumber: nextVersion,
        r2Key: newKey,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        contentType,
        filename: version.filename ?? row.filename,
        createdAt: nowSeconds(),
      })
      .run();
    if (reserved) await completeReservation(c.env.DB, row.id);
    await logActivity(
      c,
      db,
      "file.version.restore",
      row.id,
      `restored v${version.versionNumber}`,
    );
    if (c.env.SCANNER) c.executionCtx.waitUntil(scanFile(c.env, row.id));
    return c.json({ ok: true, versionNumber: nextVersion });
  } catch (error) {
    await c.env.FILES.delete(newKey).catch(() => {});
    if (reserved) await releaseReservation(c.env.DB, row.id);
    return c.json(
      {
        error:
          error instanceof Error ? error.message : "version restore failed",
      },
      500,
    );
  }
});
files.post("/bulk-keep-forever", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{ ids?: string[]; keepForever?: boolean }>()
    .catch(() => ({}) as { ids?: string[]; keepForever?: boolean });
  const ids = Array.isArray(body.ids)
    ? body.ids.filter((x): x is string => typeof x === "string").slice(0, 500)
    : [];
  if (ids.length === 0) return c.json({ error: "no files selected" }, 400);
  const enable = body.keepForever !== false;
  const db = getDb(c.env.DB);
  if (enable && !(await canKeepForever(c, db, userId, c.get("userEmail"))))
    return c.json({ error: "keep-forever permission required" }, 403);
  let count = 0;
  for (const id of ids) {
    const row = await db
      .select()
      .from(schema.files)
      .where(
        and(
          eq(schema.files.id, id),
          eq(schema.files.ownerId, userId),
          isNull(schema.files.deletedAt),
        ),
      )
      .get()
      .catch(() => null);
    if (!row) continue;
    const expiresAt = enable
      ? FOREVER_EXPIRES_AT
      : computeExpiresAt(c.env, row.createdAt);
    await db
      .update(schema.files)
      .set({ keepForever: enable, expiresAt })
      .where(eq(schema.files.id, id))
      .run();
    count++;
  }
  await logActivity(
    c,
    db,
    enable ? "file.keepForever.bulk" : "file.unkeepForever.bulk",
    ids[0],
    `${count} file${count === 1 ? "" : "s"}`,
  );
  return c.json({ ok: true, count });
});
files.post("/bulk", async (c) => {
  const userId = c.get("userId");
  const body = await c.req
    .json<{
      action?: string;
      ids?: string[];
      folderId?: string | null;
      tags?: string[];
    }>()
    .catch(
      () =>
        ({}) as {
          action?: string;
          ids?: string[];
          folderId?: string | null;
          tags?: string[];
        },
    );
  const action = String(body.action || "");
  const ids = Array.isArray(body.ids)
    ? Array.from(
        new Set(body.ids.filter((x): x is string => typeof x === "string")),
      ).slice(0, 500)
    : [];
  if (ids.length === 0) return c.json({ error: "no files selected" }, 400);
  const allowed = [
    "trash",
    "restore",
    "permanentDelete",
    "favorite",
    "unfavorite",
    "move",
    "tags",
  ];
  if (!allowed.includes(action))
    return c.json({ error: "unsupported bulk action" }, 400);
  const db = getDb(c.env.DB);
  let targetFolderId: string | null = null;
  if (action === "move" && body.folderId) {
    const folder = await db
      .select()
      .from(schema.folders)
      .where(
        and(
          eq(schema.folders.id, body.folderId),
          eq(schema.folders.ownerId, userId),
        ),
      )
      .get()
      .catch(() => null);
    if (!folder) return c.json({ error: "folder not found" }, 404);
    targetFolderId = body.folderId;
  }
  // Restrict to files this user actually owns in a single query, then apply the
  // mutation with one batched query so the request scales no matter how many
  // files are selected (a per-item loop blew past the Worker subrequest limit).
  const owned = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.ownerId, userId), inArray(schema.files.id, ids)))
    .all()
    .catch(() => []);
  const ownedIds = owned.map((r) => r.id);
  if (ownedIds.length === 0) return c.json({ ok: true, count: 0 });
  const scope = and(
    eq(schema.files.ownerId, userId),
    inArray(schema.files.id, ownedIds),
  );
  if (action === "trash") {
    await db
      .update(schema.files)
      .set({
        deletedAt: nowSeconds(),
        shareToken: null,
        sharePassword: null,
        shareDownloadLimit: null,
        shareDownloadCount: 0,
        shareExpiresAt: null,
      })
      .where(scope)
      .run();
  } else if (action === "restore") {
    await db.update(schema.files).set({ deletedAt: null }).where(scope).run();
  } else if (action === "permanentDelete") {
    await deleteFileObjects(c.env.FILES, db, owned).catch(() => {});
    await db.delete(schema.files).where(scope).run();
  } else if (action === "favorite" || action === "unfavorite") {
    await db
      .update(schema.files)
      .set({ favorite: action === "favorite" })
      .where(scope)
      .run();
  } else if (action === "move") {
    await db
      .update(schema.files)
      .set({ folderId: targetFolderId })
      .where(scope)
      .run();
  } else if (action === "tags") {
    await db
      .update(schema.files)
      .set({ tags: serializeTags(body.tags) })
      .where(scope)
      .run();
  }
  const count = ownedIds.length;
  await logActivity(
    c,
    db,
    `file.bulk.${action}`,
    ownedIds[0],
    `${count} file${count === 1 ? "" : "s"}`,
  );
  return c.json({ ok: true, count });
});
files.patch("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const body = await c.req.json<{
    extendDays?: number;
    expiryDays?: number;
    folderId?: string | null;
    filename?: string;
    favorite?: boolean;
    tags?: string[];
    keepForever?: boolean;
  }>();
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  const update: Record<string, unknown> = {};
  if (body.keepForever === true) {
    if (!(await canKeepForever(c, db, userId, c.get("userEmail"))))
      return c.json({ error: "keep-forever permission required" }, 403);
    update.expiresAt = FOREVER_EXPIRES_AT;
    update.keepForever = true;
  }
  if (body.keepForever === false) {
    update.keepForever = false;
    update.expiresAt = computeExpiresAt(c.env, row.createdAt);
  }
  const addDays = Math.max(body.extendDays ?? body.expiryDays ?? 0, 0);
  if (addDays > 0 && !update.keepForever) {
    update.expiresAt = clampExtension(
      c.env,
      row.createdAt,
      Math.max(row.expiresAt, nowSeconds()) + Math.round(addDays * DAY_SECONDS),
    );
    update.keepForever = false;
  }
  if ("folderId" in body) {
    const fid = body.folderId;
    if (fid) {
      const folder = await db
        .select()
        .from(schema.folders)
        .where(
          and(eq(schema.folders.id, fid), eq(schema.folders.ownerId, userId)),
        )
        .get();
      if (!folder) return c.json({ error: "folder not found" }, 404);
      update.folderId = fid;
    } else update.folderId = null;
  }
  if (typeof body.filename === "string") {
    const name = body.filename.trim();
    if (!name) return c.json({ error: "filename cannot be empty" }, 400);
    update.filename = name.slice(0, 255);
  }
  if (typeof body.favorite === "boolean") update.favorite = body.favorite;
  if (Array.isArray(body.tags)) update.tags = serializeTags(body.tags);
  if (Object.keys(update).length === 0)
    return c.json({ error: "nothing to update" }, 400);
  await db
    .update(schema.files)
    .set(update)
    .where(eq(schema.files.id, id))
    .run();
  await logActivity(
    c,
    db,
    update.keepForever ? "file.keepForever" : "file.update",
    id,
    row.filename,
  );
  const next = await db
    .select()
    .from(schema.files)
    .where(eq(schema.files.id, id))
    .get();
  return c.json({
    ok: true,
    file: next ? safeFile(next) : null,
    expiresAt: next?.expiresAt,
    folderId: next?.folderId ?? null,
    filename: next?.filename,
  });
});
files.post("/:id/restore", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.files)
    .set({ deletedAt: null })
    .where(eq(schema.files.id, id))
    .run();
  await logActivity(c, db, "file.restore", id, row.filename);
  return c.json({ ok: true });
});
files.delete("/:id/permanent", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await deleteOneFileObjects(c.env.FILES, db, row).catch(() => {});
  await db.delete(schema.files).where(eq(schema.files.id, id)).run();
  await logActivity(c, db, "file.deletePermanent", id, row.filename);
  return c.json({ ok: true });
});
files.delete("/:id", async (c) => {
  const userId = c.get("userId");
  const id = c.req.param("id");
  const db = getDb(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(and(eq(schema.files.id, id), eq(schema.files.ownerId, userId)))
    .get();
  if (!row) return c.json({ error: "not found" }, 404);
  await db
    .update(schema.files)
    .set({
      deletedAt: nowSeconds(),
      shareToken: null,
      sharePassword: null,
      shareDownloadLimit: null,
      shareDownloadCount: 0,
      shareExpiresAt: null,
    })
    .where(eq(schema.files.id, id))
    .run();
  await logActivity(c, db, "file.trash", id, row.filename);
  return c.json({ ok: true });
});

export default files;
