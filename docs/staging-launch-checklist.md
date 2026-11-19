# FrontDeskWise staging launch checklist (future)

> The first public environment is now configured as production on `frontdeskwise.com` and `api.frontdeskwise.com`. Keep this document for the later isolated staging environment; use [production-launch-checklist.md](production-launch-checklist.md) for the current deployment.

This is the staging deployment path for the current MVP. It uses the existing separate `frontdeskwise` staging database and keeps production credentials and billing disabled.

## Current go/no-go status

### Ready

- API and web builds pass.
- PostgreSQL migration chain is applied through migration 009.
- Database URL validation rejects databases other than `frontdeskwise`.
- Website crawling, grounded retrieval, knowledge-gap review, widget installation, lead persistence, CRM outbox delivery, HubSpot, and signed webhooks are implemented.
- API health endpoint is available at `/health`.
- Landing-page metadata, structured data, robots, sitemap, manifest, and security headers are configured.

### Required before staging traffic

- Create the Render API service from `render.yaml`.
- Set the staging `DATABASE_URL` to the separate `frontdeskwise` database. Do not paste the sibling service URL unchanged.
- Set a unique staging `FRONTDESKWISE_CREDENTIAL_KEY`.
- Add the staging `OPENAI_API_KEY` in Render's secret environment. The local `.env` is ignored and is never deployed.
- Set `WEB_ORIGIN`, `FRONTDESKWISE_PUBLIC_API_ORIGIN`, `FRONTDESKWISE_WIDGET_ORIGIN`, and `FRONTDESKWISE_WIDGET_URL` to the actual staging URLs.
- Set Vercel `VITE_API_ORIGIN` to the Render API URL and `VITE_SITE_ORIGIN` to the Vercel/custom-domain URL.
- Confirm RDS security-group/network access from Render and keep the staging SSL setting explicit.

## Deployment order

1. Deploy the API on Render with `rootDir: apps/api`, health check `/health`, and `preDeployCommand: npm run db:migrate`.
2. Confirm `GET https://<render-api>/health` returns the service liveness payload and `GET https://<render-api>/ready` returns `database: "ready"`.
3. Deploy the web app on Vercel with project root `apps/web`. The checked-in `apps/web/vercel.json` uses `npm ci`, `npm run build`, and `dist`.
4. Add `VITE_API_ORIGIN` and `VITE_SITE_ORIGIN` to Vercel, then redeploy so the generated sitemap and browser API calls use staging origins.
5. Configure custom DNS only after both default Vercel and Render URLs work. After DNS is live, update the four API origin variables and redeploy the API.

Render's `preDeployCommand` is the preferred migration hook. If the selected Render plan does not provide pre-deploy commands, run the migration manually from a controlled environment before releasing the API; do not put migrations inside the long-running server process.

## End-to-end acceptance test

1. Open the Vercel landing page and verify title, description, mobile layout, and the URL-to-demo form.
2. Submit a real public test domain and confirm the API creates a tenant and returns a short-lived owner token.
3. Verify the owner dashboard can load knowledge gaps, diagnostics, leads, widget installation, and Actions & Integrations.
4. Ask a grounded question and confirm citation/source metadata.
5. Ask an unsupported question and confirm a fallback plus knowledge gap.
6. Submit a lead from the dashboard and from the public widget. Confirm it appears in `leads` and `lead_events`.
7. Install the widget snippet on a disposable test page. Verify site-key config, conversation, answer, and lead capture.
8. Connect a staging webhook or HubSpot test account. Confirm sync status, idempotency, retry behavior, and no secret is returned to the browser.
9. Check the browser network panel: API requests must target the Render API origin, not the Vercel origin.
10. Check `https://<web-origin>/robots.txt` and `/sitemap.xml`; both must use the real staging/custom origin.

## Firebase and other services

Firebase and Stripe can be optional for an isolated crawl-only staging slice, but production accounts use Firebase bootstrap and verified Stripe webhooks. The temporary hashed demo session remains useful for login-free staging previews; it is not a replacement for production organization authorization.

## Production blockers after staging

- Replace demo bearer access with Identity SDK sessions and rotation.
- Validate verified billing webhooks and live subscription entitlements before enabling live prices.
- Move RDS SSL validation to a mounted/trusted CA configuration.
- Add rate limiting, request tracing, alerting, backups/restore verification, and PII retention/deletion controls.
- Add scheduled recrawls/change detection and a production CDN/widget release process.
- Test native CRM adapters with customer-owned sandbox accounts and document field mapping.
