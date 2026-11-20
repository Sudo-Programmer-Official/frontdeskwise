# PlanCraftAI RAG quality audit

Audit date: 2026-11-20 (America/New_York)

Primary tenant: `PlanCraftAI` / `plancraftai` (`is_demo = true`). A second, separately owned tenant with slug `plancraftai-ajg8l` exists; it was not used as the primary test corpus.

## Executive result

The system had a real relevance failure, not only a grounding failure. The live PlanCraftAI store contained 157 chunks from 14 sources, but 0 chunks had embeddings. The embedding job failed after three attempts with HTTP 401, so production retrieval was operating as PostgreSQL full-text search plus heuristic source ranking.

Before hardening, broad terms such as `PlanCraftAI`, `use`, `service`, and `pricing` caused `/data-deletion` and `/terms` to appear ahead of dedicated product pages. The original intent classifier also labeled reminders, voice, calendar, permissions, and team questions as `general`.

The code now adds intent-aware source filtering, semantic source types, coverage-based evidence scoring, explicit answerability thresholds, safer citation selection, stricter synthesis instructions, and fail-closed behavior when generation/grounding verification fails. The live corpus still needs a successful re-crawl and embedding job before these improvements are reflected in stored chunks/vectors.

Continuation audit result: a sanitized direct provider probe confirmed `HTTP 401`, error code `invalid_api_key`, for the configured OpenAI embedding request. The key is present in the local API environment and uses the project-key prefix, but OpenAI rejects it. The configured model is `text-embedding-3-small`; the request and vector schema both use 1,536 dimensions. No secret value is recorded here.

## Current pipeline

```text
Website / uploaded document
  -> crawl or parser
  -> HTML cleanup + heading-aware semantic extraction
  -> chunking (web: 520 target tokens, 80 overlap; documents: 3,600 chars, 360 overlap)
  -> business_sources + knowledge_chunks (tenant-scoped hashes and metadata)
  -> embedding job (text-embedding-3-small, 1,536 dimensions)
  -> query intent classification + intent vocabulary
  -> PostgreSQL full-text top 20                  \
     PostgreSQL vector top 20 (when embeddings exist)
  -> RRF merge (k=60)
  -> semantic evidence coverage + source-type prior + duplicate penalty
  -> intent-specific answerability threshold / abstention
  -> tiered grounded synthesis
  -> grounding checker
  -> up to 2 materially relevant, source-diverse citations
```

Implementation locations:

- Crawl, cleaning, classification, and web chunking: `apps/api/src/crawler.ts`
- Document parsing/chunking: `apps/api/src/document-ingestion.ts`
- Embeddings: `apps/api/src/embeddings.ts`
- Retrieval, intent classification, source typing, ranking, citations, and answerability: `apps/api/src/retrieval.ts` and `apps/api/src/server.ts`
- LLM synthesis and claim-level grounding check: `apps/api/src/model-routing.ts`
- Storage: `infra/db/001_initial.sql`, `003_demo_storage_hardening.sql`, `006_retrieval_search_fields.sql`, `008_embedding_jobs_widget.sql`

## Embedding failure diagnosis and operational safety

| Check | Result |
|---|---|
| Provider and endpoint | OpenAI `https://api.openai.com/v1/embeddings` |
| Authentication variable | `OPENAI_API_KEY` using a Bearer header |
| Model variable | `FRONTDESKWISE_EMBEDDING_MODEL`, configured as `text-embedding-3-small` locally and in `render.yaml` |
| Dimensions | 1,536 in the request and `vector(1536)` in PostgreSQL |
| Direct provider response | HTTP 401, `invalid_api_key`, “Incorrect API key provided” |
| Local vs deployed | The repository declares the same provider/model path for production. The deployed secret is a Render-managed value and cannot be inspected from source; its live value was not independently verified. |
| Public deployment check | `https://api.frontdeskwise.com/health` and `/ready` report API/database and other platform configuration health, but the currently deployed build does not expose embedding/provider readiness. It therefore cannot currently prove semantic health from its public readiness response. |
| Failed-job deployment identity | Not recoverable from the existing `embedding_jobs` row. The schema records business, model, attempts, and error, but not deployment/environment or worker revision. |
| Startup validation before this continuation | Only non-empty `OPENAI_API_KEY` presence was checked. Invalid credentials were discovered only when the worker called the provider. |
| Super-admin visibility before this continuation | Per-business embedding status existed, but there was no aggregate RAG health/metrics view and no explicit semantic readiness state. |

