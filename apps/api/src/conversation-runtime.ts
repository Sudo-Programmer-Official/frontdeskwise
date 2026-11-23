import { actionProviderForFlow, type ActionFlow, type ConversationActionState } from "./action-flows.js";
import { type PrimaryCta } from "./conversion-goals.js";
import { currentWorkflowStep, workflowField, workflowNextBestAction, workflowSummary, type WorkflowNextBestAction } from "./workflow-engine.js";

/**
 * The runtime status is intentionally narrower than the storage status. A
 * resolved or expired conversation has no live routing authority; the active
 * states below are the only states that can suppress AI or CTAs.
 */
export type RuntimeHandoffState = "AI_ACTIVE" | "CONTACT_REQUIRED" | "WAITING_FOR_STAFF" | "FOLLOW_UP_PENDING" | "HUMAN_ACTIVE" | "AI_ASSISTED" | null;

export type RuntimeRoute =
  | "GENERAL_QUESTION"
  | "WORKFLOW_CONTINUATION"
  | "INTERRUPTION"
  | "EXPLICIT_ACTION"
  | "HUMAN_HANDOFF"
  | "PROVIDER_RESULT";

export type RuntimeProviderState = {
  provider: string | null;
  status: "idle" | "pending" | "succeeded" | "failed";
  lastOperation: string | null;
  lookups: Array<{ stepId: string; status: string | null; matchCount: number }>;
};

export type ConversationRuntimeState = {
  conversationId: string | null;
  businessId: string;
  activeWorkflow: { id: string; key: string; version: number } | null;
  workflowVersion: number | null;
  workflowCursor: string | null;
  collectedFields: Record<string, string>;
  pendingQuestion: { stepId: string; fieldKey: string | null; question: string | null } | null;
  interruptionContext: {
    depth: number;
    currentIntent: string | null;
    returnStepId: string | null;
  };
  selectedAction: { id: string; key: string } | null;
  providerState: RuntimeProviderState;
  providerResult: { available: boolean; status: string | null };
  handoffState: RuntimeHandoffState;
  conversionAvailable: boolean;
  nextBestAction: WorkflowNextBestAction | "HANDOFF" | null;
  allowedCtas: PrimaryCta[];
  businessContextVersion: number | null;
};

export type ConversationRuntimeInput = {
  businessId: string;
  conversationId?: string | null;
  businessContextVersion?: number | null;
  handoffState?: RuntimeHandoffState;
  action?: ActionFlow | null;
  actionState?: ConversationActionState | null;
  route?: RuntimeRoute | null;
  providerResult?: { status?: string | null } | null;
  allowedCtas?: PrimaryCta[];
};

/** Waiting for staff keeps AI available; only staff ownership suppresses AI/UI. */
export function handoffSuppressesAi(status: RuntimeHandoffState): boolean {
  return status === "HUMAN_ACTIVE" || status === "AI_ASSISTED";
}

export function handoffShouldEnterFollowUp(
  status: RuntimeHandoffState,
  handoffRequestedAt: string | null | undefined,
  timeoutSeconds: number,
  now = Date.now(),
): boolean {
  if (status !== "WAITING_FOR_STAFF" || !handoffRequestedAt || !Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0) return false;
  const requestedAt = Date.parse(handoffRequestedAt);
  return Number.isFinite(requestedAt) && now - requestedAt >= timeoutSeconds * 1_000;
}

export function runtimeHandoffState(status: string | null | undefined): RuntimeHandoffState {
  if (status === "CONTACT_REQUIRED") return "CONTACT_REQUIRED";
  if (status === "WAITING_FOR_STAFF" || status === "HANDOFF_REQUESTED") return "WAITING_FOR_STAFF";
  if (status === "FOLLOW_UP_PENDING") return "FOLLOW_UP_PENDING";
  if (status === "HUMAN_ACTIVE") return "HUMAN_ACTIVE";
  if (status === "AI_ASSISTED") return "AI_ASSISTED";
  if (status === "AI_ACTIVE") return "AI_ACTIVE";
  return null;
}

