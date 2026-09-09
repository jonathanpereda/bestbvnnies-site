type AppEnv = Env & {
  SQUARE_ACCESS_TOKEN: string
  SQUARE_APPLICATION_ID: string
  SQUARE_LOCATION_ID: string
  SQUARE_ENVIRONMENT: string
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'ok',
        service: 'bestbvnnies-site',
      })
    }

    if (url.pathname === '/api/square/location') {
      const squareUrl =
        `https://connect.squareupsandbox.com/v2/locations/${env.SQUARE_LOCATION_ID}`

      const response = await fetch(squareUrl, {
        headers: {
          Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
          'Square-Version': '2026-08-19',
        },
      })

      const data = await response.json()

      return Response.json(data, {
        status: response.status,
      })
    }

    return new Response(null, { status: 404 })
  },
} satisfies ExportedHandler<AppEnv>