Implemented in this continuation:

- Startup provider probe with sanitized status/reason logging; secrets and provider response bodies are never logged.
- Explicit `SEMANTIC_SEARCH_HEALTHY`, `DEGRADED_FULL_TEXT_ONLY`, `EMBEDDING_CONFIGURATION_ERROR`, and `EMBEDDING_BACKLOG` states.
- Business readiness now reports website indexing separately from current-model embedding coverage and cannot award the semantic portion of readiness when coverage is zero.
- Reindex requests fail early when the provider is not healthy instead of creating a predictable failing job.
- Current model/dimension matching remains enforced for both writes and vector reads; stale vectors are excluded.
- `/api/v1/admin/rag/metrics` exposes provider status, per-business coverage/job state, embedding attempts/failures, vector-use percentage, full-text fallback percentage, low-confidence fallback percentage, and average retrieval/answer latency.
- The owner readiness panel distinguishes “Website indexed” from “Semantic embeddings” and displays degraded retrieval mode.

## Phase 1: implementation audit

| Area | Actual behavior |
|---|---|
| Crawl | Same-site crawl, max 20 pages, max depth 2, robots-aware, 8-second request timeout, 1 MB response cap. |
| HTML cleaning | Scripts/styles/nav/footer and other non-content wrappers are removed. The extractor now ignores article/section wrappers so headings are not swallowed by nested markup. Common CTA/footer noise is filtered. |
| Page classification | Database `page_type` remains coarse (`web_page`, `service`, `pricing`, `faq`, `policy`, `location`, `document`). Runtime semantic typing derives `product`, `pricing`, `reminders`, `voice`, `calendar`, `privacy`, `permissions`, `support`, and related types from URL/title as well. |
| Web chunking | Target 520 tokens with 80-token overlap. Chunks retain heading paths and are assembled across sections instead of one chunk per paragraph. |
| Document chunking | 3,600 characters with 360-character overlap; parser metadata includes document ID, parser, file name, chunk index, and page count. |
| Chunk metadata | Source/page type, heading path, token count, overlap, content hash, and tenant/source IDs. |
| Embeddings | Default `text-embedding-3-small`, hard-coded 1,536 dimensions, stored in `vector(1536)`. No explicit normalization is performed. |
| Similarity | Cosine distance via pgvector `<=>`; index is IVFFlat with `vector_cosine_ops`, `lists = 100`. |
| Tenant isolation | Full-text and vector queries filter by `business_id`; embedding updates also require both chunk ID and business ID. |
| Full-text | `simple` generated `tsvector`, OR-ed `to_tsquery` terms, top 20. Query terms are deterministic intent vocabulary plus tokenized user text. |
| Vector | Top 20 by cosine distance, only where `embedding is not null`. |
| Hybrid | Reciprocal rank fusion, `1 / (60 + rank)`. With no vectors, the actual mode is `postgres_full_text`, not semantic hybrid. |
| Reranking | Intent-specific source allowlist, source prior, normalized retrieval signal, evidence coverage, and duplicate penalty. |
| Intent | Deterministic rules cover services, pricing, contact, hours, location, booking, reminders, calendar, voice, permissions, privacy, policy, support, teams, general, and unsupported. |
| Thresholds | Intent-specific evidence thresholds range from 0.30 to 0.52; unsupported intent always abstains. |
| Generation | Tier 1 `gpt-4o-mini` / tier 2 `gpt-4o` unless overridden. The prompt requires direct, concise, evidence-only answers and `INSUFFICIENT_EVIDENCE` for gaps. |
| Grounding | A second model call must return exactly `SUPPORTED`; rejected or failed verification now causes abstention rather than an unverified extractive answer. |
| Citations | Up to 2 unique sources, filtered by intent and minimum evidence score. They are source-level citations, not independently verified claim-to-span links. |
| Conversation history | The current answer path retrieves on the current question only. Prior conversation text is not used for query rewriting or retrieval context, apart from action-flow state. |
| Caching/query rewrite | No retrieval cache and no LLM query rewrite were found. |

