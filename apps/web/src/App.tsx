import { lazy, Suspense } from "react"
import { useSession } from "./lib/auth-client"
import AuthScreen from "./components/AuthScreen"
import Dashboard from "./components/Dashboard"

// 3D backdrop is lazy + suspense-wrapped so it never blocks first paint.
const AmbientBackground = lazy(() => import("./components/AmbientBackground"))

export default function App() {
  const { data: session, isPending } = useSession()

  return (
    <>
      <Suspense fallback={null}>
        <AmbientBackground />
      </Suspense>
      {isPending ? (
        <div className="grid min-h-screen place-items-center text-white/40">Loading…</div>
      ) : session?.user ? (
        <Dashboard userName={session.user.name} />
      ) : (
        <AuthScreen />
      )}
    </>
  )
}
