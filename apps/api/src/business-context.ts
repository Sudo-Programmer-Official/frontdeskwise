import { createHash } from "node:crypto";
import type { ActionFlow } from "./action-flows.js";
import type { ActionResource } from "./action-registry.js";
import {
  businessFactKey,
  factAuthorityRank,
  factFreshnessScore,
  type BusinessFact,
  type BusinessFactAuthority,
} from "./business-knowledge.js";

export const BUSINESS_CONTEXT_PURPOSES = [
  "workflow_generation",
  "customer_answer",
  "conversion_routing",
  "lead_qualification",
] as const;

export type BusinessContextPurpose = typeof BUSINESS_CONTEXT_PURPOSES[number];
export type BusinessContextStatus = "VERIFIED" | "SUPPORTED" | "INFERRED" | "SUGGESTED" | "STALE" | "CONFLICTED" | "UNKNOWN";

export type BusinessContextProvenance = {
  sourceType: string;
  authority: BusinessFactAuthority | "integration" | "public_business_source";
  sourceId?: string | null;
  sourceUrl?: string | null;
  sourceLabel?: string | null;
  confidence: number;
  lastSeenAt?: string | null;
  freshnessPolicy?: string | null;
};

export type BusinessContextFact = {
  id: string;
  key: string;
  kind: BusinessFact["kind"];
  subject: string;
  predicate: string;
  value: BusinessFact["value"];
  valueText: string;
  status: BusinessContextStatus;
  critical: boolean;
  usableForCritical: boolean;
  conflictValues: string[];
  provenance: BusinessContextProvenance;
};

export type BusinessContextAction = {
  key: string;
  name: string;
  actionType: string;
  description: string;
  provider: string | null;
  executionMode: string | null;
  enabled: boolean;
  lifecycleStatus: string | null;
  provenance: BusinessContextProvenance;
  destination: { url: string; label?: string } | null;
  fields: Array<{ key: string; label: string; type: string; required: boolean }>;
  stepTypes: string[];
};

export type BusinessContextResource = {
  id: string;
  type: string;
  name: string;
  provider: string;
  location: string | null;
  program: string | null;
  day: string | null;
  startTime: string | null;
  endTime: string | null;
  price: string | number | null;
  availability: number | null;
  status: string;
  destination: { url: string; label?: string } | null;
  provenance: BusinessContextProvenance;
};

export type BusinessContextInput = {
  businessId: string;
  businessName: string;
  businessType?: string | null;
  location?: string | null;
  primaryAction?: ActionFlow | null;
  actions: ActionFlow[];
  actionResources: ActionResource[];
  facts: BusinessFact[];
  chunks: Array<{ content: string; sourceId: string }>;
  sources: Array<{ id: string; title: string; url: string; crawlStatus: string; lastCrawledAt?: string | null }>;
  knowledgeGaps: Array<{ question: string; status: string; occurrenceCount?: number }>;
  conversationQuestions?: string[];
  privacyNoticeUrl?: string | null;
  now?: string | Date;
};

export type CanonicalBusinessModel = {
  schemaVersion: 1;
  businessId: string;
  businessName: string;
  businessType: string;
  location: string | null;
  generatedAt: string;
  materialFingerprint: string;
  summary: string;
  profile: {
    description: BusinessContextFact | null;
    audiences: BusinessContextFact[];
    locations: BusinessContextFact[];
    hours: BusinessContextFact[];
    contacts: BusinessContextFact[];
  };
  offerings: {
    services: BusinessContextFact[];
    products: BusinessContextFact[];
    plans: BusinessContextFact[];
    pricing: BusinessContextFact[];
  };
  operations: {
    schedules: BusinessContextFact[];
    availability: BusinessContextFact[];
    policies: BusinessContextFact[];
  };
  conversion: {
    primaryGoal: string | null;
    secondaryGoals: string[];
    approvedActions: BusinessContextAction[];
    discoveredCtas: Array<{ label: string; url?: string; provenance: BusinessContextProvenance }>;
  };
  systems: {
    providers: string[];
    resources: BusinessContextResource[];
  };
  knowledge: {
    facts: BusinessContextFact[];
    knowledgeSummary: Array<{ value: string; provenance: BusinessContextProvenance }>;
    gaps: string[];
  };
  workflowKnowledge: Array<{
    key: string;
    name: string;
    actionType: string;
    provider: string | null;
    executionMode: string | null;
    version: number;
    requiredFields: string[];
    stepTypes: string[];
    completionMode: string | null;
  }>;
  commonCustomerIntents: Array<{ value: string; count: number; provenance: BusinessContextProvenance }>;
  conflicts: Array<{ key: string; values: string[]; winnerId: string; factIds: string[] }>;
};

