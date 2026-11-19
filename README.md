# FrontDeskWise

FrontDeskWise is an AI front desk for local businesses. It answers website questions, captures leads, and moves visitors toward a booking or human handoff.

See [docs/architecture.md](docs/architecture.md) for the current high-level and low-level system architecture, request flows, tenant boundaries, and future integration points.
See [docs/data-and-integrations.md](docs/data-and-integrations.md) for the database inventory, lead fields, CRM delivery contract, and retry model.
See [docs/production-launch-checklist.md](docs/production-launch-checklist.md) for the first public deployment on `frontdeskwise.com`, Vercel/Render environment setup, SEO checks, acceptance tests, and the remaining account-owned work.
See [docs/auth-and-organization-lifecycle.md](docs/auth-and-organization-lifecycle.md) for the Firebase account flow, demo claiming, organization/business hierarchy, roles, and rollout sequence.

This repository starts with the product-led growth loop:

```text
Business URL → instant personalized demo → lead capture → owner dashboard → install
```

## First slice

- Public onboarding screen for entering a business website.
- Instant demo workspace using a realistic swim-school profile.
- Owner dashboard focused on leads, booking actions, unanswered questions, and AI readiness.
- Agent customization surface for greeting, color, FAQs, and action buttons.
- API and database scaffolding that keeps tenant boundaries explicit.
- URL crawling into bounded source text and tenant-scoped knowledge chunks.
- Grounded conversation testing with source citations, fallback gaps, and lead capture.
- Durable lead events with encrypted CRM webhook delivery, idempotency, retry, and sync status.

## Run locally

```bash
npm install --prefix apps/web
npm run dev
```

The API scaffold is intentionally separate:

```bash
npm install --prefix apps/api
npm run api:dev
```

Copy `apps/api/.env.example` to `apps/api/.env` when connecting a local or new FrontDeskWise database. Do not reuse the ApplyPilot database name or copy its credentials.

Run the versioned migrations before starting the API:

```bash
npm run db:migrate --prefix apps/api
```

With `DATABASE_URL` set, demo workspaces, sources, conversations, knowledge gaps, leads, and agent configuration persist in PostgreSQL. Without it, the API uses an in-memory fallback for local UI work. The first real API paths are:

- `POST /api/v1/demos` with `{ "websiteUrl": "https://example.com" }`
- `POST /api/v1/demo-access/exchange` with the `accessToken` returned by demo creation
- `POST /api/v1/demo/:slug/conversations`
- `POST /api/v1/demo/:slug/conversations/:conversationId/messages`
- `POST /api/v1/demo/:slug/leads`
- `GET /api/v1/demo/:slug/knowledge-gaps`

CRM delivery is configured from the owner dashboard with `POST /api/v1/demo/:slug/integrations` and tested with the integration test endpoint. The API stores the lead first, then asynchronously delivers a signed webhook or syncs a HubSpot contact. Set `FRONTDESKWISE_CREDENTIAL_KEY` through the staging/production secret manager before enabling CRM connections; no provider secret belongs in source control.

Demo creation now performs a bounded same-site crawl (up to 20 pages, depth 2), stores canonical URLs/page types/crawl status, and creates a 48-hour demo owner session with a hashed token in PostgreSQL. The tenant starts in `billing_mode = sandbox`, `is_demo = true`, `billing_status = trial`, and `plan_key = demo`; live checkout is intentionally not enabled yet.

The ingestion chunker targets approximately 520 tokens with 80-token overlap and preserves heading/page-type metadata. Owner routes now require the issued demo bearer token. Retrieval uses tenant-scoped PostgreSQL full-text search immediately and will add reciprocal-rank hybrid results when the optional embedding worker populates pgvector vectors.

The current widget is served as `apps/web/public/widget.js`. An authenticated owner can call `GET /api/v1/demo/:slug/widget/install` to receive the site key and copyable script snippet. Public widget traffic resolves by site key, not by database credentials or owner tokens.

## Product principle

The app should optimize for one outcome: `URL → correct answer → lead → booking`. Everything else is secondary until that loop works for real businesses.

# frontdeskwise
