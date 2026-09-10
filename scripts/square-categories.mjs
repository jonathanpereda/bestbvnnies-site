import { loadEnvFile } from 'node:process'
import { createSquareClient, pages } from '../worker/square/client.ts'

try {
  loadEnvFile('.dev.vars')
  if (process.env.SQUARE_ENVIRONMENT !== 'sandbox') throw new Error('Sandbox required')
  const client = createSquareClient(process.env)
  const results = await pages((cursor) => client.request(`/catalog/list?types=CATEGORY${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`))
  for (const object of results.flatMap((page) => page.objects ?? [])) {
    if (!object.is_deleted && object.type === 'CATEGORY') console.log(JSON.stringify({ name: object.category_data?.name, id: object.id }))
  }
} catch {
  console.error('Could not list Sandbox categories. Check .dev.vars, Sandbox credentials, and network access. No credentials were printed.')
  process.exitCode = 1
}
