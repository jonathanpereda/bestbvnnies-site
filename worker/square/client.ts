export type SquareEnv = {
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_APPLICATION_ID?: string
  SQUARE_LOCATION_ID?: string
  SQUARE_ENVIRONMENT?: string
  SQUARE_STOREFRONT_CATEGORY_ID?: string
}

export class SquareError extends Error {
  status: number
  constructor(status = 502) {
    super(status === 500 ? 'The shop is not configured yet.' : 'The shop is temporarily unavailable. Please try again.')
    this.status = status
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

  async function request<T>(path: string, body?: Record<string, unknown>): Promise<T> {
    try {
      const response = await fetcher(`${base}/v2${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'Square-Version': '2026-08-19',
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(10_000),
      })
      if (!response.ok) throw new SquareError()
      const data = await response.json() as T & { errors?: unknown[] }
      if (!data || typeof data !== 'object' || data.errors?.length) throw new SquareError()
      return data
    } catch {
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