export type BusinessContextProjection = {
  purpose: BusinessContextPurpose;
  schemaVersion: 1;
  businessId: string;
  businessName: string;
  businessType: string;
  summary: string;
  primaryGoal: string | null;
  profile: CanonicalBusinessModel["profile"];
  offerings: CanonicalBusinessModel["offerings"];
  operations: CanonicalBusinessModel["operations"];
  conversion: CanonicalBusinessModel["conversion"];
  systems: CanonicalBusinessModel["systems"];
  workflowKnowledge: CanonicalBusinessModel["workflowKnowledge"];
  commonCustomerIntents: CanonicalBusinessModel["commonCustomerIntents"];
  relevantFacts: BusinessContextFact[];
  knowledgeGaps: string[];
  constraints: {
    criticalFactsRequireStatus: "VERIFIED";
    usableCriticalStatuses: ["VERIFIED"];
    excludedStatuses: Array<"STALE" | "CONFLICTED" | "UNKNOWN">;
  };
};

export type BusinessContextSnapshot = {
  version: number;
  materialFingerprint: string;
  summary: string;
  generatedAt: string;
  status: "current" | "stale";
};

function compact(value: unknown, maxLength = 280): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function valueSignature(value: string): string {
  return normalized(value);
}

function sourceForFact(fact: BusinessFact, sources: BusinessContextInput["sources"]): BusinessContextInput["sources"][number] | null {
  return fact.sourceId ? sources.find((source) => source.id === fact.sourceId) ?? null : null;
}

function criticalFact(fact: BusinessFact): boolean {
  return fact.kind === "pricing"
    || fact.kind === "availability"
    || fact.kind === "schedule"
    || fact.kind === "policy"
    || /registration|payment|cancellation|legal|privacy|availability|price/i.test(`${fact.subject} ${fact.predicate}`);
}

function statusForFact(fact: BusinessFact, conflict: boolean, now: string | Date): BusinessContextStatus {
  if (factFreshnessScore(fact, now) < 0) return "STALE";
  if (conflict) return "CONFLICTED";
  if (fact.authority === "system_of_record" || fact.authority === "owner_verified") return "VERIFIED";
  if (fact.authority === "inferred") return "INFERRED";
  if (fact.authority === "owner_knowledge" || fact.authority === "document" || fact.authority === "website") return "SUPPORTED";
  return "UNKNOWN";
}

function provenanceForFact(fact: BusinessFact, sources: BusinessContextInput["sources"]): BusinessContextProvenance {
  const source = sourceForFact(fact, sources);
  const authority = fact.sourceType === "website" ? "public_business_source" : fact.authority;
  return {
    sourceType: fact.sourceType,
    authority,
    sourceId: fact.sourceId,
    sourceUrl: source?.url ?? null,
    sourceLabel: fact.sourceLabel ?? source?.title ?? null,
    confidence: fact.confidence,
    lastSeenAt: fact.observedAt,
    freshnessPolicy: fact.freshnessPolicy,
  };
}

