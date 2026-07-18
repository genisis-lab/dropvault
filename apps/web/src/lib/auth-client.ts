import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";

// /api is same-origin in both dev (Vite proxy) and prod (Pages proxy), so the
// auth client talks to the current origin. Override with VITE_API_URL if you
// ever point the web app directly at the Worker.
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_API_URL ?? window.location.origin,
  plugins: [
    twoFactorClient({
      onTwoFactorRedirect() {
        try {
          sessionStorage.setItem("dropvault:two-factor-required", "1");
          window.dispatchEvent(
            new CustomEvent("dropvault:two-factor-required"),
          );
        } catch {}
      },
    }),
  ],
});

export const { signIn, signUp, signOut, useSession } = authClient;
