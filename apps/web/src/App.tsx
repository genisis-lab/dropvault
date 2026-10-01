import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useSession } from "./lib/auth-client";
import { accountStatus, type AccountStatus } from "./lib/account";

const AuthScreen = lazy(() => import("./components/AuthScreen"));
const Dashboard = lazy(() => import("./components/Dashboard"));
const PublicUploadRequest = lazy(
  () => import("./components/PublicUploadRequest"),
);
const SuspendedScreen = lazy(() => import("./components/SuspendedScreen"));
const RecoveryPasswordDialog = lazy(
  () => import("./components/RecoveryPasswordDialog"),
);

function LoadingScreen() {
  return (
    <div className="grid min-h-screen place-items-center text-slate-400">
      Loading...
    </div>
  );
}

export default function App() {
  const queryClient = useQueryClient();
  const { data: session, isPending } = useSession();
  const isRequestPage =
    typeof window !== "undefined" &&
    window.location.pathname.startsWith("/request/");
  // better-auth marks a signed-out refetch (e.g. right after sign-up) as
  // pending. Only the first load may swap in the loading screen; otherwise
  // AuthScreen remounts and drops its "check your inbox" confirmation.
  const [sessionLoaded, setSessionLoaded] = useState(false);
  useEffect(() => {
    if (!isPending) setSessionLoaded(true);
  }, [isPending]);
  const showSessionLoading = isPending && !sessionLoaded;
  const [status, setStatus] = useState<AccountStatus | null>(null);
  const [statusChecked, setStatusChecked] = useState(false);

  const userEmail = session?.user?.email;

  // Signing up from a /signup invite link should land on the dashboard at /.
  useEffect(() => {
    if (userEmail && window.location.pathname.startsWith("/signup"))
      window.history.replaceState({}, "", "/");
  }, [userEmail]);

  useEffect(() => {
    let active = true;
    if (userEmail && !isRequestPage) {
      setStatusChecked(false);
      accountStatus()
        .then((s) => {
          if (active) {
            setStatus(s);
            setStatusChecked(true);
          }
        })
        .catch(() => {
          if (active) {
            setStatus(null);
            setStatusChecked(true);
          }
        });
    } else {
      setStatus(null);
      setStatusChecked(false);
    }
    return () => {
      active = false;
    };
  }, [userEmail, isRequestPage]);

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["files"] });
      void queryClient.invalidateQueries({ queryKey: ["trash"] });
      void queryClient.invalidateQueries({ queryKey: ["folders"] });
    };
    window.addEventListener("dropvault:files-changed", refresh);
    return () => window.removeEventListener("dropvault:files-changed", refresh);
  }, [queryClient]);

  if (isRequestPage)
    return (
      <Suspense fallback={<LoadingScreen />}>
        <PublicUploadRequest />
      </Suspense>
    );

  return (
    <>
      <div className="canvas-glow" aria-hidden="true" />
      <Suspense fallback={<LoadingScreen />}>
        {showSessionLoading ? (
          <LoadingScreen />
        ) : session?.user ? (
          !statusChecked ? (
            <LoadingScreen />
          ) : status?.suspended ? (
            <SuspendedScreen
              email={session.user.email}
              reason={status.suspensionReason}
            />
          ) : (
            <Dashboard
              userName={session.user.name}
              userEmail={session.user.email}
            />
          )
        ) : (
          <AuthScreen />
        )}
      </Suspense>
      {session?.user && (
        <Suspense fallback={null}>
          <RecoveryPasswordDialog />
        </Suspense>
      )}
    </>
  );
}
