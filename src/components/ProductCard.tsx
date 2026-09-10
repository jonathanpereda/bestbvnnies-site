import { useState } from 'react'
import type { Inventory, Money, Product } from '../../shared/products'

function formatPrice(price: Money | null): string {
  if (!price) return 'Price unavailable'
  try {
    const formatter = new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency })
    const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
    return formatter.format(price.amount / 10 ** digits)
  } catch { return 'Price unavailable' }
}

function stockLabel(inventory: Inventory): string {
  switch (inventory.status) {
    case 'in_stock': return `${new Intl.NumberFormat('en-US').format(inventory.count)} in stock`
    case 'out_of_stock': return 'Out of stock'
    case 'untracked': return 'Stock not tracked'
    case 'unknown': return 'Stock unavailable'
  }
}

export function ProductCard({ product, index }: { product: Product; index: number }) {
  const [selectedId, setSelectedId] = useState(product.variations[0].id)
  const variation = product.variations.find((entry) => entry.id === selectedId) ?? product.variations[0]
  const [failedImage, setFailedImage] = useState<string | null>(null)
  const image = variation.imageUrl ?? product.imageUrl
  return (
    <article className="product">
      <div className="product-visual">
        <span className="product-index" aria-hidden="true">{String(index + 1).padStart(2, '0')} / BB</span>
        {image && failedImage !== image ? (
          <img src={image} alt={product.name} loading="lazy" width="640" height="720" onError={() => setFailedImage(image)} />
        ) : (
          <div className="image-placeholder" role="img" aria-label={`Photo not available for ${product.name}`}>
            <span className="placeholder-star" aria-hidden="true">✳</span>
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
      </div>
    </article>
  )
}
