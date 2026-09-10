import assert from 'node:assert/strict'
import test from 'node:test'
import { checkoutQuote, preparePurchase, payPurchase, publicConfig } from '../worker/payments.ts'
import { parseQuote } from '../worker/checkout.ts'
import { parseBuyer } from '../worker/fulfillment.ts'
import { createSquareClient } from '../worker/square/client.ts'
import { unseal, seal } from '../worker/checkout-tokens.ts'

const env = { SQUARE_ACCESS_TOKEN: 'secret-fixture', SQUARE_APPLICATION_ID: 'app', SQUARE_LOCATION_ID: 'location', SQUARE_ENVIRONMENT: 'sandbox', SQUARE_STOREFRONT_CATEGORY_ID: 'category', SHIPPING_FLAT_RATE_CENTS: '600', CHECKOUT_TOKEN_SECRET: 'test-only-encryption-key-not-real-credentials' }
const selection = { items: [{ variationId: 'v', quantity: 1 }], fulfillment: 'pickup', tipCents: 0 }
const buyer = { givenName: 'Sandbox', familyName: 'Buyer', email: 'test@example.com', phone: '+12025550100' }
const address = { line1: '123 Test Street', line2: '', city: 'Las Vegas', region: 'NV', postalCode: '89119', country: 'US' }
const money = amount => ({ amount, currency: 'USD' })
function squareFixture() {
  const state = { price: 3500, stock: 5, tax: 0, createFails: false, paymentFails: false, decline: false, losePaymentResponse: false, loseOrderResponse: false, orders: [], payments: [], calls: [], inventoryReads: 0, stockFallsAfterOrder: false }
  const idemOrders = new Map(); const idemPayments = new Map()
  const client = createSquareClient(env, async (url, options) => {
    const path = new URL(url).pathname; const body = options.body ? JSON.parse(options.body) : undefined
    state.calls.push({path, body, method: options.method})
    const response = value => Response.json(value)
    const calc = draft => {
      const shipping = draft.service_charges?.[0]?.amount_money.amount ?? 0
      const lines = draft.line_items.map(line => ({ ...line, total_money: money(line.base_price_money.amount * Number(line.quantity) + state.tax), total_tax_money: money(state.tax), total_discount_money: money(0) }))
      return { ...draft, line_items: lines, total_money: money(lines.reduce((sum,line)=>sum+line.total_money.amount,0)+shipping), total_tax_money: money(state.tax*lines.length), total_discount_money: money(0), total_service_charge_money: money(shipping) }
    }
    if (path.includes('/catalog/object/')) return response({object:{id:'category',type:'CATEGORY'}})
    if (path.endsWith('search-catalog-items')) return response({ items: [{ id: 'item', type: 'ITEM', item_data: { name: 'Square product', categories: [{ id: 'category' }], variations: [{ id: 'v', type: 'ITEM_VARIATION', item_variation_data: { name: 'Regular', pricing_type: 'FIXED_PRICING', price_money: money(state.price), track_inventory: true } }] } }] })
    if (path.includes('/inventory/')) { state.inventoryReads++; return response({counts:[{catalog_object_id:'v',location_id:'location',state:'IN_STOCK',quantity:String(state.stockFallsAfterOrder && state.orders.length ? 0 : state.stock)}]}) }
    if (path === '/v2/orders/calculate') return response({order:calc(body.order)})
    if (path === '/v2/orders/search') return response({orders:state.orders})
    if (path === '/v2/orders') {
      if (state.createFails) throw new Error('secret-fixture upstream')
      if (idemOrders.has(body.idempotency_key)) return response({order:idemOrders.get(body.idempotency_key)})
      const order = {...calc(body.order),id:'order-'+state.orders.length,version:1}
      state.orders.push(order); idemOrders.set(body.idempotency_key,order)
      if (state.loseOrderResponse) {state.loseOrderResponse=false;throw new Error('lost response')}
      return response({order})
    }
    if (path.startsWith('/v2/orders/')) {
      const order = state.orders.find(order=>path.endsWith(order.id))
      if (options.method==='PUT') {order.state=body.order.state;order.version++}
      return response({order})
    }
    if (path === '/v2/payments') {
      if (state.decline) return new Response(JSON.stringify({errors:[{code:'GENERIC_DECLINE',detail:'secret-fixture'}]}),{status:400})
      if (state.paymentFails) throw new Error('secret-fixture upstream')
      if (idemPayments.has(body.idempotency_key)) return response({payment:idemPayments.get(body.idempotency_key)})
      const payment = {...body,id:'payment-'+state.payments.length,status:'COMPLETED',total_money:money(body.amount_money.amount+body.tip_money.amount)}
      state.payments.push(payment);idemPayments.set(body.idempotency_key,payment)
      const order=state.orders.find(order=>order.id===body.order_id);order.tenders=[{payment_id:payment.id}];order.total_money=payment.total_money
      if (state.losePaymentResponse) {state.losePaymentResponse=false;throw new Error('lost response')}
      return response({payment})
    }
    if (path.startsWith('/v2/payments/')) return response({payment:state.payments.find(p=>path.endsWith(p.id))})
    assert.fail('Unexpected Square call '+path)
  })
  return {state,client}
}
async function prepare(client, overrides={}) {
  const chosen={...selection,...overrides}
  const quote=await checkoutQuote(chosen,env,client)
  const prepared=await preparePurchase({quoteToken:quote.quoteToken,buyer:{...buyer,...(chosen.fulfillment==='shipping'?{address}:{})},sourceToken:'cnon:test-token'},env)
  return {quote,prepared}
}

