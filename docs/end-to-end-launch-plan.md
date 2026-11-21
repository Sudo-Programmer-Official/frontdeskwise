# FrontDeskWise: end-to-end MVP and launch plan

## Product decision

FrontDeskWise should have a real demo tenant and subscription state from the beginning, but live billing should come after the core value loop is proven.

The product loop is:

```text
Business URL → trusted knowledge → correct answer → lead → booking or handoff
```

The implementation reference for this plan is [architecture.md](./architecture.md). It documents the current service boundaries, request flows, data model, security boundary, widget contract, and embedding lifecycle.

### Demo now

Create an isolated demo workspace with:

- one tenant/business record;
- one owner/demo user;
- a short-lived demo access session, defaulting to 48 hours;
- `billing_mode = sandbox`, `is_demo = true`, and a resettable seed;
- a visible “Demo” boundary in the UI;
- no live Stripe calls and no production customer data.

The demo must use the same tenant, auth, entitlement, and API paths as a paid workspace. Only the data and access policy differ. This follows the proven Salon Flow pattern without copying Salon Flow’s business domain.

### Subscription now, collection later

Add the billing state machine now so product behavior is stable:

```text
trial → active → grace → cancelled
             ↘ paused
```

Keep `sandbox` and `live` billing modes separate. Implement the access guard and plan/entitlement model now, then turn on Stripe test checkout after the pilot acceptance gates pass. Do not build a large pricing catalog for MVP.

Launch with one paid founding plan per location and one annual option. Treat the price as a hypothesis to validate, not as a permanent product decision. Suggested initial packaging:

- Founding monthly: one website, one widget, one location, lead capture, booking CTA, and a practical monthly conversation allowance.
- Founding annual: the same product with a meaningful annual discount.
- Concierge onboarding: a human-assisted setup option, priced separately if the customer needs content cleanup or installation help.

The entitlement layer should be keyed by capabilities and usage limits, not by scattered plan-name checks. Example capabilities are `website_crawl`, `grounded_answers`, `lead_capture`, `booking_cta`, `analytics`, and `human_handoff`.

## MVP definition

MVP is complete when a real business owner can:

1. enter a public website URL;
2. receive a tenant-scoped demo workspace;
3. see the pages used as knowledge sources;
4. ask questions and receive answers with citations;
5. see a safe fallback when information is missing;
6. capture a lead and see it in the owner dashboard;
7. configure the assistant’s name, greeting, color, and actions;
8. install the widget with one copyable script snippet;
9. return later through an authenticated owner account;
10. start a paid trial or checkout only after choosing to activate.

MVP explicitly excludes voice, WhatsApp, a workflow canvas, multi-agent orchestration, a broad integration marketplace, and complex billing tiers.

## System shape

```text
Landing page
   │ URL
   ▼
Demo provisioner ──► tenant + owner + demo access + billing state
   │
   ▼
Crawler ──► sources ──► cleaned documents ──► chunks ──► embeddings/indexes
                                              │
Visitor question ◄── widget ◄── answer service ◄── hybrid retrieval
       │                                  │
       ├── lead capture ──► leads         ├── citation + confidence
       ├── booking CTA  ──► action log     └── knowledge gap
       └── handoff      ──► owner queue

Owner dashboard ◄── tenant-scoped API ◄── PostgreSQL / pgvector
Billing provider ──► verified webhooks ──► billing state + entitlements
```

Every business-facing record must carry a `business_id`/tenant key. Every read and write must enforce that boundary before application logic runs.

## Website ingestion

### Crawl contract

The user provides a domain or URL. The ingestion job should:

1. normalize protocol, hostname, trailing slash, and canonical URL;
2. reject localhost, private IPs, credentials in URLs, and unsupported protocols;
3. fetch and honor `robots.txt`;
4. discover the sitemap when available;
5. crawl the homepage plus same-domain pages, capped for MVP at roughly 20 pages and depth 2;
6. stay on the same registrable domain unless explicitly allowed;
7. rate-limit requests per domain and enforce per-page timeout/byte limits;
8. remove scripts, styles, navigation noise, duplicate boilerplate, and hidden text;
9. preserve title, headings, canonical URL, page type, language, crawl timestamp, and content hash;
10. make the crawl idempotent so unchanged pages do not create duplicate knowledge.

The crawler should report partial success. A blocked pricing page should not prevent a demo from being created; it should become an ingestion warning and a knowledge gap candidate.

### Source model

Keep the raw source metadata separate from the cleaned content. Store:

- source URL and canonical URL;
- page title and heading path;
- content hash and crawl status;
- HTTP status and content type;
- last crawled and next refresh timestamps;
- page classification such as `service`, `pricing`, `policy`, `location`, `faq`, or `about`.

