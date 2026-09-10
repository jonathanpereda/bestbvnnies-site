# bestbvnnies

A branded React + TypeScript shop, built with Vite and served by a Cloudflare Worker with Static Assets. Product information comes from Square Catalog and Inventory. Square remains the system of record; this single-seller integration uses a server-side personal access token, not OAuth.

The site includes product browsing, a saved client-side cart, and a Square-validated checkout review. It does not collect payments or create orders. No appointments, waivers, webhooks, or database are implemented.

## Local setup

Use Node.js 22.13+ (the tests and category utility use built-in TypeScript stripping).

```sh
npm install
cp .dev.vars.example .dev.vars
```

If `.dev.vars` already exists, keep it and add only any missing configuration. Fill in:

| Variable | Value |
| --- | --- |
| `SQUARE_ACCESS_TOKEN` | Square **Sandbox personal access token**, server-only |
| `SQUARE_APPLICATION_ID` | Sandbox application ID; reserved, not used by catalog requests |
| `SQUARE_LOCATION_ID` | Sandbox location whose prices, availability, and inventory to display |
| `SQUARE_ENVIRONMENT` | `sandbox` for current development |
| `SQUARE_STOREFRONT_CATEGORY_ID` | Non-secret ID of the Square category to expose in the shop |

**Never commit `.dev.vars` or real credentials.** It is ignored by Git. Never put access tokens in React, a `VITE_*` variable, API responses, or logs. The example file contains empty placeholders only. Build output is also ignored and can contain a Worker-side copy of `.dev.vars` for local preview; never publish the entire `dist` directory as public assets. The public asset directory is `dist/client`.

### Choose the storefront category

Keep storefront products in one dedicated category in Square (the existing Sandbox category is named **Press-On Nails**). Run the read-only helper:

```sh
npm run square:categories
```

It reads local Sandbox credentials without displaying them, follows pagination, and prints category names and IDs only. Copy the intended category's `id` into `SQUARE_STOREFRONT_CATEGORY_ID` in `.dev.vars`. Alternatively use Square API Explorer in Sandbox mode: `GET /v2/catalog/list?types=CATEGORY`, following any cursor.

Do not use an item or variation ID here. Renaming the category is fine; deleting and recreating it requires updating the configured ID. The owner adds/removes products from the storefront by assigning/removing this category in Square, without code edits. Direct category membership is used; nested categories are not implicitly included. Only regular merchandise items enabled at the configured location are shown; appointment services are excluded.

```sh
npm run dev
```

Open Vite's printed local URL. Restart after changing `.dev.vars`. No application cache is used, so refreshing the page retrieves current Square data (subject to Square's own propagation).

## API and structure

- `GET /api/health`: Worker health; no Square configuration required.
- `GET /api/square/location`: Sandbox-only connectivity check, available only during Vite development. Returns 404 in built preview/deployments.
- `GET /api/products`: category-scoped, location-aware catalog. Returns application-facing `Product[]`, variations, optional images/descriptions, prices, inventory states, and an `inventoryUnavailable` flag. No raw Square objects are returned.
- `POST /api/checkout/quote`: validates the cart against current Square data and calls CalculateOrder without creating an order. See the checkout contract below.
- Known endpoints reject incorrect methods with 405 and the appropriate `Allow` header. Configuration errors return a sanitized 500; upstream/network errors return a sanitized 502. Each Square request has a 10-second timeout.

`worker/square/client.ts` centralizes REST authentication, API version (`2026-08-19`), timeouts, sanitized errors, and pagination. It chooses Sandbox or production URLs using `SQUARE_ENVIRONMENT`, rejecting all other values. Production has **not** been enabled or tested. When separately authorized, production will use its matching personal token as a Cloudflare secret and matching location/category configuration. `.dev.vars` does not provision deployed secrets.

`worker/products.ts` assembles the catalog, and `shared/products.ts` defines the frontend contract. The storefront uses category, location, and non-archived filters, defensively excludes deleted/non-sellable/unavailable variations, and omits items with no usable variations. `sellable: false` is excluded; omitted legacy flags are accepted. Images are retrieved in batches and HTTPS URLs are allowlisted by protocol; missing/deleted/invalid or browser-failed images use a branded text placeholder. Descriptions are rendered as text, never injected HTML.

### Price and inventory behavior

- Prices use the location override when present. Amounts remain in Square currency minor units until display. Missing/variable prices show **Price unavailable**, never an invented price.
- Inventory tracking uses the location override, falling back to the global flag. If both are absent, it is untracked.
- `in_stock`: a positive reported count at this location.
- `out_of_stock`: zero/negative count, or an active Square sold-out override (shown as zero).
- `untracked`: tracking is disabled; this is **not** an assertion of availability.
- `unknown`: tracking is enabled but the count is missing/invalid or inventory lookup failed; never silently treated as zero.
- A stock API failure preserves catalog browsing and marks stock unavailable. A catalog/image-batch API failure returns a retryable shop error.
- Stock is a snapshot, not a reservation. Quote requests revalidate it; the future payment flow must revalidate it again.

Catalog and stock reads do not require a paid Appointments subscription. The APIs used require catalog/inventory read access; Appointments paid-tier behavior is outside this chunk.

