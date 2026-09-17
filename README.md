# bestbvnnies

React + TypeScript + Vite, served by a Cloudflare Worker with Static Assets. Square owns catalog, inventory, taxes, orders and payments. This is a single-seller integration using a server-only personal access token, without OAuth or a database.

Implemented: branded catalog, persisted cart, shipping/local pickup, customer details, Square-calculated review, optional tipping, Square Web Payments SDK card/wallet integration, order-linked payment and recovery. Appointment service discovery and a Square-hosted booking handoff are also implemented. Custom appointment scheduling, deposits, waivers, saved cards, subscriptions and webhooks are not implemented. Nothing has been deployed.

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
| `SQUARE_BOOKING_URL` | Public Square-generated all-services Advanced Widget URL (example supplied in `.dev.vars.example`) |
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
| `GET /api/services` | Online-bookable appointment-service menu and public hosted booking URL |
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


## Appointment service discovery and hosted booking

The Services navigation link opens the branded `#services` section. React reads `GET /api/services`; the Worker uses the existing personal-access-token client and API version **2026-08-19**. No Bookings, Availability, Customers or appointment payment API is called. This catalog-reading integration does not require seller-level Bookings API access or introduce a paid Appointments API dependency. Features and policies in the first-party booking experience depend on the seller's Square configuration/subscription and must be verified by the owner.

`worker/services.ts` calls `POST /v2/catalog/search-catalog-items` with `product_types: ["APPOINTMENTS_SERVICE"]`, the configured location, and non-archived filtering. All pages are followed with repeated-cursor protection. Referenced category names are fetched with `POST /v2/catalog/batch-retrieve` in batches of 100. This is separate from the merchandise storefront-category filter; no inventory query is needed.

Only non-deleted, non-archived services present at the location with at least one location-present variation explicitly marked `available_for_booking: true` are displayed. Non-bookable/deleted variations are excluded. This flag means online-bookable catalog data, **not** an available appointment slot or an exact mirror of Advanced Widget service selection. No staff selection is presented. Missing optional values receive readable fallbacks. The API exposes only service/category/variation IDs for rendering, names, descriptions, pricing, duration and bookable metadata; it omits staff IDs and other privileged catalog fields.

Services are grouped under their first Square category, with additional category names retained as labels; uncategorized services use a generic menu heading. Each service appears once, with all eligible variations in Square ordinal order. Larger categorized menus get category jump links. Descriptions are rendered as React text, never injected HTML.

Pricing follows Square's `FIXED_PRICING` / `VARIABLE_PRICING` representation and location overrides. Fixed money is formatted in its currency; variable prices say **Price varies**; absent/invalid prices say **See price when booking**. If Square supplies `price_description`, its plain-text label is preserved (for example, a starting-price label), without trying to parse it into a monetary value. The current pricing enum has no separate starting-price value. We do not infer `$X+` from a fixed price or manufacture starting-price semantics that the API did not supply. Verify that production catalog descriptions/prices accurately represent the owner's hosted menu, especially services advertised as starting at a price.

`service_duration` is milliseconds, formatted as minutes and hours (30 min, 1 hr 15 min, 2 hr 30 min). Missing/invalid duration says **Duration shown when booking**. The API duration is a single value, not an open-ended range; the site does not append `+` or derive duration from scheduling/transition-time fields. Square confirms the actual service details and timing during booking.

### Booking URL

`SQUARE_BOOKING_URL` is public Worker configuration returned with the service menu. The ignored local `.dev.vars` and `.dev.vars.example` contain the supplied Sandbox URL:

```text
https://app.squareupsandbox.com/appointments/buyer/widget/z1cxe63u4b0vzw/LM0PSJDNJQCZP
```

The two branded booking links navigate in the **same tab**, explicitly handing off to Square. Browser Back returns to the site. They share one all-services URL; customers select the service again in Square. No generated widget script, inline styles, service-specific URL construction or intermediate booking step is used.

Before launch, copy the seller's actual **production Advanced Widget URL** into the production Worker's `SQUARE_BOOKING_URL` alongside matching production Square environment/token/location configuration. Do not derive production widget IDs by editing the Sandbox URL. The Worker validates HTTPS, the matching Sandbox/production host and Advanced Widget path, rejecting credentials, query strings, fragments and script URLs. Changing the URL requires configuration only, not a React edit. Production credentials remain Cloudflare secrets. Nothing was deployed.

Square handles availability, customer information, booking creation, deposits/prepayments, policy enforcement, reminders and appointment management. This pass does not implement custom forms/waivers, appointment payments, persistence, recovery, webhooks or state synchronization.

### Service validation and manual launch checks

The 10 focused service tests cover mapping, pricing/descriptive labels, duration units, variation ordering, category/location handling, exclusions, malformed optional values, pagination, empty catalog, URL validation, HTTP methods and sanitized upstream/network errors. All 45 project tests passed. Build passed; lint reports only the two existing generated-file warnings.

