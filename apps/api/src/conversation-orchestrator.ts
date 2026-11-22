import { classifyVisitorRequest, isPlanSelectionWorkflow, type ActionFlow, type ConversationActionState } from "./action-flows.js";
import { isExplicitHumanRequest } from "./handoff-policy.js";
import { classifyQuestionIntent, type RetrievalIntent } from "./retrieval.js";
import { currentWorkflowStep, workflowNextBestAction, type WorkflowNextBestAction } from "./workflow-engine.js";
import { handoffSuppressesAi, type RuntimeHandoffState } from "./conversation-runtime.js";

export type ConversationRoute = "GENERAL_QUESTION" | "WORKFLOW_CONTINUATION" | "INTERRUPTION" | "EXPLICIT_ACTION" | "HUMAN_HANDOFF" | "PROVIDER_RESULT";

export type ConversationOrchestrationInput = {
  message: string;
  activeAction?: ActionFlow | null;
  actionState?: ConversationActionState | null;
  handoffState?: RuntimeHandoffState;
  providerResult?: boolean;
};

export type ConversationOrchestrationDecision = {
  route: ConversationRoute;
  conversationalIntent: RetrievalIntent | "general";
  actionIntent: string;
  requestMode: "informational" | "transactional";
  confidence: number;
  reason: string;
  preserveWorkflowState: boolean;
  activeWorkflowId: string | null;
  currentStepId: string | null;
  nextBestAction: WorkflowNextBestAction | null;
  interruptionIntent: RetrievalIntent | null;
  handoffState: RuntimeHandoffState;
};

const interruptionIntents = new Set<RetrievalIntent>([
  "services", "hours", "contact", "location", "pricing", "permissions", "privacy", "support", "policy",
  "reminders", "calendar", "voice", "teams",
]);

