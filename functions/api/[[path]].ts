// Cloudflare Pages Function: reverse-proxy every /api/* request to the Dropvault
// API Worker.
//
// Why: the web app (drop-vault.pages.dev) and the API Worker
// (dropvault-api.neil27.workers.dev) are different sites. A session cookie set
// by the Worker is therefore a third-party cookie that browsers refuse to send
// back, so the user appears logged out and the sign-in page loops.
//
// By proxying here, the browser only ever talks to the Pages origin, so the
// auth cookie is first-party (SameSite=Lax) and works in every browser. The
// Worker still runs the actual API + cron + D1 + R2.

const API_ORIGIN = "https://dropvault-api.neil27.workers.dev"

export const onRequest = async (context: { request: Request }) => {
  const { request } = context
  const url = new URL(request.url)
  const target = API_ORIGIN + url.pathname + url.search

  // Forward the original headers (incl. Cookie + Origin) but let fetch set Host
  // from the target URL.
  const headers = new Headers(request.headers)
  headers.delete("host")

  const init: RequestInit = {
    method: request.method,
    headers,
    // Pass 3xx (e.g. the download redirect to a presigned R2 URL) straight back
    // to the browser instead of following it here.
    redirect: "manual",
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = request.body
    // Required when streaming a request body through fetch in the Workers runtime.
    ;(init as unknown as { duplex: string }).duplex = "half"
  }

  return fetch(target, init)
}
