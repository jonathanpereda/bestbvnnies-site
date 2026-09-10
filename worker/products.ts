import type { Inventory, Money, Product, ProductVariation, ProductsResponse } from '../shared/products.ts'
import { createSquareClient, pages, required, SquareError } from './square/client.ts'
import type { SquareClient, SquareEnv } from './square/client.ts'
import { imageUrl, presentAt } from './square/catalog.ts'
import type { CatalogObject, InventoryCount } from './square/catalog.ts'

type CatalogPage = { items?: CatalogObject[]; cursor?: string }
type CountPage = { counts?: InventoryCount[]; cursor?: string }

function chunks<T>(values: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, i) => values.slice(i * size, (i + 1) * size))
}

function fixedPrice(pricingType: string | undefined, money: Money | undefined): Money | null {
  if (pricingType !== 'FIXED_PRICING' || !money || !Number.isSafeInteger(money.amount) || money.amount < 0 || !/^[A-Z]{3}$/.test(money.currency)) return null
  return { amount: money.amount, currency: money.currency }
}

export function inventoryFor(variation: CatalogObject, locationId: string, counts: Map<string, InventoryCount>, now = Date.now()): Inventory {
  const data = variation.item_variation_data!
  const override = data.location_overrides?.find((entry) => entry.location_id === locationId)
  const tracked = override?.track_inventory ?? data.track_inventory ?? false
  const until = override?.sold_out_valid_until ? Date.parse(override.sold_out_valid_until) : NaN
  if (override?.sold_out && (!Number.isFinite(until) || until > now)) return { status: 'out_of_stock', count: 0, tracked }
  if (!tracked) return { status: 'untracked', count: null, tracked: false }
  const raw = counts.get(variation.id)?.quantity
  if (raw === undefined || !/^-?\d+(\.\d+)?$/.test(raw)) return { status: 'unknown', count: null, tracked: true }
  const count = Number(raw)
  if (!Number.isFinite(count) || Math.abs(count) > Number.MAX_SAFE_INTEGER) return { status: 'unknown', count: null, tracked: true }
  return { status: count > 0 ? 'in_stock' : 'out_of_stock', count: Math.max(0, count), tracked: true }
}

export async function getProducts(env: SquareEnv, client: SquareClient = createSquareClient(env)): Promise<ProductsResponse> {
  const categoryId = required(env.SQUARE_STOREFRONT_CATEGORY_ID)
  const { locationId, request } = client
  // A missing/deleted category is a configuration error, not an empty collection.
  const category = await request<{ object?: CatalogObject }>(`/catalog/object/${encodeURIComponent(categoryId)}`)
  if (!category.object || category.object.type !== 'CATEGORY' || category.object.is_deleted) throw new SquareError(500)
  const catalogPages = await pages<CatalogPage>((cursor) => request('/catalog/search-catalog-items', {
    category_ids: [categoryId], enabled_location_ids: [locationId],
    product_types: ['REGULAR'], archived_state: 'ARCHIVED_STATE_NOT_ARCHIVED',
    sort_order: 'ASC', limit: 100, ...(cursor ? { cursor } : {}),
  }))
  const items = [...new Map(catalogPages.flatMap((page) => page.items ?? []).map((item) => [item.id, item])).values()]
    .filter((item) => item.type === 'ITEM' && presentAt(item, locationId) && item.item_data?.name?.trim()
      && !item.item_data.is_archived && (item.item_data.product_type ?? 'REGULAR') === 'REGULAR'
      && (item.item_data.categories?.some((category) => category.id === categoryId) || item.item_data.category_id === categoryId))
  const eligible = (item: CatalogObject) => (item.item_data?.variations ?? []).filter((variation) =>
    variation.type === 'ITEM_VARIATION' && presentAt(variation, locationId) && variation.item_variation_data && variation.item_variation_data.sellable !== false)
  const variations = items.flatMap(eligible)
  const imageIds = [...new Set([...items.flatMap((item) => item.item_data?.image_ids ?? []), ...variations.flatMap((variation) => variation.item_variation_data?.image_ids ?? [])])]
  const images = new Map<string, string>()
  for (const ids of chunks(imageIds, 100)) {
    const result = await request<{ objects?: CatalogObject[] }>('/catalog/batch-retrieve', { object_ids: ids })
    for (const image of result.objects ?? []) {
      if (image.type === 'IMAGE' && !image.is_deleted && image.image_data?.url) images.set(image.id, image.image_data.url)
    }
  }
  const trackedIds = variations.filter((variation) => {
    const data = variation.item_variation_data!
    return data.location_overrides?.find((override) => override.location_id === locationId)?.track_inventory ?? data.track_inventory ?? false
  }).map((variation) => variation.id)
  const counts = new Map<string, InventoryCount>()
  let inventoryUnavailable = false
  try {
    for (const ids of chunks(trackedIds, 1000)) {
      const inventoryPages = await pages<CountPage>((cursor) => request('/inventory/counts/batch-retrieve', {
        catalog_object_ids: ids, location_ids: [locationId], states: ['IN_STOCK'], limit: 1000, ...(cursor ? { cursor } : {}),
      }))
      for (const count of inventoryPages.flatMap((page) => page.counts ?? [])) {
        if (count.location_id !== locationId || count.state !== 'IN_STOCK') continue
        const previous = counts.get(count.catalog_object_id)
        if (!previous || (count.calculated_at ?? '') >= (previous.calculated_at ?? '')) counts.set(count.catalog_object_id, count)
      }
    }
  } catch {
    // A stock outage must never turn every product into "sold out" or "in stock".
    counts.clear()
    inventoryUnavailable = true
  }
  const products: Product[] = items.flatMap((item) => {
    const data = item.item_data!
    const itemImage = imageUrl(data.image_ids ?? [], images)
    const mapped: ProductVariation[] = eligible(item).map((variation) => {
      const value = variation.item_variation_data!
      const override = value.location_overrides?.find((entry) => entry.location_id === locationId)
      return {
        id: variation.id, name: value.name?.trim() || null,
        price: fixedPrice(override?.pricing_type ?? value.pricing_type, override?.price_money ?? value.price_money),
        imageUrl: imageUrl(value.image_ids ?? [], images) ?? itemImage,
        inventory: inventoryFor(variation, locationId, counts),
      }
    })
    if (!mapped.length) return []
    return [{ id: item.id, name: data.name!.trim(), description: data.description_plaintext?.trim() || data.description?.trim() || null,
      imageUrl: itemImage ?? mapped.find((variation) => variation.imageUrl)?.imageUrl ?? null, variations: mapped }]
  })
  return { products, inventoryUnavailable }
}
