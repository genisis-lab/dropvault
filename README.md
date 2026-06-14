# 🌬️ Dropvault

A mini Google Drive that **auto-expires** your files. Upload anything, share with friends, and let it disappear after a couple of days — or keep it up to 30. Built entirely on Cloudflare.

> The name is a default — rename freely (see **Renaming** below). Other ideas from planning: Ephemera, Vanish, Dropvault, Tempbin, Fadefile.

---

## ✨ Features

- **Auth your friends will actually use** — email + password *or* one-click Google sign-in (better-auth). Anyone can self-register; no manual allow-listing.
- **Cloudflare-native uploads** — the browser streams to the API Worker, which writes to R2 through its bucket binding with a live progress bar.
- **Expiration as defense-in-depth:**
  1. **On-access check** — an expired file is never served (returns `410` and is deleted on the spot).
  2. **Hourly Cron sweep** — a scheduled Worker reclaims expired objects from R2 + rows from D1.
  3. **R2 lifecycle rule** — a 30-day bucket rule as a final backstop.
- **Per-file expiry** — choose 1 / 2 / 7 / 14 / 30 days at upload, extend later (clamped to 30 days total).
- **Polished UI** — React + Tailwind, Framer Motion animations, a subtle react-three-fiber 3D backdrop, animated upload progress and live expiry countdowns.

---

## 🏗️ Architecture

```
Browser (React SPA, Cloudflare Pages)
  │  1. POST /api/files/presign           ── Worker creates a "pending" row, returns upload URL
  │  2. PUT /api/files/:id/upload          ── Worker streams the file into R2
  │  3. POST /api/files/:id/complete       ── Worker marks row "ready"
  │  4. GET /api/files                     ── list live files
  │  5. GET /api/files/:id/download        ── on-access expiry check → stream from R2
  ▼
Worker API (Hono, Cloudflare Workers)
  ├── better-auth  →  D1 (user/session/account/verification)
  ├── files metadata →  D1 (files)
  ├── upload/download →  R2 bucket binding
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

- Node 18+ and `pnpm` (`npm i -g pnpm`)
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
# copy the returned database_id into wrangler.toml (REPLACE_WITH_YOUR_D1_DATABASE_ID)
```

Then open `apps/api/wrangler.toml` and fill in:
- `database_id` (from the step above)
- `PUBLIC_APP_URL` (your Pages URL, e.g. `https://dropvault.pages.dev`)

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
```

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

Run the expiry unit tests:

```bash
cd apps/api && pnpm test
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

---

## ✏️ Renaming from "Dropvault"

Name references live in: `package.json` files, `apps/api/wrangler.toml` (worker name, bucket, D1, Pages project), `apps/web/src/components/Logo.tsx`, `apps/web/index.html`, and this README. A find-and-replace on `dropvault` / `Dropvault` covers it.

---

## 🔐 Notes & trade-offs

- **On-access deletion** means even if the sweep is delayed, no one can ever download an expired file.
- Uploads and downloads use the Worker R2 binding, so no separate R2 S3 credentials are needed.
- Files are namespaced by user (`r2Key = <userId>/<uuid>`), and every API route enforces ownership.
- For very large files you'd later want multipart uploads or a presigned/direct-upload path; Worker-mediated uploads keep the current app simple and avoid separate S3 credentials.
