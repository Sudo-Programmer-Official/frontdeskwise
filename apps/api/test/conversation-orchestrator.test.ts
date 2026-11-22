import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import { decideConversationRoute } from "../src/conversation-orchestrator.js";

const action = {
  id: "enroll-child",
  key: "enroll_child",
  actionType: "enroll",
  name: "Enroll a child",
  description: "Find a swim lesson and complete registration.",
  triggerPhrases: ["enroll"],
  triggerIntents: ["enrollment"],
  captureMode: "conversational",
  fields: [{ id: "preferred_days", key: "preferred_days", label: "Preferred days", type: "text", required: true, question: "Which days work best?" }],
  steps: [{ id: "preferred-days", type: "capture", fieldKey: "preferred_days", question: "Which days work best?" }],
  completion: { createLead: false, leadStatus: "new", message: "", notifyStaff: false },
  mode: "transactional",
  executionMode: "PROVIDER_FLOW",
  destination: null,
  provider: "jackrabbit",
  priority: 1,
  requiredFields: ["preferred_days"],
  conditions: [],
  safetyPolicy: "standard",
  sourceUrl: null,
  evidence: [],
  confidence: 1,
  enabled: true,
  createdAt: "2026-11-21T00:00:00.000Z",
  updatedAt: "2026-11-21T00:00:00.000Z",
} as ActionFlow;

const planAction = {
  ...action,
  id: "choose-plan",
  key: "choose_plan",
  actionType: "contact_team",
  name: "Choose the right plan",
  description: "Help visitors choose a plan.",
  fields: [
    { id: "usage_type", key: "usage_type", label: "Usage type", type: "select", required: true, question: "Solo or team?", options: ["Solo", "Team"] },
    { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What is your goal?", options: ["Planning", "Reminders", "Planning + reminders"] },
    { id: "usage_level", key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often?", options: ["Occasional", "Regularly", "Every day"] },
  ],
  steps: [
    { id: "usage-type", type: "capture", fieldKey: "usage_type" },
    { id: "main-goal", type: "capture", fieldKey: "main_goal" },
    { id: "usage-level", type: "capture", fieldKey: "usage_level" },
  ],
} as ActionFlow;

test("side questions interrupt without losing the active workflow cursor", () => {
  const state = createActionState(action);
  const decision = decideConversationRoute({ message: "How much does it cost?", activeAction: action, actionState: state });

  assert.equal(decision.route, "INTERRUPTION");
  assert.equal(decision.interruptionIntent, "pricing");
  assert.equal(decision.preserveWorkflowState, true);
  assert.equal(decision.activeWorkflowId, action.id);
  assert.equal(decision.currentStepId, "preferred-days");
  assert.equal(decision.nextBestAction, "ASK_FIELD");
});

test("audience words in a pricing interruption do not turn it into a workflow answer", () => {
  const state = createActionState(action);
  const decision = decideConversationRoute({ message: "What does the team plan cost?", activeAction: action, actionState: state });

  assert.equal(decision.route, "INTERRUPTION");
  assert.equal(decision.interruptionIntent, "pricing");
  assert.equal(decision.currentStepId, "preferred-days");
});

test("workflow answers containing knowledge keywords are not misrouted as interruptions", () => {
  const state = createActionState(planAction);
  const decision = decideConversationRoute({
    message: "It's just for me and I mainly need planning and reminders.",
    activeAction: planAction,
    actionState: state,
  });

  assert.equal(decision.route, "WORKFLOW_CONTINUATION");
  assert.equal(decision.preserveWorkflowState, true);
  assert.equal(decision.interruptionIntent, null);
});

test("normal conversion and guided demo requests stay inside the active workflow", () => {
  const salonWorkflow = {
    ...action,
    id: "salon-workflow",
    key: "salon_workflow",
    actionType: "open_link",
    name: "Help me choose SalonFlow",
    steps: [
      { id: "try-demo", type: "redirect", config: { normalConversionEndpoint: true } },
      { id: "request-demo", type: "redirect", config: { conditional: true, trigger: "explicit_guided_demo_request" } },
    ],
  } as ActionFlow;

  assert.equal(
    decideConversationRoute({ message: "Okay, I want to try it.", activeAction: salonWorkflow, actionState: createActionState(salonWorkflow) }).route,
    "WORKFLOW_CONTINUATION",
  );
  assert.equal(
    decideConversationRoute({ message: "I want a guided demo.", activeAction: salonWorkflow, actionState: createActionState(salonWorkflow) }).route,
    "WORKFLOW_CONTINUATION",
  );
});

test("workflow answers stay on the journey while explicit handoff takes priority", () => {
  const state = createActionState(action);
  const continuation = decideConversationRoute({ message: "Saturday mornings", activeAction: action, actionState: state });
  assert.equal(continuation.route, "WORKFLOW_CONTINUATION");
  assert.equal(continuation.preserveWorkflowState, true);

  const handoff = decideConversationRoute({ message: "Please connect me with a real person", activeAction: action, actionState: state });
  assert.equal(handoff.route, "HUMAN_HANDOFF");
  assert.equal(handoff.preserveWorkflowState, true);
});

test("orchestrator distinguishes new action requests, general questions, and provider results", () => {
  assert.equal(decideConversationRoute({ message: "I want to enroll my child" }).route, "EXPLICIT_ACTION");
  assert.equal(decideConversationRoute({ message: "What services do you offer?" }).route, "GENERAL_QUESTION");
  assert.equal(decideConversationRoute({ message: "Jackrabbit returned two matching classes", activeAction: action, actionState: createActionState(action), providerResult: true }).route, "PROVIDER_RESULT");
});
