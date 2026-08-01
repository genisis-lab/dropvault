import type { Bindings } from "../types";

const textEncoder = new TextEncoder();

export const PASSWORD_RECOVERY_ITERATIONS = 600_000;
export const MIN_RECOVERY_PASSWORD_LENGTH = 8;
export const MAX_RECOVERY_PASSWORD_LENGTH = 128;

export type PasswordKeyEnvelope = {
  v: 1;
  kdf: "PBKDF2-SHA-256";
  iterations: number;
  salt: string;
  nonce: string;
  ciphertext: string;
};

type AccountKeyEnvelope = {
  v: 2;
  kid: string;
  nonce: string;
  ciphertext: string;
};

type CredentialVerifier = {
  v: 1;
  kid: string;
  digest: string;
};

type RecoveryKey = { id: string; secret: string };
export type RecoveryKeyring = {
  current: RecoveryKey;
  previous?: RecoveryKey;
};

function base64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let offset = 0; offset < view.length; offset += 0x8000)
    binary += String.fromCharCode(...view.subarray(offset, offset + 0x8000));
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (value.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error("invalid base64url");
  const padded =
    value.replace(/-/g, "+").replace(/_/g, "/") +
    "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function byteLength(value: unknown): number | null {
  if (typeof value !== "string") return null;
  try {
    return fromBase64Url(value).byteLength;
  } catch {
    return null;
  }
}

function validKey(value: RecoveryKey | undefined): value is RecoveryKey {
  return !!(
    value &&
    /^[A-Za-z0-9._-]{1,64}$/.test(value.id) &&
    textEncoder.encode(value.secret).byteLength >= 32
  );
}

export function recoveryKeyring(
  env: Pick<
    Bindings,
    | "VAULT_KEY_ID"
    | "VAULT_KEY_SECRET"
    | "VAULT_KEY_PREVIOUS_ID"
    | "VAULT_KEY_SECRET_PREVIOUS"
  >,
): RecoveryKeyring | null {
  const current = {
    id: env.VAULT_KEY_ID ?? "v1",
    secret: env.VAULT_KEY_SECRET ?? "",
  };
  if (!validKey(current)) return null;
  const previous = {
    id: env.VAULT_KEY_PREVIOUS_ID ?? "",
    secret: env.VAULT_KEY_SECRET_PREVIOUS ?? "",
  };
  return validKey(previous) && previous.id !== current.id
    ? { current, previous }
    : { current };
}

export function vaultRecoveryAvailable(
  keyring: RecoveryKeyring | null | undefined,
): boolean {
  return !!keyring && validKey(keyring.current);
}

function keyById(keyring: RecoveryKeyring, id: string): RecoveryKey {
  if (keyring.current.id === id) return keyring.current;
  if (keyring.previous?.id === id) return keyring.previous;
  throw new Error("recovery key version is unavailable");
}

function recoveryContext(ownerId: string, fileId: string): Uint8Array {
  return textEncoder.encode(`dropvault:file-key-recovery:v2:${ownerId}:${fileId}`);
}

async function accountWrappingKey(
  key: RecoveryKey,
  ownerId: string,
  fileId: string,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(key.secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: textEncoder.encode("dropvault-account-recovery-v2"),
      info: recoveryContext(ownerId, fileId),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapAccountFileKey(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  encodedFileKey: string,
): Promise<string> {
  const rawFileKey = fromBase64Url(encodedFileKey);
  if (rawFileKey.byteLength !== 32) throw new Error("invalid file key");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: recoveryContext(ownerId, fileId),
    },
    await accountWrappingKey(keyring.current, ownerId, fileId),
    rawFileKey,
  );
  return JSON.stringify({
    v: 2,
    kid: keyring.current.id,
    nonce: base64Url(nonce),
    ciphertext: base64Url(ciphertext),
  } satisfies AccountKeyEnvelope);
}

