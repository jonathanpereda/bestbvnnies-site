import type { Buyer, PublicCheckoutConfig } from '../../shared/checkout'
export type TokenResult = { status: string; token?: string }
export type PaymentMethod = { tokenize: (details?: Record<string, unknown>) => Promise<TokenResult>; destroy: () => Promise<boolean>; attach?: (selector: string, options?: Record<string, unknown>) => Promise<void> }
export type SquarePayments = {
  card: () => Promise<PaymentMethod>
  paymentRequest: (options: Record<string, unknown>) => unknown
  applePay: (request: unknown) => Promise<PaymentMethod>
  googlePay: (request: unknown) => Promise<PaymentMethod>
  verifyBuyer: (source: string, details: Record<string, unknown>) => Promise<{ token: string } | null>
}
declare global { interface Window { Square?: { payments: (app: string, location: string) => SquarePayments } } }
let loading: Promise<void> | undefined
let loadedUrl: string | undefined
export async function loadSquare(config: PublicCheckoutConfig): Promise<SquarePayments> {
  if (loadedUrl && loadedUrl !== config.sdkUrl) throw new Error('Environment changed; refresh required')
  if (!loading) {
    loadedUrl = config.sdkUrl
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script')
      script.src = config.sdkUrl
      script.async = true
      const timeout = window.setTimeout(() => { script.remove(); loading = undefined; reject(new Error('SDK load timeout')) }, 15_000)
      script.onload = () => { clearTimeout(timeout); resolve() }
      script.onerror = () => { clearTimeout(timeout); script.remove(); loading = undefined; reject(new Error('SDK unavailable')) }
      document.head.append(script)
    })
  }
  await loading
  if (!window.Square) throw new Error('SDK unavailable')
  return window.Square.payments(config.applicationId, config.locationId)
}
export function verification(buyer: Buyer, amount: number, currency: string) {
  return { amount: (amount / 100).toFixed(2), currencyCode: currency, intent: 'CHARGE', customerInitiated: true, sellerKeyedIn: false,
    billingContact: { givenName: buyer.givenName, familyName: buyer.familyName, email: buyer.email, phone: buyer.phone } }
}
