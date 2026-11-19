# FrontDeskWise

FrontDeskWise is an AI front desk for local businesses. It answers website questions, captures leads, and moves visitors toward a booking or human handoff.

This repository starts with the product-led growth loop:

```text
Business URL → instant personalized demo → lead capture → owner dashboard → install
```

## First slice

- Public onboarding screen for entering a business website.
- Instant demo workspace using a realistic swim-school profile.
- Owner dashboard focused on leads, booking actions, unanswered questions, and AI readiness.
- Agent customization surface for greeting, color, FAQs, and action buttons.
- API and database scaffolding that keeps tenant boundaries explicit.

## Run locally

```bash
npm install --prefix apps/web
npm run dev
```

The API scaffold is intentionally separate:

```bash
npm install --prefix apps/api
npm run api:dev
```

Copy `apps/api/.env.example` to `apps/api/.env` when connecting a local or new FrontDeskWise database. Do not reuse the ApplyPilot database name or copy its credentials.

## Product principle

The app should optimize for one outcome: `URL → correct answer → lead → booking`. Everything else is secondary until that loop works for real businesses.

# frontdeskwise
