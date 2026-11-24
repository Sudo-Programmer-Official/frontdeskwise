import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import {
  decideConversationRoute,
  isAcknowledgement,
  isExitRescueDecline,
  isExitRescueIntent,
  isWorkflowCorrection,
  workflowHasMeaningfulEngagement,
} from "../src/conversation-orchestrator.js";
import { applyWorkflowValues, currentWorkflowStep, extractWorkflowValues } from "../src/workflow-engine.js";

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
    { id: "recommend-plan", type: "recommend", config: { recommendationType: "plan" } },
  ],
} as ActionFlow;

test("acknowledgements stay out of knowledge-question routing", () => {
  assert.equal(isAcknowledgement("sounds good"), true);
  const decision = decideConversationRoute({ message: "sounds good" });
  assert.equal(decision.route, "GENERAL_QUESTION");
  assert.equal(decision.reason, "acknowledgement");
});

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

test("pending workflow resolution outranks question-shaped knowledge routing", () => {
  const abilityAction: ActionFlow = {
    ...action,
    id: "swim-ability",
    key: "enroll_child",
    fields: [
      { id: "ability", key: "ability", label: "Swimming ability", type: "select", required: true, question: "How comfortable?", options: ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"] },
      { id: "goal", key: "goal", label: "Goal", type: "text", required: true, question: "What is the goal?" },
    ],
    steps: [
      { id: "student-ability", type: "capture", fieldKey: "ability" },
      { id: "student-goal", type: "capture", fieldKey: "goal" },
    ],
  };
  const state = createActionState(abilityAction);

  const exact = decideConversationRoute({ message: "Can swim with help", activeAction: abilityAction, actionState: state });
  assert.equal(exact.route, "WORKFLOW_CONTINUATION");
  assert.equal(exact.reason, "pending_workflow_value_matched");
  assert.equal(exact.resolver?.status, "MATCHED");
  assert.equal(exact.resolver?.method, "exact");
  assert.equal(exact.generalRouterBypassed, true);
  assert.equal(exact.pendingStepId, "student-ability");

  const semantic = decideConversationRoute({ message: "He can float a little, but he isn’t really swimming on his own yet.", activeAction: abilityAction, actionState: state });
  assert.equal(semantic.route, "WORKFLOW_CONTINUATION");
  assert.equal(semantic.resolver?.canonicalValue, "Can swim with help");
  assert.equal(semantic.generalRouterBypassed, true);

  const ambiguous = decideConversationRoute({ message: "He’s somewhere between beginner and swimming with help.", activeAction: abilityAction, actionState: state });
  assert.equal(ambiguous.route, "WORKFLOW_CONTINUATION");
  assert.equal(ambiguous.reason, "pending_workflow_value_ambiguous");
  assert.equal(ambiguous.resolver?.status, "AMBIGUOUS");
  assert.equal(ambiguous.interruptionIntent, null);
  assert.equal(ambiguous.generalRouterBypassed, true);

  const knowledge = decideConversationRoute({ message: "How much do lessons cost?", activeAction: abilityAction, actionState: state });
  assert.equal(knowledge.route, "INTERRUPTION");
  assert.equal(knowledge.generalRouterBypassed, false);

  const unrelated = decideConversationRoute({ message: "Can he float?", activeAction: abilityAction, actionState: state });
  assert.equal(unrelated.route, "INTERRUPTION");

  const intentSwitch = decideConversationRoute({ message: "I want to book an appointment.", activeAction: abilityAction, actionState: state });
  assert.equal(intentSwitch.route, "EXPLICIT_ACTION");
  assert.equal(intentSwitch.resolver, null);

  const handoff = decideConversationRoute({ message: "I want to talk to someone.", activeAction: abilityAction, actionState: state });
  assert.equal(handoff.route, "HUMAN_HANDOFF");
  assert.equal(handoff.resolver, null);
});

test("exit rescue detects natural pause language but ignores low-intent gratitude", () => {
  assert.equal(isExitRescueIntent("I'll check later"), true);
  assert.equal(isExitRescueIntent("Maybe next time"), true);
  assert.equal(isExitRescueIntent("Thanks"), false);
  assert.equal(isExitRescueDecline("No thanks"), true);
  assert.equal(isExitRescueDecline("Maybe later"), false);
});

test("meaningful engagement requires qualification progress, not a greeting or contact alone", () => {
  const state = createActionState(planAction);
  state.values = { email: "parent@example.com" };
  assert.equal(workflowHasMeaningfulEngagement(planAction, state), false);
  state.values = { usage_type: "Solo", main_goal: "Planning" };
  assert.equal(workflowHasMeaningfulEngagement(planAction, state), true);
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

test("corrections stay in the workflow before knowledge fallback", () => {
  const state = createActionState(planAction);
  state.values = { usage_type: "Solo", main_goal: "Planning + reminders", usage_level: "Daily" };
  state.currentStepId = "recommend-plan";

  assert.equal(isWorkflowCorrection("Actually, reminders are the bigger problem for us."), true);
  assert.equal(
    decideConversationRoute({
      message: "Actually, reminders are the bigger problem for us.",
      activeAction: planAction,
      actionState: state,
    }).route,
    "WORKFLOW_CONTINUATION",
  );
});

test("natural pricing questions remain interruptions while a CTA is available", () => {
  const state = createActionState(planAction);
  state.currentStepId = "recommend-plan";
  state.conversionAvailable = true;
  const decision = decideConversationRoute({
    message: "whats the price for a single salon",
    activeAction: planAction,
    actionState: state,
  });

  assert.equal(decision.route, "INTERRUPTION");
  assert.equal(decision.interruptionIntent, "pricing");
});

test("an explicit plan recommendation request stays in the active workflow", () => {
  const state = createActionState(planAction);
  state.values = { usage_type: "Solo", main_goal: "Planning + reminders", usage_level: "Daily" };
  state.currentStepId = "recommend-plan";
  const decision = decideConversationRoute({
    message: "Okay, which plan should I choose?",
    activeAction: planAction,
    actionState: state,
  });

  assert.equal(decision.route, "WORKFLOW_CONTINUATION");
  assert.equal(decision.preserveWorkflowState, true);
  assert.equal(decision.nextBestAction, "RECOMMEND_OPTION");
});

test("transactional wording can still be an answer to the active qualification workflow", () => {
  const salonAction: ActionFlow = {
    ...planAction,
    id: "salon-fit",
    key: "business_fit",
    fields: [
      { id: "business_type", key: "business_type", label: "Business type", type: "select", required: true, question: "What kind of business do you run?", options: ["Small salon", "Salon"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What are you mainly trying to improve?", options: ["Online booking", "Online booking + reminders", "Reminders"] },
    ],
  };
  const decision = decideConversationRoute({
    message: "I mainly need better online booking and reminders.",
    activeAction: salonAction,
    actionState: createActionState(salonAction),
  });

  assert.equal(decision.route, "WORKFLOW_CONTINUATION");
  assert.equal(decision.preserveWorkflowState, true);
});

test("SalonFlow regression keeps qualification ahead of CTA and resumes after side questions", () => {
  const salonWorkflow: ActionFlow = {
    ...planAction,
    id: "salon-flow",
    key: "business_fit",
    name: "SalonFlow fit",
    fields: [
      { id: "business_type", key: "business_type", label: "Business type", type: "select", required: true, question: "What kind of business do you run?", options: ["Small salon", "Salon"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What are you mainly trying to improve?", options: ["Online booking + reminders", "Reminders"] },
    ],
    steps: [
      { id: "business-type", type: "capture", fieldKey: "business_type" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal" },
      { id: "fit", type: "ask", question: "Here are the most relevant SalonFlow capabilities." },
    ],
  } as ActionFlow;
  const state = createActionState(salonWorkflow);
  const first = extractWorkflowValues(salonWorkflow, "I run a small salon and I’m looking for software.");
  applyWorkflowValues(salonWorkflow, state, first);
  assert.equal(state.values.business_type, "Small salon");
  assert.equal(currentWorkflowStep(salonWorkflow, state)?.id, "main-goal");

  const second = extractWorkflowValues(salonWorkflow, "I mainly need better online booking and reminders.");
  applyWorkflowValues(salonWorkflow, state, second);
  assert.equal(state.values.main_goal, "Online booking + reminders");
  const cursor = currentWorkflowStep(salonWorkflow, state)?.id;
  assert.equal(cursor, "fit");

  for (const question of [
    "How much does it cost?",
    "Does SalonFlow integrate with Mindbody?",
    "What if I don’t like it or want to cancel later?",
  ]) {
    const interruption = decideConversationRoute({ message: question, activeAction: salonWorkflow, actionState: state });
    assert.equal(interruption.route, "INTERRUPTION");
    assert.equal(interruption.currentStepId, cursor);
    assert.equal(interruption.preserveWorkflowState, true);
  }
  assert.equal(
    decideConversationRoute({ message: "Okay, I want to try it.", activeAction: salonWorkflow, actionState: state }).route,
    "WORKFLOW_CONTINUATION",
  );
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

test("a primary Action never bypasses an active Workflow regardless of completion type", () => {
  for (const executionMode of ["DIRECT_LINK", "FORM_FLOW", "PROVIDER_FLOW"] as const) {
    const primaryAction: ActionFlow = {
      ...action,
      id: `primary-${executionMode.toLowerCase()}`,
      key: `primary_${executionMode.toLowerCase()}`,
      name: "Primary conversion outcome",
      executionMode,
      isPrimary: true,
      steps: [{ id: "qualification", type: "capture", fieldKey: "preferred_days" }],
    } as ActionFlow;
    const decision = decideConversationRoute({
      message: "Saturday mornings",
      activeAction: primaryAction,
      actionState: createActionState(primaryAction),
    });
    assert.equal(decision.route, "WORKFLOW_CONTINUATION");
    assert.equal(decision.reason, "active_workflow_has_priority");
    assert.equal(decision.activeWorkflowId, primaryAction.id);
  }
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

test("human handoff intent wins before knowledge routing for natural variants", () => {
  const state = createActionState(action);
  for (const message of ["i wanna talk to somebody", "I want to speak to someone about this.", "I need help from a person"]) {
    const decision = decideConversationRoute({ message, activeAction: action, actionState: state });
    assert.equal(decision.route, "HUMAN_HANDOFF", message);
    assert.equal(decision.reason, "explicit_human_request", message);
    assert.equal(decision.interruptionIntent, null, message);
  }
});

test("waiting for staff keeps visitor questions available to AI", () => {
  const state = createActionState(action);
  const decision = decideConversationRoute({
    message: "Does this integrate with Mindbody?",
    activeAction: action,
    actionState: state,
    handoffState: "WAITING_FOR_STAFF",
  });

  assert.equal(decision.route, "INTERRUPTION");
  assert.equal(decision.interruptionIntent, "services");
  assert.equal(decision.handoffState, "WAITING_FOR_STAFF");
});

test("orchestrator distinguishes new action requests, general questions, and provider results", () => {
  assert.equal(decideConversationRoute({ message: "I want to enroll my child" }).route, "EXPLICIT_ACTION");
  assert.equal(decideConversationRoute({ message: "What services do you offer?" }).route, "GENERAL_QUESTION");
  assert.equal(decideConversationRoute({ message: "Jackrabbit returned two matching classes", activeAction: action, actionState: createActionState(action), providerResult: true }).route, "PROVIDER_RESULT");
});
