import { motion } from "framer-motion";
import { Clock3, ShieldAlert } from "lucide-react";
import { signOut } from "../lib/auth-client";
import Logo from "./Logo";

const cardInitial = { opacity: 0, y: 16, scale: 0.98 };
const cardAnimate = { opacity: 1, y: 0, scale: 1 };

export default function SuspendedScreen({
  email,
  reason,
}: {
  email: string;
  reason: string | null;
}) {
  const awaitingApproval = reason === "Awaiting admin approval";

  async function leave() {
    try {
      await signOut();
    } finally {
      if (typeof window !== "undefined") window.location.reload();
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-app px-4 py-8">
      <motion.div
        initial={cardInitial}
        animate={cardAnimate}
        className="w-full max-w-md rounded-[28px] bg-sheet p-8 text-center sm:p-10"
      >
        <Logo size={28} />
        <div
          className={`mx-auto mt-6 grid h-16 w-16 place-items-center rounded-full ${
            awaitingApproval
              ? "bg-drift-50 text-drift-700"
              : "bg-red-50 text-red-700"
          }`}
        >
          {awaitingApproval ? <Clock3 size={30} /> : <ShieldAlert size={30} />}
        </div>
        <h1 className="mt-5 text-2xl font-normal text-strong">
          {awaitingApproval
            ? "Your account is awaiting approval"
            : "Your account is suspended"}
        </h1>
        {awaitingApproval ? (
          <>
            <p className="mt-2 text-sm text-slate-500">
              Thanks for signing up with{" "}
              <span className="font-medium text-slate-700">{email}</span>. An
              administrator has been notified and will review your account.
            </p>
            <p className="mt-4 text-sm text-slate-500">
              We'll email you as soon as your profile is approved. You can sign
              out now and come back after that message arrives.
            </p>
          </>
        ) : (
          <p className="mt-2 text-sm text-slate-500">
            Access for <span className="font-medium text-slate-700">{email}</span>{" "}
            has been suspended by an administrator. You can't upload, share, or
            manage files while your account is suspended.
          </p>
        )}
        {reason && !awaitingApproval && (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-red-700">
            <span className="font-semibold">Reason:</span> {reason}
          </div>
        )}
        {!awaitingApproval && (
          <p className="mt-4 text-sm text-slate-500">
            If you think this is a mistake, contact your workspace administrator.
          </p>
        )}
        <button
          onClick={leave}
          className="btn-filled mt-6 w-full"
        >
          Sign out
        </button>
      </motion.div>
    </div>
  );
}
