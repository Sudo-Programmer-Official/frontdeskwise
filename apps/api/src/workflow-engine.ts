import {
  validateFieldValue,
  type ActionField,
  type ActionFlow,
  type ActionInterruption,
  type ActionParticipant,
  type ActionStep,
  type ConversationActionState,
} from "./action-flows.js";

export type WorkflowTransition = {
  step: ActionStep | null;
  state: ConversationActionState;
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function valueForPath(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path];
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, values);
}

export function workflowField(action: ActionFlow, fieldKey: string | undefined): ActionField | null {
  if (!fieldKey) return null;
  return action.fields.find((field) => field.key === fieldKey || field.id === fieldKey) ?? null;
}

export function conditionMatches(condition: { field: string; equals?: string; notEquals?: string }, values: Record<string, unknown>): boolean {
  const current = normalized(valueForPath(values, condition.field));
  if (condition.equals !== undefined) return current === normalized(condition.equals);
  if (condition.notEquals !== undefined) return current !== normalized(condition.notEquals);
  return Boolean(current);
}

export function workflowStep(action: ActionFlow, stepId: string | undefined): ActionStep | null {
  if (!action.steps?.length || !stepId) return null;
  return action.steps.find((step) => step.id === stepId) ?? null;
}

function nextSequentialStep(action: ActionFlow, step: ActionStep): ActionStep | null {
  if (!action.steps?.length) return null;
  if (step.nextStepId) return workflowStep(action, step.nextStepId);
  const index = action.steps.findIndex((candidate) => candidate.id === step.id);
  return action.steps[index + 1] ?? null;
}

function nextBranchStep(action: ActionFlow, step: ActionStep, values: Record<string, unknown>): ActionStep | null {
  const branch = step.branches?.find((candidate) => conditionMatches(candidate.when, values));
  return branch ? workflowStep(action, branch.nextStepId) : nextSequentialStep(action, step);
}

/**
 * Resolves non-interactive condition/decision steps and hidden conditional
 * steps without executing side effects. Side effects are performed by the
 * API runtime after this deterministic cursor calculation.
 */
export function currentWorkflowStep(action: ActionFlow, state: ConversationActionState): ActionStep | null {
  if (!action.steps?.length || state.status === "completed") return null;
  let step: ActionStep | null = workflowStep(action, state.currentStepId) ?? action.steps[0] ?? null;
  const visited = new Set<string>();
  while (step && !visited.has(step.id)) {
    visited.add(step.id);
    if (step.condition && !conditionMatches(step.condition, state.values)) {
      step = nextSequentialStep(action, step);
      continue;
    }
    if (step.type === "condition" || step.type === "decision") {
      step = nextBranchStep(action, step, state.values);
      continue;
    }
    return step;
  }
  return null;
}

export function workflowFormFields(action: ActionFlow, state: ConversationActionState): ActionField[] {
  const step = currentWorkflowStep(action, state);
  if (!step || step.type !== "form") return [];
  const configured = step.config?.fieldKeys;
  const keys = Array.isArray(configured) ? new Set(configured.filter((value): value is string => typeof value === "string")) : null;
  return action.fields.filter((field) => {
    if (keys && !keys.has(field.key) && !keys.has(field.id)) return false;
    if (field.visibility === "hidden" || state.skipped?.includes(field.key)) return false;
    if (field.condition && !conditionMatches(field.condition, state.values)) return false;
    return !state.values[field.key]?.trim();
  });
}

export function transitionWorkflow(action: ActionFlow, state: ConversationActionState, completedStepId?: string): WorkflowTransition {
  if (!action.steps?.length) return { step: null, state };
  const current = workflowStep(action, completedStepId ?? state.currentStepId) ?? action.steps[0];
  if (current && !state.completedStepIds?.includes(current.id)) {
    state.completedStepIds = [...(state.completedStepIds ?? []), current.id];
  }
  const next = current ? nextBranchStep(action, current, state.values) : action.steps[0];
  state.currentStepId = next?.id;
  const resolved = currentWorkflowStep(action, state);
  state.currentStepId = resolved?.id;
  if (!resolved) {
    state.status = "completed";
    state.completedAt = state.completedAt ?? new Date().toISOString();
  }
  return { step: resolved, state };
}

export function applyWorkflowInput(
  action: ActionFlow,
  state: ConversationActionState,
  rawValue: string,
): { ok: boolean; value?: string; error?: string; transition: WorkflowTransition } {
  const step = currentWorkflowStep(action, state);
  if (!step) return { ok: false, error: "This workflow is already complete.", transition: { step: null, state } };
  const field = workflowField(action, step.fieldKey);
  const validation = field ? validateFieldValue(field, rawValue) : { value: rawValue.trim() };
  if (!validation.value) return { ok: false, error: validation.error, transition: { step, state } };
  if (field) state.values[field.key] = validation.value;
  else if (step.fieldKey) state.values[step.fieldKey] = validation.value;
  return { ok: true, value: validation.value, transition: transitionWorkflow(action, state, step.id) };
}

export function pushWorkflowInterruption(
  state: ConversationActionState,
  input: Omit<ActionInterruption, "startedAt">,
  now = new Date().toISOString(),
): void {
  const stack = state.interruptionStack ?? [];
  const current = stack[stack.length - 1];
  if (current?.question === input.question && current.intent === input.intent) return;
  state.interruptionStack = [...stack, { ...input, startedAt: now }].slice(-8);
}

export function resumeWorkflowInterruption(state: ConversationActionState): ActionInterruption | null {
  const stack = state.interruptionStack ?? [];
  if (!stack.length) return null;
  const interruption = stack[stack.length - 1];
  state.interruptionStack = stack.slice(0, -1);
  if (interruption.returnStepId) state.currentStepId = interruption.returnStepId;
  return interruption;
}

export function addWorkflowParticipant(
  state: ConversationActionState,
  entityType = "participant",
  label?: string,
  now = new Date().toISOString(),
): ActionParticipant {
  const participants = state.participants ?? [];
  const participant: ActionParticipant = {
    id: `${entityType}-${participants.length + 1}`,
    entityType,
    ...(label ? { label } : {}),
    values: {},
    status: "active",
    createdAt: now,
  };
  state.participants = [...participants, participant];
  state.activeParticipantId = participant.id;
  return participant;
}

export function activeWorkflowParticipant(state: ConversationActionState): ActionParticipant | null {
  return state.participants?.find((participant) => participant.id === state.activeParticipantId) ?? null;
}

export function setWorkflowParticipantValue(state: ConversationActionState, key: string, value: string): void {
  const participant = activeWorkflowParticipant(state);
  if (!participant) {
    state.values[key] = value;
    return;
  }
  participant.values[key] = value;
  state.values[`participants.${participant.id}.${key}`] = value;
}

export function completeActiveWorkflowParticipant(state: ConversationActionState): void {
  const participant = activeWorkflowParticipant(state);
  if (participant) participant.status = "completed";
}

