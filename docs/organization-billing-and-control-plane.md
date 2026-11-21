# Organization billing and control plane

FrontDeskWise uses one authenticated account for one organization. An organization can own multiple businesses, and the organization owns the single billing relationship.

```text
Firebase user
  -> FrontDeskWise app user
    -> organization membership
      -> businesses
      -> one Stripe customer
      -> one subscription / plan / override
```

## Customer lifecycle

1. A visitor submits a website URL and receives a temporary demo session.
2. The visitor can test the grounded agent without an account.
3. Saving, customizing, installing, or adding a business requires Firebase authentication.
4. Bootstrap creates or claims the user's organization and starts the default trial.
5. The organization can add businesses until its plan capacity is reached.
6. Checkout creates one Stripe Customer and one subscription for the organization.
7. Stripe webhooks update the organization billing state. Business billing columns are synchronized as a compatibility projection.
8. The dashboard Billing view opens Checkout or the Stripe Customer Portal.

## Billing states

| State | Product access |
| --- | --- |
| `trial` | Full access until `trial_end_at` |
| `active` | Full access |
| `grace` | Full access during the configured grace window; show a billing warning |
| `paused` | Block paid product operations |
| `cancelled` | Block paid product operations; retain data for recovery |

The API enforces this boundary server-side on every mutating workspace route. Trial/active/grace organizations can write; paused/cancelled or expired trials remain readable but are read-only until billing is restored. A separate ownership boundary blocks production publishing, CRM connection, booking actions, and lead capture until the business website is verified.

Renewal payment failures enter `grace` and preserve the already-paid active plan
for the grace window. A failed upgrade is different: it keeps the organization on
the previous active plan without starting renewal grace, leaves the requested plan
pending, and sends an upgrade-payment action email.

The demo organization remains `sandbox` and does not require a Stripe subscription. Customer-specific terms belong in `organization_plan_overrides`; no customer price is hard-coded in application code.

## Database ownership

Migration `012_organization_billing_and_control_plane.sql` adds:

- organization-level billing and Stripe identifiers;
- public plan metadata, monthly pricing metadata, Stripe price placeholders, and maximum business counts;
- organization plan overrides for founding, negotiated, or enterprise pricing;
- daily organization usage counters;
- support notes and super-admin allowlist records;
- organization linkage on durable billing events.

Migration `014_billing_entitlement_catalog.sql` completes the provider-neutral
entitlement catalog for Demo, Starter, Growth, Multi-Business, and Portfolio.
It records crawl limits, lead capture, booking actions, and business capacity
as JSON entitlements. The API exposes these on the Billing response so plan
behavior can be reviewed without coupling application access checks to Stripe.

`billing_events` is idempotent on `(provider, event_id)`. A webhook is recorded before processing and marked with `processed_at` after the organization update succeeds. Stripe retries can therefore be safely acknowledged after a previously processed event.

Migration `034_subscription_purchase_lifecycle.sql` completes the purchase
lifecycle with checkout intent/status, payment status, cancellation-at-period-end,
pending plan changes, Stripe subscription event ordering, and an internal
`billing_timeline_events` audit trail. Webhook processing claims an event before
work begins, releases the claim on failure for Stripe retry, and marks it
processed only after the organization and business projections converge.

The customer return URL is informational only. It includes the Checkout Session
ID for correlation, but the web app polls `GET /api/v1/billing` until the signed
webhook has persisted the active plan. A delayed webhook produces a pending
message rather than a false paid state.

## API surfaces

Customer-authenticated:

- `GET /api/v1/billing?organizationId=...`
- `POST /api/v1/billing/checkout-session`
- `POST /api/v1/billing/portal-session`

Stripe:

- `POST /api/v1/stripe/webhook`

Super-admin:

- `GET /api/v1/admin/organizations`
- `GET /api/v1/admin/organizations/:organizationId`
- `POST /api/v1/admin/organizations/:organizationId/trial`
- `POST /api/v1/admin/organizations/:organizationId/suspend`
- `POST /api/v1/admin/organizations/:organizationId/plan-override`
- `DELETE /api/v1/admin/organizations/:organizationId/plan-override`

For an organization that already has a non-canceled Stripe subscription, a plan
change updates that subscription rather than creating a second subscription.
`organizations.plan_key` is the last successfully paid, entitlement-authoritative
plan. A requested or Stripe-observed price does not change entitlements by itself;
the active plan advances only after a successful active payment is reconciled from
Stripe.

