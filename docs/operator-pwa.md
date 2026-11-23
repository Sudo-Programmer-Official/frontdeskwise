# Operator PWA and Web Push

FrontDeskWise now ships an installable operator shell at `/` and a service worker at `/sw.js`. The shell caches the application after the first visit, keeps API responses out of the cache, and opens notification clicks at the exact Inbox conversation.

## Enable browser alerts

Generate one VAPID key pair for each environment and store it in the API secret manager:

```bash
npx web-push generate-vapid-keys
```

Set these server-only values:

```bash
FRONTDESKWISE_WEB_PUSH_PUBLIC_KEY=...
FRONTDESKWISE_WEB_PUSH_PRIVATE_KEY=...
FRONTDESKWISE_WEB_PUSH_SUBJECT=mailto:support@frontdeskwise.com
```

Run the database migration `074_web_push_subscriptions.sql`, deploy the API and web app, then have an owner or staff member open Settings → Notifications. They can install the app and enable browser alerts per device. Subscriptions are scoped to the selected business, and expired push endpoints are removed automatically.

The existing in-app notification permissions remain authoritative. Web Push is best-effort delivery; takeover, assignment, and reply authorization continue to be enforced by the API.
