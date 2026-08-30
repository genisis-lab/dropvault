// Cloudflare bindings + env vars available on the Worker. Keep this narrow
// application type in sync with the generated worker-configuration.d.ts.
export type Bindings = {
  DB: D1Database;
  FILES: R2Bucket;
  UPLOAD_EVENTS: Queue<import("./lib/uploadEvents").UploadCompleteMessage>;
  // Optional antivirus/content scanner service binding.
  SCANNER?: Fetcher;
  // vars
  API_URL: string;
  PUBLIC_APP_URL: string;
  TRUSTED_ORIGINS?: string;
  DEFAULT_EXPIRY_DAYS: string;
  MAX_EXPIRY_DAYS: string;
  // Comma/space-separated list of admin emails (see wrangler.jsonc vars).
  ADMIN_EMAILS: string;
  // secrets
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  // Resend sends account email from the verified contact.builtwai.com subdomain.
  RESEND_API_KEY?: string;
  RESEND_FROM_EMAIL?: string;
  // Cloudflare Turnstile secret key. Optional: when set, the email login/signup
  // endpoints require a valid Turnstile token. Set via `wrangler secret put`.
  TURNSTILE_SECRET_KEY?: string;
  // Optional delivery endpoint. Guest verification codes and notification
  // events are POSTed here when configured; retries are persisted in D1.
  NOTIFICATION_WEBHOOK_URL?: string;
  // Optional HMAC secret used to sign notification webhook requests.
  NOTIFICATION_WEBHOOK_SECRET?: string;
  // High-entropy secret used only to wrap per-file account recovery keys and
  // authenticate duress credentials. Set with `wrangler secret put`.
  VAULT_KEY_SECRET?: string;
  // Version identifier for VAULT_KEY_SECRET. Keep the previous pair configured
  // during rotations so existing envelopes remain recoverable.
  VAULT_KEY_ID?: string;
  VAULT_KEY_PREVIOUS_ID?: string;
  VAULT_KEY_SECRET_PREVIOUS?: string;
};

// Per-request variables set by middleware.
export type Variables = {
  userId: string;
  userEmail: string;
};