Official references: [Catalog search](https://developer.squareup.com/reference/square/catalog-api/search-catalog-items), [Inventory counts](https://developer.squareup.com/reference/square/inventory-api/batch-retrieve-inventory-counts), [location overrides](https://developer.squareup.com/reference/square/objects/ItemVariationLocationOverrides), [Catalog object locations](https://developer.squareup.com/reference/square/objects/CatalogObject).

## Brand foundation

`BBSite_specs.md` is the source of truth. Shared color, type, spacing, border, and layout tokens live in `src/index.css`; the current editorial/shop/cart presentation is in `src/App.css`. The supplied official wordmark is used in the header, footer, and cart. The press-on utility icon identifies the collection; unrelated utility icons are not used. SVG files are imported directly, without modification. The assets currently live directly in `src/assets/`, rather than the specification's `src/assets/branding/` path.

- **Bungee Regular** and **Roboto** load from Google Fonts with `display=swap` and system fallbacks. No font package dependency is added.
- **Faricy New Regular** has no licensed asset or configured Adobe Fonts web project in this repository. Body text intentionally falls back to Roboto until the owner supplies a licensed webfont or Adobe kit. See [Faricy New on Adobe Fonts](https://fonts.adobe.com/fonts/faricy-new).
- Corrected accent light blue is `#00A8A0`; green remains `#AFFE79`. Secondary backing pink `#FFB3B3` is used for the opaque cart/review view, without layering it over the primary pink shop. Original SVG colors and aspect ratios are preserved, even where their embedded colors differ slightly from the CSS palette.

## Cart and checkout review

No new configuration or dependencies are required beyond the existing Sandbox location/category/token. React owns the cart; `localStorage` key `bestbvnnies.cart.v1` stores **only variation IDs and quantities**, never prices. Missing/blocked storage falls back to an in-memory cart. Product details are reconstructed from the API on refresh. The native modal dialog supports keyboard focus containment, Escape, and return to the opening control. Different variations are separate cart lines.

The request contract is:

```json
{"items":[{"variationId":"SQUARE_VARIATION_ID","quantity":1}]}
```

The Worker rejects extra fields (including client prices), duplicate variations, invalid IDs/quantities, more than 100 lines, quantities outside 1–99, and bodies over 32 KiB. These are defensive implementation limits, not inventory or business purchase policies. Requests require `Content-Type: application/json`.

Each quote reads the current category/location-filtered catalog and inventory through the existing product module. Deleted, archived, non-sellable, out-of-category, and missing/variable-price variations cannot be quoted. Insufficient tracked stock returns a 409 with per-variation issues and a suggested available quantity. Unknown tracked stock blocks review until it can be checked. Untracked stock is permitted deliberately, but an active sold-out override still blocks it. The customer explicitly applies quantity reductions or removals; successful reviews update the displayed prices/stock and announce price changes.

`worker/square/orders.ts` calls **CalculateOrder**, using catalog variation references and freshly retrieved location prices. `auto_apply_taxes` and `auto_apply_discounts` let Square apply catalog taxes and eligible catalog pricing rules; the browser cannot select taxes or discounts. An arbitrary saved discount without an applicable pricing rule is not automatically applied. The returned `CheckoutQuote` contains only validated line details, integer money amounts, currency, totals, and calculation time. Subtotal is before discounts and excludes tax: `total + discount - tax`, so inclusive taxes are not counted twice. The estimated cart subtotal can include catalog-inclusive taxes; the validated breakdown separates them.

The UI invalidates a quote when quantities change, ignores aborted responses, supports retry, and clearly states that payment is unavailable. Opening a cart never creates an order. CalculateOrder creates no order ID, reserves no stock, and cannot be used as a trusted payment authorization. Quotes are not persisted.

### Before payments

- Revalidate server-side immediately before creating/paying an order. Never accept a browser quote total as authoritative. Define idempotency, order/payment failure recovery, and stock-race handling; neither this inventory read nor CalculateOrder reserves stock.
- Decide shipping versus pickup, fulfillment costs and address-dependent tax requirements. Current totals cover merchandise and Square catalog taxes/eligible discounts only. No fulfillment cost, tips, modifiers, customer-specific discount eligibility, or loyalty redemptions are included. Quantities currently represent whole merchandise units.
- Verify actual seller tax configuration, inclusive taxes, and intended automatic discount rules in Sandbox and later production. The existing three Sandbox products calculated zero tax and zero discount; tax/discount response mapping is covered by mocked tests, not a changed seller catalog.
- CalculateOrder is currently documented as **Beta**. CreateOrder is intentionally deferred; that future endpoint creates a persistent order and supports an idempotency key. No paid Appointments tier is required for this merchandise quote flow; Appointments plan features are separate. Orders API usage with non-Square payment providers has a separate fee policy; the planned payment provider remains Square.
- No production testing or deployment has occurred. The personal token stays server-side; this integration remains single-seller without OAuth.

Official references: [CalculateOrder](https://developer.squareup.com/reference/square/orders/calculate-order), [CreateOrder](https://developer.squareup.com/reference/square/orders/create-order), [catalog taxes](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts/auto-apply-taxes), [catalog discount rules](https://developer.squareup.com/docs/orders-api/apply-taxes-and-discounts/auto-apply-discounts), [OrderLineItem money fields](https://developer.squareup.com/reference/square/objects/OrderLineItem), [Orders API overview and fee note](https://developer.squareup.com/reference/square/orders).

## Validation

```sh
npm run test
npm run lint
npm run build
```

Tests use Node's built-in test runner with mocked Square responses, not live credentials. They cover filtering, pagination, price/inventory overrides, missing data, inventory outages, safe errors, environment selection, route restrictions, cart persistence/variation identity, strict quote requests, stock failures, current prices, inclusive/additive tax mapping, discounts, and malformed Square responses.

`npm run preview` builds and previews locally; `npm run deploy` builds and deploys to the authenticated Cloudflare account. Do not deploy against production Square until explicitly authorized. `npm run cf-typegen` regenerates Worker types after binding changes.
