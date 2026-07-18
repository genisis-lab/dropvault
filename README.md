# 🌬️ Dropvault

A mini Google Drive that **auto-expires** your files. Upload anything, organize it into folders, share with friends, and let it disappear after a couple of days — or keep it up to 30 (or forever, if your account allows). Built entirely on Cloudflare.

> The name is a default — rename freely (see **Renaming** below). Other ideas from planning: Ephemera, Vanish, Dropvault, Tempbin, Fadefile.

---

## ✨ Features

### Accounts & access

- **Auth your friends will actually use** — email + password _or_ one-click Google sign-in (better-auth). Anyone can self-register; no manual allow-listing.
- **Two-factor authentication (2FA)** — optional TOTP-based 2FA with an enrollment flow and a required-on-login challenge.
- **Account & security settings** — manage your password, 2FA, and active sessions; revoke other sessions remotely.

### Uploads

- **Cloudflare-native uploads** — the browser streams to the API Worker, which writes to R2 through its bucket binding with a live progress bar.
- **Multipart uploads for large files** — big files are split into parts and uploaded in chunks, so multi-GB uploads are reliable and resumable across parts.
- **Robust multi-file uploads** — bounded-concurrency upload pool with automatic retry (exponential backoff + jitter), permanent-vs-transient error detection, per-file error surfacing, and one-click “Retry failed.” Designed so large batches (30+ files) don’t partially fail.
- **Folder uploads** — drag in whole directories; the folder tree is traversed and preserved.
- **Auto-generated thumbnails** — image thumbnails are generated client-side at upload (small JPEG, ~400px) so grids and lists never download full-size originals just to render a preview. Falls back gracefully to the original (or a type icon) when no thumbnail exists.

### Files & organization

- **Folders** — create folders, move files between them, and browse per-folder views.
- **Infinite scroll** — My Drive renders files in windows and loads more on scroll, so large libraries stay fast and light.
- **Search, sort & filters** — filter by type, sort, and search your library instantly.
- **Tags & favorites** — tag files and star favorites for quick access.
- **Trash & restore** — deleted files go to Trash where they can be restored or permanently deleted.
- **Version history** — keep and browse previous versions of a file.
- **Inline preview** — preview images and PDFs in-app with secure inline headers.
- **Storage breakdown** — see how your storage is used by file type.

### Sharing

- **Shareable links** — generate a public link for any file.
- **Link controls** — optional password protection, link expiry dates, and download-count limits. Revoke a link anytime.
- **Folder share links** — share an entire folder via a link.
- **Public upload requests** — request files from others via a public upload portal, no account required for the uploader.

### Expiration

- **Expiration as defense-in-depth:**
  1. **On-access check** — an expired file is never served (returns `410` and is deleted on the spot).
  2. **Hourly Cron sweep** — a scheduled Worker reclaims expired objects from R2 + rows from D1.
  3. **R2 lifecycle rule** — a 30-day bucket rule as a final backstop.
- **Per-file expiry** — choose 1 / 2 / 7 / 14 / 30 days at upload, extend later (clamped to 30 days total).
- **Keep forever** — eligible accounts can mark files to never expire.

### Caching & performance

- **Browser caching with revalidation** — thumbnails and inline previews are served with `Cache-Control` + `ETag`/`304` revalidation, so reloads serve from the browser cache instead of re-hammering the server. Private files use private (non-shared) caching to keep auth intact.

### Admin & moderation

- **Admin panel** — admins (configured via `ADMIN_EMAILS`) can manage users and content.
- **User suspension** and **keep-forever permission grants** for individual users.
- **IP access controls** — IP observation/logging and IP banning for abuse mitigation.

### UI

- **Polished UI** — React + Tailwind, Framer Motion animations, a subtle react-three-fiber 3D backdrop, animated upload progress, live expiry countdowns, notifications, and a responsive mobile-friendly layout.

---

## 🏗️ Architecture

```
Browser (React SPA, Cloudflare Pages)
  │  1. POST /api/files/presign           ── Worker creates a "pending" row, returns upload URL
  │  2. PUT /api/files/:id/upload          ── Worker streams the file into R2
  │     (or multipart: create → upload parts → complete, for large files)
  │  3. POST /api/files/:id/complete       ── Worker marks row "ready"
  │  4. PUT /api/files/:id/thumbnail        ── browser-generated image thumbnail → R2
  │  5. GET /api/files                     ── list live files
  │  6. GET /api/files/:id/inline          ── cached inline preview (ETag/304)
  │  7. GET /api/files/:id/thumbnail        ── cached thumbnail (ETag/304)
  │  8. GET /api/files/:id/download        ── on-access expiry check → stream from R2
  ▼
Worker API (Hono, Cloudflare Workers)
  ├── better-auth  →  D1 (user/session/account/verification + 2FA)
  ├── files & folders metadata →  D1
  ├── upload/download/thumbnails →  R2 bucket binding
  ├── sharing, upload requests, teams, notifications, admin → D1
  └── scheduled()   →  hourly sweep of expired files
```

**Monorepo layout** (pnpm workspace):