Do not make the raw HTML the answer context. Store it for audit/re-crawl only, subject to retention and privacy rules.

## RAG design

### Chunking defaults

Use heading-aware semantic chunks rather than fixed character slicing.

- Target: 450–650 tokens per chunk.
- Overlap: 60–90 tokens, approximately 12–15%.
- Never split a heading from the paragraph or list that explains it.
- Keep tables, prices, hours, policies, and FAQs as atomic structured blocks when possible.
- Add metadata: `business_id`, `source_id`, URL, page type, heading path, language, token count, and content hash.

The current ingestion slice uses heading-aware word windows at approximately 520 tokens with 80-token overlap and stores the heading/page-type metadata. The next upgrade is semantic/structured block handling for tables, prices, hours, policies, and FAQs; overlap should preserve boundary context, not inflate context indiscriminately.

### Indexing and retrieval

Use hybrid retrieval from the start:

1. PostgreSQL full-text search for exact terms, names, prices, policies, and locations.
2. pgvector similarity search for paraphrases and natural-language questions.
3. Reciprocal rank fusion or a normalized weighted merge of both result sets.
4. Metadata filters for tenant, active knowledge version, language, and page type.
5. Optional reranking of the top 20 candidates only after the first retrieval pass.

Initial retrieval target: 8–12 candidate chunks, with 4–6 chunks sent to answer generation. Add an admin/debug endpoint that shows the retrieved chunks, scores, and citation source so incorrect answers are diagnosable.

### Grounding policy

The answer service must return:

- answer text;
- `grounded: true|false`;
- confidence score or confidence band;
- source citations;
- retrieval identifiers for debugging;
- a knowledge-gap record when confidence is below threshold.

If evidence is weak, the assistant must say it does not know, offer lead capture, and avoid inventing prices, schedules, policies, availability, or guarantees.

## LLM and cost routing

Use a policy layer, not model names scattered through route handlers.

### Routing tiers

- Tier 0: no LLM. Handle greeting, consent, widget state, lead form, booking CTA, and deterministic FAQ matches.
- Tier 1: economical model. Standard grounded answer generation, query classification, short summaries, and knowledge-gap labeling.
- Tier 2: stronger model. Only for multi-part questions, ambiguous retrieval, cross-page synthesis, or low-confidence recovery.
- Embeddings: one configurable embedding model with a version recorded on each knowledge build.

### Cost controls

- cache answers by normalized question plus knowledge-version ID;
- cap retrieval context and completion tokens;
- meter input/output tokens per business and conversation;
- enforce monthly soft and hard budgets;
- log model, route, latency, token counts, and cost estimate;
- never silently fall back from a paid/live model to an unapproved provider;
- allow staging to use sandbox/test credentials only;
- use batch/background work for crawl embedding and analytics.

The MVP should optimize for trustworthy answers per dollar, not maximum model sophistication.

## Demo, auth, and billing lifecycle

### Demo lifecycle

```text
URL submitted
  → demo tenant created
  → crawler job started
  → demo access issued
  → first question / first lead tracked
  → demo expires or owner activates
```

The current slice issues a hashed, short-lived demo bearer token bound to the exact tenant, records opens/expiry, and enforces it on owner dashboard reads and configuration writes. The next auth slice will exchange it once for a normal Identity SDK session and remove the raw token from browser storage. The owner can customize the demo, but destructive or production-only actions remain disabled.

### Activation lifecycle

```text
demo → activation intent → trial → checkout → webhook-confirmed active
```

Only verified billing webhooks change subscription state. The browser return page may show “processing,” but it must not mark a business paid.

### Required billing fields

At minimum:

- `billing_mode`: `sandbox` or `live`;
- `is_demo`;
- `billing_status`: `trial`, `active`, `grace`, `paused`, or `cancelled`;
- `plan_key` and `billing_interval`;
- `trial_ends_at`, `current_period_ends_at`, and grace deadline;
- provider customer/subscription IDs;
- checkout session ID/status/timestamp;
- an audit note or event trail for manual overrides.

Salon Flow’s billing guard and Stripe mode separation are the right pattern to reuse conceptually. FrontDeskWise should implement its own small billing module against its own tables and tenant vocabulary.

## Install experience

The installation contract should be one snippet:

```html
<script
  async
  src="https://cdn.frontdeskwise.com/widget.js"
  data-site="PUBLIC_SITE_KEY"
></script>
```

The optional `data-pages` attribute scopes the widget to comma-separated URL paths, such as `data-pages="/"` for the home page or `data-pages="/,/services/*"` for the home page and service descendants. When omitted, the widget runs on every page where the script is installed. Query strings and hashes are ignored, and a terminal `*` matches descendants. The loader applies this filter before creating the widget or fetching configuration.

