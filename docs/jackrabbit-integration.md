# Jackrabbit integration

FrontDeskWise now has a read-only `JackrabbitProvider` adapter for the documented Customer API.

For a normal business, connect it from Settings → Integrations → Jackrabbit. The owner supplies only the Customer API token. The backend controls the API base URL, calls `/v1/Options/me`, stores the returned organization ID/name, encrypts the token with `FRONTDESKWISE_CREDENTIAL_KEY`, and returns only account metadata plus a last-four credential hint. The original token is never returned to the browser.

The first certification slice uses the API's v1 endpoints:

- `GET /v1/Options/me` verifies the bearer token and organization scope.
- `GET /v1/Classes` supplies the authoritative class IDs and schedule records.
- `GET /v1/ClassListings` supplies live listing fields such as openings, waitlist state, and online registration URLs.

The adapter merges both read models by class ID, so a FrontDeskWise action can resolve a human request such as `Turtle 2` at `Largo` to the exact Jackrabbit class IDs and return the matching day/time options. It also has a small registration-link helper that injects the selected class ID into the existing `linkTemplate` handoff model.

## Local certification

For local certification without a saved business connection, put the Customer API token in the local `apps/api/.env` only. Do not paste it into chat, commit it, or print it in logs. The application resolves a stored business connection first and allows the environment fallback only outside production (or when `FRONTDESKWISE_JACKRABBIT_ALLOW_ENV_FALLBACK=true`). Then run:

```bash
npm --prefix apps/api run jackrabbit:certify
```

Optional local overrides are `FRONTDESKWISE_JACKRABBIT_CLASS_NAME`, `FRONTDESKWISE_JACKRABBIT_LOCATION`, and the server-controlled `FRONTDESKWISE_JACKRABBIT_API_BASE_URL`. Set `FRONTDESKWISE_JACKRABBIT_REGISTRATION_BASE_URL` and, if needed, `FRONTDESKWISE_JACKRABBIT_CLASS_ID_PARAM` to also print a class-prefilled handoff URL for each match. The command prints only organization metadata and class/listing fields; it never prints credentials.

The adapter intentionally does not call the Customer API's write endpoints. Enrollment creation, payment, legal consent, and final registration remain in Jackrabbit until Dave's account permissions and the write contract have been certified separately.

Reference: [Jackrabbit Customer API](https://sandbox-api.jackrabbitclass.com/scalar/v1).