Read-only Sandbox Catalog validation returned four representative services: Basic Gel Manicure and PROMO Gel Manicure were online-bookable and rendered at $40 / 1 hr and $25 / 1 hr. Acrylic Fill and Builder Gel Overlay were excluded because Square returned `available_for_booking: false`. The sampled services had no category assignments or `price_description` values, so categorized menus, multiple variations, variable/starting labels and alternate durations are covered by fixtures rather than claimed as live seller validation.

Browser checks confirmed the live service names, prices and durations at 1280px desktop and 375px mobile widths, with no horizontal overflow. Both booking links were inspected as DOM attributes and pointed to the supplied URL; they were not followed.

The supplied Sandbox hosted page is a known independent failure. It was not opened, retried or debugged. No Square Dashboard or sign-in page was accessed. The owner must manually verify the production widget destination, visible services/categories/variations, prices (including starting-price semantics), durations, automatic staff handling, availability, deposits/prepayments, policies, reminders and rescheduling/cancellation before launch. This site does not promise those features are enabled on Square Free merely because the Catalog API is accessible.

Official references: [SearchCatalogItems](https://developer.squareup.com/reference/square/catalog-api/search-catalog-items), [BatchRetrieveCatalogObjects](https://developer.squareup.com/reference/square/catalog-api/batch-retrieve-catalog-objects), [bookable service representation](https://developer.squareup.com/docs/bookings-api/use-the-api), [CatalogPricingType](https://developer.squareup.com/reference/square/enums/CatalogPricingType), and [Square service fields and price descriptions](https://developer.squareup.com/docs/catalog-api/update-catalog-objects).


## Instagram feed

The homepage's Instagram section sits directly below the Studio Menu and above the footer. React calls **GET `/api/instagram`**; only the Worker calls `https://graph.instagram.com/v25.0/me/media`. The existing Instagram API with Instagram Login connection is used as-is. There is no embed SDK, login flow, publishing, webhook, database or new dependency.

Set **`INSTAGRAM_ACCESS_TOKEN`** in the ignored local `.dev.vars` (already configured locally). `.dev.vars.example` contains only its empty placeholder. Keep it server-only; never use a `VITE_*` variable. For a future deployment, provision the same variable through Cloudflare secrets and maintain/replace the token there when needed. This pass does not deploy or automate token renewal. The token is sent only in Instagram's Authorization header and is never logged or included in the feed/cache response. Redirects are not followed.

The Worker requests a single page of six posts and only `id,caption,media_type,media_url,thumbnail_url,permalink,timestamp`. Its small typed response is `{ posts: [...] }`, with `id`, a caption excerpt (up to 500 characters), `mediaType`, `displayUrl`, `permalink` and nullable `timestamp`. It excludes upstream errors, paging cursors/URLs and arbitrary fields. Duplicates, invalid permalinks and unknown media types are skipped. The returned page is sorted newest-first; fewer than six posts is valid. It does not walk the account's media history to fill gaps.

Images/carousels use the returned cover image; videos/Reels use `thumbnail_url` only. No video player or MP4 source is loaded. Missing/expired images get a branded link to the original post. Preview URLs must be HTTPS Instagram/Meta CDN URLs (`cdninstagram.com` or `fbcdn.net`); post links must be HTTPS Instagram permalinks. CDN image requests contain no Instagram account token. Captions render as text, never HTML. Cards and the persistent follow CTA open Instagram in a new tab with accessible link names and `noopener noreferrer`.

Cloudflare's **Cache API** stores only normalized public responses for **15 minutes**, with **60 seconds** of browser caching. Query strings/cookies/visitor headers do not vary the cache key. API/network failures return a generic 503, cached at the edge for **60 seconds** to reduce repeated upstream failures. Missing configuration is not cached. Cache read/write failures do not break otherwise successful requests. Requests time out after eight seconds. The cache is per Cloudflare data center and best-effort, not a globally synchronized refresh schedule; concurrent cold misses may each fetch. No stale feed is retained beyond its TTL, so expired CDN URLs and removed posts are refreshed on the next miss. Rotating the token can leave the previous public feed visible for the remaining TTL. See [Cloudflare Cache API behavior](https://developers.cloudflare.com/workers/runtime-apis/cache/).

Loading, an empty feed, API failure and individual-image failure each have a designed state. A failed feed leaves the follow link available and does not affect the shop or appointments. The existing image CSP already permits HTTPS images; no broader script/connect policy was added.

Focused checks run with the existing Node test runner:

```sh
node --experimental-strip-types --test tests/instagram.test.mjs
npm test
npm run lint
npm run build
```

Use Node 22.13+ for tests as described above. The local default shell currently selects Node 20, which cannot run the existing `--experimental-strip-types` test command; validation used the already-installed Node 22.23.2. All 10 Instagram tests pass. The full suite currently has one pre-existing service URL validation mismatch: `tests/services.test.mjs` expects environment-specific widget URLs, while the current `worker/services.ts` permits additional Square booking destinations. That unrelated behavior/test was left unchanged. The two existing generated-file lint warnings also remain.

Live local validation returned six real posts (four videos/Reels and two carousels), with all six still previews loading. The feed was checked at 1280px desktop and 375px mobile widths; all six post links and the follow CTA remained available, without horizontal overflow or video elements. The fallback was also observed during local runtime validation. No Instagram authentication or account configuration was performed.
