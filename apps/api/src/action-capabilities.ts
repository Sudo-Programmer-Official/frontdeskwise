import {
  actionDestinationUrl,
  actionProviderForFlow,
  actionReadiness,
  isContactField,
  type ActionExecutionMode,
  type ActionFlow,
} from "./action-flows.js";

export type ActionSetupStatus = "DRAFT" | "NEEDS_SETUP" | "READY";
export type ActionCompletionType = "link" | "provider" | "phone" | "email" | "handoff" | "webhook" | "collect_details";

export type ActionCapability = {
  intent: string;
  completionType: ActionCompletionType;
  destination: string | null;
  provider: string | null;
  requiredInputs: string[];
  recommendedInputs: string[];
};

export type ActionRelationship = {
  workflowCount: number;
  workflowIds: string[];
  workflowNames: string[];
};

export type ActionCapabilityProjection = ActionCapability & ActionRelationship & {
  setupStatus: ActionSetupStatus;
};

function normalized(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function normalizedUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString().toLowerCase();
  } catch {
    return normalized(value).replace(/\/+$/, "") || null;
  }
}

export function actionIntent(action: Pick<ActionFlow, "key" | "name" | "description" | "actionType">): string {
  const text = normalized(`${action.key} ${action.name} ${action.description} ${action.actionType}`);
  if (/demo|trial/.test(text)) return "demo_request";
  if (/enroll|registration|swim lesson|class/.test(text)) return "enrollment";
  if (/waitlist|waiting list/.test(text)) return "waitlist_join";
  if (/quote|estimate/.test(text)) return "quote_request";
  if (/appointment|consultation|book|schedule|reservation/.test(text)) return "appointment_booking";
  if (/emergency/.test(text)) return "emergency_call";
  if (/call|phone/.test(text)) return "business_call";
  if (/contact|lead|message|reach/.test(text)) return "team_contact";
  return normalized(action.actionType) || normalized(action.key) || "custom_action";
}

export function actionCompletionType(action: Pick<ActionFlow, "executionMode" | "completion" | "destination" | "actionType">): ActionCompletionType {
  const executionMode = action.executionMode as ActionExecutionMode | undefined;
  if (executionMode === "DIRECT_LINK" || actionDestinationUrl(action)) return "link";
  if (executionMode === "PROVIDER_FLOW" || action.completion.completionMode === "booking_connector" || action.completion.completionMode === "external_provider") return "provider";
  if (executionMode === "PHONE" || action.actionType === "call_business" || action.actionType === "call_emergency") return "phone";
  if (executionMode === "EMAIL") return "email";
  if (executionMode === "HANDOFF" || action.completion.completionMode === "human_follow_up") return "handoff";
  if (executionMode === "API_ACTION" || action.completion.connector || action.completion.completionMode === "api_webhook") return "webhook";
  return "collect_details";
}

function configuredRequiredInputs(action: ActionFlow): string[] {
  const mappedInputs = Object.keys(action.completion.linkTemplate?.fieldMappings ?? {});
  if (mappedInputs.length) return mappedInputs;

  const configured = (action.requiredFields?.length
    ? action.requiredFields
    : action.fields.filter((field) => field.required && field.visibility !== "hidden").map((field) => field.key));
  const nonContact = configured.filter((key) => {
    const field = action.fields.find((candidate) => candidate.key === key);
    return !field || !isContactField(field);
  });

  // A standalone lead/contact Action technically needs contact information to
  // submit its outcome. For Actions that are invoked by a Workflow, contact
  // capture remains a Workflow concern and is therefore recommended instead.
  if (!nonContact.length && (action.key === "capture_lead" || action.actionType === "contact_team") && !action.steps?.length) {
    return configured.filter((key) => {
      const field = action.fields.find((candidate) => candidate.key === key);
      return Boolean(field && isContactField(field));
    });
  }
  return nonContact;
}

export function actionCapability(action: ActionFlow): ActionCapability {
  const requiredInputs = [...new Set(configuredRequiredInputs(action))];
  const recommendedInputs = [...new Set(action.fields
    .filter((field) => field.visibility !== "hidden" && !requiredInputs.includes(field.key))
    .map((field) => field.key))];
  return {
    intent: actionIntent(action),
    completionType: actionCompletionType(action),
    destination: normalizedUrl(actionDestinationUrl(action)),
    provider: actionProviderForFlow(action),
    requiredInputs,
    recommendedInputs,
  };
}

export function actionSetupStatus(action: ActionFlow): ActionSetupStatus {
  const readiness = actionReadiness(action);
  if (readiness.ready) return "READY";
  if (action.origin === "discovered" || action.lifecycleStatus === "needs_review" || action.lifecycleStatus === "discovered") return "DRAFT";
  return "NEEDS_SETUP";
}

function workflowName(action: ActionFlow): string {
  const configured = action.completion.workflow?.name?.trim();
  return configured || action.name;
}

export function actionRelationships(actions: ActionFlow[], action: ActionFlow): ActionRelationship {
  const target = actions.find((candidate) => candidate.id === action.id);
  const targetIsCurrent = Boolean(target && target.enabled !== false && target.lifecycleStatus !== "disabled");
  if (!targetIsCurrent) return { workflowCount: 0, workflowIds: [], workflowNames: [] };

  const references = actions.filter((candidate) => {
    // A workflow is only visible when its owner record is still current. This
    // keeps archived/disabled workflows from being reported by Actions while
    // the Workflows library correctly hides them.
    if (!candidate.steps?.length || candidate.enabled === false || candidate.lifecycleStatus === "disabled") return false;
    const workflowActionId = candidate.completion.workflow?.actionId;
    // Most workflows explicitly point at their outcome Action. Workflows
    // created before that metadata existed are stored directly on the Action,
    // so the current record is also a valid relationship target. Keeping both
    // cases here makes Actions and Workflows project the same record set.
    return workflowActionId ? workflowActionId === action.id : candidate.id === action.id;
  });
  const uniqueReferences = [...new Map(references.map((reference) => [reference.id, reference])).values()];
  const names = [...new Set(uniqueReferences.map(workflowName).filter(Boolean))];
  return { workflowCount: uniqueReferences.length, workflowIds: uniqueReferences.map((reference) => reference.id), workflowNames: names };
}

export function projectActionCapability(actions: ActionFlow[], action: ActionFlow): ActionCapabilityProjection {
  return {
    ...actionCapability(action),
    ...actionRelationships(actions, action),
    setupStatus: actionSetupStatus(action),
  };
}

function sameSet(left: string[], right: string[]): boolean {
  const a = [...new Set(left.map(normalized))].sort();
  const b = [...new Set(right.map(normalized))].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export function actionsCompatible(existing: ActionFlow, candidate: ActionFlow): boolean {
  const left = actionCapability(existing);
  const right = actionCapability(candidate);
  if (left.intent !== right.intent || left.completionType !== right.completionType) return false;
  if (left.provider && right.provider && normalized(left.provider) !== normalized(right.provider)) return false;
  if (left.destination && right.destination && left.destination !== right.destination) return false;
  return sameSet(left.requiredInputs, right.requiredInputs);
}

export function findCompatibleAction(actions: ActionFlow[], candidate: ActionFlow): ActionFlow | null {
  return actions.find((existing) => actionsCompatible(existing, candidate)) ?? null;
}

