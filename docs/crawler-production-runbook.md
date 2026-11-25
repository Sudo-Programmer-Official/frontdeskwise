# Website crawl production runbook

## Runtime path

`Refresh website knowledge` in the web app calls:

```text
POST /api/v1/demo/:slug/knowledge/sources/:sourceId/recrawl
  -> crawlConfiguredWebsite()
  -> crawlWebsite()
  -> robots.txt and sitemap discovery
  -> same-domain link discovery and URL normalization
  -> exclusion and page-type filtering
  -> static fetch, then rendered-page fallback when the shell is client-rendered
  -> websiteSourcesFromPages()
  -> replaceWebsiteSources()
  -> persistBusiness()
  -> embedding/index refresh
  -> coverage/readiness snapshot in onboarding_validation
  -> workspace and Sources responses
```

The crawl is currently synchronous in the API process. Render has one API web
service and there is no separate website-crawl queue or worker. Crawl
diagnostics therefore record `backgroundWorkerUsed: false` and
`workerJobId: null` unless that architecture changes.

## Production deployment

The crawler code and the web readiness display both require deployment:

- API redeploy: required for discovery, persistence, diagnostics, and the
  authoritative readiness calculation.
- Web redeploy: required for the corrected readiness pill, refresh-state
  reconciliation, and diagnostics display.
- Worker redeploy: not required today; there is no crawl worker.
- Queue configuration: not required today; website refresh does not enqueue a
  background crawl.
- Environment variables: optional because bounded defaults are provided. The
  Render configuration sets `FRONTDESKWISE_CRAWL_MAX_PAGES=20` and
  `FRONTDESKWISE_CRAWL_MAX_DEPTH=2`. Increase them only deliberately.
- Existing businesses: require one explicit website refresh after the API
  deploy. The refresh rebuilds the website page sources and chunks and stores
  the crawl snapshot. No manual database migration is needed for the JSON
  snapshot.

## Verification after deploy

1. Deploy API and web.
2. Open the business Knowledge page and click `Refresh website knowledge` once.
3. Confirm the response/UI shows more than one website source for a
   multi-page site and that the Quality tab shows the same discovered,
   eligible, attempted, captured, skipped, failed, and coverage values.
4. Confirm `GET /api/v1/demo/:slug/knowledge/sources` exposes the same persisted
   page records and crawl snapshot as the workspace response.
5. Inspect API logs for the `crawlRunId`, `seedUrl`, limits, rejection reasons,
   fetch strategies, final readiness, and the absence of the legacy path.

For the DaycareSpots fixture, a seed-only result must remain `Partial knowledge`
or `Needs attention`; it must never be `Healthy / 100% ready` while additional
eligible public pages remain unprocessed.
