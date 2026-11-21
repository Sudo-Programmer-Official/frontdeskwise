import { classifyVisitorRequest, type ActionFlow } from "./action-flows.js";
import type { RetrievalIntent } from "./retrieval.js";

export type PrimaryCta = {
  actionId: string;
  key: string;
  label: string;
  executionMode: NonNullable<ActionFlow["executionMode"]>;
  trackingKey: string;
  url?: string;
  question?: string;
};

type PrimaryActionBusiness = {
  primaryActionId?: string | null;
  actions: ActionFlow[];
};

const blockedIntents = new Set<RetrievalIntent>(["privacy", "policy", "support", "contact", "permissions", "hours", "location"]);

export function primaryActionForBusiness(business: PrimaryActionBusiness): ActionFlow | null {
  if (!business.primaryActionId) return null;
  const action = business.actions.find((candidate) => candidate.id === business.primaryActionId) ?? null;
  if (!action || !action.enabled || !["approved", "active"].includes(action.lifecycleStatus ?? "active")) return null;
  return action;
}

export function primaryCtaForAction(action: ActionFlow): PrimaryCta | null {
  const url = action.completion.linkUrl ?? action.destination?.url ?? undefined;
  const executionMode = action.executionMode ?? (url ? "DIRECT_LINK" : "FORM_FLOW");
  if (executionMode === "DIRECT_LINK" && !url) return null;
  return {
    actionId: action.id,
    key: action.key,
    label: action.completion.linkLabel ?? action.destination?.label ?? action.name,
    executionMode,
    trackingKey: action.trackingKey ?? action.key,
    ...(url ? { url } : {}),
    ...(!url && action.triggerPhrases[0] ? { question: action.triggerPhrases[0] } : {}),
  };
}

export function shouldAttachPrimaryCta(
  action: ActionFlow,
  question: string,
  intent: RetrievalIntent,
): boolean {
  const policy = action.attachmentPolicy ?? "explicit_request_only";
  if (policy === "never_auto" || blockedIntents.has(intent)) return false;
  const visitor = classifyVisitorRequest(question);
  const directDemoAction = action.executionMode === "DIRECT_LINK"
    && (action.actionType === "request_demo" || action.key === "open_link")
    && /\b(demo|trial)\b/i.test(`${action.name} ${action.completion.linkLabel ?? ""}`);
  if (directDemoAction && /\b(book|schedule)\b.{0,24}\b(demo|trial)\b/i.test(question)) return false;
  if (policy === "always") return true;
  if (policy === "explicit_request_only") return visitor.mode === "transactional";
  if (policy === "high_intent_only") {
    return visitor.mode === "transactional"
      || ["booking", "getting_started"].includes(intent) && /\b(book|schedule|enroll|register|join|sign|start|begin|try|demo)\b/i.test(question);
  }
  const salesIntent = ["services", "pricing", "booking", "getting_started"].includes(intent)
    || intent === "general" && /\b(compare|comparison|alternative|alternatives|switch|replace|software|platform|tool|tools|solution|solutions|business|salon|booking|bookings|customers|growth|grow|trial|demo)\b/i.test(question);
  if (!salesIntent) return false;
  if (visitor.mode === "transactional") return true;
  return /\b(what|how|does|can|tell|which|compare|pricing|price|cost|get started|try|demo|trial)\b/i.test(question);
}

export function primaryCtaForQuestion(
  business: PrimaryActionBusiness,
  question: string,
  intent: RetrievalIntent,
): PrimaryCta | null {
  const action = primaryActionForBusiness(business);
  if (!action || !shouldAttachPrimaryCta(action, question, intent)) return null;
  return primaryCtaForAction(action);
}
