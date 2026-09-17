import { useEffect, useRef, useState } from 'react'
import type { CartItem, CheckoutQuote, PurchaseResult } from '../../shared/checkout'
import { MAX_QUANTITY } from '../../shared/checkout'
import type { Product } from '../../shared/products'
import { formatPrice } from '../money'
import wordmark from '../assets/bestbvnnies-wordmark.svg'
import { CheckoutFlow } from './CheckoutFlow'

export function CartPanel({ items, products, catalogReady, onQuantity, onClose, onValidated, onPurchased }: {
  items: CartItem[]
  products: Product[]
  catalogReady: boolean
  onQuantity: (id: string, quantity: number) => void
  onClose: () => void
  onValidated: (quote: CheckoutQuote) => void
  onPurchased: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const [locked, setLocked] = useState(false)
  const [receipt, setReceipt] = useState<Extract<PurchaseResult, { status: 'completed' }> | null>(null)
  const options = new Map(products.flatMap((product) => product.variations.map((variation) => [variation.id, { product, variation }] as const)))
  const estimates = items.map((item) => ({ ...item, found: options.get(item.variationId) }))
  const currency = estimates[0]?.found?.variation.price?.currency
  const canEstimate = !!currency && estimates.every((line) => line.found?.variation.price?.currency === currency)
  const estimate = canEstimate ? estimates.reduce((sum, line) => sum + line.found!.variation.price!.amount * line.quantity, 0) : null
  useEffect(() => {
    const element = dialog.current!
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    element.showModal()
    return () => {
      element.close()
      document.body.style.overflow = overflow
      previousFocus?.focus()
    }
  }, [])

  function change(id: string, quantity: number) { if (!locked) onQuantity(id, quantity) }

  return <dialog className="cart-panel" ref={dialog} aria-labelledby="cart-title" onCancel={(event) => { event.preventDefault(); if (!locked) onClose() }}>
    <div className="cart-header"><img src={wordmark} alt="bestbvnnies" /><button type="button" className="text-button" onClick={onClose} disabled={locked} autoFocus>Close bag ×</button></div>
    <div className="cart-content">
      <p className="eyebrow">THE GOOD STUFF</p><h2 id="cart-title">Your bag.</h2>
      {receipt ? <div className="order-confirmation" role="status"><h3>Order confirmed. Thank you!</h3><p>Your payment of {formatPrice({ amount: receipt.total, currency: receipt.currency })} was successful.</p><p>Order reference: <strong>{receipt.orderReference}</strong></p><p>{receipt.fulfillment === 'shipping' ? 'Your order is with the shop for shipping.' : 'Your order is with the shop for local pickup. Contact us to confirm readiness.'}</p><button className="button" onClick={onClose}>Back to the shop</button></div> : !items.length ? <div className="empty-bag"><h3>A little room for your favorites.</h3><p>Your bag is empty. Explore the collection to find your next set.</p><button className="button" onClick={onClose}>Back to the shop ↗︎</button></div> : <div className="cart-layout">
        <section aria-label="Bag items" className="cart-items">
          {estimates.map(({ variationId, quantity, found }, index) => {
            const name = found?.product.name ?? (catalogReady ? `Unavailable item ${index + 1}` : `Saved item ${index + 1}`)
            const stock = found?.variation.inventory
            const limit = stock?.status === 'in_stock' ? Math.min(MAX_QUANTITY, Math.floor(stock.count)) : stock?.status === 'out_of_stock' ? 0 : MAX_QUANTITY
            return <article className="cart-item" key={variationId}>
              <CartImage url={found?.variation.imageUrl ?? found?.product.imageUrl ?? null} name={name} />
              <div className="cart-item-details"><h3>{name}</h3>
                {found?.variation.name && found.variation.name !== 'Regular' && <p>{found.variation.name}</p>}
                <p>{formatPrice(found?.variation.price ?? null)} each</p>
                {!found && <p className="cart-item-note">{catalogReady ? 'This option is no longer in the collection. Remove it or check again.' : 'Product details are unavailable. You can still request a fresh review.'}</p>}
                <div className="quantity-row"><div className="quantity-control" role="group" aria-label={`Quantity for ${name}`}>
                  <button onClick={() => change(variationId, quantity - 1)} disabled={locked || quantity <= 1} aria-label={`Decrease quantity of ${name}`}>−</button>
                  <span aria-label={`Quantity ${quantity}`}>{quantity}</span>
                  <button onClick={() => change(variationId, quantity + 1)} disabled={locked || quantity >= limit} aria-label={`Increase quantity of ${name}`}>+</button>
                </div><button className="text-button" onClick={() => change(variationId, 0)} disabled={locked} aria-label={`Remove ${name}`}>Remove</button></div>
              </div>
              <strong className="cart-item-total">{found?.variation.price ? formatPrice({ ...found.variation.price, amount: found.variation.price.amount * quantity }) : '—'}</strong>
            </article>
          })}
        </section>
        <div><div className="cart-estimate"><span>Estimated item subtotal</span><strong>{estimate !== null ? formatPrice({ amount: estimate, currency: currency! }) : 'Unavailable'}</strong></div>
          <CheckoutFlow knownPrices={Object.fromEntries(estimates.map((line) => [line.variationId, line.found?.variation.price ?? null]))} items={items} onValidated={onValidated} onLock={setLocked} onQuantity={change} onComplete={(result) => { setReceipt(result); onPurchased(); setLocked(false) }} />
        </div>
      </div>}
    </div>
  </dialog>
}

function CartImage({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return url && failed !== url ? <img className="cart-image" src={url} alt={name} onError={() => setFailed(url)} /> : <div className="cart-image cart-image-placeholder" role="img" aria-label={`Photo unavailable for ${name}`}><span aria-hidden="true">BB<br />✳︎</span></div>
}