## Phase 2: live PlanCraftAI source inventory

Snapshot: 157 chunks, 157 distinct chunk hashes, 0 embedded chunks.

| Source | Stored page type | Derived type | Chunks | Main topic / quality |
|---|---:|---:|---:|---|
| `/ai-daily-planner` | web_page | product | 6 | Daily planning, priorities, calendar-aware scheduling, reminders. Useful; marketing copy and CTA fragments present. |
| `/ai-reminders` | service | service | 6 | Push, WhatsApp/SMS, email recaps, calendar-aware reminders. Useful; some CTA/SEO copy. |
| `/ai-task-planner` | web_page | product | 6 | Voice capture, task planning, next actions, team visibility. Useful; marketing copy. |
| `/contact` | location | contact | 2 | Contact form, email/website/LinkedIn support. Useful; no phone or hours found. |
| `/data-deletion` | web_page | privacy | 17 | Data control, pricing copy, product FAQ, account/deletion claims. Mixed source; high topic contamination. |
| `/delete-account` | web_page | web_page | 11 | Account deletion and sign-in help. Useful for account support; weak generic type. |
| `/features` | web_page | product | 7 | Product tour, daily planning, voice reminders, calendar sync, teams. Useful and authoritative for product capabilities. |
| `/google-calendar-integration` | web_page | calendar | 4 | Calendar workflow, meeting context, scheduling recommendations. Useful. |
| `/pricing` | pricing | pricing | 5 | Free, Solo Premium, Team Starter/Pro, seat pricing and limits. Authoritative pricing source. |
| `/privacy` | policy | privacy | 58 | Data collection, AI processing, third parties, Google Calendar data usage, contact. Authoritative privacy source but over-fragmented. |
| `/recurring-reminder-app` | web_page | reminders | 7 | Daily/weekly/monthly/custom reminders, lead time, recaps. Useful; SEO framing. |
| `/terms` | policy | policy | 17 | Terms, Google Calendar behavior, security/data handling. Authoritative for policy claims; not a product source. |
| `/voice-planning` | web_page | voice | 5 | Voice capture, transcription, scheduling, calendar/push/WhatsApp. Useful. |
| `/voice-reminder-app` | web_page | voice | 6 | Spoken reminders, one-time/recurring timing, follow-through. Useful. |

Knowledge coverage:

- Core capabilities: present.
- Reminders and recurring reminders: present.
- Voice task capture: present.
- Daily planning: present.
- Calendar functionality: present, including Google Calendar pages.
- Teams/workspaces: present in pricing/features, including seat plans and role-based access language.
- Permissions/privacy: present indirectly in privacy/terms; there is no dedicated permissions page.
- Pricing: present with concrete plan/seat prices. No `PRICING KNOWLEDGE GAP`.
- Contact/support: present by contact form and email. Phone, hours, and physical location were not found.
- Booking/appointments: no authoritative evidence found.

## Phase 3: chunk quality

The live corpus was created by the older extractor/chunker. Its metadata showed:

- Target: 520 tokens; overlap: 80 tokens.
- Actual average: 46.6 tokens.
- Minimum: 5 tokens; maximum: 391 tokens.
- 72 of 157 chunks were under 20 tokens.
- 21 chunks matched CTA patterns, 24 matched navigation/boilerplate patterns, and 7 matched SEO-style patterns in the audit scan.
- Exact duplicate chunk groups: 0.

The primary cause was the old block matcher including `<article>` and `<section>` wrappers. That swallowed nested headings/paragraphs and then chunked each extracted section independently. The implementation now excludes wrappers, retains heading paths, filters common CTA/footer noise, and chunks the page stream at the configured target. Recommended effective size remains 350–520 tokens for web content; there is no reason to reduce the configured 520-token target after re-crawling until retrieval evaluation says otherwise.

### Improved ingestion dry run

The improved crawler was run read-only against `https://plancraftai.com/`; the live database was not changed because the provider credential is still invalid.

