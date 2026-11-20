# FrontDeskWise first public launch

The first public environment will use:

- Web: `https://frontdeskwise.com` and `https://www.frontdeskwise.com`
- API: `https://api.frontdeskwise.com`
- Database: the existing RDS instance, targeting the dedicated `frontdeskwise` database

This is a speed-first production launch, not the final general-availability posture. Keep the existing RDS credentials in the deployment secret manager only; do not put them in this repository, the browser bundle, or chat.

## Brand and legal identity

FrontDeskWise is the customer-facing product brand operated by Sudo Programmer, Inc. Use this relationship consistently in the public website, legal pages, billing records, support messages, and OAuth branding:

- Product/app name: `FrontDeskWise`
- Operator and legal/billing entity: `Sudo Programmer, Inc.`
- Public positioning: `FrontDeskWise by Sudo Programmer, Inc.`
- Application home page: `https://www.frontdeskwise.com`
- Privacy policy: `https://www.frontdeskwise.com/privacy`
- Terms of service: `https://www.frontdeskwise.com/terms`
- Developer contact: `hello@frontdeskwise.com`

Configure the app name, home page, privacy policy, terms URL, and developer contact in the Google Cloud OAuth consent-screen/branding settings. This is a Google Cloud configuration step, separate from Firebase Authorized Domains and separate from the web hosting provider. Keep `hello@frontdeskwise.com` monitored because it is the published product and privacy contact.

## Code-side work completed

- Render is configured as the production API service in `render.yaml`.
- The Render build explicitly installs dev dependencies so the TypeScript compiler and Node.js type definitions are available even with `NODE_ENV=production`.
- The API migration runner is forward-only, checksum-verified, advisory-locked, and runs before deployment.
- Production env templates use the public domains and support RDS CA validation through a Render Secret File at `DATABASE_SSL_CA_FILE`.
- The API has `/health` liveness, `/ready` database readiness, request IDs, security headers, and process-local request limits.
- The public web build generates the production canonical URL, robots file, sitemap, manifest, and structured metadata when built with `VITE_SITE_ORIGIN=https://www.frontdeskwise.com`.
- Leads remain durable in FrontDeskWise before CRM delivery. Webhook and HubSpot delivery are idempotent, encrypted, retryable, and observable from the owner dashboard.
- Firebase email/password and Google sign-in bootstrap each account into an organization; the browser never receives server secrets.
- Stripe Checkout, Customer Portal, signed webhook reconciliation, seven-day trials, entitlements, and read-only billing states are implemented.
- Private S3 document upload/download plus PDF, DOCX, spreadsheet, and text extraction are implemented; SES is used for super-admin and demo-request notifications.
- Website ownership verification gates live publishing and production lead capture while internal sandbox demos remain pre-verified.
- The frontend API origin is build-time configurable and is no longer coupled to the Vercel origin.

## Launch items

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
VITE_SITE_ORIGIN=https://www.frontdeskwise.com
```

Attach `frontdeskwise.com` and `www.frontdeskwise.com` according to the DNS records Vercel provides. The current deployment redirects the apex domain to `www`, so keep `https://www.frontdeskwise.com` as the canonical origin unless the redirect direction is intentionally changed.

### 3. Inject production secrets

Set these only in Render/Vercel secret settings:

```text
DATABASE_URL=the existing RDS URL, with /frontdeskwise as the database name
FRONTDESKWISE_CREDENTIAL_KEY=a unique 32-byte production key
DATABASE_SSL_CA_FILE=/etc/secrets/rds-ca.pem
OPENAI_API_KEY=the production OpenAI key
```

Keep `DATABASE_SSL_REJECT_UNAUTHORIZED=true`. In Render, add a Secret File named `rds-ca.pem` containing the AWS RDS PEM bundle. Render exposes it at `/etc/secrets/rds-ca.pem`; do not paste the large base64 bundle into an environment variable. If the current RDS certificate chain is not available to Render yet, stop before public traffic and add the CA file; do not silently downgrade certificate validation for the public service.

### 4. Configure and test the owner identity boundary

Enable Email/Password and Google in Firebase Auth, add the deployed domains to Firebase Authorized Domains, and create the allowlisted super-admin account. The URL demo remains short-lived and login-free until Save, Customize, Install, or Subscribe; those actions bootstrap/claim the demo into the Firebase-authenticated organization. Do not add a second password store.

### 5. Configure and test billing in Stripe Test mode

Create FrontDeskWise-specific products/prices, set the four Test-mode price IDs together with `sk_test_...` and the Test-mode `whsec_...`, and verify Checkout, Portal, subscription updates, cancellation, paid invoices, failed invoices, and idempotent retries. The browser return URL never marks a workspace paid; only the signed webhook does. See [organization billing](organization-billing-and-control-plane.md) for the exact Render mapping and live cutover procedure.

### 6. Configure private files, SES, and ownership verification

Create the private S3 bucket and least-privilege runtime identity, configure bucket CORS for the three web origins, verify `hello@frontdeskwise.com` or the domain in SES, and test PDF/DOCX/text upload until the document reaches `ready`. Verify a claimed business with a meta tag, file, DNS TXT, or signed email before installing the production widget.

### 7. Run the acceptance and operations pass

- Submit a disposable public website URL and confirm a tenant, crawl sources, owner token, and dashboard.
- Ask a supported question and verify citation/source metadata.
- Ask an unsupported question and verify a safe fallback plus knowledge gap.
- Capture a lead from the dashboard and widget; confirm `leads`, `lead_events`, and outbox state.
- Connect a webhook or HubSpot sandbox and verify sync, retry, idempotency, and no credential exposure.
- Verify a website ownership method, then install the widget; confirm an unverified claimed business is blocked from production lead capture.
- Upload a private document, confirm extraction creates searchable chunks, and verify the S3 bucket remains private.
- Sign in as `hello@frontdeskwise.com` and confirm `/platform` shows live organization/demo request data and SES test delivery.
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
