import type { Inventory, Money } from './products.ts'

// Defensive request limits, not stock or business-order limits.
export const MAX_CART_LINES = 100
export const MAX_QUANTITY = 99
export type CartItem = { variationId: string; quantity: number }
export type QuoteRequest = { items: CartItem[] }
export type FulfillmentMethod = 'shipping' | 'pickup'
export const MAX_TIP_CENTS = 10_000
export type CheckoutSelection = QuoteRequest & { fulfillment: FulfillmentMethod; tipCents: number }
export type Buyer = { givenName: string; familyName: string; email: string; phone: string; address?: { line1: string; line2: string; city: string; region: string; postalCode: string; country: string } }
export type PublicCheckoutConfig = { applicationId: string; locationId: string; environment: 'sandbox' | 'production'; sdkUrl: string; shippingCents: number; maxTipCents: number; suggestedTips: number[] }
export type PurchaseResult = { status: 'completed'; orderReference: string; total: number; currency: string; fulfillment: FulfillmentMethod } | { status: 'declined' | 'review_required' | 'pending'; error: string }
export type PreparedPurchase = { purchaseToken: string; reference: string }
export type QuoteResponse = CheckoutQuote & { quoteToken: string }
export type QuoteLine = CartItem & {
  productId: string
  name: string
  variationName: string | null
  imageUrl: string | null
  unitPrice: Money
  inventory: Inventory
  subtotal: number
  tax: number
  discount: number
  total: number
}
export type CheckoutQuote = {
  lines: QuoteLine[]
  currency: string
  subtotal: number
  tax: number
  discount: number
  total: number
  shipping: number
  tip: number
  payableTotal: number
  fulfillment: FulfillmentMethod
  calculatedAt: string
}
export type CartIssue = {
  variationId: string
  code: 'unavailable' | 'price_unavailable' | 'insufficient_stock' | 'stock_unknown'
  message: string
  availableQuantity?: number
}
export type CheckoutFailure = { error: string; issues?: CartIssue[] }
