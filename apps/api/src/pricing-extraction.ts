import type { BusinessFactValue } from "./business-knowledge.js";

export type PricingExtractionSource = {
  id: string;
  url: string;
  title: string;
  pageType: string;
  contentHash?: string | null;
  lastCrawledAt?: string | null;
};

export type PricingExtractionChunk = {
  sourceId: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type WebsitePricingCandidate = {
  kind: "pricing";
  subject: string;
  predicate: "plan price";
  value: BusinessFactValue;
  valueText: string;
  sourceId: string;
  sourceUrl: string;
  sourceLabel: string;
  sourceHash: string | null;
  observedAt: string;
  confidence: number;
};

type PriceMatch = {
  currency: string;
  amount: number;
  period: "month" | "year" | null;
  index: number;
  length: number;
};

const genericHeadings = new Set([
  "pricing",
  "price",
  "plans",
  "plan",
  "packages",
  "package",
  "tiers",
  "tier",
  "options",
  "option",
  "features",
  "services",
]);

const noiseWords = new Set([
  "a",
  "an",
  "and",
  "at",
  "best",
  "from",
  "is",
  "just",
  "monthly",
  "month",
  "most",
  "only",
  "our",
  "per",
  "plan",
  "plans",
  "popular",
  "price",
  "pricing",
  "starting",
  "starts",
  "start",
  "the",
  "tier",
  "tiers",
  "package",
  "packages",
  "option",
  "options",
  "cost",
  "costs",
]);

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function cleanPlanName(value: string): string | null {
  const words = value
    .replace(/[|:–—-]+/g, " ")
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z0-9&+]/g, ""))
    .filter(Boolean)
    .filter((word) => !noiseWords.has(word.toLowerCase()));
  if (!words.length) return null;
  const candidate = words.slice(-3).join(" ").trim();
  if (!candidate || genericHeadings.has(normalized(candidate))) return null;
  return candidate;
}

function periodFromText(value: string): "month" | "year" | null {
  if (/\b(?:month|mo|monthly)\b/i.test(value)) return "month";
  if (/\b(?:year|yr|annual|annually)\b/i.test(value)) return "year";
  return null;
}

function priceMatches(text: string): PriceMatch[] {
  const matches: PriceMatch[] = [];
  const pattern = /([$€£])\s*(\d{1,5}(?:[,.]\d{3})*(?:\.\d{1,2})?)\s*(?:\/\s*(month|mo|monthly|year|yr|annual|annually)|per\s+(month|mo|monthly|year|yr|annual|annually))?/gi;
  for (const match of text.matchAll(pattern)) {
    const amount = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000 || match.index === undefined) continue;
    const matchedPeriod = match[3] ?? match[4] ?? null;
    const period = matchedPeriod
      ? /month|mo/i.test(matchedPeriod) ? "month" : "year"
      : periodFromText(text.slice(Math.max(0, match.index - 80), Math.min(text.length, match.index + match[0].length + 80)));
    matches.push({ currency: match[1], amount, period, index: match.index, length: match[0].length });
  }
  return matches;
}

function headingCandidate(chunk: PricingExtractionChunk): string | null {
  const headingPath = chunk.metadata?.headingPath;
  if (!Array.isArray(headingPath)) return null;
  for (let index = headingPath.length - 1; index >= 0; index -= 1) {
    const heading = typeof headingPath[index] === "string" ? headingPath[index].trim() : "";
    const candidate = cleanPlanName(heading);
    if (candidate) return candidate;
  }
  return null;
}

