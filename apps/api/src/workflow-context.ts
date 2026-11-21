import type { ActionFlow } from "./action-flows.js";
import type { BusinessFact } from "./business-knowledge.js";
import type { ActionResource } from "./action-registry.js";
import { buildCanonicalBusinessModel, getBusinessContext, type BusinessContextInput, type BusinessContextProvenance } from "./business-context.js";

export type WorkflowContextProvenance = {
  source: "owner_verified" | "owner_knowledge" | "website" | "integration" | "inferred";
  authority: "verified" | "supported" | "suggested";
  confidence: number;
  sourceLabel?: string;
};

export type WorkflowBusinessContext = {
  businessName: string;
  businessType: string;
  summary?: string;
  primaryGoal: string | null;
  services: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  products: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  audiences: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  pricing: { verified: boolean; summary: string[]; provenance: WorkflowContextProvenance[] };
  locations: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  hours: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  providers: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  approvedActions: Array<{ key: string; name: string; actionType: string; provenance: WorkflowContextProvenance }>;
  discoveredCtas: Array<{ label: string; url?: string; provenance: WorkflowContextProvenance }>;
  knownPolicies: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  knowledgeSummary: Array<{ value: string; provenance: WorkflowContextProvenance }>;
  knowledgeGaps: string[];
  existingWorkflows: Array<{
    key: string;
    name: string;
    actionType: string;
    provider: string | null;
    executionMode: string | null;
    version: number;
    stepTypes: string[];
    fieldKeys: string[];
  }>;
};

type WorkflowContextChunk = { content: string; sourceId: string };
type WorkflowContextSource = { id: string; title: string; url: string; crawlStatus: string };
type WorkflowContextGap = { question: string; status: string };

export type WorkflowContextInput = {
  businessId?: string;
  businessName: string;
  businessType?: string | null;
  location?: string | null;
  primaryAction?: ActionFlow | null;
  actions: ActionFlow[];
  actionResources: ActionResource[];
  facts: BusinessFact[];
  chunks: WorkflowContextChunk[];
  sources: WorkflowContextSource[];
  knowledgeGaps: WorkflowContextGap[];
  privacyNoticeUrl?: string | null;
  conversationQuestions?: string[];
  now?: string | Date;
};

function compact(value: unknown, maxLength = 240): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, maxLength) : "";
}

function factValue(fact: BusinessFact): string {
  return compact(fact.valueText || fact.value, 300);
}

function factProvenance(fact: BusinessFact): WorkflowContextProvenance {
  const source = fact.sourceType === "owner_structured" ? "owner_verified"
    : fact.sourceType === "owner_knowledge" ? "owner_knowledge"
      : fact.sourceType === "live_system" ? "integration"
        : fact.sourceType === "website" || fact.sourceType === "document" ? "website" : "inferred";
  const authority = source === "owner_verified" || source === "integration" ? "verified" : source === "inferred" ? "suggested" : "supported";
  return { source, authority, confidence: Math.max(0, Math.min(1, fact.confidence)), ...(fact.sourceLabel ? { sourceLabel: fact.sourceLabel } : {}) };
}

