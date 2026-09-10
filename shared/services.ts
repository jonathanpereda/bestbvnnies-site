import type { Money } from './products.ts'

export type ServiceVariation = {
  id: string
  name: string | null
  pricing: 'fixed' | 'variable' | 'unspecified'
  price: Money | null
  priceDescription: string | null
  durationMs: number | null
  bookable: true
}
export type AppointmentService = {
  id: string
  name: string
  description: string | null
  categories: { id: string; name: string }[]
  variations: ServiceVariation[]
}
export type ServicesResponse = { services: AppointmentService[]; bookingUrl: string }

export function formatServicePrice(variation: ServiceVariation): string {
  // Square's optional descriptive label can express a starting price; never infer one.
  if (variation.priceDescription) return variation.priceDescription
  if (variation.pricing === 'variable') return 'Price varies'
  if (variation.pricing === 'fixed' && variation.price) {
    const { amount, currency } = variation.price
    try {
      const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency })
      const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
      return formatter.format(amount / 10 ** digits)
    } catch { /* Malformed currency falls back to the hosted booking details. */ }
  }
  return 'See price when booking'
}

export function formatServiceDuration(milliseconds: number | null): string {
  if (milliseconds === null || !Number.isSafeInteger(milliseconds) || milliseconds <= 0) return 'Duration shown when booking'
  if (milliseconds < 60_000) return 'Less than 1 min'
  const minutes = milliseconds / 60_000
  const hours = Math.floor(minutes / 60)
  const remaining = Number((minutes % 60).toFixed(2))
  return [hours ? `${hours} hr` : '', remaining ? `${remaining} min` : ''].filter(Boolean).join(' ')
}
