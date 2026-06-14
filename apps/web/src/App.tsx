import { useSession } from "./lib/auth-client"
import AuthScreen from "./components/AuthScreen"
import Dashboard from "./components/Dashboard"

export default function App() {
  const { data: session, isPending } = useSession()

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
