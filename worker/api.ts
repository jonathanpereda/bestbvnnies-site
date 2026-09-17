import { instagramResponse } from './instagram.ts'
import type { InstagramEnv } from './instagram.ts'
import { getServices } from './services.ts'
import { getProducts } from './products.ts'
import { createSquareClient, SquareError } from './square/client.ts'
import type { SquareEnv } from './square/client.ts'
import { CheckoutError, readJson } from './checkout.ts'
import { checkoutQuote, payPurchase, preparePurchase, publicConfig } from './payments.ts'

export async function handleApi(request: Request, env: SquareEnv & InstagramEnv, development = false): Promise<Response> {
  const { pathname } = new URL(request.url)
  const isSquareCheck = development && pathname === '/api/square/location'
  const isQuote = pathname === '/api/checkout/quote'
  const isConfig = pathname === '/api/checkout/config'
  const isPrepare = pathname === '/api/checkout/prepare'
  const isPay = pathname === '/api/checkout/pay'
  const isStatus = pathname === '/api/checkout/status'
  if (pathname !== '/api/health' && pathname !== '/api/products' && pathname !== '/api/services' && pathname !== '/api/instagram' && !isSquareCheck && !isQuote && !isConfig && !isPrepare && !isPay && !isStatus) return new Response(null, { status: 404 })
  const method = isQuote || isPrepare || isPay || isStatus ? 'POST' : 'GET'
  if (request.method !== method) return Response.json({ error: `Method not allowed. Use ${method}.` }, { status: 405, headers: { Allow: method } })
  if (pathname === '/api/instagram') return instagramResponse(request, env, typeof caches !== 'undefined' ? caches.default : undefined)
  if (pathname === '/api/health') return Response.json({ status: 'ok', service: 'bestbvnnies-site' })
  try {
    const headers = { 'Cache-Control': 'no-store' }
    if (pathname === '/api/services') return Response.json(await getServices(env), { headers })
    if (isConfig) return Response.json(publicConfig(env), { headers })
    if (isQuote) return Response.json(await checkoutQuote(await readJson(request), env), { headers })
    if (isPrepare) return Response.json(await preparePurchase(await readJson(request), env), { headers })
    if (isPay || isStatus) return Response.json(await payPurchase(await readJson(request), env, undefined, isStatus), { headers })
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
    if (pathname === '/api/services') return Response.json({ error: error instanceof SquareError && error.status === 500 ? 'Appointments are not configured yet.' : 'Services are temporarily unavailable. Please try again.' }, { status: error instanceof SquareError ? error.status : 502, headers: { 'Cache-Control': 'no-store' } })
    const safe = error instanceof SquareError ? error : new SquareError()
    return Response.json({ error: safe.message }, { status: safe.status, headers: { 'Cache-Control': 'no-store' } })
  }
}
