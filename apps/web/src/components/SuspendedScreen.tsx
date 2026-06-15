import { motion } from "framer-motion"
import { ShieldAlert } from "lucide-react"
import { signOut } from "../lib/auth-client"
import Logo from "./Logo"

const cardInitial = { opacity: 0, y: 16, scale: 0.98 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }

export default function SuspendedScreen({ email, reason }: { email: string; reason: string | null }) {
  async function leave() {
    try {
      await signOut()
    } finally {
      if (typeof window !== "undefined") window.location.reload()
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <motion.div
        initial={cardInitial}
        animate={cardAnimate}
        className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-8 text-center drive-shadow-lg"
      >
        <Logo size={28} />
        <div className="mx-auto mt-6 grid h-16 w-16 place-items-center rounded-2xl bg-red-50 text-red-500">
          <ShieldAlert size={30} />
        </div>
        <h1 className="mt-5 text-2xl font-bold text-slate-800">Your account is suspended</h1>
        <p className="mt-2 text-sm text-slate-500">
          Access for <span className="font-medium text-slate-700">{email}</span> has been suspended by an administrator. You can't upload, share, or manage files while your account is suspended.
        </p>
        {reason && (
          <div className="mt-4 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-left text-sm text-red-700">
            <span className="font-semibold">Reason:</span> {reason}
          </div>
        )}
        <p className="mt-4 text-sm text-slate-500">
          If you think this is a mistake, contact your workspace administrator.
        </p>
        <button
          onClick={leave}
          className="mt-6 w-full rounded-xl bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500 py-2.5 font-semibold text-white shadow-lg shadow-glow-500/25 transition hover:opacity-95"
        >
          Sign out
        </button>
      </motion.div>
    </div>
  )
}
