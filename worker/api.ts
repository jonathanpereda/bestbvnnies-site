import { getProducts } from './products.ts'
import { createSquareClient, SquareError } from './square/client.ts'
import type { SquareEnv } from './square/client.ts'

export async function handleApi(request: Request, env: SquareEnv, development = false): Promise<Response> {
  const { pathname } = new URL(request.url)
  const isSquareCheck = development && pathname === '/api/square/location'
  if (pathname !== '/api/health' && pathname !== '/api/products' && !isSquareCheck) return new Response(null, { status: 404 })
  if (request.method !== 'GET') return Response.json({ error: 'Method not allowed. Use GET.' }, { status: 405, headers: { Allow: 'GET' } })
  if (pathname === '/api/health') return Response.json({ status: 'ok', service: 'bestbvnnies-site' })
  try {
    if (isSquareCheck) {
      const client = createSquareClient(env)
      // The diagnostic stays Sandbox-only, even if shared infrastructure supports production.
      if (client.environment !== 'sandbox') throw new SquareError(500)
      await client.request(`/locations/${encodeURIComponent(client.locationId)}`)
      return Response.json({ status: 'ok', service: 'square-sandbox' }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return Response.json(await getProducts(env), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    const safe = error instanceof SquareError ? error : new SquareError()
    return Response.json({ error: safe.message }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