| Metric | Old stored corpus | Improved dry run |
|---|---:|---:|
| Sources/pages | 14 | 14 unique content pages (17 URLs discovered before deduplication) |
| Chunks | 157 | 27 |
| Median token count | 21 | 493 |
| Minimum token count | 5 | 30 |
| Chunks under 20 tokens | 72 | 0 |
| Exact duplicate chunk groups | 0 | 0 |
| Duplicate page-content groups | Not measured in the original snapshot | 0 after content-hash deduplication |

The dry run still contains CTA phrases inside some substantive marketing chunks; these are not standalone boilerplate blocks. The crawler now deduplicates repeated page content while preserving link discovery. Re-crawl and persistence remain blocked until the embedding credential is repaired.

## Phase 4–5: retrieval experiments

The required experiment was run against the live tenant after ranking changes. `VECTOR=0` in every row is the important result: no vector candidates exist, so `HYBRID` currently collapses to PostgreSQL full-text.

| Query | Intent | Full-text tendency | Final reranked tendency |
|---|---|---|---|
| What services does PlanCraftAI offer? | services | `/features` first, but `/data-deletion` and voice pages also appear high | `/features`, `/ai-daily-planner`, `/ai-task-planner` product pages |
| What is PlanCraftAI pricing? | pricing | Initially `/data-deletion`, `/ai-daily-planner`, voice pages; pricing terms were missing from the query expansion | `/pricing` first after adding plan/free/month/seat/subscription terms |
| What permissions does PlanCraftAI use? | permissions | `/terms`, `/data-deletion`, then pricing overlap | Privacy/data and terms sources; product/voice sources filtered out |
| Can PlanCraftAI create reminders? | reminders | `/data-deletion`, `/features`, voice pages | `/recurring-reminder-app`, `/features`, reminder pages |
| Does PlanCraftAI work with calendars? | calendar | `/data-deletion`, `/features`, `/ai-daily-planner` | `/google-calendar-integration`, product pages |
| How can I contact PlanCraftAI? | contact | `/data-deletion`, `/terms`, `/delete-account` | `/contact` only after contact/support source filtering |
| Can I create tasks by speaking? | voice | `/features`, `/voice-planning`, `/data-deletion` | `/voice-planning`, `/features`, `/voice-reminder-app` |
| Can teams use PlanCraftAI? | teams | `/pricing`, `/data-deletion`, `/terms` | `/pricing` first after adding the pricing prior to teams intent |

The pre-fix failure was not a reversed cosine score. The cosine ordering and tenant filters are correct. The failure was semantic: lexical candidates had saturated evidence scores, source types were too coarse, and intent filtering was missing for several questions.

## Phase 6–11: answer safety and citation quality

The new answerability gate is separate from “there was a matching word.” It filters source types first, uses content coverage as the evidence signal, and applies stricter thresholds for pricing, location, permissions, privacy, and general questions. Unsupported intent always abstains. This prevents a pricing question from becoming an answer about reminders merely because both pages contain “PlanCraftAI.”

The synthesis prompt now explicitly forbids raw headings, navigation, calls to action, scraped snippets, unsupported claims, and adjacent citations. If synthesis or grounding verification fails while an LLM is configured, the answer path abstains; it does not mark an extractive fallback as grounded.

Remaining limitation: citations are still selected at source/chunk level after reranking. The grounding checker validates the generated answer against the combined context, not each citation independently. A stronger future version should emit claim-to-chunk evidence IDs and validate each cited source against at least one claim.

## Golden evaluation set

The repository now contains `apps/api/test/fixtures/plancraftai-golden.json` with 40 reusable cases across product/services, reminders, voice, calendar, daily planning, teams/workspaces, permissions/privacy, pricing, contact/support, and unsupported/gap questions. `apps/api/test/plancraftai-golden.test.ts` validates its size, uniqueness, category coverage, and deterministic intent labels.

## Required semantic validation status

The eight required questions were run against the live tenant for full-text and final reranked behavior. The vector column contained zero eligible current-model embeddings, so every vector top-10 was empty and every “hybrid” result was actually `postgres_full_text`. A true vector top-10 table with similarity, source, heading path, and preview cannot be honestly produced until the key is repaired and the new corpus is embedded.

