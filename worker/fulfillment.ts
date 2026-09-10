import type { Buyer, FulfillmentMethod } from '../shared/checkout.ts'
import type { SquareEnv } from './square/client.ts'
import { required, SquareError } from './square/client.ts'
import { CheckoutError } from './checkout-errors.ts'

export function shippingRate(env: SquareEnv): number {
  const value = required(env.SHIPPING_FLAT_RATE_CENTS)
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) > 100_000) throw new SquareError(500)
  return Number(value)
}
export function fulfillmentMethod(value: unknown): FulfillmentMethod {
  if (value !== 'shipping' && value !== 'pickup') throw new CheckoutError(400, 'Choose shipping or local pickup.')
  return value
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CheckoutError(400, 'Check your checkout details.')
  return value as Record<string, unknown>
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new CheckoutError(400, 'Unexpected checkout fields. Please review your bag again.')
}
function text(value: unknown, label: string, max: number, optional = false): string {
  if (optional && (value === undefined || value === '')) return ''
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || Array.from(value).some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) throw new CheckoutError(400, `Enter a valid ${label}.`)
  return value.trim()
}
export function parseBuyer(value: unknown, method: FulfillmentMethod): Buyer {
  const data = record(value)
  keys(data, ['givenName', 'familyName', 'email', 'phone', 'address'])
  const givenName = text(data.givenName, 'first name', 100)
  const familyName = text(data.familyName, 'last name', 100)
  const email = text(data.email, 'email address', 254)
  const phone = text(data.phone, 'phone number', 30)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CheckoutError(400, 'Enter a valid email address.')
  if (!/^\+?[\d\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7 || phone.replace(/\D/g, '').length > 15) throw new CheckoutError(400, 'Enter a valid phone number.')
  const buyer: Buyer = { givenName, familyName, email, phone }
  if (method === 'shipping') {
    const address = record(data.address)
    keys(address, ['line1', 'line2', 'city', 'region', 'postalCode', 'country'])
    const country = text(address.country, 'two-letter country code', 2).toUpperCase()
    if (country === 'ZZ' || !/^[A-Z]{2}$/.test(country) || new Intl.DisplayNames(['en'], { type: 'region' }).of(country) === country) throw new CheckoutError(400, 'Enter a valid two-letter country code.')
    buyer.address = { line1: text(address.line1, 'street address', 200), line2: text(address.line2, 'apartment or suite', 200, true), city: text(address.city, 'city', 100), region: text(address.region, 'state or region', 100), postalCode: text(address.postalCode, 'postal code', 20), country }
  } else if (data.address !== undefined) throw new CheckoutError(400, 'Pickup does not need a shipping address.')
  return buyer
}
export function squareAddress(buyer: Buyer) {
  if (!buyer.address) return undefined
  return { address_line_1: buyer.address.line1, ...(buyer.address.line2 ? { address_line_2: buyer.address.line2 } : {}), locality: buyer.address.city, administrative_district_level_1: buyer.address.region, postal_code: buyer.address.postalCode, country: buyer.address.country }
}
export function fulfillment(method: FulfillmentMethod, buyer: Buyer) {
  const recipient = { display_name: `${buyer.givenName} ${buyer.familyName}`, email_address: buyer.email, phone_number: buyer.phone, ...(buyer.address ? { address: squareAddress(buyer) } : {}) }
  return method === 'shipping'
    ? { uid: 'fulfillment', type: 'SHIPMENT', state: 'PROPOSED', shipment_details: { recipient } }
    : { uid: 'fulfillment', type: 'PICKUP', state: 'PROPOSED', pickup_details: { recipient, schedule_type: 'ASAP', note: 'Pickup hours are informational. Contact the shop to confirm readiness; no pickup slot was reserved.' } }
}
