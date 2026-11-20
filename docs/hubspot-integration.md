# HubSpot native integration

FrontDeskWise owns the customer-facing integration runtime. The HubSpot Projects app only supplies the OAuth app identity, redirect URL, and requested scopes.

## OAuth configuration

The API uses HubSpot's current OAuth endpoints:

- Authorization: `https://app.hubspot.com/oauth/authorize`
- Token exchange and refresh: `POST https://api.hubapi.com/oauth/2026-03/token`
- Token revocation: `POST https://api.hubapi.com/oauth/2026-03/token/revoke`

The API stores only an opaque, one-time OAuth state in the browser. The state references the business, organization, initiating user, and redirect URI server-side and expires after ten minutes.

Production callback:

`https://api.frontdeskwise.com/api/v1/integrations/hubspot/callback`

Staging callback:

`https://frontdeskwise-api-staging.onrender.com/api/v1/integrations/hubspot/callback`

## V1 scopes

The project requests the smallest scope set currently needed for deterministic contact delivery:

| Scope | FrontDeskWise capability |
| --- | --- |
| `oauth` | Complete the HubSpot app authorization flow. |
| `crm.objects.contacts.read` | Search for an existing contact by email or phone before delivery. |
| `crm.objects.contacts.write` | Create or update the contact and set native contact properties. |

Deals, companies, tasks, inbound webhooks, and broader conversation access are intentionally not requested in V1. Add each scope only with the corresponding feature and field mapping enabled.

## Runtime behavior

1. FrontDeskWise persists the lead before it creates any CRM work.
2. A durable integration outbox queues delivery with an idempotency key.
3. HubSpot contact lookup is performed by email first and phone second; an existing record is updated and a missing record is created.
4. OAuth access and refresh tokens are encrypted at rest with `FRONTDESKWISE_CREDENTIAL_KEY` and never returned to the browser.
5. Access tokens are refreshed shortly before expiry. A revoked or expired authorization is surfaced as `Needs attention` and does not remove the local lead.
6. `crm_sync_records` stores the HubSpot contact ID, delivery status, attempts, timestamps, and safe error text.

The HubSpot MCP connection remains separate from this deterministic CRM delivery path.
