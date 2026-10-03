import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { motion } from "framer-motion";
import {
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Mail,
  User as UserIcon,
} from "lucide-react";
import { authClient, signIn, signUp } from "../lib/auth-client";
import {
  clearTwoFactorPending,
  hasFreshTwoFactorPending,
  markTwoFactorPending,
} from "../lib/two-factor-state";
import { signupApprovalRequired, signupConfirmation } from "../lib/signup";
import Logo from "./Logo";
import Turnstile from "./Turnstile";

const cardInitial = { opacity: 0, y: 16, scale: 0.98 };
const cardAnimate = { opacity: 1, y: 0, scale: 1 };
const siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
// Mirrors emailAndPassword.minPasswordLength in the API's better-auth config.
const MIN_PASSWORD_LENGTH = 10;

function authErrorMessage(res: any, fallback: string) {
  const err = res?.error;
  if (!err) return fallback;
  if (typeof err === "string") return err;
  return err.message || err.statusText || err.code || err.status || fallback;
}

function needsTwoFactor(res: any) {
  const data = res?.data ?? res ?? {};
  const err = res?.error ?? {};
  const code = String(
    err?.code || err?.status || err?.message || "",
  ).toLowerCase();
  return Boolean(
    data.twoFactorRedirect ||
    data.two_factor_redirect ||
    data.twoFactorRequired ||
    code.includes("two_factor") ||
    code.includes("2fa"),
  );
}

