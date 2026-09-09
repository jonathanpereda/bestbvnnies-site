# bestbvnnies

A minimal React + TypeScript frontend built with Vite, served with a Cloudflare Worker and Static Assets. Square remains the intended system of record. Business features are not implemented yet.

## Local setup

```sh
npm install
cp .dev.vars.example .dev.vars
```

Fill in `.dev.vars` using your Square Developer Console Sandbox application:

- `SQUARE_ACCESS_TOKEN`: Sandbox access token (server-only).
- `SQUARE_APPLICATION_ID`: Sandbox application ID; reserved for future integration and currently unused.
- `SQUARE_LOCATION_ID`: Sandbox location ID.
- `SQUARE_ENVIRONMENT`: set to `sandbox`.

The connectivity check requires the access token, location ID, and environment. The token needs `MERCHANT_PROFILE_READ` permission; see [Square Retrieve location](https://developer.squareup.com/reference/square/locations-api/retrieve-location).

**Never commit `.dev.vars` or real credentials.** The file is ignored by Git. Keep secrets out of frontend code, API responses, and logs.

```sh
npm run dev
```

Open the local URL printed by Vite. Restart the dev server after changing `.dev.vars`.

- `GET /api/health`: confirms the Worker is running; does not check Square.
- `GET /api/square/location`: checks Sandbox location access and returns only a success status, not location data. Available only in Vite development; production builds, including preview, return 404. It never calls Square production.

Known endpoints accept only GET (405 otherwise). The Square check returns 500 for missing/invalid configuration and 502 for upstream errors, network failures, or a 10-second timeout. It does not require the application ID yet.

## Validation and deployment

```sh
npm run lint
npm run build
```

`npm run preview` builds and previews locally. `npm run deploy` builds and deploys to your authenticated Cloudflare account using `wrangler.jsonc`. The local `.dev.vars` file does not provision deployed secrets. The health endpoint and placeholder page need no Square credentials in production.

`npm run cf-typegen` regenerates Worker types after binding changes.
