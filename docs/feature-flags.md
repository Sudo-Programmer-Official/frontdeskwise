# Feature flags and staged rollout

Feature flags are controlled from the Super Admin control plane at `/platform/feature-flags`.

Each flag has one server-evaluated stage:

- `off` — disabled for every organization.
- `internal` — enabled for organizations containing an internal demo business.
- `reference_tenants` — enabled only for the organizations listed on the flag.
- `percentage` — enabled for a deterministic percentage of organizations. The organization ID is hashed with the flag key, so a tenant remains in the same cohort across devices and requests.
- `all` — enabled for every organization.

Per-organization overrides are available through the admin API and take precedence over the stage. Every create, update, and override change is recorded in `privileged_audit_events`.

## API

- `GET /api/v1/feature-flags?organizationId=...` — authenticated tenant evaluation. The caller must have membership in the requested organization.
- `GET /api/v1/admin/feature-flags` — list flags and selectable organizations.
- `POST /api/v1/admin/feature-flags` — create a flag.
- `PATCH /api/v1/admin/feature-flags/:flagKey` — update a stage, percentage, description, or reference list.
- `GET /api/v1/admin/feature-flags/:flagKey/evaluate?organizationId=...` — preview a flag decision for an organization.
- `POST /api/v1/admin/feature-flags/:flagKey/overrides` — force `on` or `off` for one organization.
- `DELETE /api/v1/admin/feature-flags/:flagKey/overrides/:organizationId` — remove an override.

The first runtime integration is `response_validation.semantic_verifier`. It is seeded at `all` so the current safety behavior is preserved; Super Admins can move it through the rollout stages without a deployment.
