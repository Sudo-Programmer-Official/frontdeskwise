import type { CrawlCoverage, CrawlRunDiagnostics } from "./crawler.js";

export const ONBOARDING_FAILURE_CODES = [
  "DOMAIN_NOT_FOUND",
  "DNS_FAILURE",
  "SSL_FAILURE",
  "TIMEOUT",
  "ROBOTS_BLOCKED",
  "AUTH_REQUIRED",
  "SPA_RENDER_FAILURE",
  "NO_USEFUL_CONTENT",
  "WRONG_BUSINESS_DETECTED",
  "CRAWL_PARTIAL",
  "HTTP_ERROR",
  "INVALID_URL",
  "CRAWL_ERROR",
] as const;

export type OnboardingFailureCode = typeof ONBOARDING_FAILURE_CODES[number];
export type OnboardingValidationStatus = "valid" | "needs_attention";

export type OnboardingValidation = {
  status: OnboardingValidationStatus;
  code: OnboardingFailureCode | null;
  reachable: boolean;
  knowledgeReady: boolean;
  readinessScore: number;
  expectedBusinessName: string | null;
  detectedBusinessName: string | null;
  message: string;
  suggestedAction: string;
  signals: string[];
  crawlCoverage?: CrawlCoverage;
  crawlRun?: CrawlRunDiagnostics;
  checkedAt: string;
};

type ValidationPage = {
  title?: string | null;
  content?: string | null;
  extractedCharacterCount?: number | null;
  pageType?: string | null;
};

const genericBusinessWords = new Set([
  "the", "and", "for", "with", "business", "company", "co", "inc", "llc", "ltd", "corp", "corporation",
  "home", "welcome", "official", "website", "site", "services", "service", "online",
]);

