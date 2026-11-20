export type RetrievalIntent =
  | "services"
  | "hours"
  | "contact"
  | "pricing"
  | "location"
  | "booking"
  | "reminders"
  | "calendar"
  | "voice"
  | "teams"
  | "permissions"
  | "privacy"
  | "policy"
  | "support"
  | "general"
  | "unsupported";

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

const serviceWords = /\b(service|services|solution|solutions|product|products|offer|offers|provide|provides|automation|development|integrat\w*|tool|tools)\b/i;
const unsupportedQuestion = /\b(moonbase|private jet|space launch|lottery numbers|stock price|weather forecast|celebrity gossip)\b/i;

export function classifyQuestionIntent(question: string): RetrievalIntent {
  const value = question.trim().toLowerCase();
  if (!value || unsupportedQuestion.test(value)) return "unsupported";
  if (/\b(permission|permissions|access|role|roles|admin|administrator|who can|allowed to|authorization)\b/.test(value)) return "permissions";
  if (/\b(privacy|private|personal data|data usage|data handling|security|secure|stored|sell|share my data|oauth|token)\b/.test(value)) return "privacy";
  if (/\b(calendars?|google calendar|meetings?|events?|schedule around|sync|synchroni[sz])\b/.test(value)) return "calendar";
  if (/\b(voice|speak|speaking|spoken|talk|audio|transcri|dictat|hands[- ]?free)\b/.test(value)) return "voice";
  if (/\b(remind|reminder|reminders|nudge|nudges|recap|recaps|notification|notifications|alert|alerts|follow[- ]?up)\b/.test(value)) return "reminders";
  if (/\b(price|pricing|cost|rate|rates|how much|fee|fees|budget|quote|quotation|plan|plans|subscription)\b/.test(value)) return "pricing";
  if (/\b(automate|automation|features?|capabilities|solutions?|products?)\b/.test(value)) return "services";
  if (/\b(help|can)\b.*\bplan(?:\s|$)|\b(help|can)\b.*\b(organize|priorit)\w*/.test(value)) return "services";
  if (/\b(team|teams|workspace|workspaces|collaborat|shared|multiple users|seats?)\b/.test(value)) return "teams";
  if (/\b(support|help desk|help|technical issue|can't sign in|cannot sign in|login problem)\b/.test(value)) return "support";
  if (/\b(terms|cookie|cancellation|cancel|refund|return|policy|policies|legal|agreement)\b/.test(value)) return "policy";
  if (/\b(hours?|open|opening|close|closing|when are you available)\b/.test(value)) return "hours";
  if (/\b(where|located|location|address|directions|area|serve)\b/.test(value)) return "location";
  if (/\b(contact|email|phone|call|reach|speak with someone|talk to someone)\b/.test(value)) return "contact";
  if (/\b(book|booking|appointment|reserve|reservation|enroll|enrollment|sign up)\b/.test(value)) return "booking";
  if (serviceWords.test(value) || /\bwhat do you do\b|\bwhat can you do\b|\bwhat do you provide\b/.test(value)) return "services";
  return "general";
}

export function sourceSemanticType(source: Pick<RetrievalSource, "url" | "title" | "pageType">): string {
  const value = `${source.url} ${source.title}`.toLowerCase();
  const pageType = source.pageType.toLowerCase();
  let pathname = "";
  try {
    pathname = new URL(source.url).pathname.toLowerCase();
  } catch {
    // Fall back to title/page type classification below.
  }

  // Keep the database's coarse page_type for compatibility, but derive a
  // finer semantic type from the URL/title so existing crawls benefit too.
  if (pageType === "pricing" || /\b(pric|cost|rate|fee|plan|subscription)\b/.test(value)) return "pricing";
  if (pageType === "faq" || /\bfaq|frequently asked\b/.test(value)) return "faq";
  if (/\bprivacy|data[- ]?(deletion|usage|handling)|security|personal data|oauth|token\b/.test(value)) return "privacy";
  if (/\bpermission|access control|role[- ]?based|administrator|admin controls\b/.test(value)) return "permissions";
  if (pageType === "policy" || /\b(terms|cookie|legal|cancellation|refund|agreement|policy|policies)\b/.test(value)) return "policy";
  if (/\/contact(?:\/|$)/.test(pathname)) return "contact";
  if (/\b(support|help[- ]?center|technical help)\b/.test(value)) return "support";
  if (pageType === "location" || /\b(contact|location|hours?|directions|visit us)\b/.test(value)) return "contact";
  if (/\/(voice|spoken|speech)/.test(pathname)) return "voice";
  if (/\/(reminder|recurring-reminder|recap|nudge)/.test(pathname)) return "reminders";
  if (/\/(calendar|google-calendar)/.test(pathname)) return "calendar";
  if (/\/(features|ai-task-planner|ai-daily-planner|products?)/.test(pathname)) return "product";
  if (/\b(calendar|google-calendar|meeting|schedule|scheduling|event sync)\b/.test(value)) return "calendar";
  if (/\b(team|workspace|collaborat|shared|seat|users?)\b/.test(value)) return "teams";
  if (/\b(voice|speech|spoken|transcri|dictat|audio)\b/.test(value)) return "voice";
  if (/\b(reminder|recap|nudge|notification|follow[- ]?up)\b/.test(value)) return "reminders";
  if (/\b(case[- ]?stud|customer stor|success stor|portfolio)\b/.test(value)) return "case_study";
  if (/\b(blog|article|insight|news)\b/.test(value)) return "blog";
  const normalizedPathname = pathname.replace(/\/+$/, "");
  if (!normalizedPathname || normalizedPathname === "") return "homepage";
  if (/\b(about|team|company)\b/.test(value)) return "about";
  if (/\b(solution|solutions)\b/.test(value)) return "solution";
  if (/\b(feature|features|product|products|planner|task)\b/.test(value)) return "product";
  if (pageType === "service" || /\b(service|offering|what we do)\b/.test(value)) return "service";
  if (pageType === "document") return "document";
  return "web_page";
}

const intentWeights: Record<RetrievalIntent, Record<string, number>> = {
  services: { service: 0.38, product: 0.36, solution: 0.36, homepage: 0.2, faq: 0.12, reminders: 0.1, voice: 0.1, calendar: 0.08, document: 0.05, web_page: 0 },
  hours: { contact: 0.34, support: 0.28, homepage: 0.2, faq: 0.14, document: 0.05, web_page: 0 },
  contact: { contact: 0.36, support: 0.34, homepage: 0.2, about: 0.12, faq: 0.1, document: 0.05, web_page: 0 },
  pricing: { pricing: 0.4, faq: 0.16, service: 0.1, product: 0.08, homepage: 0.06, document: 0.05, web_page: 0 },
  location: { contact: 0.36, homepage: 0.2, faq: 0.14, about: 0.12, document: 0.05, web_page: 0 },
  booking: { service: 0.22, contact: 0.2, support: 0.16, product: 0.12, homepage: 0.12, faq: 0.1, pricing: 0.05, document: 0.05, web_page: 0 },
  reminders: { reminders: 0.36, service: 0.24, product: 0.22, voice: 0.14, calendar: 0.12, faq: 0.12, document: 0.05, web_page: 0 },
  calendar: { calendar: 0.38, product: 0.24, service: 0.18, reminders: 0.12, voice: 0.1, faq: 0.12, privacy: 0.08, policy: 0.04, document: 0.05, web_page: 0 },
  voice: { voice: 0.38, product: 0.24, service: 0.2, reminders: 0.14, faq: 0.12, document: 0.05, web_page: 0 },
  teams: { teams: 0.38, pricing: 0.34, product: 0.24, service: 0.2, about: 0.16, faq: 0.12, document: 0.05, web_page: 0 },
  permissions: { permissions: 0.4, privacy: 0.34, policy: 0.24, faq: 0.14, document: 0.05, web_page: 0 },
  privacy: { privacy: 0.4, permissions: 0.32, policy: 0.24, faq: 0.14, document: 0.05, web_page: 0 },
  policy: { policy: 0.38, privacy: 0.32, permissions: 0.22, faq: 0.14, pricing: 0.08, document: 0.05, web_page: 0 },
  support: { support: 0.38, contact: 0.32, faq: 0.16, homepage: 0.12, about: 0.08, document: 0.05, web_page: 0 },
  general: { homepage: 0.18, service: 0.16, product: 0.16, faq: 0.12, reminders: 0.08, voice: 0.08, calendar: 0.08, case_study: 0.06, blog: 0.04, document: 0.04, web_page: 0 },
  unsupported: {},
};

const intentSourceTypes: Partial<Record<RetrievalIntent, Set<string>>> = {
  services: new Set(["service", "product", "solution", "homepage", "faq", "reminders", "voice", "calendar", "document"]),
  hours: new Set(["contact", "support", "homepage", "faq", "document"]),
  contact: new Set(["contact", "support", "homepage", "about", "faq", "document"]),
  pricing: new Set(["pricing", "faq", "service", "product", "homepage", "document"]),
  location: new Set(["contact", "homepage", "about", "faq", "document"]),
  booking: new Set(["service", "contact", "support", "product", "homepage", "faq", "pricing", "document"]),
  reminders: new Set(["reminders", "service", "product", "voice", "calendar", "faq", "document"]),
  calendar: new Set(["calendar", "product", "service", "reminders", "voice", "faq", "privacy", "policy", "document"]),
  voice: new Set(["voice", "product", "service", "reminders", "faq", "document"]),
  teams: new Set(["teams", "pricing", "product", "service", "reminders", "faq", "homepage", "document"]),
  permissions: new Set(["permissions", "privacy", "policy", "faq", "document"]),
  privacy: new Set(["privacy", "permissions", "policy", "faq", "document"]),
  policy: new Set(["policy", "privacy", "permissions", "faq", "pricing", "document"]),
  support: new Set(["support", "contact", "homepage", "about", "faq", "document"]),
};

export function sourceBoost(intent: RetrievalIntent, source: RetrievalSource): number {
  return intentWeights[intent][sourceSemanticType(source)] ?? 0;
}

export function sourceAllowedForIntent(intent: RetrievalIntent, source: RetrievalSource): boolean {
  if (intent === "unsupported") return false;
  const type = sourceSemanticType(source);
  const allowed = intentSourceTypes[intent];
  if (allowed) return allowed.has(type);
  return !new Set(["policy", "privacy", "permissions"]).has(type);
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
  const candidates = scored.filter((match) => {
    const source = sourceById.get(match.chunk.sourceId);
    return !source || sourceAllowedForIntent(intent, source);
  });
  if (!candidates.length) return [];

  const maxBaseScore = Math.max(...candidates.map((match) => match.score), 0);
  const seenHashes = new Map<string, number>();
  return candidates
    .map((match) => {
      const hash = typeof (match.chunk as { contentHash?: unknown }).contentHash === "string"
        ? String((match.chunk as unknown as { contentHash: string }).contentHash)
        : "";
      const duplicateIndex = hash ? (seenHashes.get(hash) ?? 0) : 0;
      if (hash) seenHashes.set(hash, duplicateIndex + 1);
      return {
        ...match,
        // Keep retrieval and evidence as the dominant signals. Source type is
        // a calibrated prior, not a replacement for relevance.
        score: (maxBaseScore > 0 ? match.score / maxBaseScore : 0) * 0.45
          + Math.max(0, Math.min(1, match.evidenceScore)) * 0.45
          + (match.sourceBoost ?? 0)
          - duplicateIndex * 0.08,
      };
    })
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
    if (match.evidenceScore < 0.25) return false;
    seen.add(source.id);
    return true;
  }).slice(0, limit);
}

