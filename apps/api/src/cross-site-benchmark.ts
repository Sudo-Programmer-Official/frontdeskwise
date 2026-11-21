import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { classifyQuestionIntent, citationMatches, answerabilityDecision, rankMatches, type RankableMatch, type RetrievalIntent, type RetrievalSource } from "./retrieval.js";
import { CrawlError, crawlWebsite, type CrawlChunk, type CrawledPage } from "./crawler.js";
import { classifyPage } from "./page-classification.js";
import { createRenderedPageAdapter } from "./rendered-crawler.js";
import { embedTexts } from "./embeddings.js";
import { classifyVisitorRequest, defaultActionFlows, detectAction, type ActionFlow } from "./action-flows.js";
import { generateGroundedAnswer, hasDirectSensitiveEvidence, llmConfigured, routeQuestion, verifyGroundedAnswer } from "./model-routing.js";

type ExpectedMode = "informational" | "transactional";

type GoldenQuestion = {
  question: string;
  expectedMode: ExpectedMode;
  expectedActionType?: string;
  expectedFallback?: boolean;
};

type BenchmarkSite = {
  id: string;
  url: string;
  archetypes: string[];
  questions: GoldenQuestion[];
};

type BenchmarkChunk = CrawlChunk & { id: string; sourceId: string; vector?: number[] };

