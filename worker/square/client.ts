export type SquareEnv = {
  SHIPPING_FLAT_RATE_CENTS?: string
  CHECKOUT_TOKEN_SECRET?: string
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_APPLICATION_ID?: string
  SQUARE_LOCATION_ID?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_STOREFRONT_CATEGORY_ID?: string
}

export class SquareError extends Error {
  kind: 'declined' | 'unavailable'
  status: number
  constructor(status = 502, kind: 'declined' | 'unavailable' = 'unavailable') {
    super(status === 500 ? 'The shop is not configured yet.' : 'The shop is temporarily unavailable. Please try again.')
    this.status = status
    this.kind = kind
  }
}

export function required(value: string | undefined): string {
  if (!value?.trim()) throw new SquareError(500)
  return value.trim()
}

export function createSquareClient(env: SquareEnv, fetcher: typeof fetch = fetch) {
  const token = required(env.SQUARE_ACCESS_TOKEN)
  const environment = required(env.SQUARE_ENVIRONMENT)
  const locationId = required(env.SQUARE_LOCATION_ID)
  if (environment !== 'sandbox' && environment !== 'production') throw new SquareError(500)
  const base = environment === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com'

  async function request<T>(path: string, body?: Record<string, unknown>, method?: 'PUT'): Promise<T> {
    try {
      const response = await fetcher(`${base}/v2${path}`, {
        method: method ?? (body ? 'POST' : 'GET'),
        headers: {
          Authorization: `Bearer ${token}`,
          'Square-Version': '2026-08-19',
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      })
      const data = await response.json() as T & { errors?: { code?: string }[] }
      if (!response.ok || !data || typeof data !== 'object' || data.errors?.length) {
        const declined = response.status >= 400 && response.status < 500 && data?.errors?.some((error) => ['GENERIC_DECLINE', 'CARD_DECLINED', 'CVV_FAILURE', 'ADDRESS_VERIFICATION_FAILURE', 'EXPIRATION_FAILURE', 'CARD_EXPIRED', 'INVALID_CARD', 'INSUFFICIENT_FUNDS', 'CARD_TOKEN_USED', 'VERIFY_CVV_FAILURE', 'VERIFY_AVS_FAILURE'].includes(error.code ?? ''))
        throw new SquareError(502, declined ? 'declined' : 'unavailable')
      }
      return data
    } catch (error) {
      if (error instanceof SquareError) throw error
      // Never expose upstream bodies, credentials, or exception details.
      throw new SquareError()
    }
  }

  return { request, locationId, environment }
}

export type SquareClient = ReturnType<typeof createSquareClient>

// Follow every page, while rejecting repeated cursors instead of looping forever.
export async function pages<T extends { cursor?: string }>(read: (cursor?: string) => Promise<T>): Promise<T[]> {
  const result: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    result.push(page)
    cursor = page.cursor || undefined
    if (cursor && seen.has(cursor)) throw new SquareError()
    if (cursor) seen.add(cursor)
  } while (cursor)
  return result
}
