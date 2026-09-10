import { getProducts } from './products.ts'
import { createSquareClient, SquareError } from './square/client.ts'
import type { SquareEnv } from './square/client.ts'
import { CheckoutError, getCheckoutQuote, readCart } from './checkout.ts'

export async function handleApi(request: Request, env: SquareEnv, development = false): Promise<Response> {
  const { pathname } = new URL(request.url)
  const isSquareCheck = development && pathname === '/api/square/location'
  const isQuote = pathname === '/api/checkout/quote'
  if (pathname !== '/api/health' && pathname !== '/api/products' && !isSquareCheck && !isQuote) return new Response(null, { status: 404 })
  const method = isQuote ? 'POST' : 'GET'
  if (request.method !== method) return Response.json({ error: `Method not allowed. Use ${method}.` }, { status: 405, headers: { Allow: method } })
  if (pathname === '/api/health') return Response.json({ status: 'ok', service: 'bestbvnnies-site' })
  try {
    if (isQuote) return Response.json(await getCheckoutQuote(await readCart(request), env), { headers: { 'Cache-Control': 'no-store' } })
    if (isSquareCheck) {
      const client = createSquareClient(env)
      // The diagnostic stays Sandbox-only, even if shared infrastructure supports production.
      if (client.environment !== 'sandbox') throw new SquareError(500)
      await client.request(`/locations/${encodeURIComponent(client.locationId)}`)
      return Response.json({ status: 'ok', service: 'square-sandbox' }, { headers: { 'Cache-Control': 'no-store' } })
    }
    return Response.json(await getProducts(env), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof CheckoutError) return Response.json({ error: error.message, ...(error.issues ? { issues: error.issues } : {}) }, { status: error.status, headers: { 'Cache-Control': 'no-store' } })
    const safe = error instanceof SquareError ? error : new SquareError()
    return Response.json({ error: safe.message }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
