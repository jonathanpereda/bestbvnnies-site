import type { Buyer, CheckoutQuote, CheckoutSelection, PreparedPurchase, PublicCheckoutConfig, PurchaseResult, QuoteResponse } from '../shared/checkout.ts'
import { MAX_TIP_CENTS } from '../shared/checkout.ts'
import { getCheckoutQuote, parseQuote } from './checkout.ts'
import { CheckoutError } from './checkout-errors.ts'
import { fulfillment, keys, parseBuyer, record, shippingRate, squareAddress } from './fulfillment.ts'
import { digest, seal, unseal } from './checkout-tokens.ts'
import { createSquareClient, required, SquareError } from './square/client.ts'
import type { SquareClient, SquareEnv } from './square/client.ts'
import type { CalculatedOrder } from './square/orders.ts'
import { orderDraft } from './square/orders.ts'
import type { Money } from '../shared/products.ts'

type QuoteIntent = { nonce: string; issuedAt: number; selection: CheckoutSelection; fingerprint: string; total: number; payableTotal: number; currency: string }
type PurchaseIntent = QuoteIntent & { buyer: Buyer; source: string; verificationToken?: string }
type Payment = { id?: string; status?: string; order_id?: string; location_id?: string; reference_id?: string; amount_money?: Money; tip_money?: Money; total_money?: Money }
const REVIEW_MS = 15 * 60_000
const RECOVERY_MS = 24 * 60 * 60_000
const pending = (): PurchaseResult => ({ status: 'pending', error: 'We could not confirm the result yet. Check this same purchase again before starting another checkout.' })
const declined = (): PurchaseResult => ({ status: 'declined', error: 'The payment was declined. Your bag is saved. Review again and try another payment method.' })
const changed = (): PurchaseResult => ({ status: 'review_required', error: 'Prices, availability, or checkout details changed. No new payment was submitted by this request. Please review your bag again.' })
export async function quoteFingerprint(quote: CheckoutQuote) {
  return digest({ lines: quote.lines.map((line) => ({ id: line.variationId, quantity: line.quantity, price: line.unitPrice, total: line.total, tax: line.tax, discount: line.discount })), currency: quote.currency, subtotal: quote.subtotal, tax: quote.tax, discount: quote.discount, shipping: quote.shipping, total: quote.total, tip: quote.tip, payableTotal: quote.payableTotal, fulfillment: quote.fulfillment })
}
export function publicConfig(env: SquareEnv): PublicCheckoutConfig {
  const client = createSquareClient(env)
  if (required(env.CHECKOUT_TOKEN_SECRET).length < 32) throw new SquareError(500)
  return { applicationId: required(env.SQUARE_APPLICATION_ID), locationId: client.locationId, environment: client.environment as 'sandbox' | 'production', sdkUrl: client.environment === 'sandbox' ? 'https://sandbox.web.squarecdn.com/v1/square.js' : 'https://web.squarecdn.com/v1/square.js', shippingCents: shippingRate(env), maxTipCents: MAX_TIP_CENTS, suggestedTips: [200, 500, 1000] }
}
export async function checkoutQuote(input: unknown, env: SquareEnv, client?: SquareClient): Promise<QuoteResponse> {
  const selection = parseQuote(input)
  const quote = await getCheckoutQuote(selection, env, client)
  const intent: QuoteIntent = { nonce: crypto.randomUUID(), issuedAt: Date.now(), selection, fingerprint: await quoteFingerprint(quote), total: quote.total, payableTotal: quote.payableTotal, currency: quote.currency }
  return { ...quote, quoteToken: await seal(intent, 'quote', env) }
}
export async function preparePurchase(input: unknown, env: SquareEnv): Promise<PreparedPurchase> {
  const data = record(input)
  keys(data, ['quoteToken', 'buyer', 'sourceToken', 'verificationToken'])
  const quote = await unseal<QuoteIntent>(data.quoteToken, 'quote', env)
  if (Date.now() - quote.issuedAt > REVIEW_MS) throw new CheckoutError(409, 'Your review expired. Please request a fresh total.')
  const buyer = parseBuyer(data.buyer, quote.selection.fulfillment)
  if (typeof data.sourceToken !== 'string' || !/^(cnon|wnon):[^\s]{1,500}$/.test(data.sourceToken)) throw new CheckoutError(400, 'A valid Square payment token is required.')
  if (data.verificationToken !== undefined && (typeof data.verificationToken !== 'string' || !data.verificationToken || data.verificationToken.length > 2048)) throw new CheckoutError(400, 'Buyer verification could not be confirmed.')
  const intent: PurchaseIntent = { ...quote, buyer, source: data.sourceToken, ...(data.verificationToken ? { verificationToken: data.verificationToken as string } : {}) }
  // No order or payment is created here. The opaque recovery token protects buyer/source data in the browser session.
  return { purchaseToken: await seal(intent, 'purchase', env), reference: `BB-${quote.nonce}` }
}
async function findOrder(intent: PurchaseIntent, client: SquareClient): Promise<CalculatedOrder | undefined> {
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const result = await client.request<{ orders?: CalculatedOrder[]; cursor?: string }>('/orders/search', { location_ids: [client.locationId], limit: 100,
      query: { filter: { date_time_filter: { created_at: { start_at: new Date(intent.issuedAt - 60_000).toISOString() } } }, sort: { sort_field: 'CREATED_AT', sort_order: 'DESC' } }, ...(cursor ? { cursor } : {}) })
    const order = result.orders?.find((entry) => entry.reference_id === `BB-${intent.nonce}`)
    if (order?.id) return (await client.request<{ order: CalculatedOrder }>(`/orders/${encodeURIComponent(order.id)}`)).order
    cursor = result.cursor
    if (cursor && seen.has(cursor)) throw new SquareError()
    if (cursor) seen.add(cursor)
  } while (cursor)
}
function paymentResult(payment: Payment, intent: PurchaseIntent, orderId: string, locationId: string): PurchaseResult {
  if (payment.order_id !== orderId || payment.location_id !== locationId || payment.reference_id !== `BB-${intent.nonce}`) return pending()
  if (payment.status === 'COMPLETED' && payment.total_money?.amount === intent.payableTotal && payment.total_money.currency === intent.currency
    && payment.amount_money?.amount === intent.total && (payment.tip_money?.amount ?? 0) === intent.selection.tipCents) {
    return { status: 'completed', orderReference: orderId, total: intent.payableTotal, currency: intent.currency, fulfillment: intent.selection.fulfillment }
  }
  return payment.status === 'FAILED' || payment.status === 'CANCELED' ? declined() : pending()
}
async function recover(order: CalculatedOrder, intent: PurchaseIntent, client: SquareClient): Promise<PurchaseResult | undefined> {
  for (const tender of order.tenders ?? []) {
    const id = tender.payment_id ?? tender.id
    if (!id) continue
    const { payment } = await client.request<{ payment: Payment }>(`/payments/${encodeURIComponent(id)}`)
    return paymentResult(payment, intent, order.id!, client.locationId)
  }
  if (order.state === 'CANCELED') return declined()
  if (order.state !== 'OPEN') return pending()
}
async function cancelUnpaid(order: CalculatedOrder, client: SquareClient) {
  if (!order.id || order.state !== 'OPEN' || order.version === undefined || order.tenders?.length) return
  try { await client.request(`/orders/${encodeURIComponent(order.id)}`, { order: { location_id: client.locationId, version: order.version, state: 'CANCELED' } }, 'PUT') } catch { /* A failed cleanup leaves an unpaid order in Square; never cancel an uncertain payment. */ }
}
export async function payPurchase(input: unknown, env: SquareEnv, suppliedClient?: SquareClient, statusOnly = false): Promise<PurchaseResult> {
  const data = record(input)
  keys(data, ['purchaseToken'])
  const intent = await unseal<PurchaseIntent>(data.purchaseToken, 'purchase', env)
  const client = suppliedClient ?? createSquareClient(env)
  let order: CalculatedOrder | undefined
  try {
    order = await findOrder(intent, client)
    if (order) {
      const recovered = await recover(order, intent, client)
      if (recovered) return recovered
    }
    // Status checks never initiate a charge. An expired attempt remains recoverable through Square.
    if (statusOnly || Date.now() - intent.issuedAt > RECOVERY_MS) return pending()
    if (!order && Date.now() - intent.issuedAt > REVIEW_MS) return changed()
    let current: CheckoutQuote
    try { current = await getCheckoutQuote(intent.selection, env, client) } catch (error) {
      if (error instanceof CheckoutError) return changed()
      throw error
    }
    if (await quoteFingerprint(current) !== intent.fingerprint || current.total <= 0) return changed()
    const sourceDigest = await digest(intent.source)
    if (!order) {
      const result = await client.request<{ order: CalculatedOrder }>('/orders', { idempotency_key: `ord-${intent.nonce}`, order: {
        ...orderDraft(current, client.locationId), reference_id: `BB-${intent.nonce}`, metadata: { checkout_source: sourceDigest },
        fulfillments: [fulfillment(intent.selection.fulfillment, intent.buyer)],
      } })
      order = result.order
      if (!order?.id) return pending()
      const recovered = await recover(order, intent, client)
      if (recovered) return recovered
    }
    if (order.metadata?.checkout_source !== sourceDigest) return pending()
    if (order.location_id !== client.locationId || order.total_money?.currency !== intent.currency || order.total_money.amount !== intent.total
      || order.total_tax_money?.amount !== current.tax || order.total_discount_money?.amount !== current.discount
      || (order.total_service_charge_money?.amount ?? 0) !== current.shipping) {
      await cancelUnpaid(order, client)
      return changed()
    }
    // Recheck immediately before charging as well as before order creation; no reservation is implied.
    let lastCheck: CheckoutQuote
    try { lastCheck = await getCheckoutQuote(intent.selection, env, client) } catch (error) {
      if (error instanceof CheckoutError) return { status: 'pending', error: 'Stock could not be confirmed for this order. No new payment was submitted by this request. Check this purchase again or contact the shop with your reference.' }
      throw error
    }
    if (await quoteFingerprint(lastCheck) !== intent.fingerprint) return changed()
    try {
      const { payment } = await client.request<{ payment: Payment }>('/payments', {
        idempotency_key: `pay-${intent.nonce}`, source_id: intent.source, order_id: order.id,
        location_id: client.locationId, amount_money: { amount: intent.total, currency: intent.currency },
        tip_money: { amount: intent.selection.tipCents, currency: intent.currency }, autocomplete: true,
        reference_id: `BB-${intent.nonce}`, buyer_email_address: intent.buyer.email,
        customer_details: { customer_initiated: true, seller_keyed_in: false },
        ...(intent.buyer.address ? { shipping_address: squareAddress(intent.buyer) } : {}),
        ...(intent.verificationToken ? { verification_token: intent.verificationToken } : {}),
      })
      const result = paymentResult(payment, intent, order.id!, client.locationId)
      if (result.status === 'declined') await cancelUnpaid(order, client)
      return result
    } catch (error) {
      if (error instanceof SquareError && error.kind === 'declined') { await cancelUnpaid(order, client); return declined() }
      return pending()
    }
  } catch { return pending() }
}
