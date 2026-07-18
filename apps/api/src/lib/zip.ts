// Small ZIP writer for Cloudflare Workers. Uses STORE (no compression), which is
// fast and dependency-free. Good for on-demand folder exports where R2 already
// stores the bytes and we just need a standard archive container.
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dosDateTime(sec: number): { date: number; time: number } {
  const d = new Date(sec * 1000);
  const year = Math.max(1980, d.getUTCFullYear());
  const date =
    ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time =
    (d.getUTCHours() << 11) |
    (d.getUTCMinutes() << 5) |
    Math.floor(d.getUTCSeconds() / 2);
  return { date, time };
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}
function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}
function safeName(name: string): string {
  return (
    name
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean)
      .join("/")
      .replace(/[\u0000-\u001f]/g, "_")
      .slice(0, 240) || "file"
  );
}

export type ZipInput = { name: string; bytes: Uint8Array; modifiedAt?: number };

export function makeZip(files: ZipInput[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = encoder.encode(safeName(file.name));
    const data = file.bytes;
    const crc = crc32(data);
    const { date, time } = dosDateTime(
      file.modifiedAt ?? Math.floor(Date.now() / 1000),
    );
    const local = concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
      data,
    ]);
    localParts.push(local);
    const central = concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(time),
      u16(date),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(central);
    offset += local.length;
  }
  const central = concat(centralParts);
  const end = concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...localParts, central, end]);
}

export function zipResponse(zip: Uint8Array, filename: string): Response {
  const headers = new Headers();
  headers.set("Content-Type", "application/zip");
  headers.set("Content-Length", String(zip.byteLength));
  headers.set(
    "Content-Disposition",
    `attachment; filename=\"${filename.replace(/[\"\\]/g, "_")}\"`,
  );
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(zip, { headers });
}
