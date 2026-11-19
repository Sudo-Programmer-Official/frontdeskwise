# FrontDeskWise first public launch

The first public environment will use:

- Web: `https://frontdeskwise.com`
- API: `https://api.frontdeskwise.com`
- Database: the existing RDS instance, targeting the dedicated `frontdeskwise` database

This is a speed-first production launch, not the final general-availability posture. Keep the existing RDS credentials in the deployment secret manager only; do not put them in this repository, the browser bundle, or chat.

## Code-side work completed

- Render is configured as the production API service in `render.yaml`.
- The API migration runner is forward-only, checksum-verified, advisory-locked, and runs before deployment.
- Production env templates use the public domains and support RDS CA validation through `DATABASE_SSL_CA_BASE64`.
- The API has `/health` liveness, `/ready` database readiness, request IDs, security headers, and process-local request limits.
- The public web build generates the production canonical URL, robots file, sitemap, manifest, and structured metadata when built with `VITE_SITE_ORIGIN=https://frontdeskwise.com`.
- Leads remain durable in FrontDeskWise before CRM delivery. Webhook and HubSpot delivery are idempotent, encrypted, retryable, and observable from the owner dashboard.
- The frontend API origin is build-time configurable and is no longer coupled to the Vercel origin.

## Six remaining launch items

### 1. Deploy the API and bind the API domain

In Render, create the service from `render.yaml`, set the existing RDS URL with `/frontdeskwise` as the database path, and add the secret values listed below. Attach `api.frontdeskwise.com` to the service and create the DNS record Render provides.

Verify:

```text
GET https://api.frontdeskwise.com/health  → 200
GET https://api.frontdeskwise.com/ready   → 200 and database: "ready"
```

### 2. Deploy the web app and bind the main domain

In Vercel, import this repository with project root `apps/web`. The checked-in `apps/web/vercel.json` supplies the build and output settings. Set:

```text
VITE_API_ORIGIN=https://api.frontdeskwise.com
VITE_SITE_ORIGIN=https://frontdeskwise.com
```

Attach `frontdeskwise.com` and `www.frontdeskwise.com` according to the DNS records Vercel provides. Redirect `www` to the canonical apex domain if the product should have one canonical URL.

### 3. Inject production secrets

Set these only in Render/Vercel secret settings:

```text
DATABASE_URL=the existing RDS URL, with /frontdeskwise as the database name
FRONTDESKWISE_CREDENTIAL_KEY=a unique 32-byte production key
DATABASE_SSL_CA_BASE64=the trusted RDS CA PEM encoded as base64
OPENAI_API_KEY=the production OpenAI key
```

Keep `DATABASE_SSL_REJECT_UNAUTHORIZED=true`. If the current RDS certificate chain is not available to Render yet, stop before public traffic and add the CA value; do not silently downgrade certificate validation for the public service.

### 4. Complete the owner identity boundary

The current URL demo uses a short-lived hashed bearer session so the value loop can be tested. Before selling accounts, exchange the demo session into the existing Identity SDK session and bind `workspace_users.identity_subject` to the verified identity subject. Do not add a second password store. This is the one remaining application integration that cannot be completed from deployment configuration alone because it requires the Identity SDK issuer/client settings.

### 5. Keep billing disabled until the webhook contract is verified

The database already models sandbox/live billing, plans, entitlements, and billing events. The first public build may keep the demo path enabled, but live checkout must remain disabled until the subscription provider webhook is signature-verified, idempotent, and tested for activation, cancellation, grace, and retry. Do not mark a workspace paid from a browser return URL.

### 6. Run the acceptance and operations pass

- Submit a disposable public website URL and confirm a tenant, crawl sources, owner token, and dashboard.
- Ask a supported question and verify citation/source metadata.
- Ask an unsupported question and verify a safe fallback plus knowledge gap.
- Capture a lead from the dashboard and widget; confirm `leads`, `lead_events`, and outbox state.
- Connect a webhook or HubSpot sandbox and verify sync, retry, idempotency, and no credential exposure.
- Confirm `robots.txt`, `sitemap.xml`, canonical metadata, mobile layout, and `api.frontdeskwise.com` network calls.
- Configure database backups/restore verification, alerting, log retention, PII deletion/retention policy, and a scheduled recrawl plan.

## Deployment order

1. Confirm the RDS security group allows the Render service to reach PostgreSQL.
2. Create the Render service and inject secrets.
3. Let `preDeployCommand: npm run db:migrate` apply/check migrations.
4. Verify `/health` and `/ready` on the Render URL.
5. Attach `api.frontdeskwise.com` and verify again.
6. Deploy Vercel with the production Vite variables.
7. Attach `frontdeskwise.com`, verify SEO artifacts, then run the acceptance pass.

If the selected Render plan does not support `preDeployCommand`, run `npm run db:migrate` once from a controlled environment using the production secret and verify the migration output before starting the service. Never run migrations inside the long-lived request process.

## Future staging

When isolated staging is needed, create a separate database and Render/Vercel origins. The retained [staging launch checklist](staging-launch-checklist.md) describes that future path; it should not be used as the current public-domain configuration.
