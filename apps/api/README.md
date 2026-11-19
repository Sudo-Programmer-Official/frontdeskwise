# FrontDeskWise API

The API owns tenant-scoped businesses, website ingestion, conversations, leads, knowledge gaps, actions, and agent configuration.

The current scaffold exposes:

- `GET /health`
- `GET /api/v1/demo/:slug`

Database work should start from `../../infra/db/001_initial.sql` and use a new database named `frontdeskwise`.

