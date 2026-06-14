// Cloudflare bindings + env vars available on the Worker.
export type Bindings = {
  DB: D1Database
  FILES: R2Bucket
  // vars
  API_URL: string
  PUBLIC_APP_URL: string
  DEFAULT_EXPIRY_DAYS: string
  MAX_EXPIRY_DAYS: string
  // secrets
  BETTER_AUTH_SECRET: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

// Per-request variables set by middleware.
export type Variables = {
  userId: string
  userEmail: string
}
