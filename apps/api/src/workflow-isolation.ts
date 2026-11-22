import type { ActionFlow } from "./action-flows.js";

export type WorkflowIsolationInput = {
  businessId: string;
  businessName: string;
  businessAliases?: string[];
  activeBusinessIdentifiers?: string[];
  activeActionIdentifiers?: string[];
  currentProviders?: string[];
  foreignBusinessNames?: string[];
  foreignActionIdentifiers?: string[];
  foreignProviders?: string[];
  requestedBusinessId?: string | null;
  requestedContextBusinessId?: string | null;
  requestedOrganizationId?: string | null;
  currentOrganizationId?: string | null;
  requestedContextVersion?: number | null;
  currentContextVersion?: number | null;
};

export type WorkflowIsolationResult =
  | { ok: true }
  | { ok: false; code: "business_mismatch" | "organization_mismatch" | "context_mismatch" | "foreign_business" | "foreign_action" | "foreign_provider"; identifier: string };

function compact(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function normalized(value: string): string {
  return compact(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function identityForms(value: string): Set<string> {
  const forms = new Set<string>();
  const compactValue = compact(value);
  if (!compactValue) return forms;
  forms.add(normalized(compactValue));
  try {
    const url = new URL(/^https?:\/\//i.test(compactValue) ? compactValue : `https://${compactValue}`);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    forms.add(normalized(hostname));
    const root = hostname.split(".")[0];
    if (root) forms.add(normalized(root));
  } catch {
    // Plain business names are expected and do not need URL parsing.
  }
  return forms;
}

function refersToActiveBusiness(identifier: string, activeIdentifiers: string[]): boolean {
  const candidateForms = identityForms(identifier);
  if (!candidateForms.size) return false;
  return activeIdentifiers.some((activeIdentifier) => {
    const activeForms = identityForms(activeIdentifier);
    if ([...candidateForms].some((form) => activeForms.has(form))) return true;
    return [...activeForms].some((form) => form.length >= 7 && [...candidateForms].some((candidate) => candidate.includes(form)));
  });
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
  if (input.requestedOrganizationId && input.currentOrganizationId && input.requestedOrganizationId !== input.currentOrganizationId) {
    return { ok: false, code: "organization_mismatch", identifier: input.requestedOrganizationId };
  }
  if (input.requestedContextVersion !== null && input.requestedContextVersion !== undefined
    && input.currentContextVersion !== null && input.currentContextVersion !== undefined
    && input.requestedContextVersion !== input.currentContextVersion) {
    return { ok: false, code: "context_mismatch", identifier: String(input.requestedContextVersion) };
  }

  const text = workflowText(action);
  const activeIdentifiers = [
    input.businessName,
    ...(input.businessAliases ?? []),
    ...(input.activeBusinessIdentifiers ?? []),
  ].filter((value): value is string => Boolean(compact(value)));
  const foreignBusinessNames = (input.foreignBusinessNames ?? []).filter((name) => !refersToActiveBusiness(name, activeIdentifiers));
  if (foreignBusinessNames.find((name) => containsIdentifier(text, name))) {
    const identifier = foreignBusinessNames.find((name) => containsIdentifier(text, name)) as string;
    return { ok: false, code: "foreign_business", identifier };
  }
  const foreignActionIdentifiers = (input.foreignActionIdentifiers ?? []).filter((identifier) => !refersToActiveBusiness(identifier, [
    ...activeIdentifiers,
    ...(input.activeActionIdentifiers ?? []),
  ]));
  if (foreignActionIdentifiers.find((identifier) => containsIdentifier(text, identifier))) {
    const identifier = foreignActionIdentifiers.find((candidate) => containsIdentifier(text, candidate)) as string;
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
