/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string
  // Cloudflare Turnstile site key. When set, the login screen shows a Turnstile
  // challenge and sends its token with email sign-in/sign-up requests.
  readonly VITE_TURNSTILE_SITE_KEY?: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
