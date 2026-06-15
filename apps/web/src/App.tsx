import { useEffect, useState } from "react"
import { useSession } from "./lib/auth-client"
import { accountStatus, type AccountStatus } from "./lib/account"
import AuthScreen from "./components/AuthScreen"
import Dashboard from "./components/Dashboard"
import PublicUploadRequest from "./components/PublicUploadRequest"
import SuspendedScreen from "./components/SuspendedScreen"

export default function App() {
  const { data: session, isPending } = useSession()
  const isRequestPage = typeof window !== "undefined" && window.location.pathname.startsWith("/request/")
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [statusChecked, setStatusChecked] = useState(false)

  const userEmail = session?.user?.email

  useEffect(() => {
    let active = true
    if (userEmail && !isRequestPage) {
      setStatusChecked(false)
      accountStatus()
        .then((s) => { if (active) { setStatus(s); setStatusChecked(true) } })
        .catch(() => { if (active) { setStatus(null); setStatusChecked(true) } })
    } else {
      setStatus(null)
      setStatusChecked(false)
    }
    return () => { active = false }
  }, [userEmail, isRequestPage])

  if (isRequestPage) return <PublicUploadRequest />

  return (
    <>
      <div className="canvas-glow" aria-hidden="true" />
      {isPending ? (
        <div className="grid min-h-screen place-items-center text-slate-400">Loading...</div>
      ) : session?.user ? (
        !statusChecked ? (
          <div className="grid min-h-screen place-items-center text-slate-400">Loading...</div>
        ) : status?.suspended ? (
          <SuspendedScreen email={session.user.email} reason={status.suspensionReason} />
        ) : (
          <Dashboard userName={session.user.name} userEmail={session.user.email} />
        )
      ) : (
        <AuthScreen />
      )}
    </>
  )
}