function uniqueFacts(facts: BusinessContextFact[]): BusinessContextFact[] {
  const seen = new Set<string>();
  return facts.filter((fact) => {
    const key = `${fact.key}|${valueSignature(fact.valueText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => compact(value, 180)).filter(Boolean))].slice(0, 30);
}

function providerForAction(action: ActionFlow): string | null {
  if (action.provider?.trim()) return action.provider.trim().toLowerCase();
  for (const step of action.steps ?? []) {
    const provider = step.config?.provider;
    if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  }
  return null;
}

function factEntries(facts: BusinessContextFact[], predicate: (fact: BusinessContextFact) => boolean): BusinessContextFact[] {
  return facts.filter(predicate).slice(0, 30);
}

function renderSummary(model: Omit<CanonicalBusinessModel, "summary" | "materialFingerprint" | "generatedAt">): string {
  const services = model.offerings.services.map((fact) => fact.valueText).slice(0, 4);
  const audience = model.profile.audiences.map((fact) => fact.valueText).slice(0, 3);
  const primaryGoal = model.conversion.primaryGoal ?? "not defined";
  const pricing = model.offerings.pricing.length
    ? model.offerings.pricing.some((fact) => fact.status === "VERIFIED") ? "verified pricing is available" : "pricing exists but requires verification"
    : "pricing is unknown";
  const providerText = model.systems.providers.length ? model.systems.providers.join(", ") : "none configured";
  return [
    `${model.businessName} is ${model.businessType}.`,
    `Primary conversion goal: ${primaryGoal}.`,
    services.length ? `Core offerings: ${services.join("; ")}.` : "Core offerings: unknown.",
    audience.length ? `Target audience: ${audience.join("; ")}.` : "Target audience: unknown.",
    `Pricing: ${pricing}.`,
    `Providers: ${providerText}.`,
    model.conversion.approvedActions.length ? `Approved actions: ${model.conversion.approvedActions.map((action) => action.name).slice(0, 4).join(", ")}.` : "Approved actions: none.",
  ].join(" ");
}

export function buildCanonicalBusinessModel(input: BusinessContextInput): CanonicalBusinessModel {
  const now = input.now ?? new Date();
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const groups = new Map<string, BusinessFact[]>();
  for (const fact of input.facts.filter((candidate) => candidate.active)) {
    const key = businessFactKey(fact);
    groups.set(key, [...(groups.get(key) ?? []), fact]);
  }
  const conflicts: CanonicalBusinessModel["conflicts"] = [];
  const canonicalFacts: BusinessContextFact[] = [];
  for (const [key, group] of groups) {
    const freshGroup = group.filter((fact) => factFreshnessScore(fact, now) >= 0);
    const comparableGroup = freshGroup.length ? freshGroup : group;
    const sorted = [...comparableGroup].sort((left, right) => factAuthorityRank(right.authority) - factAuthorityRank(left.authority)
      || factFreshnessScore(right, now) - factFreshnessScore(left, now)
      || right.confidence - left.confidence
      || right.updatedAt.localeCompare(left.updatedAt));
    const values = [...new Set(comparableGroup.map((fact) => valueSignature(fact.valueText)).filter(Boolean))];
    const isConflict = values.length > 1;
    const winner = sorted[0];
    conflicts.push(...(isConflict ? [{ key, values, winnerId: winner.id, factIds: comparableGroup.map((fact) => fact.id) }] : []));
    const winnerSource = sourceById.get(winner.sourceId ?? "");
    canonicalFacts.push({
      id: winner.id,
      key,
      kind: winner.kind,
      subject: winner.subject,
      predicate: winner.predicate,
      value: winner.value,
      valueText: winner.valueText,
      status: statusForFact(winner, isConflict, now),
      critical: criticalFact(winner),
      usableForCritical: !isConflict && criticalFact(winner) && statusForFact(winner, false, now) === "VERIFIED",
      conflictValues: isConflict ? comparableGroup.map((fact) => fact.valueText).slice(0, 10) : [],
      provenance: {
        ...provenanceForFact(winner, input.sources),
        sourceUrl: winnerSource?.url ?? provenanceForFact(winner, input.sources).sourceUrl,
      },
    });
  }
  canonicalFacts.sort((left, right) => left.kind.localeCompare(right.kind) || left.subject.localeCompare(right.subject) || left.predicate.localeCompare(right.predicate));
  const description = canonicalFacts.find((fact) => fact.kind === "identity" && /description|about/i.test(fact.predicate)) ?? null;
  const services = factEntries(canonicalFacts, (fact) => fact.kind === "service" && !/\b(product|plan|package)\b/i.test(`${fact.subject} ${fact.predicate}`));
  const products = factEntries(canonicalFacts, (fact) => fact.kind === "service" && /\b(product|software|capability|package)\b/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`));
  const plans = factEntries(canonicalFacts, (fact) => fact.kind === "service" && /\b(plan|tier|subscription)\b/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`));
  const audiences = factEntries(canonicalFacts, (fact) => fact.kind === "custom" && /audience|customer|parent|team|individual|student/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`));
  const locations = factEntries(canonicalFacts, (fact) => fact.kind === "location");
  if (input.location?.trim()) locations.unshift({
    id: `${input.businessId}:location`, key: "profile|business|location", kind: "location", subject: input.businessName, predicate: "primary location", value: input.location.trim(), valueText: input.location.trim(), status: "VERIFIED", critical: false, usableForCritical: false, conflictValues: [],
    provenance: { sourceType: "owner_structured", authority: "owner_verified", confidence: 1, lastSeenAt: new Date(now).toISOString() },
  });
  const pricing = factEntries(canonicalFacts, (fact) => fact.kind === "pricing");
  const operations = {
    schedules: factEntries(canonicalFacts, (fact) => fact.kind === "schedule"),
    availability: factEntries(canonicalFacts, (fact) => fact.kind === "availability"),
    policies: factEntries(canonicalFacts, (fact) => fact.kind === "policy"),
  };
  const providers = uniqueStrings([
    ...input.actions.map(providerForAction).filter((provider): provider is string => Boolean(provider)),
    ...input.actionResources.map((resource) => resource.provider),
  ]);
  const approvedActions = input.actions.filter((action) => action.enabled && ["approved", "active"].includes(action.lifecycleStatus ?? "active")).map((action): BusinessContextAction => ({
    key: action.key,
    name: action.name,
    actionType: action.actionType,
    description: action.description,
    provider: providerForAction(action),
    executionMode: action.executionMode ?? null,
    enabled: action.enabled,
    lifecycleStatus: action.lifecycleStatus ?? null,
    provenance: { sourceType: action.origin === "discovered" ? "website" : "owner_structured", authority: action.origin === "discovered" ? "public_business_source" : "owner_verified", sourceUrl: action.sourceUrl, sourceLabel: action.sourceLabel ?? action.name, confidence: action.confidence, lastSeenAt: action.updatedAt },
    destination: action.destination ?? (action.completion.linkUrl ? { url: action.completion.linkUrl, ...(action.completion.linkLabel ? { label: action.completion.linkLabel } : {}) } : null),
    fields: action.fields.map((field) => ({ key: field.key, label: field.label, type: field.type, required: field.required })),
    stepTypes: (action.steps ?? []).map((step) => step.type),
  }));
  const discoveredCtas = input.actions.flatMap((action) => {
    const url = action.completion.linkUrl ?? action.destination?.url;
    const label = action.completion.linkLabel ?? action.completion.submitLabel ?? action.destination?.label;
    return label || url ? [{ label: label ?? action.name, ...(url ? { url } : {}), provenance: approvedActions.find((candidate) => candidate.key === action.key)?.provenance ?? { sourceType: "owner_structured", authority: "owner_verified", confidence: action.confidence } }] : [];
  }).slice(0, 20);
  const resources = input.actionResources.map((resource): BusinessContextResource => ({
    id: resource.id, type: resource.type, name: resource.name, provider: resource.provider, location: resource.location, program: resource.program, day: resource.day, startTime: resource.startTime, endTime: resource.endTime, price: resource.price, availability: resource.availability, status: resource.status,
    destination: resource.destination,
    provenance: { sourceType: resource.source === "jackrabbit" || resource.provider === "jackrabbit" ? "integration" : resource.source, authority: resource.provider === "manual" ? "owner_verified" : "integration", sourceLabel: resource.provider, confidence: 1, lastSeenAt: resource.lastSyncedAt ?? resource.updatedAt, freshnessPolicy: resource.provider === "manual" ? "until_replaced" : "realtime" },
  }));
  const knowledgeSummary = input.chunks.filter((chunk) => sourceById.get(chunk.sourceId)?.crawlStatus === "ready").map((chunk) => {
    const source = sourceById.get(chunk.sourceId);
    const text = compact(chunk.content);
    return text ? { value: `${source?.title ?? "Website knowledge"}: ${text}`, provenance: { sourceType: "website", authority: "public_business_source", sourceId: chunk.sourceId, sourceUrl: source?.url ?? null, sourceLabel: source?.title ?? null, confidence: 0.7, lastSeenAt: source?.lastCrawledAt ?? null } as BusinessContextProvenance } : null;
  }).filter((entry): entry is { value: string; provenance: BusinessContextProvenance } => Boolean(entry)).slice(0, 8);
  const gaps = input.knowledgeGaps.filter((gap) => gap.status === "open").map((gap) => compact(gap.question, 240)).filter(Boolean).slice(0, 20);
  const questionCounts = new Map<string, number>();
  for (const question of [...(input.conversationQuestions ?? []), ...gaps]) {
    const normalizedQuestion = compact(question, 180);
    if (normalizedQuestion) questionCounts.set(normalizedQuestion, (questionCounts.get(normalizedQuestion) ?? 0) + 1);
  }
  const commonCustomerIntents = [...questionCounts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 8).map(([value, count]) => ({ value, count, provenance: { sourceType: "conversation", authority: "inferred", confidence: 0.6 } as BusinessContextProvenance }));
  const workflowKnowledge = input.actions.map((action) => ({ key: action.key, name: action.name, actionType: action.actionType, provider: providerForAction(action), executionMode: action.executionMode ?? null, version: action.version ?? 1, requiredFields: action.requiredFields, stepTypes: (action.steps ?? []).map((step) => step.type), completionMode: action.completion.completionMode ?? null }));
  const modelBase = {
    schemaVersion: 1 as const,
    businessId: input.businessId,
    businessName: input.businessName,
    businessType: compact(input.businessType) || "Unknown",
    location: input.location?.trim() || null,
    profile: { description, audiences, locations, hours: factEntries(canonicalFacts, (fact) => fact.kind === "hours"), contacts: factEntries(canonicalFacts, (fact) => fact.kind === "contact") },
    offerings: { services, products, plans, pricing },
    operations,
    conversion: {
      primaryGoal: input.primaryAction ? `${input.primaryAction.name} (${input.primaryAction.actionType})` : null,
      secondaryGoals: uniqueStrings(input.actions.filter((action) => action.id !== input.primaryAction?.id && action.enabled).map((action) => action.name)),
      approvedActions,
      discoveredCtas,
    },
    systems: { providers, resources },
    knowledge: { facts: canonicalFacts, knowledgeSummary, gaps },
    workflowKnowledge,
    commonCustomerIntents,
    conflicts,
  };
  const summary = renderSummary(modelBase);
  const materialFingerprint = createHash("sha256").update(JSON.stringify(modelBase)).digest("hex");
  return { ...modelBase, summary, materialFingerprint, generatedAt: new Date(now).toISOString() };
}

