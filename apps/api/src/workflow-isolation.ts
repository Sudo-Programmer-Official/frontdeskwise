import type { ActionFlow } from "./action-flows.js";

export type WorkflowIsolationInput = {
  businessId: string;
  businessName: string;
  currentProviders?: string[];
  foreignBusinessNames?: string[];
  foreignActionIdentifiers?: string[];
  foreignProviders?: string[];
  requestedBusinessId?: string | null;
  requestedContextBusinessId?: string | null;
  requestedContextVersion?: number | null;
  currentContextVersion?: number | null;
};

export type WorkflowIsolationResult =
  | { ok: true }
  | { ok: false; code: "business_mismatch" | "context_mismatch" | "foreign_business" | "foreign_action" | "foreign_provider"; identifier: string };

function compact(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalized(value: string): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function workflowText(action: ActionFlow): string {
  return JSON.stringify({
    key: action.key,
    name: action.name,
    description: action.description,
    triggerPhrases: action.triggerPhrases,
    triggerIntents: action.triggerIntents,
    fields: action.fields,
    steps: action.steps,
    completion: action.completion,
    destination: action.destination,
    provider: action.provider,
  });
}

function containsIdentifier(text: string, identifier: string): boolean {
  const token = normalized(identifier);
  const generic = new Set([
    "capturealead",
    "contactteam",
    "requestdemo",
    "bookanappointment",
    "requestaquote",
    "getstarted",
    "trythedemo",
    "sendvisitorstoalink",
  ]);
  const minimumLength = compact(identifier).split(" ").filter(Boolean).length > 1 ? 5 : 7;
  return token.length >= minimumLength && !generic.has(token) && normalized(text).includes(token);
}

function providerForAction(action: ActionFlow): string | null {
  if (compact(action.provider)) return compact(action.provider).toLowerCase();
  for (const step of action.steps ?? []) {
    const provider = step.config?.provider;
    if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  }
  return null;
}

/**
 * This is deliberately independent of storage so it can be exercised without
 * a database. The server supplies identifiers belonging to sibling businesses
 * in the same organization, while the client can use the same contract before
 * it renders a draft.
 */
export function validateWorkflowTenantIsolation(action: ActionFlow, input: WorkflowIsolationInput): WorkflowIsolationResult {
  if (action.businessId && action.businessId !== input.businessId) {
    return { ok: false, code: "business_mismatch", identifier: action.businessId };
  }
  if (input.requestedBusinessId && input.requestedBusinessId !== input.businessId) {
    return { ok: false, code: "business_mismatch", identifier: input.requestedBusinessId };
  }
  if (input.requestedContextBusinessId && input.requestedContextBusinessId !== input.businessId) {
    return { ok: false, code: "context_mismatch", identifier: input.requestedContextBusinessId };
  }
  if (input.requestedContextVersion !== null && input.requestedContextVersion !== undefined
    && input.currentContextVersion !== null && input.currentContextVersion !== undefined
    && input.requestedContextVersion !== input.currentContextVersion) {
    return { ok: false, code: "context_mismatch", identifier: String(input.requestedContextVersion) };
  }

  const text = workflowText(action);
  if (input.foreignBusinessNames?.find((name) => containsIdentifier(text, name))) {
    const identifier = input.foreignBusinessNames.find((name) => containsIdentifier(text, name)) as string;
    return { ok: false, code: "foreign_business", identifier };
  }
  if (input.foreignActionIdentifiers?.find((identifier) => containsIdentifier(text, identifier))) {
    const identifier = input.foreignActionIdentifiers.find((candidate) => containsIdentifier(text, candidate)) as string;
    return { ok: false, code: "foreign_action", identifier };
  }

  const currentProviders = new Set((input.currentProviders ?? []).map((provider) => compact(provider).toLowerCase()).filter(Boolean));
  const provider = providerForAction(action);
  if (provider && !currentProviders.has(provider) && input.foreignProviders?.some((candidate) => compact(candidate).toLowerCase() === provider)) {
    return { ok: false, code: "foreign_provider", identifier: provider };
  }

  return { ok: true };
}

export function workflowIsolationMessage(result: Exclude<WorkflowIsolationResult, { ok: true }>): string {
  const subject = result.code === "foreign_business"
    ? "another business"
    : result.code === "foreign_action"
      ? "another business action"
      : result.code === "foreign_provider"
        ? "another business provider"
        : "a different workflow context";
  return `Workflow rejected: it references ${subject} (${result.identifier}) for the active business.`;
}
