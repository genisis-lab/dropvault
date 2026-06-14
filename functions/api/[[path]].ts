const API_ORIGIN = "https://dropvault-api.neil27.workers.dev"

type PagesContext = {
  request: Request
}

export async function onRequest(context: PagesContext) {
  const requestUrl = new URL(context.request.url)
  const upstreamUrl = new URL(requestUrl.pathname + requestUrl.search, API_ORIGIN)
  const upstreamRequest = new Request(upstreamUrl, context.request)

  return fetch(upstreamRequest)
}
