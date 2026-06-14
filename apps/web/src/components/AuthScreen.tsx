import { useState } from "react"
import { motion } from "framer-motion"
import { Mail, Lock, User as UserIcon } from "lucide-react"
import { signIn, signUp } from "../lib/auth-client"
import Logo from "./Logo"

const cardInitial = { opacity: 0, y: 24, scale: 0.97 }
const cardAnimate = { opacity: 1, y: 0, scale: 1 }
const cardTransition = { type: "spring" as const, stiffness: 120, damping: 16 }

export default function AuthScreen() {
  const [mode, setMode] = useState<"in" | "up">("in")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === "in") {
        await signIn.email({ email, password })
      } else {
        await signUp.email({ email, password, name })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-screen place-items-center px-4">
      <motion.div
        initial={cardInitial}
        animate={cardAnimate}
        transition={cardTransition}
        className="glass w-full max-w-md rounded-3xl p-8 shadow-2xl shadow-black/40"
      >
        <Logo size={28} />
        <div className="mt-6 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/50">
          <span className="h-1.5 w-1.5 rounded-full bg-gradient-to-r from-drift-400 to-blush-400" />
          Files that drift away
        </div>
        <h1 className="mt-3 text-2xl font-bold">{mode === "in" ? "Welcome back" : "Create your account"}</h1>
        <p className="mt-1 text-sm text-white/50">Your files, shared with friends — and gone when they should be.</p>

        <button
          onClick={() => signIn.social({ provider: "google", callbackURL: "/" })}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-xl bg-white py-2.5 font-semibold text-ink transition hover:bg-white/90"
        >
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.3 35 24 35c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 5.1 29.6 3 24 3 12.4 3 3 12.4 3 24s9.4 21 21 21 21-9.4 21-21c0-1.2-.1-2.3-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.6 7.1 29.6 5 24 5 16.3 5 9.7 9.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 45c5.2 0 10-2 13.6-5.2l-6.3-5.3C29.2 36 26.7 37 24 37c-5.3 0-9.7-2.6-11.3-7l-6.5 5C9.6 40.6 16.3 45 24 45z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.5l6.3 5.3C41.9 36.4 45 30.7 45 24c0-1.2-.1-2.3-.4-3.5z"/></svg>
          Continue with Google
        </button>

        <div className="my-5 flex items-center gap-3 text-xs text-white/30">
          <div className="h-px flex-1 bg-white/10" /> or <div className="h-px flex-1 bg-white/10" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "up" && (
            <Field icon={<UserIcon size={16} />} value={name} onChange={setName} placeholder="Your name" />
          )}
          <Field icon={<Mail size={16} />} value={email} onChange={setEmail} placeholder="you@email.com" type="email" />
          <Field icon={<Lock size={16} />} value={password} onChange={setPassword} placeholder="Password" type="password" />
          {error && <p className="text-sm text-red-400">{error}</p>}
          <button
            disabled={busy}
            className="w-full rounded-xl bg-gradient-to-r from-drift-500 via-glow-500 to-blush-500 py-2.5 font-semibold shadow-lg shadow-glow-600/30 transition hover:opacity-95 disabled:opacity-50"
          >
            {busy ? "…" : mode === "in" ? "Sign in" : "Sign up"}
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-white/50">
          {mode === "in" ? "New here?" : "Already have an account?"}{" "}
          <button onClick={() => setMode(mode === "in" ? "up" : "in")} className="font-semibold text-drift-300 hover:underline">
            {mode === "in" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </motion.div>
    </div>
  )
}

function Field(props: {
  icon: React.ReactNode
  value: string
  onChange: (v: string) => void
  placeholder: string
  type?: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 transition focus-within:border-drift-400">
      <span className="text-white/40">{props.icon}</span>
      <input
        className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-white/30"
        value={props.value}
        type={props.type ?? "text"}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        required
      />
    </div>
  )
}
