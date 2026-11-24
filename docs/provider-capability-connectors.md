# Business API connector layer

FrontDeskWise treats an external business API as a tenant-owned provider connection with a reviewable capability catalog. The model may interpret language, but it never chooses an arbitrary HTTP endpoint.

```text
Business Brain        static / semi-static facts
Provider connection   live API + encrypted credentials
Capability registry   approved operations + schemas + policy
Workflow              decides when to invoke a capability
```

## Owner flow

The dashboard exposes this flow under Settings → Integrations → Business API connectors:

1. Add a base URL and authentication method.
2. Import an OpenAPI/Swagger JSON URL or file, or add one REST endpoint manually.
3. Review the discovered capability name, method, path, inputs, and risk classification.
4. Approve only the operations the business wants workflows to use.
5. Test an approved capability.

Imported operations enter the registry as disabled `discovered` records. Approval changes the capability to `approved` and enables it. Write operations default to `requires_verified_customer = true` and `confirmation_required = true`; they do not become silently executable just because they were present in an API document. Customer lookup capabilities can update the workflow's explicit verification state (`UNKNOWN`, `VERIFIED`, `NOT_FOUND`, `AMBIGUOUS`, or `PROVIDER_UNAVAILABLE`) without exposing raw provider payloads.

## Storage

Migrations `086_provider_capability_registry.sql` and `087_provider_execution_safety.sql` add:

- `business_api_connections`: tenant-owned base URL, provider key, source type, encrypted credentials, auth type, and connection health.
- `business_api_capabilities`: operation key, read/write classification, HTTP method/path, input/output JSON Schema, auth scope, allowed methods, timeout, retry policy, rate limit metadata, PII classification, customer-verification requirement, confirmation requirement, and safe fallback behavior.
- `business_api_capability_audit`: connection creation, imports, approvals, disables, and tests.

Credentials are encrypted with the existing `FRONTDESKWISE_CREDENTIAL_KEY` boundary. They are never returned to the browser or included in capability schemas. Server-side execution validates the public destination immediately before fetch, rejects redirects, applies a timeout, retries read failures conservatively, and forwards only registered path/query/header/body fields.

## API surface

The current owner API is:

- `GET /api/v1/demo/:slug/provider-connections`
- `POST /api/v1/demo/:slug/provider-connections`
- `PATCH /api/v1/demo/:slug/provider-connections/:connectionId/capabilities/:capabilityId`
- `POST /api/v1/demo/:slug/provider-connections/:connectionId/capabilities/:capabilityId/test`

The POST body is assembled by the dashboard. Owners do not need to write the capability JSON by hand. An OpenAPI import is parsed by `ingestOpenApiDocument`; a manual endpoint uses the same normalized capability shape.

## Workflow binding

A workflow lookup step can reference a registered operation with:

```json
{
  "type": "lookup",
  "config": {
    "provider": "custom_api",
    "capabilityKey": "search_daycares",
    "providerConnectionId": "connection-id",
    "inputMappings": {
      "zip": "location_zip",
      "age": "child_age"
    },
    "resultPath": "data.items",
    "resultMapping": {
      "id": "id",
      "name": "name",
      "location": "address",
      "availability": "openings",
      "destination": "tour_url"
    }
  }
}
```

The workflow engine resolves the approved capability by tenant and connection, maps known workflow values into the declared input schema, executes the provider operation, and keeps only normalized result fields for matching. A missing connection, missing approval, invalid input, failed request, or unsafe destination fails closed and can take the workflow's configured provider fallback path.

## DaycareSpots and Jackrabbit

DaycareSpots should be onboarded through this generic connector path unless a stable, documented API contract justifies a native adapter. Jackrabbit remains the first native adapter and is the reference implementation for provider-backed lookup behavior; the capability registry is the common platform boundary for future native adapters, OpenAPI imports, custom REST APIs, and eventually MCP-backed capabilities.

## Execution safety and honesty

Every provider invocation passes an authorization gate before execution. The gate checks capability approval, active provider connection, tenant ownership, declared input fields, customer verification for protected writes, and explicit workflow confirmation. A blocked or failed write leaves the workflow on a safe step or offers the configured fallback; it never produces a success claim.

Conversation state preserves provider results across interruptions and intent switches. Super Admin and owner-visible traces store provider, capability, read/write status, verification state, authorization reason, result status, latency, fallback behavior, and operation-honesty flags:

```text
can_answer · can_lookup · can_prepare · can_submit · can_confirm_success
```

High-risk policy claims such as makeup, cancellation, billing, refund, eligibility, and enrollment restrictions are answered only from verified Business Brain facts or explicitly marked approved-provider policy evidence. Otherwise the assistant says the information is not verified and offers human help.

