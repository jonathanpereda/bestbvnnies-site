import assert from 'node:assert/strict'
import test from 'node:test'
import { CheckoutError, getCheckoutQuote, parseCart } from '../worker/checkout.ts'
import { createSquareClient, SquareError } from '../worker/square/client.ts'
import { handleApi } from '../worker/api.ts'
import { restoreCart, setQuantity } from '../src/cart/cart.ts'

const env = { SQUARE_ACCESS_TOKEN: 'secret-fixture', SQUARE_LOCATION_ID: 'location', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_STOREFRONT_CATEGORY_ID: 'category' }
const cart = { items: [{ variationId: 'v', quantity: 2 }] }
const money = (amount, currency = 'USD') => ({ amount, currency })
function fixture({ tracked = true, count = '5', price = 3000, variation = {}, item = {}, inventoryFails = false, calculate, currency = 'USD' } = {}) {
  const calls = []
  const client = createSquareClient(env, async (url, options) => {
    const path = new URL(url).pathname
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ path, body })
    if (path.includes('/catalog/object/')) return Response.json({ object: { id: 'category', type: 'CATEGORY' } })
    if (path.includes('search-catalog-items')) return Response.json({ items: [{ id: 'item', type: 'ITEM', item_data: { name: 'Current Square name', categories: [{ id: 'category' }], variations: [{ id: 'v', type: 'ITEM_VARIATION', item_variation_data: { name: 'Style', pricing_type: 'FIXED_PRICING', price_money: money(1000, currency), track_inventory: tracked, location_overrides: [{ location_id: 'location', price_money: money(price, currency) }], ...variation } }], ...item } }] })
    if (path.includes('/inventory/')) {
      if (inventoryFails) throw new Error('secret-fixture')
      return Response.json({ counts: count === null ? [] : [{ catalog_object_id: 'v', location_id: 'location', state: 'IN_STOCK', quantity: count }] })
    }
    if (path === '/v2/orders/calculate') {
      assert.deepEqual(body.order.pricing_options, { auto_apply_taxes: true, auto_apply_discounts: true })
      assert.equal(body.order.location_id, 'location')
      const line = body.order.line_items[0]
      const subtotal = line.base_price_money.amount * Number(line.quantity)
      const order = { location_id: 'location', line_items: [{ ...line, total_money: money(subtotal), total_tax_money: money(0), total_discount_money: money(0) }], total_money: money(subtotal), total_tax_money: money(0), total_discount_money: money(0) }
      return Response.json(calculate ? calculate(order, body) : { order })
    }
    assert.fail(`Unexpected Square endpoint: ${path}`)
  })
  return { client, calls }
}

// Strict request contract: the Worker rejects prices instead of accidentally trusting them.
test('reject malformed carts, extra data, duplicates, excessive lines, and invalid quantities before Square', async () => {
  for (const value of [null, [], {}, { items: [] }, { items: 'v' }, { ...cart, price: 1 }, { items: [{ ...cart.items[0], price: 1 }] }, { items: [cart.items[0], cart.items[0]] }, { items: [{ variationId: ' ', quantity: 1 }] }, { items: [{ variationId: 'x'.repeat(193), quantity: 1 }] }, { items: Array.from({ length: 101 }, (_, i) => ({ variationId: `v${i}`, quantity: 1 })) }]) {
    await assert.rejects(getCheckoutQuote(value, {}), (error) => error instanceof CheckoutError && error.status === 400)
  }
  for (const quantity of [0, -1, 1.5, 100, Number.MAX_SAFE_INTEGER + 1, '2', null, NaN, Infinity]) assert.throws(() => parseCart({ items: [{ variationId: 'v', quantity }] }), CheckoutError)
  assert.deepEqual(parseCart(cart), cart)
})

test('current location price is server-authoritative and CalculateOrder never creates a permanent order', async () => {
  const { client, calls } = fixture()
  const quote = await getCheckoutQuote(cart, env, client)
  assert.deepEqual(calls.at(-1).body.order.line_items, [{ uid: 'line-0', catalog_object_id: 'v', quantity: '2', base_price_money: money(3000) }])
  assert.equal(quote.total, 6000)
  assert.equal(quote.lines[0].unitPrice.amount, 3000)
  assert.equal(quote.lines[0].name, 'Current Square name')
  assert.equal(quote.lines[0].quantity, 2)
  assert.equal(quote.lines[0].inventory.count, 5)
  assert.equal(quote.currency, 'USD')
  assert.equal('id' in quote, false)
  assert.equal(JSON.stringify(quote).includes('secret-fixture'), false)
  assert.equal(calls.some(({ path }) => path === '/v2/orders'), false)
})

test('removed, archived, non-sellable, deleted and outside-category variations are rejected before calculation', async () => {
  for (const config of [{ item: { variations: [] } }, { item: { is_archived: true } }, { variation: { sellable: false } }, { item: { variations: [{ id: 'v', type: 'ITEM_VARIATION', is_deleted: true }] } }, { item: { categories: [{ id: 'private' }] } }]) {
    const { client, calls } = fixture(config)
    await assert.rejects(getCheckoutQuote(cart, env, client), (e) => e.status === 409 && e.issues[0].code === 'unavailable')
    assert.equal(calls.some(({ path }) => path.includes('/orders')), false)
  }
})

