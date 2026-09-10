import type { Inventory, Money } from './products.ts'

// Defensive request limits, not stock or business-order limits.
export const MAX_CART_LINES = 100
export const MAX_QUANTITY = 99
export type CartItem = { variationId: string; quantity: number }
export type QuoteRequest = { items: CartItem[] }
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
  calculatedAt: string
}
export type CartIssue = {
  variationId: string
  code: 'unavailable' | 'price_unavailable' | 'insufficient_stock' | 'stock_unknown'
  message: string
  availableQuantity?: number
}
export type CheckoutFailure = { error: string; issues?: CartIssue[] }
