import { MAX_CART_LINES, MAX_QUANTITY } from '../shared/checkout.ts'
import type { CartItem, CartIssue, CheckoutQuote, QuoteRequest } from '../shared/checkout.ts'
import { getProducts } from './products.ts'
import { createSquareClient } from './square/client.ts'
import type { SquareClient, SquareEnv } from './square/client.ts'
import { calculateQuote } from './square/orders.ts'

import { CheckoutError } from './checkout-errors.ts'
export { CheckoutError } from './checkout-errors.ts'
import { fulfillmentMethod, shippingRate, keys, record } from './fulfillment.ts'
import { MAX_TIP_CENTS } from '../shared/checkout.ts'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function parseCart(value: unknown): QuoteRequest {
  const invalid = () => new CheckoutError(400, `Choose 1–${MAX_CART_LINES} different items with whole quantities from 1–${MAX_QUANTITY}.`)
  if (!object(value) || Object.keys(value).length !== 1 || !Array.isArray(value.items)
    || !value.items.length || value.items.length > MAX_CART_LINES) throw invalid()
  const seen = new Set<string>()
  const items: CartItem[] = value.items.map((entry: unknown) => {
    if (!object(entry) || Object.keys(entry).length !== 2 || typeof entry.variationId !== 'string'
      || !entry.variationId.trim() || entry.variationId !== entry.variationId.trim() || entry.variationId.length > 192
      || typeof entry.quantity !== 'number' || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY
      || seen.has(entry.variationId)) throw invalid()
    seen.add(entry.variationId)
    return { variationId: entry.variationId, quantity: entry.quantity }
  })
  return { items }
}

export async function readJson(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new CheckoutError(415, 'Send the cart as JSON.')
  }
  // Bound actual bytes, even when Content-Length is missing or inaccurate.
  const reader = request.body?.getReader()
  if (!reader) throw new CheckoutError(400, 'The cart request is empty.')
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > 131_072) {
        await reader.cancel()
        throw new CheckoutError(413, 'The cart request is too large.')
      }
      chunks.push(value)
    }
    const buffer = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength }
    return JSON.parse(new TextDecoder().decode(buffer))
  } catch (error) {
    if (error instanceof CheckoutError) throw error
    throw new CheckoutError(400, 'The cart request could not be read. Please try again.')
  } finally { reader.releaseLock() }
}

export async function readCart(request: Request): Promise<QuoteRequest> { return parseCart(await readJson(request)) }

export function parseQuote(input: unknown) {
  const data = record(input)
  keys(data, ['items', 'fulfillment', 'tipCents'])
  const { items } = parseCart({ items: data.items })
  const method = fulfillmentMethod(data.fulfillment)
  if (!Number.isSafeInteger(data.tipCents) || (data.tipCents as number) < 0 || (data.tipCents as number) > MAX_TIP_CENTS) throw new CheckoutError(400, 'Choose a tip between $0 and $100, in whole cents.')
  return { items, fulfillment: method, tipCents: data.tipCents as number }
}

export async function getCheckoutQuote(input: unknown, env: SquareEnv, suppliedClient?: SquareClient): Promise<CheckoutQuote> {
  const selection = parseQuote(input)
  const { items } = selection
  const client = suppliedClient ?? createSquareClient(env)
  // Reuse the fresh, category- and location-scoped catalog rules. No browser prices enter this flow.
  const catalog = await getProducts(env, client)
  const available = new Map(catalog.products.flatMap((product) => product.variations.map((variation) => [variation.id, { product, variation }] as const)))
  const issues: CartIssue[] = []
  for (const item of items) {
    const found = available.get(item.variationId)
    const issue = (code: CartIssue['code'], message: string, availableQuantity?: number) => issues.push({ variationId: item.variationId, code, message, ...(availableQuantity !== undefined ? { availableQuantity } : {}) })
    if (!found) { issue('unavailable', 'This option is no longer available in the shop. Please remove it.'); continue }
    const { variation } = found
    if (!variation.price) issue('price_unavailable', 'A current price is unavailable for this option. Remove it or try again later.')
    const stock = variation.inventory
    if (stock.status === 'unknown') issue('stock_unknown', 'We could not confirm stock for this option. Please try again.')
    else if (stock.status === 'out_of_stock' || (stock.status === 'in_stock' && stock.count < item.quantity)) {
      const count = Math.floor(stock.count!)
      issue('insufficient_stock', count > 0 ? `Only ${count} available. Please lower the quantity.` : 'This option is out of stock. Please remove it.', count)
    }
    // Untracked inventory is deliberately permitted; an active sold-out flag still rejects above.
  }
  if (issues.length) throw new CheckoutError(409, 'Some items need your attention before review.', issues)
  const lines = items.map((item) => ({ ...item, ...available.get(item.variationId)! }))
  if (new Set(lines.map((line) => line.variation.price!.currency)).size !== 1) {
    throw new CheckoutError(409, 'These items use different currencies and cannot be reviewed together.')
  }
  const shipping = selection.fulfillment === 'shipping' ? shippingRate(env) : 0
  return calculateQuote(lines, client, shipping, selection.tipCents, selection.fulfillment)
}