const sites: BenchmarkSite[] = [
  {
    id: "british-swim-school-tampa-bay",
    url: "https://britishswimschool.com/tampa-bay/",
    archetypes: ["local service", "enrollment/program-based", "multi-location"],
    questions: [
      { question: "What is British Swim School Tampa Bay?", expectedMode: "informational" },
      { question: "What swim programs do you offer?", expectedMode: "informational" },
      { question: "What swim levels or ages do you support?", expectedMode: "informational" },
      { question: "How much do swim lessons cost?", expectedMode: "informational" },
      { question: "What are the class schedules?", expectedMode: "informational" },
      { question: "Where are your Tampa Bay locations?", expectedMode: "informational" },
      { question: "How can I contact British Swim School Tampa Bay?", expectedMode: "informational" },
      { question: "How does enrollment work?", expectedMode: "informational" },
      { question: "Sign my child up.", expectedMode: "transactional", expectedActionType: "enroll" },
      { question: "Do you share my personal data?", expectedMode: "informational", expectedFallback: true },
      { question: "What happens if we miss a lesson?", expectedMode: "informational" },
      { question: "Can you tell me about private lessons?", expectedMode: "informational" },
    ],
  },
  {
    id: "daycarespots",
    url: "https://www.daycarespots.com/",
    archetypes: ["marketplace", "local service", "enrollment/program-based"],
    questions: [
      { question: "What is DaycareSpots?", expectedMode: "informational" },
      { question: "How do I find a daycare with open spots?", expectedMode: "informational" },
      { question: "Do you show daycare pricing?", expectedMode: "informational" },
      { question: "What are daycare hours?", expectedMode: "informational" },
      { question: "Where do you have daycare providers?", expectedMode: "informational" },
      { question: "How does requesting a tour work?", expectedMode: "informational" },
      { question: "Schedule a tour.", expectedMode: "transactional", expectedActionType: "external_booking" },
      { question: "How do I contact a provider?", expectedMode: "informational" },
      { question: "Join the waitlist.", expectedMode: "transactional", expectedActionType: "join_waitlist" },
      { question: "Do you diagnose developmental conditions?", expectedMode: "informational", expectedFallback: true },
      { question: "Do you share parent information?", expectedMode: "informational", expectedFallback: true },
      { question: "What does a provider account do?", expectedMode: "informational" },
    ],
  },
  {
    id: "munchkin-town-usa",
    url: "https://www.munchkintownusa.com/",
    archetypes: ["local service", "appointment-based", "transactional"],
    questions: [
      { question: "What is Munchkin Town?", expectedMode: "informational" },
      { question: "What is included in open play?", expectedMode: "informational" },
      { question: "How do birthday parties work?", expectedMode: "informational" },
      { question: "Do you offer memberships?", expectedMode: "informational" },
      { question: "What are your hours?", expectedMode: "informational" },
      { question: "Where are you located?", expectedMode: "informational" },
      { question: "How much does open play cost?", expectedMode: "informational" },
      { question: "Do I need a waiver?", expectedMode: "informational" },
      { question: "Book a birthday party.", expectedMode: "transactional", expectedActionType: "external_booking" },
      { question: "Can I book open play?", expectedMode: "informational" },
      { question: "Do you provide medical treatment for children?", expectedMode: "informational", expectedFallback: true },
      { question: "How can I contact Munchkin Town?", expectedMode: "informational" },
    ],
  },
  {
    id: "bay-breeze-air",
    url: "https://www.baybreezeair.com/",
    archetypes: ["local service", "emergency/high-intent", "appointment-based"],
    questions: [
      { question: "What services does Bay Breeze Air provide?", expectedMode: "informational" },
      { question: "Do you repair air conditioners?", expectedMode: "informational" },
      { question: "Do you replace AC systems?", expectedMode: "informational" },
      { question: "Do you offer maintenance?", expectedMode: "informational" },
      { question: "What areas do you serve?", expectedMode: "informational" },
      { question: "Do you offer emergency HVAC service?", expectedMode: "informational" },
      { question: "What are your business hours?", expectedMode: "informational" },
      { question: "How can I contact Bay Breeze Air?", expectedMode: "informational" },
      { question: "Schedule service.", expectedMode: "transactional", expectedActionType: "schedule_service" },
      { question: "I need emergency AC repair now.", expectedMode: "transactional", expectedActionType: "call_emergency" },
      { question: "How much will my repair cost?", expectedMode: "informational" },
      { question: "Do you process credit cards?", expectedMode: "informational", expectedFallback: true },
    ],
  },
  {
    id: "mtv-nails-salonflow",
    url: "https://mtvnails.salonflow.studio/",
    archetypes: ["SaaS/product", "appointment-based", "local service"],
    questions: [
      { question: "What is SalonFlow?", expectedMode: "informational" },
      { question: "What features does SalonFlow offer?", expectedMode: "informational" },
      { question: "How can SalonFlow help my salon?", expectedMode: "informational" },
      { question: "Does SalonFlow support appointments?", expectedMode: "informational" },
      { question: "How does booking work?", expectedMode: "informational" },
      { question: "Does it manage customers?", expectedMode: "informational" },
      { question: "Does it support QR check-in?", expectedMode: "informational" },
      { question: "Does it have reminders?", expectedMode: "informational" },
      { question: "Does it support reviews or loyalty?", expectedMode: "informational" },
      { question: "What does SalonFlow cost?", expectedMode: "informational", expectedFallback: true },
      { question: "I want a demo.", expectedMode: "transactional", expectedActionType: "request_demo" },
      { question: "How can I contact SalonFlow?", expectedMode: "informational" },
    ],
  },
  {
    id: "dental-walk-in",
    url: "https://dentalwalkin.com/",
    archetypes: ["healthcare", "emergency/high-intent", "appointment-based", "local service"],
    questions: [
      { question: "What services does Dental Walk-In provide?", expectedMode: "informational" },
      { question: "Do you provide emergency dental care?", expectedMode: "informational" },
      { question: "How do appointments work?", expectedMode: "informational" },
      { question: "What are your office hours?", expectedMode: "informational" },
      { question: "Where is Dental Walk-In located?", expectedMode: "informational" },
      { question: "What dental procedures do you offer?", expectedMode: "informational" },
      { question: "How much does a visit cost?", expectedMode: "informational", expectedFallback: true },
      { question: "How can I contact Dental Walk-In?", expectedMode: "informational" },
      { question: "Schedule an appointment.", expectedMode: "transactional", expectedActionType: "book_appointment" },
      { question: "I need an emergency dentist now.", expectedMode: "transactional", expectedActionType: "call_emergency" },
      { question: "What treatment do I need for my tooth pain?", expectedMode: "informational", expectedFallback: true },
      { question: "Do you share patient information?", expectedMode: "informational", expectedFallback: true },
    ],
  },
];

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 2))];
}

function cosine(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0;
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] ** 2;
    rightNorm += right[index] ** 2;
  }
  return leftNorm && rightNorm ? Math.max(0, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm))) : 0;
}

function sourceId(site: BenchmarkSite, page: CrawledPage): string {
  return `${site.id}:${page.canonicalUrl}`;
}

function sourceRecords(site: BenchmarkSite, pages: CrawledPage[]): RetrievalSource[] {
  return pages.map((page) => ({ id: sourceId(site, page), url: page.canonicalUrl, title: page.title || page.canonicalUrl, pageType: page.pageType }));
}

function chunkRecords(site: BenchmarkSite, pages: CrawledPage[]): BenchmarkChunk[] {
  return pages.flatMap((page) => page.chunks.map((chunk, index) => ({ ...chunk, id: `${sourceId(site, page)}:${index}`, sourceId: sourceId(site, page) })));
}

