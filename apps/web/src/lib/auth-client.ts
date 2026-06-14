import { createAuthClient } from "better-auth/react"

// /api is same-origin in both dev (Vite proxy) and prod (Pages proxy), so the
// auth client talks to the current origin. Override with VITE_API_URL if you
// ever point the web app directly at the Worker.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? window.location.origin,
})

export const { signIn, signUp, signOut, useSession } = authClient
