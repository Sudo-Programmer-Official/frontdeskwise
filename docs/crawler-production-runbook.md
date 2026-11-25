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
  -> website pricing fact extraction/upsert (natural-key safe and serialized per business)
  -> embedding/index refresh
  -> coverage/readiness snapshot in onboarding_validation
  -> workspace and Sources responses
```

The current production failure mode is not a seed-only fetch loop. A legacy
site can expose many links whose shared navigation contains words like
"create account". The page classifier must not use that body copy to classify
the whole page as `account`, or the crawler will mark useful pages as
`low_value_page_type` and report them as intentional skips. The crawler also
preserves the site's preferred `www` host, repairs obvious host-like relative
links, rejects HTTP-200 soft-404 documents, and excludes login intent encoded
in query parameters.

The crawl is currently synchronous in the API process. Render has one API web
service and there is no separate website-crawl queue or worker. Crawl
diagnostics therefore record `backgroundWorkerUsed: false` and
`workerJobId: null` unless that architecture changes.

The refresh also rebuilds structured website pricing facts. Those writes must
use the same active natural key as `business_facts_active_source_key_idx`; an
upsert by fact UUID alone is unsafe because repeated pricing markup or
concurrent workspace reads can otherwise raise PostgreSQL `23505` and make the
refresh, workspace, Sources, Q&A, and gap endpoints fail together.

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
- Pricing-fact repair: included in the API deploy. No new migration or queue
  configuration is required because the existing active natural-key index is
  reused. A successful refresh will reconcile the affected business's active
  pricing facts; no manual row deletion should be performed.

On the first read after the API deploy, older snapshots are also normalized in
memory: if their counters show more eligible pages than were attempted, the
authoritative readiness result is downgraded and the diagnostic path is marked
as legacy until a successful refresh replaces the snapshot.

If production still reports `Legacy Discovery Only`, `1 captured`, or a seed-
only source after the API deploy, inspect the Render API service revision and
the `Website knowledge refresh persisted` log entry. The current path is
synchronous; a separate worker or queue cannot explain a missing crawl result.

## Verification after deploy

1. Deploy API and web.
2. Open the business Knowledge page and click `Refresh website knowledge` once.
3. Confirm the response/UI shows more than one website source for a
   multi-page site and that the Quality tab shows the same discovered,
   eligible, attempted, captured, skipped, failed, and coverage values.
4. Confirm `GET /api/v1/demo/:slug/knowledge/sources` exposes the same persisted
   page records and crawl snapshot as the workspace response.
5. Inspect API logs for the `crawlRunId`, `seedUrl`, limits, rejection reasons,
   fetch strategies, final readiness, and the absence of the legacy path. A
   successful run must not emit `23505` for
   `business_facts_active_source_key_idx`.

For the DaycareSpots fixture, a seed-only result must remain `Partial knowledge`
or `Needs attention`; it must never be `Healthy / 100% ready` while additional
eligible public pages remain unprocessed.

## DaycareSpots production evidence

Before the classifier/link fixes, the live site reproduced this audit:

```text
discovered 93 · eligible 1 · attempted 1 · successful 1 · skipped 92
rejection reasons: excluded_route 32 · low_value_page_type 91
```

With the corrected crawler against the live `www.daycarespots.com` origin, the
same site produced:

```text
discovered 63 · eligible 26 · attempted 21 · successful 20
failed 1 · unprocessed 5 · coverage 77%
```

That is intentionally `Partial knowledge`/`Needs attention` at the current
20-page, depth-2 production bound. It is not `Healthy / 100% ready`, and it
does not require a crawl worker or queue.
