# 🚀 Dropvault — Deployment Guide

The complete setup for deploying Dropvault on Cloudflare, either from the CLI or with automatic GitHub builds.

Dropvault runs as two Cloudflare services, both built and deployed from this repo on every push:

| Part                 | URL                                        | Lives on               | How it deploys                          |
| -------------------- | ------------------------------------------ | ---------------------- | --------------------------------------- |
| Web app (`apps/web`) | `https://drop-vault.pages.dev`             | Cloudflare **Pages**   | Pages ↔ GitHub integration              |
| API (`apps/api`)     | `https://dropvault-api.neil27.workers.dev` | Cloudflare **Workers** | **Workers Builds** ↔ GitHub integration |

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
Copy the **Database ID** and paste it into `database_id` in `apps/api/wrangler.jsonc`.

---

## 2. Confirm `apps/api/wrangler.jsonc`

These values are already committed — just confirm they match your account:

```jsonc
{
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "dropvault-files" }],
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dropvault",
      "database_id": "<your-database-id>",
      "migrations_dir": "migrations",
    },
  ],
  "vars": {
    "API_URL": "https://<your-worker>.workers.dev",
    "PUBLIC_APP_URL": "https://<your-app>.pages.dev",
    "ADMIN_EMAILS": "admin@example.com",
  },
}
```

> If either URL changes (e.g. you add a custom domain), update both the proxy target in `functions/api/[[path]].ts` and these vars, then redeploy.

---

## 3. Deploy the web app to Cloudflare Pages

Dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick **`Dropvault`**.

| Setting                | Value                       |
| ---------------------- | --------------------------- |
| Framework preset       | None                        |
| Build command          | `pnpm build`                |
| Build output directory | `apps/web/dist`             |
| Root directory         | _(leave blank — repo root)_ |

The `functions/` directory at the repo root is picked up automatically and proxies `/api/*` to the Worker, so **no `VITE_API_URL` build variable is required**.

Save & deploy → `https://drop-vault.pages.dev`.

---

## 4. Deploy the API with Workers Builds (Git integration)

1. Dashboard → **Workers & Pages** → **Create** → **Workers** → **Import a repository** → pick **`Dropvault`**.
2. Configure the build:

| Setting            | Value                                   |
| ------------------ | --------------------------------------- |
| Git branch         | `main`                                  |
| **Root directory** | `apps/api`                              |
| Build command      | _(leave blank)_                         |
| **Deploy command** | `pnpm db:migrate:remote && pnpm deploy` |

3. Save. Cloudflare creates the **`dropvault-api`** Worker and deploys it. Every push that changes `apps/api/**` redeploys automatically.

---

## 5. Set the Worker's runtime secrets

Dashboard → **Workers & Pages** → **dropvault-api** → **Settings** → **Variables and Secrets** → add each as an **encrypted** secret:

| Secret                        | What it is                                                |
| ----------------------------- | --------------------------------------------------------- |
| `BETTER_AUTH_SECRET`          | any long random string (e.g. `openssl rand -base64 32`)   |
| `GOOGLE_CLIENT_ID`            | Google OAuth client ID                                    |
| `GOOGLE_CLIENT_SECRET`        | Google OAuth client secret                                |
| `TURNSTILE_SECRET_KEY`        | optional; required when Turnstile protection is enabled   |
| `NOTIFICATION_WEBHOOK_URL`    | optional HTTPS endpoint used by the email/webhook adapter |
| `NOTIFICATION_WEBHOOK_SECRET` | optional signing secret for notification deliveries       |

The R2 binding handles all object operations, including multipart uploads. No R2 S3 credentials are required.

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

## 7. Optional protection and integrations

Set `VITE_TURNSTILE_SITE_KEY` in the Pages build environment and `TURNSTILE_SECRET_KEY` on the Worker to protect sign-up and public upload forms. Configure both or neither.

`NOTIFICATION_WEBHOOK_URL` receives signed JSON events for verification emails, password resets, guest codes, expiry warnings, downloads, and upload activity. The receiving service can send email, post to chat, or forward the event elsewhere. It should verify the `x-dropvault-signature` header with `NOTIFICATION_WEBHOOK_SECRET`.

For malware scanning, deploy a scanner Worker and add this service binding to `apps/api/wrangler.jsonc`:

```jsonc
"services": [{ "binding": "SCANNER", "service": "dropvault-scanner" }]
```

The service receives a request describing the uploaded R2 object and must return JSON containing a clean/infected verdict. Files remain quarantined until a clean verdict is recorded.

## 8. (Optional) R2 lifecycle backstop

R2 → **dropvault-files** → **Settings** → **Object lifecycle rules** → delete objects 30 days after creation. A final safety net behind the on-access expiry check and the hourly Cron sweep.

---

## ✅ After setup

- **Push under `apps/api/**`\*\* → Workers Builds runs migrations + deploys the Worker.
- **Push under `apps/web/**`or`functions/**`** → Pages rebuilds and redeploys the web app + proxy.
- Run the production migrations before deploying any Worker build that changes the schema.

## Troubleshooting

- **Sign in succeeds, then bounces back to the sign-in page** → the session cookie isn't first-party. Confirm the Pages proxy deployed (`functions/api/[[path]].ts`), that `better-auth` `baseURL` is the Pages URL, and that the Google redirect URI is the Pages URL.
- **Uploads remain quarantined** → confirm the optional `SCANNER` service binding exists and that its response reports a clean verdict.
- **API calls return HTML / JSON parse errors** → the Pages proxy isn't catching `/api/*`; confirm `functions/api/[[path]].ts` exists at the repo root and Pages redeployed.
- **`command not found: wrangler` locally** → use the repository-pinned CLI through `pnpm --filter @dropvault/api exec wrangler ...`.