The required four-way comparison is therefore recorded as:

| Query | Full text | Vector | Hybrid before rerank | Final rerank |
|---|---|---|---|---|
| Services | Available | Blocked: 0 vectors | Collapsed to full text | Product/features pages after source filtering |
| Pricing | Available | Blocked: 0 vectors | Collapsed to full text | `/pricing` first after pricing vocabulary/prior |
| Permissions | Available | Blocked: 0 vectors | Collapsed to full text | Privacy/terms evidence; product/voice excluded |
| Reminders | Available | Blocked: 0 vectors | Collapsed to full text | Reminder/product pages |
| Calendars | Available | Blocked: 0 vectors | Collapsed to full text | Google Calendar/product pages |
| Contact | Available | Blocked: 0 vectors | Collapsed to full text | `/contact` after contact typing/filtering |
| Voice tasks | Available | Blocked: 0 vectors | Collapsed to full text | Voice/product pages |
| Teams | Available | Blocked: 0 vectors | Collapsed to full text | `/pricing` and product pages |

The current reranker keeps retrieval/evidence as the dominant signals and uses source type as a calibrated prior. Independent semantic ranking has not yet been validated; it must be tested after embeddings exist rather than inferred from the improved lexical results.

## Golden evaluation and before/after metrics

The 40-case golden fixture and deterministic intent tests pass. A valid production A/B evaluation is not yet complete because the repaired hybrid baseline does not exist. Current measurable baselines are:

| Metric | Original live state | Repaired state |
|---|---:|---:|
| Embedding coverage | 0 / 157 (0%) | Not run; blocked by `invalid_api_key` |
| Vector retrieval used | 0% | Not run |
| Full-text-only fallback | 100% for the live query smoke test | Not run |
| Retrieval Recall@3 / Recall@5 | Not measured as a valid semantic baseline | Not run |
| Answer correctness/relevance | Not scored with a stable labeled run | Not run |
| Citation correctness | Not scored with claim-level labels | Not run |
| Fallback accuracy/hallucination count | Not scored across the full set | Not run |
| Latency | Not captured in the original audit run | Instrumented for future runs |

The code now records the required operational counters and emits the provider/configuration state. The remaining evaluation must retain retrieved evidence and final answers so failures can be labeled separately as `RETRIEVAL_FAILURE` or `SYNTHESIS_FAILURE`.

## Proven knowledge gaps

- No authoritative business hours were found.
- No authoritative physical address/location details were found.
- No authoritative booking/appointment workflow or booking URL was found.
- Permissions and access-control information exists only indirectly in privacy/terms and product/pricing language; there is no dedicated permissions page.
- Phone support was not found; contact form, email, website, and LinkedIn references were found.
- Pricing, reminders, calendar integration, voice task capture, daily planning, teams/workspaces, and core product capabilities are covered by current sources.

The assistant should continue to abstain for unsupported gaps instead of treating adjacent product or reminder content as evidence.

## Recommended operational sequence

1. Replace/rotate the invalid Render-managed `OPENAI_API_KEY`; the direct provider response is `invalid_api_key`.
2. Confirm the deployed startup probe reports provider `healthy` and model/dimensions match.
3. Re-crawl the primary `plancraftai` tenant so the new extractor/chunker replaces the old 157-chunk corpus.
4. Re-enqueue embeddings and verify `embedded_chunks = total_chunks`, model `text-embedding-3-small`, and dimensions 1,536. Do not mark semantic readiness healthy until this is true.
5. Run pure vector top-10 tests, then capture full-text, vector, pre-rerank hybrid, and final-rerank results for all eight required questions.
6. Run the golden set through both retrieval-only and full-answer evaluation. Do not treat a high grounded rate as success unless relevance and citation-quality scores also pass.
7. Add authoritative pages for office hours/location/booking if those questions should be answered; otherwise keep the current fallback behavior.

## Production verdict

`NOT READY`.

The embedding provider is rejecting the configured credential, the live tenant has 0/157 eligible embeddings, and the required independent vector and hybrid evaluations have not yet passed. The system may continue operating in explicitly labeled `degraded_full_text` mode with conservative abstention, but it is not semantically production-ready.