function buildMatches(chunks: BenchmarkChunk[], question: string, queryVector: number[] | null): Array<RankableMatch<BenchmarkChunk>> {
  const queryTokens = tokens(question);
  return chunks.map((chunk) => {
    const lower = chunk.content.toLowerCase();
    const lexical = queryTokens.length ? queryTokens.filter((token) => lower.includes(token)).length / queryTokens.length : 0;
    const vector = queryVector && chunk.vector ? cosine(queryVector, chunk.vector) : null;
    const score = lexical * 0.72 + (vector ?? 0) * 0.28;
    const evidenceScore = Math.max(lexical, vector ?? 0);
    return { chunk, score, evidenceScore, lexicalScore: lexical, vectorScore: vector };
  }).filter((match) => match.score > 0 || match.evidenceScore > 0);
}

function expectedAction(actions: ActionFlow[], question: GoldenQuestion): ActionFlow | null {
  if (question.expectedMode !== "transactional") return null;
  return detectAction(actions, question.question);
}

async function embedInBatches(chunks: BenchmarkChunk[]): Promise<number> {
  let embedded = 0;
  for (let start = 0; start < chunks.length; start += 64) {
    const batch = chunks.slice(start, start + 64);
    const vectors = await embedTexts(batch.map((chunk) => chunk.content));
    if (!vectors) return embedded;
    vectors.forEach((vector, index) => {
      batch[index].vector = vector;
      embedded += 1;
    });
  }
  return embedded;
}

async function queryVectors(questions: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  for (let start = 0; start < questions.length; start += 64) {
    const batch = questions.slice(start, start + 64);
    const vectors = await embedTexts(batch);
    if (!vectors) break;
    vectors.forEach((vector, index) => result.set(batch[index], vector));
  }
  return result;
}

