# bestbvnnies

React + TypeScript + Vite, served by a Cloudflare Worker with Static Assets. Square owns catalog, inventory, taxes, orders and payments. This is a single-seller integration using a server-only personal access token, without OAuth or a database.

Implemented: branded catalog, persisted cart, shipping/local pickup, customer details, Square-calculated review, optional tipping, Square Web Payments SDK card/wallet integration, order-linked payment and recovery. Appointments, deposits, waivers, saved cards, subscriptions and webhooks are not implemented. Nothing has been deployed.

## Local setup

Use Node.js 22.13+; tests use Node's built-in test runner and TypeScript stripping.

```sh
npm install
cp .dev.vars.example .dev.vars # only if .dev.vars does not already exist
npm run dev
```

Fill in the local configuration; restart development after changes:

| Variable | Local value |
| --- | --- |
| `SQUARE_ACCESS_TOKEN` | Sandbox personal access token; server-only |
| `SQUARE_APPLICATION_ID` | Matching Sandbox application ID |
| `SQUARE_LOCATION_ID` | Matching Sandbox location |
| `SQUARE_ENVIRONMENT` | `sandbox` |
| `SQUARE_STOREFRONT_CATEGORY_ID` | Non-secret storefront category ID |
| `SHIPPING_FLAT_RATE_CENTS` | `600` (USD cents) |
| `CHECKOUT_TOKEN_SECRET` | Random server-only secret of at least 32 characters |

The local shipping setting and a random checkout-token secret were added during this implementation. Existing Square credentials were preserved. For another environment, generate a distinct cryptographically random secret (for example, `openssl rand -base64 48`) and keep it stable during active checkouts. Token encryption uses Web Crypto AES-GCM with environment/location/purpose binding. Rotating this secret invalidates outstanding browser recovery references; reconcile unresolved purchases in Square before rotation.

**Never commit `.dev.vars`, credentials, payment tokens, or buyer data.** Do not use `VITE_*` for server secrets. Build output is ignored and may contain a private Worker-side `.dev.vars` copy; never publish the entire `dist` directory as public assets. Public assets are in `dist/client`.

The SDK requires a secure context and CSP. Card entry was tested on localhost; production requires HTTPS. `public/_headers` supplies the built static asset CSP and security headers. Vite reads that policy and adds development-only inline-script/HMR allowances for React refresh. Apple Pay cannot be tested on localhost.

## Square owner workflow

Keep storefront products in the configured Square category (the existing Sandbox category is **Press-On Nails**). To find the ID:

```sh
npm run square:categories
```

The helper prints only category names and IDs. The owner can change products, variations, prices, category membership, stock and applicable catalog taxes in Square without editing React. Direct category membership is used; nested categories are not implicitly included. Renaming the category is fine; recreating it requires a new configured category ID.

Products use location prices and tracking overrides. Deleted, archived, non-sellable, unavailable-at-location and non-merchandise objects are excluded. Pagination is followed. Missing images get a branded placeholder. Missing/variable prices cannot be purchased. Untracked stock is deliberately allowed; tracked unknown stock blocks checkout; active sold-out overrides and insufficient quantities block checkout.

Paid SHIPMENT/PICKUP orders include recipient contact details and the shipping address when applicable. Square documents that paid fulfillment orders appear in its Order Manager. The owner manages fulfillment through Square. A paid order can remain `OPEN` with a `PROPOSED` fulfillment until the seller processes it; `Payment.status: COMPLETED` is the capture confirmation. This application does not mark goods shipped/picked up merely because payment succeeded, or create a separate seller/admin interface. Recipient data is stored on the Square fulfillment; a separate Customers API profile is not required by this flow and is not explicitly created.

## Checkout contract

All privileged Square REST calls use `worker/square/client.ts`, including its pinned `Square-Version: 2026-08-19`, environment selection, timeouts and sanitized errors. The access token never leaves the Worker for the browser.

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Worker health |
| `GET /api/square/location` | Vite-development-only Sandbox connectivity check |
| `GET /api/products` | Category/location-scoped application-facing catalog |
| `GET /api/checkout/config` | Public SDK app/location IDs, environment, SDK URL, shipping and tip options |
| `POST /api/checkout/quote` | Fresh catalog/inventory checks and Square CalculateOrder preview; creates no order |
| `POST /api/checkout/prepare` | Validates buyer details and SDK source token; issues an encrypted recovery token; creates no order/payment |
| `POST /api/checkout/pay` | Recovers or creates the authoritative order, checks stock again, and makes its linked Square payment |
| `POST /api/checkout/status` | Read-only recovery of a known attempt; never creates an order or initiates a charge |

Routes enforce methods with 405/`Allow`. Checkout bodies require JSON and are bounded to 128 KiB. Cart validation accepts 1–100 distinct variations with whole quantities 1–99 and rejects duplicates, unknown request fields and client-supplied monetary/order fields. These limits are defensive implementation bounds, not Square stock quantities.

Example quote request:

