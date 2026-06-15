// Cloudflare bindings + env vars available on the Worker.
export type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  // vars
  API_URL: string
  PUBLIC_APP_URL: string
  DEFAULT_EXPIRY_DAYS: string
  MAX_EXPIRY_DAYS: string
  // Comma/space-separated list of admin emails (see wrangler.toml [vars]).
  ADMIN_EMAILS: string
  // secrets
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  // Cloudflare Turnstile secret key. Optional: when set, the email login/signup
  // endpoints require a valid Turnstile token. Set via `wrangler secret put`.
  TURNSTILE_SECRET_KEY?: string
}

// Per-request variables set by middleware.
export type Variables = {
  userId: string
  userEmail: string
}
