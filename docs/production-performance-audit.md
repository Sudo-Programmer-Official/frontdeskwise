# FrontDeskWise production performance audit

Date: 2026-11-21  
Host under test: `https://plancraftai.com/`  
Status: local production build audited; deployment of the optimized artifact is still required before production-after numbers can be claimed.

## Executive result

The original public entrypoint downloaded and initialized the complete conversation UI before the visitor opened the widget. The optimized build splits that path into a small async loader and a deferred conversation shell.

| Artifact | Before | After | Change |
| --- | ---: | ---: | ---: |
| Initial widget raw | 57,897 B | 9,540 B | -83.5% |
| Initial widget gzip-9 | 13,331 B local / ~13.5 KB observed | 3,771 B | -71.7% |
| Initial widget Brotli-11 | 11,489 B | 3,186 B | -72.3% |
| Deferred shell gzip-9 | included in initial path | 11,604 B | loaded only after interaction |

The initial path now contains only the launcher, config/proactive decisioning, cache, listeners, and telemetry buffer. Renderer, markdown, conversation restoration, polling, actions, and RAG/message code are in `widget-shell.js` and are not downloaded or initialized until an explicit launcher/teaser interaction (or an explicitly configured proactive open).

## Baseline without widget

An exact host-page LCP, CLS, INP, TBT, JS execution, memory, and main-thread baseline could not be captured from this environment because PlanCraftAI's deployed page always includes the widget and the available browser surface did not expose a repeatable Lighthouse/trace export. These values are deliberately marked unmeasured rather than inferred from visual loading.

The host HTML response was 70,406 bytes in the production HTTP sample. A true no-widget baseline requires a controlled copy of the same production page with the embed removed, tested in the same browser profile and network/CPU conditions as the enabled run.

## With widget: current production baseline

The live page currently includes an async apex-domain embed that redirects to `www`:

```html
<script async src="https://frontdeskwise.com/widget.js" data-site="..." data-api="https://api.frontdeskwise.com"></script>
```

One production HTTP sample measured:

| Request | Result |
| --- | --- |
| loader URL | 308 redirect from apex to `www`, then 200 |
| widget JavaScript | 57,897 B; 13,503 compressed bytes transferred; TTFB 757 ms; total 757 ms including the redirect |
| public config | ~1,401 B JSON; 757 compressed bytes; TTFB 1,223 ms; total 1,223 ms |
| config cache policy | `no-store, max-age=0` before this change |

This is the before/deployed baseline. It includes the full widget shell in the first JavaScript request and therefore does not meet the preferred loader budget.

## Performance delta and request behavior

The optimized local production build is the after candidate, not yet a production-after result.

| Scenario | Before | After candidate |
| --- | --- | --- |
| Widget never opened | Full widget JS downloaded and initialized | 3.6 KB gzip loader; shell absent; no conversation bootstrap/polling |
| Cold first view | Apex redirect + widget + config (3 URL transactions) | Canonical `www` loader + config (2 network requests) |
| Warm view within 60 s | Config still used `no-store` | Loader + local config cache; no config request |
| Stale config | Full config request path | Local cache served; background revalidation after 60 s, with a 5-minute stale-while-revalidate bound |
| Launcher click | Shell already paid for | One deferred shell request, then shell reuses the loader's config promise |
| Document flow | Overlay behavior existed in shell | Loader host is fixed, zero-size, and pointer-transparent; launcher/teaser are fixed overlays |

The config endpoint now emits `Cache-Control: public, max-age=60, stale-while-revalidate=300`, an ETag, and a config version. Owner changes propagate on the next revalidation window rather than remaining indefinitely cached.

## Initial request count

- Current production cold path: 3 URL transactions — apex redirect, loader, and config.
- After candidate cold path: 2 requests when the canonical `www` install snippet is used — loader and config.
- After candidate warm path within the 60-second local-config TTL: loader only.
- Shell and performance telemetry are interaction/unload paths, not initial page-load requests.

## Bundle size

The public artifacts contain no dashboard/admin imports. The shell imports only the local renderer and markdown renderer. Dashboard Vue, Firebase, Simple Icons, and admin application code are not part of either public widget artifact.

| Artifact | Raw | gzip-9 | Brotli-11 |
| --- | ---: | ---: | ---: |
| `public/widget.js` loader | 9,540 B | 3,771 B | 3,186 B |
| `public/widget-shell.js` | 39,950 B | 11,604 B | 10,146 B |

Largest shell contributor is the renderer, especially its embedded widget CSS; markdown is small by comparison. There are no third-party package dependencies bundled into the public widget entrypoints.

## Launcher, shell, and bootstrap latency

The loader records these internal milestones and sends them to the internal performance table; they are not rendered to visitors. Super Admin access is required to read the aggregate observability endpoint:

1. `loader_requested`
2. `loader_downloaded`
3. `launcher_rendered`
4. `proactive_config_available`
5. `teaser_rendered`
6. `teaser_clicked`
7. `launcher_clicked`
8. `full_shell_visible`
9. `bootstrap_config_completed`
10. `conversation_restored`
11. API receipt, represented by the backend event's `request_received_at`
12. `retrieval_ms`
13. `model_request_started_ms`
14. `first_assistant_content_available`
15. `full_response_rendered`

