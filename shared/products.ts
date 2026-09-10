export type Money = { amount: number; currency: string }
export type Inventory =
  | { status: 'in_stock' | 'out_of_stock'; count: number; tracked: boolean }
  | { status: 'untracked' | 'unknown'; count: null; tracked: boolean }

export type ProductVariation = {
  id: string
  name: string | null
  price: Money | null
  imageUrl: string | null
  inventory: Inventory
}

export type Product = {
  id: string
  name: string
  description: string | null
  imageUrl: string | null
  variations: ProductVariation[]
}

export type ProductsResponse = {
  products: Product[]
  inventoryUnavailable: boolean
}
