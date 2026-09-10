import test from 'node:test'
import assert from 'node:assert/strict'
import { mapServices, getServices, bookingUrl } from '../worker/services.ts'
import { formatServiceDuration, formatServicePrice } from '../shared/services.ts'
import { handleApi } from '../worker/api.ts'
import { SquareError } from '../worker/square/client.ts'

const env = { SQUARE_ENVIRONMENT: 'sandbox', SQUARE_BOOKING_URL: 'https://app.squareupsandbox.com/appointments/buyer/widget/widget/location' }
const variation = (changes = {}) => ({ id: 'variation', type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: { amount: 4500, currency: 'USD' }, available_for_booking: true, service_duration: 4500000, ...changes } })
const item = (changes = {}) => ({ id: 'service', type: 'ITEM', item_data: { name: 'Test service', product_type: 'APPOINTMENTS_SERVICE', variations: [variation()], ...changes } })
const mapped = (changes = {}) => mapServices([item({ variations: [variation(changes)] })], [], 'location')[0].variations[0]

test('fixed, variable, unspecified and malformed prices; descriptive starting prices remain Square text', () => {
  assert.equal(formatServicePrice(mapped()), '$45.00')
  assert.equal(formatServicePrice(mapped({ pricing_type: 'VARIABLE_PRICING' })), 'Price varies')
  assert.equal(mapped({ pricing_type: 'VARIABLE_PRICING' }).price, null)
  assert.equal(formatServicePrice(mapped({ price_money: undefined })), 'See price when booking')
  assert.equal(formatServicePrice(mapped({ price_money: { amount: -1, currency: 'USD' } })), 'See price when booking')
  assert.equal(formatServicePrice(mapped({ pricing_type: undefined })), 'See price when booking')
  assert.equal(formatServicePrice(mapped({ price_description: '$45+' })), '$45+')
  assert.equal(formatServicePrice(mapped({ price_description: 'Starting at $45' })), 'Starting at $45')
  assert.equal(formatServicePrice(mapped({ price_description: 123 })), '$45.00')
  assert.equal(formatServicePrice(mapped({ price_money: { amount: 500, currency: 'JPY' } })), '¥500')
})

test('duration units and missing/invalid duration do not invent plus semantics', () => {
  for (const [minutes, expected] of [[30, '30 min'], [60, '1 hr'], [75, '1 hr 15 min'], [90, '1 hr 30 min'], [150, '2 hr 30 min']]) assert.equal(formatServiceDuration(minutes * 60000), expected)
  for (const value of [null, 0, -1, NaN]) assert.equal(formatServiceDuration(value), 'Duration shown when booking')
  assert.equal(formatServiceDuration(1), 'Less than 1 min')
  assert.equal(mapped({ service_duration: '3600000' }).durationMs, null)
})

test('maps all bookable variations in ordinal order with location price overrides and category names', () => {
  const first = variation({ ordinal: 2 })
  const second = { ...variation({ name: 'Extended', ordinal: 1, location_overrides: [{ location_id: 'location', price_money: { amount: 6000, currency: 'USD' } }] }), id: 'second' }
  const result = mapServices([item({ variations: [first, second], description_plaintext: ' Plain text ', categories: [{ id: 'cat' }, { id: 'deleted' }] })], [{ id: 'cat', type: 'CATEGORY', category_data: { name: 'Category' } }, { id: 'deleted', type: 'CATEGORY', is_deleted: true, category_data: { name: 'Hidden' } }], 'location')
  assert.deepEqual(result[0].variations.map(v => v.id), ['second', 'variation'])
  assert.equal(result[0].variations[0].price.amount, 6000)
  assert.deepEqual(result[0].categories, [{ id: 'cat', name: 'Category' }])
  assert.equal(result[0].description, 'Plain text')
})

test('excludes deleted, archived, non-service, absent-location, unnamed and non-bookable objects', () => {
  const excluded = [
    { ...item(), is_deleted: true }, item({ is_archived: true }), item({ product_type: 'REGULAR' }), item({ name: '' }),
    { ...item(), present_at_all_locations: false, present_at_location_ids: ['other'] },
    item({ variations: [variation({ available_for_booking: false })] }), item({ variations: [variation({ available_for_booking: undefined })] }),
    item({ variations: [{ ...variation(), is_deleted: true }] }),
    item({ variations: [{ ...variation(), present_at_all_locations: false, present_at_location_ids: ['other'] }] }),
  ]
  for (const object of excluded) assert.deepEqual(mapServices([object], [], 'location'), [])
})

