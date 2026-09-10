import { useEffect, useRef, useState } from 'react'
import type { Buyer, PublicCheckoutConfig, QuoteResponse } from '../../shared/checkout'
import { loadSquare, verification } from '../checkout/square-sdk'
import type { PaymentMethod, SquarePayments } from '../checkout/square-sdk'
import { formatPrice } from '../money'

export function PaymentForm({ config, quote, buyer, busy, onBusy, onSource }: { config: PublicCheckoutConfig; quote: QuoteResponse; buyer: Buyer; busy: boolean; onBusy: (value: boolean) => void; onSource: (source: string, verificationToken?: string) => Promise<void> }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [message, setMessage] = useState('')
  const [appleReady, setAppleReady] = useState(false)
  const [googleReady, setGoogleReady] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const methods = useRef<{ payments?: SquarePayments; card?: PaymentMethod; apple?: PaymentMethod; google?: PaymentMethod }>({})
  const active = useRef(false)
  useEffect(() => {
    let disposed = false
    const instances: PaymentMethod[] = []
    async function initialize() {
      try {
        const payments = await loadSquare(config)
        if (disposed) return
        methods.current.payments = payments
        const card = await payments.card()
        instances.push(card)
        if (disposed) { await card.destroy(); return }
        await card.attach!('#square-card')
        methods.current.card = card
        if (!disposed) setState('ready')
        const request = () => payments.paymentRequest({ countryCode: 'US', currencyCode: quote.currency, total: { label: 'Best Bvnnies', amount: (quote.payableTotal / 100).toFixed(2) } })
        try {
          const apple = await payments.applePay(request())
          instances.push(apple)
          if (disposed) await apple.destroy()
          else { methods.current.apple = apple; setAppleReady(true) }
        } catch { /* Unsupported/unregistered Apple Pay is omitted. */ }
        try {
          const google = await payments.googlePay(request())
          instances.push(google)
          if (disposed) { await google.destroy(); return }
          await google.attach!('#square-google-pay', { buttonType: 'pay', buttonColor: 'black' })
          methods.current.google = google
          if (!disposed) setGoogleReady(true)
        } catch { /* Card remains available when the wallet is unsupported. */ }
      } catch { if (!disposed) setState('error') }
    }
    void initialize()
    return () => { disposed = true; methods.current = {}; for (const method of instances) void method.destroy().catch(() => {}) }
  }, [config, quote.currency, quote.payableTotal, attempt])

  async function tokenize(method: 'card' | 'apple' | 'google') {
    if (busy || active.current || !methods.current[method]) return
    active.current = true
    onBusy(true)
    setMessage('')
    try {
      // Wallet tokenize runs directly within the click handler, before any network await.
      const result = await methods.current[method]!.tokenize(method === 'card' ? verification(buyer, quote.payableTotal, quote.currency) : undefined)
      if (result.status !== 'OK' || !result.token) { setMessage('Payment details weren’t submitted. Check the Square form or try another method.'); return }
      let verified: string | undefined
      if (method !== 'card') verified = (await methods.current.payments!.verifyBuyer(result.token, verification(buyer, quote.payableTotal, quote.currency)))?.token
      await onSource(result.token, verified)
    } catch { setMessage('Payment details could not be confirmed. Please try again.') }
    finally { active.current = false; onBusy(false) }
  }
  return <section className="payment-form" aria-label="Payment">
    <h3>Payment</h3>
    {config.environment === 'sandbox' && <p className="sandbox-note">Sandbox checkout · test payments only</p>}
    <p className="review-note">Square securely handles your payment details.</p>
    {state === 'loading' && <p role="status">Loading secure payment form…</p>}
    {state === 'error' && <div role="alert"><p>Secure payment entry couldn’t load.</p><button className="text-button" onClick={() => { setState('loading'); setAttempt((value) => value + 1) }}>Retry payment form</button></div>}
    <div id="square-card" inert={busy} aria-label="Square secure card entry" className={busy ? 'payment-input-busy' : ''} />
    <button className="button review-button" disabled={busy || state !== 'ready'} onClick={() => tokenize('card')}>{busy ? 'Processing…' : `Pay ${formatPrice({ amount: quote.payableTotal, currency: quote.currency })} by card`}</button>
    {appleReady && <button aria-label="Pay with Apple Pay" className="apple-pay-button" disabled={busy} onClick={() => tokenize('apple')} />}
    <div id="square-google-pay" className={`google-pay-container ${!googleReady ? 'wallet-hidden' : ''} ${busy ? 'payment-input-busy' : ''}`} inert={busy} onClick={() => tokenize('google')} />
    {message && <p role="alert" className="review-message">{message}</p>}
  </section>
}