function uniqueEntries(entries: Array<{ value: string; provenance: WorkflowContextProvenance }>): Array<{ value: string; provenance: WorkflowContextProvenance }> {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    const key = entry.value.toLowerCase();
    if (!entry.value || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

function factEntries(facts: BusinessFact[], kind: BusinessFact["kind"]): Array<{ value: string; provenance: WorkflowContextProvenance }> {
  return uniqueEntries(facts.filter((fact) => fact.active && fact.kind === kind).map((fact) => ({ value: `${fact.subject}: ${fact.predicate} — ${factValue(fact)}`, provenance: factProvenance(fact) })));
}

function workflowProvider(action: ActionFlow): string | null {
  if (action.provider?.trim()) return action.provider.trim().toLowerCase();
  for (const step of action.steps ?? []) {
    const provider = step.config?.provider;
    if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  }
  return null;
}

function workflowProvenance(value: BusinessContextProvenance): WorkflowContextProvenance {
  const source = value.authority === "integration" ? "integration"
    : value.sourceType === "website" ? "website"
      : value.sourceType === "owner_knowledge" ? "owner_knowledge"
        : value.sourceType === "owner_structured" ? "owner_verified" : "inferred";
  const authority = value.authority === "owner_verified" || value.authority === "system_of_record" || value.authority === "integration" ? "verified"
    : value.authority === "inferred" ? "suggested" : "supported";
  return { source, authority, confidence: value.confidence, ...(value.sourceLabel ? { sourceLabel: value.sourceLabel } : {}) };
}

function workflowEntry(value: string, provenance: BusinessContextProvenance): { value: string; provenance: WorkflowContextProvenance } {
  return { value, provenance: workflowProvenance(provenance) };
}

export function buildWorkflowContext(input: WorkflowContextInput): WorkflowBusinessContext {
  const modelInput: BusinessContextInput = { businessId: input.businessId ?? "workflow-context", ...input };
  const model = buildCanonicalBusinessModel(modelInput);
  const projection = getBusinessContext(model, "workflow_generation");
  const actionServices = projection.conversion.approvedActions
    .filter((action) => !["capture_lead", "contact_team"].includes(action.key))
    .map((action) => workflowEntry(`${action.name}: ${action.description}`.trim(), action.provenance));
  const services = [...projection.offerings.services.map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance)), ...actionServices];
  const products = [...projection.offerings.products, ...projection.offerings.plans].map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance));
  const audiences = projection.profile.audiences.map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance));
  const locations = projection.profile.locations.map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance));
  const hours = projection.profile.hours.map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance));
  const knownPolicies = projection.operations.policies.map((fact) => workflowEntry(`${fact.subject}: ${fact.predicate} — ${fact.valueText}`, fact.provenance));
  if (input.privacyNoticeUrl?.trim()) knownPolicies.push({ value: `Privacy notice: ${input.privacyNoticeUrl.trim()}`, provenance: { source: "owner_verified", authority: "verified", confidence: 1 } });
  const dedupe = (entries: Array<{ value: string; provenance: WorkflowContextProvenance }>) => [...new Map(entries.map((item) => [item.value.toLowerCase(), item])).values()].slice(0, 20);
  return {
    businessName: model.businessName,
    businessType: model.businessType,
    summary: model.summary,
    primaryGoal: model.conversion.primaryGoal,
    services: dedupe([...services]),
    products: dedupe(products),
    audiences: dedupe(audiences),
    pricing: {
      verified: projection.offerings.pricing.length > 0 && projection.offerings.pricing.every((fact) => fact.status === "VERIFIED"),
      summary: projection.offerings.pricing.map((fact) => fact.valueText).slice(0, 10),
      provenance: projection.offerings.pricing.map((fact) => workflowProvenance(fact.provenance)).slice(0, 10),
    },
    locations: dedupe(locations),
    hours: dedupe(hours),
    providers: projection.systems.providers.map((value) => ({ value, provenance: { source: "integration", authority: "verified", confidence: 1 } as WorkflowContextProvenance })),
    approvedActions: projection.conversion.approvedActions.map((action) => ({ key: action.key, name: action.name, actionType: action.actionType, provenance: workflowProvenance(action.provenance) })),
    discoveredCtas: projection.conversion.discoveredCtas.map((cta) => ({ label: cta.label, ...(cta.url ? { url: cta.url } : {}), provenance: workflowProvenance(cta.provenance) })),
    knownPolicies: dedupe(knownPolicies),
    knowledgeSummary: model.knowledge.knowledgeSummary.map((item) => ({ value: item.value, provenance: workflowProvenance(item.provenance) })),
    knowledgeGaps: model.knowledge.gaps,
    existingWorkflows: model.workflowKnowledge.map((workflow) => ({ key: workflow.key, name: workflow.name, actionType: workflow.actionType, provider: workflow.provider, executionMode: workflow.executionMode, version: workflow.version, stepTypes: workflow.stepTypes, fieldKeys: workflow.requiredFields })),
  };
}

