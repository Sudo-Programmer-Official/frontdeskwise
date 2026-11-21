/**
 * Canonical, structured business facts.
 *
 * Website chunks and documents remain useful semantic evidence, but facts such
 * as hours, pricing, locations, and contacts need an explicit source policy.
 * This module is deliberately storage-agnostic so manual facts and provider
 * syncs use the same resolver.
 */

export const BUSINESS_FACT_KINDS = [
  "identity",
  "hours",
  "location",
  "service",
  "pricing",
  "contact",
  "policy",
  "faq",
  "schedule",
  "availability",
  "custom",
] as const;

export type BusinessFactKind = typeof BUSINESS_FACT_KINDS[number];

export const BUSINESS_FACT_SOURCE_TYPES = [
  "live_system",
  "owner_structured",
  "owner_knowledge",
  "document",
  "website",
  "inferred",
] as const;

export type BusinessFactSourceType = typeof BUSINESS_FACT_SOURCE_TYPES[number];
export type BusinessFactAuthority = "system_of_record" | "owner_verified" | "owner_knowledge" | "document" | "website" | "inferred";
export type BusinessFactFreshnessPolicy = "realtime" | "hourly" | "daily" | "until_replaced" | "never";

export type BusinessFactValue = string | number | boolean | null | Record<string, unknown> | Array<string | number | boolean | null>;

export type BusinessFact = {
  id: string;
  businessId: string;
  kind: BusinessFactKind;
  subject: string;
  predicate: string;
  value: BusinessFactValue;
  valueText: string;
  sourceType: BusinessFactSourceType;
  authority: BusinessFactAuthority;
  sourceId: string | null;
  sourceLabel: string | null;
  confidence: number;
  freshnessPolicy: BusinessFactFreshnessPolicy;
  observedAt: string;
  expiresAt: string | null;
  active: boolean;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type BusinessFactInput = Partial<Omit<BusinessFact, "id" | "businessId" | "createdAt" | "updatedAt" | "valueText">> & {
  id?: string;
  businessId: string;
  kind: BusinessFactKind;
  subject: string;
  predicate: string;
  value: BusinessFactValue;
  valueText?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type BusinessFactQuery = {
  kind?: BusinessFactKind;
  subject?: string;
  predicate?: string;
  terms?: string[];
  now?: string | Date;
};

export type ResolvedBusinessFact = {
  fact: BusinessFact;
  score: number;
  authorityRank: number;
  freshnessScore: number;
  matchedTerms: string[];
  conflictValues: string[];
};

export type BusinessFactResolution = {
  status: "matched" | "conflict" | "not_found";
  matches: ResolvedBusinessFact[];
  conflicts: Array<{
    key: string;
    winner: BusinessFact;
    alternatives: BusinessFact[];
  }>;
};

const authorityRanks: Record<BusinessFactAuthority, number> = {
  system_of_record: 500,
  owner_verified: 400,
  owner_knowledge: 300,
  document: 200,
  website: 100,
  inferred: 0,
};

const defaultFreshness: Record<BusinessFactSourceType, BusinessFactFreshnessPolicy> = {
  live_system: "realtime",
  owner_structured: "until_replaced",
  owner_knowledge: "until_replaced",
  document: "until_replaced",
  website: "daily",
  inferred: "daily",
};

const defaultAuthority: Record<BusinessFactSourceType, BusinessFactAuthority> = {
  live_system: "system_of_record",
  owner_structured: "owner_verified",
  owner_knowledge: "owner_knowledge",
  document: "document",
  website: "website",
  inferred: "inferred",
};

const authorityValues = new Set<string>(["system_of_record", "owner_verified", "owner_knowledge", "document", "website", "inferred"]);

const factKinds = new Set<string>(BUSINESS_FACT_KINDS);
const factSourceTypes = new Set<string>(BUSINESS_FACT_SOURCE_TYPES);
const freshnessPolicies = new Set<string>(["realtime", "hourly", "daily", "until_replaced", "never"]);

function cleanText(value: unknown, maxLength = 240): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function safeDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function safeValue(value: unknown): BusinessFactValue {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.filter((item) => item === null || ["string", "number", "boolean"].includes(typeof item)).slice(0, 100) as BusinessFactValue;
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 100)) {
      if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) continue;
      if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") result[key] = item;
      else if (Array.isArray(item)) result[key] = item.filter((entry) => entry === null || ["string", "number", "boolean"].includes(typeof entry)).slice(0, 100);
    }
    return result;
  }
  return null;
}

