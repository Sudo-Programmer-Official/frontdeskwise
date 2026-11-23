# Request traffic and scaling guardrails

FrontDeskWise now records a bounded, aggregated HTTP request ledger so capacity decisions can be based on route and traffic purpose instead of total request count alone.

## What is measured

`GET /api/v1/admin/request-metrics?hours=24` is restricted to super-admins and returns:

- total requests, 5xx errors, error rate, average latency, and average requests per minute;
- route-level volume and approximate p50/p95 latency buckets;
- traffic-purpose totals for `customer_value`, `polling`, `background`, `health_check`, `internal`, and `other`;
- current-process samples that have not reached the next hourly database flush yet.

The API stores one aggregate row per route, method, traffic class, and UTC hour in `api_request_metrics_hourly`. It stores counts and latency buckets, never request bodies, visitor messages, IP addresses, or user agents.

The System health admin view exposes the same breakdown under “Where API traffic is coming from”.

## Polling behavior

- Visitor widget status checks run every 30 seconds during an ordinary open conversation.
- Handoff or staff-active conversations run every 5 seconds while visible.
- Hidden browser tabs back off to 60 seconds.
- The owner Inbox refreshes every 30 seconds when idle, every 10 seconds with a selected conversation, and every 60 seconds in a hidden tab.
- Push notifications remain the preferred wake-up path for a closed PWA.

The timers are one-shot schedules rather than fixed intervals, so visibility and conversation state can change the next refresh without leaving duplicate timers running.

## Operating thresholds

Use the route breakdown with the existing service graphs. A practical first scale trigger remains sustained pressure rather than a customer-count milestone:

| Signal | Watch | Scale or investigate |
| --- | ---: | ---: |
| Memory | 60–75% | >75–80% sustained |
| CPU | 50–70% | >70% sustained |
| API latency | 500 ms–1 s | >1 s excluding LLM time |
| 5xx rate | 0.5–1% | >1% |
| Database pool | 60–80% | >80% |
| Queue depth | Growing | Continuously growing |

The next infrastructure step should be selected by the constrained dimension: database pool/query latency, model/provider concurrency, or background work. Crawls, embeddings, certification, and report generation should move to workers before they compete with customer conversations.

Migration `infra/db/079_api_request_metrics.sql` is included in the normal forward-only migration chain.
