import { createHash } from "node:crypto";
import type { ConversationActionState } from "./action-flows.js";

export type WorkflowLoopGuardState = {
  lastFingerprint: string | null;
  consecutiveUnchangedTurns: number;
  triggered: boolean;
};

export type WorkflowLoopObservation = {
  stateBefore: ConversationActionState | null | undefined;
  stateAfter: ConversationActionState | null | undefined;
  threshold?: number;
};

export type WorkflowLoopResult = {
  guard: WorkflowLoopGuardState;
  triggered: boolean;
  reason: "no_workflow" | "progressed" | "unchanged_state" | "already_triggered";
  fingerprint: string | null;
};

function comparableState(state: ConversationActionState | null | undefined): Record<string, unknown> | null {
  if (!state) return null;
  return {
    actionId: state.actionId,
    status: state.status,
    currentStepId: state.currentStepId ?? null,
    completedStepIds: [...(state.completedStepIds ?? [])],
    selectedActionResourceId: state.selectedActionResourceId ?? null,
    completionUrlPresent: Boolean(state.completionUrl),
    values: Object.fromEntries(Object.entries(state.values).sort(([left], [right]) => left.localeCompare(right))),
    interruptionStack: (state.interruptionStack ?? []).map((item) => ({ intent: item.intent, returnStepId: item.returnStepId })),
  };
}

export function workflowStateFingerprint(state: ConversationActionState | null | undefined): string | null {
  const comparable = comparableState(state);
  if (!comparable) return null;
  return createHash("sha256").update(JSON.stringify(comparable)).digest("hex").slice(0, 24);
}

export function observeWorkflowLoop(previous: WorkflowLoopGuardState | undefined, input: WorkflowLoopObservation): WorkflowLoopResult {
  const before = comparableState(input.stateBefore);
  const after = comparableState(input.stateAfter);
  if (!before || !after) return { guard: previous ?? { lastFingerprint: null, consecutiveUnchangedTurns: 0, triggered: false }, triggered: false, reason: "no_workflow", fingerprint: null };
  const fingerprint = workflowStateFingerprint(input.stateAfter);
  const threshold = Math.max(2, input.threshold ?? 2);
  if (previous?.triggered) return { guard: { ...previous, triggered: true }, triggered: true, reason: "already_triggered", fingerprint };
  const unchanged = JSON.stringify(before) === JSON.stringify(after);
  const consecutiveUnchangedTurns = unchanged
    ? (previous?.lastFingerprint === fingerprint ? previous.consecutiveUnchangedTurns + 1 : 1)
    : 0;
  const triggered = consecutiveUnchangedTurns >= threshold;
  return {
    guard: { lastFingerprint: fingerprint, consecutiveUnchangedTurns, triggered },
    triggered,
    reason: triggered || unchanged ? "unchanged_state" : "progressed",
    fingerprint,
  };
}
