// Tiny SHA-256 helper (Web Crypto) used to hash share-link passwords. We store
// only the hex digest, never the plaintext. These are low-stakes share gates,
// not user credentials, so a per-file salt is intentionally omitted.
export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest("SHA-256", data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

// Constant-time comparison for hex digests so password unlock checks do not
// short-circuit on the first different character.
export async function timingSafeEqualHex(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false
  const aBytes = new TextEncoder().encode(a)
  const bBytes = new TextEncoder().encode(b)
  let diff = 0
  for (let i = 0; i < aBytes.length; i++) diff |= aBytes[i] ^ bBytes[i]
  return diff === 0
}
