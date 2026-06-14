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
      {/* Layered backdrop: CSS aurora + grid behind the lazy 3D blobs. */}
      <div className="aurora" aria-hidden="true">
        <div className="aurora-blob b1" />
        <div className="aurora-blob b2" />
        <div className="aurora-blob b3" />
      </div>
      <div className="grid-overlay" aria-hidden="true" />
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