Upgrades use an immediate proration invoice with `pending_if_incomplete`, so an
incomplete or failed payment cannot grant the higher plan. Downgrades use a Stripe
subscription schedule with no proration: the current plan and entitlements remain
active through the current billing period, while `pending_plan_key`,
`pending_plan_change_type`, and `pending_plan_change_at` expose the scheduled
change. A `SUBSCRIPTION_CHANGE_SCHEDULED` lifecycle event sends the customer the
effective date and next plan. The initial Customer Portal configuration keeps plan
switching disabled; Portal remains available for payment methods, invoices, and
period-end cancellation. `POST /api/v1/billing/resume` reverses a pending
cancellation or scheduled downgrade.

The initial super-admin bootstrap uses a verified Firebase identity plus the server-only `FRONTDESKWISE_SUPER_ADMIN_EMAILS` allowlist. The first successful admin request inserts that user into `super_admin_users`; subsequent authorization comes from the database record.

## Stripe setup before charging a customer

FrontDeskWise may use the existing Sudo Programmer Stripe account alongside SalonFlow, PlanCraftAI, and other products. It must have its own catalog, Price IDs, webhook configuration, and Render environment values. Never reuse another product's Price ID: Stripe account reuse is safe, product/price reuse is not unless the billing terms are intentionally identical.

Create these FrontDeskWise products in Stripe. Keep the product stable and put monthly and annual billing in separate recurring Prices under that product:

| Product | Public monthly price | Entitlement |
| --- | ---: | --- |
| `FrontDeskWise — Starter` | `$99/month` | 1 business |
| `FrontDeskWise — Growth` | `$199/month` | 1 business with higher usage/features |
| `FrontDeskWise — Multi-Business` | `$349/month` | Up to 2 businesses |
| `FrontDeskWise — Portfolio` | `$499+/month` | More businesses / higher usage |

Add this metadata to every FrontDeskWise product and price:

```text
app=frontdeskwise
plan_key=starter | growth | multi_business | portfolio
billing_model=subscription
```

Use Stripe test mode first. Copy only the resulting FrontDeskWise Price IDs into Render; do not commit them to source control or put them in the web app.

Configure these server-only variables on Render:

```text
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER_MONTHLY=price_...
STRIPE_PRICE_GROWTH_MONTHLY=price_...
STRIPE_PRICE_MULTI_BUSINESS_MONTHLY=price_...
STRIPE_PRICE_PORTFOLIO_MONTHLY=price_...
# Optional until annual checkout is offered in the UI
STRIPE_PRICE_STARTER_YEARLY=price_...
STRIPE_PRICE_GROWTH_YEARLY=price_...
STRIPE_PRICE_MULTI_BUSINESS_YEARLY=price_...
STRIPE_PRICE_PORTFOLIO_YEARLY=price_...
FRONTDESKWISE_STRIPE_SUCCESS_URL=https://www.frontdeskwise.com/?billing=success
FRONTDESKWISE_STRIPE_CANCEL_URL=https://www.frontdeskwise.com/?billing=cancel
FRONTDESKWISE_STRIPE_PORTAL_RETURN_URL=https://www.frontdeskwise.com/?billing=portal
FRONTDESKWISE_SUPER_ADMIN_EMAILS=verified-admin@example.com
```

On API startup, any configured `STRIPE_PRICE_*` values are copied into the matching `billing_plans` row. This keeps plan setup easy to audit in Render while preserving the plan catalog in PostgreSQL.

The API adds this metadata to customers, Checkout Sessions, and subscription metadata:

```text
app=frontdeskwise
billing_model=subscription
organization_id=<FrontDeskWise organization UUID>
plan_key=<starter|growth|multi_business|portfolio>
```

Checkout also includes the organization as `client_reference_id`. The webhook accepts the legacy camelCase keys for compatibility, but all new records use the normalized snake_case keys above. Because the Stripe account is shared, the webhook ignores events explicitly tagged for another app.

Stripe Dashboard setup checklist:

1. Create the four FrontDeskWise products and at least one monthly recurring Price for each in test mode.
2. Add the metadata above to each product and Price, then copy the four monthly Price IDs to Render.
3. Create a separate webhook endpoint for FrontDeskWise at the URL below and copy its signing secret to `STRIPE_WEBHOOK_SECRET`.
4. Subscribe the endpoint only to the six FrontDeskWise billing events listed below.
5. Enable and brand Stripe Customer Portal, including payment method, invoice, and cancellation settings.
6. Run one test Checkout and confirm the organization becomes `active` only after the signed webhook is received.

The Customer Portal is organization-scoped: one Stripe Customer represents the organization, regardless of how many businesses it owns.

## Sandbox first, live later

Render has one active Stripe mode per API deployment. For the initial demo
validation, set all of these from Stripe Test mode as one matched group:

```text
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...       # Test-mode FrontDeskWise endpoint
STRIPE_PRICE_STARTER_MONTHLY=price_... # Test price
STRIPE_PRICE_GROWTH_MONTHLY=price_...  # Test price
STRIPE_PRICE_MULTI_BUSINESS_MONTHLY=price_... # Test price
STRIPE_PRICE_PORTFOLIO_MONTHLY=price_...     # Test price
```