function questionLike(message: string): boolean {
  return /^(?:how|what(?:'s|s)?|when|where|why|who|is|are|can|could|does|do|tell me|explain)\b/i.test(message.trim());
}

/**
 * Corrections are workflow answers even when they contain a knowledge intent
 * such as "reminders". Keep the check narrow so "Actually, what does..."
 * remains a knowledge question.
 */
export function isWorkflowCorrection(message: string): boolean {
  const value = message.trim();
  const prefix = /^(?:actually|rather|instead|correction|to clarify|on second thought)\b\s*,?\s*/i;
  if (!prefix.test(value)) return false;
  const remainder = value.replace(prefix, "").trim();
  return Boolean(remainder) && !questionLike(remainder) && !/[?]$/.test(value);
}

function standaloneKnowledgeQuestion(message: string, intent: RetrievalIntent): boolean {
  if (!interruptionIntents.has(intent)) return false;
  // Keep this list disjoint from common workflow option labels such as
  // "Reminders" and "Team". Those should remain answers when they are sent
  // as literal selections.
  return /^(?:pricing|price|prices|cost|costs|how much|fees?|rates?|hours?|location|address|contact|support|privacy|permissions?|policy|policies|cancel(?:lation)?|refunds?)\s*[?!.]*$/i.test(message.trim());
}

function hasActiveWorkflow(action?: ActionFlow | null, state?: ConversationActionState | null): boolean {
  return Boolean(action?.steps?.length && state && state.status === "active");
}

function workflowMatchesActionIntent(action: ActionFlow, actionIntent: string, message: string): boolean {
  const haystack = `${action.key} ${action.actionType} ${action.name}`.toLowerCase();
  if (actionIntent === "plan_selection") return isPlanSelectionWorkflow(action);
  if (actionIntent === "enrollment") return /enroll|registration|student|lesson/.test(haystack);
  if (actionIntent === "booking") return /book|appointment|schedule|tour/.test(haystack);
  if (actionIntent === "quote") return /quote|estimate/.test(haystack);
  if (actionIntent === "demo") {
    return /demo|trial/.test(haystack)
      || (action.steps ?? []).some((step) => step.config?.trigger === "explicit_guided_demo_request");
  }
  if (actionIntent === "waitlist") return /waitlist|wait/.test(haystack);
  if (actionIntent === "lead") return /lead|contact|team/.test(haystack);
  if (actionIntent === "general" && /\b(try|start|see|view|explore|open|go ahead|ready)\b/i.test(message)) {
    return (action.steps ?? []).some((step) => step.type === "redirect" && step.config?.normalConversionEndpoint === true);
  }
  return false;
}

/**
 * Classifies the visitor message without mutating workflow state. The active
 * journey is an independent input, so a side question can be routed to
 * knowledge while preserving the exact workflow cursor.
 */
export function decideConversationRoute(input: ConversationOrchestrationInput): ConversationOrchestrationDecision {
  const message = input.message.trim();
  const request = classifyVisitorRequest(message);
  const conversationalIntent = classifyQuestionIntent(message);
  const active = hasActiveWorkflow(input.activeAction, input.actionState);
  const currentStep = active && input.activeAction && input.actionState ? currentWorkflowStep(input.activeAction, input.actionState) : null;
  const activeWorkflowId = input.actionState?.actionId ?? input.activeAction?.id ?? null;
  const currentStepId = currentStep?.id ?? input.actionState?.currentStepId ?? null;
  const nextBestAction = currentStep && input.activeAction ? workflowNextBestAction(input.activeAction, currentStep) : null;
  const handoffState = input.handoffState ?? "AI_ACTIVE";

  // A waiting notification is not a reply lock. Only an active staff-owned
  // conversation prevents customer-facing AI routing.
  if (handoffSuppressesAi(handoffState)) {
    return {
      route: "HUMAN_HANDOFF",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: 1,
      reason: "handoff_state_active",
      preserveWorkflowState: active,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: null,
      handoffState,
    };
  }

  if (input.providerResult) {
    return {
      route: "PROVIDER_RESULT",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: 1,
      reason: "provider_result",
      preserveWorkflowState: active,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: null,
      handoffState,
    };
  }

  if (isExplicitHumanRequest(message)) {
    return {
      route: "HUMAN_HANDOFF",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: 0.99,
      reason: "explicit_human_request",
      preserveWorkflowState: active,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: null,
      handoffState,
    };
  }

  // Intent keywords also occur in perfectly valid workflow answers (for
  // example, "I mainly need planning and reminders"). Only route a turn to
  // knowledge when it is shaped like a question or a standalone side-topic;
  // otherwise extraction must get the first chance to advance the workflow.
  const isCorrection = active && isWorkflowCorrection(message);
  const isKnowledgeQuestion = !isCorrection && (questionLike(message) || standaloneKnowledgeQuestion(message, conversationalIntent));
  const isInterruption = active && isKnowledgeQuestion && (interruptionIntents.has(conversationalIntent) || request.mode === "informational");
  if (isInterruption) {
    return {
      route: "INTERRUPTION",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: request.confidence,
      reason: "knowledge_question_during_active_workflow",
      preserveWorkflowState: true,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: conversationalIntent,
      handoffState,
    };
  }

  // "I need ..." is classified as transactional for new conversations, but
  // while a qualification workflow is active it is commonly the visitor's
  // answer to the current field (for example, their main goal). Keep that
  // field answer inside the workflow unless it is a distinct knowledge or
  // action intent.
  const looksLikeActiveWorkflowAnswer = active && request.actionIntent === "general" && !isKnowledgeQuestion;
  if (active && (request.mode !== "transactional" || looksLikeActiveWorkflowAnswer || workflowMatchesActionIntent(input.activeAction!, request.actionIntent, message))) {
    return {
      route: "WORKFLOW_CONTINUATION",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: request.confidence,
      reason: "active_workflow_has_priority",
      preserveWorkflowState: true,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: null,
      handoffState,
    };
  }

  if (request.mode === "transactional") {
    return {
      route: "EXPLICIT_ACTION",
      conversationalIntent,
      actionIntent: request.actionIntent,
      requestMode: request.mode,
      confidence: request.confidence,
      reason: "explicit_transactional_request",
      preserveWorkflowState: active,
      activeWorkflowId,
      currentStepId,
      nextBestAction,
      interruptionIntent: null,
      handoffState,
    };
  }

  return {
    route: "GENERAL_QUESTION",
    conversationalIntent,
    actionIntent: request.actionIntent,
    requestMode: request.mode,
    confidence: request.confidence,
    reason: "general_knowledge_question",
    preserveWorkflowState: active,
    activeWorkflowId,
    currentStepId,
    nextBestAction,
    interruptionIntent: null,
    handoffState,
  };
}