export type AnswerabilityDecision = {
  answerable: boolean;
  score: number;
  reason: string;
};

const answerabilityThresholds: Record<RetrievalIntent, number> = {
  services: 0.32,
  hours: 0.46,
  contact: 0.3,
  pricing: 0.48,
  location: 0.46,
  booking: 0.38,
  reminders: 0.34,
  calendar: 0.38,
  voice: 0.34,
  teams: 0.34,
  permissions: 0.42,
  privacy: 0.42,
  policy: 0.42,
  support: 0.3,
  general: 0.52,
  unsupported: 1,
};

export function answerabilityDecision<TChunk extends { sourceId: string }>(
  matches: Array<RankableMatch<TChunk>>,
  sources: RetrievalSource[],
  intent: RetrievalIntent,
): AnswerabilityDecision {
  if (intent === "unsupported") return { answerable: false, score: 0, reason: "unsupported_intent" };
  const top = matches[0];
  if (!top) return { answerable: false, score: 0, reason: "no_candidates" };
  const source = sources.find((item) => item.id === top.chunk.sourceId);
  if (source && !sourceAllowedForIntent(intent, source)) return { answerable: false, score: top.evidenceScore, reason: "irrelevant_source_type" };
  const threshold = answerabilityThresholds[intent];
  const score = Math.max(0, Math.min(1, top.evidenceScore));
  if (score < threshold) return { answerable: false, score, reason: "insufficient_evidence_coverage" };
  return { answerable: true, score, reason: "relevant_evidence" };
}