function legacyWorkflowContext(input: WorkflowContextInput): WorkflowBusinessContext {
  const activeFacts = input.facts.filter((fact) => fact.active);
  const pricingFacts = activeFacts.filter((fact) => fact.kind === "pricing");
  const verifiedPricing = pricingFacts.filter((fact) => fact.sourceType === "owner_structured" || fact.sourceType === "live_system");
  const factServices = factEntries(activeFacts, "service");
  const productFacts = activeFacts.filter((fact) => fact.kind === "service" && /product|plan|package/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`));
  const actionServices = input.actions
    .filter((action) => action.enabled && action.lifecycleStatus !== "disabled" && !["capture_lead", "contact_team"].includes(action.key))
    .map((action) => ({ value: `${action.name}: ${action.description}`.trim(), provenance: { source: action.origin === "discovered" ? "website" : "owner_verified", authority: action.origin === "discovered" ? "supported" : "verified", confidence: action.confidence } as WorkflowContextProvenance }));
  const providers = uniqueEntries([
    ...input.actions.map((action) => {
      const provider = workflowProvider(action);
      return provider ? { value: provider, provenance: { source: "integration", authority: "verified", confidence: 1 } as WorkflowContextProvenance } : null;
    }).filter((value): value is { value: string; provenance: WorkflowContextProvenance } => Boolean(value)),
    ...input.actionResources.map((resource) => ({ value: resource.provider, provenance: { source: "integration", authority: "verified", confidence: 1 } as WorkflowContextProvenance })),
  ]);
  const knownPolicies = factEntries(activeFacts, "policy");
  if (input.privacyNoticeUrl?.trim()) knownPolicies.push({ value: `Privacy notice: ${input.privacyNoticeUrl.trim()}`, provenance: { source: "owner_verified", authority: "verified", confidence: 1 } });
  const ctas = input.actions.flatMap((action) => {
    const url = action.completion.linkUrl ?? action.destination?.url;
    const label = action.completion.linkLabel ?? action.completion.submitLabel ?? action.destination?.label;
    return label || url ? [{ label: label ?? action.name, ...(url ? { url } : {}), provenance: { source: action.origin === "discovered" ? "website" : "owner_verified", authority: action.origin === "discovered" ? "supported" : "verified", confidence: action.confidence } as WorkflowContextProvenance }] : [];
  }).slice(0, 20);
  const sourceById = new Map(input.sources.map((source) => [source.id, source]));
  const knowledgeSummary = input.chunks
    .filter((chunk) => sourceById.get(chunk.sourceId)?.crawlStatus === "ready")
    .map((chunk) => {
      const source = sourceById.get(chunk.sourceId);
      const text = compact(chunk.content, 280);
      return text ? { value: `${source?.title ?? "Website knowledge"}: ${text}`, provenance: { source: "website", authority: "supported", confidence: 0.7, ...(source?.title ? { sourceLabel: source.title } : {}) } as WorkflowContextProvenance } : null;
    })
    .filter((entry): entry is { value: string; provenance: WorkflowContextProvenance } => Boolean(entry))
    .slice(0, 8);
  const workflows = input.actions.map((action) => ({
    key: action.key,
    name: action.name,
    actionType: action.actionType,
    provider: workflowProvider(action),
    executionMode: action.executionMode ?? null,
    version: action.version ?? 1,
    stepTypes: (action.steps ?? []).map((step) => step.type),
    fieldKeys: action.fields.map((field) => field.key),
  }));
  return {
    businessName: input.businessName,
    businessType: compact(input.businessType) || "Unknown",
    primaryGoal: input.primaryAction ? `${input.primaryAction.name} (${input.primaryAction.actionType})` : null,
    services: uniqueEntries([...factServices, ...actionServices]),
    products: uniqueEntries(productFacts.map((fact) => ({ value: `${fact.subject}: ${fact.predicate} — ${factValue(fact)}`, provenance: factProvenance(fact) }))),
    audiences: factEntries(activeFacts, "custom").filter((entry) => /audience|customer|parent|team|individual|student/i.test(entry.value)),
    pricing: {
      verified: verifiedPricing.length > 0 && verifiedPricing.length === pricingFacts.length,
      summary: pricingFacts.map(factValue).filter(Boolean).slice(0, 10),
      provenance: pricingFacts.map(factProvenance).slice(0, 10),
    },
    locations: uniqueEntries([
      ...(input.location?.trim() ? [{ value: input.location.trim(), provenance: { source: "owner_verified", authority: "verified", confidence: 1 } as WorkflowContextProvenance }] : []),
      ...factEntries(activeFacts, "location"),
    ]),
    hours: factEntries(activeFacts, "hours"),
    providers,
    approvedActions: input.actions.filter((action) => action.enabled && ["approved", "active"].includes(action.lifecycleStatus ?? "active")).map((action) => ({ key: action.key, name: action.name, actionType: action.actionType, provenance: { source: action.origin === "discovered" ? "website" : "owner_verified", authority: action.origin === "discovered" ? "supported" : "verified", confidence: action.confidence } })),
    discoveredCtas: ctas,
    knownPolicies: uniqueEntries(knownPolicies),
    knowledgeSummary,
    knowledgeGaps: input.knowledgeGaps.filter((gap) => gap.status === "open").map((gap) => compact(gap.question, 240)).filter(Boolean).slice(0, 20),
    existingWorkflows: workflows,
  };
}
