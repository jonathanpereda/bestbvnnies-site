type AppEnv = Env & {
  SQUARE_ACCESS_TOKEN?: string
  SQUARE_APPLICATION_ID?: string
  SQUARE_LOCATION_ID?: string
  SQUARE_ENVIRONMENT?: string
}

export default {
  async fetch(request, env): Promise<Response> {
    const { pathname } = new URL(request.url)
    const isHealth = pathname === '/api/health'
    const isSquareCheck = import.meta.env.DEV && pathname === '/api/square/location'

    if (!isHealth && !isSquareCheck) {
      return new Response(null, { status: 404 })
    }

    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed. Use GET.' }, {
        status: 405,
        headers: { Allow: 'GET' },
      })
    }

    if (isHealth) {
      return Response.json({ status: 'ok', service: 'bestbvnnies-site' })
    }

    const requiredVariables = [
      'SQUARE_ACCESS_TOKEN',
      'SQUARE_LOCATION_ID',
      'SQUARE_ENVIRONMENT',
    ] as const
    const missing = requiredVariables.filter((key) => !env[key]?.trim())

    if (missing.length > 0) {
      return Response.json({ error: `Missing required Square variables: ${missing.join(', ')}.` }, { status: 500 })
    }

    if (env.SQUARE_ENVIRONMENT !== 'sandbox') {
      return Response.json({ error: 'SQUARE_ENVIRONMENT must be sandbox.' }, { status: 500 })
    }

    try {
      const locationId = encodeURIComponent(env.SQUARE_LOCATION_ID!.trim())
      const response = await fetch(`https://connect.squareupsandbox.com/v2/locations/${locationId}`, {
        headers: {
          Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN!.trim()}`,
          'Square-Version': '2026-08-19',
        },
        signal: AbortSignal.timeout(10_000),
      })

      // Do not forward upstream bodies or exception details: this is only a connectivity check.
      if (!response.ok) {
        return Response.json({ error: 'Square Sandbox rejected the connectivity check.', upstreamStatus: response.status }, { status: 502 })
      }

      return Response.json({ status: 'ok', service: 'square-sandbox' }, {
        headers: { 'Cache-Control': 'no-store' },
      })
    } catch {
      return Response.json({ error: 'Unable to reach Square Sandbox. Try again shortly.' }, { status: 502 })
    }
  },
} satisfies ExportedHandler<AppEnv>