export async function unwrapAccountFileKey(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  serializedEnvelope: string,
): Promise<string> {
  const envelope = JSON.parse(serializedEnvelope) as AccountKeyEnvelope;
  if (
    envelope.v !== 2 ||
    !/^[A-Za-z0-9._-]{1,64}$/.test(envelope.kid) ||
    byteLength(envelope.nonce) !== 12 ||
    byteLength(envelope.ciphertext) !== 48
  )
    throw new Error("invalid account recovery envelope");
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: fromBase64Url(envelope.nonce),
      additionalData: recoveryContext(ownerId, fileId),
    },
    await accountWrappingKey(
      keyById(keyring, envelope.kid),
      ownerId,
      fileId,
    ),
    fromBase64Url(envelope.ciphertext),
  );
  if (clear.byteLength !== 32) throw new Error("invalid recovered file key");
  return base64Url(clear);
}

export function normalizePasswordEnvelope(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const envelope = value as Partial<PasswordKeyEnvelope>;
  if (
    envelope.v !== 1 ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    envelope.iterations !== PASSWORD_RECOVERY_ITERATIONS ||
    byteLength(envelope.salt) !== 16 ||
    byteLength(envelope.nonce) !== 12 ||
    byteLength(envelope.ciphertext) !== 48
  )
    return null;
  return JSON.stringify({
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PASSWORD_RECOVERY_ITERATIONS,
    salt: String(envelope.salt),
    nonce: String(envelope.nonce),
    ciphertext: String(envelope.ciphertext),
  } satisfies PasswordKeyEnvelope);
}

export function normalizeCredentialSalt(value: unknown): string | null {
  return typeof value === "string" && byteLength(value) === 16 ? value : null;
}

export function normalizeCredentialProof(value: unknown): string | null {
  return typeof value === "string" && byteLength(value) === 32 ? value : null;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function credentialInput(
  kind: "password" | "duress",
  ownerId: string,
  fileId: string,
  proof: string,
): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    textEncoder.encode(
      `dropvault:${kind}-proof:v2\u0000${ownerId}\u0000${fileId}\u0000${proof}`,
    ),
  );
}

function parseVerifier(value: string | null | undefined): CredentialVerifier | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as CredentialVerifier;
    return parsed.v === 1 &&
      /^[A-Za-z0-9._-]{1,64}$/.test(parsed.kid) &&
      byteLength(parsed.digest) === 32
      ? parsed
      : null;
  } catch {
    return null;
  }
}

async function createCredentialVerifier(
  keyring: RecoveryKeyring,
  kind: "password" | "duress",
  ownerId: string,
  fileId: string,
  proof: string,
): Promise<string> {
  const normalized = normalizeCredentialProof(proof);
  if (!normalized) throw new Error("valid recovery credential proof required");
  const digest = await crypto.subtle.sign(
    "HMAC",
    await hmacKey(keyring.current.secret),
    credentialInput(kind, ownerId, fileId, normalized),
  );
  return JSON.stringify({
    v: 1,
    kid: keyring.current.id,
    digest: base64Url(digest),
  } satisfies CredentialVerifier);
}

async function verifyCredential(
  keyring: RecoveryKeyring,
  kind: "password" | "duress",
  ownerId: string,
  fileId: string,
  proof: string,
  storedVerifier: string | null | undefined,
): Promise<boolean> {
  const normalized = normalizeCredentialProof(proof);
  const verifier = parseVerifier(storedVerifier);
  if (!normalized || !verifier) return false;
  let key: RecoveryKey;
  try {
    key = keyById(keyring, verifier.kid);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    "HMAC",
    await hmacKey(key.secret),
    fromBase64Url(verifier.digest),
    credentialInput(kind, ownerId, fileId, normalized),
  );
}

export function createPasswordVerifier(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  proof: string,
): Promise<string> {
  return createCredentialVerifier(keyring, "password", ownerId, fileId, proof);
}

export function verifyRecoveryProof(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  proof: string,
  storedVerifier: string | null | undefined,
): Promise<boolean> {
  return verifyCredential(
    keyring,
    "password",
    ownerId,
    fileId,
    proof,
    storedVerifier,
  );
}

export function createDuressVerifier(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  proof: string,
): Promise<string> {
  return createCredentialVerifier(keyring, "duress", ownerId, fileId, proof);
}

export function verifyDuressProof(
  keyring: RecoveryKeyring,
  ownerId: string,
  fileId: string,
  proof: string,
  storedVerifier: string | null | undefined,
): Promise<boolean> {
  return verifyCredential(
    keyring,
    "duress",
    ownerId,
    fileId,
    proof,
    storedVerifier,
  );
}