function planNameBefore(text: string, price: PriceMatch, chunk: PricingExtractionChunk): string | null {
  const before = text.slice(Math.max(0, price.index - 180), price.index);
  const segments = before.split(/[.!?;|\n]+/).map((segment) => segment.trim()).filter(Boolean);
  const segment = segments.at(-1) ?? before;
  const marked = /(?:plan|tier|package|option)s?\b\s*(?:is|:|[-–—])?\s*([A-Za-z][A-Za-z0-9&+ -]{1,42})$/i.exec(segment)?.[1];
  const capitalizedTail = /\b([A-Z][A-Za-z0-9&+]*(?:\s+[A-Z][A-Za-z0-9&+]*(?:\s+[A-Z][A-Za-z0-9&+]*)?)?)$/.exec(segment)?.[1];
  const heading = headingCandidate(chunk);
  const direct = cleanPlanName(marked ?? capitalizedTail ?? segment);
  if (marked && direct) return direct;
  if (heading) return heading;
  // Do not turn marketing prose such as “See how it works From $65/month”
  // into a fake plan name. A price without a recoverable card heading is
  // still useful evidence, but it is explicitly represented as a starting
  // price below.
  if (/\b(?:from|starting|starts|start)\s*(?:at)?\s*$/i.test(segment)) return null;
  if (direct && /^[A-Z][A-Za-z0-9&+]*(?:\s+[A-Z][A-Za-z0-9&+]*){0,2}$/.test(direct)) return direct;
  return null;
}

function valueText(price: PriceMatch): string {
  const amount = Number.isInteger(price.amount) ? String(price.amount) : price.amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${price.currency}${amount}${price.period ? `/${price.period}` : ""}`;
}

function sourceLooksLikePricing(source: PricingExtractionSource, content: string): boolean {
  const sourceText = `${source.url} ${source.title} ${content}`;
  if (source.pageType.toLowerCase() === "pricing"
    || /\b(?:pricing|prices?|cost|rates?|fees?|plans?|tiers?|subscriptions?)\b/i.test(sourceText)) return true;
  // A homepage often exposes pricing cards without calling the section
  // “Pricing”. Require both a currency amount and a deterministic pricing
  // structure signal before treating it as pricing evidence.
  return priceMatches(content).length > 0
    && /\b(?:from|starting|starts|start)\s*(?:at)?\s*[$€£]|\b(?:core|growth|complete|starter|basic|standard|premium|pro|enterprise|solo|team)\b/i.test(sourceText);
}

function fallbackPlanName(text: string, price: PriceMatch): string | null {
  const before = text.slice(Math.max(0, price.index - 100), price.index);
  return /\b(?:from|starting|starts|start)\s*(?:at)?\s*$/i.test(before.trim()) ? "Starting price" : null;
}

/**
 * Extracts deterministic pricing candidates from crawled website chunks.
 * These are still website evidence; the caller decides whether the business
 * has verified ownership and may promote the candidates to owner_verified.
 */
export function extractWebsitePricingCandidates(input: {
  sources: PricingExtractionSource[];
  chunks: PricingExtractionChunk[];
  observedAt?: string;
}): WebsitePricingCandidate[] {
  const sources = new Map(input.sources.map((source) => [source.id, source]));
  const candidates: WebsitePricingCandidate[] = [];
  const seen = new Set<string>();

  for (const chunk of input.chunks) {
    const source = sources.get(chunk.sourceId);
    if (!source) continue;
    const content = chunk.content.replace(/\s+/g, " ").trim();
    if (!content || !sourceLooksLikePricing(source, content)) continue;
    for (const price of priceMatches(content)) {
      const subject = planNameBefore(content, price, chunk) ?? fallbackPlanName(content, price);
      if (!subject) continue;
      // business_facts permits one active website fact per source/kind/subject/
      // predicate. Keep extraction aligned with that invariant when a page
      // repeats a plan heading around multiple price tokens (for example a
      // responsive pricing card rendered twice in the HTML).
      const key = `${chunk.sourceId}|${normalized(subject)}|plan price`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        kind: "pricing",
        subject,
        predicate: "plan price",
        value: {
          plan: subject,
          amount: price.amount,
          currency: price.currency,
          ...(price.period ? { billingPeriod: price.period } : {}),
        },
        valueText: valueText(price),
        sourceId: chunk.sourceId,
        sourceUrl: source.url,
        sourceLabel: source.title || source.url,
        sourceHash: source.contentHash ?? null,
        observedAt: input.observedAt ?? source.lastCrawledAt ?? new Date().toISOString(),
        confidence: 0.94,
      });
    }
  }

  return candidates;
}
