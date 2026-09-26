// Temporary diagnostics: shows what a rewritten request looks like inside an edge function.
export const config = { runtime: 'edge' }
export default function handler(request) {
  const headers = {}
  for (const [k, v] of request.headers) if (/^x-|^referer$|^origin$/i.test(k) && !/cookie|auth/i.test(k)) headers[k] = v
  return Response.json({ url: request.url, headers })
}
