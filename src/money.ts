import type { Money } from '../shared/products'

export function formatPrice(price: Money | null): string {
  if (!price) return 'Price unavailable'
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency })
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
    return formatter.format(price.amount / 10 ** digits)
  } catch { return 'Price unavailable' }
}
