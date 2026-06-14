# 🚀 Dropvault — Deployment Guide

The complete, do-it-once setup to get Dropvault live on Cloudflare with **automatic deploys from GitHub**. Everything here is done in the **Cloudflare dashboard** + **GitHub web UI** — no local CLI, no API tokens, no secrets pasted into GitHub.

Dropvault has **two origins**, and Cloudflare builds and deploys *both* directly from this repo on every push:

| Part | URL | Lives on | How it deploys |
|------|-----|----------|----------------|
| Web app (`apps/web`) | `https://drop-vault.pages.dev` | Cloudflare **Pages** | Pages ↔ GitHub integration |
| API (`apps/api`) | `https://dropvault-api.neil27.workers.dev` | Cloudflare **Workers** | **Workers Builds** ↔ GitHub integration |

The web app and API are on different origins, so the code is configured for cross-origin auth: better-auth's `baseURL` is the **Worker** URL (`API_URL`), the Pages origin is allowed via `trustedOrigins`/CORS (`PUBLIC_APP_URL`), and the session cookie is `SameSite=None; Secure`. Both URLs are already filled into `apps/api/wrangler.toml`.

---

## 0. Prerequisites

- A Cloudflare account (free tier is fine).
- This repo on GitHub (you're here).

---

## 1. Create the Cloudflare resources

### R2 bucket (file storage)
Cloudflare dashboard → **R2** → **Create bucket** → name it **`dropvault-files`**.

### D1 database (metadata + auth)
Dashboard → **Workers & Pages** → **D1 SQL Database** → **Create** → name it **`dropvault`**.
Copy the **Database ID** and paste it into `database_id` in `apps/api/wrangler.toml`.

### R2 S3 API token (for presigned uploads/downloads)
Dashboard → **R2** → **Manage R2 API Tokens** (account level, not inside a bucket) → **Create API token** (Object Read & Write, scoped to `dropvault-files`).
Save the **Access Key ID** and **Secret Access Key** — these become the `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` Worker secrets in step 5.

---

## 2. Confirm `apps/api/wrangler.toml`

These values are already committed — just confirm they match your account:

```toml
[[d1_databases]]
database_id = "b72b57d4-bbb9-4810-a006-251d9aed1955"   # your D1 ID

[vars]
API_URL = "https://dropvault-api.neil27.workers.dev"   # the Worker's own URL (better-auth baseURL)
PUBLIC_APP_URL = "https://drop-vault.pages.dev"        # the Pages URL (CORS + trustedOrigins)
R2_ACCOUNT_ID = "3ece4993f323ece88322161931be6e72"
R2_BUCKET_NAME = "dropvault-files"
```

> `API_URL` and `PUBLIC_APP_URL` must be the **exact** live URLs. If either changes (e.g. you add a custom domain), update them here and redeploy.

---

## 3. Deploy the web app to Cloudflare Pages

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick **`Dropvault`**.

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `pnpm build` |
| Build output directory | `apps/web/dist` |
| Root directory | *(leave blank — repo root)* |

The frontend already defaults to the Worker URL in production, so **no `VITE_API_URL` build variable is required**. (If you ever move the API, set `VITE_API_URL` in Pages → Settings → Variables to override.)

Save & deploy → `https://drop-vault.pages.dev`.

---

## 4. Deploy the API with Workers Builds (Git integration)

1. Dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository** → pick **`Dropvault`**.
2. Configure the build:

| Setting | Value |
|---------|-------|
| Git branch | `main` |
| **Root directory** | `apps/api` |
| Build command | *(leave blank)* |
| **Deploy command** | `npx wrangler d1 migrations apply dropvault --remote && npx wrangler deploy` |

3. Save. Cloudflare creates the **`dropvault-api`** Worker and deploys it. Every push that changes `apps/api/**` redeploys automatically.

---

## 5. Set the Worker's runtime secrets

Dashboard → **Workers & Pages** → **dropvault-api** → **Settings** → **Variables and Secrets** → add each as an **encrypted** secret:

| Secret | What it is |
|--------|-----------|
| `BETTER_AUTH_SECRET` | any long random string (e.g. `openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `R2_ACCESS_KEY_ID` | R2 S3 access key (step 1) |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret key (step 1) |

After adding secrets, redeploy once (push any commit, or **Deployments → Retry**).

---

## 6. Google OAuth

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → **Web application**.

The OAuth handler runs on the **Worker**, so the redirect URI uses the Worker URL (not the Pages URL):

```
https://dropvault-api.neil27.workers.dev/api/auth/callback/google
```

(For local dev also add `http://localhost:8787/api/auth/callback/google`.)

Put the client ID/secret into the Worker secrets from step 5.

---

## 7. (Optional) R2 lifecycle backstop

R2 → **dropvault-files** → **Settings** → **Object lifecycle rules** → delete objects 30 days after creation. A final safety net behind the on-access expiry check and the hourly Cron sweep.

---

## 8. Remove the old Actions workflow

This repo still contains `.github/workflows/deploy-api.yml` from an earlier approach. With Workers Builds handling deploys it's **no longer needed** — delete it (GitHub web UI → open the file → trash icon → commit) so it doesn't run or show failed checks.

---

## ✅ After setup

- **Push under `apps/api/**`** → Workers Builds runs migrations + deploys the Worker.
- **Push under `apps/web/**`** → Pages rebuilds and redeploys the web app.
- No local CLI, no API tokens, no GitHub secrets. Just `git push`.

## Note on cross-site cookies

Because `drop-vault.pages.dev` and `dropvault-api.neil27.workers.dev` are different sites, login relies on a `SameSite=None; Secure` cookie. This works in Chrome/Firefox today. Safari (and Chrome's third-party-cookie phase-out) can block cross-site cookies on public domains like `*.pages.dev`/`*.workers.dev`. The bulletproof fix is to put both behind one registrable domain (e.g. `app.yourdomain.com` for Pages and `api.yourdomain.com` for the Worker) and enable cross-subdomain cookies, **or** serve the web app and API from a single origin. Ask if you want help setting either up.

## Troubleshooting

- **Upload PUT returns 403 `SignatureDoesNotMatch`** → fixed in code (R2 checksums disabled); make sure the Worker redeployed.
- **Login succeeds but you're logged right back out** → cross-site cookie blocked by the browser; see the note above.
- **API calls return HTML / JSON parse errors** → the frontend is hitting the Pages origin instead of the Worker; confirm the prod build picked up the Worker URL (or set `VITE_API_URL`).
- **`command not found: wrangler` locally** → you don't need it; Cloudflare handles deploys. Locally use `pnpm exec wrangler ...` from `apps/api`.
