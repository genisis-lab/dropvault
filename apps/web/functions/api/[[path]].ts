// Cloudflare Pages Function: proxy every /api/* request to the DropVault Worker.
//
// The whole app assumes the API is same-origin with the web app
// (https://drop-vault.pages.dev). better-auth is configured with
// baseURL = PUBLIC_APP_URL, so its session cookie is first-party to the Pages
// domain and login works in every browser. Without this proxy, /api/* requests
// hit the static SPA instead of the Worker and auth requests come back as HTML,
// which surfaces in the UI as "Authentication failed".
//
// The Worker URL comes from the API_URL variable on the Pages project, with a
// fallback to the deployed Worker so it works even if the var is unset.

interface Env {
  API_URL?: string
}

const DEFAULT_API_URL = "https://dropvault-api.neil27.workers.dev"

export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context
  const incoming = new URL(request.url)
  const base = (env.API_URL || DEFAULT_API_URL).replace(/\/+$/, "")
  const target = base + incoming.pathname + incoming.search

  // Re-issue the request to the Worker, preserving method, headers, body, and
  // cookies. Returning the Worker's Response directly passes Set-Cookie through
  // unchanged, keeping the session cookie first-party to the Pages domain.
  const proxied = new Request(target, request)
  proxied.headers.set("X-Forwarded-Host", incoming.host)
  proxied.headers.set("X-Forwarded-Proto", incoming.protocol.replace(":", ""))
  return fetch(proxied)
}
