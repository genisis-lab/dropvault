import { zip } from "fflate"
import { downloadUrl } from "./api"

export type ZipItem = { id: string; filename: string }

// Bundles the given files into a single .zip entirely in the browser — no backend
// endpoint needed. Fetches each file through the authenticated download route,
// de-duplicates colliding names, then streams a stored (level 0) archive so it
// stays fast for already-compressed media.
export async function downloadFilesAsZip(
  items: ZipItem[],
  zipName = "dropvault.zip",
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  if (items.length === 0) return
  const entries: Record<string, Uint8Array> = {}
  const used = new Set<string>()
  let done = 0
  for (const item of items) {
    const res = await fetch(downloadUrl(item.id), { credentials: "include" })
    if (!res.ok) throw new Error(`Couldn't fetch \"${item.filename}\" (${res.status})`)
    const buf = new Uint8Array(await res.arrayBuffer())
    const base = item.filename || item.id
    let name = base
    let i = 1
    while (used.has(name)) {
      const dot = base.lastIndexOf(".")
      name = dot > 0 ? `${base.slice(0, dot)} (${i})${base.slice(dot)}` : `${base} (${i})`
      i++
    }
    used.add(name)
    entries[name] = buf
    done++
    onProgress?.(done, items.length)
  }
  const data: Uint8Array = await new Promise((resolve, reject) => {
    zip(entries, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)))
  })
  // Copy into a fresh ArrayBuffer-backed view so the Blob part type is exactly
  // Uint8Array<ArrayBuffer> (fflate's output is typed over ArrayBufferLike,
  // which TS will not accept as a BlobPart under strict lib typings).
  const bytes = new Uint8Array(data.byteLength)
  bytes.set(data)
  const blob = new Blob([bytes], { type: "application/zip" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = zipName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