test('missing or variable prices cannot be quoted', async () => {
  const { client } = fixture({ variation: { pricing_type: 'VARIABLE_PRICING' } })
  await assert.rejects(getCheckoutQuote(cart, env, client), (e) => e.issues[0].code === 'price_unavailable')
})

test('tracked insufficient stock returns a safe whole-number quantity suggestion', async () => {
  for (const count of ['1', '1.5', '0', '-3']) {
    const { client } = fixture({ count })
    await assert.rejects(getCheckoutQuote(cart, env, client), (e) => e.status === 409 && e.issues[0].code === 'insufficient_stock' && e.issues[0].availableQuantity === Math.max(0, Math.floor(Number(count))))
  }
})

test('untracked stock permits quoting but sold-out override still blocks', async () => {
  const { client, calls } = fixture({ tracked: false })
  assert.equal((await getCheckoutQuote(cart, env, client)).lines[0].inventory.status, 'untracked')
  assert.equal(calls.some(({ path }) => path.includes('/inventory/')), false)
  const soldOut = fixture({ tracked: false, variation: { location_overrides: [{ location_id: 'location', sold_out: true }] } })
  await assert.rejects(getCheckoutQuote(cart, env, soldOut.client), (e) => e.issues[0].code === 'insufficient_stock')
})

test('unknown counts and inventory network failures block checkout rather than assume available', async () => {
  for (const config of [{ count: null }, { count: 'invalid' }, { inventoryFails: true }]) {
    const { client, calls } = fixture(config)
    await assert.rejects(getCheckoutQuote(cart, env, client), (e) => e.issues[0].code === 'stock_unknown')
    assert.equal(calls.some(({ path }) => path.includes('/orders')), false)
  }
})

test('maps additive and inclusive tax with discounts without double counting included tax', async () => {
  for (const total of [5940, 5400]) {
    const { client } = fixture({ calculate: (order) => {
      order.total_money = money(total)
      order.total_tax_money = money(540)
      order.total_discount_money = money(600)
      Object.assign(order.line_items[0], { total_money: order.total_money, total_tax_money: order.total_tax_money, total_discount_money: order.total_discount_money })
      return { order, ignored_secret: 'secret-fixture' }
    } })
    const quote = await getCheckoutQuote(cart, env, client)
    assert.equal(quote.subtotal, total + 600 - 540)
    assert.equal(quote.subtotal - quote.discount + quote.tax, quote.total)
    assert.equal(quote.lines[0].total, total)
    assert.equal(quote.lines[0].unitPrice.amount, 3000)
    assert.equal('ignored_secret' in quote, false)
  }
})

test('unexpected Square response shapes, currencies and totals fail safely', async () => {
  for (const mutate of [() => ({}), () => ({ errors: [{ detail: 'secret-fixture' }] }), (order) => ({ order: { ...order, line_items: [] } }), (order) => ({ order: { ...order, total_money: money(6000, 'CAD') } }), (order) => ({ order: { ...order, total_money: money(1) } }), (order) => { order.line_items[0].catalog_object_id = 'wrong'; return { order } }, (order) => { order.line_items[0].base_price_money.amount = 1; return { order } }, (order) => { order.total_service_charge_money = money(100); return { order } }, () => { throw new Error('secret-fixture') }]) {
    await assert.rejects(getCheckoutQuote(cart, env, fixture({ calculate: mutate }).client), (e) => e instanceof SquareError && e.status === 502 && !e.message.includes('secret-fixture'))
  }
})

test('quote route enforces POST, JSON, valid JSON and actual request byte limit', async () => {
  const request = (body, headers = { 'Content-Type': 'application/json' }) => new Request('http://localhost/api/checkout/quote', { method: 'POST', headers, body })
  const method = await handleApi(new Request('http://localhost/api/checkout/quote'), {})
  assert.equal(method.status, 405)
  assert.equal(method.headers.get('Allow'), 'POST')
  assert.equal((await handleApi(request('{}', { 'Content-Type': 'text/plain' }), {})).status, 415)
  for (const body of ['{', '{}', JSON.stringify({ items: [{ ...cart.items[0], amount: 1 }] })]) assert.equal((await handleApi(request(body), {})).status, 400)
  assert.equal((await handleApi(request(' '.repeat(32769)), {})).status, 413)
  const unconfigured = await handleApi(request(JSON.stringify(cart)), {})
  assert.equal(unconfigured.status, 500)
  assert.equal(unconfigured.headers.get('Cache-Control'), 'no-store')
})

test('saved carts keep variation identity and quantities only; damaged storage fails safely', () => {
  assert.deepEqual(restoreCart(JSON.stringify([{ variationId: 'v', quantity: 2, price: 1, token: 'discard' }])), cart.items)
  for (const value of ['bad json', '{}', JSON.stringify([{ variationId: 'v', quantity: -1 }]), JSON.stringify([cart.items[0], cart.items[0]])]) assert.deepEqual(restoreCart(value), [])
  let items = setQuantity([], 'style-a', 1)
  items = setQuantity(items, 'style-b', 2)
  items = setQuantity(items, 'style-a', 3)
  assert.deepEqual(items, [{ variationId: 'style-a', quantity: 3 }, { variationId: 'style-b', quantity: 2 }])
  assert.deepEqual(setQuantity(items, 'style-a', 0), [{ variationId: 'style-b', quantity: 2 }])
  assert.deepEqual(setQuantity(items, 'style-a', 100), items)
})
