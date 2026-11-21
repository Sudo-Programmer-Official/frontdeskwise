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
- `GET /api/v1/demo/:slug/actions` and `POST/PUT/DELETE /api/v1/demo/:slug/actions...` for owner-configured capture flows.
- `POST /api/v1/demo/:slug/conversations/:conversationId/actions/:actionId/submit` for inline or hybrid form completion.
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
- `GET /api/v1/demo/:slug/mcp-connections`
- `POST /api/v1/demo/:slug/mcp-connections` to test, discover, and save an encrypted MCP connection
- `POST /api/v1/demo/:slug/mcp-connections/:connectionId/test`
- `PATCH /api/v1/demo/:slug/mcp-connections/:connectionId/tools` to save the explicit tool allowlist
- `DELETE /api/v1/demo/:slug/mcp-connections/:connectionId`
- `GET /api/v1/demo/:slug/inbox` for business-scoped staff inbox filters and conversation summaries.
- `GET /api/v1/demo/:slug/conversations/:conversationId` for staff conversation detail, events, and private notes.
- `POST /api/v1/demo/:slug/conversations/:conversationId/takeover` to claim a conversation for human takeover.
- `POST /api/v1/demo/:slug/conversations/:conversationId/assign`, `/return-to-ai`, `/resolve`, `/messages/human`, `/ai-assist`, and `/notes` for deterministic staff operations.
- `GET /api/v1/demo/:slug/team`, `POST /api/v1/demo/:slug/team/invite`, and `PATCH /api/v1/demo/:slug/team/:userId` for business-scoped team access.
- `GET /api/v1/demo/:slug/notifications` and `POST /api/v1/demo/:slug/notifications/:notificationId/read` for the in-app notification center.
- `GET/PATCH /api/v1/messaging/preferences` for owner-controlled operational email preferences; billing and security notices remain mandatory.

Super-admin lifecycle messaging controls are available under `/api/v1/admin/messaging/*` for template editing and test sends, automation enable/disable and delays, delivery summaries/logs, and retrying failed deliveries. Migration `026_lifecycle_messaging.sql` seeds the V1 templates and automations. Messages are queued and retried asynchronously through the configured SES provider; FrontDeskWise remains the canonical template store.

`POST /api/v1/webhooks/email/ses` accepts normalized SES event payloads with the `x-frontdeskwise-email-secret` header and records delivery, bounce, complaint, open, and click events against the stored provider message ID.

Public widget routes use the generated site key rather than a tenant slug:

- `GET /api/v1/widget/:siteKey/config`
- `POST /api/v1/widget/:siteKey/conversations`
- `POST /api/v1/widget/:siteKey/conversations/:conversationId/messages`
- `POST /api/v1/widget/:siteKey/conversations/:conversationId/actions/:actionId/submit`
- `GET /api/v1/widget/:siteKey/conversations/:conversationId` for visitor-safe status and human-message polling.
- `POST /api/v1/widget/:siteKey/leads`

Dashboard-only reads, including `GET /api/v1/demo/:slug`, demo test conversations, dashboard lead capture, booking actions, integrations, and agent configuration require `Authorization: Bearer <demo-token>` (or `X-FrontDeskWise-Demo-Token`). Public visitor conversation, lead capture, and booking routes use the generated widget site key instead.

Database migrations are versioned under `../../infra/db/` and applied with `npm run db:migrate`. The migration runner records checksums in `fdw_schema_migrations` and uses an advisory lock so migrations are safe to run repeatedly. Use a new database named `frontdeskwise`; with `DATABASE_URL` set, the API persists demo tenants, access sessions, crawl metadata, conversations, leads, billing state, and entitlements in PostgreSQL and otherwise falls back to memory for local UI work.

Demo sessions are hashed before storage and expire after 48 hours. Firebase Auth owns email/password sign-up/sign-in, Google sign-in, and password reset; the API verifies Firebase ID tokens and maps the verified subject to `app_users`, organizations, and business memberships. Migration 010 adds the multi-business hierarchy and claims temporary demos into the authenticated organization. `workspace_users` remains as a compatibility table for the current hashed demo bearer path while the Identity SDK migration is completed.

Migration `006_retrieval_search_fields.sql` adds a generated `tsvector` plus embedding metadata, and `007_grounded_answer_contract.sql` adds confidence, citations, and retrieval diagnostics fields. Set `OPENAI_API_KEY` and optionally `FRONTDESKWISE_EMBEDDING_MODEL` to enable asynchronous pgvector hydration. Without a healthy provider, the API may continue in explicitly labeled degraded PostgreSQL full-text mode with conservative abstention.

Migration `008_embedding_jobs_widget.sql` adds retryable embedding jobs and public widget site keys. The install endpoint returns a copyable script snippet; `apps/web/public/widget.js` is the current shadow-DOM widget implementation. Integrators can optionally add `data-pages="/path,/other/*"` to scope the widget to selected URL paths; see [`docs/widget-installation.md`](../../docs/widget-installation.md).

Assistant messages now carry a grounded-answer contract: confidence score/band, citations, retrieval mode, and candidate count. Low-confidence answers become open knowledge gaps; an owner-approved answer is reused for the exact normalized question until it is changed.

Lead capture persists the contact, provenance, consent timestamp, bounded campaign metadata, and a `lead.created` event before any external delivery. Active CRM connections receive durable outbox jobs. The generic webhook adapter sends an idempotency key and optional HMAC signature; the native HubSpot adapter upserts contacts by email and can log a capture note. Both paths retry with exponential backoff and record remote IDs and failures in `crm_sync_records`. FrontDeskWise remains the source of truth if a CRM is unavailable.

CRM credentials are encrypted with AES-256-GCM using `FRONTDESKWISE_CREDENTIAL_KEY`, are never returned to the dashboard, and must be injected through a secret manager. The current adapters are a signed webhook and HubSpot private-app token; OAuth and additional native adapters can be added behind the same contract later.

MCP connections use the same encryption key but a separate `mcp_connections` table. The first guided UI supports HubSpot, Zapier, Make, and custom MCP servers through a provider-issued server URL and bearer token. Connection setup discovers the tool catalog, enables read-only tools by default, and requires explicit owner permission for write or destructive tools. OAuth handshakes and agent-runtime tool execution are intentionally separate follow-up work; critical lead, booking, and enrollment actions remain on deterministic connectors.

The database config rejects URLs targeting another database name, normalizes the sibling service’s `postgresql+asyncpg` format, and handles RDS SSL explicitly. Credentials should be injected through the environment or a secret manager; do not commit a real `.env` file.

In production, the API fails closed unless PostgreSQL, the CRM encryption key, OpenAI, Stripe secrets, explicit web/widget origins, and an RDS CA value are configured. `DATABASE_SSL_CA_FILE` reads a PEM bundle from a runtime file such as Render's `/etc/secrets/rds-ca.pem`; `DATABASE_SSL_CA` accepts PEM and `DATABASE_SSL_CA_BASE64` is a local alternative. Requests receive a request ID and process-local rate-limit headers; add an edge/WAF limit before horizontal scaling.