export default function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up" | "forgot" | "reset">(() =>
    window.location.pathname.startsWith("/reset-password") ? "reset" : "in",
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [twoFactor, setTwoFactor] = useState(false);
  const [code, setCode] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
  const [useBackup, setUseBackup] = useState(false);
  const verifyInFlight = useRef(false);

  function showTwoFactor() {
    setTwoFactor(true);
    setCode("");
    setUseBackup(false);
    setErrorMsg(null);
  }

  useEffect(() => {
    const handler = () => showTwoFactor();
    window.addEventListener("dropvault:two-factor-required", handler);
    if (hasFreshTwoFactorPending(sessionStorage)) showTwoFactor();
    return () =>
      window.removeEventListener("dropvault:two-factor-required", handler);
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    if (siteKey && !captchaToken) {
      setErrorMsg("Please complete the verification challenge.");
      return;
    }
    setLoading(true);
    if (mode === "in") {
      try {
        clearTwoFactorPending(sessionStorage);
      } catch {}
    }
    let promptedFor2FA = false;
    const authOptions: any = {
      onSuccess(context: any) {
        if (needsTwoFactor(context?.data)) {
          promptedFor2FA = true;
          try {
            markTwoFactorPending(sessionStorage);
          } catch {}
          showTwoFactor();
        }
      },
    };
    if (captchaToken)
      authOptions.fetchOptions = {
        headers: { "x-captcha-response": captchaToken },
      };
    try {
      const res =
        mode === "in"
          ? await (signIn.email as any)({ email, password }, authOptions)
          : await (signUp.email as any)(
              { email, password, name: name || email.split("@")[0] },
              authOptions,
            );
      if (promptedFor2FA || needsTwoFactor(res)) {
        showTwoFactor();
        try {
          markTwoFactorPending(sessionStorage);
        } catch {}
        return;
      }
      if (res?.error)
        setErrorMsg(authErrorMessage(res, "Authentication failed"));
      else if (mode === "up") {
        const signedIn = Boolean(res?.data?.token);
        setStatusMsg(
          signupConfirmation({
            signedIn,
            approvalRequired: signedIn ? null : await signupApprovalRequired(),
          }),
        );
      }
    } catch (err) {
      if (promptedFor2FA) showTwoFactor();
      else
        setErrorMsg(
          err instanceof Error ? err.message : "Something went wrong",
        );
    } finally {
      setLoading(false);
      // Turnstile tokens are single-use; clear and re-render after each attempt.
      if (siteKey) {
        setCaptchaToken(null);
        setResetSignal((n) => n + 1);
      }
    }
  }

  async function submitRecovery(e: FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setStatusMsg(null);
    setLoading(true);
    try {
      if (mode === "forgot") {
        const res = await (authClient as any).requestPasswordReset({
          email,
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (res?.error)
          throw new Error(authErrorMessage(res, "Couldn't send reset email"));
        setStatusMsg(
          "If that account exists, a password-reset link has been sent.",
        );
      } else {
        const token =
          new URLSearchParams(window.location.search).get("token") || "";
        if (!token) throw new Error("This reset link is missing its token.");
        const res = await (authClient as any).resetPassword({
          newPassword: password,
          token,
        });
        if (res?.error)
          throw new Error(authErrorMessage(res, "Couldn't reset password"));
        setStatusMsg("Password reset. You can sign in now.");
        setMode("in");
        window.history.replaceState({}, "", "/");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Recovery failed");
    } finally {
      setLoading(false);
    }
  }

  async function verifyTwoFactor(e: FormEvent) {
    e.preventDefault();
    if (verifyInFlight.current) return;
    verifyInFlight.current = true;
    setErrorMsg(null);
    setLoading(true);
    try {
      const api = (authClient as any).twoFactor;
      const res = useBackup
        ? await api.verifyBackupCode({
            code: code.trim(),
            disableSession: false,
            trustDevice,
          })
        : await api.verifyTotp({ code: code.trim(), trustDevice });
      if (res?.error) {
        const code = String(
          res.error.code || res.error.status || res.error.message || "",
        ).toUpperCase();
        if (code.includes("INVALID_TWO_FACTOR_COOKIE")) {
          try {
            clearTwoFactorPending(sessionStorage);
          } catch {}
          setTwoFactor(false);
          setCode("");
          setErrorMsg(
            "Your two-factor sign-in expired. Enter your password and try again.",
          );
        } else {
          setErrorMsg(authErrorMessage(res, "Invalid verification code"));
        }
      } else {
        try {
          clearTwoFactorPending(sessionStorage);
        } catch {}
        window.location.reload();
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : "Invalid verification code",
      );
    } finally {
      verifyInFlight.current = false;
      setLoading(false);
    }
  }

  async function google() {
    setErrorMsg(null);
    await signIn.social({
      provider: "google",
      callbackURL: window.location.origin,
    });
  }

  if (twoFactor) {
    return (
      <div className="grid min-h-screen place-items-center bg-app px-4 py-8">
        <motion.div
          initial={cardInitial}
          animate={cardAnimate}
          className="w-full max-w-md rounded-[28px] bg-sheet p-8 sm:p-10"
        >
          <Logo size={28} />
          <div className="mt-6 flex items-center gap-2.5">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-drift-50 text-drift-700">
              <KeyRound size={18} />
            </div>
            <div>
              <h1 className="text-[28px] font-normal leading-9 text-strong">
                Two-factor code
              </h1>
              <p className="text-sm text-slate-500">
                Enter your authenticator code to finish signing in.
              </p>
            </div>
          </div>
          <form onSubmit={verifyTwoFactor} className="mt-6 space-y-3">
            <Field icon={<KeyRound size={16} />}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder={useBackup ? "Backup code" : "6-digit code"}
                inputMode={useBackup ? "text" : "numeric"}
                autoComplete="one-time-code"
                autoFocus
                className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
              />
            </Field>
            <label className="flex items-center gap-2 text-sm text-slate-500">
              <input
                type="checkbox"
                checked={trustDevice}
                onChange={(e) => setTrustDevice(e.target.checked)}
                className="rounded border-slate-300"
              />{" "}
              Trust this device for 30 days
            </label>
            {errorMsg && (
              <p role="alert" className="text-sm text-red-700">
                {errorMsg}
              </p>
            )}
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="btn-filled w-full disabled:opacity-60"
            >
              {loading ? "Verifying…" : "Verify and sign in"}
            </button>
          </form>
          <div className="mt-4 flex items-center justify-between text-sm">
            <button
              onClick={() => {
                setUseBackup((v) => !v);
                setCode("");
                setErrorMsg(null);
              }}
              className="font-medium text-primary hover:underline"
            >
              {useBackup ? "Use authenticator code" : "Use backup code"}
            </button>
            <button
              onClick={() => {
                setTwoFactor(false);
                setCode("");
                setErrorMsg(null);
                try {
                  clearTwoFactorPending(sessionStorage);
                } catch {}
              }}
              className="text-slate-500 hover:text-slate-700"
            >
              Back
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (mode === "forgot" || mode === "reset") {
    return (
      <div className="grid min-h-screen place-items-center bg-app px-4 py-8">
        <motion.div
          initial={cardInitial}
          animate={cardAnimate}
          className="w-full max-w-md rounded-[28px] bg-sheet p-8 sm:p-10"
        >
          <Logo size={28} />
          <h1 className="mt-6 text-[28px] font-normal leading-9 text-strong">
            {mode === "forgot"
              ? "Reset your password"
              : "Choose a new password"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "forgot"
              ? "We'll send a secure, expiring reset link."
              : `Use at least ${MIN_PASSWORD_LENGTH} characters.`}
          </p>
          <form onSubmit={submitRecovery} className="mt-6 space-y-3">
            {mode === "forgot" ? (
              <Field icon={<Mail size={16} />}>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  aria-label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Email"
                  className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
                />
              </Field>
            ) : (
              <Field icon={<Lock size={16} />}>
                <input
                  type="password"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  autoComplete="new-password"
                  aria-label="New password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="New password"
                  className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
                />
              </Field>
            )}
            {errorMsg && (
              <p role="alert" className="text-sm text-red-700">
                {errorMsg}
              </p>
            )}
            {statusMsg && (
              <p role="status" className="text-sm text-emerald-700">
                {statusMsg}
              </p>
            )}
            <button
              disabled={loading}
              className="btn-filled w-full disabled:opacity-60"
            >
              {loading
                ? "Please wait…"
                : mode === "forgot"
                  ? "Send reset link"
                  : "Reset password"}
            </button>
          </form>
          <button
            onClick={() => {
              setMode("in");
              setErrorMsg(null);
              setStatusMsg(null);
            }}
            className="mt-4 w-full text-sm font-medium text-primary hover:underline"
          >
            Back to sign in
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen place-items-center bg-app px-4 py-8">
      <motion.div
        initial={cardInitial}
        animate={cardAnimate}
        className="w-full max-w-md rounded-[28px] bg-sheet p-8 sm:p-10"
      >
        <Logo size={28} />
        <h1 className="mt-6 text-[28px] font-normal leading-9 text-strong">
          {mode === "in" ? "Welcome back" : "Create your account"}
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          Your files, shared with friends — and gone when they should be.
        </p>
        <button
          onClick={google}
          className="btn-outlined mt-6 w-full !text-strong"
        >
          <GoogleMark /> Continue with Google
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-slate-400">
          <span className="h-px flex-1 bg-slate-200" /> or{" "}
          <span className="h-px flex-1 bg-slate-200" />
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === "up" && (
            <Field icon={<UserIcon size={16} />}>
              <input
                autoComplete="name"
                aria-label="Name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name"
                className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
              />
            </Field>
          )}
          <Field icon={<Mail size={16} />}>
            <input
              type="email"
              required
              autoComplete="email"
              aria-label="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
            />
          </Field>
          <Field icon={<Lock size={16} />}>
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={mode === "up" ? MIN_PASSWORD_LENGTH : undefined}
              autoComplete={mode === "up" ? "new-password" : "current-password"}
              aria-label="Password"
              aria-describedby={mode === "up" ? "password-hint" : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-transparent outline-none placeholder:text-muted focus-visible:!outline-none"
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="-my-1 shrink-0 rounded-md p-1 text-slate-400 transition hover:text-slate-600"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </Field>
          {mode === "up" && (
            <p id="password-hint" className="-mt-1 text-xs text-slate-500">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
          {siteKey && (
            <div className="pt-1">
              <Turnstile
                siteKey={siteKey}
                onToken={setCaptchaToken}
                onExpire={() => setCaptchaToken(null)}
                resetSignal={resetSignal}
              />
            </div>
          )}
          {errorMsg && (
            <p role="alert" className="text-sm text-red-700">
              {errorMsg}
            </p>
          )}
          {statusMsg && (
            <p role="status" className="text-sm text-emerald-700">
              {statusMsg}
            </p>
          )}
          <button
            type="submit"
            disabled={loading || (Boolean(siteKey) && !captchaToken)}
            className="btn-filled w-full disabled:opacity-60"
          >
            {loading
              ? "Please wait…"
              : mode === "in"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>
        {mode === "in" && (
          <button
            onClick={() => {
              setMode("forgot");
              setErrorMsg(null);
              setStatusMsg(null);
            }}
            className="mt-3 w-full text-center text-sm font-medium text-primary hover:underline"
          >
            Forgot password?
          </button>
        )}
        <p className="mt-5 text-center text-sm text-slate-500">
          {mode === "in" ? "New here?" : "Already have an account?"}{" "}
          <button
            onClick={() => {
              setMode(mode === "in" ? "up" : "in");
              setErrorMsg(null);
              setStatusMsg(null);
            }}
            className="font-medium text-primary hover:underline"
          >
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </motion.div>
    </div>
  );
}

function Field({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-14 items-center gap-3 rounded border border-outline bg-transparent px-4 text-strong transition focus-within:border-primary focus-within:[box-shadow:inset_0_0_0_1px_rgb(var(--c-primary))]">
      <span className="text-muted">{icon}</span>
      {children}
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.6 2.4 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.3 13.2 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.1 5.4-4.6 7l7.1 5.5c4.2-3.9 6.8-9.6 6.8-16z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.3c-.5-1.5-.8-3-.8-4.6s.3-3.1.8-4.6l-7.9-6.1C1 16.1 0 19.9 0 23.7s1 7.6 2.6 10.7l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 47.5c6.2 0 11.4-2 15.2-5.5l-7.1-5.5c-2 1.3-4.6 2.1-8.1 2.1-6.3 0-11.7-3.7-13.5-9.3l-7.9 6.1C6.5 42.1 14.6 47.5 24 47.5z"
      />
    </svg>
  );
}
