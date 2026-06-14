# 🚀 Dropvault — Deployment Guide

This is the complete, do-it-once setup to get Dropvault live on Cloudflare with automatic deploys from GitHub.

There are **two deploy targets**:

| Part | Lives on | How it deploys |
|------|----------|----------------|
| Web app (`apps/web`) | Cloudflare **Pages** | Auto-deploys via the Pages ↔ GitHub integration |
| API (`apps/api`) | Cloudflare **Workers** | Auto-deploys via the GitHub Actions workflow in this repo |

Once set up, you never run `wrangler` locally — every `git push` redeploys.

---

## 0. Prerequisites

- A Cloudflare account (free tier is fine).
- This repo on GitHub (you're here).
- Everything below can be done from the **Cloudflare dashboard** + **GitHub web UI** — no local CLI required.

---

## 1. Create the Cloudflare resources

### R2 bucket (file storage)
Cloudflare dashboard → **R2** → **Create bucket** → name it **`dropvault-files`**.

### D1 database (metadata + auth)
Dashboard → **Workers & Pages** → **D1** → **Create database** → name it **`dropvault`**.
Copy the **Database ID** it shows you.

### R2 S3 API token (for presigned uploads/downloads)
Dashboard → **R2** → **Manage R2 API Tokens** → **Create API token** (Object Read & Write).
Save the **Access Key ID** and **Secret Access Key** — these become Worker secrets below.

---

## 2. Fill in `apps/api/wrangler.toml`

Edit these placeholders and commit:

```toml
[[d1_databases]]
binding = "DB"
database_name = "dropvault"
database_id = "PASTE_YOUR_D1_DATABASE_ID_HERE"   # from step 1
migrations_dir = "migrations"

[vars]
PUBLIC_APP_URL = "https://dropvault.pages.dev"   # your Pages URL (set after step 5)
R2_ACCOUNT_ID = "PASTE_YOUR_CLOUDFLARE_ACCOUNT_ID_HERE"  # Dashboard → right sidebar → Account ID
R2_BUCKET_NAME = "dropvault-files"
DEFAULT_EXPIRY_DAYS = "2"
MAX_EXPIRY_DAYS = "30"
```

---

## 3. Create a Cloudflare API token (for GitHub Actions)

Dashboard → **My Profile** → **API Tokens** → **Create Token** → use the **“Edit Cloudflare Workers”** template.
Make sure it includes permissions for **Workers Scripts: Edit**, **D1: Edit**, and **Workers R2 Storage: Edit**.
Copy the generated token.

Also grab your **Account ID** (Dashboard → right sidebar).

---

## 4. Add GitHub repo secrets

Repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add:

| Secret name | Value |
|-------------|-------|
| `CLOUDFLARE_API_TOKEN` | the token from step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | your Cloudflare Account ID |

---

## 5. Deploy the web app to Cloudflare Pages

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

## 6. The API deploy workflow

This repo already has `.github/workflows/deploy-api.yml`. **Replace its entire contents with the block below** (copy it straight from this file on GitHub — do **not** retype the `$ secrets.* ` parts, just copy):

```yaml
name: Deploy API Worker

# Auto-deploys the Cloudflare Worker (apps/api) whenever its code changes on main.
# The web app (apps/web) is deployed separately by the Cloudflare Pages Git integration.
on:
  push:
    branches: [main]
    paths:
      - "apps/api/**"
      - ".github/workflows/deploy-api.yml"
  workflow_dispatch: {}

jobs:
  deploy:
    runs-on: ubuntu-latest
    env:
      CLOUDFLARE_API_TOKEN: $ secrets.CLOUDFLARE_API_TOKEN 
      CLOUDFLARE_ACCOUNT_ID: $ secrets.CLOUDFLARE_ACCOUNT_ID 
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 9

      - name: Setup Node
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install

      # Applies any new D1 migrations to the remote DB before deploying.
      # Safe to re-run: already-applied migrations are skipped.
      - name: Apply D1 migrations
        working-directory: apps/api
        run: pnpm exec wrangler d1 migrations apply dropvault --remote

      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          workingDirectory: apps/api
          command: deploy
```

> The Cloudflare credentials are set once as job-level `env`. `wrangler-action` and Wrangler automatically read `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment, so no per-step inputs are needed.

---

## 7. Set the Worker's runtime secrets

These are the app's *runtime* secrets (kept out of CI on purpose). Set them on the Worker after its first deploy:

Dashboard → **Workers & Pages** → **dropvault-api** → **Settings** → **Variables and Secrets** → add each as an **encrypted** secret:

| Secret | What it is |
|--------|-----------|
| `BETTER_AUTH_SECRET` | any long random string (e.g. `openssl rand -base64 32`) |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret |
| `R2_ACCESS_KEY_ID` | R2 S3 access key (step 1) |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret key (step 1) |

---

## 8. Google OAuth

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → **Web application**.

Add this **Authorized redirect URI**:

```
https://dropvault.pages.dev/api/auth/callback/google
```

(For local dev also add `http://localhost:8787/api/auth/callback/google`.)

Put the client ID/secret into the Worker secrets from step 7.

---

## 9. (Optional) R2 lifecycle backstop

R2 → **dropvault-files** → **Settings** → **Object lifecycle rules** → add a rule to delete objects 30 days after creation. This is a final safety net behind the on-access expiry check and the hourly Cron sweep.

---

## ✅ After setup: how deploys work

- **Push code under `apps/api/**`** → GitHub Actions runs `deploy-api.yml` → migrations applied + Worker deployed. (Or trigger manually: **Actions → Deploy API Worker → Run workflow**.)
- **Push anything** → Cloudflare Pages rebuilds and redeploys the web app.
- You never touch a local CLI again. 🎉

## Troubleshooting

- **Actions deploy fails with an auth error** → check the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets exist and the token has Workers + D1 + R2 edit permissions.
- **`command not found: wrangler` locally** → you don't need it; CI handles deploys. If you *want* it locally, use `pnpm exec wrangler ...` from `apps/api` (it's a dev dependency).
- **Login/upload works but downloads 410** → that file expired; the on-access check deletes expired files by design.
