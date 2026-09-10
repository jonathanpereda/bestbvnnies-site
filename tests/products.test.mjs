import assert from 'node:assert/strict'
import test from 'node:test'
import { createSquareClient, SquareError } from '../worker/square/client.ts'
import { getProducts, inventoryFor } from '../worker/products.ts'
import { presentAt } from '../worker/square/catalog.ts'
import { handleApi } from '../worker/api.ts'

const env = { SQUARE_ACCESS_TOKEN: 'secret-fixture', SQUARE_LOCATION_ID: 'location', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_STOREFRONT_CATEGORY_ID: 'category' }
const variation = (id = 'variation', data = {}, extra = {}) => ({ id, type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: { amount: 2500, currency: 'USD' }, track_inventory: true, ...data }, ...extra })
const item = (id = 'item', data = {}, extra = {}) => ({ id, type: 'ITEM', item_data: { name: `Product ${id}`, categories: [{ id: 'category' }], variations: [variation()], ...data }, ...extra })
const category = { object: { id: 'category', type: 'CATEGORY' } }
function mockClient(responder) {
  return createSquareClient(env, async (url, options) => Response.json(await responder(new URL(url).pathname, options.body ? JSON.parse(options.body) : undefined)))
}

test('catalog and inventory pagination, category filtering, normalized shape, and location overrides', async () => {
  const requests = []
  const client = mockClient((path, body) => {
    requests.push({ path, body })
    if (path.includes('/catalog/object/')) return category
    if (path.endsWith('search-catalog-items')) {
      assert.deepEqual(body.category_ids, ['category'])
      assert.deepEqual(body.enabled_location_ids, ['location'])
      return body.cursor ? { items: [item('second', { variations: [variation('untracked', { track_inventory: false })] })] } : {
        cursor: 'catalog-next', items: [item('first', { description_plaintext: 'Plain description', image_ids: ['image'], variations: [variation('variation', { location_overrides: [{ location_id: 'location', price_money: { amount: 3000, currency: 'USD' } }] })] }), item('private', { categories: [{ id: 'other-category' }] })],
      }
    }
    if (path.endsWith('batch-retrieve') && path.includes('catalog')) return { objects: [{ id: 'image', type: 'IMAGE', image_data: { url: 'https://example.com/product.png' } }] }
    if (path.includes('/inventory/')) return body.cursor ? { counts: [{ catalog_object_id: 'variation', location_id: 'location', state: 'IN_STOCK', quantity: '4' }] } : { cursor: 'inventory-next', counts: [{ catalog_object_id: 'variation', location_id: 'other-location', state: 'IN_STOCK', quantity: '99' }] }
    assert.fail('Unexpected request')
  })
  const result = await getProducts(env, client)
  assert.equal(result.products.length, 2)
  assert.deepEqual(result.products[0].variations[0], { id: 'variation', name: 'Regular', price: { amount: 3000, currency: 'USD' }, imageUrl: 'https://example.com/product.png', inventory: { status: 'in_stock', count: 4, tracked: true } })
  assert.equal(result.products[0].description, 'Plain description')
  assert.equal(result.products[1].variations[0].inventory.status, 'untracked')
  assert.equal(requests.filter((r) => r.path.includes('/inventory/')).length, 2)
  assert.equal(JSON.stringify(result).includes('secret-fixture'), false)
})

test('exclude archived, deleted, wrong-location and non-sellable entries; omit items without variations', async () => {
  const result = await getProducts(env, mockClient((path) => path.includes('/catalog/object/') ? category : {
    items: [item('archived', { is_archived: true }), item('deleted', {}, { is_deleted: true }), item('elsewhere', {}, { present_at_all_locations: false, present_at_location_ids: ['elsewhere'] }), item('empty', { variations: [] }), item('invalid', { variations: [variation('not-sellable', { sellable: false }), variation('deleted-var', {}, { is_deleted: true }), variation('absent', {}, { absent_at_location_ids: ['location'] })] })],
  }))
  assert.deepEqual(result, { products: [], inventoryUnavailable: false })
})

test('location presence follows the active inclusion or exclusion list only', () => {
  assert.equal(presentAt({ ...item(), present_at_location_ids: ['elsewhere'] }, 'location'), true)
  assert.equal(presentAt({ ...item(), present_at_all_locations: false, present_at_location_ids: ['location'], absent_at_location_ids: ['location'] }, 'location'), true)
})

