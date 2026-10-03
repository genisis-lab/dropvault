import { Hono } from "hono";
import { and, desc, eq, gt, isNull, lte, sql } from "drizzle-orm";
import { getCookie, setCookie } from "hono/cookie";
import { createAuth } from "../auth";
import { getDb, schema } from "../db";
import {
  expiryCountdownLabel,
  isExpired,
  nowSeconds,
} from "../lib/expiry";
import { hashSecret, verifySecret } from "../lib/hash";
import { notifyAdmins } from "../lib/notifications";
import { deliverPendingEvents, enqueueEvent } from "../lib/delivery";
import { emailDeliveryConfigured } from "../lib/email";
import { ipMatchesAllowlist } from "../lib/ipAccess";
import { checkRateLimit, clientIp } from "../lib/rateLimit";
import { makeZip, zipResponse } from "../lib/zip";
import { contentSecurityNonce, jsonForInlineScript } from "../lib/html";
import { hasRole } from "../middleware/admin";
import { workspaceDefaultTheme, type PublicTheme } from "../lib/theme";
import type { Bindings, Variables } from "../types";

type FileRow = typeof schema.files.$inferSelect;
type FolderRow = typeof schema.folders.$inferSelect;

const share = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&"
      ? "&amp;"
      : ch === "<"
        ? "&lt;"
        : ch === ">"
          ? "&gt;"
          : ch === '"'
            ? "&quot;"
            : "&#39;",
  );
}
function fmtBytes(n: number): string {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), u.length - 1);
  return `${(n / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}
function humanLeft(expiresAt: number): string {
  return expiryCountdownLabel(expiresAt);
}
function list(raw: string | null): string[] {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}
function country(c: any): string {
  return String(c.req.header("CF-IPCountry") ?? "").toUpperCase();
}
function allowedByList(value: string, values: string[]): boolean {
  return (
    !values.length ||
    values.map((x) => x.toLowerCase()).includes(value.toLowerCase())
  );
}
function accessDeniedPage(theme: PublicTheme, msg: string): string {
  return infoPage(theme, "Access restricted", msg);
}
function isImageType(type: string | null): boolean {
  return !!type && type.startsWith("image/");
}
function isVideoType(type: string | null): boolean {
  return !!type && type.startsWith("video/");
}
function isInlineSafeType(type: string | null): boolean {
  return (
    !!type &&
    (type.startsWith("image/") ||
      type.startsWith("video/") ||
      type.includes("pdf"))
  );
}
// Decide the security headers for an inline (preview) response.
//
// Script-capable document types (SVG/HTML/XML, or an unknown type) are fully
// sandboxed so an untrusted upload can never execute JavaScript in our origin.
//
// Inert media (raster image / video / audio / pdf) is NOT sandboxed: the
// browser's built-in player/viewer needs to run a script for its controls, and
// a blanket sandbox breaks playback ("frame is sandboxed and the allow-scripts
// permission is not set"). Because we always send an explicit Content-Type plus
// X-Content-Type-Options: nosniff, the bytes can never be reinterpreted as
// executable HTML, so dropping the sandbox introduces no XSS vector.
function addShareInlineSecurityHeaders(
  headers: Headers,
  contentType: string | null,
): void {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  const type = (contentType ?? "").toLowerCase();
  const scriptable =
    !type ||
    type.includes("svg") ||
    type.includes("html") ||
    type.includes("xml");
  if (scriptable) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data: blob:; base-uri 'none'; frame-ancestors 'none'; sandbox",
    );
  } else {
    headers.set(
      "Content-Security-Policy",
      "default-src 'none'; img-src 'self' data: blob:; media-src 'self' blob:; object-src 'self'; frame-ancestors 'none'",
    );
  }
}
// Best-effort MIME lookup from a filename extension. Used as a fallback when
// R2 stored no Content-Type (or a generic octet-stream), which otherwise makes
// browsers refuse to play media inline.
function guessContentType(filename: string): string | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4",
    m4v: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    ogv: "video/ogg",
    mkv: "video/x-matroska",
    avi: "video/x-msvideo",
    mpeg: "video/mpeg",
    mpg: "video/mpeg",
    "3gp": "video/3gpp",
    mp3: "audio/mpeg",
    m4a: "audio/mp4",
    wav: "audio/wav",
    ogg: "audio/ogg",
    flac: "audio/flac",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    pdf: "application/pdf",
  };
  return map[ext] ?? null;
}
// Parse a single HTTP Range header ("bytes=start-end" or suffix "bytes=-N").
// Returns null for absent/unsatisfiable/multi-range so the caller serves 200.
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
function guestCookieName(token: string): string {
  return `dvguest_${token}`;
}
async function verifiedGuestEmail(
  c: any,
  db: ReturnType<typeof getDb>,
  token: string,
): Promise<string> {
  const value = getCookie(c, guestCookieName(token));
  if (!value) return "";
  const row = await db
    .select()
    .from(schema.guestAccessTokens)
    .where(
      and(
        eq(schema.guestAccessTokens.token, value),
        eq(schema.guestAccessTokens.shareToken, token),
        gt(schema.guestAccessTokens.expiresAt, nowSeconds()),
      ),
    )
    .get()
    .catch(() => null);
  return row?.email ?? "";
}
async function shareGate(
  c: any,
  db: ReturnType<typeof getDb>,
  token: string,
  row: FileRow | FolderRow,
): Promise<
  { ok: true } | { ok: false; message: string; needsEmail?: boolean }
> {
  if ((row as any).shareAccessMode === "disabled")
    return { ok: false, message: "This link has been disabled by the owner." };
  const ips = list((row as any).shareIpAllowlist ?? null);
  const countries = list((row as any).shareCountryAllowlist ?? null).map((x) =>
    x.toUpperCase(),
  );
  const emails = list((row as any).shareAllowlist ?? null);
  if (!ipMatchesAllowlist(clientIp(c), ips))
    return {
      ok: false,
      message: "Your IP address is not allowed to use this link.",
    };
  if (!allowedByList(country(c), countries))
    return {
      ok: false,
      message: "Your country is not allowed to use this link.",
    };
  if (
    emails.length &&
    !allowedByList(await verifiedGuestEmail(c, db, token), emails)
  )
    return {
      ok: false,
      message: "This link requires email verification.",
      needsEmail: true,
    };
  return { ok: true };
}
async function logShareEvent(
  c: any,
  db: ReturnType<typeof getDb>,
  input: {
    token: string;
    fileId?: string | null;
    folderId?: string | null;
    event: string;
  },
) {
  try {
    await db
      .insert(schema.shareEvents)
      .values({
        id: crypto.randomUUID(),
        token: input.token,
        fileId: input.fileId ?? null,
        folderId: input.folderId ?? null,
        event: input.event,
        ip: clientIp(c),
        country: country(c) || null,
        userAgent: c.req.header("User-Agent") ?? null,
        referer: c.req.header("Referer") ?? null,
        createdAt: nowSeconds(),
      })
      .run();
  } catch {}
}
async function adminCanReviewReportedFile(
  c: any,
  db: ReturnType<typeof getDb>,
  token: string,
  row: FileRow,
): Promise<boolean> {
  try {
    const session = await createAuth(c.env).api.getSession({
      headers: c.req.raw.headers,
    });
    const email = session?.user?.email;
    if (!(await hasRole(c.env, db, email, "moderator"))) return false;
    const flags = await db
      .select()
      .from(schema.fileFlags)
      .where(eq(schema.fileFlags.token, token))
      .all()
      .catch(() => []);
    return flags.some(
      (flag) =>
        flag.fileId === row.id &&
        flag.status !== "resolved" &&
        flag.status !== "dismissed",
    );
  } catch {
    return false;
  }
}
function oneTimeConsumed(row: FileRow | FolderRow): boolean {
  return (
    !!(row as any).shareOneTime && ((row as any).shareDownloadCount ?? 0) > 0
  );
}

const STYLE = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body {
  --app: #f8fafd;
  --card: #fff;
  --line: #e1e3e1;
  --strong: #1f1f1f;
  --muted: #444746;
  --faint: #747775;
  --hover: #f1f4f9;
  --accent: #0b57d0;
  --accent-ink: #fff;
  --accent-soft: #d3e3fd;
  --accent-text: #0842a0;
  --card-shadow: 0 1px 2px rgba(60, 64, 67, .3), 0 1px 3px 1px rgba(60, 64, 67, .15);
  margin: 0;
  min-height: 100vh;
  background: var(--app);
  color: var(--strong);
  font-family: "Google Sans Text", "Google Sans", Roboto, "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
body[data-theme="dark"] {
  color-scheme: dark;
  --app: #131314;
  --card: #1e1f20;
  --line: #444746;
  --strong: #e3e3e3;
  --muted: #c4c7c5;
  --faint: #8e918f;
  --hover: #282a2c;
  --accent: #a8c7fa;
  --accent-ink: #062e6f;
  --accent-soft: #004a77;
  --accent-text: #c2e7ff;
  --card-shadow: 0 1px 3px rgba(0, 0, 0, .5);
}
@media (prefers-color-scheme: dark) {
  body[data-theme="system"] {
    color-scheme: dark;
    --app: #131314;
    --card: #1e1f20;
    --line: #444746;
    --strong: #e3e3e3;
    --muted: #c4c7c5;
    --faint: #8e918f;
    --hover: #282a2c;
    --accent: #a8c7fa;
    --accent-ink: #062e6f;
    --accent-soft: #004a77;
    --accent-text: #c2e7ff;
    --card-shadow: 0 1px 3px rgba(0, 0, 0, .5);
  }
}
.wrap { max-width: 760px; margin: 0 auto; padding: 28px 20px 64px; }
.brand { display: flex; align-items: center; gap: 10px; margin: 0 0 28px; }
.logo { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; background: #0b57d0; color: #fff; }
.logo svg { width: 22px; height: 22px; }
.brand b { font-size: 22px; font-weight: 400; color: var(--muted); }
.brand b span { color: var(--muted); }
h1 { margin: 0 0 6px; font-size: clamp(22px, 4vw, 28px); font-weight: 400; line-height: 1.25; overflow-wrap: anywhere; }
.muted { margin: 0 0 24px; color: var(--muted); font-size: 14px; line-height: 1.5; }
.card, .list, .empty { border: 0; border-radius: 16px; background: var(--card); box-shadow: var(--card-shadow); }
.card { padding: 36px 28px; text-align: center; }
.list { overflow: hidden; }
.row { display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-top: 1px solid var(--line); }
.row:first-child { border-top: 0; }
.row:hover { background: var(--hover); }
.rowmain { display: flex; min-width: 0; flex: 1; align-items: center; gap: 14px; color: inherit; text-decoration: none; }
.ic, .fic { display: grid; place-items: center; color: var(--accent-text); background: var(--accent-soft); }
.ic { width: 40px; height: 40px; flex: none; border-radius: 50%; font-size: 18px; }
.fic { width: 72px; height: 72px; margin: 0 auto 18px; border-radius: 50%; font-size: 30px; }
.grow { min-width: 0; flex: 1; }.name { overflow: hidden; font-size: 14px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }.meta { color: var(--faint); font-size: 12px; }
.dl { display: inline-flex; flex: none; align-items: center; gap: 6px; border: 1px solid var(--line); border-radius: 999px; background: transparent; color: var(--accent); padding: 7px 16px; font-size: 13px; font-weight: 500; text-decoration: none; }.dl:hover { background: var(--hover); }
.empty { padding: 56px 16px; color: var(--faint); text-align: center; }.btns { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 22px; }
.btn { display: inline-flex; min-height: 40px; align-items: center; justify-content: center; gap: 8px; border: 1px solid transparent; border-radius: 999px; padding: 9px 24px; font: inherit; font-size: 14px; font-weight: 500; text-decoration: none; cursor: pointer; transition: background-color 120ms ease, box-shadow 120ms ease; }
.btn.primary { background: var(--accent); color: var(--accent-ink); }.btn.primary:hover { box-shadow: 0 1px 2px rgba(60, 64, 67, .3), 0 1px 3px 1px rgba(60, 64, 67, .15); }.btn.ghost { border-color: var(--line); background: transparent; color: var(--accent); }.btn.ghost:hover { background: var(--hover); }
.btn:focus-visible, .dl:focus-visible, .pwin:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.pwform { display: flex; max-width: 340px; flex-direction: column; gap: 12px; margin: 22px auto 0; }.pwin { width: 100%; border: 1px solid var(--faint); border-radius: 8px; background: var(--card); padding: 12px 14px; color: var(--strong); font: inherit; font-size: 15px; outline: none; }.pwin:focus { border-color: var(--accent); box-shadow: inset 0 0 0 1px var(--accent); }
.badges { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 0 0 7px; }.badge { display: inline-block; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--muted); padding: 4px 10px; font-size: 12px; font-weight: 500; }.err { margin: 0; color: #b3261e; font-size: 14px; }.pimg, .pvid { display: block; max-width: 100%; margin: 0 auto 18px; border-radius: 12px; background: #000; }.pimg { max-height: 74vh; width: auto; object-fit: contain; }.pvid { width: 100%; max-height: 74vh; } footer { margin-top: 30px; color: var(--faint); font-size: 12px; text-align: center; }
body[data-theme] h1.fname { overflow-wrap: anywhere; }
@media (max-width: 560px) { .wrap { padding: 20px 16px 48px; }.card { padding: 28px 18px; }.btn { width: 100%; }.btns { display: grid; }.pvid { max-height: 56vh; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; } }
`;
function pageShell(
  theme: PublicTheme,
  title: string,
  inner: string,
  head = "",
): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>${esc(title)} \u00b7 Dropvault</title>${head}<style>${STYLE}</style></head><body data-theme="${theme}"><div class="wrap"><div class="brand"><div class="logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M5 16a4 4 0 0 1 .9-7.9A5 5 0 0 1 16 7a3.5 3.5 0 0 1 .6 6.96" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 10.5v7m0 0 2.4-2.4M12 17.5l-2.4-2.4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><b>Drop<span>vault</span></b></div>${inner}<footer>Shared securely with Dropvault.</footer></div></body></html>`;
}
function filePage(
  theme: PublicTheme,
  name: string,
  meta: string,
  token: string,
  notes: string,
  previewOnly: boolean,
): string {
  const dl = previewOnly
    ? ""
    : `<a class="btn primary" href="/api/share/${token}?dl=1">\u2193 Download</a>`;
  return pageShell(
    theme,
    name,
    `<div class="card"><div class="fic">\u2913</div><h1 class="fname">${esc(name)}</h1><p class="muted">${esc(meta)}</p>${notes}<div class="btns">${dl}<a class="btn ghost" href="/api/share/${token}?raw=1" target="_blank" rel="noopener">Preview</a><a class="btn ghost" href="/api/share/${token}/report">Report</a></div></div>`,
  );
}
function encryptedFilePage(
  theme: PublicTheme,
  name: string,
  meta: string,
  token: string,
  nonce: string | null,
  encryptedMetadata: string | null,
  downloadDisabled: boolean,
  scriptNonce: string,
): string {
  const config = jsonForInlineScript({ token, nonce, encryptedMetadata });
  const action = downloadDisabled
    ? `<p class="muted">This link is preview-only, but encrypted files cannot be previewed without downloading and decrypting them.</p>`
    : `<button id="decrypt" class="btn primary" type="button">Decrypt &amp; download</button><p id="status" class="muted" style="margin-top:14px">The key stays in your browser and is never sent to Dropvault.</p>`;
  return pageShell(
    theme,
    name,
    `<div class="card"><div class="fic">🔐</div><h1 class="fname">${esc(name)}</h1><p class="muted">${esc(meta)} · end-to-end encrypted</p><div class="btns">${action}</div></div><script nonce="${scriptNonce}">(()=>{const config=${config};const status=document.getElementById("status");const button=document.getElementById("decrypt");if(!button)return;const decode=(value)=>{value=value.replace(/-/g,"+").replace(/_/g,"/");while(value.length%4)value+="=";return Uint8Array.from(atob(value),c=>c.charCodeAt(0))};const fail=(message)=>{status.textContent=message;button.disabled=false};button.addEventListener("click",async()=>{button.disabled=true;status.textContent="Downloading encrypted bytes…";try{const encodedKey=new URLSearchParams(location.hash.slice(1)).get("key");if(!encodedKey)throw new Error("This link is missing its decryption key. Ask the sender for the complete URL.");if(!config.nonce)throw new Error("This encrypted file has no nonce.");const key=await crypto.subtle.importKey("raw",decode(encodedKey),"AES-GCM",false,["decrypt"]);const response=await fetch("/api/share/"+config.token+"?dl=1");if(!response.ok)throw new Error((await response.json().catch(()=>({}))).error||"Download failed");status.textContent="Decrypting in this browser…";const clear=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(config.nonce)},key,await response.arrayBuffer());let filename="Decrypted file",contentType="application/octet-stream";try{const metadata=JSON.parse(config.encryptedMetadata);const decoded=await crypto.subtle.decrypt({name:"AES-GCM",iv:decode(metadata.nonce)},key,decode(metadata.ciphertext));const parsed=JSON.parse(new TextDecoder().decode(decoded));filename=parsed.filename||filename;contentType=parsed.contentType||contentType}catch{}const url=URL.createObjectURL(new Blob([clear],{type:contentType}));const link=document.createElement("a");link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);status.textContent="Decrypted download ready."}catch(error){fail(error instanceof Error?error.message:"Could not decrypt this file")}})})()</script>`,
  );
}
function imageFilePage(
  theme: PublicTheme,
  name: string,
  meta: string,
  token: string,
  notes: string,
  previewOnly: boolean,
  head = "",
): string {
  const dl = previewOnly
    ? ""
    : `<a class="btn primary" href="/api/share/${token}?dl=1">\u2193 Download</a>`;
  return pageShell(
    theme,
    name,
    `<div class="card"><img class="pimg" src="/api/share/${token}?raw=1" alt="${esc(name)}"/><h1 class="fname">${esc(name)}</h1><p class="muted">${esc(meta)}</p>${notes}<div class="btns">${dl}<a class="btn ghost" href="/api/share/${token}?raw=1" target="_blank" rel="noopener">Open original</a><a class="btn ghost" href="/api/share/${token}/report">Report</a></div></div>`,
    head,
  );
}
function videoFilePage(
  theme: PublicTheme,
  name: string,
  meta: string,
  token: string,
  notes: string,
  previewOnly: boolean,
  contentType: string | null,
  head = "",
): string {
  const dl = previewOnly
    ? ""
    : `<a class="btn primary" href="/api/share/${token}?dl=1">\u2193 Download</a>`;
  return pageShell(
    theme,
    name,
    `<div class="card"><video class="pvid" controls preload="metadata" playsinline><source src="/api/share/${token}?raw=1" type="${esc(contentType ?? "video/mp4")}"/></video><h1 class="fname">${esc(name)}</h1><p class="muted">${esc(meta)}</p>${notes}<div class="btns">${dl}<a class="btn ghost" href="/api/share/${token}?raw=1" target="_blank" rel="noopener">Open original</a><a class="btn ghost" href="/api/share/${token}/report">Report</a></div></div>`,
    head,
  );
}
function reportPage(theme: PublicTheme, token: string, done: boolean): string {
  return done
    ? pageShell(
        theme,
        "Report received",
        `<div class="card"><div class="fic">\u2713</div><h1>Report received</h1><p class="muted">Thanks \u2014 our admins will review this file shortly. You can close this page.</p></div>`,
      )
    : pageShell(
        theme,
        "Report this file",
        `<div class="card"><div class="fic">\u2691</div><h1>Report this file</h1><p class="muted">Tell us why this file should be reviewed. Your report goes to the workspace admins.</p><form method="post" action="/api/share/${token}/flag" class="pwform"><textarea class="pwin" name="reason" rows="4" placeholder="What's wrong with this file?" required></textarea><input class="pwin" type="email" name="email" placeholder="Your email (optional)"/><button type="submit" class="btn primary" style="justify-content:center">Submit report</button></form></div>`,
      );
}
function passwordPage(
  theme: PublicTheme,
  actionPath: string,
  error: boolean,
): string {
  const err = error
    ? `<p class="err">Incorrect password. Please try again.</p>`
    : ``;
  return pageShell(
    theme,
    "Password required",
    `<div class="card"><div class="fic">\ud83d\udd12</div><h1>Password required</h1><p class="muted">This link is protected. Enter the password to continue.</p><form method="post" action="${actionPath}" class="pwform">${err}<input class="pwin" type="password" name="password" placeholder="Password" autofocus required/><button type="submit" class="btn primary" style="justify-content:center">Unlock</button></form></div>`,
  );
}
function infoPage(theme: PublicTheme, title: string, msg: string): string {
  return pageShell(
    theme,
    title,
    `<div class="card"><div class="fic">\u2298</div><h1>${esc(title)}</h1><p class="muted">${esc(msg)}</p></div>`,
  );
}
function guestVerificationPage(
  theme: PublicTheme,
  token: string,
  folder: boolean,
  sent: boolean,
  error = "",
): string {
  const prefix = folder ? "folder/" : "";
  const errorHtml = error ? `<p class="err">${esc(error)}</p>` : "";
  const form = sent
    ? `<p class="muted">Enter the six-digit code sent to your email.</p><form method="post" action="/api/share/guest/${token}/verify" class="pwform">${errorHtml}<input type="hidden" name="folder" value="${folder ? "1" : "0"}"/><input class="pwin" type="email" name="email" placeholder="you@example.com" required/><input class="pwin" name="code" inputmode="numeric" pattern="[0-9]{6}" placeholder="Verification code" required/><button class="btn primary" type="submit">Verify email</button></form>`
    : `<p class="muted">This share is limited to approved recipients. We will email you a one-time code.</p><form method="post" action="/api/share/guest/${token}/request" class="pwform">${errorHtml}<input type="hidden" name="folder" value="${folder ? "1" : "0"}"/><input class="pwin" type="email" name="email" placeholder="you@example.com" required/><button class="btn primary" type="submit">Send verification code</button></form>`;
  return pageShell(
    theme,
    "Verify your email",
    `<div class="card"><div class="fic">@</div><h1>Verify your email</h1>${form}<div class="btns"><a class="btn ghost" href="/api/share/${prefix}${token}">Back</a></div></div>`,
  );
}
function folderPage(
  theme: PublicTheme,
  name: string,
  rowsHtml: string,
  count: number,
  notes = "",
  token?: string,
  zipAllowed = true,
): string {
  const zip =
    token && zipAllowed
      ? `<div class="btns"><a class="btn primary" href="/api/share/folder/${token}/zip">\u2193 Download ZIP</a></div>`
      : "";
  const body = count
    ? `<div class="list">${rowsHtml}</div>${zip}`
    : `<div class="empty">This folder is empty, or its files have expired.</div>`;
  return pageShell(
    theme,
    name,
    `<h1 class="fname">${esc(name)}</h1><p class="muted">${count} file${count === 1 ? "" : "s"} \u00b7 shared folder</p>${notes}${body}`,
  );
}
// Range-aware streaming for shared objects. Heads the object first so we know
// its size, then honors a single-range Range request (206 Partial Content) or
// serves the whole object (200). Always advertises Accept-Ranges so download
// managers know they can resume large files.
async function streamShare(
  c: any,
  key: string,
  filename: string,
  attachment: boolean,
  contentType?: string | null,
): Promise<Response> {
  const meta = await c.env.FILES.head(key);
  if (!meta) return c.json({ error: "not found" }, 404);
  const size = meta.size;
  const range = parseRange(c.req.header("Range") ?? null, size);
  const object = await c.env.FILES.get(
    key,
    range
      ? { range: { offset: range.offset, length: range.length } }
      : undefined,
  );
  if (!object) return c.json({ error: "not found" }, 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  // Force an authoritative Content-Type. R2 metadata can be missing or a
  // generic octet-stream for some uploads, which makes the browser refuse to
  // play <video>/<audio> inline (especially with nosniff) and breaks the
  // "Open original" media document.
  const stored =
    contentType ||
    object.httpMetadata?.contentType ||
    meta.httpMetadata?.contentType ||
    null;
  const resolved =
    !stored || stored === "application/octet-stream"
      ? (guessContentType(filename) ?? stored)
      : stored;
  if (resolved) headers.set("Content-Type", resolved);
  headers.set(
    "Content-Disposition",
    `${attachment ? "attachment" : "inline"}; filename="${filename.replace(/["\\]/g, "_")}"`,
  );
  headers.set("Accept-Ranges", "bytes");
  if (attachment) {
    headers.set("Cache-Control", "private, max-age=0, no-store");
    headers.set("X-Content-Type-Options", "nosniff");
  } else {
    headers.set("Cache-Control", "private, max-age=300");
    addShareInlineSecurityHeaders(headers, resolved);
  }
  if (range) {
    headers.set("Content-Range", `bytes ${range.offset}-${range.end}/${size}`);
    headers.set("Content-Length", String(range.length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set("Content-Length", String(size));
  return new Response(object.body, { headers });
}
function pwCookieName(token: string): string {
  return `dvpw_${token}`;
}
async function pwUnlocked(
  c: any,
  db: ReturnType<typeof getDb>,
  row: FileRow,
  token: string,
): Promise<boolean> {
  if (!row.sharePassword) return true;
  const value = getCookie(c, pwCookieName(token));
  if (!value) return false;
  return !!(await db
    .select()
    .from(schema.guestAccessTokens)
    .where(
      and(
        eq(schema.guestAccessTokens.token, value),
        eq(schema.guestAccessTokens.shareToken, `pw:${token}`),
        gt(schema.guestAccessTokens.expiresAt, nowSeconds()),
      ),
    )
    .get()
    .catch(() => null));
}
function pwfCookieName(token: string): string {
  return `dvpwf_${token}`;
}
async function folderPwUnlocked(
  c: any,
  db: ReturnType<typeof getDb>,
  folder: FolderRow,
  token: string,
): Promise<boolean> {
  if (!folder.sharePassword) return true;
  const value = getCookie(c, pwfCookieName(token));
  if (!value) return false;
  return !!(await db
    .select()
    .from(schema.guestAccessTokens)
    .where(
      and(
        eq(schema.guestAccessTokens.token, value),
        eq(schema.guestAccessTokens.shareToken, `pwf:${token}`),
        gt(schema.guestAccessTokens.expiresAt, nowSeconds()),
      ),
    )
    .get()
    .catch(() => null));
}
function shareClosed(row: FileRow): { title: string; msg: string } | null {
  if (row.shareExpiresAt && row.shareExpiresAt <= nowSeconds())
    return {
      title: "Link expired",
      msg: "This share link has expired. Ask the owner for a new one.",
    };
  if (oneTimeConsumed(row))
    return {
      title: "Link unavailable",
      msg: "This one-time link has already been used.",
    };
  if (
    row.shareDownloadLimit != null &&
    row.shareDownloadCount >= row.shareDownloadLimit
  )
    return {
      title: "Link unavailable",
      msg: "This share link has reached its download limit.",
    };
  return null;
}
function folderShareClosed(
  folder: FolderRow,
): { title: string; msg: string } | null {
  if (folder.shareExpiresAt && folder.shareExpiresAt <= nowSeconds())
    return {
      title: "Link expired",
      msg: "This shared folder link has expired. Ask the owner for a new one.",
    };
  if (oneTimeConsumed(folder))
    return {
      title: "Link unavailable",
      msg: "This one-time folder link has already been used.",
    };
  if (
    folder.shareDownloadLimit != null &&
    folder.shareDownloadCount >= folder.shareDownloadLimit
  )
    return {
      title: "Link unavailable",
      msg: "This shared folder link has reached its download limit.",
    };
  return null;
}

async function consumeDownload(
  env: Bindings,
  kind: "file" | "folder",
  id: string,
): Promise<boolean> {
  const table = kind === "file" ? "files" : "folders";
  const result = await env.DB.prepare(
    `UPDATE ${table} SET share_download_count = share_download_count + 1 WHERE id = ? AND (share_download_limit IS NULL OR share_download_count < share_download_limit) AND (COALESCE(share_one_time, 0) = 0 OR share_download_count = 0)`,
  )
    .bind(id)
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

async function shareRecipient(
  db: ReturnType<typeof getDb>,
  token: string,
  email: string,
): Promise<{ ownerId: string; allowed: boolean; folder: boolean } | null> {
  const file = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.shareToken, token),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get()
    .catch(() => null);
  if (file) {
    const allowlist = list(file.shareAllowlist ?? null);
    if (allowlist.length === 0) return null;
    return {
      ownerId: file.ownerId,
      allowed: allowedByList(email, allowlist),
      folder: false,
    };
  }
  const folder = await db
    .select()
    .from(schema.folders)
    .where(eq(schema.folders.shareToken, token))
    .get()
    .catch(() => null);
  if (folder) {
    const allowlist = list(folder.shareAllowlist ?? null);
    if (allowlist.length === 0) return null;
    return {
      ownerId: folder.ownerId,
      allowed: allowedByList(email, allowlist),
      folder: true,
    };
  }
  return null;
}

share.post("/guest/:token/request", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const rl = await checkRateLimit(
    c.env.DB,
    `guest-code:${token}:${clientIp(c)}`,
    5,
    3600,
  );
  if (!rl.allowed)
    return c.html(
      guestVerificationPage(
        theme,
        token,
        false,
        false,
        "Too many attempts. Please try again later.",
      ),
      429,
    );
  const form = await c.req.parseBody();
  const email = String(form.email ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  const requestedFolder = String(form.folder ?? "") === "1";
  const recipient = await shareRecipient(db, token, email);
  if (!recipient || !recipient.allowed || recipient.folder !== requestedFolder)
    return c.html(
      guestVerificationPage(
        theme,
        token,
        requestedFolder,
        false,
        "That email is not approved for this share.",
      ),
      403,
    );
  if (!emailDeliveryConfigured(c.env))
    return c.html(
      guestVerificationPage(
        theme,
        token,
        requestedFolder,
        false,
        "Email delivery is not configured for this workspace.",
      ),
      503,
    );
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const code = String(random[0] % 1_000_000).padStart(6, "0");
  const now = nowSeconds();
  await db
    .delete(schema.guestAccessCodes)
    .where(
      and(
        eq(schema.guestAccessCodes.shareToken, token),
        eq(schema.guestAccessCodes.email, email),
      ),
    )
    .run()
    .catch(() => {});
  await db
    .insert(schema.guestAccessCodes)
    .values({
      id: crypto.randomUUID(),
      shareToken: token,
      email,
      codeHash: await hashSecret(code),
      attempts: 0,
      expiresAt: now + 10 * 60,
      createdAt: now,
    })
    .run();
  await enqueueEvent(db, {
    type: "guest_access_code",
    userId: recipient.ownerId,
    payload: {
      email,
      code,
      expiresInMinutes: 10,
      shareUrl: `${c.env.PUBLIC_APP_URL}/api/share/${requestedFolder ? "folder/" : ""}${token}`,
    },
  });
  c.executionCtx.waitUntil(deliverPendingEvents(c.env, 5));
  return c.html(guestVerificationPage(theme, token, requestedFolder, true));
});

share.post("/guest/:token/verify", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const form = await c.req.parseBody();
  const email = String(form.email ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  const code = String(form.code ?? "").trim();
  const folder = String(form.folder ?? "") === "1";
  const row = await db
    .select()
    .from(schema.guestAccessCodes)
    .where(
      and(
        eq(schema.guestAccessCodes.shareToken, token),
        eq(schema.guestAccessCodes.email, email),
        gt(schema.guestAccessCodes.expiresAt, nowSeconds()),
      ),
    )
    .orderBy(desc(schema.guestAccessCodes.createdAt))
    .get()
    .catch(() => null);
  if (!row || row.attempts >= 5 || !(await verifySecret(code, row.codeHash))) {
    if (row)
      await db
        .update(schema.guestAccessCodes)
        .set({ attempts: row.attempts + 1 })
        .where(eq(schema.guestAccessCodes.id, row.id))
        .run()
        .catch(() => {});
    return c.html(
      guestVerificationPage(
        theme,
        token,
        folder,
        true,
        "Invalid or expired verification code.",
      ),
      401,
    );
  }
  const sessionToken = crypto.randomUUID().replace(/-/g, "");
  const now = nowSeconds();
  await db
    .insert(schema.guestAccessTokens)
    .values({
      id: crypto.randomUUID(),
      token: sessionToken,
      shareToken: token,
      email,
      expiresAt: now + 24 * 3600,
      createdAt: now,
    })
    .run();
  await db
    .delete(schema.guestAccessCodes)
    .where(eq(schema.guestAccessCodes.id, row.id))
    .run()
    .catch(() => {});
  setCookie(c, guestCookieName(token), sessionToken, {
    path: "/api/share",
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 86400,
  });
  return c.redirect(`/api/share/${folder ? "folder/" : ""}${token}`, 303);
});

share.get("/folder/:token", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const folder = await db
    .select()
    .from(schema.folders)
    .where(eq(schema.folders.shareToken, token))
    .get();
  if (!folder)
    return c.html(
      infoPage(
        theme,
        "Link unavailable",
        "This shared folder link is invalid or has been revoked.",
      ),
      404,
    );
  const gate = await shareGate(c, db, token, folder);
  if (!gate.ok)
    return gate.needsEmail
      ? c.html(guestVerificationPage(theme, token, true, false), 401)
      : c.html(accessDeniedPage(theme, gate.message), 403);
  const closed = folderShareClosed(folder);
  if (closed) return c.html(infoPage(theme, closed.title, closed.msg), 410);
  if (folder.sharePassword && !(await folderPwUnlocked(c, db, folder, token)))
    return c.html(
      passwordPage(theme, `/api/share/folder/${token}/unlock`, false),
      401,
    );
  await logShareEvent(c, db, { token, folderId: folder.id, event: "view" });
  const rows = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.folderId, folder.id),
        eq(schema.files.status, "ready"),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
        gt(schema.files.expiresAt, nowSeconds()),
        sql`(${schema.files.releaseAt} IS NULL OR ${schema.files.releaseAt} <= ${nowSeconds()})`,
      ),
    )
    .orderBy(desc(schema.files.createdAt))
    .all();
  const previewOnly = folder.shareAccessMode === "preview";
  const rowsHtml = rows
    .map((r) => {
      const base = `/api/share/folder/${token}/${r.id}`;
      const dl = previewOnly
        ? ""
        : `<a class="dl" href="${base}?dl=1">\u2193 Download</a>`;
      return `<div class="row"><a class="rowmain" href="${base}?raw=1" target="_blank" rel="noopener"><div class="ic">\ud83d\udcc4</div><div class="grow"><div class="name">${esc(r.filename)}</div><div class="meta">${fmtBytes(r.sizeBytes)}</div></div></a>${dl}</div>`;
    })
    .join("");
  const badges: string[] = [];
  if (folder.shareDownloadLimit != null) {
    const left = Math.max(
      0,
      folder.shareDownloadLimit - folder.shareDownloadCount,
    );
    badges.push(
      `<span class="badge">${left} download${left === 1 ? "" : "s"} left</span>`,
    );
  }
  if (folder.shareExpiresAt)
    badges.push(
      `<span class="badge">${esc(humanLeft(folder.shareExpiresAt))}</span>`,
    );
  if (folder.sharePassword)
    badges.push(`<span class="badge">\ud83d\udd13 Unlocked</span>`);
  if (previewOnly)
    badges.push(
      `<span class="badge">Preview only (saving cannot be technically prevented)</span>`,
    );
  const notes = badges.length
    ? `<div class="badges">${badges.join("")}</div>`
    : "";
  return c.html(
    folderPage(theme, folder.name, rowsHtml, rows.length, notes, token, !previewOnly),
  );
});
share.get("/folder/:token/zip", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const folder = await db
    .select()
    .from(schema.folders)
    .where(eq(schema.folders.shareToken, token))
    .get();
  if (!folder) return c.json({ error: "not found" }, 404);
  const gate = await shareGate(c, db, token, folder);
  if (!gate.ok) return c.json({ error: gate.message }, 403);
  const closed = folderShareClosed(folder);
  if (closed) return c.json({ error: closed.title }, 410);
  if (folder.shareAccessMode === "preview")
    return c.json({ error: "download disabled for preview-only link" }, 403);
  if (folder.sharePassword && !(await folderPwUnlocked(c, db, folder, token)))
    return c.json({ error: "password required" }, 401);
  const rows = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.folderId, folder.id),
        eq(schema.files.status, "ready"),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
        gt(schema.files.expiresAt, nowSeconds()),
        sql`(${schema.files.releaseAt} IS NULL OR ${schema.files.releaseAt} <= ${nowSeconds()})`,
      ),
    )
    .all();
  if (rows.reduce((sum, row) => sum + row.sizeBytes, 0) > 50 * 1024 * 1024)
    return c.json(
      {
        error:
          "folder ZIP exceeds the safe synchronous limit; download files individually",
      },
      413,
    );
  if (!(await consumeDownload(c.env, "folder", folder.id)))
    return c.json({ error: "download limit reached" }, 410);
  const files = [] as Array<{
    name: string;
    bytes: Uint8Array;
    modifiedAt?: number;
  }>;
  for (const row of rows) {
    const obj = await c.env.FILES.get(row.r2Key);
    if (obj)
      files.push({
        name: row.filename,
        bytes: new Uint8Array(await obj.arrayBuffer()),
        modifiedAt: row.createdAt,
      });
  }
  if (!files.length) return c.json({ error: "folder is empty" }, 404);
  await logShareEvent(c, db, {
    token,
    folderId: folder.id,
    event: "download_zip",
  });
  return zipResponse(makeZip(files), `${folder.name}.zip`);
});
share.post("/folder/:token/unlock", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const folder = await db
    .select()
    .from(schema.folders)
    .where(eq(schema.folders.shareToken, token))
    .get();
  if (!folder)
    return c.html(
      infoPage(
        theme,
        "Link unavailable",
        "This shared folder link is invalid or has been revoked.",
      ),
      404,
    );
  if (!folder.sharePassword)
    return c.redirect(`/api/share/folder/${token}`, 302);
  const rl = await checkRateLimit(
    c.env.DB,
    `pwf:${token}:${clientIp(c)}`,
    10,
    600,
  );
  if (!rl.allowed)
    return c.html(
      infoPage(
        theme,
        "Too many attempts",
        "Too many password attempts. Please wait a few minutes and try again.",
      ),
      429,
    );
  const form = await c.req.parseBody();
  const ok = await verifySecret(
    String(form?.password ?? ""),
    folder.sharePassword,
  );
  if (!ok)
    return c.html(
      passwordPage(theme, `/api/share/folder/${token}/unlock`, true),
      401,
    );
  const sessionToken = crypto.randomUUID().replace(/-/g, "");
  const now = nowSeconds();
  await db
    .insert(schema.guestAccessTokens)
    .values({
      id: crypto.randomUUID(),
      token: sessionToken,
      shareToken: `pwf:${token}`,
      email: "__password__",
      expiresAt: now + 86400,
      createdAt: now,
    })
    .run();
  setCookie(c, pwfCookieName(token), sessionToken, {
    path: `/api/share/folder/${token}`,
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 86400,
  });
  return c.redirect(`/api/share/folder/${token}`, 302);
});
share.get("/folder/:token/:fileId", async (c) => {
  const token = c.req.param("token");
  const fileId = c.req.param("fileId");
  const wantDownload = c.req.query("dl") === "1";
  const db = getDb(c.env.DB);
  const folder = await db
    .select()
    .from(schema.folders)
    .where(eq(schema.folders.shareToken, token))
    .get();
  if (!folder) return c.json({ error: "not found" }, 404);
  const gate = await shareGate(c, db, token, folder);
  if (!gate.ok) return c.json({ error: gate.message }, 403);
  const closed = folderShareClosed(folder);
  if (closed) return c.json({ error: closed.title }, 410);
  if (folder.shareAccessMode === "preview" && wantDownload)
    return c.json({ error: "download disabled for preview-only link" }, 403);
  if (folder.sharePassword && !(await folderPwUnlocked(c, db, folder, token)))
    return c.json({ error: "password required" }, 401);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.id, fileId),
        eq(schema.files.folderId, folder.id),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
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
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run();
    return c.json({ error: "expired" }, 410);
  }
  const meta = await c.env.FILES.head(row.r2Key);
  if (!meta) return c.json({ error: "not found" }, 404);
  const asAttachment = wantDownload || !isInlineSafeType(row.contentType);
  if (wantDownload && !(await consumeDownload(c.env, "folder", folder.id)))
    return c.json({ error: "download limit reached" }, 410);
  if (wantDownload && row.expireAfterDownload)
    await db
      .update(schema.files)
      .set({ expiresAt: nowSeconds() })
      .where(eq(schema.files.id, row.id))
      .run();
  await logShareEvent(c, db, {
    token,
    fileId: row.id,
    folderId: folder.id,
    event: wantDownload ? "download" : "preview",
  });
  return streamShare(c, row.r2Key, row.filename, asAttachment, row.contentType);
});
share.post("/:token/unlock", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.shareToken, token),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row || row.status !== "ready")
    return c.html(
      infoPage(
        theme,
        "Link unavailable",
        "This share link is invalid or has been revoked.",
      ),
      404,
    );
  if (!row.sharePassword) return c.redirect(`/api/share/${token}`, 302);
  const rl = await checkRateLimit(
    c.env.DB,
    `pw:${token}:${clientIp(c)}`,
    10,
    600,
  );
  if (!rl.allowed)
    return c.html(
      infoPage(
        theme,
        "Too many attempts",
        "Too many password attempts. Please wait a few minutes and try again.",
      ),
      429,
    );
  const form = await c.req.parseBody();
  const ok = await verifySecret(
    String(form?.password ?? ""),
    row.sharePassword,
  );
  if (!ok)
    return c.html(passwordPage(theme, `/api/share/${token}/unlock`, true), 401);
  const sessionToken = crypto.randomUUID().replace(/-/g, "");
  const now = nowSeconds();
  await db
    .insert(schema.guestAccessTokens)
    .values({
      id: crypto.randomUUID(),
      token: sessionToken,
      shareToken: `pw:${token}`,
      email: "__password__",
      expiresAt: now + 86400,
      createdAt: now,
    })
    .run();
  setCookie(c, pwCookieName(token), sessionToken, {
    path: `/api/share/${token}`,
    httpOnly: true,
    sameSite: "Lax",
    secure: true,
    maxAge: 86400,
  });
  return c.redirect(`/api/share/${token}`, 302);
});
share.get("/:token/report", async (c) =>
  c.html(
    reportPage(
      await workspaceDefaultTheme(c.env.DB),
      c.req.param("token"),
      c.req.query("done") === "1",
    ),
  ),
);
share.post("/:token/flag", async (c) => {
  const token = c.req.param("token");
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const rl = await checkRateLimit(
    c.env.DB,
    `flag:${token}:${clientIp(c)}`,
    5,
    3600,
  );
  if (!rl.allowed)
    return c.html(
      infoPage(
        theme,
        "Too many reports",
        "You have submitted several reports already. Please wait a while before sending more.",
      ),
      429,
    );
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.shareToken, token),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row || row.status !== "ready")
    return c.html(
      infoPage(
        theme,
        "Link unavailable",
        "This share link is invalid or has been revoked.",
      ),
      404,
    );
  const form = await c.req.parseBody();
  const reason = String(form?.reason ?? "")
    .trim()
    .slice(0, 2000);
  const email =
    String(form?.email ?? "")
      .trim()
      .slice(0, 320) || null;
  if (!reason) return c.html(reportPage(theme, token, false), 400);
  const flagId = crypto.randomUUID();
  await db
    .insert(schema.fileFlags)
    .values({
      id: flagId,
      fileId: row.id,
      token,
      reason,
      reporterEmail: email,
      status: "open",
      createdAt: nowSeconds(),
      resolvedAt: null,
    })
    .run();
  await logShareEvent(c, db, { token, fileId: row.id, event: "flag" });
  await notifyAdmins(c.env, db, {
    type: "file_report",
    title: "New file report",
    message: `${email ?? "Someone"} reported ${row.filename}: ${reason}`,
    targetType: "flag",
    targetId: flagId,
  });
  return c.redirect(`/api/share/${token}/report?done=1`, 303);
});
share.get("/:token", async (c) => {
  const token = c.req.param("token");
  if (!token) return c.json({ error: "not found" }, 404);
  const wantDownload = c.req.query("dl") === "1";
  const wantRaw = c.req.query("raw") === "1";
  const wantsBytes = wantDownload || wantRaw;
  const db = getDb(c.env.DB);
  const theme = await workspaceDefaultTheme(c.env.DB);
  const row = await db
    .select()
    .from(schema.files)
    .where(
      and(
        eq(schema.files.shareToken, token),
        isNull(schema.files.deletedAt),
        isNull(schema.files.purgeRequestedAt),
      ),
    )
    .get();
  if (!row || row.status !== "ready")
    return wantsBytes
      ? c.json({ error: "not found" }, 404)
      : c.html(
          infoPage(
            theme,
            "Link unavailable",
            "This share link is invalid or has been revoked.",
          ),
          404,
        );
  const adminReview = await adminCanReviewReportedFile(c, db, token, row);
  if (!adminReview) {
    const gate = await shareGate(c, db, token, row);
    if (!gate.ok)
      return wantsBytes
        ? c.json({ error: gate.message }, 403)
        : gate.needsEmail
          ? c.html(guestVerificationPage(theme, token, false, false), 401)
          : c.html(accessDeniedPage(theme, gate.message), 403);
  }
  if (row.releaseAt && row.releaseAt > nowSeconds() && !adminReview)
    return wantsBytes
      ? c.json(
          { error: "file is not available yet", releaseAt: row.releaseAt },
          423,
        )
      : c.html(
          infoPage(
            theme,
            "Not available yet",
            `This file becomes available at ${new Date(row.releaseAt * 1000).toISOString()}.`,
          ),
          423,
        );
  if (isExpired(row.expiresAt) && !adminReview) {
    try {
      await c.env.FILES.delete(row.r2Key);
    } catch {}
    await db.delete(schema.files).where(eq(schema.files.id, row.id)).run();
    return wantsBytes
      ? c.json({ error: "expired" }, 410)
      : c.html(
          infoPage(
            theme,
            "Link expired",
            "This file has expired and is no longer available.",
          ),
          410,
        );
  }
  if (!adminReview) {
    const closed = shareClosed(row);
    if (closed)
      return wantsBytes
        ? c.json({ error: closed.title }, 410)
        : c.html(infoPage(theme, closed.title, closed.msg), 410);
    if (row.shareAccessMode === "preview" && wantDownload)
      return c.json({ error: "download disabled for preview-only link" }, 403);
    if (row.sharePassword && !(await pwUnlocked(c, db, row, token)))
      return wantsBytes
        ? c.json({ error: "password required" }, 401)
        : c.html(passwordPage(theme, `/api/share/${token}/unlock`, false), 401);
  }
  if (wantsBytes) {
    const meta = await c.env.FILES.head(row.r2Key);
    if (!meta) return c.json({ error: "not found" }, 404);
    const asAttachment = wantDownload || !isInlineSafeType(row.contentType);
    if (
      wantDownload &&
      !adminReview &&
      !(await consumeDownload(c.env, "file", row.id))
    )
      return c.json({ error: "download limit reached" }, 410);
    if (wantDownload && !adminReview && row.expireAfterDownload)
      await db
        .update(schema.files)
        .set({ expiresAt: nowSeconds() })
        .where(eq(schema.files.id, row.id))
        .run();
    await logShareEvent(c, db, {
      token,
      fileId: row.id,
      event: adminReview
        ? "admin_review"
        : wantDownload
          ? "download"
          : "preview",
    });
    return streamShare(
      c,
      row.r2Key,
      row.filename,
      asAttachment,
      row.contentType,
    );
  }
  await logShareEvent(c, db, {
    token,
    fileId: row.id,
    event: adminReview ? "admin_review" : "view",
  });
  const badges: string[] = [];
  if (adminReview)
    badges.push(`<span class="badge">Admin report review</span>`);
  if (row.shareDownloadLimit != null && !adminReview) {
    const left = Math.max(0, row.shareDownloadLimit - row.shareDownloadCount);
    badges.push(
      `<span class="badge">${left} download${left === 1 ? "" : "s"} left</span>`,
    );
  }
  if (row.shareExpiresAt && !adminReview)
    badges.push(
      `<span class="badge">${esc(humanLeft(row.shareExpiresAt))}</span>`,
    );
  if (row.sharePassword)
    badges.push(
      `<span class="badge">${adminReview ? "Password bypassed" : "\ud83d\udd13 Unlocked"}</span>`,
    );
  if (row.shareAccessMode === "preview" && !adminReview)
    badges.push(`<span class="badge">Preview only</span>`);
  if (row.shareOneTime && !adminReview)
    badges.push(`<span class="badge">One-time</span>`);
  const notesHtml = badges.length
    ? `<div class="badges">${badges.join("")}</div>`
    : "";
  const effExpiry =
    row.shareExpiresAt && row.shareExpiresAt < row.expiresAt
      ? row.shareExpiresAt
      : row.expiresAt;
  const meta = `${fmtBytes(row.sizeBytes)} \u00b7 ${adminReview ? "report investigation" : humanLeft(effExpiry)}`;
  if (row.encryptionMode === "aes-gcm") {
    const scriptNonce = contentSecurityNonce();
    c.header(
      "Content-Security-Policy",
      `default-src 'none'; script-src 'nonce-${scriptNonce}'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; object-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
    );
    return c.html(
      encryptedFilePage(
        theme,
        row.filename,
        meta,
        token,
        row.encryptionNonce,
        row.encryptedMetadata,
        row.shareAccessMode === "preview",
        scriptNonce,
      ),
    );
  }
  if (isImageType(row.contentType) && !row.sharePassword) {
    const embedOn = row.shareEmbed !== false;
    let head = "";
    if (embedOn && !adminReview && row.shareAccessMode !== "disabled") {
      const og = `${c.env.PUBLIC_APP_URL}/api/share/${token}?raw=1`;
      const pageUrl = `${c.env.PUBLIC_APP_URL}/api/share/${token}`;
      head = `<meta property="og:type" content="website"/><meta property="og:site_name" content="Dropvault"/><meta property="og:title" content="${esc(row.filename)}"/><meta property="og:description" content="${esc(`${fmtBytes(row.sizeBytes)} \u00b7 shared image`)}"/><meta property="og:image" content="${esc(og)}"/><meta property="og:url" content="${esc(pageUrl)}"/><meta name="twitter:card" content="summary_large_image"/><meta name="twitter:title" content="${esc(row.filename)}"/><meta name="twitter:image" content="${esc(og)}"/>`;
    }
    return c.html(
      imageFilePage(
        theme,
        row.filename,
        meta,
        token,
        notesHtml,
        row.shareAccessMode === "preview",
        head,
      ),
    );
  }
  if (isVideoType(row.contentType) && !row.sharePassword) {
    const embedOn = row.shareEmbed !== false;
    let head = "";
    if (embedOn && !adminReview && row.shareAccessMode !== "disabled") {
      const raw = `${c.env.PUBLIC_APP_URL}/api/share/${token}?raw=1`;
      const pageUrl = `${c.env.PUBLIC_APP_URL}/api/share/${token}`;
      head = `<meta property="og:type" content="video.other"/><meta property="og:site_name" content="Dropvault"/><meta property="og:title" content="${esc(row.filename)}"/><meta property="og:description" content="${esc(`${fmtBytes(row.sizeBytes)} \u00b7 shared video`)}"/><meta property="og:url" content="${esc(pageUrl)}"/><meta property="og:video" content="${esc(raw)}"/><meta property="og:video:secure_url" content="${esc(raw)}"/><meta property="og:video:type" content="${esc(row.contentType ?? "video/mp4")}"/><meta name="twitter:card" content="player"/>`;
    }
    return c.html(
      videoFilePage(
        theme,
        row.filename,
        meta,
        token,
        notesHtml,
        row.shareAccessMode === "preview",
        row.contentType,
        head,
      ),
    );
  }
  return c.html(filePage(theme, row.filename, meta, token, notesHtml, false));
});

export default share;