function normalized(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&[a-z0-9#]+;/gi, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningfulTokens(value: unknown): string[] {
  return [...new Set(normalized(value).split(" ").filter((token) => token.length >= 3 && !genericBusinessWords.has(token)))];
}

function titleBusinessName(title: string | null | undefined): string | null {
  const value = String(title ?? "").trim();
  if (!value || /^(home|welcome|index|untitled)$/i.test(value)) return null;
  return value.split(/\s+[|–—-]\s+/)[0].trim().slice(0, 160) || null;
}

function failureCopy(code: OnboardingFailureCode): Pick<OnboardingValidation, "message" | "suggestedAction"> {
  switch (code) {
    case "DOMAIN_NOT_FOUND": return { message: "We couldn't find that domain.", suggestedAction: "Check the spelling or try the www version of the URL." };
    case "DNS_FAILURE": return { message: "We couldn't resolve that domain.", suggestedAction: "Check the domain's DNS settings or try again in a few minutes." };
    case "SSL_FAILURE": return { message: "We couldn't establish a secure connection to this website.", suggestedAction: "Check the site's SSL certificate, then try again." };
    case "TIMEOUT": return { message: "The website took too long to respond.", suggestedAction: "Check that the site is publicly accessible, then try again." };
    case "ROBOTS_BLOCKED": return { message: "This website does not allow our crawler to read its pages.", suggestedAction: "Allow FrontDeskWise in robots.txt or add another public source." };
    case "AUTH_REQUIRED": return { message: "This website requires a login before we can read it.", suggestedAction: "Use a public page or add another page or document." };
    case "SPA_RENDER_FAILURE": return { message: "We found the website, but its content could not be rendered.", suggestedAction: "Try again or add another public page or document." };
    case "NO_USEFUL_CONTENT": return { message: "We found your website, but couldn't identify enough business information yet.", suggestedAction: "Add another page, upload documents, or continue manually." };
    case "WRONG_BUSINESS_DETECTED": return { message: "This website appears to belong to a different business.", suggestedAction: "Confirm the domain before continuing." };
    case "CRAWL_PARTIAL": return { message: "We found useful information, but some website pages could not be read.", suggestedAction: "Review the source list or add another public page." };
    case "HTTP_ERROR": return { message: "The website returned an error when we tried to read it.", suggestedAction: "Check that the URL is correct and publicly accessible, then try again." };
    case "INVALID_URL": return { message: "That website address is not valid.", suggestedAction: "Enter a domain such as example.com or a full https:// URL." };
    default: return { message: "We couldn't read this website yet.", suggestedAction: "Check the URL and try again, or add another source." };
  }
}

/**
 * Coverage is authoritative for multi-page website readiness. Keep this
 * check tolerant of older JSON snapshots that did not persist eligibleUrls or
 * additionalPagesDetected; the persisted counters still prove whether the
 * crawl is incomplete.
 */
export function crawlCoverageNeedsAttention(coverage?: CrawlCoverage | null): boolean {
  if (!coverage) return false;
  const discoveredUrls = Math.max(0, Number(coverage.discoveredUrls ?? 0));
  const skippedUrls = Math.max(0, Number(coverage.skippedUrls ?? 0));
  const eligibleUrls = Math.max(1, Number(coverage.eligibleUrls ?? Math.max(1, discoveredUrls - skippedUrls)));
  const attemptedUrls = Math.max(0, Number(coverage.attemptedUrls ?? 0));
  const successfulPages = Math.max(0, Number(coverage.successfulPages ?? 0));
  const unprocessedUrls = Math.max(0, Number(coverage.unprocessedUrls ?? 0));
  const failedUrls = Math.max(0, Number(coverage.failedUrls ?? 0));
  return unprocessedUrls > 0
    || failedUrls > 0
    || (eligibleUrls > 1 && (attemptedUrls < eligibleUrls || successfulPages < eligibleUrls))
    || (discoveredUrls > 1 && successfulPages + skippedUrls < discoveredUrls);
}

export function validationFromFailure(input: {
  code: OnboardingFailureCode;
  reachable?: boolean;
  expectedBusinessName?: string | null;
  signals?: string[];
  crawlCoverage?: CrawlCoverage;
  crawlRun?: CrawlRunDiagnostics;
  checkedAt?: string;
}): OnboardingValidation {
  const copy = failureCopy(input.code);
  return {
    status: "needs_attention",
    code: input.code,
    reachable: input.reachable ?? false,
    knowledgeReady: false,
    readinessScore: 0,
    expectedBusinessName: input.expectedBusinessName?.trim() || null,
    detectedBusinessName: null,
    message: copy.message,
    suggestedAction: copy.suggestedAction,
    signals: [...new Set((input.signals ?? []).filter(Boolean))].slice(0, 12),
    ...(input.crawlCoverage ? { crawlCoverage: input.crawlCoverage } : {}),
    ...(input.crawlRun ? { crawlRun: input.crawlRun } : {}),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export function assessOnboardingKnowledge(input: {
  pages: ValidationPage[];
  expectedBusinessName?: string | null;
  crawlPartial?: boolean;
  crawlCoverage?: CrawlCoverage;
  crawlRun?: CrawlRunDiagnostics;
  checkedAt?: string;
}): OnboardingValidation {
  const pages = input.pages ?? [];
  const expectedBusinessName = input.expectedBusinessName?.trim() || null;
  const title = titleBusinessName(pages.find((page) => page.title)?.title);
  const text = pages.map((page) => `${page.title ?? ""} ${page.content ?? ""}`).join(" ");
  const visibleCharacters = pages.reduce((total, page) => total + Math.max(0, Number(page.extractedCharacterCount ?? String(page.content ?? "").length)), 0);
  const content = normalized(text);
  const usefulSignals = [
    /\b(service|services|program|programs|treatment|repair|lesson|class|product|products|offer|offers)\b/.test(content),
    /\b(price|pricing|cost|fee|fees|rate|rates|quote|estimate|tuition)\b/.test(content),
    /\b(location|locations|address|area|areas|visit|directions|hours|open|closed)\b/.test(content),
    /\b(faq|frequently asked|question|contact|call|email|schedule|appointment|book)\b/.test(content),
  ].filter(Boolean).length;
  const usefulContent = pages.length > 0 && visibleCharacters >= 180 && (usefulSignals > 0 || visibleCharacters >= 420);
  const coverage = input.crawlCoverage;
  const coveragePartial = crawlCoverageNeedsAttention(coverage);
  const expectedTokens = meaningfulTokens(expectedBusinessName);
  const contentTokens = new Set(meaningfulTokens(`${pages.slice(0, 3).map((page) => page.title ?? "").join(" ")} ${text.slice(0, 5_000)}`));
  const matchedExpectedTokens = expectedTokens.filter((token) => contentTokens.has(token));
  const mismatch = Boolean(expectedTokens.length >= 2 && matchedExpectedTokens.length === 0 && title);
  const code: OnboardingFailureCode | null = mismatch
    ? "WRONG_BUSINESS_DETECTED"
    : !usefulContent
      ? "NO_USEFUL_CONTENT"
      : input.crawlPartial || coveragePartial
        ? "CRAWL_PARTIAL"
        : null;
  const needsAttention = code === "WRONG_BUSINESS_DETECTED" || code === "NO_USEFUL_CONTENT" || code === "CRAWL_PARTIAL";
  const baseScore = Math.max(0, Math.min(100,
    (pages.length > 0 ? 25 : 0)
    + Math.min(35, Math.round(visibleCharacters / 35))
    + usefulSignals * 8
    + (mismatch ? 0 : expectedTokens.length === 0 || matchedExpectedTokens.length > 0 ? 16 : 5),
  ));
  const coveragePercent = coverage
    ? Math.round(
        Math.max(0, Math.min(100, Number(coverage.successfulPages ?? 0)))
        / Math.max(1, Number(coverage.eligibleUrls ?? coverage.discoveredUrls ?? 1))
        * 100,
      )
    : 100;
  const score = coveragePartial && coverage ? Math.min(baseScore, Math.round(baseScore * coveragePercent / 100)) : baseScore;
  if (code && needsAttention) {
    const failure = validationFromFailure({ code, reachable: pages.length > 0, expectedBusinessName, crawlCoverage: coverage, crawlRun: input.crawlRun, checkedAt: input.checkedAt });
    return {
      ...failure,
      knowledgeReady: false,
      readinessScore: score,
      detectedBusinessName: title,
      signals: [
        `pages:${pages.length}`,
        `visible_characters:${visibleCharacters}`,
        `business_signals:${usefulSignals}`,
        ...(coverage ? [
          `discovered_urls:${coverage.discoveredUrls}`,
          `attempted_urls:${coverage.attemptedUrls}`,
          `successful_pages:${coverage.successfulPages}`,
          `coverage_percent:${coverage.coveragePercent}`,
        ] : []),
        ...(expectedTokens.length ? [`business_name_tokens_matched:${matchedExpectedTokens.length}/${expectedTokens.length}`] : []),
      ],
    };
  }
  return {
    status: "valid",
    code,
    reachable: true,
    knowledgeReady: true,
    readinessScore: score,
    expectedBusinessName,
    detectedBusinessName: title,
    message: code === "CRAWL_PARTIAL" ? failureCopy(code).message : "Website validated and business information is ready to review.",
    suggestedAction: code === "CRAWL_PARTIAL" ? failureCopy(code).suggestedAction : "Review the Business Brain before publishing.",
    signals: [
      `pages:${pages.length}`,
      `visible_characters:${visibleCharacters}`,
      `business_signals:${usefulSignals}`,
      ...(coverage ? [
        `discovered_urls:${coverage.discoveredUrls}`,
        `attempted_urls:${coverage.attemptedUrls}`,
        `successful_pages:${coverage.successfulPages}`,
        `coverage_percent:${coverage.coveragePercent}`,
      ] : []),
      ...(expectedTokens.length ? [`business_name_tokens_matched:${matchedExpectedTokens.length}/${expectedTokens.length}`] : []),
    ],
    ...(coverage ? { crawlCoverage: coverage } : {}),
    ...(input.crawlRun ? { crawlRun: input.crawlRun } : {}),
    checkedAt: input.checkedAt ?? new Date().toISOString(),
  };
}

export type KnowledgeReadinessInput = {
  sourceCount: number;
  chunkCount: number;
  meaningfulChunkCount: number;
  semanticHealthy: boolean;
  gapCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  contentQualityIssue: boolean;
  crawlCoverage?: CrawlCoverage | null;
  onboarding: Pick<OnboardingValidation, "status" | "knowledgeReady" | "readinessScore">;
};

export type KnowledgeReadinessSnapshot = {
  calculatedScore: number;
  score: number;
  onboardingNeedsAttention: boolean;
  indexed: boolean;
  status: "needs_website" | "indexing" | "review_recommended" | "ready";
};

/**
 * The single server-side readiness decision used by owner and team payloads.
 * Coverage/onboarding is authoritative: searchable chunks alone cannot make
 * a materially incomplete multi-page crawl look fully ready.
 */
export function knowledgeReadinessSnapshot(input: KnowledgeReadinessInput): KnowledgeReadinessSnapshot {
  const calculatedScore = input.sourceCount === 0
    ? 0
    : Math.max(0, Math.min(100,
      40
      + (input.meaningfulChunkCount > 0 ? 30 : 0)
      + (input.semanticHealthy && !input.contentQualityIssue ? 20 : 0)
      + Math.max(0, 10 - input.gapCount * 2),
    ));
  const coverageNeedsAttention = crawlCoverageNeedsAttention(input.crawlCoverage);
  const onboardingNeedsAttention = input.onboarding.status !== "valid" || !input.onboarding.knowledgeReady || coverageNeedsAttention;
  const coverageScore = coverageNeedsAttention && input.crawlCoverage
    ? Math.round(
        Math.max(0, Math.min(100, Number(input.crawlCoverage.successfulPages ?? 0)))
        / Math.max(1, Number(input.crawlCoverage.eligibleUrls ?? input.crawlCoverage.discoveredUrls ?? 1))
        * 100,
      )
    : calculatedScore;
  const score = Math.min(
    calculatedScore,
    onboardingNeedsAttention ? Math.max(0, Math.min(100, input.onboarding.readinessScore)) : calculatedScore,
    coverageScore < calculatedScore ? Math.round(calculatedScore * coverageScore / 100) : calculatedScore,
  );
  const indexed = input.sourceCount > 0 && input.meaningfulChunkCount > 0;
  const status = input.sourceCount === 0
    ? "needs_website"
    : input.chunkCount === 0 || input.pendingSourceCount > 0
      ? "indexing"
      : input.contentQualityIssue || input.gapCount > 0 || input.failedSourceCount > 0 || onboardingNeedsAttention
        ? "review_recommended"
        : "ready";
  return { calculatedScore, score, onboardingNeedsAttention, indexed, status };
}

export function onboardingFailureCopy(code: OnboardingFailureCode | null): Pick<OnboardingValidation, "message" | "suggestedAction"> {
  return code ? failureCopy(code) : { message: "Website validated and business information is ready to review.", suggestedAction: "Review the Business Brain before publishing." };
}
