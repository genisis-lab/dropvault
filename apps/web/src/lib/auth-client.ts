import { createAuthClient } from "better-auth/react"

// In dev, Vite proxies /api to the Worker; in prod the API lives at the same origin
// (or set VITE_API_URL to your Worker URL).
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? window.location.origin,
})

export const { signIn, signUp, signOut, useSession } = authClient
