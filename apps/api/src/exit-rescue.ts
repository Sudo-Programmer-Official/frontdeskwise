import type { ActionFlow, ConversationActionState } from "./action-flows.js";
import { workflowHasMeaningfulEngagement } from "./conversation-orchestrator.js";
import { currentWorkflowStep } from "./workflow-engine.js";

const contactFieldPattern = /^(email|phone|name|parent_name)$/i;

export type ExitRescueFunnelMetrics = {
  offered: number;
  saved: number;
  returned: number;
  converted: number;
  declined: number;
};

export function hasRecoverableContact(state: ConversationActionState): boolean {
  return Boolean(state.leadId || state.values.email?.trim() || state.values.phone?.trim());
}

export function shouldOfferExitRescue(action: ActionFlow, state: ConversationActionState): boolean {
  return action.completion.createLead
    && !state.exitRescue
    && !hasRecoverableContact(state)
    && workflowHasMeaningfulEngagement(action, state);
}

export function offerExitRescueState(action: ActionFlow, state: ConversationActionState, offeredAt = new Date().toISOString()): string | null {
  const step = currentWorkflowStep(action, state);
  const returnStepId = step?.id ?? state.currentStepId ?? null;
  state.exitRescue = {
    status: "offered",
    reason: "language",
    returnStepId,
    offeredAt,
  };
  state.formShown = true;
  return returnStepId;
}

export function declineExitRescueState(state: ConversationActionState, declinedAt = new Date().toISOString()): boolean {
  if (state.exitRescue?.status !== "offered") return false;
  state.exitRescue = { ...state.exitRescue, status: "declined", declinedAt };
  state.formShown = false;
  return true;
}

export function saveExitRescueState(state: ConversationActionState, savedAt = new Date().toISOString()): boolean {
  if (state.exitRescue?.status !== "offered") return false;
  state.exitRescue = { ...state.exitRescue, status: "saved", savedAt };
  state.formShown = false;
  return true;
}

export function markExitRescueReturned(state: ConversationActionState, returnedAt = new Date().toISOString()): boolean {
  if (state.exitRescue?.status !== "saved" || state.exitRescue.returnedAt) return false;
  state.exitRescue = { ...state.exitRescue, returnedAt };
  return true;
}

export function markExitRescueConverted(state: ConversationActionState, convertedAt = new Date().toISOString()): boolean {
  if (state.exitRescue?.status !== "saved" || state.exitRescue.convertedAt) return false;
  state.exitRescue = { ...state.exitRescue, convertedAt };
  return true;
}

function displayFieldLabel(action: ActionFlow, key: string): string {
  return action.fields.find((field) => field.key === key || field.id === key)?.label
    ?? key.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function exitRescueNotificationDetails(
  businessName: string,
  action: ActionFlow,
  state: ConversationActionState,
): { title: string; body: string; returnStepId: string | null; qualificationSummary: string; pausedStep: string } {
  const returnStepId = state.exitRescue?.returnStepId ?? state.currentStepId ?? null;
  const pausedStep = action.steps?.find((step) => step.id === returnStepId);
  const pausedStepLabel = pausedStep?.question
    || (pausedStep?.fieldKey ? displayFieldLabel(action, pausedStep.fieldKey) : null)
    || returnStepId
    || "the next workflow step";
  const qualificationEntries = Object.entries(state.values)
    .filter(([key, value]) => !contactFieldPattern.test(key) && Boolean(value?.trim()))
    .slice(0, 6)
    .map(([key, value]) => `${displayFieldLabel(action, key)}: ${value.trim()}`);
  const qualificationSummary = qualificationEntries.length ? qualificationEntries.join(" · ") : "Qualification progress captured";
  return {
    title: `Paused ${action.name} request`,
    body: `${businessName} has a qualified visitor who saved progress before completing ${action.name.toLowerCase()}. Qualification: ${qualificationSummary}. Paused step: ${pausedStepLabel}.`,
    returnStepId,
    qualificationSummary,
    pausedStep: pausedStepLabel,
  };
}

export function exitRescueFunnelMetrics(events: Array<{ event: string; conversationId?: string | null }>): ExitRescueFunnelMetrics {
  const sets: Record<keyof ExitRescueFunnelMetrics, Set<string>> = {
    offered: new Set(),
    saved: new Set(),
    returned: new Set(),
    converted: new Set(),
    declined: new Set(),
  };
  const eventToMetric: Record<string, keyof ExitRescueFunnelMetrics> = {
    EXIT_RESCUE_OFFERED: "offered",
    EXIT_RESCUE_SAVED: "saved",
    EXIT_RESCUE_RETURNED: "returned",
    EXIT_RESCUE_CONVERTED: "converted",
    EXIT_RESCUE_DECLINED: "declined",
  };
  events.forEach((event, index) => {
    const metric = eventToMetric[event.event];
    if (!metric) return;
    sets[metric].add(event.conversationId || `${event.event}:${index}`);
  });
  return {
    offered: sets.offered.size,
    saved: sets.saved.size,
    returned: sets.returned.size,
    converted: sets.converted.size,
    declined: sets.declined.size,
  };
}