function factsForPurpose(model: CanonicalBusinessModel, purpose: BusinessContextPurpose, query?: string): BusinessContextFact[] {
  const purposeKinds: Record<BusinessContextPurpose, Set<string>> = {
    workflow_generation: new Set(["identity", "service", "location", "hours", "pricing", "policy", "schedule", "availability", "custom"]),
    customer_answer: new Set(["identity", "service", "location", "hours", "pricing", "contact", "policy", "faq", "schedule", "availability", "custom"]),
    conversion_routing: new Set(["identity", "service", "location", "availability", "schedule", "policy", "custom"]),
    lead_qualification: new Set(["identity", "service", "custom", "faq", "policy", "location"]),
  };
  const candidates = model.knowledge.facts.filter((fact) => purposeKinds[purpose].has(fact.kind));
  if (!query?.trim()) return candidates.slice(0, 40);
  const terms = normalized(query).split(" ").filter(Boolean);
  return candidates.filter((fact) => terms.some((term) => normalized(`${fact.subject} ${fact.predicate} ${fact.valueText}`).includes(term))).slice(0, 40);
}

export function getBusinessContext(model: CanonicalBusinessModel, purpose: BusinessContextPurpose, query?: string): BusinessContextProjection {
  return {
    purpose,
    schemaVersion: 1,
    businessId: model.businessId,
    businessName: model.businessName,
    businessType: model.businessType,
    summary: model.summary,
    primaryGoal: model.conversion.primaryGoal,
    profile: model.profile,
    offerings: model.offerings,
    operations: model.operations,
    conversion: purpose === "conversion_routing" || purpose === "workflow_generation" ? model.conversion : { ...model.conversion, discoveredCtas: [] },
    systems: purpose === "workflow_generation" || purpose === "conversion_routing" ? model.systems : { providers: model.systems.providers, resources: [] },
    workflowKnowledge: purpose === "workflow_generation" || purpose === "lead_qualification" ? model.workflowKnowledge : [],
    commonCustomerIntents: purpose === "lead_qualification" || purpose === "workflow_generation" ? model.commonCustomerIntents : [],
    relevantFacts: factsForPurpose(model, purpose, query),
    knowledgeGaps: purpose === "customer_answer" ? [] : model.knowledge.gaps,
    constraints: { criticalFactsRequireStatus: "VERIFIED", usableCriticalStatuses: ["VERIFIED"], excludedStatuses: ["STALE", "CONFLICTED", "UNKNOWN"] },
  };
}

export function createBusinessContextSnapshot(model: CanonicalBusinessModel, previous?: BusinessContextSnapshot | null): BusinessContextSnapshot {
  const unchanged = previous?.materialFingerprint === model.materialFingerprint;
  return {
    version: unchanged ? previous.version : (previous?.version ?? 0) + 1,
    materialFingerprint: model.materialFingerprint,
    summary: model.summary,
    generatedAt: unchanged ? previous.generatedAt : model.generatedAt,
    status: "current",
  };
}
