# bestbvnnies

A branded React + TypeScript shop, built with Vite and served by a Cloudflare Worker with Static Assets. Product information comes from Square Catalog and Inventory. Square remains the system of record; this single-seller integration uses a server-side personal access token, not OAuth.

This chunk is browsing only: no cart, checkout, payments, appointments, waivers, webhooks, or database.

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
- Known endpoints reject non-GET methods with 405 and `Allow: GET`. Configuration errors return a sanitized 500; upstream/network errors return a sanitized 502. Each Square request has a 10-second timeout.

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
- Stock is a snapshot, not a reservation. Future checkout must revalidate inventory and prices.

Catalog and stock reads do not require a paid Appointments subscription. The APIs used require catalog/inventory read access; Appointments paid-tier behavior is outside this chunk.

Official references: [Catalog search](https://developer.squareup.com/reference/square/catalog-api/search-catalog-items), [Inventory counts](https://developer.squareup.com/reference/square/inventory-api/batch-retrieve-inventory-counts), [location overrides](https://developer.squareup.com/reference/square/objects/ItemVariationLocationOverrides), [Catalog object locations](https://developer.squareup.com/reference/square/objects/CatalogObject).

## Brand foundation

`BBSite_specs.md` is the source of truth. Shared color, type, spacing, border, and layout tokens live in `src/index.css`; the current editorial/shop presentation is in `src/App.css`. The header and product presentation are reusable components. The text wordmark is temporary, not a permanent logo.

- **Bungee Regular** and **Roboto** load from Google Fonts with `display=swap` and system fallbacks. No font package dependency is added.
- **Faricy New Regular** has no licensed asset or configured Adobe Fonts web project in this repository. Body text intentionally falls back to Roboto until the owner supplies a licensed webfont or Adobe kit. See [Faricy New on Adobe Fonts](https://fonts.adobe.com/fonts/faricy-new).
- The spec gives **both** accent green and accent light blue `#AFFE79`. The tokens preserve that value; no replacement blue is invented. Deep blue remains `#030252` and primary pink `#CA3F8B`.

## Validation

```sh
npm run test
npm run lint
npm run build
```

Tests use Node's built-in test runner with mocked Square responses, not live credentials. They cover filtering, pagination, price/inventory overrides, missing data, inventory outages, safe errors, environment selection, and route restrictions.

`npm run preview` builds and previews locally; `npm run deploy` builds and deploys to the authenticated Cloudflare account. Do not deploy against production Square until explicitly authorized. `npm run cf-typegen` regenerates Worker types after binding changes.
