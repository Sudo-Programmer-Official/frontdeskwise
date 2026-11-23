import type { BusinessFact } from "./business-knowledge.js";

export const BUSINESS_QNA_STATUSES = ["VERIFIED", "NEEDS_REVIEW", "CONFLICTED", "STALE", "ARCHIVED"] as const;
export type BusinessQnaStatus = typeof BUSINESS_QNA_STATUSES[number];

export const BUSINESS_QNA_SOURCE_TYPES = ["OWNER", "OWNER_CONFIRMED", "WEBSITE_DERIVED"] as const;
export type BusinessQnaSourceType = typeof BUSINESS_QNA_SOURCE_TYPES[number];

export type BusinessQnaSourceReference = {
  type: "ANSWER_GAP" | "BUSINESS_FACT" | "WEBSITE" | "OWNER";
  id?: string | null;
  label?: string | null;
  url?: string | null;
  occurredAt?: string | null;
};

export type BusinessQna = {
  id: string;
  organizationId: string | null;
  businessId: string;
  canonicalQuestion: string;
  canonicalAnswer: string;
  variants: string[];
  status: BusinessQnaStatus;
  sourceType: BusinessQnaSourceType;
  sourceReferences: BusinessQnaSourceReference[];
  answerGapId: string | null;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
  validUntil: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
};

const synonymMap: Record<string, string> = {
  cost: "pricing",
  costs: "pricing",
  fee: "pricing",
  fees: "pricing",
  price: "pricing",
  prices: "pricing",
  pricing: "pricing",
  amount: "pricing",
  charge: "pricing",
  charges: "pricing",
  much: "pricing",
  work: "integrate",
  works: "integrate",
  support: "integrate",
  connect: "integrate",
  connection: "integrate",
};

export function normalizeQnaQuestion(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function qnaTokens(value: string): Set<string> {
  return new Set(normalizeQnaQuestion(value).split(" ").filter((token) => token.length > 2).map((token) => synonymMap[token] ?? token));
}

function scoreQuestion(query: string, candidate: string): number {
  const normalizedQuery = normalizeQnaQuestion(query);
  const normalizedCandidate = normalizeQnaQuestion(candidate);
  if (!normalizedQuery || !normalizedCandidate) return 0;
  if (normalizedQuery === normalizedCandidate) return 1;
  const queryTokens = qnaTokens(query);
  const candidateTokens = qnaTokens(candidate);
  if (!queryTokens.size || !candidateTokens.size) return 0;
  const overlap = [...queryTokens].filter((token) => candidateTokens.has(token)).length;
  const recall = overlap / queryTokens.size;
  const precision = overlap / candidateTokens.size;
  return (recall * 0.65) + (precision * 0.35);
}

export function qnaMatchScore(query: string, qna: Pick<BusinessQna, "canonicalQuestion" | "variants">): number {
  return Math.max(scoreQuestion(query, qna.canonicalQuestion), ...qna.variants.map((variant) => scoreQuestion(query, variant)));
}

export function findCompatibleQna(query: string, qnas: BusinessQna[], minimumScore = 0.72): { qna: BusinessQna; score: number } | null {
  return qnas
    .filter((qna) => qna.status !== "ARCHIVED")
    .map((qna) => ({ qna, score: qnaMatchScore(query, qna) }))
    .filter((item) => item.score >= minimumScore)
    .sort((left, right) => right.score - left.score || right.qna.timesUsed - left.qna.timesUsed || right.qna.updatedAt.localeCompare(left.qna.updatedAt))[0] ?? null;
}

export function qnaIsRuntimeUsable(qna: BusinessQna, now = new Date()): boolean {
  return qna.status === "VERIFIED"
    && (!qna.validUntil || Date.parse(qna.validUntil) > now.getTime());
}

function numbers(value: string): string[] {
  return [...value.matchAll(/\b\d+(?:\.\d+)?\b/g)].map((match) => match[0]);
}

function questionKind(question: string): BusinessFact["kind"] | null {
  const normalized = normalizeQnaQuestion(question);
  if (/\b(pricing|price|cost|fee|charge|amount)\b/.test(normalized)) return "pricing";
  if (/\b(hour|hours|open|opening|close|closing)\b/.test(normalized)) return "hours";
  if (/\b(location|located|address|where)\b/.test(normalized)) return "location";
  if (/\b(service|services|offer|offers|provide|capabilit|integration|integrate|connect)\b/.test(normalized)) return "service";
  if (/\b(cancel|cancellation|refund|policy|policies)\b/.test(normalized)) return "policy";
  return null;
}

function relatedFact(qna: BusinessQna, fact: BusinessFact): boolean {
  const questionTokens = qnaTokens(qna.canonicalQuestion);
  const subjectTokens = qnaTokens(fact.subject);
  if (!subjectTokens.size) return true;
  return [...subjectTokens].some((token) => questionTokens.has(token));
}

/** Detect a newer source value that makes an owner answer unsafe to trust. */
export function qnaConflictsWithFacts(qna: BusinessQna, facts: BusinessFact[], now = new Date()): boolean {
  const kind = questionKind(qna.canonicalQuestion);
  if (!kind) return false;
  const qnaUpdatedAt = Date.parse(qna.updatedAt);
  return facts.some((fact) => {
    if (!fact.active || fact.kind !== kind || !relatedFact(qna, fact)) return false;
    if (!(["website", "owner_structured"].includes(fact.sourceType))) return false;
    const factAt = Date.parse(fact.updatedAt || fact.observedAt);
    if (Number.isFinite(qnaUpdatedAt) && Number.isFinite(factAt) && factAt < qnaUpdatedAt) return false;
    if (kind === "pricing") {
      const qnaValues = numbers(qna.canonicalAnswer);
      const factValues = numbers(fact.valueText);
      return qnaValues.length > 0 && factValues.length > 0 && !qnaValues.some((value) => factValues.includes(value));
    }
    const answerTokens = qnaTokens(qna.canonicalAnswer);
    const factTokens = qnaTokens(fact.valueText);
    const overlap = [...factTokens].filter((token) => answerTokens.has(token)).length;
    return factTokens.size > 0 && overlap / factTokens.size < 0.25;
  });
}

export function qnaStatusAfterFactRefresh(qna: BusinessQna, facts: BusinessFact[], now = new Date()): BusinessQnaStatus {
  if (qna.status === "ARCHIVED") return "ARCHIVED";
  if (qna.validUntil && Date.parse(qna.validUntil) <= now.getTime()) return "STALE";
  return qnaConflictsWithFacts(qna, facts, now) ? "CONFLICTED" : qna.status;
}
