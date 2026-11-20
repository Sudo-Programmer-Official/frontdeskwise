export type RetrievalIntent =
  | "services"
  | "hours"
  | "contact"
  | "pricing"
  | "location"
  | "booking"
  | "policy"
  | "general";

export type RetrievalSource = {
  id: string;
  url: string;
  title: string;
  pageType: string;
};

export type RankableMatch<TChunk extends { sourceId: string }> = {
  chunk: TChunk;
  score: number;
  evidenceScore: number;
  sourceType?: string;
  sourceBoost?: number;
};

const serviceWords = /\b(service|services|solution|solutions|product|products|offer|offers|provide|provides|automation|development|integration|tool|tools)\b/i;

export function classifyQuestionIntent(question: string): RetrievalIntent {
  const value = question.trim().toLowerCase();
  if (/\b(terms|privacy|cookie|cancellation|cancel|refund|return|policy|policies|legal|agreement)\b/.test(value)) return "policy";
  if (/\b(price|pricing|cost|rate|rates|how much|fee|fees|budget|quote|quotation)\b/.test(value)) return "pricing";
  if (/\b(hours?|open|opening|close|closing|schedule|when are you available)\b/.test(value)) return "hours";
  if (/\b(where|located|location|address|directions|area|serve)\b/.test(value)) return "location";
  if (/\b(contact|email|phone|call|reach|speak|talk)\b/.test(value)) return "contact";
  if (/\b(book|booking|appointment|reserve|reservation|enroll|enrollment|sign up|schedule)\b/.test(value)) return "booking";
  if (serviceWords.test(value) || /\bwhat do you do\b|\bwhat can you do\b|\bwhat do you provide\b/.test(value)) return "services";
  return "general";
}

export function sourceSemanticType(source: Pick<RetrievalSource, "url" | "title" | "pageType">): string {
  const value = `${source.url} ${source.title}`.toLowerCase();
  const pageType = source.pageType.toLowerCase();
  if (pageType === "policy" || /\b(terms|privacy|cookie|legal|policy|policies)\b/.test(value)) return "policy";
  try {
    const pathname = new URL(source.url).pathname.replace(/\/+$/, "");
    if (!pathname || pathname === "") return "homepage";
  } catch {
    // A malformed source URL should not prevent title/page-type ranking.
  }
  if (pageType === "pricing" || /\b(pric|cost|rate|fee)\b/.test(value)) return "pricing";
  if (pageType === "faq" || /\bfaq|frequently asked\b/.test(value)) return "faq";
  if (/\b(case[- ]?stud|customer stor|success stor|portfolio)\b/.test(value)) return "case_study";
  if (/\b(blog|article|insight|news)\b/.test(value)) return "blog";
  if (pageType === "location" || /\b(contact|location|hours?|directions|visit us)\b/.test(value)) return "contact";
  if (/\b(about|team|company)\b/.test(value)) return "about";
  if (/\b(solution|solutions)\b/.test(value)) return "solution";
  if (/\b(product|products)\b/.test(value)) return "product";
  if (pageType === "service" || /\b(service|solution|product|offering|what we do)\b/.test(value)) return "service";
  return "web_page";
}

const intentWeights: Record<RetrievalIntent, Record<string, number>> = {
  services: {
    service: 0.9,
    homepage: 0.72,
    product: 0.88,
    solution: 0.9,
    faq: 0.42,
    case_study: 0.4,
    blog: 0.28,
    web_page: 0.24,
    pricing: 0.18,
    about: 0.14,
    contact: 0.04,
    policy: -1.4,
  },
  hours: { contact: 0.9, homepage: 0.48, faq: 0.45, service: 0.14, web_page: 0.1, policy: -1.4 },
  contact: { contact: 0.9, homepage: 0.55, about: 0.35, faq: 0.3, service: 0.12, web_page: 0.1, policy: -1.4 },
  pricing: { pricing: 1, service: 0.42, faq: 0.4, homepage: 0.24, web_page: 0.12, policy: -1.2 },
  location: { contact: 0.95, homepage: 0.55, faq: 0.35, about: 0.3, web_page: 0.16, policy: -1.4 },
  booking: { service: 0.62, contact: 0.55, homepage: 0.48, faq: 0.46, pricing: 0.22, web_page: 0.14, policy: -1.4 },
  policy: { policy: 1.15, faq: 0.35, contact: 0.08, homepage: 0.04, service: -0.18, web_page: -0.22 },
  general: { homepage: 0.42, service: 0.35, faq: 0.28, case_study: 0.2, blog: 0.16, web_page: 0.14, policy: -1.1 },
};

export function sourceBoost(intent: RetrievalIntent, source: RetrievalSource): number {
  return intentWeights[intent][sourceSemanticType(source)] ?? 0;
}

export function sourceAllowedForIntent(intent: RetrievalIntent, source: RetrievalSource): boolean {
  return intent === "policy" || sourceSemanticType(source) !== "policy";
}

export function rankMatches<TChunk extends { sourceId: string }>(
  matches: Array<RankableMatch<TChunk>>,
  sources: RetrievalSource[],
  intent: RetrievalIntent,
  limit = 8,
): Array<RankableMatch<TChunk>> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const scored = matches.map((match) => {
    const source = sourceById.get(match.chunk.sourceId);
    const type = source ? sourceSemanticType(source) : "web_page";
    const boost = source ? sourceBoost(intent, source) : 0;
    return { ...match, sourceType: type, sourceBoost: boost };
  });
  const allowed = scored.filter((match) => {
    const source = sourceById.get(match.chunk.sourceId);
    return !source || sourceAllowedForIntent(intent, source);
  });
  const candidates = allowed.length ? allowed : (intent === "policy" ? scored : []);
  const maxBaseScore = Math.max(...candidates.map((match) => match.score), 0);
  return candidates
    .map((match) => ({
      ...match,
      // RRF scores are tiny while memory lexical scores are integer counts.
      // Normalize the retrieval signal before adding business/source intent.
      score: (maxBaseScore > 0 ? match.score / maxBaseScore : 0) * 0.45
        + Math.max(0, Math.min(1, match.evidenceScore)) * 0.35
        + (match.sourceBoost ?? 0),
    }))
    .sort((left, right) => right.score - left.score || right.evidenceScore - left.evidenceScore)
    .slice(0, limit);
}

export function citationMatches<TChunk extends { sourceId: string }>(
  matches: Array<RankableMatch<TChunk>>,
  sources: RetrievalSource[],
  intent: RetrievalIntent,
  limit = 2,
): Array<RankableMatch<TChunk>> {
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const seen = new Set<string>();
  return matches.filter((match) => {
    const source = sourceById.get(match.chunk.sourceId);
    if (!source || !sourceAllowedForIntent(intent, source) || seen.has(source.id)) return false;
    seen.add(source.id);
    return true;
  }).slice(0, limit);
}
