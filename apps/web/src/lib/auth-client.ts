import { createAuthClient } from "better-auth/react"

// In dev, Vite proxies /api to the Worker (same origin). In prod the API lives on
// the Worker; default to it so no build var is required. Override with VITE_API_URL.
const API_BASE =
  import.meta.env.VITE_API_URL ??
  (import.meta.env.PROD
    ? "https://dropvault-api.neil27.workers.dev"
    : window.location.origin)

export const authClient = createAuthClient({
  baseURL: API_BASE,
})

export const { signIn, signUp, signOut, useSession } = authClient