The public site key is not a secret. The widget should load in an iframe or shadow-root boundary, identify the tenant server-side, and never expose database credentials or provider secrets. Installation checks should verify script load, tenant resolution, first question, citation, and lead delivery.

## Acceptance gates

### Product acceptance

- URL submission creates a demo in under 60 seconds for a normal small-business site.
- A crawl can be retried without duplicate sources or chunks.
- At least 90% of a 30-question golden set is answered with the correct source.
- Unsupported questions produce a fallback and a knowledge gap, never an invented answer.
- First answer p95 is under 3 seconds after knowledge is ready.
- A captured lead is visible to the owner within 30 seconds and survives a restart.
- The booking CTA and human handoff are tenant-scoped and auditable.
- Demo links expire, revoke cleanly, and cannot switch tenants through headers or URL edits.

### Owner UX acceptance

- An owner can understand readiness, sources, unanswered questions, leads, and next actions without training.
- The assistant can be edited and previewed before publishing.
- The install snippet is copyable and has a verification state.
- Billing state is visible but does not block a demo tenant.
- Upgrade action opens sandbox checkout in staging and live checkout only in production.

### Reliability and safety acceptance

- All tenant queries require the tenant key.
- Crawl SSRF protections, robots handling, timeouts, size limits, and rate limits are tested.
- Provider webhooks are signature-verified and idempotent.
- PII is minimized, access-controlled, redacted from logs, and retained intentionally.
- Database migrations are forward-only, repeatable, checksum-checked, and environment-guarded.
- Staging seed commands refuse production databases and production Stripe mode.

## Delivery sequence

### Phase 0: foundation — substantially complete

1. Add demo tenant/user/access-session tables and auth boundary. **Complete for demo bearer sessions; Identity SDK exchange remains.**
2. Add billing state and entitlement tables without enabling live checkout. **Complete.**
3. Add staging-only idempotent demo seed/reset commands.
4. Add crawl job status and source metadata. **Complete.**

### Phase 1: value loop — in progress

1. Replace single-page fetch with bounded same-domain crawl. **Complete; sitemap discovery remains.**
2. Upgrade to heading-aware chunking with overlap. **Complete for the initial chunker.**
3. Add full-text plus pgvector hybrid retrieval. **Full-text is active; vector hydration is optional and next.**
4. Add grounded answer contracts, citations, and confidence thresholds. **Complete for the initial retrieval path.**
5. Persist conversations, gaps, leads, booking clicks, and usage. **Conversation/gap/lead/action persistence is active; usage metering remains.**

### Phase 2: owner workflow

1. Connect the dashboard to real tenant data.
2. Add knowledge-gap review and answer approval. **Initial API and dashboard workflow is active.**
3. Add widget preview, install snippet, and verification. **Initial public site-key widget and install snippet are active; production CDN verification remains.**
4. Add conversation replay and retrieval diagnostics. **Initial diagnostics API and Knowledge UI are active.**

### Phase 3: pilot and billing

1. Run 5–10 concierge pilots in one vertical, starting with swim schools.
2. Measure answer correctness, first lead time, demo-to-reply, and owner activation.
3. Validate Stripe sandbox checkout and webhook reconciliation.
4. Convert successful pilots to a founding plan.
5. Enable live billing only after sandbox events and cancellation/grace handling pass.

### Phase 4: launch hardening

1. Add scheduled recrawls and change detection.
2. Add per-tenant usage budgets and configurable cost alerts on top of the active model-routing diagnostics.
3. Add email notifications and booking destination integrations.
4. Publish vertical-specific onboarding and public demos.
5. Expand channels only after the website loop is repeatable.

## Metrics that decide whether to proceed

- URL → demo created: at least 80% for valid sites.
- Demo created → first question: at least 50%.
- First question → grounded answer: at least 90% on the golden set.
- Demo opened → owner reply: at least 10% during founder-led outreach.
- Activated business → first lead: under 24 hours.
- Cost per resolved conversation: tracked by model tier and tenant.
- Demo → activation: the primary commercial metric after pilot volume is real.

The next implementation slice is launch hardening: scheduled recrawls/change detection, widget script verification, and additional CRM adapters. The customer loop now includes tenant-scoped website/document knowledge, retrieval diagnostics, cost-aware model routing, grounded fallback behavior, lead capture, and CRM delivery. Firebase account bootstrap, Stripe checkout/webhooks/portal, private S3 document extraction, SES notifications, ownership verification, and the `/platform` super-admin control plane should be exercised in the production acceptance pass.
