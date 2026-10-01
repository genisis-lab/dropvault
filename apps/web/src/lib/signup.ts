const API = import.meta.env.VITE_API_URL ?? "";

// Whether new accounts wait for an administrator. Null when unknown, so the
// sign-up screen never claims a review that is not going to happen.
export async function signupApprovalRequired(): Promise<boolean | null> {
  try {
    const res = await fetch(`${API}/api/signup-policy`, {
      credentials: "include",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { approvalRequired?: unknown };
    return typeof body.approvalRequired === "boolean"
      ? body.approvalRequired
      : null;
  } catch {
    return null;
  }
}

// What to tell someone right after sign-up. When better-auth returns no
// session token the account is waiting on email verification; otherwise the
// user is already signed in and the app takes over.
export function signupConfirmation(options: {
  signedIn: boolean;
  approvalRequired: boolean | null;
}): string | null {
  if (options.signedIn) return null;
  const verify =
    "Account created. Check your inbox and open the verification link to finish signing up.";
  return options.approvalRequired
    ? `${verify} An administrator will then review your access request.`
    : verify;
}
