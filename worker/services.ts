import type { AppointmentService, ServicesResponse, ServiceVariation } from '../shared/services.ts'
import { createSquareClient, pages, required, SquareError } from './square/client.ts'
import type { SquareClient, SquareEnv } from './square/client.ts'
import { presentAt } from './square/catalog.ts'
import type { CatalogObject } from './square/catalog.ts'

const text = (value: unknown): string | null => typeof value === 'string' ? value.trim() || null : null
const array = <T>(value: T[] | undefined): T[] => Array.isArray(value) ? value.filter(Boolean) : []

export function bookingUrl(env: SquareEnv): string {
  try {
    const url = new URL(required(env.SQUARE_BOOKING_URL))

    const isSquareAppointments =
      url.hostname === 'app.squareup.com' ||
      url.hostname === 'app.squareupsandbox.com'

    const isSquareSite =
      url.hostname.endsWith('.square.site')

    if (
      url.protocol !== 'https:' ||
      (!isSquareAppointments && !isSquareSite) ||
      url.port ||
      url.username ||
      url.password
    ) {
      throw new Error()
    }

    return url.href
  } catch {
    throw new SquareError(500)
  }
}

export function mapServices(items: CatalogObject[], categories: CatalogObject[], locationId: string): AppointmentService[] {
  const categoryNames = new Map(array(categories).filter((category) => category.type === 'CATEGORY' && !category.is_deleted && text(category.category_data?.name)).map((category) => [category.id, text(category.category_data?.name)!]))
  return [...new Map(array(items).map((item) => [item.id, item])).values()].flatMap((item) => {
    const data = item.item_data
    const name = text(data?.name)
    if (!text(item.id) || item.type !== 'ITEM' || !presentAt(item, locationId) || !data || data.is_archived || data.product_type !== 'APPOINTMENTS_SERVICE' || !name) return []
    const variations: ServiceVariation[] = [...new Map(array(data.variations).map((v) => [v.id, v])).values()]
      .filter((v) => text(v.id) && v.type === 'ITEM_VARIATION' && presentAt(v, locationId) && v.item_variation_data?.available_for_booking === true)
      .sort((a, b) => (a.item_variation_data?.ordinal ?? 0) - (b.item_variation_data?.ordinal ?? 0))
      .map((v) => {
        const value = v.item_variation_data!
        const override = array(value.location_overrides).find((entry) => entry.location_id === locationId)
        const pricingType = override?.pricing_type ?? value.pricing_type
        const money = override?.price_money ?? value.price_money
        const price = pricingType === 'FIXED_PRICING' && money && Number.isSafeInteger(money.amount) && money.amount >= 0 && /^[A-Z]{3}$/.test(money.currency) ? { amount: money.amount, currency: money.currency } : null
        return { id: v.id, name: text(value.name), pricing: pricingType === 'FIXED_PRICING' ? 'fixed' : pricingType === 'VARIABLE_PRICING' ? 'variable' : 'unspecified', price,
          priceDescription: text(value.price_description), durationMs: Number.isSafeInteger(value.service_duration) && value.service_duration! > 0 ? value.service_duration! : null, bookable: true }
      })
    if (!variations.length) return []
    const ids = [...new Set([...array(data.categories).map((c) => c.id), ...(data.category_id ? [data.category_id] : [])])]
    return [{ id: item.id, name, description: text(data.description_plaintext) ?? text(data.description), categories: ids.flatMap((id) => categoryNames.has(id) ? [{ id, name: categoryNames.get(id)! }] : []), variations }]
  }).sort((a, b) => a.name.localeCompare(b.name))
}

export async function getServices(env: SquareEnv, client: SquareClient = createSquareClient(env)): Promise<ServicesResponse> {
  const url = bookingUrl(env)
  const result = await pages<{ items?: CatalogObject[]; cursor?: string }>((cursor) => client.request('/catalog/search-catalog-items', {
    product_types: ['APPOINTMENTS_SERVICE'], enabled_location_ids: [client.locationId], archived_state: 'ARCHIVED_STATE_NOT_ARCHIVED', sort_order: 'ASC', limit: 100, ...(cursor ? { cursor } : {}),
  }))
  const items = result.flatMap((page) => array(page.items))
  const ids = [...new Set(items.flatMap((item) => [...array(item.item_data?.categories).map((c) => c.id), ...(item.item_data?.category_id ? [item.item_data.category_id] : [])]).filter((id) => text(id)))]
  const categories: CatalogObject[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const page = await client.request<{ objects?: CatalogObject[] }>('/catalog/batch-retrieve', { object_ids: ids.slice(i, i + 100) })
    categories.push(...array(page.objects))
  }
  return { services: mapServices(items, categories, client.locationId), bookingUrl: url }
}