No live p50/p95 launcher or shell latency is reported yet because the optimized artifact has not been deployed and populated with production samples. The initial targets remain launcher render under 500 ms and cached shell interactive within 300–500 ms.

## Widget-open latency

Before, the shell bytes were paid before any interaction. After the split, the initial click pays for the deferred `widget-shell.js` request. The shell is opened immediately with default UI state while config is shared in the background; on a cached shell the target is 300–500 ms. A production p50/p95 value is pending deployment.

## Bootstrap latency

The current production config sample completed in 1,223 ms, making it the largest cold-start latency risk. The after candidate avoids bootstrap work for the launcher when a fresh local config exists, reuses the same promise when the shell opens, and bounds owner-change propagation to the cache/revalidation window. A post-deploy p95 is required before declaring the 500 ms target met.

## AI-response latency telemetry

For every message, the backend stores bounded internal metrics for:

```text
frontend_send_ms         (pre-message-request/session setup)
network_round_trip_ms    (frontend request-to-response interval)
network_to_api_ms        (derived after joining with backend_total_ms)
retrieval_ms
rerank_ms
model_request_started_ms
llm_first_token_ms
llm_total_ms
render_ms
total_response_ms
```

The current model integration is non-streaming, so `llm_first_token_ms` is currently the first completed model-content availability time, not a true streamed-token timestamp. The frontend keeps request IDs so frontend and backend records can be joined; `network_to_api_ms` is derived from the frontend round trip and backend total after that join. A Super Admin endpoint exposes p50/p95 summaries without exposing diagnostics to visitors.

## Main-thread, CPU, memory, and proactive findings

- The closed widget no longer starts conversation restoration or polling; polling is started only while open and stopped on close.
- The loader performs bounded DOM work once, uses a fixed zero-size host, and avoids document-flow layout changes.
- Scroll engagement uses a passive listener and one `requestAnimationFrame` computation at a time.
- Exit intent is passive and is removed after firing.
- Delay, scroll, return-visit, and exit listeners/timers are cleared after open, teaser display, or dismissal.
- No continuous MutationObserver or closed-state rerender loop is used.
- Memory and main-thread trace deltas remain unmeasured until a controlled browser profile is run; no number is fabricated here.

## Memory findings

No heap snapshot was available from the current browser surface. The code-level risk is reduced by not constructing the renderer or conversation state until shell load, stopping polling on close, and avoiding retained continuous observers. Heap-before/open/close snapshots remain a required post-deploy measurement.

## Proactive-listener findings

Delay and returning-visit timers are one-shot. Scroll is passive and rAF-coalesced. Exit intent is passive. All proactive timers, listeners, and pending scroll frames are removed when proactive engagement fires, is dismissed, or the visitor opens the widget. The loader also suppresses repeated engagement using session/24-hour storage according to the configured frequency.

## Largest bottlenecks

1. The deployed apex embed redirect adds a request and latency; generated snippets now target `www` directly.
2. The deployed config endpoint's 1.223-second sample is the current cold bootstrap bottleneck; the candidate adds TTL/ETag/local-cache behavior.
3. The old initial bundle paid for the complete renderer and conversation path; the candidate defers that cost to interaction.
4. The deferred shell's largest local contributor is renderer CSS, so further open-path optimization should focus there only if shell interaction traces justify it.

## Changes implemented

- Split `widget.js` into a tiny async loader and `widget-shell.js`.
- Kept launcher and teaser as fixed overlays with no normal-flow footprint.
- Deferred shell download, conversation bootstrap, restore, polling, actions, and RAG/message code until interaction.
- Added localStorage config caching with a 60 s freshness TTL and 5-minute stale-while-revalidate ceiling.
- Added ETag/version headers and removed duplicate loader/shell config fetches by sharing the loader promise.
- Added internal performance event persistence plus Super Admin p50/p95 summaries.
- Added backend retrieval, rerank, model-start, LLM, and total timing fields.
- Added a database migration: `infra/db/045_widget_performance_telemetry.sql`.
- Updated generated install snippets to use canonical `www` loader and shell URLs, avoiding the current apex redirect after deployment.

## Required post-deploy browser matrix

Run the same PlanCraftAI production build with the widget disabled and enabled under cold/warm cache, desktop broadband, Fast 3G/Slow 4G-equivalent, and mobile CPU throttling. Test: never opened, proactive teaser only, full open, active conversation, and handoff/form state. Export browser traces for:

- LCP, CLS, INP, TBT
- total JS execution and main-thread task time
- transferred bytes and request count
- heap snapshots before/after open and after close
- launcher and shell milestones from the internal event table

The final production health decision should be based on those deltas plus the p50/p95 telemetry, not on the widget merely appearing on screen.

## Before/after result

The implemented change is a verified build-level improvement: the initial widget transfer is down 83.5% raw and 71.7% gzip-9, the shell is deferred, config calls are deduplicated/cached, and closed-state polling is removed. Production-after Web Vitals, memory, CPU, and real launcher/open/AI p95 values are intentionally not claimed until the optimized artifact is deployed and the A/B browser matrix is run.
