/**
 * Vercel edge proxy for MultiBaas.
 *
 * The browser calls /api/multibaas/<path> on the same origin. vercel.json rewrites that to
 * this function with the remainder in the `mbpath` query parameter (catch-all function files
 * were not routed reliably on Vercel), and the function forwards the request to the MultiBaas
 * deployment with the API key injected. That solves CORS on the
 * deployed site and keeps the key out of the client bundle.
 *
 * Environment variables (set in the Vercel project, not prefixed with VITE_):
 *   MULTIBAAS_URL                    https://<deployment>.multibaas.com
 *   MULTIBAAS_API_KEY                a read-only MultiBaas API key
 *   MULTIBAAS_PROXY_ALLOWED_ORIGINS  optional, comma-separated extra origins allowed to call
 *                                    the proxy (the deployment's own origin is always allowed)
 */
export const config = { runtime: 'edge' }

const ALLOWED_METHODS = new Set(['GET', 'POST', 'OPTIONS'])

/**
 * Only the dashboard itself may use the proxy. Browsers mark every request with
 * Sec-Fetch-Site and send Origin/Referer on fetches, so a same-origin page always passes;
 * curl, scripts, or other sites hitting the URL directly are refused. This stops a leaked
 * proxy URL from burning the MultiBaas request budget.
 */
function isAllowedOrigin(request, incoming) {
  const extra = (process.env.MULTIBAAS_PROXY_ALLOWED_ORIGINS || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
  const allowed = new Set([incoming.origin, ...extra])

  const origin = request.headers.get('origin')
  if (origin) return allowed.has(origin)

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      return allowed.has(new URL(referer).origin)
    } catch {
      return false
    }
  }

  return request.headers.get('sec-fetch-site') === 'same-origin'
}

export default async function handler(request) {
  if (!ALLOWED_METHODS.has(request.method)) {
    return new Response('Method not allowed', { status: 405 })
  }
  const base = (process.env.MULTIBAAS_URL || '').replace(/\/+$/, '')
  const key = cleanKey(process.env.MULTIBAAS_API_KEY)
  if (!base || !key) {
    return Response.json({ status: 500, message: 'MULTIBAAS_URL / MULTIBAAS_API_KEY are not configured' }, { status: 500 })
  }

  const incoming = new URL(request.url)
  if (!isAllowedOrigin(request, incoming)) {
    return Response.json({ status: 403, message: 'Origin not allowed through the proxy' }, { status: 403 })
  }

  // Path arrives via the rewrite (?mbpath=api/v0/...) or, if hit directly, from the URL itself.
  const mbpath = incoming.searchParams.get('mbpath')
  incoming.searchParams.delete('mbpath')
  const path = mbpath ? `/${mbpath.replace(/^\/+/, '')}` : incoming.pathname.replace(/^\/api\/multibaas/, '')
  // Only the read surface the dashboard uses is forwarded. Anything else is refused so a
  // leaked proxy URL cannot be used to administer the deployment.
  if (!/^\/api\/v0\/(queries(\/[A-Za-z0-9_-]+\/(results|count))?|chains\/ethereum\/(status|addresses\/[A-Za-z0-9_-]+\/contracts\/[A-Za-z0-9_-]+\/(status|methods\/(slot0|liquidity|token0|token1|fee))))$/.test(path)) {
    return Response.json({ status: 403, message: 'Path not allowed through the proxy' }, { status: 403 })
  }

  const upstream = new URL(base + path)
  upstream.search = incoming.search

  const headers = new Headers()
  headers.set('Authorization', `Bearer ${key}`)
  headers.set('Accept', 'application/json')
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)

  const init = { method: request.method, headers }
  if (request.method === 'POST') init.body = await request.text()

  const res = await fetch(upstream, init)
  const body = await res.text()
  return new Response(body, {
    status: res.status,
    headers: {
      'Content-Type': res.headers.get('content-type') || 'application/json',
      'Cache-Control': 'no-store',
    },
  })
}

/** Tolerate the usual paste accidents: quotes, whitespace/newlines, and a "Bearer " prefix. */
function cleanKey(raw) {
  return String(raw || '').trim().replace(/^['"]+|['"]+$/g, '').replace(/^Bearer\s+/i, '').trim()
}
