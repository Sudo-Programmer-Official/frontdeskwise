import type { ActionFlow, ConversationActionState } from "./action-flows.js";

export type ActionRisk = "READ_ONLY" | "LOW_RISK_WRITE" | "MEDIUM_RISK" | "HIGH_RISK";

export type ActionPolicyDecision = {
  allowed: boolean;
  risk: ActionRisk;
  reason: string | null;
};

const CONNECTOR_PROVIDERS = new Set([
  "generic_webhook",
  "email",
  "hubspot",
  "jackrabbit",
  "square",
  "mindbody",
  "calendly",
]);

function actionRisk(action: ActionFlow): ActionRisk {
  if (action.executionMode === "DIRECT_LINK" || action.executionMode === "PHONE") return "READ_ONLY";
  if (action.safetyPolicy === "manual_review" || action.safetyPolicy === "healthcare_emergency") return "HIGH_RISK";
  if (action.executionMode === "HANDOFF" || action.executionMode === "EMAIL" || action.actionType === "contact_team") return "LOW_RISK_WRITE";
  if (action.executionMode === "PROVIDER_FLOW" || action.executionMode === "API_ACTION" || action.completion.leadStatus === "booked") return "MEDIUM_RISK";
  return "LOW_RISK_WRITE";
}

export function validateActionExecutionPolicy(
  action: ActionFlow,
  state: ConversationActionState,
  businessId: string,
): ActionPolicyDecision {
  const risk = actionRisk(action);
  if (action.businessId && action.businessId !== businessId) {
    return { allowed: false, risk, reason: "Action belongs to a different business" };
  }
  if (!action.enabled || action.lifecycleStatus === "disabled") {
    return { allowed: false, risk, reason: "Action is disabled" };
  }
  if (action.lifecycleStatus === "needs_review" || action.lifecycleStatus === "discovered") {
    return { allowed: false, risk, reason: "Action has not been approved" };
  }
  if (action.safetyPolicy === "manual_review" && !action.completion.requiresStaff) {
    return { allowed: false, risk, reason: "Manual-review actions must require staff approval" };
  }
  const connector = action.completion.connector;
  if (connector) {
    if (!CONNECTOR_PROVIDERS.has(connector.provider)) {
      return { allowed: false, risk, reason: "Action connector provider is not allowed" };
    }
    if (connector.provider === "generic_webhook" && !connector.integrationId && !connector.endpoint) {
      return { allowed: false, risk, reason: "Webhook action requires a server-validated endpoint or integration" };
    }
    if (connector.provider === "hubspot" && !connector.integrationId) {
      return { allowed: false, risk, reason: "Connected action providers require an integration" };
    }
  }
  for (const [key, value] of Object.entries(state.values)) {
    if (typeof value !== "string" || value.length > 4_000) {
      return { allowed: false, risk, reason: `Action value ${key} is invalid` };
    }
  }
  return { allowed: true, risk, reason: null };
}

