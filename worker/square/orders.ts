import type { CartItem, CheckoutQuote, FulfillmentMethod } from '../../shared/checkout.ts'
import type { Money, Product, ProductVariation } from '../../shared/products.ts'
import { SquareError } from './client.ts'
import type { SquareClient } from './client.ts'

type ValidatedLine = CartItem & { product: Product; variation: ProductVariation }
type OrderLine = {
  uid?: string
  catalog_object_id?: string
  quantity?: string
  base_price_money?: Money
  total_money?: Money
  total_tax_money?: Money
  total_discount_money?: Money
  total_service_charge_money?: Money
}
export type CalculatedOrder = {
  id?: string
  state?: string
  version?: number
  reference_id?: string
  tenders?: { payment_id?: string; id?: string }[]
  metadata?: Record<string, string>
  location_id?: string
  line_items?: OrderLine[]
  total_money?: Money
  total_tax_money?: Money
  total_discount_money?: Money
  total_service_charge_money?: Money
}

export async function calculateQuote(lines: ValidatedLine[], client: SquareClient, shipping = 0, tip = 0, method: FulfillmentMethod = 'pickup'): Promise<CheckoutQuote> {
  const { order } = await client.request<{ order?: CalculatedOrder }>('/orders/calculate', {
    order: {
      location_id: client.locationId,
      line_items: lines.map((line, index) => ({
        uid: `line-${index}`, catalog_object_id: line.variationId, quantity: String(line.quantity),
        // Only the freshly retrieved, location-specific Square price may override the catalog default.
        base_price_money: line.variation.price,
      })),
      pricing_options: { auto_apply_taxes: true, auto_apply_discounts: true },
      ...(shipping ? { service_charges: shippingCharge(shipping) } : {}),
    },
  })
  const currency = lines[0].variation.price!.currency
  const money = (value: Money | undefined) => {
    if (!value || value.currency !== currency || !Number.isSafeInteger(value.amount) || value.amount < 0) throw new SquareError()
    return value.amount
  }
  if (!order || order.location_id !== client.locationId || order.line_items?.length !== lines.length) throw new SquareError()
  if (currency !== 'USD') throw new SquareError(500)
  if ((order.total_service_charge_money ? money(order.total_service_charge_money) : 0) !== shipping) throw new SquareError()
  const mapped = lines.map((line, index) => {
    const matches = order.line_items!.filter((entry) => entry.uid === `line-${index}`)
    const calculated = matches[0]
    if (matches.length !== 1 || calculated.catalog_object_id !== line.variationId || calculated.quantity !== String(line.quantity)) throw new SquareError()
    const unitAmount = money(calculated.base_price_money)
    if (unitAmount !== line.variation.price!.amount) throw new SquareError()
    const total = money(calculated.total_money)
    const tax = money(calculated.total_tax_money)
    const discount = money(calculated.total_discount_money)
    const subtotal = total + discount - tax
    if (!Number.isSafeInteger(subtotal) || subtotal < 0) throw new SquareError()
    return { variationId: line.variationId, productId: line.product.id, quantity: line.quantity,
      name: line.product.name, variationName: line.variation.name, imageUrl: line.variation.imageUrl ?? line.product.imageUrl,
      unitPrice: { amount: unitAmount, currency }, inventory: line.variation.inventory, subtotal, tax, discount, total }
  })
  const total = money(order.total_money)
  const tax = money(order.total_tax_money)
  const discount = money(order.total_discount_money)
  for (const [key, value] of [['total', total], ['tax', tax], ['discount', discount]] as const) {
    const sum = mapped.reduce((sum, line) => sum + line[key], 0)
    if (key === 'discount' && sum !== value) throw new SquareError()
    if (key === 'tax' && sum > value) throw new SquareError()
    if (key === 'total' && sum + shipping + tax - mapped.reduce((acc, line) => acc + line.tax, 0) !== value) throw new SquareError()
  }
  const subtotal = total + discount - tax - shipping
  if (!Number.isSafeInteger(subtotal) || subtotal < 0) throw new SquareError()
  if (!Number.isSafeInteger(total + tip)) throw new SquareError()
  return { lines: mapped, currency, subtotal, tax, discount, total, shipping, tip, payableTotal: total + tip, fulfillment: method, calculatedAt: new Date().toISOString() }
}

export function shippingCharge(amount: number) {
  return [{ uid: 'shipping', name: 'Shipping', amount_money: { amount, currency: 'USD' }, calculation_phase: 'SUBTOTAL_PHASE', taxable: true }]
}
export function orderDraft(quote: CheckoutQuote, locationId: string) {
  return { location_id: locationId, state: 'OPEN',
    line_items: quote.lines.map((line, index) => ({ uid: `line-${index}`, catalog_object_id: line.variationId, quantity: String(line.quantity), base_price_money: line.unitPrice })),
    pricing_options: { auto_apply_taxes: true, auto_apply_discounts: true },
    ...(quote.shipping ? { service_charges: shippingCharge(quote.shipping) } : {}),
  }
}
