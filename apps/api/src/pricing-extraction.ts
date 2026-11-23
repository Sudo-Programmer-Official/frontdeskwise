import type { BusinessFactValue } from "./business-knowledge.js";

export type PricingExtractionSource = {
  id: string;
  url: string;
  title: string;
  pageType: string;
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
  sourceLabel: string;
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
  "the",
  "tier",
  "tiers",
  "package",
  "packages",
  "option",
  "options",
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
  const marked = /(?:plan|tier|package|option)\s*(?:is|:|[-–—])?\s*([A-Za-z][A-Za-z0-9&+ -]{1,42})$/i.exec(segment)?.[1];
  const capitalizedTail = /\b([A-Z][A-Za-z0-9&+]*(?:\s+[A-Z][A-Za-z0-9&+]*(?:\s+[A-Z][A-Za-z0-9&+]*)?)?)$/.exec(segment)?.[1];
  const direct = cleanPlanName(marked ?? capitalizedTail ?? segment);
  if (direct) return direct;
  return headingCandidate(chunk);
}

function valueText(price: PriceMatch): string {
  const amount = Number.isInteger(price.amount) ? String(price.amount) : price.amount.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  return `${price.currency}${amount}${price.period ? `/${price.period}` : ""}`;
}

function sourceLooksLikePricing(source: PricingExtractionSource, content: string): boolean {
  return source.pageType.toLowerCase() === "pricing"
    || /\b(?:pricing|prices?|cost|rates?|fees?|plans?|tiers?|subscriptions?)\b/i.test(`${source.url} ${source.title} ${content}`);
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
      const subject = planNameBefore(content, price, chunk);
      if (!subject) continue;
      const key = `${chunk.sourceId}|${normalized(subject)}|${valueText(price).toLowerCase()}`;
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
        sourceLabel: source.title || source.url,
        observedAt: input.observedAt ?? source.lastCrawledAt ?? new Date().toISOString(),
        confidence: 0.94,
      });
    }
  }

  return candidates;
}
