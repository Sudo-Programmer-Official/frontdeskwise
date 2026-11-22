import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import { decideConversationRoute } from "../src/conversation-orchestrator.js";
import {
  assertConversationRuntimeState,
  buildConversationRuntimeState,
  safeConversationRuntimeState,
} from "../src/conversation-runtime.js";

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
  assert.equal(runtime.allowedCtas[0]?.key, "continue");
  assert.equal(runtime.businessContextVersion, 7);
  assertConversationRuntimeState(runtime);
  assert.equal(safeConversationRuntimeState({ ...runtime, collectedFields: { email: "visitor@example.com" } }).collectedFields.email, "[redacted]");
});

test("handoff authority clears CTA output and owns the next action", () => {
  const state = createActionState(action);
  const runtime = buildConversationRuntimeState({
    businessId: "business-runtime",
    action,
    actionState: state,
    handoffState: "WAITING_FOR_STAFF",
    allowedCtas: [{ actionId: "runtime-cta", key: "continue", label: "Continue", executionMode: "DIRECT_LINK", trackingKey: "continue", url: "https://example.com" }],
  });
  assert.equal(runtime.handoffState, "WAITING_FOR_STAFF");
  assert.equal(runtime.nextBestAction, "HANDOFF");
  assert.deepEqual(runtime.allowedCtas, []);
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
