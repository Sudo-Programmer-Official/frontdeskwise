import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import { decideConversationRoute } from "../src/conversation-orchestrator.js";
import {
  assertConversationRuntimeState,
  buildConversationRuntimeState,
  handoffSuppressesAi,
  handoffShouldEnterFollowUp,
  runtimeHandoffState,
  safeConversationRuntimeState,
} from "../src/conversation-runtime.js";
import { pushWorkflowInterruption, resumeWorkflowInterruption } from "../src/workflow-engine.js";

const action: ActionFlow = {
  id: "runtime-action",
  key: "runtime_workflow",
  actionType: "contact_team",
  name: "Runtime workflow",
  description: "A deterministic runtime test workflow.",
  triggerPhrases: ["start the workflow"],
  triggerIntents: ["lead"],
  captureMode: "conversational",
  fields: [{ id: "email", key: "email", label: "Email", type: "email", required: true, question: "What email should we use?" }],
  steps: [
    { id: "capture-email", type: "capture", fieldKey: "email", question: "What email should we use?" },
    { id: "complete", type: "complete" },
  ],
  completion: { createLead: true, leadStatus: "new", message: "Saved.", notifyStaff: false },
  mode: "transactional",
  executionMode: "FORM_FLOW",
  trackingKey: "runtime_workflow",
  destination: null,
  provider: null,
  priority: 1,
  requiredFields: ["email"],
  conditions: [],
  safetyPolicy: "standard",
  sourceUrl: null,
  sourceType: "manual",
  sourceLabel: "Runtime test",
  classificationReason: null,
  discoveredAt: null,
  origin: "configured",
  lifecycleStatus: "active",
  reviewReason: null,
  evidence: [],
  confidence: 1,
  enabled: true,
  readiness: { ready: true, reason: "ready" },
  version: 3,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("runtime snapshot is the inspectable projection of workflow state", () => {
  const state = createActionState(action, "2026-01-01T00:00:00.000Z");
  const cta = {
    actionId: "runtime-cta",
    key: "continue",
    label: "Continue",
    executionMode: "DIRECT_LINK" as const,
    trackingKey: "continue",
    url: "https://example.com/continue",
  };
  const runtime = buildConversationRuntimeState({
    businessId: "business-runtime",
    conversationId: "conversation-runtime",
    businessContextVersion: 7,
    action,
    actionState: state,
    allowedCtas: [cta],
  });
  assert.equal(runtime.activeWorkflow?.key, "runtime_workflow");
  assert.equal(runtime.workflowVersion, 3);
  assert.equal(runtime.workflowCursor, "capture-email");
  assert.equal(runtime.pendingQuestion?.fieldKey, "email");
  assert.equal(runtime.nextBestAction, "ASK_FIELD");
  assert.equal(runtime.conversionAvailable, false);
  assert.equal(runtime.allowedCtas[0]?.key, "continue");
  assert.equal(runtime.businessContextVersion, 7);
  assertConversationRuntimeState(runtime);
  assert.equal(safeConversationRuntimeState({ ...runtime, collectedFields: { email: "visitor@example.com" } }).collectedFields.email, "[redacted]");
});

test("pricing interruption resumes with the workflow CTA still available", () => {
  const salonAction: ActionFlow = {
    ...action,
    id: "salon-pricing-runtime",
    key: "salon_fit",
    steps: [
      { id: "fit", type: "ask", question: "Which part of the business should improve?" },
      { id: "pricing", type: "knowledge", label: "Pricing", config: { conditional: true, topic: "pricing", knowledgeSource: "verified_business_knowledge", allowedFacts: "pricing", ctaBehavior: "keep_current_if_available", resumeBehavior: "return_to_previous_step" } },
      { id: "try-demo", type: "redirect", label: "Try the demo", config: { normalConversionEndpoint: true, actionKey: "try_demo" } },
    ],
  };
  const state = createActionState(salonAction);
  state.currentStepId = "try-demo";
  state.completedStepIds = ["fit"];
  const cta = { actionId: "try-demo", key: "try_demo", label: "Try the demo", executionMode: "DIRECT_LINK" as const, trackingKey: "try_demo", url: "https://example.com/try" };
  const before = buildConversationRuntimeState({ businessId: "salon-business", action: salonAction, actionState: state, allowedCtas: [cta] });

  pushWorkflowInterruption(state, { intent: "pricing", question: "How much does it cost?", returnStepId: "try-demo" }, "2026-01-01T00:00:00.000Z");
  const during = buildConversationRuntimeState({ businessId: "salon-business", action: salonAction, actionState: state, allowedCtas: [cta] });
  assert.equal(during.workflowCursor, "try-demo");
  assert.equal(during.interruptionContext.currentIntent, "pricing");
  assert.equal(during.allowedCtas[0]?.key, "try_demo");

  assert.equal(resumeWorkflowInterruption(state)?.returnStepId, "try-demo");
  const after = buildConversationRuntimeState({ businessId: "salon-business", action: salonAction, actionState: state, allowedCtas: [cta] });
  assert.equal(after.workflowCursor, before.workflowCursor);
  assert.equal(after.allowedCtas[0]?.key, before.allowedCtas[0]?.key);
});

test("waiting for staff preserves AI conversion state and owns the handoff status", () => {
  const state = createActionState(action);
  const runtime = buildConversationRuntimeState({
    businessId: "business-runtime",
    action,
    actionState: state,
    handoffState: "WAITING_FOR_STAFF",
    allowedCtas: [{ actionId: "runtime-cta", key: "continue", label: "Continue", executionMode: "DIRECT_LINK", trackingKey: "continue", url: "https://example.com" }],
  });
  assert.equal(runtime.handoffState, "WAITING_FOR_STAFF");
  assert.equal(runtime.conversionAvailable, false);
  assert.equal(runtime.nextBestAction, "HANDOFF");
  assert.equal(runtime.allowedCtas[0]?.key, "continue");
  assertConversationRuntimeState(runtime);
});

test("handoff state outranks provider results, explicit actions, and workflow continuation", () => {
  const state = createActionState(action);
  const decision = decideConversationRoute({
    message: "Please continue and show me the result",
    activeAction: action,
    actionState: state,
    handoffState: "HUMAN_ACTIVE",
    providerResult: true,
  });
  assert.equal(decision.route, "HUMAN_HANDOFF");
  assert.equal(decision.reason, "handoff_state_active");
  assert.equal(decision.handoffState, "HUMAN_ACTIVE");
});

test("follow-up pending keeps AI available after the configured timeout", () => {
  const requestedAt = "2026-01-01T00:00:00.000Z";
  const now = Date.parse("2026-01-01T00:15:00.000Z");
  assert.equal(runtimeHandoffState("FOLLOW_UP_PENDING"), "FOLLOW_UP_PENDING");
  assert.equal(handoffSuppressesAi("FOLLOW_UP_PENDING"), false);
  assert.equal(handoffShouldEnterFollowUp("WAITING_FOR_STAFF", requestedAt, 900, now), true);
  assert.equal(handoffShouldEnterFollowUp("WAITING_FOR_STAFF", requestedAt, 1_800, now), false);
  assert.equal(handoffShouldEnterFollowUp("FOLLOW_UP_PENDING", requestedAt, 900, now), false);
});

test("contact-required handoff keeps AI available until a contact channel is captured", () => {
  assert.equal(runtimeHandoffState("CONTACT_REQUIRED"), "CONTACT_REQUIRED");
  assert.equal(handoffSuppressesAi("CONTACT_REQUIRED"), false);
  const runtime = buildConversationRuntimeState({
    businessId: "business-runtime",
    handoffState: "CONTACT_REQUIRED",
    allowedCtas: [],
  });
  assert.equal(runtime.nextBestAction, "HANDOFF");
  assertConversationRuntimeState(runtime);
});
