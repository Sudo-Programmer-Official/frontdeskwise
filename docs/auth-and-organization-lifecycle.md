# FrontDeskWise account and organization lifecycle

FrontDeskWise keeps the conversion path anonymous until a visitor asks to keep or publish the generated agent:

```text
Visitor
  → paste website URL
  → temporary demo business + 48-hour demo session
  → crawl, index, preview, test answers
  → Save / Customize / Install
  → Firebase email/password account
  → claim demo into an organization
```

## Ownership hierarchy

```text
Firebase user identity
        ↓ verified ID token
FrontDeskWise app_user
        ↓ organization_members
Organization
        ↓ businesses.organization_id
Business
   ├── business_members
   ├── knowledge, conversations, leads
   ├── agent configuration and widget
   └── CRM integrations and delivery state
```

One person has one account and can belong to multiple organizations. An organization can own multiple businesses. The dashboard should use the organization membership to populate the business switcher; an owner/admin can see all businesses in that organization, while business membership limits staff and viewer access.

Roles are intentionally split:

- Organization: `owner`, `admin`, `member`, `viewer`
- Business: `admin`, `staff`, `viewer`

The API never trusts a browser-supplied business ID by itself. Authenticated dashboard requests are authorized through the verified Firebase subject → `app_users` → organization/business membership chain. The existing hashed demo bearer remains supported for temporary demos and backward compatibility.

## Live workspace data and demos

The dashboard does not use customer-facing metric fixtures. Each selected business is loaded from the API and its summary is calculated from the business's persisted sources, chunks, conversations, messages, leads, knowledge gaps, widget loads, and agent configuration. Switching businesses clears the previous workspace state before loading the selected tenant, and question/lead mutations refresh the summary and organization aggregate.

The only intentionally seeded workspaces are the public internal demos:

- `british-swim-school-tampa-bay`
- `munchkin-town`
- `tampa-bay-family-dental`

They are exposed through `GET /api/v1/demo-catalog` and `GET /api/v1/demo/:slug/public`. A newly authenticated organization with no businesses shows an empty setup state and must add its first business; it does not inherit demo metrics or another tenant's records. Product pricing and UI example text remain static configuration by design, while customer activity and workspace content are database-backed.

## Database records

Migration `010_identity_organizations_and_business_membership.sql` adds:

- `organizations`
- `app_users`
- `organization_members`
- `business_members`
- `businesses.organization_id`
- `businesses.is_internal_demo`
- claim metadata on `demo_access_sessions`

Migration `013_demo_operations_and_access_audit.sql` adds `demo_requests` and
`demo_access_audit`, plus operator metadata on demo sessions. This keeps the
visitor path login-free while giving super-admins a durable request catalog,
test-user links, expiry/reset/revoke controls, and validation history.

Existing businesses are backfilled into one organization each. Existing `workspace_users` are copied into the new membership model, but the legacy table remains while demo bearer sessions are being retired.

The seeded internal demos are represented by:

- Organization: `FrontDeskWise Demo`
- Businesses: `British Swim School Tampa Bay`, `Munchkin Town`, and `Tampa Bay Family Dental`
- Application identity: `demo@frontdeskwise.com`

No password is stored in PostgreSQL. The Firebase account must be created/managed in Firebase Auth; the first verified sign-in binds its Firebase subject to the seeded application user row.

## API contract

- `GET /api/v1/auth/me` — verified Firebase user and organization/business memberships.
- `POST /api/v1/auth/bootstrap` — upserts the verified app user, creates the first organization when needed, and claims a temporary demo when `demoToken` is supplied.
- `POST /api/v1/auth/businesses` — crawls and creates another business under an authorized organization.
- Existing `/api/v1/demo/:slug/*` owner routes accept either a valid demo bearer or a verified Firebase bearer with owner/admin access.

Claiming a non-internal demo moves the business into the new organization, marks it as a 14-day starter trial, grants the user business admin access, and closes the demo session for future claims. The internal sales demo is never moved by a visitor claim.

## Client configuration

The web app uses Firebase Auth browser-local persistence. It supports email/password, password reset, and Google popup sign-in. Both providers use the same API bootstrap and demo-claim path. Vercel needs:

```env
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
VITE_FIREBASE_APP_ID=...
VITE_API_ORIGIN=https://api.frontdeskwise.com
```

Render needs only:

```env
FIREBASE_PROJECT_ID=...
```

The API verifies the Firebase ID-token signature and validates `aud`, `iss`, `sub`, `iat`, and `exp`. Firebase web keys are client configuration, not database credentials. Password reset remains with Firebase Auth; no password hashes or reset tokens belong in the FrontDeskWise database.

## Rollout sequence

1. Set the same Firebase project ID in Render and the Firebase web config in Vercel.
2. Enable Email/Password in Firebase Auth and create the internal `demo@frontdeskwise.com` user if it does not already exist.
3. Deploy; Render’s `preDeployCommand` applies the complete forward-only migration chain under the existing migration advisory lock.
4. Test URL → demo → signup → claim → dashboard.
5. Add the second business through `POST /api/v1/auth/businesses` and verify that the organization membership query returns both businesses.
6. Confirm Google popup sign-in from both `frontdeskwise.com` and `www.frontdeskwise.com`; Firebase Authorized Domains must include both.
7. Add organization invitation flows after the core email/password and Google paths are stable.

For production CORS, set Render `WEB_ORIGIN` to the comma-separated canonical origins `https://frontdeskwise.com,https://www.frontdeskwise.com,https://app.frontdeskwise.com` and redeploy the API. The API also expands a configured FrontDeskWise origin to these three approved origins as a deployment safety net.

## Super-admin demo operations

The protected control-plane endpoints are:

- `GET /api/v1/admin/demo-requests` and `GET /api/v1/admin/demo-requests/:id` — request catalog and audit history.
- `POST /api/v1/admin/demo-requests` — generate a scoped test-user link for an existing business.
- `POST /api/v1/admin/demo-requests/:id/extend` — extend link access for a bounded number of days.
- `POST /api/v1/admin/demo-requests/:id/reset` — revoke active links and issue a fresh link.
- `POST /api/v1/admin/demo-requests/:id/revoke` — immediately invalidate active links.
- `POST /api/v1/admin/demo-requests/:id/validate` — verify sources, chunks, agent configuration, and active access.

These actions are intended for internal validation, pilots, and sales handoff. They do not impersonate a customer or bypass tenant authorization; they create or operate on auditable demo sessions.