The webhook signing secret must come from the Test-mode webhook endpoint, not
from the API key. The four price IDs must also be Test-mode prices. Annual
price variables are optional until annual checkout is enabled in the UI.

Before switching the same deployment to live:

1. Create or select the Live-mode FrontDeskWise products and prices.
2. Create the Live-mode webhook endpoint at the same API URL and copy its new
   signing secret.
3. Replace the secret, webhook secret, and all four monthly price IDs together.
4. Deploy/restart the API so `syncStripePlanPrices()` updates PostgreSQL.
5. Keep test subscriptions and customers separate; do not reuse their IDs in
   Live mode. Reset test organizations to trial or create a fresh live
   organization before accepting real payments.
6. Run one small live Checkout and confirm the signed webhook changes that
   organization to `active` before announcing paid access.

Never put any `sk_*`, `whsec_*`, or server-side Stripe value in Vercel or the
web bundle. If a secret is accidentally exposed in a screenshot, chat, log,
or commit, revoke it in Stripe and issue a replacement.

Register this HTTPS endpoint in Stripe and subscribe it to the snapshot events used by the API:

```text
https://api.frontdeskwise.com/api/v1/stripe/webhook

checkout.session.completed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
invoice.paid
invoice.payment_failed
```

The webhook verifies Stripe's signature against the raw request body. The secret key and signing secret never reach the browser.

## Launch acceptance checklist

- Create a Firebase test account and bootstrap it into an organization.
- Open Billing and confirm the organization starts in trial.
- Confirm adding a business works within the plan limit and returns a clear upgrade error at the limit.
- Configure one Stripe test price and confirm Checkout redirects correctly.
- Complete a Stripe test subscription and confirm the webhook changes the organization to `active`.
- Replay the same webhook and confirm there is still one subscription state and one activation email delivery.
- Change Starter → Growth and Growth → Multi-Business, then confirm the same Stripe subscription, plan, entitlements, UI, and admin timeline converge.
- Schedule cancellation at period end and confirm access remains active until the period end.
- Send a test payment failure, confirm `grace` state plus dashboard warning and payment email, then send `invoice.paid` and confirm recovery.
- Open Customer Portal and verify the return URL.
- Send a test payment failure and confirm `grace` state plus dashboard visibility.
- Sign in with the allowlisted super-admin account and verify organization metrics plus trial/suspend actions.
- Verify the existing visitor demo path still works without authentication.

## Implemented status

The current repository contains the following working pieces:

- Firebase email/password authentication;
- Google popup authentication;
- password-reset email flow;
- temporary URL-to-demo onboarding;
- demo claiming into an authenticated organization;
- one organization with multiple businesses;
- business switcher in the owner dashboard;
- All Businesses organization aggregate view with lead, booking, conversation,
  and business counts;
- add-business onboarding with organization membership and plan-capacity checks;
- public landing-page pricing for Starter, Growth, Multi-Business, and Portfolio;
- organization-level trial and plan state;
- organization business-capacity enforcement;
- Stripe Checkout, Portal, and webhook boundaries;
- webhook-claimed checkout, subscription, invoice, cancellation, and recovery
  transitions with subscription-scoped activation-email idempotency;
- asynchronous branded subscription confirmation and plan-change email templates
  with retryable delivery records;
- daily organization usage counters;
- customer Billing view;
- customer return-page polling and a Super Admin billing timeline;
- protected super-admin organization list and trial/suspend actions;
- plan override API for founding or negotiated pricing.
- audited demo request records and super-admin demo operations;
- admin-generated test-user links with expiry, reset, revoke, and validation controls;
- request activity visible by requester, business, access count, last open, and latest validation.

The public visitor path remains intentionally login-free:

```text
Landing page
  -> submit website URL
  -> crawl and build temporary knowledge base
  -> test grounded agent
  -> save / customize / install
  -> Firebase sign-up or Google sign-in
  -> claim demo into organization
```

## Important data boundaries

FrontDeskWise persists the following durable records:

| Area | Stored records | Owner |
| --- | --- | --- |
| Identity | Firebase identity subject, application user, status | Firebase + FrontDeskWise |
| Organization | name, membership, role, billing state, plan, Stripe IDs | FrontDeskWise |
| Business | website, crawl sources, chunks, agent configuration, widget key | FrontDeskWise business |
| Conversations | session, messages, grounding metadata, citations, actions | Business |
| Leads | contact data, consent, intent, status, idempotency key | Business |
| CRM delivery | integration config, encrypted credentials, outbox, retries, sync records | Business |
| Billing | provider events, plan metadata, overrides, usage counters | Organization |