function displayValue(value: BusinessFactValue): string {
  if (value === null) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return Object.entries(value).map(([key, item]) => `${key}: ${String(item)}`).join(", ");
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokens(value: unknown): string[] {
  return [...new Set(normalized(value).split(" ").filter((item) => item.length >= 2))];
}

function valueSignature(fact: BusinessFact): string {
  return normalized(fact.valueText || displayValue(fact.value));
}

export function businessFactKey(fact: Pick<BusinessFact, "kind" | "subject" | "predicate">): string {
  return `${normalized(fact.kind)}|${normalized(fact.subject)}|${normalized(fact.predicate)}`;
}

export function normalizeBusinessFact(input: BusinessFactInput, now = new Date().toISOString()): BusinessFact {
  if (!input.businessId?.trim()) throw new Error("Business fact businessId is required");
  if (!factKinds.has(input.kind)) throw new Error("Unsupported business fact kind");
  const sourceType = input.sourceType ?? "owner_structured";
  if (!factSourceTypes.has(sourceType)) throw new Error("Unsupported business fact source type");
  const authority = input.authority ?? defaultAuthority[sourceType];
  if (!authorityValues.has(authority)) throw new Error("Unsupported business fact authority");
  const subject = cleanText(input.subject, 240);
  const predicate = cleanText(input.predicate, 160);
  if (!subject) throw new Error("Business fact subject is required");
  if (!predicate) throw new Error("Business fact predicate is required");
  const observedAt = cleanText(input.observedAt, 80) || now;
  if (!safeDate(observedAt)) throw new Error("Business fact observedAt must be an ISO date");
  const expiresAt = input.expiresAt ? cleanText(input.expiresAt, 80) : null;
  if (expiresAt && !safeDate(expiresAt)) throw new Error("Business fact expiresAt must be an ISO date");
  if (expiresAt && safeDate(expiresAt)!.getTime() < safeDate(observedAt)!.getTime()) throw new Error("Business fact expiresAt must be after observedAt");
  const freshnessPolicy = input.freshnessPolicy ?? defaultFreshness[sourceType];
  if (!freshnessPolicies.has(freshnessPolicy)) throw new Error("Unsupported business fact freshness policy");
  const value = safeValue(input.value);
  const valueText = cleanText(input.valueText, 1_000) || displayValue(value);
  if (!valueText) throw new Error("Business fact value is required");
  return {
    id: cleanText(input.id, 120),
    businessId: input.businessId,
    kind: input.kind,
    subject,
    predicate,
    value,
    valueText,
    sourceType,
    authority,
    sourceId: cleanText(input.sourceId, 240) || null,
    sourceLabel: cleanText(input.sourceLabel, 240) || null,
    confidence: Math.max(0, Math.min(1, Number.isFinite(Number(input.confidence)) ? Number(input.confidence) : 1)),
    freshnessPolicy,
    observedAt: new Date(observedAt).toISOString(),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
    active: input.active !== false,
    version: Math.max(1, Math.floor(Number.isFinite(Number(input.version)) ? Number(input.version) : 1)),
    createdAt: cleanText(input.createdAt, 80) || now,
    updatedAt: cleanText(input.updatedAt, 80) || now,
  };
}

export function factAuthorityRank(authority: BusinessFactAuthority): number {
  return authorityRanks[authority];
}

export function factFreshnessScore(fact: BusinessFact, now: string | Date = new Date()): number {
  const current = safeDate(now)?.getTime() ?? Date.now();
  const observed = safeDate(fact.observedAt)?.getTime() ?? current;
  if (fact.expiresAt && (safeDate(fact.expiresAt)?.getTime() ?? 0) < current) return -1_000;
  const age = Math.max(0, current - observed);
  const windows: Record<BusinessFactFreshnessPolicy, number> = {
    realtime: 15 * 60 * 1_000,
    hourly: 60 * 60 * 1_000,
    daily: 24 * 60 * 60 * 1_000,
    until_replaced: Number.POSITIVE_INFINITY,
    never: Number.POSITIVE_INFINITY,
  };
  const window = windows[fact.freshnessPolicy];
  if (age > window) return -1;
  if (!Number.isFinite(window)) return 30;
  return Math.max(1, Math.round(30 * (1 - age / window)));
}

function queryTerms(query: BusinessFactQuery): string[] {
  return [...new Set([...(query.terms ?? []), query.subject ?? "", query.predicate ?? ""].flatMap(tokens))];
}

function factMatches(fact: BusinessFact, query: BusinessFactQuery, terms: string[]): { matches: boolean; matchedTerms: string[]; textScore: number } {
  if (query.kind && fact.kind !== query.kind) return { matches: false, matchedTerms: [], textScore: 0 };
  if (query.subject && !normalized(fact.subject).includes(normalized(query.subject))) return { matches: false, matchedTerms: [], textScore: 0 };
  if (query.predicate && !normalized(fact.predicate).includes(normalized(query.predicate))) return { matches: false, matchedTerms: [], textScore: 0 };
  if (!terms.length) return { matches: true, matchedTerms: [], textScore: 1 };
  const haystack = normalized(`${fact.subject} ${fact.predicate} ${fact.valueText}`);
  const matchedTerms = terms.filter((term) => haystack.includes(term));
  const ratio = matchedTerms.length / terms.length;
  return { matches: ratio >= 0.5, matchedTerms, textScore: ratio };
}

/** Resolve facts by authority first, then freshness, confidence, and query fit. */
export function resolveBusinessFacts(facts: BusinessFact[], query: BusinessFactQuery): BusinessFactResolution {
  const now = query.now ?? new Date();
  const terms = queryTerms(query);
  const candidates = facts
    .filter((fact) => fact.active && factFreshnessScore(fact, now) >= 0)
    .map((fact) => {
      const match = factMatches(fact, query, terms);
      if (!match.matches) return null;
      const freshnessScore = factFreshnessScore(fact, now);
      return {
        fact,
        score: factAuthorityRank(fact.authority) * 1_000 + freshnessScore * 10 + fact.confidence * 100 + match.textScore * 100,
        authorityRank: factAuthorityRank(fact.authority),
        freshnessScore,
        matchedTerms: match.matchedTerms,
        conflictValues: [] as string[],
      } satisfies ResolvedBusinessFact;
    })
    .filter((item): item is ResolvedBusinessFact => Boolean(item));

  const groups = new Map<string, ResolvedBusinessFact[]>();
  for (const candidate of candidates) {
    const group = groups.get(businessFactKey(candidate.fact)) ?? [];
    group.push(candidate);
    groups.set(businessFactKey(candidate.fact), group);
  }
  const conflicts: BusinessFactResolution["conflicts"] = [];
  for (const [key, group] of groups) {
    group.sort((left, right) => right.score - left.score || right.fact.updatedAt.localeCompare(left.fact.updatedAt));
    const values = [...new Set(group.map((item) => valueSignature(item.fact)).filter(Boolean))];
    if (values.length > 1) {
      conflicts.push({ key, winner: group[0].fact, alternatives: group.slice(1).map((item) => item.fact) });
      for (const item of group) item.conflictValues = values.filter((value) => value !== valueSignature(item.fact));
    }
    group.splice(1);
  }
  const matches = [...groups.values()].map((group) => group[0]).sort((left, right) => right.score - left.score).slice(0, 8);
  return {
    status: matches.length === 0 ? "not_found" : conflicts.length ? "conflict" : "matched",
    matches,
    conflicts,
  };
}

export function businessFactSourceLabel(fact: BusinessFact): string {
  return fact.sourceLabel ?? (fact.sourceType === "live_system" ? "Connected system" : fact.sourceType === "owner_structured" ? "Business details" : "Business knowledge");
}
