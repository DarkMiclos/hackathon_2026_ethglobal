/**
 * Deployment self-check: GET /api/health
 *
 * - 404 from Vercel here means the api/ directory is not being built as functions.
 * - `upstream` shows whether the configured MULTIBAAS_URL + MULTIBAAS_API_KEY actually
 *   reach MultiBaas (it calls the chain status endpoint through the same code path the
 *   proxy uses). The key itself is never returned.
 */
export const config = { runtime: 'edge' }

export default async function handler() {
  const base = (process.env.MULTIBAAS_URL || '').replace(/\/+$/, '')
  const key = cleanKey(process.env.MULTIBAAS_API_KEY)
  const proxyConfigured = Boolean(base && key)

  let host = null
  let hint = null
  try {
    if (base) {
      const u = new URL(base)
      host = u.host
      if (u.pathname !== '/' && u.pathname !== '') hint = `MULTIBAAS_URL must be the bare origin, without the path "${u.pathname}"`
      if (!/multibaas\.com$/.test(u.host)) hint = hint || 'MULTIBAAS_URL does not look like a *.multibaas.com deployment URL'
    }
  } catch {
    hint = 'MULTIBAAS_URL is not a valid URL'
  }

  let upstream = null
  if (proxyConfigured && !hint) {
    try {
      const res = await fetch(`${base}/api/v0/chains/ethereum/status`, {
        headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      })
      const text = await res.text()
      let blockNumber = null
      try { blockNumber = JSON.parse(text)?.result?.blockNumber ?? null } catch { /* not JSON */ }
      upstream = { status: res.status, ok: res.ok, blockNumber }
      if (res.status === 401 || res.status === 403) hint = `MultiBaas rejected the API key (${(text.match(/"message":"([^"]*)"/) || [])[1] || res.status}). Re-paste MULTIBAAS_API_KEY as the bare token from the MultiBaas console, then redeploy. Key length seen: ${key.length}`
      else if (res.status === 404) hint = 'MultiBaas returned 404: MULTIBAAS_URL points at the wrong deployment or includes a path'
      else if (!res.ok) hint = `MultiBaas answered ${res.status}`
    } catch (err) {
      upstream = { error: String(err?.message || err) }
      hint = 'Could not reach MULTIBAAS_URL from the function'
    }
  } else if (!proxyConfigured) {
    hint = 'Set MULTIBAAS_URL and MULTIBAAS_API_KEY in the Vercel project (no VITE_ prefix) and redeploy'
  }

  return Response.json({
    ok: proxyConfigured && upstream?.ok === true,
    proxyConfigured,
    multibaasHost: host,
    upstream,
    hint,
    time: new Date().toISOString(),
  }, { headers: { 'Cache-Control': 'no-store' } })
}

/** Tolerate the usual paste accidents: quotes, whitespace/newlines, and a "Bearer " prefix. */
function cleanKey(raw) {
  return String(raw || '').trim().replace(/^['"]+|['"]+$/g, '').replace(/^Bearer\s+/i, '').trim()
}
