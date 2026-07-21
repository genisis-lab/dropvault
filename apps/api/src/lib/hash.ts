// Password hashing helpers (Web Crypto) for share-link / upload-request
// passwords. We store only derived digests, never the plaintext.

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function isHex(value: string, bytes?: number): boolean {
  return (
    (bytes === undefined || value.length === bytes * 2) &&
    value.length % 2 === 0 &&
    /^[0-9a-f]+$/i.test(value)
  );
}

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

// Cloudflare's DigestStream hashes an arbitrarily large stream without
// retaining the file in Worker memory. This is used to independently verify
// multipart R2 uploads, whose API does not accept a whole-object SHA-256 at
// completion time.
export async function sha256StreamHex(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const digestStream = new crypto.DigestStream("SHA-256");
  await stream.pipeTo(digestStream);
  return bytesToHex(new Uint8Array(await digestStream.digest));
}

// Constant-time comparison for hex digests so password checks do not
// short-circuit on the first different character.
export async function timingSafeEqualHex(
  a: string,
  b: string,
): Promise<boolean> {
  if (a.length !== b.length) return false;
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i];
  return diff === 0;
}

// Generate a random salt as a hex string.
function randomSaltHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return bytesToHex(arr);
}

// PBKDF2-SHA256 key derivation. Deliberately slow so a leaked digest resists
// offline brute force far better than a single SHA-256 round would.
const PBKDF2_ITERATIONS = 600000;
async function pbkdf2Hex(
  plain: string,
  saltHex: string,
  iterations: number,
  lenBytes = 32,
): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(plain),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: hexToBytes(saltHex), iterations },
    keyMaterial,
    lenBytes * 8,
  );
  return bytesToHex(new Uint8Array(bits));
}

// Hash a secret (share / upload-request password) with PBKDF2 and a per-secret
// random salt. Stored format is `pbkdf2$<iterations>$<salt>$<digest>`. Because
// the salt is unique per secret, identical passwords never produce the same
// digest and precomputed tables are useless if the DB ever leaks.
export async function hashSecret(plain: string): Promise<string> {
  const salt = randomSaltHex();
  const digest = await pbkdf2Hex(plain, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${digest}`;
}

// Verify a plaintext secret against a stored value. Supports three formats for
// backward compatibility:
//   - `pbkdf2$<iters>$<salt>$<digest>` (current)
//   - `<salt>$<digest>`                legacy salted SHA-256
//   - `<digest>`                       legacy unsalted SHA-256
// Legacy values keep old share/upload links working until they are re-shared.
export async function verifySecret(
  plain: string,
  stored: string | null | undefined,
): Promise<boolean> {
  if (!stored) return false;
  if (stored.startsWith("pbkdf2$")) {
    const parts = stored.split("$");
    if (parts.length !== 4) return false;
    const iterations = Number(parts[1]);
    if (
      !Number.isSafeInteger(iterations) ||
      iterations < 1000 ||
      iterations > 2_000_000
    )
      return false;
    if (!isHex(parts[2], 16) || !isHex(parts[3], 32)) return false;
    return timingSafeEqualHex(
      await pbkdf2Hex(plain, parts[2], iterations),
      parts[3],
    );
  }
  const sep = stored.indexOf("$");
  if (sep === -1) {
    if (!isHex(stored, 32)) return false;
    return timingSafeEqualHex(await sha256Hex(plain), stored);
  }
  const salt = stored.slice(0, sep);
  const expected = stored.slice(sep + 1);
  if (!isHex(salt) || !isHex(expected, 32)) return false;
  return timingSafeEqualHex(await sha256Hex(salt + plain), expected);
}
