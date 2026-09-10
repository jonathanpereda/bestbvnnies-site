import { useEffect, useRef, useState } from 'react'
import type { Buyer, CartItem, CheckoutFailure, CheckoutQuote, FulfillmentMethod, PreparedPurchase, PublicCheckoutConfig, PurchaseResult, QuoteResponse } from '../../shared/checkout'
import { formatPrice } from '../money'
import type { Money } from '../../shared/products'
import { pickup } from '../siteConfig'
import { PaymentForm } from './PaymentForm'

const RECOVERY_KEY = 'bestbvnnies.purchase.v1'
const emptyBuyer: Buyer = { givenName: '', familyName: '', email: '', phone: '', address: { line1: '', line2: '', city: '', region: '', postalCode: '', country: 'US' } }
async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const result = await response.json()
  if (!response.ok) throw result as CheckoutFailure
  return result as T
}

export function CheckoutFlow({ items, onValidated, onLock, onComplete, onQuantity, knownPrices }: {
  knownPrices: Record<string, Money | null>
  items: CartItem[]; onValidated: (quote: CheckoutQuote) => void; onLock: (locked: boolean) => void
  onComplete: (result: Extract<PurchaseResult, { status: 'completed' }>) => void; onQuantity: (id: string, quantity: number) => void
}) {
  const [config, setConfig] = useState<PublicCheckoutConfig | null>(null)
  const [configAttempt, setConfigAttempt] = useState(0)
  const [configError, setConfigError] = useState(false)
  const [method, setMethod] = useState<FulfillmentMethod>('pickup')
  const [buyer, setBuyer] = useState<Buyer>(emptyBuyer)
  const [tipInput, setTipInput] = useState('0')
  const [quote, setQuote] = useState<{ key: string; value: QuoteResponse; changedNames: string[] } | null>(null)
  const [failure, setFailure] = useState<CheckoutFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const [purchase, setPurchase] = useState<PreparedPurchase | null>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(RECOVERY_KEY) ?? 'null'); return saved && typeof saved.purchaseToken === 'string' && typeof saved.reference === 'string' ? saved : null } catch { return null }
  })
  const action = useRef(false)
  const failureFocus = useRef<HTMLDivElement>(null)
  useEffect(() => { if (failure) failureFocus.current?.focus() }, [failure])
  const tipCents = /^\d+(\.\d{1,2})?$/.test(tipInput) ? Math.round(Number(tipInput) * 100) : NaN
  const key = JSON.stringify({ items, fulfillment: method, tipCents })
  const current = quote?.key === key ? quote.value : null
  const contact: Buyer = { givenName: buyer.givenName, familyName: buyer.familyName, email: buyer.email, phone: buyer.phone, ...(method === 'shipping' ? { address: buyer.address } : {}) }
  useEffect(() => {
    onLock(busy || !!purchase)
  }, [busy, purchase, onLock])
  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/checkout/config', { signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error()
      const value = await response.json() as PublicCheckoutConfig
      if (!controller.signal.aborted) { setConfig(value); setConfigError(false) }
    }).catch(() => { if (!controller.signal.aborted) setConfigError(true) })
    return () => controller.abort()
  }, [configAttempt])

  async function review(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || action.current || !config) return
    action.current = true; setBusy(true); setFailure(null); setQuote(null)
    try {
      const value = await post<QuoteResponse>('/api/checkout/quote', { items, fulfillment: method, tipCents })
      const changedNames = value.lines.filter((line) => { const prior = knownPrices[line.variationId]; return prior && (prior.amount !== line.unitPrice.amount || prior.currency !== line.unitPrice.currency) }).map((line) => line.name)
      setQuote({ key, value, changedNames }); onValidated(value)
    } catch (error) { setFailure(error && typeof error === 'object' && 'error' in error ? error as CheckoutFailure : { error: 'We couldn’t calculate your total. Please try again.' }) }
    finally { action.current = false; setBusy(false) }
  }
  function finish(result: PurchaseResult) {
    if (result.status === 'completed') {
      onComplete(result)
      sessionStorage.removeItem(RECOVERY_KEY)
      setPurchase(null)
      return
    }
    setFailure({ error: result.error })
    if (result.status === 'declined' || result.status === 'review_required') {
      sessionStorage.removeItem(RECOVERY_KEY); setPurchase(null); setQuote(null)
    }
  }
  async function recover(statusOnly: boolean) {
    if (!purchase || action.current) return
    action.current = true; setBusy(true); setFailure(null)
    try { finish(await post<PurchaseResult>(statusOnly ? '/api/checkout/status' : '/api/checkout/pay', { purchaseToken: purchase.purchaseToken })) }
    catch { setFailure({ error: 'The result is still unconfirmed. Keep this checkout reference and check again; do not start a second purchase.' }) }
    finally { action.current = false; setBusy(false) }
  }
  async function sourceReady(sourceToken: string, verificationToken?: string) {
    if (!current || action.current) return
    action.current = true; setFailure(null)
    let prepared: PreparedPurchase | null = null
    try {
      prepared = await post<PreparedPurchase>('/api/checkout/prepare', { quoteToken: current.quoteToken, buyer: contact, sourceToken, ...(verificationToken ? { verificationToken } : {}) })
      // Save the encrypted recovery reference before any request that can create an order/charge.
      try { sessionStorage.setItem(RECOVERY_KEY, JSON.stringify(prepared)) } catch { setFailure({ error: 'Enable session storage to keep a safe checkout reference, then try again. No payment was submitted.' }); return }
      setPurchase(prepared)
      finish(await post<PurchaseResult>('/api/checkout/pay', { purchaseToken: prepared.purchaseToken }))
    } catch (error) {
      setFailure(prepared ? { error: 'The payment result is unconfirmed. Use the buttons below to recover this same purchase.' } : error && typeof error === 'object' && 'error' in error ? error as CheckoutFailure : { error: 'Checkout could not start. Please try again.' })
    } finally { action.current = false }
  }
  function changeBuyer(name: keyof Buyer, value: string) { setBuyer((current) => ({ ...current, [name]: value })); setQuote(null) }
  function changeAddress(name: string, value: string) { setBuyer((current) => ({ ...current, address: { ...current.address!, [name]: value } })); setQuote(null) }
  return <section className="checkout-review" aria-label="Checkout">
    <h3>Make it yours.</h3>
    {failure && <div className="review-message" role="alert" tabIndex={-1} ref={failureFocus}><p>{failure.error}</p>{failure.issues?.map((issue, i) => <div className="cart-issue" key={`${issue.variationId}-${i}`}><p>{issue.message}</p>{issue.availableQuantity !== undefined && !purchase && <button className="text-button" onClick={() => { onQuantity(issue.variationId, issue.availableQuantity!); setQuote(null); setFailure(null) }}>{issue.availableQuantity ? `Use available quantity (${issue.availableQuantity})` : 'Remove unavailable item'}</button>}{issue.code === 'unavailable' && !purchase && <button className="text-button" onClick={() => onQuantity(issue.variationId, 0)}>Remove unavailable item</button>}</div>)}</div>}
    {purchase ? <div className="recovery-panel"><h4>Keep this purchase together.</h4><p>Reference: <strong>{purchase.reference}</strong></p><p>We have saved an encrypted recovery reference in this browser tab. A retry uses the same Square payment request.</p><button className="button" disabled={busy} onClick={() => recover(true)}>Check payment status</button><button className="text-button" disabled={busy} onClick={() => recover(false)}>Retry this same purchase</button>{busy && <p role="status">Confirming with Square…</p>}</div> : <>
      {!config && (configError ? <div role="alert"><p>Checkout configuration is temporarily unavailable.</p><button className="text-button" onClick={() => setConfigAttempt((value) => value + 1)}>Retry checkout</button></div> : <p role="status">Loading checkout options…</p>)}
      {config && <>
        <form onSubmit={review}>
          <fieldset disabled={busy} className="checkout-fields">
            <legend>1. How would you like your order?</legend>
            <div className="fulfillment-options"><label><input type="radio" name="fulfillment" value="pickup" checked={method === 'pickup'} onChange={() => { setMethod('pickup'); setQuote(null) }} /> Local pickup · Free</label><label><input type="radio" name="fulfillment" value="shipping" checked={method === 'shipping'} onChange={() => { setMethod('shipping'); setQuote(null) }} /> Shipping · {formatPrice({ amount: config.shippingCents, currency: 'USD' })}</label></div>
            {method === 'pickup' && <div className="pickup-info"><strong>{pickup.name}</strong><address>{pickup.street}<br />{pickup.cityLine}<br /><a href={pickup.phoneHref}>{pickup.phone}</a><br /><a href={`mailto:${pickup.email}`}>{pickup.email}</a></address><details><summary>Pickup hours · Las Vegas time</summary><dl>{pickup.hours.map(([day, hours]) => <div key={day}><dt>{day}</dt><dd>{hours}</dd></div>)}</dl></details><p>Hours are informational. Contact the shop to confirm your order is ready; no time slot is reserved.</p></div>}
          </fieldset>
          <fieldset disabled={busy} className="checkout-fields">
            <legend>2. Your details</legend>
            <div className="form-grid"><label>First name<input autoComplete="given-name" required maxLength={100} value={buyer.givenName} onChange={(event) => changeBuyer('givenName', event.target.value)} /></label><label>Last name<input autoComplete="family-name" required maxLength={100} value={buyer.familyName} onChange={(event) => changeBuyer('familyName', event.target.value)} /></label></div>
            <label>Email<input type="email" autoComplete="email" required maxLength={254} value={buyer.email} onChange={(event) => changeBuyer('email', event.target.value)} /></label>
            <label>Phone<input type="tel" autoComplete="tel" required minLength={7} maxLength={30} pattern="[+0-9 ().\\-]+" value={buyer.phone} onChange={(event) => changeBuyer('phone', event.target.value)} /></label>
            {method === 'shipping' && <>
              <label>Street address<input autoComplete="shipping address-line1" required maxLength={200} value={buyer.address!.line1} onChange={(event) => changeAddress('line1', event.target.value)} /></label>
              <label>Apartment / suite (optional)<input autoComplete="shipping address-line2" maxLength={200} value={buyer.address!.line2} onChange={(event) => changeAddress('line2', event.target.value)} /></label>
              <div className="form-grid"><label>City<input autoComplete="shipping address-level2" required maxLength={100} value={buyer.address!.city} onChange={(event) => changeAddress('city', event.target.value)} /></label><label>State / region<input autoComplete="shipping address-level1" required maxLength={100} value={buyer.address!.region} onChange={(event) => changeAddress('region', event.target.value)} /></label></div>
              <div className="form-grid"><label>Postal code<input autoComplete="shipping postal-code" required maxLength={20} value={buyer.address!.postalCode} onChange={(event) => changeAddress('postalCode', event.target.value)} /></label><label>Country code<input autoComplete="shipping country" required minLength={2} maxLength={2} pattern="[A-Za-z]{2}" value={buyer.address!.country} onChange={(event) => changeAddress('country', event.target.value.toUpperCase())} aria-describedby="country-help" /></label></div><p id="country-help" className="review-note">Two-letter country code, such as US.</p>
            </>}
          </fieldset>
          <fieldset disabled={busy} className="checkout-fields">
            <legend>3. Optional tip</legend><p className="review-note">Always optional. No tip is selected by default.</p>
            <div className="tip-options">{[0, ...config.suggestedTips].map((amount) => <button type="button" key={amount} aria-pressed={tipCents === amount} onClick={() => { setTipInput((amount / 100).toFixed(2)); setQuote(null) }}>{amount ? formatPrice({ amount, currency: 'USD' }) : 'No tip'}</button>)}</div>
            <label>Custom tip (USD)<input inputMode="decimal" type="number" min="0" max={config.maxTipCents / 100} step="0.01" required value={tipInput} onChange={(event) => { setTipInput(event.target.value); setQuote(null) }} /></label>
          </fieldset>
          <button className="button review-button" disabled={busy} type="submit">{busy ? 'Checking…' : 'Review total with Square ↗'}</button>
        </form>
        {current && <div className="validated-quote"><h4>Review your order</h4>{!!quote?.changedNames.length && <p className="review-message">Square updated prices for {quote.changedNames.join(', ')}. The current prices are shown below.</p>}<p role="status">Square-validated total</p><ul className="quote-lines">{current.lines.map((line) => <li key={line.variationId}><span>{line.quantity} × {line.name}{line.variationName && line.variationName !== 'Regular' ? ` — ${line.variationName}` : ''}<small>{formatPrice(line.unitPrice)} each</small></span><strong>{formatPrice({ amount: line.total, currency: current.currency })}</strong></li>)}</ul>
          {[['Subtotal before tax & discounts', current.subtotal], ['Discounts', -current.discount], ['Shipping', current.shipping], ['Tax (including any included tax)', current.tax], ['Optional tip', current.tip]].map(([label, amount]) => <div className="total-row" key={label}><span>{label}</span><span>{formatPrice({ amount: amount as number, currency: current.currency })}</span></div>)}
          <div className="total-row quote-total"><strong>Total to pay</strong><strong>{formatPrice({ amount: current.payableTotal, currency: current.currency })}</strong></div><p className="review-note">Current Square prices are shown above. Review them before paying. Stock is checked again at purchase and is not reserved.</p>
          <PaymentForm key={current.quoteToken} config={config} quote={current} buyer={contact} busy={busy} onBusy={setBusy} onSource={sourceReady} />
        </div>}
      </>}
    </>}
  </section>
}
