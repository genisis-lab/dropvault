import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { getDb, schema } from "./db"
import type { Bindings } from "./types"

// better-auth must be created per request because D1 is only bound at request time.
export function createAuth(env: Bindings) {
  const db = getDb(env.DB)
  return betterAuth({
    // The auth handler runs on the Worker, so baseURL must be the Worker's own
    // URL (better-auth builds the Google OAuth redirect URI from it). The web app
    // lives on a different origin (Pages), which we allow via trustedOrigins.
    baseURL: env.API_URL,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.PUBLIC_APP_URL],
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
      },
    }),
    // Email + password for simple friend signup...
    emailAndPassword: { enabled: true },
    // ...and Google OAuth. Register the callback URL noted in DEPLOYMENT.md.
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // refresh daily (sliding expiry)
    },
    advanced: {
      // The web app (drop-vault.pages.dev) and the API (dropvault-api.workers.dev)
      // are different sites, so the session cookie must be SameSite=None; Secure
      // to be sent on cross-site requests with credentials.
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
  })
}

export type Auth = ReturnType<typeof createAuth>
