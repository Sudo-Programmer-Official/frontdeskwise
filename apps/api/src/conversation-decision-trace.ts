import { actionProviderForFlow, type ActionFlow, type ConversationActionState } from "./action-flows.js";

export type ConversationTraceState = {
  actionId: string;
  workflowVersion: number | null;
  status: ConversationActionState["status"];
  currentStepId: string | null;
  completedStepIds: string[];
  values: Record<string, string | null>;
  selectedActionResourceId: string | null;
  completionUrlPresent: boolean;
  interruptionStack: Array<{ intent: string; returnStepId: string | null }>;
  participantCount: number;
  formShown: boolean;
  loopGuard: {
    consecutiveUnchangedTurns: number;
    triggered: boolean;
  } | null;
};

export type ConversationTraceFieldChange = {
  before: string | null;
  after: string | null;
};

export type ConversationProviderTrace = {
  provider: string | null;
  operations: string[];
  lookupSteps: Array<{
    stepId: string;
    status: string | null;
    matchCount: number;
  }>;
  actionDelivery: { status: string; provider: string | null } | null;
};

const sensitiveFieldPattern = /email|phone|name|address|zip|postal|token|secret|password/i;

function traceValue(key: string, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (sensitiveFieldPattern.test(key)) return "[redacted]";
  return typeof value === "string" ? value.trim().slice(0, 240) : String(value).slice(0, 240);
}

export function snapshotConversationWorkflowState(state: ConversationActionState | null | undefined): ConversationTraceState | null {
  if (!state) return null;
  return {
    actionId: state.actionId,
    workflowVersion: typeof state.workflowVersion === "number" ? state.workflowVersion : null,
    status: state.status,
    currentStepId: state.currentStepId ?? null,
    completedStepIds: (state.completedStepIds ?? []).slice(0, 100),
    values: Object.fromEntries(Object.entries(state.values).slice(0, 100).map(([key, value]) => [key, traceValue(key, value)])),
    selectedActionResourceId: state.selectedActionResourceId ?? null,
    completionUrlPresent: Boolean(state.completionUrl),
    interruptionStack: (state.interruptionStack ?? []).slice(-20).map((interruption) => ({
      intent: interruption.intent,
      returnStepId: interruption.returnStepId,
    })),
    participantCount: state.participants?.length ?? 0,
    formShown: Boolean(state.formShown),
    loopGuard: state.loopGuard ? {
      consecutiveUnchangedTurns: state.loopGuard.consecutiveUnchangedTurns,
      triggered: state.loopGuard.triggered,
    } : null,
  };
}

export function workflowFieldChanges(
  before: ConversationActionState | null | undefined,
  after: ConversationActionState | null | undefined,
): Record<string, ConversationTraceFieldChange> {
  const beforeValues = before?.values ?? {};
  const afterValues = after?.values ?? {};
  const keys = new Set([...Object.keys(beforeValues), ...Object.keys(afterValues)]);
  return Object.fromEntries(
    [...keys]
      .filter((key) => beforeValues[key] !== afterValues[key])
      .slice(0, 100)
      .map((key) => [key, { before: traceValue(key, beforeValues[key]), after: traceValue(key, afterValues[key]) }]),
  );
}

export function providerTrace(
  action: ActionFlow | null | undefined,
  state: ConversationActionState | null | undefined,
  actionDelivery?: { status: string; provider?: string },
): ConversationProviderTrace | null {
  const lookupSteps = Object.entries(state?.lookupResults ?? {}).map(([stepId, value]) => {
    const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
    return {
      stepId,
      status: typeof record.status === "string" ? record.status : null,
      matchCount: Array.isArray(record.matches) ? record.matches.length : 0,
    };
  });
  const provider = action ? actionProviderForFlow(action) : null;
  if (!provider && !lookupSteps.length && !actionDelivery) return null;
  const operations = [
    ...(action?.steps ?? []).filter((step) => ["lookup", "recommend", "generate_link", "api_action", "book"].includes(step.type)).map((step) => step.type),
    ...(actionDelivery ? ["action_delivery"] : []),
  ];
  return {
    provider: actionDelivery?.provider ?? provider,
    operations: [...new Set(operations)],
    lookupSteps,
    actionDelivery: actionDelivery ? { status: actionDelivery.status, provider: actionDelivery.provider ?? null } : null,
  };
}
