import { useState } from 'react'
import type { Inventory, Product } from '../../shared/products'
import type { CartItem } from '../../shared/checkout'
import { MAX_CART_LINES, MAX_QUANTITY } from '../../shared/checkout'
import { formatPrice } from '../money'

function stockLabel(inventory: Inventory): string {
  switch (inventory.status) {
    case 'in_stock': return `${new Intl.NumberFormat('en-US').format(inventory.count)} in stock`
    case 'out_of_stock': return 'Out of stock'
    case 'untracked': return 'Stock not tracked'
    case 'unknown': return 'Stock unavailable'
  }
}

export function ProductCard({ product, index, items, onAdd }: { product: Product; index: number; items: CartItem[]; onAdd: (id: string) => void }) {
  const [selectedId, setSelectedId] = useState(product.variations[0].id)
  const variation = product.variations.find((entry) => entry.id === selectedId) ?? product.variations[0]
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const image = variation.imageUrl ?? product.imageUrl
  const inCart = items.find((item) => item.variationId === variation.id)?.quantity ?? 0
  const limit = variation.inventory.status === 'in_stock' ? Math.min(MAX_QUANTITY, Math.floor(variation.inventory.count)) : MAX_QUANTITY
  const canAdd = !!variation.price && ['in_stock', 'untracked'].includes(variation.inventory.status) && inCart < limit && (inCart > 0 || items.length < MAX_CART_LINES)
  return (
    <article className="product">
      <div className="product-visual">
        <span className="product-index" aria-hidden="true">{String(index + 1).padStart(2, '0')} / BB</span>
        {image && failedImage !== image ? (
          <img src={image} alt={product.name} loading="lazy" width="640" height="720" onError={() => setFailedImage(image)} />
        ) : (
          <div className="image-placeholder" role="img" aria-label={`Photo not available for ${product.name}`}>
            <span className="placeholder-star" aria-hidden="true">✳︎</span>
            <span className="placeholder-type" aria-hidden="true">ALL<br />NAILS.<br />ALL YOU.</span>
            <span className="photo-note">Photo coming soon</span>
          </div>
        )}
      </div>
      <div className="product-info">
        <div className="product-title-row"><h3>{product.name}</h3><span className="price">{formatPrice(variation.price)}</span></div>
        {product.description && <p className="product-description">{product.description}</p>}
        {product.variations.length > 1 ? (
          <label className="variation-label">Style / size
            <select value={variation.id} onChange={(event) => setSelectedId(event.target.value)}>
              {product.variations.map((entry, i) => <option key={entry.id} value={entry.id}>{entry.name ?? `Option ${i + 1}`}</option>)}
            </select>
          </label>
        ) : variation.name && variation.name !== 'Regular' && <p className="variation-name">{variation.name}</p>}
        <p className={`stock stock--${variation.inventory.status}`}><span aria-hidden="true">●</span> {stockLabel(variation.inventory)}</p>
        <button className="button add-button" disabled={!canAdd} onClick={() => onAdd(variation.id)} aria-label={`Add ${product.name}${variation.name && variation.name !== 'Regular' ? ` — ${variation.name}` : ''} to bag`}>{canAdd ? inCart ? `Add another · ${inCart} in bag` : 'Add to bag +' : inCart >= limit ? 'Available quantity in bag' : 'Currently unavailable'}</button>
      </div>
    </article>
  )
}
