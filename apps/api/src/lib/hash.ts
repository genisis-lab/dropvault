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