test('unknown inventory is not zero; explicit zero and negative inventory are out of stock', () => {
  assert.equal(inventoryFor(variation(), 'location', new Map()).status, 'unknown')
  for (const quantity of ['0', '-1']) assert.equal(inventoryFor(variation(), 'location', new Map([['variation', { quantity }]])).status, 'out_of_stock')
  for (const quantity of ['', 'NaN', 'Infinity']) assert.equal(inventoryFor(variation(), 'location', new Map([['variation', { quantity }]])).status, 'unknown')
  assert.equal(inventoryFor(variation('variation', { location_overrides: [{ location_id: 'location', track_inventory: false }] }), 'location', new Map()).status, 'untracked')
})

test('manual sold-out flag overrides positive counts but expires at the specified time', () => {
  const v = variation('variation', { location_overrides: [{ location_id: 'location', sold_out: true, sold_out_valid_until: '2030-01-01T00:00:00Z' }] })
  const counts = new Map([['variation', { quantity: '5' }]])
  assert.equal(inventoryFor(v, 'location', counts, Date.parse('2029-01-01')).count, 0)
  assert.equal(inventoryFor(v, 'location', counts, Date.parse('2031-01-01')).count, 5)
})

test('stock API failures preserve products with unknown inventory', async () => {
  const result = await getProducts(env, mockClient((path) => {
    if (path.includes('/catalog/object/')) return category
    if (path.includes('/inventory/')) throw new Error('secret-fixture')
    return { items: [item()] }
  }))
  assert.equal(result.inventoryUnavailable, true)
  assert.equal(result.products[0].variations[0].inventory.status, 'unknown')
})

test('missing images, descriptions and variable prices remain explicit without fabricated data', async () => {
  const result = await getProducts(env, mockClient((path) => path.includes('/catalog/object/') ? category : {
    items: [item('minimal', { variations: [variation('v', { track_inventory: false, location_overrides: [{ location_id: 'location', pricing_type: 'VARIABLE_PRICING' }] })] })],
  }))
  assert.equal(result.products[0].imageUrl, null)
  assert.equal(result.products[0].description, null)
  assert.equal(result.products[0].variations[0].price, null)
})

test('missing configuration and missing category fail closed', async () => {
  assert.throws(() => createSquareClient({}), (e) => e.status === 500)
  assert.throws(() => createSquareClient({ ...env, SQUARE_ENVIRONMENT: 'typo' }), (e) => e.status === 500)
  await assert.rejects(getProducts({ ...env, SQUARE_STOREFRONT_CATEGORY_ID: '' }, mockClient(() => assert.fail())), (e) => e.status === 500)
  await assert.rejects(getProducts(env, mockClient(() => ({ object: { type: 'ITEM' } }))), (e) => e.status === 500)
})

test('base URL uses the environment and upstream failures never leak sensitive content', async () => {
  for (const environment of ['sandbox', 'production']) {
    const client = createSquareClient({ ...env, SQUARE_ENVIRONMENT: environment }, async (url, options) => {
      assert.equal(new URL(url).hostname, environment === 'sandbox' ? 'connect.squareupsandbox.com' : 'connect.squareup.com')
      assert.equal(options.headers['Square-Version'], '2026-08-19')
      return new Response('secret-fixture', { status: 401 })
    })
    await assert.rejects(client.request('/catalog/list'), (e) => e instanceof SquareError && !e.message.includes('secret-fixture'))
  }
  for (const fetcher of [async () => { throw new Error('secret-fixture') }, async () => new Response('not json'), async () => Response.json({ errors: [{ detail: 'secret-fixture' }] })]) {
    await assert.rejects(createSquareClient(env, fetcher).request('/catalog/list'), (e) => e.status === 502 && !e.message.includes('secret-fixture'))
  }
})

test('repeating a pagination cursor fails instead of looping', async () => {
  await assert.rejects(getProducts(env, mockClient((path) => path.includes('/catalog/object/') ? category : { items: [], cursor: 'repeated' })), SquareError)
})

test('health, GET-only methods, safe errors, and production diagnostic exclusion', async () => {
  assert.equal((await handleApi(new Request('http://localhost/api/health'), {})).status, 200)
  for (const route of ['/api/health', '/api/products', '/api/square/location']) {
    const response = await handleApi(new Request('http://localhost' + route, { method: 'POST' }), {}, true)
    assert.equal(response.status, 405)
    assert.equal(response.headers.get('Allow'), 'GET')
  }
  assert.equal((await handleApi(new Request('http://localhost/api/square/location'), env)).status, 404)
  const response = await handleApi(new Request('http://localhost/api/products'), {})
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'The shop is not configured yet.' })
})
