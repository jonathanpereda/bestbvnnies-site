import type { Money } from '../../shared/products.ts'

// Only fields needed by the storefront, not the full Square catalog schema.
export type CatalogObject = {
  id: string
  type: string
  is_deleted?: boolean
  present_at_all_locations?: boolean
  present_at_location_ids?: string[]
  absent_at_location_ids?: string[]
  item_data?: {
    name?: string
    description?: string
    description_plaintext?: string
    product_type?: string
    is_archived?: boolean
    category_id?: string
    categories?: { id: string }[]
    image_ids?: string[]
    variations?: CatalogObject[]
  }
  category_data?: { name?: string }
  image_data?: { url?: string }
  item_variation_data?: {
    name?: string
    sellable?: boolean
    pricing_type?: string
    price_money?: Money
    track_inventory?: boolean
    image_ids?: string[]
    location_overrides?: {
      location_id: string
      price_money?: Money
      pricing_type?: string
      track_inventory?: boolean
      sold_out?: boolean
      sold_out_valid_until?: string
    }[]
  }
}

export type InventoryCount = {
  catalog_object_id: string
  location_id: string
  state: string
  quantity: string
  calculated_at?: string
}

export function presentAt(object: CatalogObject, locationId: string): boolean {
  if (object.is_deleted) return false
  return object.present_at_all_locations !== false
    ? !object.absent_at_location_ids?.includes(locationId)
    : !!object.present_at_location_ids?.includes(locationId)
}

export function imageUrl(ids: string[], images: Map<string, string>): string | null {
  for (const id of ids) {
    const value = images.get(id)
    if (!value) continue
    try {
      const url = new URL(value)
      if (url.protocol === 'https:' && !url.username && !url.password) return url.href
    } catch { /* Missing/invalid images use the branded placeholder. */ }
  }
  return null
}