function providerState(action: ActionFlow | null, state: ConversationActionState | null): RuntimeProviderState {
  const lookups = Object.entries(state?.lookupResults ?? {}).map(([stepId, value]) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      stepId,
      status: typeof record.status === "string" ? record.status : null,
      matchCount: Array.isArray(record.matches) ? record.matches.length : 0,
    };
  });
  const provider = action ? actionProviderForFlow(action) : null;
  const failed = lookups.some((lookup) => /fail|error|timeout/i.test(lookup.status ?? ""));
  const pending = lookups.some((lookup) => /pending|queued|loading/i.test(lookup.status ?? ""));
  const succeeded = lookups.some((lookup) => /matched|success|complete|ready/i.test(lookup.status ?? ""));
  return {
    provider,
    status: failed ? "failed" : pending ? "pending" : succeeded ? "succeeded" : "idle",
    lastOperation: lookups.at(-1)?.stepId ?? null,
    lookups,
  };
}

/**
 * Builds the single inspectable runtime object used by traces, inbox state,
 * certification, and future persistence adapters. It is a projection of the
 * existing persisted action state, not a second mutable state store.
 */
export function buildConversationRuntimeState(input: ConversationRuntimeInput): ConversationRuntimeState {
  const action = input.action ?? null;
  const state = input.actionState ?? null;
  const workflow = action?.steps?.length && state ? workflowSummary(action, state) : null;
  const current = action && state ? currentWorkflowStep(action, state) : null;
  const field = action && current ? workflowField(action, current.fieldKey) : null;
  // `undefined` means the caller did not provide a status; explicit `null`
  // means the conversation is no longer in an active handoff state.
  const handoff = input.handoffState === undefined ? "AI_ACTIVE" : input.handoffState;
  const allowedCtas = handoffSuppressesAi(handoff) ? [] : [...(input.allowedCtas ?? [])];
  const nextBestAction = handoff && handoff !== "AI_ACTIVE"
    ? "HANDOFF"
    : workflow?.nextBestAction ?? (current && action ? workflowNextBestAction(action, current) : null);
  const provider = providerState(action, state);
  return {
    conversationId: input.conversationId ?? null,
    businessId: input.businessId,
    activeWorkflow: action && state && state.status === "active"
      ? { id: action.id, key: action.key, version: action.version ?? state.workflowVersion ?? 1 }
      : null,
    workflowVersion: state && typeof state.workflowVersion === "number" ? state.workflowVersion : action?.version ?? null,
    workflowCursor: state && state.status === "active" ? state.currentStepId ?? current?.id ?? null : null,
    collectedFields: { ...(state?.values ?? {}) },
    pendingQuestion: current
      ? { stepId: current.id, fieldKey: current.fieldKey ?? null, question: current.question ?? field?.question ?? null }
      : null,
    interruptionContext: {
      depth: state?.interruptionStack?.length ?? 0,
      currentIntent: state?.interruptionStack?.at(-1)?.intent ?? null,
      returnStepId: state?.interruptionStack?.at(-1)?.returnStepId ?? null,
    },
    selectedAction: action && state?.selectedActionResourceId
      ? { id: state.selectedActionResourceId, key: action.key }
      : null,
    providerState: provider,
    providerResult: {
      available: Boolean(input.providerResult),
      status: input.providerResult?.status ?? null,
    },
    handoffState: handoff,
    conversionAvailable: !handoffSuppressesAi(handoff) && state?.conversionAvailable === true,
    nextBestAction,
    allowedCtas,
    businessContextVersion: input.businessContextVersion ?? null,
  };
}

/**
 * Runtime invariants are kept executable so certification can fail on state
 * shape drift instead of relying on a growing collection of route tests.
 */
export function assertConversationRuntimeState(runtime: ConversationRuntimeState): void {
  if (!runtime.businessId.trim()) throw new Error("conversation_runtime_missing_business_id");
  if (handoffSuppressesAi(runtime.handoffState) && runtime.allowedCtas.length) {
    throw new Error("conversation_runtime_cta_while_handoff_active");
  }
  if (runtime.activeWorkflow && runtime.workflowVersion === null) {
    throw new Error("conversation_runtime_workflow_missing_version");
  }
  if (runtime.providerResult.available && !runtime.providerResult.status) {
    throw new Error("conversation_runtime_provider_result_missing_status");
  }
}

export function safeConversationRuntimeState(runtime: ConversationRuntimeState): ConversationRuntimeState {
  const sensitive = /email|phone|name|address|zip|postal|token|secret|password/i;
  return {
    ...runtime,
    collectedFields: Object.fromEntries(Object.entries(runtime.collectedFields).map(([key, value]) => [key, sensitive.test(key) ? "[redacted]" : value])),
    allowedCtas: runtime.allowedCtas.map((cta) => ({ ...cta })),
  };
}
