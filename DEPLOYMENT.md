# 🚀 Dropvault — Deployment Guide

The complete, do-it-once setup to get Dropvault live on Cloudflare with **automatic deploys from GitHub**. Everything here is done in the **Cloudflare dashboard** + **GitHub web UI** — no local CLI, no API tokens, no secrets pasted into GitHub.

Dropvault runs as two Cloudflare services, both built and deployed from this repo on every push:

| Part | URL | Lives on | How it deploys |
|------|-----|----------|----------------|
| Web app (`apps/web`) | `https://drop-vault.pages.dev` | Cloudflare **Pages** | Pages ↔ GitHub integration |
| API (`apps/api`) | `https://dropvault-api.neil27.workers.dev` | Cloudflare **Workers** | **Workers Builds** ↔ GitHub integration |

### Same-origin via the Pages proxy

The browser only ever talks to the **Pages** origin. A Pages Function at `functions/api/[[path]].ts` reverse-proxies every `/api/*` request to the API Worker. This keeps the session cookie **first-party** (`SameSite=Lax`), so login works in every browser — no cross-site cookie issues between `*.pages.dev` and `*.workers.dev`. Accordingly, better-auth's `baseURL` is the **Pages** URL (`PUBLIC_APP_URL`), and the frontend calls `/api` on its own origin (no `VITE_API_URL` needed).

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
API_URL = "https://dropvault-api.neil27.workers.dev"   # Worker URL (Pages proxy target)
PUBLIC_APP_URL = "https://drop-vault.pages.dev"        # Pages URL (better-auth baseURL + CORS)
R2_ACCOUNT_ID = "3ece4993f323ece88322161931be6e72"
R2_BUCKET_NAME = "dropvault-files"
```

> If either URL changes (e.g. you add a custom domain), update both the proxy target in `functions/api/[[path]].ts` and these vars, then redeploy.

---

## 3. Deploy the web app to Cloudflare Pages

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick **`Dropvault`**.

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `pnpm build` |
| Build output directory | `apps/web/dist` |
| Root directory | *(leave blank — repo root)* |

The `functions/` directory at the repo root is picked up automatically and proxies `/api/*` to the Worker, so **no `VITE_API_URL` build variable is required**.

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

Because the browser talks to the Pages origin (and the proxy forwards to the Worker), the redirect URI uses the **Pages** URL:

```
https://drop-vault.pages.dev/api/auth/callback/google
```

(For local dev also add `http://localhost:5173/api/auth/callback/google`.)

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
- **Push under `apps/web/**` or `functions/**`** → Pages rebuilds and redeploys the web app + proxy.
- No local CLI, no API tokens, no GitHub secrets. Just `git push`.

## Troubleshooting

- **Sign in succeeds, then bounces back to the sign-in page** → the session cookie isn't first-party. Confirm the Pages proxy deployed (`functions/api/[[path]].ts`), that `better-auth` `baseURL` is the Pages URL, and that the Google redirect URI is the Pages URL.
- **Upload PUT returns 403 `SignatureDoesNotMatch`** → fixed in code (R2 checksums disabled); make sure the Worker redeployed.
- **API calls return HTML / JSON parse errors** → the Pages proxy isn't catching `/api/*`; confirm `functions/api/[[path]].ts` exists at the repo root and Pages redeployed.
- **`command not found: wrangler` locally** → you don't need it; Cloudflare handles deploys. Locally use `pnpm exec wrangler ...` from `apps/api`.