test('reject invalid fulfillment, malformed/negative/oversized tips, and client monetary overrides',()=>{
  for(const fulfillment of [undefined,'delivery',null]) assert.throws(()=>parseQuote({...selection,fulfillment}))
  for(const tipCents of [-1,1.5,10001,'100',null]) assert.throws(()=>parseQuote({...selection,tipCents}))
  for(const field of ['amount','price','shipping','orderId','total','tax']) assert.throws(()=>parseQuote({...selection,[field]:1}))
})
test('customer and shipping information are validated and normalized on the server',()=>{
  assert.deepEqual(parseBuyer({...buyer,givenName:' Sandbox '},'pickup'),buyer)
  for(const data of [{...buyer,email:'bad'},{...buyer,phone:'abc'},{...buyer,givenName:''},{...buyer,card:'never'},{...buyer,address}]) assert.throws(()=>parseBuyer(data,'pickup'))
  for(const data of [{...buyer},{...buyer,address:{...address,line1:''}},{...buyer,address:{...address,country:'ZZ'}},{...buyer,address:{...address,postalCode:''}}]) assert.throws(()=>parseBuyer(data,'shipping'))
  assert.equal(parseBuyer({...buyer,address},'shipping').address.country,'US')
})
test('shipping is a Square service charge and pickup is free; taxes and tip stay separate',async()=>{
  const {client,state}=squareFixture();state.tax=277
  const shipping=await checkoutQuote({...selection,fulfillment:'shipping',tipCents:500},env,client)
  assert.equal(shipping.shipping,600);assert.equal(shipping.tax,277);assert.equal(shipping.total,4377);assert.equal(shipping.payableTotal,4877)
  const draft=state.calls.find(c=>c.path==='/v2/orders/calculate').body.order
  assert.deepEqual(draft.service_charges[0].amount_money,money(600));assert.equal(draft.service_charges[0].taxable,true)
  assert.equal('tip_money' in draft,false)
  assert.equal((await checkoutQuote(selection,env,client)).shipping,0)
  assert.equal(state.orders.length,0)
})
test('configuration exposes only SDK identifiers and public options, never secrets',()=>{
  const config=publicConfig(env)
  assert.equal(config.shippingCents,600);assert.equal(config.environment,'sandbox')
  assert.equal(JSON.stringify(config).includes(env.SQUARE_ACCESS_TOKEN),false)
  assert.equal(JSON.stringify(config).includes(env.CHECKOUT_TOKEN_SECRET),false)
})
test('prepared checkout is encrypted/authenticated and cannot supply an order ID or alternate source type',async()=>{
  const {client}=squareFixture();const {quote,prepared}=await prepare(client)
  assert.equal(prepared.purchaseToken.includes(buyer.email),false);assert.equal(prepared.purchaseToken.includes('cnon:'),false)
  await assert.rejects(preparePurchase({quoteToken:quote.quoteToken,buyer,sourceToken:'CASH'},env))
  await assert.rejects(payPurchase({...prepared,orderId:'injected'},env,client))
  await assert.rejects(payPurchase({purchaseToken:prepared.purchaseToken.slice(0,-4)+'AAAA'},env,client))
})
for(const fulfillment of ['shipping','pickup']) test(`CreateOrder and linked payment map ${fulfillment} fulfillment, totals, tip and recipient`,async()=>{
  const {client,state}=squareFixture();const {prepared,quote}=await prepare(client,{fulfillment,tipCents:200})
  const result=await payPurchase({purchaseToken:prepared.purchaseToken},env,client)
  assert.equal(result.status,'completed');assert.equal(result.total,quote.payableTotal)
  const order=state.orders[0];assert.equal(order.state,'OPEN');assert.equal(order.line_items[0].catalog_object_id,'v')
  const f=order.fulfillments[0];assert.equal(f.type,fulfillment==='shipping'?'SHIPMENT':'PICKUP')
  const details=f.shipment_details??f.pickup_details
  assert.equal(details.recipient.email_address,buyer.email)
  if(fulfillment==='shipping') assert.equal(details.recipient.address.address_line_1,address.line1)
  else {assert.equal(details.schedule_type,'ASAP');assert.equal(details.recipient.address,undefined)}
  const payment=state.payments[0];assert.equal(payment.order_id,order.id);assert.equal(payment.amount_money.amount,quote.total);assert.equal(payment.tip_money.amount,200)
  assert.equal('tip_money' in order,false);assert.equal(state.inventoryReads>=3,true)
  assert.deepEqual(Object.keys(result).sort(),['status','orderReference','total','currency','fulfillment'].sort())
})
test('catalog price change and insufficient inventory before final purchase do not create charges',async()=>{
  for(const mutate of [s=>s.price++,s=>s.stock=0]) {const {client,state}=squareFixture();const {prepared}=await prepare(client);mutate(state);assert.equal((await payPurchase({purchaseToken:prepared.purchaseToken},env,client)).status,'review_required');assert.equal(state.orders.length,0);assert.equal(state.payments.length,0)}
})
test('inventory falling after CreateOrder still prevents payment',async()=>{
  const {client,state}=squareFixture();const {prepared}=await prepare(client);state.stockFallsAfterOrder=true
  const result=await payPurchase({purchaseToken:prepared.purchaseToken},env,client)
  assert.notEqual(result.status,'completed');assert.equal(state.orders.length,1);assert.equal(state.payments.length,0)
})
test('CreateOrder and CreatePayment network failures return pending without false success',async()=>{
  for(const field of ['createFails','paymentFails']) {const {client,state}=squareFixture();const {prepared}=await prepare(client);state[field]=true;const result=await payPurchase({purchaseToken:prepared.purchaseToken},env,client);assert.equal(result.status,'pending');assert.equal(JSON.stringify(result).includes('secret-fixture'),false);assert.equal(state.payments.length,0)}
})
test('definitive decline preserves a retryable customer outcome and cancels the unpaid order where possible',async()=>{
  const {client,state}=squareFixture();const {prepared}=await prepare(client);state.decline=true
  assert.equal((await payPurchase({purchaseToken:prepared.purchaseToken},env,client)).status,'declined');assert.equal(state.orders[0].state,'CANCELED');assert.equal(state.payments.length,0)
  assert.equal((await payPurchase({purchaseToken:prepared.purchaseToken},env,client)).status,'declined')
})
test('lost payment/order response retries recover the same order/payment without a second charge',async()=>{
  for(const field of ['losePaymentResponse','loseOrderResponse']) {
    const {client,state}=squareFixture();const {prepared}=await prepare(client,{tipCents:500});state[field]=true
    assert.equal((await payPurchase({purchaseToken:prepared.purchaseToken},env,client)).status,'pending')
    const recovered=await payPurchase({purchaseToken:prepared.purchaseToken},env,client)
    assert.equal(recovered.status,'completed');assert.equal(state.orders.length,1);assert.equal(state.payments.length,1)
    assert.deepEqual(await payPurchase({purchaseToken:prepared.purchaseToken},env,client),recovered)
    assert.equal(state.payments.length,1)
  }
})
test('status-only checks never create orders/payments and expiry prevents new purchases',async()=>{
  const {client,state}=squareFixture();const {prepared}=await prepare(client)
  assert.equal((await payPurchase({purchaseToken:prepared.purchaseToken},env,client,true)).status,'pending');assert.equal(state.orders.length,0)
  const intent=await unseal(prepared.purchaseToken,'purchase',env);intent.issuedAt=Date.now()-20*60_000
  assert.equal((await payPurchase({purchaseToken:await seal(intent,'purchase',env)},env,client)).status,'review_required');assert.equal(state.payments.length,0)
})
