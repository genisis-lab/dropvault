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

export type RecoveryStatus = {
  accountRecovery: boolean;
  passwordRecovery: boolean;
  duressEnabled: boolean;
  legacyBrowserOnly: boolean;
  credentialSalt: string | null;
};

export type RecoveryConfiguration = {
  account: { action: "keep" | "set" | "remove"; key?: string };
  password: {
    action: "keep" | "set" | "remove";
    envelope?: PasswordKeyEnvelope;
    proof?: string;
    credentialSalt?: string;
  };
  duress: {
    action: "keep" | "set" | "remove";
    proof?: string;
  };
};

export class VaultRecoveryError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "VaultRecoveryError";
  }
}

const API = import.meta.env.VITE_API_URL ?? "";
const encoder = new TextEncoder();

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

function recoveryContext(fileId: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(
    encoder.encode(`dropvault:password-recovery:v1:${fileId}`),
  );
}

function normalizedPassword(password: string): string {
  const normalized = password.normalize("NFKC");
  const length = Array.from(normalized).length;
  if (
    length < MIN_RECOVERY_PASSWORD_LENGTH ||
    length > MAX_RECOVERY_PASSWORD_LENGTH
  )
    throw new Error(
      `Recovery passwords must be ${MIN_RECOVERY_PASSWORD_LENGTH}-${MAX_RECOVERY_PASSWORD_LENGTH} characters`,
    );
  return normalized;
}

export function createCredentialSalt(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(16)));
}

export async function deriveRecoveryProof(
  password: string,
  credentialSalt: string,
): Promise<string> {
  const salt = fromBase64Url(credentialSalt);
  if (salt.byteLength !== 16) throw new Error("invalid recovery credential salt");
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedPassword(password)),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return base64Url(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: PASSWORD_RECOVERY_ITERATIONS,
      },
      material,
      256,
    ),
  );
}

async function passwordWrappingKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(normalizedPassword(password)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: PASSWORD_RECOVERY_ITERATIONS,
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function createPasswordKeyEnvelope(
  encodedFileKey: string,
  password: string,
  fileId: string,
): Promise<PasswordKeyEnvelope> {
  const fileKey = fromBase64Url(encodedFileKey);
  if (fileKey.byteLength !== 32) throw new Error("invalid file key");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: recoveryContext(fileId),
    },
    await passwordWrappingKey(password, salt),
    fileKey,
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA-256",
    iterations: PASSWORD_RECOVERY_ITERATIONS,
    salt: base64Url(salt),
    nonce: base64Url(nonce),
    ciphertext: base64Url(ciphertext),
  };
}

export async function unwrapPasswordKeyEnvelope(
  envelope: PasswordKeyEnvelope,
  password: string,
  fileId: string,
): Promise<string> {
  if (
    envelope.v !== 1 ||
    envelope.kdf !== "PBKDF2-SHA-256" ||
    envelope.iterations !== PASSWORD_RECOVERY_ITERATIONS
  )
    throw new Error("unsupported recovery envelope");
  const salt = fromBase64Url(envelope.salt);
  const nonce = fromBase64Url(envelope.nonce);
  if (salt.byteLength !== 16 || nonce.byteLength !== 12)
    throw new Error("invalid recovery envelope");
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: recoveryContext(fileId),
    },
    await passwordWrappingKey(password, salt),
    fromBase64Url(envelope.ciphertext),
  );
  if (clear.byteLength !== 32) throw new Error("invalid recovered key");
  return base64Url(clear);
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    code?: string;
  };
  if (!response.ok)
    throw new VaultRecoveryError(
      body.error || "Vault recovery failed",
      body.code || "RECOVERY_FAILED",
      response.status,
    );
  return body as T;
}

export async function recoveryStatus(fileId: string): Promise<RecoveryStatus> {
  return json<RecoveryStatus>(
    await fetch(`${API}/api/files/${fileId}/recovery`, {
      credentials: "include",
      cache: "no-store",
    }),
  );
}

export async function configureFileRecovery(
  fileId: string,
  configuration: RecoveryConfiguration,
): Promise<RecoveryStatus & { ok: true }> {
  return json<RecoveryStatus & { ok: true }>(
    await fetch(`${API}/api/files/${fileId}/recovery`, {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration),
    }),
  );
}

export async function recoverAccountFileKey(fileId: string): Promise<string> {
  const result = await json<{ key: string }>(
    await fetch(`${API}/api/files/${fileId}/recovery/unlock`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "account" }),
    }),
  );
  return result.key;
}

export async function recoverPasswordFileKey(
  fileId: string,
  password: string,
  credentialSalt?: string | null,
): Promise<string> {
  const salt =
    credentialSalt ?? (await recoveryStatus(fileId)).credentialSalt;
  if (!salt)
    throw new VaultRecoveryError(
      "Password recovery is not configured",
      "PASSWORD_REQUIRED",
      409,
    );
  const proof = await deriveRecoveryProof(password, salt);
  const result = await json<{ envelope: PasswordKeyEnvelope }>(
    await fetch(`${API}/api/files/${fileId}/recovery/unlock`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "password", proof }),
    }),
  );
  try {
    return await unwrapPasswordKeyEnvelope(result.envelope, password, fileId);
  } catch {
    throw new VaultRecoveryError(
      "That password could not unlock this file",
      "UNLOCK_FAILED",
      401,
    );
  }
}

export type RecoveryPasswordRequest = {
  fileId: string;
  filename: string;
  resolve: (password: string | null) => void;
};

export function requestRecoveryPassword(
  fileId: string,
  filename: string,
): Promise<string | null> {
  return new Promise((resolve) => {
    window.dispatchEvent(
      new CustomEvent<RecoveryPasswordRequest>(
        "dropvault:recovery-password-request",
        { detail: { fileId, filename, resolve } },
      ),
    );
  });
}

export function notifyVaultFilesChanged(): void {
  window.dispatchEvent(new CustomEvent("dropvault:files-changed"));
}
