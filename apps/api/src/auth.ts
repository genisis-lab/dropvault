import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"
import { getDb, schema } from "./db"
import type { Bindings } from "./types"

// better-auth must be created per request because D1 is only bound at request time.
export function createAuth(env: Bindings) {
  const db = getDb(env.DB)
  return betterAuth({
    // The web app proxies /api/* to this Worker (see functions/api/[[path]].ts),
    // so from the browser everything is same-origin on PUBLIC_APP_URL. Using it
    // as baseURL keeps the Google OAuth callback and the session cookie
    // first-party to the web app domain, which works in every browser.
    baseURL: env.PUBLIC_APP_URL,
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
  })
}

export type Auth = ReturnType<typeof createAuth>
