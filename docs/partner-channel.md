# Partner channel MVP

FrontDeskWise now has a first agency operating layer at `/partner`, backed by explicit partner-to-client organization links.

## Product flow

```text
/partners
  → sign up / sign in
  → /partner
  → create partner profile
  → generate personalized client demo
  → provision client organization
  → monitor client activity and projected commission
```

The public `/partners` page explains the channel. The authenticated workspace supports:

- partner enrollment for agency, referral, consultant, and reseller profiles;
- shareable referral attribution links;
- personalized demos built from a prospect website;
- one-click client organization and business provisioning;
- optional invitation-ready client owner records and lifecycle email;
- client portfolio activity, lead, conversation, and widget signals;
- projected recurring commission based on client billing state.

## API surface

- `GET /api/v1/partners/dashboard`
- `POST /api/v1/partners/enroll`
- `POST /api/v1/partners/demos`
- `POST /api/v1/partners/clients`

Dashboard reads allow an enrolled partner to see only their linked client organizations. Demo generation and client provisioning require a verified Firebase email. Client organizations are never selected from a browser-supplied organization ID; the API creates and links them in one server-side flow.

## Data model

Migration `infra/db/077_partner_channel.sql` adds:

- `partner_accounts` — partner identity, type, referral code, and commission terms;
- `partner_client_links` — explicit partner-to-organization access boundary;
- `partner_referrals` — prospect and demo attribution history.

The MVP intentionally projects commission from current client plan state. A later payout phase can add an immutable commission ledger, invoice reconciliation, volume pricing, white-label domains, and platform integrations after the first five agencies establish repeatable demand.