```json
{
  "items": [{ "variationId": "SQUARE_VARIATION_ID", "quantity": 1 }],
  "fulfillment": "shipping",
  "tipCents": 200
}
```

A quote contains integer amounts, validated lines, currency, merchandise subtotal, discount, shipping, tax, order total, tip, payable total and an opaque `quoteToken`. Prices and availability are read fresh. Quote freshness is 15 minutes; changing cart, fulfillment, buyer details or tip invalidates the displayed review. The browser must obtain a new authoritative total before payment.

Shipping uses the Worker-configured $6 fee as a Square `OrderServiceCharge` in `SUBTOTAL_PHASE`, with `taxable: true` to permit applicable Square taxes. Pickup has no service charge. Square calculates taxes and eligible catalog discount rules using `auto_apply_taxes` and `auto_apply_discounts`. There is no custom tax rate or tax computation. A saved discount without an applicable pricing rule is not automatically applied. The UI maps Square's returned amounts, separating inclusive tax to avoid double counting.

Shipping charges can receive applicable order-level taxes; automatic item/catalog taxes do not necessarily establish shipping taxability. Confirm the seller's shipping tax setup before production. Current Sandbox products return $0 tax. No shipping-country restriction was specified, so the form accepts validated country codes with US prefilled and applies the same configured fee; confirm geographic coverage, state/region/postal requirements and international costs before production.

Pickup details and informational hours are centralized in `src/siteConfig.ts`. Square uses `PICKUP` with `schedule_type: ASAP`, without a requested pickup time, artificial preparation promise or time-slot system. Buyers are told to contact the shop to confirm readiness and see the supplied address, contact details and hours before purchase.

Tips default to zero. Suggestions are $2/$5/$10; custom tips must be integer cents from 0 through $100. The Worker validates this bound. `CreatePayment.amount_money` equals the authoritative order total **excluding tip**; `tip_money` is additional. The buyer sees the combined payable total before tokenization. No `Order.tip_money` field is written.

The final order uses catalog variation references and fresh Square prices, `OPEN` state, the chosen fulfillment, and the same Square pricing rules as the quote. Changes between review and payment require another review. Changes returned by CreateOrder itself are checked before payment. Zero-dollar orders are not currently supported by the card-payment path and require a separate future no-payment completion path.

## Payment security and recovery

The official Square SDK script is loaded on demand. Card fields live inside Square's iframe. `Card.tokenize(verificationDetails)` performs the current buyer-verification flow; app code never reads or sends PAN/CVV. Apple Pay and Google Pay use the SDK's payment request/tokenization and wallet buyer verification, and reuse the same Worker purchasing flow. Unsupported wallets are omitted while card remains available.

The final button performs these steps:

1. Square tokenizes the payment source for the reviewed payable total.
2. `/prepare` validates buyer/contact/address and seals the source, verification token and accepted checkout into an encrypted recovery reference. It has no Square write side effects.
3. The browser saves that opaque reference in `sessionStorage` **before** calling `/pay`. If session storage is unavailable, payment is not submitted. Raw card details, raw source tokens and plain buyer/contact details are not persisted by the app.
4. `/pay` uses the server-generated quote nonce for stable `ord-…` and `pay-…` idempotency keys and a `BB-…` Square order reference. The browser cannot choose Square order IDs, amounts or keys. A hashed source binding on the order prevents switching tokens within an attempt.
5. The Worker looks up the attempt's Square order using a bounded-by-time, paginated order search. Completed payments are recovered before current stock checks, so a successful purchase can still be recognized when stock has subsequently fallen.
6. For an unpaid attempt, the Worker revalidates catalog, totals and inventory, creates/reuses the order, checks inventory immediately before payment, and calls CreatePayment with `order_id`, authoritative amount, tip and `autocomplete: true`.

Only a matching Square payment with `COMPLETED` status and the expected amount/currency/order/reference produces success and clears the cart. The confirmation includes the Square order identifier. No success is fabricated from an HTTP response alone.

A definitive decline preserves the cart, contact information, fulfillment and tip; the unpaid order is canceled where possible. If cancellation fails, it can remain unpaid in Square. A fresh review/new card generates a new attempt after a definitive decline. Replaying the old attempt cannot become a new charge.

An ambiguous API/network result keeps the recovery reference and blocks editing that checkout. **Check payment status** performs reads only; **Retry this same purchase** reuses the same idempotency keys/source. A lost order or payment response can be recovered without creating duplicate charges. No uncertain payment is automatically canceled. Existing attempts can be retried for up to 24 hours; older references remain status-checkable but never initiate a new charge. A prolonged unresolved/expired attempt needs seller reconciliation using the displayed reference. Session storage survives reload in the same tab, not closing the tab or switching browsers; retain the reference and check Square before restarting an uncertain purchase elsewhere.

No shared inventory lock exists. Square stock can change between the final read and charge, and inventory updates have propagation delay. In Sandbox, a tracked purchase initially read five units and later four, while the paid fulfillment order remained open. This prevents claiming a reservation or zero oversell risk. The owner must keep tracked stock accurate and reconcile rare oversells; no database/reservation system was introduced.

