import { type ActionFlow, type ActionStep, type ConversationActionState } from "./action-flows.js";
import { currentWorkflowStep, transitionWorkflow } from "./workflow-engine.js";

export type WorkflowResumePlan = {
  step: ActionStep | null;
  skippedStepIds: string[];
};

const staleConfirmationPrompt = /\b(?:does that sound|does this sound|does that match|is that (?:the|a) kind|is this the kind|would that be the kind|does that describe)\b/i;

function hasValue(state: ConversationActionState, fieldKey: string | undefined): boolean {
  return Boolean(fieldKey && typeof state.values[fieldKey] === "string" && state.values[fieldKey].trim());
}

function isRequiredField(action: ActionFlow, fieldKey: string | undefined): boolean {
  return Boolean(fieldKey && action.fields.some((field) => field.key === fieldKey && field.required && field.visibility !== "hidden"));
}

function isStaleConfirmation(step: ActionStep): boolean {
  if (step.type !== "ask" || step.fieldKey) return false;
  return staleConfirmationPrompt.test(`${step.label ?? ""} ${step.question ?? ""}`);
}

/**
 * Re-aligns a workflow after an interruption without replaying a stale
 * confirmation step. Persisted cursors can point at a step whose field was
 * already supplied, and generated fit workflows often contain a generic ask
 * immediately before their conversion redirect.
 */
export function recomputeWorkflowResume(action: ActionFlow, state: ConversationActionState): WorkflowResumePlan {
  const skippedStepIds: string[] = [];
  let step = currentWorkflowStep(action, state);
  const visited = new Set<string>();

  while (step && !visited.has(step.id)) {
    visited.add(step.id);
    const index = action.steps?.findIndex((candidate) => candidate.id === step?.id) ?? -1;
    const unresolvedLaterField = (action.steps ?? []).some((candidate, candidateIndex) => {
      if (candidateIndex < index || !isRequiredField(action, candidate.fieldKey)) return false;
      return !hasValue(state, candidate.fieldKey);
    });
    const fieldAlreadySatisfied = hasValue(state, step.fieldKey);
    const staleConfirmation = isStaleConfirmation(step) && (unresolvedLaterField || !action.fields.some((field) => field.required && field.visibility !== "hidden" && !hasValue(state, field.key)));

    if (!fieldAlreadySatisfied && !staleConfirmation) break;
    skippedStepIds.push(step.id);
    step = transitionWorkflow(action, state, step.id).step;
  }

  return { step, skippedStepIds };
}
