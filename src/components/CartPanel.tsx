import { useEffect, useRef, useState } from 'react'
import type { CartItem, CheckoutFailure, CheckoutQuote } from '../../shared/checkout'
import { MAX_QUANTITY } from '../../shared/checkout'
import type { Product } from '../../shared/products'
import { formatPrice } from '../money'
import wordmark from '../assets/bestbvnnies-wordmark.svg'

type Review = { status: 'idle' } | { status: 'loading'; key: string }
  | { status: 'error'; key: string; failure: CheckoutFailure }
  | { status: 'ready'; key: string; quote: CheckoutQuote; changedNames: string[] }

export function CartPanel({ items, products, catalogReady, onQuantity, onClose, onValidated }: {
  items: CartItem[]
  products: Product[]
  catalogReady: boolean
  onQuantity: (id: string, quantity: number) => void
  onClose: () => void
  onValidated: (quote: CheckoutQuote) => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const pending = useRef<AbortController | null>(null)
  const [review, setReview] = useState<Review>({ status: 'idle' })
  const key = JSON.stringify(items)
  const current = review.status !== 'idle' && review.key !== key ? { status: 'idle' as const } : review
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
      pending.current?.abort()
      element.close()
      document.body.style.overflow = overflow
      previousFocus?.focus()
    }
  }, [])

  function change(id: string, quantity: number) {
    pending.current?.abort()
    setReview({ status: 'idle' })
    onQuantity(id, quantity)
  }

  async function requestQuote() {
    pending.current?.abort()
    const controller = new AbortController()
    pending.current = controller
    setReview({ status: 'loading', key })
    try {
      const response = await fetch('/api/checkout/quote', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }), signal: controller.signal,
      })
      if (!response.ok) {
        const data = await response.json() as CheckoutFailure
        if (!controller.signal.aborted) setReview({ status: 'error', key, failure: data })
        return
      }
      const quote = await response.json() as CheckoutQuote
      if (!controller.signal.aborted) {
        const changedNames = quote.lines.filter((line) => {
          const old = options.get(line.variationId)?.variation.price
          return old && (old.amount !== line.unitPrice.amount || old.currency !== line.unitPrice.currency)
        }).map((line) => line.name)
        setReview({ status: 'ready', key, quote, changedNames })
        onValidated(quote)
      }
    } catch {
      if (!controller.signal.aborted) setReview({ status: 'error', key, failure: { error: 'We couldn’t reach the shop. Check your connection and try again.' } })
    }
  }

  return <dialog className="cart-panel" ref={dialog} aria-labelledby="cart-title" onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className="cart-header"><img src={wordmark} alt="bestbvnnies" /><button type="button" className="text-button" onClick={onClose} autoFocus>Close bag ×</button></div>
    <div className="cart-content">
      <p className="eyebrow">THE GOOD STUFF</p><h2 id="cart-title">Your bag.</h2>
      {!items.length ? <div className="empty-bag"><h3>A little room for your favorites.</h3><p>Your bag is empty. Explore the collection to find your next set.</p><button className="button" onClick={onClose}>Back to the shop ↗</button></div> : <div className="cart-layout">
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
                  <button onClick={() => change(variationId, quantity - 1)} disabled={quantity <= 1} aria-label={`Decrease quantity of ${name}`}>−</button>
                  <span aria-label={`Quantity ${quantity}`}>{quantity}</span>
                  <button onClick={() => change(variationId, quantity + 1)} disabled={quantity >= limit} aria-label={`Increase quantity of ${name}`}>+</button>
                </div><button className="text-button" onClick={() => change(variationId, 0)} aria-label={`Remove ${name}`}>Remove</button></div>
              </div>
              <strong className="cart-item-total">{found?.variation.price ? formatPrice({ ...found.variation.price, amount: found.variation.price.amount * quantity }) : '—'}</strong>
            </article>
          })}
        </section>
        <section className="checkout-review" aria-label="Checkout review" aria-busy={current.status === 'loading'}>
          <h3>Let’s check the details.</h3>
          <div className="total-row"><span>Estimated item subtotal</span><strong>{estimate !== null ? formatPrice({ amount: estimate, currency: currency! }) : 'Unavailable'}</strong></div>
          <p className="review-note">Prices and stock are checked with Square when you review. Taxes and eligible discounts are calculated then.</p>
          {current.status === 'loading' && <p className="review-message" role="status">Checking your bag with Square…</p>}
          {current.status === 'error' && <div className="review-message" role="alert"><p>{current.failure.error}</p>
            {current.failure.issues?.map((issue, i) => <div className="cart-issue" key={`${issue.variationId}-${i}`}><strong>{options.get(issue.variationId)?.product.name ?? 'An item in your bag'}</strong><p>{issue.message}</p>
              {issue.availableQuantity !== undefined && issue.availableQuantity > 0 && <button className="text-button" onClick={() => change(issue.variationId, Math.min(issue.availableQuantity!, MAX_QUANTITY))}>Use available quantity ({issue.availableQuantity})</button>}
              {(issue.code === 'unavailable' || issue.code === 'price_unavailable' || issue.availableQuantity === 0) && <button className="text-button" onClick={() => change(issue.variationId, 0)}>Remove item</button>}
            </div>)}
          </div>}
          {current.status === 'ready' && <div className="validated-quote">
            <p className="quote-label" role="status">Square-validated checkout total</p>
            {!!current.changedNames.length && <p className="review-message">Prices changed for {current.changedNames.join(', ')}. Your bag now shows the current prices below.</p>}
            <ul className="quote-lines">{current.quote.lines.map((line) => <li key={line.variationId}><span>{line.quantity} × {line.name}{line.variationName && line.variationName !== 'Regular' ? ` — ${line.variationName}` : ''}<small>{formatPrice(line.unitPrice)} each</small></span><strong>{formatPrice({ amount: line.total, currency: current.quote.currency })}</strong></li>)}</ul>
            <div className="total-row"><span>Subtotal before tax & discounts</span><span>{formatPrice({ amount: current.quote.subtotal, currency: current.quote.currency })}</span></div>
            <div className="total-row"><span>Discounts</span><span>−{formatPrice({ amount: current.quote.discount, currency: current.quote.currency })}</span></div>
            <div className="total-row"><span>Tax (including any included tax)</span><span>{formatPrice({ amount: current.quote.tax, currency: current.quote.currency })}</span></div>
            <div className="total-row quote-total"><strong>Total</strong><strong>{formatPrice({ amount: current.quote.total, currency: current.quote.currency })}</strong></div>
            {current.quote.lines.some((line) => !line.inventory.tracked) && <p className="review-note">Square doesn’t track stock quantities for some items in this bag.</p>}
            <p className="review-note">This is a price review, not an order or stock reservation. Shipping or pickup hasn’t been selected. Payment isn’t available yet.</p>
          </div>}
          <button className="button review-button" disabled={current.status === 'loading'} onClick={requestQuote}>{current.status === 'loading' ? 'Checking…' : current.status === 'ready' ? 'Refresh quote ↻' : current.status === 'error' ? 'Try review again ↻' : 'Review with Square ↗'}</button>
          {current.status !== 'ready' && <p className="review-note payment-note">No payment is collected and no order is placed.</p>}
        </section>
      </div>}
    </div>
  </dialog>
}

function CartImage({ url, name }: { url: string | null; name: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  return url && failed !== url ? <img className="cart-image" src={url} alt={name} onError={() => setFailed(url)} /> : <div className="cart-image cart-image-placeholder" role="img" aria-label={`Photo unavailable for ${name}`}><span aria-hidden="true">BB<br />✳</span></div>
}