async function answerQuestion(
  question: GoldenQuestion,
  chunks: BenchmarkChunk[],
  sources: RetrievalSource[],
  actions: ActionFlow[],
  queryVector: number[] | null,
): Promise<Record<string, unknown>> {
  const startedAt = performance.now();
  const classification = classifyVisitorRequest(question.question);
  const intent = classifyQuestionIntent(question.question);
  const matches = rankMatches(buildMatches(chunks, question.question, queryVector), sources, intent, 8);
  const answerability = answerabilityDecision(matches, sources, intent);
  const topEvidence = matches.slice(0, 3).map((match) => ({ sourceId: match.chunk.sourceId, score: Number(match.score.toFixed(4)), evidenceScore: Number(match.evidenceScore.toFixed(4)), excerpt: match.chunk.content.slice(0, 280) }));
  const selectedAction = expectedAction(actions, question);
  const expectedTransactionalAction = question.expectedMode === "transactional";
  const actionCorrect = expectedTransactionalAction
    ? Boolean(selectedAction && (!question.expectedActionType || selectedAction.actionType === question.expectedActionType))
    : !selectedAction;
  const decision = routeQuestion({ question: question.question, hasMatch: answerability.answerable, confidenceScore: answerability.score, candidateCount: matches.length });
  const context = matches.slice(0, 4).map((match) => {
    const source = sources.find((item) => item.id === match.chunk.sourceId);
    return `[${source?.title ?? "Business source"}] ${match.chunk.content.slice(0, 1_200)}`;
  }).join("\n\n");
  const safetyBlocked = /\b(diagnos(?:e|is|tic)|treatment|symptom|medical advice|what do i need for)\b/i.test(question.question)
    || !hasDirectSensitiveEvidence(question.question, context);
  const generationAllowed = answerability.answerable && !safetyBlocked;
  let answer = answerability.answerable && matches[0] ? matches[0].chunk.content.slice(0, 420) : "I couldn't verify that from the website knowledge available.";
  let generated = false;
  let grounded = false;
  let fallbackReason: string | null = generationAllowed ? "model_not_run" : safetyBlocked ? "insufficient_sensitive_or_safety_evidence" : answerability.reason;
  if (generationAllowed && decision.model) {
    try {
      const generation = await generateGroundedAnswer({ question: question.question, context, decision, intent });
      if (generation) {
        const verification = await verifyGroundedAnswer({ question: question.question, answer: generation.answer, context });
        generated = true;
        grounded = verification.grounded;
        if (grounded) {
          answer = generation.answer;
          fallbackReason = null;
        } else {
          fallbackReason = "grounding_check_rejected";
        }
      } else {
        fallbackReason = "model_returned_no_answer";
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message.slice(0, 160) : "model_error";
    }
  } else if (!llmConfigured()) {
    fallbackReason = answerability.answerable ? "benchmark_llm_not_configured" : answerability.reason;
  }
  const citations = citationMatches(matches, sources, intent, 2).map((match) => sources.find((source) => source.id === match.chunk.sourceId)).filter((source): source is RetrievalSource => Boolean(source));
  const citationCorrect = citations.length > 0 && citations.every((citation) => matches.slice(0, 4).some((match) => match.chunk.sourceId === citation.id && match.evidenceScore >= 0.25));
  const fallbackCorrect = question.expectedFallback === undefined ? true : (question.expectedFallback ? !grounded : grounded);
  const retrievalRelevant = answerability.answerable && (matches[0]?.evidenceScore ?? 0) >= 0.25;
  const answerQualityCorrect = question.expectedFallback ? !grounded : grounded;
  const pass = retrievalRelevant && answerQualityCorrect && citationCorrect && actionCorrect && fallbackCorrect;
  return {
    question: question.question,
    expectedMode: question.expectedMode,
    classification,
    intent,
    topEvidence,
    grounding: grounded,
    retrievalRelevant,
    citationCorrect,
    citations: citations.map((citation) => ({ title: citation.title, url: citation.url })),
    selectedAction: selectedAction ? { actionType: selectedAction.actionType, name: selectedAction.name, destination: selectedAction.destination, confidence: selectedAction.confidence } : null,
    actionCorrect,
    fallbackCorrect,
    answer,
    fallbackReason,
    latencyMs: Number((performance.now() - startedAt).toFixed(1)),
    pass,
  };
}

async function main(): Promise<void> {
  const benchmarkKey = process.env.FRONTDESKWISE_BENCHMARK_OPENAI_API_KEY?.trim();
  const originalApiKey = process.env.OPENAI_API_KEY;
  if (benchmarkKey) process.env.OPENAI_API_KEY = benchmarkKey;
  else delete process.env.OPENAI_API_KEY;
  const startedAt = Date.now();
  const renderAdapter = createRenderedPageAdapter();
  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    isolated: true,
    productionDatabaseTouched: false,
    embeddingCredentialConfigured: Boolean(benchmarkKey),
    llmCredentialConfigured: Boolean(benchmarkKey),
    sites: [],
  };
  try {
    const allSiteReports: Record<string, unknown>[] = [];
    for (const site of sites) {
      const crawlStartedAt = Date.now();
      let crawl: Awaited<ReturnType<typeof crawlWebsite>> | null = null;
      let audit: Awaited<ReturnType<typeof crawlWebsite>>["audit"] | null = null;
      let error: string | null = null;
      try {
        crawl = await crawlWebsite(site.url, { renderPage: renderAdapter });
        audit = crawl.audit;
      } catch (crawlError) {
        error = crawlError instanceof Error ? crawlError.message : "crawl_failed";
        audit = crawlError instanceof CrawlError ? crawlError.audit ?? null : null;
      }
      const pages = crawl?.pages ?? [];
      const sources = sourceRecords(site, pages);
      const chunks = chunkRecords(site, pages);
      let embeddedChunks = 0;
      if (benchmarkKey && chunks.length) {
        try { embeddedChunks = await embedInBatches(chunks); } catch (embeddingError) { error = embeddingError instanceof Error ? embeddingError.message : "embedding_failed"; }
      }
      const websiteText = chunks.map((chunk) => chunk.content).join(" ");
      const actions = defaultActionFlows(site.id, websiteText, (key) => `${site.id}:${key}`, pages.flatMap((page) => page.actionCandidates ?? []));
      // The benchmark represents the post-review runtime path. Discovery is
      // still recorded below, but visitor-action assertions run only after the
      // operator explicitly approves the discovered candidates.
      for (const action of actions) {
        if (action.origin === "discovered") {
          action.enabled = true;
          action.lifecycleStatus = "approved";
        }
      }
      const questions = site.questions.map((item) => item.question);
      const queryVectorMap = benchmarkKey ? await queryVectors(questions) : new Map<string, number[]>();
      const questionReports: Record<string, unknown>[] = [];
      for (const question of site.questions) questionReports.push(await answerQuestion(question, chunks, sources, actions, queryVectorMap.get(question.question) ?? null));
      const passed = questionReports.filter((item) => item.pass === true).length;
      const renderRoutes = audit?.routes.filter((route) => route.renderAttempted) ?? [];
      const highValueDiscovered = audit?.routeUrls.filter((url) => classifyPage(url) !== "other" && classifyPage(url) !== "blog" && classifyPage(url) !== "cart" && classifyPage(url) !== "checkout" && classifyPage(url) !== "account").length ?? 0;
      const highValueIndexed = pages.filter((page) => !["other", "blog", "cart", "checkout", "account"].includes(page.pageType)).length;
      allSiteReports.push({
        id: site.id,
        url: site.url,
        archetypes: site.archetypes,
        durationMs: Date.now() - crawlStartedAt,
        crawl: {
          frameworkOrSiteType: pages.some((page) => page.crawlMode === "rendered") ? "client-rendered/mixed" : "static-or-server-rendered",
          robots: audit?.robots ?? null,
          sitemap: audit?.sitemap ?? null,
          pagesDiscovered: audit?.routeUrls.length ?? 0,
          internalLinksDiscovered: audit?.discoveredInternalLinks.length ?? 0,
          pagesIndexed: pages.length,
          renderedFallbackCount: pages.filter((page) => page.crawlMode === "rendered").length,
          extractedCharacters: pages.reduce((total, page) => total + (page.extractedCharacterCount ?? 0), 0),
          chunks: chunks.length,
          embeddedChunks,
          failedOrRejectedPages: audit?.rejectedInternalLinks.length ?? 0,
          rejectionReasons: audit?.rejectionReasons ?? {},
          renderDiagnostics: renderRoutes.map((route) => route.renderDiagnostics).filter(Boolean),
          crawlModeCounts: pages.reduce<Record<string, number>>((counts, page) => { counts[page.crawlMode ?? "static"] = (counts[page.crawlMode ?? "static"] ?? 0) + 1; return counts; }, {}),
          highValuePageCoverage: highValueDiscovered ? Number((Math.min(1, highValueIndexed / highValueDiscovered)).toFixed(4)) : 0,
          routes: (audit?.routes ?? []).map((route) => ({
            requestedUrl: route.requestedUrl,
            finalUrl: route.finalUrl,
            status: route.status,
            crawlMode: route.crawlMode,
            renderAttempted: route.renderAttempted,
            renderSuccess: route.renderSuccess,
            renderDurationMs: route.renderDurationMs,
            extractedCharacters: route.extractedCharacters,
            discoveredLinks: route.discoveredLinks.length,
            chunks: route.chunks,
            accepted: route.accepted,
            rejectionReason: route.rejectionReason,
            renderDiagnostics: route.renderDiagnostics ?? null,
          })),
        },
        actions: {
          discovered: actions.filter((action) => action.origin === "discovered").length,
          active: actions.filter((action) => action.enabled).map((action) => ({ actionType: action.actionType, name: action.name, destination: action.destination, provider: action.provider, confidence: action.confidence, sourceUrl: action.sourceUrl, origin: action.origin, lifecycleStatus: action.lifecycleStatus })),
        },
        questions: questionReports,
        score: { passed, total: questionReports.length, passRate: questionReports.length ? Number((passed / questionReports.length).toFixed(4)) : 0 },
        error,
      });
    }
    const questions = allSiteReports.flatMap((site) => Array.isArray(site.questions) ? site.questions as Record<string, unknown>[] : []);
    const highValueCoverage = allSiteReports
      .map((site) => (site.crawl as Record<string, unknown> | undefined)?.highValuePageCoverage)
      .filter((value): value is number => typeof value === "number");
    const metric = (key: string): number => questions.length ? Number((questions.filter((question) => question[key] === true).length / questions.length).toFixed(4)) : 0;
    report.sites = allSiteReports;
    report.summary = {
      totalQuestions: questions.length,
      expectedQuestions: 72,
      crawlDurationMs: Date.now() - startedAt,
      crawlerHighValuePageCoverage: highValueCoverage.length ? Number((highValueCoverage.reduce((total, value) => total + value, 0) / highValueCoverage.length).toFixed(4)) : 0,
      top3RetrievalRelevance: metric("retrievalRelevant"),
      groundedCorrectness: metric("grounding"),
      citationCorrectness: metric("citationCorrect"),
      fallbackCorrectness: metric("fallbackCorrect"),
      actionRoutingCorrectness: metric("actionCorrect"),
      criticalHallucinations: questions.filter((question) => question.grounding === false && question.expectedFallback !== true && question.answer && question.fallbackReason === null).length,
    };
  } finally {
    await renderAdapter.close();
    if (originalApiKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalApiKey;
  }
  const outputDirectory = join(process.cwd(), "benchmark-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `cross-site-certification-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, summary: report.summary }, null, 2));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
