# bestbvnnies Site

## Project Overview

This repository contains the custom website for bestbvnnies, a nail business.

The site will provide:

- Online appointment booking
- Appointment deposits
- A required liability waiver before booking completion
- An online shop for press-on nails and other products
- Online payments
- Order and inventory integration with Square

The business owner already uses Square for appointments and should continue managing normal business operations through Square without developer intervention.

## Technology Stack

Frontend:
- React
- TypeScript
- Vite

Backend:
- Cloudflare Workers

Hosting:
- Cloudflare Workers with Static Assets

External platform:
- Square APIs

Development starts against Square Sandbox.

## Architecture Rules

Square should remain the system of record wherever practical.

Square owns and manages:
- Products and catalog data
- Inventory
- Orders
- Payments
- Customers
- Services
- Appointment availability
- Appointments

Do not duplicate Square-owned state in a custom database unless there is a specific requirement that Square cannot satisfy.

A small custom persistence layer may eventually be required for liability waivers or other site-specific records, but do not introduce a database until it is actually needed.

## Square Integration

All privileged Square API requests must be performed by the Cloudflare Worker.

Never expose the Square access token in frontend code.

Never hardcode real Square product IDs, service IDs, prices, inventory quantities, or appointment availability into React components.

Retrieve Square-owned business data through the Square APIs.

Development must use Square Sandbox until production integration is explicitly requested.

Environment variables currently used:

- SQUARE_ACCESS_TOKEN
- SQUARE_APPLICATION_ID
- SQUARE_LOCATION_ID
- SQUARE_ENVIRONMENT

Do not commit credentials or secret values.

## Payments

Never collect, transmit, log, or store raw credit-card numbers in application code.

Use Square-supported payment flows such as the Square Web Payments SDK and Payments API.

Square must handle sensitive payment-card information.

The current appointment payment requirement is a deposit.

A future Square plan upgrade may allow card-on-file or no-show protection. Do not recreate those features independently unless explicitly requested.

## Appointment Booking

The site should integrate with Square Appointments rather than maintaining an independent appointment calendar.

Availability, services, staff/resources when applicable, and bookings should come from Square.

The business owner must be able to continue changing services, prices, and availability through Square without requiring code changes.

A liability waiver is required as part of the booking flow.

Do not assume Square can persist the custom liability waiver unless verified through the relevant API or Square feature.

## Shop

Products should come from the Square Catalog API.

Inventory should come from Square inventory data.

Orders and payments should be created through Square.

The owner should be able to add products, change prices, adjust inventory, and manage orders through Square without modifying this repository.

## Backend API

Backend routes belong under `/api`.

Prefer small, focused Worker routes.

Examples of likely future endpoints:

- /api/health
- /api/products
- /api/availability
- /api/bookings
- /api/payments
- /api/waivers
- /api/webhooks/square

Do not expose server-only secrets through API responses.

## Frontend

Use responsive, mobile-first layouts.

Keep business logic separate from presentation components where practical.

Prefer reusable components rather than duplicating UI.

Do not hardcode business data that belongs in Square.

## Code Quality

Use TypeScript types for API request/response models.

Handle loading, empty, success, and error states explicitly.

Validate user input.

Add tests for meaningful business logic.

Run before considering work complete:

- npm run build
- npm run lint

Do not make unrelated refactors while implementing focused tasks.

## Working With This Repository

Before making substantial changes:

1. Inspect the relevant existing files.
2. Understand the current architecture.
3. Check current official Square documentation when implementing Square-specific behavior.
4. Identify relevant Square Free plan or API limitations before creating custom infrastructure.
5. Prefer the smallest architecture that satisfies the requirement.

When requirements are ambiguous, do not invent business rules. State the ambiguity and ask for clarification.