## Wallet setup before production

- **Apple Pay:** register the HTTPS Sandbox hostname in the Square Developer Console's Sandbox Apple Pay settings, follow Square's domain-association file instructions, and serve the supplied file at `/.well-known/apple-developer-merchantid-domain-association` without alteration or SPA fallback. Test with a supported Safari/device/wallet. Localhost/HTTP is not supported. Repeat registration separately in Production for the real hostname, use matching production SDK/application/location configuration, and provision server tokens/secrets as Cloudflare secrets. Registration/terms acceptance and deployment were not performed.
- **Google Pay:** test on a supported browser with a configured wallet over HTTPS; adhere to Google's required merchant/brand terms. The SDK attaches the Google Pay button only after successful initialization. The CSP allows its vendor origin and uses `Cross-Origin-Opener-Policy: same-origin-allow-popups`. Wallets were unavailable in the local browser test environment, so end-to-end wallet authorization remains a manual check.
- Validate real seller taxes/discount rules (including shipping and inclusive taxes), fulfillment workflow, geographic coverage, SDK/SCA flows, failure recovery, monitoring and payment-endpoint abuse controls before enabling production. The Square Orders API currently marks CalculateOrder Beta. No paid Appointments tier is required for this merchandise checkout; Appointments subscription features are separate.

## Validation

```sh
npm run test
npm run lint
npm run build
```

Tests use Node's built-in runner and mocked Square APIs, without added dependencies. They cover the catalog/cart foundation plus fulfillment validation, shipping, tips, buyer/address validation, client-override rejection, current prices, inventory races, order/fulfillment mapping, returned taxes, payment results, encryption/tampering, errors, declines, idempotency and lost-response recovery.

Actual Sandbox validation used official test tokens and fictional buyer data:

- SHIPMENT: $35 merchandise + $6 shipping + $2 tip = $43; completed payment linked to the correct fulfillment order.
- PICKUP: $35, free pickup; completed linked payment.
- Replaying both successful requests returned the same order/payment result.
- Decline token returned a decline; replay stayed declined.
- Browser card entry via Square's SDK completed a $35 pickup purchase and cleared the cart only after confirmed success.
- Browser shipping decline preserved customer/address/cart details and allowed a fresh review.
- Tracked stock eventually decreased from five to four after a paid Sandbox order; initial immediate reads were stale.
- Desktop and 375px mobile layouts were checked. Apple Pay/Google Pay authorization was not available locally.

Dashboard visibility was **not** directly inspected: automatic browser approval review blocked the Developer Console redirect to the production Square sign-in origin. Sandbox API retrieval confirmed the paid order/payment relationship, fulfillment type/state and recipient presence. Confirm the orders in the Sandbox Dashboard manually; no claim of visual Dashboard verification is made.

`npm run preview` builds a local preview. `npm run deploy` is available but must not be run until deployment/production integration is explicitly authorized. The two existing lint warnings in generated `worker-configuration.d.ts` remain unrelated to this implementation.

## Brand foundation

`BBSite_specs.md` is the source of truth. Existing official SVGs in `src/assets/` are imported unchanged. Shared palette/type/spacing tokens live in `src/index.css`; the full-screen cart uses secondary pink without layering it over primary pink. Bungee and Roboto load from Google Fonts. Faricy New still requires a licensed webfont/Adobe kit; body text intentionally falls back to Roboto.

## Official Square references

- [Web Payments SDK quickstart](https://developer.squareup.com/docs/web-payments/quickstart/add-sdk-to-web-client) and [current card buyer verification](https://developer.squareup.com/docs/web-payments/take-card-payment)
- [CalculateOrder](https://developer.squareup.com/reference/square/orders-api/calculate-order), [CreateOrder](https://developer.squareup.com/reference/square/orders/create-order), [CreatePayment](https://developer.squareup.com/reference/square/payments-api/CreatePayment)
- [Order-linked payments and tips](https://developer.squareup.com/docs/payments-api/take-payments), [idempotency](https://developer.squareup.com/docs/build-basics/common-api-patterns/idempotency)
- [Service charges](https://developer.squareup.com/reference/square/objects/OrderServiceCharge), [automatic catalog taxes](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts/auto-apply-taxes)
- [Pickup fulfillment](https://developer.squareup.com/reference/square/objects/OrderFulfillmentPickupDetails), [shipment fulfillment](https://developer.squareup.com/reference/square/objects/OrderFulfillmentShipmentDetails), [paid fulfillment visibility](https://developer.squareup.com/docs/orders-api/what-it-does)
- [Apple Pay](https://developer.squareup.com/docs/web-payments/apple-pay), [Google Pay](https://developer.squareup.com/docs/web-payments/google-pay), [CSP requirements](https://developer.squareup.com/docs/web-payments/content-security-policy)
- [Sandbox payment test values](https://developer.squareup.com/docs/devtools/sandbox/payments)
