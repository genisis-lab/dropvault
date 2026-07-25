import { betterAuth } from "better-auth";
import { waitUntil } from "cloudflare:workers";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha, twoFactor } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { adminEmailSet } from "./middleware/admin";
import { deliverPendingEvents, enqueueEvent } from "./lib/delivery";
import {
  canonicalAppOrigin,
  trustedAppOrigins,
} from "./lib/origins";
import type { Bindings } from "./types";

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

// Reads the configured signup mode from app_settings. "open" (default) lets
// anyone sign up immediately; "approval" creates the account but parks it as a
// suspended/pending user until an admin approves it.
async function getSignupMode(db: ReturnType<typeof getDb>): Promise<string> {
  const row = await db
    .select()
    .from(schema.appSettings)
    .where(eq(schema.appSettings.key, "signupMode"))
    .get()
    .catch(() => null);
  return row?.value === "approval" ? "approval" : "open";
}

// Best-effort webhook fired when a new account is created, if enabled.
async function notifySignup(
  env: Bindings,
  db: ReturnType<typeof getDb>,
  userId: string,
  email: string,
) {
  try {
    const rows = await db
      .select()
      .from(schema.appSettings)
      .all()
      .catch(() => []);
    const map = new Map(rows.map((r) => [r.key, r.value] as const));
    if (map.get("notifyOnSignup") !== "true") return;
    await enqueueEvent(db, {
      type: "signup",
      userId,
      payload: { email, at: nowSec() },
    });
    waitUntil(deliverPendingEvents(env, 5));
  } catch {}
}

// better-auth must be created per request because D1 is only bound at request time.
export function createAuth(env: Bindings) {
  const db = getDb(env.DB);
  const canonicalOrigin = canonicalAppOrigin(env);
  const queueAuthMessage = (
    type: string,
    user: { id?: string; email: string; name?: string },
    url: string,
  ) => {
    waitUntil(
      (async () => {
        await enqueueEvent(db, {
          type,
          userId: user.id ?? null,
          payload: { email: user.email, name: user.name ?? null, url },
        });
        await deliverPendingEvents(env, 5);
      })(),
    );
  };
  // Cloudflare Turnstile guards the email sign-in/sign-up endpoints. The plugin
  // reads the `x-captcha-response` header and verifies it server-side. It is
  // only enabled when a secret is configured, so local dev still works without
  // a key (and Google OAuth is never gated by it).
  const plugins = [
    twoFactor({
      issuer: "Dropvault",
      allowPasswordless: true,
    }),
    ...(env.TURNSTILE_SECRET_KEY
      ? [
          captcha({
            provider: "cloudflare-turnstile",
            secretKey: env.TURNSTILE_SECRET_KEY,
          }),
        ]
      : []),
  ];
  return betterAuth({
    appName: "Dropvault",
    // The web app proxies /api/* to this Worker (see functions/api/[[path]].ts),
    // so from the browser everything is same-origin on PUBLIC_APP_URL. Using it
    // as baseURL keeps the Google OAuth callback and the session cookie
    // first-party to the web app domain, which works in every browser.
    baseURL: canonicalOrigin,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: trustedAppOrigins(env),
    advanced: {
      // Trust only Cloudflare's canonical single-value client header for auth
      // rate limiting/session telemetry. X-Forwarded-For is client-spoofable
      // when the Worker origin is called directly.
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: new URL(canonicalOrigin).protocol === "https:",
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        twoFactor: schema.twoFactor,
      },
    }),
    // Email + password for simple friend signup...
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: !!env.NOTIFICATION_WEBHOOK_URL,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) =>
        queueAuthMessage("password_reset", user, url),
      onPasswordReset: async ({ user }) => {
        await enqueueEvent(db, {
          type: "password_reset_complete",
          userId: user.id,
          payload: { email: user.email },
        });
      },
    },
    emailVerification: {
      sendOnSignUp: !!env.NOTIFICATION_WEBHOOK_URL,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async ({ user, url }) =>
        queueAuthMessage("verify_email", user, url),
    },
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
    // When approval-gated signups are enabled, newly created non-admin accounts
    // are immediately parked as suspended ("Awaiting admin approval"). They keep
    // a valid session but requireAuth blocks every action until an admin
    // approves them. Bootstrap admins (ADMIN_EMAILS) are never gated. This hook
    // only runs on user creation, so existing users are unaffected.
    databaseHooks: {
      user: {
        create: {
          after: async (createdUser: any) => {
            try {
              const email = String(createdUser?.email ?? "").toLowerCase();
              const id = String(createdUser?.id ?? "");
              if (!id) return;
              const mode = await getSignupMode(db);
              const isBootstrapAdmin = adminEmailSet(env).has(email);
              if (mode === "approval" && !isBootstrapAdmin) {
                await db
                  .insert(schema.userSuspensions)
                  .values({
                    userId: id,
                    reason: "Awaiting admin approval",
                    createdBy: "system",
                    createdAt: nowSec(),
                  })
                  .run()
                  .catch(() => {});
              }
              await notifySignup(env, db, id, email);
            } catch {}
          },
        },
      },
    },
    plugins,
  });
}

export type Auth = ReturnType<typeof createAuth>;
