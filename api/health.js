/**
 * Deployment self-check: GET /api/health
 * If this returns 404 on Vercel, the api/ directory is not being built as functions
 * (check Root Directory, framework preset, and that no legacy `builds` config is set).
 */
export const config = { runtime: 'edge' }

export default function handler() {
  return Response.json({
    ok: true,
    proxyConfigured: Boolean(process.env.MULTIBAAS_URL && process.env.MULTIBAAS_API_KEY),
    time: new Date().toISOString(),
  })
}