CRM delivery is an outbox process. The lead is committed to FrontDeskWise first, then delivered to the configured CRM/webhook with an idempotency key. A CRM outage therefore does not lose the lead or make the visitor wait for the third-party system.

## Plan catalog

The migration seeds these plan capacities and display prices:

| Key | Display price | Business limit | Intended use |
| --- | ---: | ---: | --- |
| `demo` | $0 | 1 | Internal/demo sandbox |
| `starter` | $99/mo | 1 | Single-business launch |
| `growth` | $199/mo | 1 | Higher usage and reporting |
| `multi_business` | $349/mo | 2 | Two-business organization |
| `portfolio` | $499/mo | 5 | Portfolio operators |

These are catalog defaults, not payment authorization. A plan becomes checkout-ready only after its Stripe recurring price ID is configured. A customer-specific plan override can change amount, capacity, interval, price ID, and reason without changing the public catalog.

## Deployment sequence

1. Merge the application changes to `main`.
2. Render runs `npm ci`, the API build, and `npm run db:migrate` before starting the service.
3. Confirm `/ready` returns database readiness.
4. Add the server-only Stripe variables and recurring price IDs in Render.
5. Deploy the API, then deploy the web app with the existing Firebase client configuration and `VITE_API_ORIGIN=https://api.frontdeskwise.com`.
6. Register the Stripe webhook URL and select the six supported event types.
7. Sign in with the allowlisted super-admin Firebase account once to bootstrap `super_admin_users`.
8. Run the acceptance checklist above using Stripe test mode before switching to live mode.

Never put `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, database credentials, or CRM tokens in the web build or browser storage. Firebase web configuration is client-side configuration; authorization remains enforced by verified ID tokens, organization membership, and server-side checks.

## Demo operations and test access

Migration `013_demo_operations_and_access_audit.sql` adds the operator layer around the login-free demo:

- `demo_requests` records every landing-page request, including anonymous requests, crawl failures, requester identity when supplied, business association, current status, and access counts.
- `demo_access_sessions` now records whether a link was public, admin-issued, internal, or claimable, which request it belongs to, and which admin created it.
- `demo_access_audit` records request, create, send, open, exchange, claim, reset, extend, revoke, and validation events. IP addresses are stored only as a keyed hash and user agents are truncated.

The public lifecycle is:

```text
Landing URL + optional name/email
  → demo_requests row (anonymous is allowed)
  → crawl and business provision
  → hashed 48-hour access session
  → visitor opens/tests demo
  → signup or Google sign-in claims demo into organization
```

The super-admin lifecycle is:

```text
Admin control plane
  → view request catalog and activity
  → generate a test-user link for an existing business
  → copy link to a prospect or tester
  → validate sources/chunks/agent/access
  → extend 7 days, reset to issue a fresh link, or revoke
```

Admin links are still ordinary scoped demo sessions. They do not bypass business authorization, and all operator actions require a verified Firebase identity that is allowlisted or present in `super_admin_users`. The API returns the raw link only when it is generated or reset; only its hash is persisted.

### Demo acceptance checklist

1. Submit a URL without identity; confirm a `demo_requests` row appears with `anonymous` activity.
2. Submit a URL with name/email; confirm the requester appears in the admin catalog.
3. Open the returned demo link; confirm `opened` activity, access count, and last-opened time.
4. Create a Firebase email/password account or use Google; pass the demo token to bootstrap and confirm the demo becomes the user’s business.
5. Generate an admin test-user link for `british-swim-school-tampa-bay`; open it in a private browser and verify it reaches only that business.
6. Validate the request; confirm the checks cover ready sources, knowledge chunks, agent configuration, and active access.
7. Extend, reset, and revoke the link; confirm expiration/revocation is enforced by the API, not just hidden in the UI.
8. Sign in as a different organization member and confirm the first organization’s business, leads, conversations, and settings are not readable.

## Dave founding-plan procedure

After Dave has completed the pilot and a recurring Stripe Price exists for the founding offer. If the charged amount is exactly `$350/month`, create a separate recurring Stripe Price in the same account and attach it only to Dave's override; do not replace the public `$349` Multi-Business Price. A coupon is possible, but a dedicated founding Price is easier to audit:

1. Ensure Dave's Firebase account has been bootstrapped and identify his organization ID from the owner dashboard/API.
2. As a super-admin, call `POST /api/v1/admin/organizations/:organizationId/plan-override` with:

```json
{
  "planKey": "multi_business",
  "interval": "month",
  "amountCents": 35000,
  "maxBusinesses": 2,
  "stripePriceId": "price_...",
  "reason": "Founding multi-business pilot conversion"
}
```

3. Confirm the Billing view shows the override and two-business capacity.
4. Start Checkout from the Billing view.
5. Confirm the subscription webhook changes the organization to `active`.

This keeps Dave's terms explicit, auditable, and reversible without creating a separate product branch.
