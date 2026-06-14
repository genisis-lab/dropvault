# 🚀 Dropvault — Deployment Guide

The complete, do-it-once setup to get Dropvault live on Cloudflare with **automatic deploys from GitHub**. Everything here is done in the **Cloudflare dashboard** + **GitHub web UI** — no local CLI, no API tokens, no secrets pasted into GitHub.

There are **two deploy targets**, and Cloudflare builds and deploys *both* directly from this repo on every push:

| Part | Lives on | How it deploys |
|------|----------|----------------|
| Web app (`apps/web`) | Cloudflare **Pages** | Pages ↔ GitHub integration |
| API (`apps/api`) | Cloudflare **Workers** | **Workers Builds** ↔ GitHub integration |

Because Cloudflare pulls and deploys the code itself, you don't need a Cloudflare API token or any GitHub Actions secrets. Once connected, every `git push` redeploys. 🎉

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
Copy the **Database ID** it shows you.

### R2 S3 API token (for presigned uploads/downloads)
Dashboard → **R2** → **Manage R2 API Tokens** → **Create API token** (Object Read & Write).
Save the **Access Key ID** and **Secret Access Key** — these become Worker secrets in step 5.

---

## 2. Fill in `apps/api/wrangler.toml`

Edit these placeholders and commit (you can edit directly in the GitHub web UI):

```toml
[[d1_databases]]
binding = "DB"
database_name = "dropvault"
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"   # from step 1
migrations_dir = "migrations"

[vars]
PUBLIC_APP_URL = "https://dropvault.pages.dev"          # your Pages URL (set after step 3)
R2_ACCOUNT_ID = "PASTE_YOUR_CLOUDFLARE_ACCOUNT_ID_HERE" # Dashboard → right sidebar → Account ID
R2_BUCKET_NAME = "dropvault-files"
DEFAULT_EXPIRY_DAYS = "2"
MAX_EXPIRY_DAYS = "30"
```

---

## 3. Deploy the web app to Cloudflare Pages

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick **`Dropvault`**.

Build settings:

| Setting | Value |
|---------|-------|
| Framework preset | None |
| Build command | `pnpm build` |
| Build output directory | `apps/web/dist` |
| Root directory | *(leave blank — repo root)* |

Save & deploy → you get `https://dropvault.pages.dev`. Put that URL into `PUBLIC_APP_URL` in `wrangler.toml` (step 2) and commit.

---

## 4. Deploy the API with Workers Builds (Git integration)

This replaces any GitHub Actions workflow — Cloudflare builds and deploys the Worker itself.

1. Dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository** (Connect to Git) → pick **`Dropvault`**.
2. Configure the build:

| Setting | Value |
|---------|-------|
| Git branch | `main` |
| **Root directory** | `apps/api` |
| Build command | *(leave blank — dependencies install automatically)* |
| **Deploy command** | `npx wrangler d1 migrations apply dropvault --remote && npx wrangler deploy` |

> The root directory points Cloudflare at `apps/api`, where `wrangler.toml` lives. The deploy command applies any new D1 migrations first, then deploys. (Migrations are idempotent — already-applied ones are skipped.)

3. Save. Cloudflare creates the **`dropvault-api`** Worker and deploys it. Every future push that changes `apps/api/**` triggers a redeploy automatically.

> **Optional — limit builds:** in the Worker's **Settings → Builds → Build watch paths**, set the include path to `apps/api/*` so web-only commits don't trigger an API build.

---

## 5. Set the Worker's runtime secrets

These are the app's *runtime* secrets. Set them on the Worker (Dashboard → **Workers & Pages** → **dropvault-api** → **Settings** → **Variables and Secrets** → add each as an **encrypted** secret):

| Secret | What it is |
|--------|-----------|
| `BETTER_AUTH_SECRET` | any long random string (e.g. `openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `R2_ACCESS_KEY_ID` | R2 S3 access key (step 1) |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret key (step 1) |

After adding secrets, redeploy once (push any commit, or **Deployments → Retry** on the Worker).

---

## 6. Google OAuth

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → **Web application**.

Add this **Authorized redirect URI**:

```
https://dropvault.pages.dev/api/auth/callback/google
```

(For local dev also add `http://localhost:8787/api/auth/callback/google`.)

Put the client ID/secret into the Worker secrets from step 5.

---

## 7. (Optional) R2 lifecycle backstop

R2 → **dropvault-files** → **Settings** → **Object lifecycle rules** → add a rule to delete objects 30 days after creation. A final safety net behind the on-access expiry check and the hourly Cron sweep.

---

## 8. Remove the old Actions workflow

This repo contains `.github/workflows/deploy-api.yml` from an earlier approach. With Workers Builds handling deploys, **it's no longer needed** — delete it (GitHub web UI → open the file → trash icon → commit) so it doesn't run or show failed checks. No GitHub Actions secrets or Cloudflare API token are required anymore.

---

## ✅ After setup: how deploys work

- **Push under `apps/api/**`** → Workers Builds runs migrations + deploys the Worker.
- **Push under `apps/web/**`** → Pages rebuilds and redeploys the web app.
- No local CLI, no API tokens, no GitHub secrets. Just `git push`.

## Troubleshooting

- **Worker build fails on install** → confirm **Root directory** is `apps/api`. pnpm resolves the workspace from there automatically.
- **`No account id found`** → not applicable with Workers Builds (Cloudflare runs inside your account); if you ever deploy from a local CLI instead, run `npx wrangler login` first.
- **`command not found: wrangler` locally** → you don't need it; Cloudflare handles deploys. If you want it locally, use `pnpm exec wrangler ...` from `apps/api` (it's a dev dependency).
- **Login/upload works but downloads return 410** → that file expired; the on-access check deletes expired files by design.
