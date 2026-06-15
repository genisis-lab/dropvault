// Tiny SHA-256 helpers (Web Crypto) used to hash share-link / upload-request
// passwords. We store only digests, never the plaintext.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Constant-time comparison for hex digests so password checks do not
// short-circuit on the first different character.
export async function timingSafeEqualHex(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}

// Generate a random salt as a hex string.
function randomSaltHex(bytes = 16): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Hash a secret (share / upload-request password) with a per-secret random
// salt. Stored format is `salt$digest`, where digest = SHA-256(salt + plain).
// Because the salt is unique per file/folder/request, identical passwords never
// produce the same digest and precomputed rainbow tables are useless if the DB
// ever leaks.
export async function hashSecret(plain: string): Promise<string> {
  const salt = randomSaltHex()
  const digest = await sha256Hex(salt + plain)
  return `${salt}$${digest}`
}

// Verify a plaintext secret against a stored value. New values are `salt$digest`;
// legacy values (written before per-secret salting) are bare digests, so we fall
// back to an unsalted constant-time comparison to keep old share links working
// until they are re-shared.
export async function verifySecret(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false
  const sep = stored.indexOf("$")
  if (sep === -1) {
    return timingSafeEqualHex(await sha256Hex(plain), stored)
  }
  const salt = stored.slice(0, sep)
  const expected = stored.slice(sep + 1)
  return timingSafeEqualHex(await sha256Hex(salt + plain), expected)
}
