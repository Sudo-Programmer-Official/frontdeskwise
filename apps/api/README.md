# FrontDeskWise API

The API owns tenant-scoped businesses, website ingestion, conversations, leads, knowledge gaps, actions, and agent configuration.

The current API exposes:

- `GET /health`
- `GET /ready` for deployment readiness, including a live PostgreSQL check.
- `POST /api/v1/demos` to crawl a bounded public site and create a persisted demo workspace plus owner access session.
- `POST /api/v1/demo-access/exchange` to validate a short-lived demo token and return the tenant-scoped workspace.
- `GET /api/v1/demo/:slug`
- `POST /api/v1/demo/:slug/conversations`
- `POST /api/v1/demo/:slug/conversations/:conversationId/messages` for grounded answers or fallback gaps.
- `GET /api/v1/demo/:slug/knowledge-gaps`
- `POST /api/v1/demo/:slug/knowledge-gaps/resolve`
- `GET /api/v1/demo/:slug/retrieval-diagnostics`
- `GET /api/v1/demo/:slug/knowledge/embedding-status`
- `POST /api/v1/demo/:slug/knowledge/reindex`
- `GET /api/v1/demo/:slug/widget/install`
- `GET /api/v1/demo/:slug/leads`
- `POST /api/v1/demo/:slug/leads`
- `POST /api/v1/demo/:slug/actions/booking`
- `GET /api/v1/demo/:slug/integrations`
- `POST /api/v1/demo/:slug/integrations` to save an encrypted webhook connection
- `POST /api/v1/demo/:slug/integrations/:integrationId/test`
- `POST /api/v1/demo/:slug/integrations/:integrationId/retry`
- `GET /api/v1/demo/:slug/integrations/:integrationId/syncs`

Public widget routes use the generated site key rather than a tenant slug:

- `GET /api/v1/widget/:siteKey/config`
- `POST /api/v1/widget/:siteKey/conversations`
- `POST /api/v1/widget/:siteKey/conversations/:conversationId/messages`
- `POST /api/v1/widget/:siteKey/leads`

Dashboard-only reads, including `GET /api/v1/demo/:slug`, demo test conversations, dashboard lead capture, booking actions, integrations, and agent configuration require `Authorization: Bearer <demo-token>` (or `X-FrontDeskWise-Demo-Token`). Public visitor conversation, lead capture, and booking routes use the generated widget site key instead.

Database migrations are versioned under `../../infra/db/` and applied with `npm run db:migrate`. The migration runner records checksums in `fdw_schema_migrations` and uses an advisory lock so migrations are safe to run repeatedly. Use a new database named `frontdeskwise`; with `DATABASE_URL` set, the API persists demo tenants, access sessions, crawl metadata, conversations, leads, billing state, and entitlements in PostgreSQL and otherwise falls back to memory for local UI work.

Demo sessions are hashed before storage and expire after 48 hours. The `workspace_users.identity_subject` column is reserved for the project’s Identity SDK subject once that provider is wired into FrontDeskWise; the current public demo flow does not invent a second password-based identity system.

Migration `006_retrieval_search_fields.sql` adds a generated `tsvector` plus embedding metadata, and `007_grounded_answer_contract.sql` adds confidence, citations, and retrieval diagnostics fields. Set `OPENAI_API_KEY` and optionally `FRONTDESKWISE_EMBEDDING_MODEL` to enable asynchronous pgvector hydration; without a key, the API remains fully functional with PostgreSQL full-text retrieval.

Migration `008_embedding_jobs_widget.sql` adds retryable embedding jobs and public widget site keys. The install endpoint returns a copyable script snippet; `apps/web/public/widget.js` is the current shadow-DOM widget implementation.

Assistant messages now carry a grounded-answer contract: confidence score/band, citations, retrieval mode, and candidate count. Low-confidence answers become open knowledge gaps; an owner-approved answer is reused for the exact normalized question until it is changed.

Lead capture persists the contact, provenance, consent timestamp, bounded campaign metadata, and a `lead.created` event before any external delivery. Active CRM connections receive durable outbox jobs. The generic webhook adapter sends an idempotency key and optional HMAC signature; the native HubSpot adapter upserts contacts by email and can log a capture note. Both paths retry with exponential backoff and record remote IDs and failures in `crm_sync_records`. FrontDeskWise remains the source of truth if a CRM is unavailable.

CRM credentials are encrypted with AES-256-GCM using `FRONTDESKWISE_CREDENTIAL_KEY`, are never returned to the dashboard, and must be injected through a secret manager. The current adapters are a signed webhook and HubSpot private-app token; OAuth and additional native adapters can be added behind the same contract later.

The database config rejects URLs targeting another database name, normalizes the sibling service’s `postgresql+asyncpg` format, and handles RDS SSL explicitly. Credentials should be injected through the environment or a secret manager; do not commit a real `.env` file.

In production, the API fails closed unless PostgreSQL, the CRM encryption key, OpenAI, explicit web/widget origins, and an RDS CA value are configured. `DATABASE_SSL_CA` accepts PEM; `DATABASE_SSL_CA_BASE64` accepts the same certificate encoded as base64. Requests receive a request ID and process-local rate-limit headers; add an edge/WAF limit before horizontal scaling.