test('empty catalog and malformed optional fields are safe', () => {
  assert.deepEqual(mapServices([], [], 'location'), [])
  assert.deepEqual(mapServices([item({ variations: null })], [], 'location'), [])
  const result = mapServices([null, item({ description: 123, categories: null, variations: [null, variation({ name: {}, location_overrides: null })] })], [], 'location')
  assert.equal(result[0].description, null)
  assert.equal(result[0].variations[0].name, null)
})

test('service retrieval follows pagination and batches categories without inventory or booking calls', async () => {
  const calls = []
  const client = { locationId: 'location', environment: 'sandbox', request: async (path, body) => {
    calls.push({ path, body })
    if (path === '/catalog/batch-retrieve') return { objects: [{ id: 'cat', type: 'CATEGORY', category_data: { name: 'Category' } }] }
    assert.deepEqual(body.product_types, ['APPOINTMENTS_SERVICE'])
    assert.deepEqual(body.enabled_location_ids, ['location'])
    assert.equal(body.archived_state, 'ARCHIVED_STATE_NOT_ARCHIVED')
    return body.cursor ? { items: [{ ...item({ categories: [{ id: 'cat' }] }), id: 'second' }] } : { items: [item()], cursor: 'next' }
  } }
  const result = await getServices(env, client)
  assert.equal(result.services.length, 2)
  assert.equal(result.bookingUrl, env.SQUARE_BOOKING_URL)
  assert.equal(calls.length, 3)
  assert.equal(calls[1].body.cursor, 'next')
})

test('repeated cursors fail safely and empty catalog makes no category call', async () => {
  await assert.rejects(getServices(env, { locationId: 'location', request: async () => ({ cursor: 'same' }) }), SquareError)
  let calls = 0
  assert.deepEqual((await getServices(env, { locationId: 'location', request: async () => { calls++; return {} } })).services, [])
  assert.equal(calls, 1)
})

test('booking URL must be the configured matching-environment HTTPS widget', () => {
  assert.equal(bookingUrl(env), env.SQUARE_BOOKING_URL)
  for (const url of ['', 'javascript:alert(1)', env.SQUARE_BOOKING_URL + '.js', env.SQUARE_BOOKING_URL.replace('squareupsandbox.com', 'squareup.com'), env.SQUARE_BOOKING_URL.replace('https:', 'http:'), env.SQUARE_BOOKING_URL + '?next=other']) assert.throws(() => bookingUrl({ ...env, SQUARE_BOOKING_URL: url }), SquareError)
  assert.equal(bookingUrl({ SQUARE_ENVIRONMENT: 'production', SQUARE_BOOKING_URL: env.SQUARE_BOOKING_URL.replace('squareupsandbox.com', 'squareup.com') }), env.SQUARE_BOOKING_URL.replace('squareupsandbox.com', 'squareup.com'))
})

test('GET-only route and configuration failure are sanitized', async () => {
  const denied = await handleApi(new Request('http://localhost/api/services', { method: 'POST' }), {})
  assert.equal(denied.status, 405)
  assert.equal(denied.headers.get('Allow'), 'GET')
  const response = await handleApi(new Request('http://localhost/api/services'), {})
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'Appointments are not configured yet.' })
})

test('upstream/network failures never return credentials or upstream body', async () => {
  const original = globalThis.fetch
  try {
    for (const fail of [async () => new Response(JSON.stringify({ errors: [{ detail: 'private upstream body' }] }), { status: 500 }), async () => { throw new Error('private network details') }]) {
      globalThis.fetch = fail
      const response = await handleApi(new Request('http://localhost/api/services'), { ...env, SQUARE_ACCESS_TOKEN: 'private-token', SQUARE_LOCATION_ID: 'location' })
      assert.equal(response.status, 502)
      assert.equal(response.headers.get('Cache-Control'), 'no-store')
      assert.deepEqual(await response.json(), { error: 'Services are temporarily unavailable. Please try again.' })
    }
  } finally { globalThis.fetch = original }
})
