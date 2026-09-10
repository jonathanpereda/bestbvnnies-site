import { MAX_CART_LINES, MAX_QUANTITY } from '../../shared/checkout.ts'
import type { CartItem } from '../../shared/checkout.ts'

export const CART_KEY = 'bestbvnnies.cart.v1'

export function restoreCart(raw: string | null): CartItem[] {
  try {
    const entries: unknown = JSON.parse(raw ?? '[]')
    if (!Array.isArray(entries) || entries.length > MAX_CART_LINES) return []
    const seen = new Set<string>()
    return entries.map((entry) => {
      if (!entry || typeof entry !== 'object' || typeof entry.variationId !== 'string' || !entry.variationId.trim()
        || entry.variationId.trim() !== entry.variationId || entry.variationId.length > 192 || seen.has(entry.variationId)
        || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1 || entry.quantity > MAX_QUANTITY) throw new Error('Invalid saved cart')
      seen.add(entry.variationId)
      // Discard any injected prices or other metadata.
      return { variationId: entry.variationId, quantity: entry.quantity }
    })
  } catch { return [] }
}

export function setQuantity(items: CartItem[], variationId: string, quantity: number): CartItem[] {
  if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > MAX_QUANTITY) return items
  if (quantity === 0) return items.filter((item) => item.variationId !== variationId)
  if (items.some((item) => item.variationId === variationId)) return items.map((item) => item.variationId === variationId ? { variationId, quantity } : item)
  return items.length < MAX_CART_LINES ? [...items, { variationId, quantity }] : items
}
