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
- Owner-configured completion connectors with a durable action retry queue; failed external delivery never removes the saved lead.
- Versioned action workflows with generic steps (`ask`, `capture`, `form`, `condition`, `lookup`, `recommend`, `select`, `confirm`, `book`, `generate_link`, `handoff`, and `complete`), interruption state, repeatable participants, and provider completion-link prefill mappings.
- Conversion telemetry for flow starts, field progress, forms, action outcomes, handoffs, booking links, and abandonment.

Offline certification is split into an evaluation pyramid so failures are attributable:

```text
retrieval → action routing/argument extraction → workflow/conversation certification
```

Run the complete isolated suite with `npm run certification:pyramid --prefix apps/api`. The report is written to `apps/api/benchmark-results/` and includes Recall@5, Precision@5, MRR, NDCG@5, incorrect-action rate, unnecessary-action rate, workflow process/outcome rates, and the existing reference workflow results. Reports include commit identity, a prior-run baseline, and score deltas when available. Individual layers are available through `retrieval:certify`, `action-routing:certify`, and `reference:certify`.

The release sequence is available as `npm run release:gate`: API tests → certification pyramid → API build → web build. Super Admin’s Certification view exposes the latest run, per-layer status, score movement, reference-business results, and redacted production improvement signals.

Workflow certification also runs a deterministic publication gate for graph reachability, required-field capture, provider dependencies, and verified completion links. Reference workflows report process and outcome pass rates separately. Runtime loop guards persist compact state fingerprints, hand off after repeated non-progress, and emit tenant-scoped improvement signals for low-confidence answers, corrections, provider failures, handoffs, and loops; these signals are evaluation data, not automatic workflow changes.

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
- `GET /api/v1/demo/:slug/actions` and `POST/PUT/DELETE /api/v1/demo/:slug/actions...` for owner-configured conversation flows
- `POST /api/v1/demo/:slug/conversations/:conversationId/actions/:actionId/submit` for compact form completion
- `POST /api/v1/demo/:slug/leads`
- `GET /api/v1/demo/:slug/knowledge-gaps`

CRM delivery is configured from the owner dashboard with `POST /api/v1/demo/:slug/integrations` and tested with the integration test endpoint. The API stores the lead first, then asynchronously delivers a signed webhook or syncs a HubSpot contact. Set `FRONTDESKWISE_CREDENTIAL_KEY` through the staging/production secret manager before enabling CRM connections; no provider secret belongs in source control.

Flows can optionally run a completion connector after the lead is saved. The current owner UI supports email-to-team, HubSpot, and the generic signed webhook connector; the latter is the fast path for Jackrabbit, Square, Mindbody, Calendly, or another vendor through Zapier, Make, or a business-owned endpoint. `action_outbox` retries delivery independently of the lead record.

Actions can also define a versioned `steps` graph. Existing field-based flows remain supported, while V2 flows can pause for knowledge answers, resume from a durable cursor, and generate an external completion link from explicitly mapped values. Provider-owned signatures, policies, and payment fields stay outside FrontDeskWise.

The public widget posts conversion events to `POST /api/v1/widget/:siteKey/telemetry`. Events are stored in `conversion_events` with tenant, conversation, flow, field, source-page, device, and timestamp context. Workspace analytics exposes the resulting flow funnel and field drop-offs.

MCP is available as a separate assistant-tool connection path under the owner dashboard’s Connections screen. Owners connect a provider-issued MCP URL and token, FrontDeskWise discovers the available tools, and read-only tools are enabled by default. Write or destructive tools require explicit permission; deterministic completion actions continue using the existing connector and retry architecture.

Demo creation now performs a bounded same-site crawl (up to 20 pages, depth 2), stores canonical URLs/page types/crawl status, and creates a 48-hour demo owner session with a hashed token in PostgreSQL. The tenant starts in `billing_mode = sandbox`, `is_demo = true`, `billing_status = trial`, and `plan_key = demo`; live checkout is enabled only when matched Stripe test/live secrets, webhook signing, and configured recurring Price IDs are present on the API.

The ingestion chunker targets approximately 520 tokens with 80-token overlap and preserves heading/page-type metadata. Owner routes now require the issued demo bearer token. Retrieval uses tenant-scoped PostgreSQL full-text search immediately and will add reciprocal-rank hybrid results when the optional embedding worker populates pgvector vectors.

The current widget is served as `apps/web/public/widget.js`. An authenticated owner can call `GET /api/v1/demo/:slug/widget/install` to receive the site key and copyable script snippet. Public widget traffic resolves by site key, not by database credentials or owner tokens. Optional page scoping through `data-pages` is documented in [`docs/widget-installation.md`](docs/widget-installation.md).

## Product principle

The app should optimize for one outcome: `URL → correct answer → lead → booking`. Everything else is secondary until that loop works for real businesses.

# frontdeskwise
