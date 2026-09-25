# 🚀 Dropvault — Deployment Guide

The complete setup for deploying Dropvault on Cloudflare, either from the CLI or with automatic GitHub builds.

Dropvault runs as two Cloudflare services, both built and deployed from this repo on every push:

| Part                 | URL                                        | Lives on               | How it deploys                          |
| -------------------- | ------------------------------------------ | ---------------------- | --------------------------------------- |
| Web app (`apps/web`) | `https://drive.builtwai.com`                | Cloudflare **Pages**   | Pages ↔ GitHub integration              |
| API (`apps/api`)     | `https://dropvault-api.neil27.workers.dev` | Cloudflare **Workers** | **Workers Builds** ↔ GitHub integration |

### Same-origin via the Pages proxy

The browser only ever talks to the web app's **Pages/custom-domain** origin. A Pages Function at `functions/api/[[path]].ts` reverse-proxies every `/api/*` request to the API Worker. This keeps the session cookie **first-party** (`SameSite=Lax`), so login works in every browser — no cross-site cookie issues between the web origin and `*.workers.dev`. Accordingly, better-auth's `baseURL` is the canonical web URL (`PUBLIC_APP_URL`), exact aliases are listed in `TRUSTED_ORIGINS`, and the frontend calls `/api` on its own origin (no `VITE_API_URL` needed).

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
    "PUBLIC_APP_URL": "https://drive.builtwai.com",
    "TRUSTED_ORIGINS": "https://drive.builtwai.com,https://drop-vault.pages.dev",
    "ADMIN_EMAILS": "admin@example.com",
  },
}
```

> `PUBLIC_APP_URL` is the canonical origin used for auth callbacks and generated links. Keep only exact `http://` or `https://` origins in `TRUSTED_ORIGINS`; do not use wildcards. The proxy target changes only when the API Worker URL changes.

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
| `RESEND_API_KEY`              | Resend API key for verification and account email         |
| `TURNSTILE_SECRET_KEY`        | optional; required when Turnstile protection is enabled   |
| `NOTIFICATION_WEBHOOK_URL`    | optional HTTPS endpoint used by the email/webhook adapter |
| `NOTIFICATION_WEBHOOK_SECRET` | optional signing secret for notification deliveries       |

The R2 binding handles all object operations, including multipart uploads. No R2 S3 credentials are required.

`RESEND_FROM_EMAIL` is committed as `Dropvault <verification@contact.builtwai.com>`, matching the existing verified Resend subdomain and account-mail sender. Resend handles email verification, password reset, guest codes, and approval notifications directly; `NOTIFICATION_WEBHOOK_URL` remains available for other integrations and as a legacy email fallback.

After adding secrets, redeploy once (push any commit, or **Deployments → Retry**).

---

## 6. Google OAuth

[Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **Create Credentials** → **OAuth client ID** → **Web application**.

Because the browser talks to the custom domain (and the proxy forwards to the Worker), the redirect URI uses the canonical custom-domain URL:

```
https://drive.builtwai.com/api/auth/callback/google
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

- **Invalid origin** → add the exact browser origin to `TRUSTED_ORIGINS`, keep the preferred origin in `PUBLIC_APP_URL`, and redeploy the API Worker.
- **Sign in succeeds, then bounces back to the sign-in page** → the session cookie isn't first-party. Confirm the Pages proxy deployed (`functions/api/[[path]].ts`), that `better-auth` `baseURL` is the canonical web URL, and that the Google redirect URI uses the same canonical origin.
- **Uploads remain quarantined** → confirm the optional `SCANNER` service binding exists and that its response reports a clean verdict.
- **API calls return HTML / JSON parse errors** → the Pages proxy isn't catching `/api/*`; confirm `functions/api/[[path]].ts` exists at the repo root and Pages redeployed.
- **`command not found: wrangler` locally** → use the repository-pinned CLI through `pnpm --filter @dropvault/api exec wrangler ...`.

## Upload experience and operations rollout (migration 0018)

Apply `0018_operations.sql` before deploying the API, then deploy the frontend.
Pushing the feature branch does not apply production migrations or deploy the API.

1. Run `pnpm db:migrate:remote` with the intended Cloudflare account selected.
2. Run `pnpm deploy:api` and confirm `/api/health` returns healthy dependencies.
3. Build/deploy the web app through the existing Pages pipeline.
4. As an owner, open **Admin → Operations**. Confirm the first hourly Cron run
   populates expiration-sweep, orphan-scan, metadata-retention, and notification-delivery.
5. Exercise a small upload, cancellation, and a supported video preview on a real
   iPhone. Browser automation does not reproduce Apple's native Photos picker.

User changes: collapsed upload options with an active-settings summary; a persistent
upload tray with preparation/transfer/finalization states and cancellation; video
playback and gallery navigation; unsupported-format fallbacks; selected-file expiry
extension with partial failures retained. Originals are not transcoded by these changes.
In-browser AES-GCM preparation cannot be interrupted mid-operation, but cancellation
prevents subsequent upload. Finalization cannot be cancelled. Navigating away or
closing the tab is not a supported background-upload mechanism.

Operational behavior:

- Authenticated client diagnostics retain coarse browser/OS, upload stage, size,
  duration, and outcome for 30 days. No filename, contents, raw user agent, or error
  message is collected. This is best-effort telemetry, not authoritative billing;
  closed tabs and failures before file delivery can be absent.
- Owner/admin/auditor can read Operations. Owners alone change thresholds,
  acknowledge alerts, and execute reviewed orphan cleanup. Moderators have no access.
- Alerts are evaluated hourly and displayed in Operations. They deduplicate by
  condition and resolve after recovery. Acknowledgment does not suppress the
  condition. This release adds in-app operational alerts, not a new email channel.
- Storage growth compares ready-file bytes against an approximately daily baseline;
  it is not Cloudflare's billed storage, which also includes versions and thumbnails.
- Scheduled orphan reconciliation is now **read-only** and samples the first 500
  objects. Owners page through reconciliation in Operations to inspect the rest.
  Objects younger than 24 hours, existing originals, versions, and their thumbnails
  are protected. Cleanup rechecks references and age and writes an audit intent
  before deleting each object. Failed lookups abort cleanup rather than implying absence.
- Missing-file and orphan scans return page-specific results; they do not claim a
  complete inventory until every page is inspected. Scans can reflect concurrent
  uploads/deletions. Missing objects are reported, never automatically recreated.
- Expiration/Trash cleanup remains automatic. Storage deletion failures now preserve
  database records and mark the run failed. Active multipart-session metadata is
  retained for cleanup rather than discarded without aborting storage parts.
- Policy impact is an advisory snapshot. Existing revision/owner confirmations remain
  required. Retention changes do not rewrite existing expiry timestamps; changing
  public-sharing policy does not revoke existing links.

Rollback: revert the application deployment; keep the additive migration in place.
Do not drop operational tables while the new API or Cron code is still running.
