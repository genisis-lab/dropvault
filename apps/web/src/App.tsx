import { useSession } from "./lib/auth-client"
import AuthScreen from "./components/AuthScreen"
import Dashboard from "./components/Dashboard"
import PublicUploadRequest from "./components/PublicUploadRequest"

export default function App() {
  const { data: session, isPending } = useSession()
  const isRequestPage = typeof window !== "undefined" && window.location.pathname.startsWith("/request/")

  if (isRequestPage) return <PublicUploadRequest />

  return (
    <>
      <div className="canvas-glow" aria-hidden="true" />
      {isPending ? (
        <div className="grid min-h-screen place-items-center text-slate-400">Loading…</div>
      ) : session?.user ? (
        <Dashboard userName={session.user.name} userEmail={session.user.email} />
      ) : (
        <AuthScreen />
      )}
    </>
  )
}