```
dropvault/
├── apps/
│   ├── api/        # Cloudflare Worker (Hono + better-auth + Drizzle + R2)
│   └── web/        # React + Vite SPA (Cloudflare Pages)
├── package.json
└── pnpm-workspace.yaml
```

**Stack:** React + Vite + TypeScript + Tailwind · Framer Motion · @react-three/fiber + drei · TanStack Query · lucide-react · Hono · better-auth · Drizzle ORM · Cloudflare Workers / Pages / D1 / R2.

---

## 🚀 Setup

### Prerequisites

- Node 22.13+ and the pinned pnpm version (`npm i -g pnpm@11.13.1`)
- A Cloudflare account
- `wrangler` CLI (`pnpm i -g wrangler`) and `wrangler login`

### 1. Install

```bash
pnpm install
```

### 2. Create Cloudflare resources

```bash
# From apps/api
cd apps/api

# R2 bucket for the files
wrangler r2 bucket create dropvault-files

# D1 database for metadata + auth tables
wrangler d1 create dropvault
# copy the returned database_id into wrangler.jsonc
```

Then open `apps/api/wrangler.jsonc` and fill in:

- `database_id` (from the step above)
- `PUBLIC_APP_URL` (your Pages URL, e.g. `https://dropvault.pages.dev`)
- `ADMIN_EMAILS` (comma-separated list of admin accounts, optional)

### 3. Apply the database schema

```bash
# still in apps/api
wrangler d1 migrations apply dropvault --remote   # production
wrangler d1 migrations apply dropvault --local    # local dev
```

### 4. Set secrets

```bash
# from apps/api
wrangler secret put BETTER_AUTH_SECRET       # any long random string (openssl rand -base64 32)
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
# Optional abuse protection + delivery adapter
wrangler secret put TURNSTILE_SECRET_KEY
wrangler secret put NOTIFICATION_WEBHOOK_URL
wrangler secret put NOTIFICATION_WEBHOOK_SECRET
```

Set `VITE_TURNSTILE_SITE_KEY` in the web build environment when the Worker Turnstile secret is enabled. Optional malware scanning uses a Worker service binding named `SCANNER`; see [DEPLOYMENT.md](DEPLOYMENT.md) for the expected setup.

### 5. Google OAuth

In the [Google Cloud Console](https://console.cloud.google.com/apis/credentials) create an OAuth 2.0 Client (type: Web application) and add this **Authorized redirect URI**:

```
https://<your-app>.pages.dev/api/auth/callback/google
```

(For local dev also add `http://localhost:8787/api/auth/callback/google`.)

### 6. R2 lifecycle backstop (optional but recommended)

In **R2 → dropvault-files → Settings → Object lifecycle rules**, add a rule to delete objects 30 days after creation.

---

## 🧑‍💻 Local development

```bash
# Terminal 1 — API (Worker)
cd apps/api
pnpm dev            # wrangler dev -> http://127.0.0.1:8787

# Terminal 2 — Web (Vite)
cd apps/web
pnpm dev            # http://localhost:5173 (proxies /api to the Worker)
```

Run the complete verification suite:

```bash
pnpm verify
pnpm test:e2e
pnpm audit:prod
```

---

## 📦 Deploy

```bash
# API -> Workers
cd apps/api
pnpm deploy         # wrangler deploy (registers the hourly Cron Trigger too)

# Web -> Pages
cd apps/web
pnpm build
wrangler pages deploy dist --project-name dropvault
```

Or connect this GitHub repo to Cloudflare Pages for automatic deploys on every push (build command `pnpm build`, output `apps/web/dist`).

> **Note:** Some features ship across both stacks. Thumbnails, caching, and inline previews require the **API Worker** redeploy (for the routes) _and_ the **web** redeploy (for the UI). Features touching the schema (2FA, keep-forever, IP observations, etc.) require running the D1 migrations.

---

## ✏️ Renaming from "Dropvault"

Name references live in: `package.json` files, `apps/api/wrangler.jsonc` (worker name, bucket, D1, Pages project), `apps/web/src/components/Logo.tsx`, `apps/web/index.html`, and this README. A find-and-replace on `dropvault` / `Dropvault` covers it.

---

## 🔐 Notes & trade-offs

- **On-access deletion** means even if the sweep is delayed, no one can ever download an expired file.
- Uploads and downloads use the Worker R2 binding, so no separate R2 S3 credentials are needed. Large files use R2 multipart uploads through the Worker.
- Files are namespaced by user (`r2Key = <userId>/<uuid>`), and every API route enforces ownership.
- **Thumbnails are generated client-side**, not in the Worker — resizing large (e.g. 12MB) images server-side would exceed Worker CPU limits, and Cloudflare Image Resizing isn’t available on `workers.dev`.
- **Private files are never cached in a shared/edge cache** keyed by a guessable URL (that would bypass auth). Caching relies on `Cache-Control: private` + the browser cache + `ETag`/`304` revalidation.
- My Drive uses **client-side windowing (infinite scroll)** rather than server-side pagination, because search, sort, storage totals, and the type breakdown currently assume the full file list. True server-side cursor pagination is a possible future enhancement once those move server-side.
