import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkflowParticipant,
  applyWorkflowInput,
  applyWorkflowValues,
  currentWorkflowStep,
  extractWorkflowValues,
  knownSoftwareProvider,
  normalizeWorkflowFieldValue,
  invalidateWorkflowLookups,
  pushWorkflowInterruption,
  resumeWorkflowInterruption,
  setWorkflowParticipantValue,
  transitionWorkflow,
  workflowSummary,
} from "../src/workflow-engine.js";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import { generateCompletionLink } from "../src/completion-links.js";

const flow: ActionFlow = {
  id: "enrollment-id",
  key: "enrollment",
  name: "Register",
  description: "",
  triggerPhrases: ["register"],
  triggerIntents: ["enrollment"],
  captureMode: "conversational",
  fields: [
    { id: "name", key: "name", label: "Name", type: "text", required: true, question: "What is your name?" },
    { id: "email", key: "email", label: "Email", type: "email", required: true, question: "What is your email?" },
  ],
  steps: [
    { id: "name", type: "capture", fieldKey: "name" },
    { id: "branch", type: "decision", branches: [
      { when: { field: "name", equals: "skip" }, nextStepId: "done" },
    ] },
    { id: "email", type: "capture", fieldKey: "email" },
    { id: "done", type: "complete" },
  ],
  completion: { createLead: true, leadStatus: "qualified", message: "Done", notifyStaff: false },
  enabled: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

test("workflow steps capture values and resolve a decision branch", () => {
  const state = createActionState(flow);
  assert.equal(currentWorkflowStep(flow, state)?.id, "name");
  const first = applyWorkflowInput(flow, state, "skip");
  assert.equal(first.ok, true);
  assert.equal(first.transition.step?.id, "done");
  assert.equal(first.transition.state.status, "active");
});

test("workflow skips unverified pricing and keeps guided demo as a conditional branch", () => {
  const salonWorkflow: ActionFlow = {
    ...flow,
    id: "salon-workflow",
    key: "salon_workflow",
    name: "Help me choose SalonFlow",
    steps: [
      { id: "pricing", type: "ask", config: { reviewStatus: "needs_owner_confirmation", requiresVerifiedData: true } },
      { id: "try-demo", type: "redirect", config: { normalConversionEndpoint: true } },
      { id: "request-demo", type: "redirect", config: { conditional: true, trigger: "explicit_guided_demo_request" } },
      { id: "support", type: "handoff", config: { conditional: true, trigger: "explicit_support_or_human_request" } },
      { id: "complete", type: "complete" },
    ],
  };
  const state = createActionState(salonWorkflow);

  assert.equal(currentWorkflowStep(salonWorkflow, state)?.id, "try-demo");
  state.workflowTrigger = "explicit_guided_demo_request";
  state.currentStepId = "request-demo";
  assert.equal(currentWorkflowStep(salonWorkflow, state)?.id, "request-demo");
  state.workflowTrigger = undefined;
  state.currentStepId = "request-demo";
  assert.equal(currentWorkflowStep(salonWorkflow, state)?.id, "complete");
});

test("conditional knowledge steps stay off the normal cursor until their topic is requested", () => {
  const knowledgeWorkflow: ActionFlow = {
    ...flow,
    id: "knowledge-side-path",
    steps: [
      { id: "name", type: "capture", fieldKey: "name" },
      { id: "pricing", type: "knowledge", label: "Pricing", config: { conditional: true, topic: "pricing" } },
      { id: "done", type: "complete" },
    ],
  };
  const state = createActionState(knowledgeWorkflow);
  assert.equal(currentWorkflowStep(knowledgeWorkflow, state)?.id, "name");
  state.values.name = "Alex";
  state.completedStepIds = ["name"];
  state.currentStepId = "pricing";
  assert.equal(currentWorkflowStep(knowledgeWorkflow, state)?.id, "done");
  state.workflowTrigger = "pricing";
  assert.equal(currentWorkflowStep(knowledgeWorkflow, state)?.id, "pricing");
});

test("workflow interruptions preserve the cursor and resume", () => {
  const state = createActionState(flow);
  pushWorkflowInterruption(state, { intent: "pricing", question: "How much?", returnStepId: "name" }, "2026-01-01T00:00:00.000Z");
  assert.equal(state.interruptionStack?.length, 1);
  assert.equal(resumeWorkflowInterruption(state)?.returnStepId, "name");
  assert.equal(state.currentStepId, "name");
});

test("participants keep independent values for multi-entity actions", () => {
  const state = createActionState(flow);
  const first = addWorkflowParticipant(state, "student", "Michael");
  setWorkflowParticipantValue(state, "age", "10");
  const second = addWorkflowParticipant(state, "student", "Sophia");
  setWorkflowParticipantValue(state, "age", "7");
  assert.equal(first.values.age, "10");
  assert.equal(second.values.age, "7");
  assert.equal(state.values[`participants.${second.id}.age`], "7");
});

test("completion links map only explicit fields", () => {
  const result = generateCompletionLink({
    baseUrl: "https://provider.example/register",
    fieldMappings: {
      "customer.firstName": "MFName",
      "student.firstName": "S1FName",
      "selectedClass.providerId": "S1Class1",
    },
    staticParams: { source: "frontdeskwise" },
  }, {
    customer: { firstName: "John" },
    student: { firstName: "Michael" },
    selectedClass: { providerId: "19259740" },
    cardNumber: "never-map-this",
  });
  assert.equal(result.missingFields.length, 0);
  assert.match(result.url, /MFName=John/);
  assert.match(result.url, /S1Class1=19259740/);
  assert.doesNotMatch(result.url, /cardNumber/);
});

test("workflow extraction accepts corrections and future answers without moving the cursor blindly", () => {
  const enrollment: ActionFlow = {
    ...flow,
    key: "enroll_child",
    actionType: "enroll",
    provider: "jackrabbit",
    fields: [
      { id: "child_age", key: "child_age", label: "Child age", type: "number", required: true, question: "How old is the child?" },
      { id: "ability", key: "ability", label: "Ability", type: "select", required: true, question: "What is their ability?", options: ["Beginner", "Can swim independently"] },
      { id: "schedule_preference", key: "schedule_preference", label: "Schedule", type: "text", required: false, question: "What schedule works?" },
    ],
    steps: [
      { id: "age", type: "capture", fieldKey: "child_age" },
      { id: "ability", type: "capture", fieldKey: "ability" },
      { id: "details", type: "form", config: { fieldKeys: ["schedule_preference"] } },
      { id: "done", type: "complete" },
    ],
  };
  const state = createActionState(enrollment);
  const values = extractWorkflowValues(enrollment, "Actually, she is 7 and weekends are best.");
  assert.equal(values.child_age, "7");
  assert.equal(values.schedule_preference, "weekends");
  const applied = applyWorkflowValues(enrollment, state, values);
  assert.deepEqual(applied.updated, ["child_age", "schedule_preference"]);
  assert.equal(applied.transition.step?.id, "ability");
  assert.equal(state.values.schedule_preference, "weekends");
  assert.equal(extractWorkflowValues(enrollment, "Yes, but she can't really swim yet.").ability, "Beginner");
});

test("plan selection extracts natural solo, paired-goal, daily, and correction language", () => {
  const plan: ActionFlow = {
    ...flow,
    id: "plan-selection",
    key: "choose_plan",
    name: "Choose the right plan",
    fields: [
      { id: "usage_type", key: "usage_type", label: "Usage type", type: "select", required: true, question: "Solo or team?", options: ["Solo", "Team"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What is your goal?", options: ["Planning", "Reminders", "Planning + reminders"] },
      { id: "usage_level", key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often?", options: ["Occasionally", "Regularly", "Daily"] },
    ],
    steps: [
      { id: "usage-type", type: "capture", fieldKey: "usage_type" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal" },
      { id: "usage-level", type: "capture", fieldKey: "usage_level" },
      { id: "recommend-plan", type: "recommend" },
    ],
  };
  const state = createActionState(plan);
  const first = applyWorkflowValues(plan, state, extractWorkflowValues(plan, "It's just for me and I mainly need planning and reminders"));
  assert.deepEqual(first.updated, ["usage_type", "main_goal"]);
  assert.equal(state.values.usage_type, "Solo");
  assert.equal(state.values.main_goal, "Planning + reminders");
  assert.equal(currentWorkflowStep(plan, state)?.id, "usage-level");

  const daily = applyWorkflowValues(plan, state, extractWorkflowValues(plan, "I'll probably use it frequently."));
  assert.deepEqual(daily.updated, ["usage_level"]);
  assert.equal(state.values.usage_level, "Daily");
  assert.equal(currentWorkflowStep(plan, state)?.id, "recommend-plan");

  const correction = applyWorkflowValues(plan, state, extractWorkflowValues(plan, "Actually I may use it with a small team."));
  assert.deepEqual(correction.updated, ["usage_type"]);
  assert.equal(state.values.usage_type, "Team");
});

test("plan corrections invalidate the stored recommendation and pricing context", () => {
  const plan: ActionFlow = {
    ...flow,
    id: "plan-selection-invalidation",
    key: "choose_plan",
    name: "Choose the right plan",
    fields: [
      { id: "usage_type", key: "usage_type", label: "Usage type", type: "select", required: true, question: "Solo or team?", options: ["Solo", "Team"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What is your goal?", options: ["Planning", "Planning + reminders"] },
      { id: "usage_level", key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often?", options: ["Occasionally", "Regularly", "Daily"] },
      { id: "recommended_plan", key: "recommended_plan", label: "Recommended plan", type: "text", required: false, visibility: "hidden", question: "" },
    ],
    steps: [
      { id: "usage-type", type: "capture", fieldKey: "usage_type" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal" },
      { id: "usage-level", type: "capture", fieldKey: "usage_level" },
      { id: "recommend-plan", type: "recommend", config: { recommendationType: "plan" } },
      { id: "explain-plan", type: "ask" },
    ],
  };
  const state = createActionState(plan);
  state.currentStepId = "explain-plan";
  state.values = { usage_type: "Solo", main_goal: "Planning + reminders", usage_level: "Daily", recommended_plan: "Solo Premium" };
  state.lookupResults = {
    "recommend-plan": { status: "matched", recommendation: { plan: "Solo Premium", price: "$5/month" } },
    pricing_context: { recommendedPlan: "Solo Premium", verifiedPrice: "$5/month", verified: true },
  };
  state.completedStepIds = ["usage-type", "main-goal", "usage-level", "recommend-plan"];

  const invalidated = invalidateWorkflowLookups(plan, state, ["usage_type"]);

  assert.equal(invalidated, true);
  assert.equal(state.values.recommended_plan, undefined);
  assert.equal(state.lookupResults?.["recommend-plan"], undefined);
  assert.equal(state.lookupResults?.pricing_context, undefined);
  assert.equal(state.currentStepId, "recommend-plan");
  assert.equal(state.status, "active");
});

test("SalonFlow captures a small salon and a composite booking/reminders goal", () => {
  const salon: ActionFlow = {
    ...flow,
    id: "salon-fit",
    key: "business_fit",
    fields: [
      { id: "business_type", key: "business_type", label: "Business type", type: "select", required: true, question: "What kind of business do you run?", options: ["Small salon", "Salon", "Spa"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What are you trying to improve?", options: ["Online booking", "Online booking + reminders", "Reminders"] },
    ],
    steps: [
      { id: "business-type", type: "capture", fieldKey: "business_type" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal" },
    ],
  };
  const state = createActionState(salon);
  const values = extractWorkflowValues(salon, "I run a small salon and mainly need better online booking and reminders.");
  assert.equal(values.business_type, "Small salon");
  assert.equal(values.main_goal, "Online booking + reminders");
  const applied = applyWorkflowValues(salon, state, values);
  assert.deepEqual(applied.updated, ["business_type", "main_goal"]);
  assert.equal(state.values.main_goal, "Online booking + reminders");

  const correction = extractWorkflowValues(salon, "Actually, reminders are the bigger problem for us.");
  assert.equal(correction.main_goal, "Reminders");
});

test("workflow software capture stores the product name instead of the whole sentence", () => {
  const field = { id: "current_software", key: "current_software", label: "Current software", type: "text", required: true, question: "Are you using any salon software today?" } as const;
  assert.equal(normalizeWorkflowFieldValue(field, "We use Mindbody right now."), "Mindbody");

  const action: ActionFlow = {
    ...flow,
    fields: [field],
    steps: [{ id: "current-software", type: "capture", fieldKey: "current_software" }],
  };
  const state = createActionState(action);
  const result = applyWorkflowInput(action, state, "We use Mindbody right now.");
  assert.equal(result.ok, true);
  assert.equal(state.values.current_software, "Mindbody");
});

test("compatibility questions also capture a known provider for the pending software field", () => {
  const action: ActionFlow = {
    ...flow,
    fields: [{ id: "current_software", key: "current_software", label: "Current software", type: "text", required: true, question: "Are you using any salon software today?" }],
    steps: [{ id: "current-software", type: "capture", fieldKey: "current_software" }],
  };

  const extracted = extractWorkflowValues(action, "Does it work with Mindbody?");
  assert.equal(extracted.current_software, "Mindbody");

  const state = createActionState(action);
  const applied = applyWorkflowValues(action, state, extracted);
  assert.deepEqual(applied.updated, ["current_software"]);
  assert.equal(state.values.current_software, "Mindbody");
  assert.equal(knownSoftwareProvider("Can you import from QuickBooks Online?"), "QuickBooks Online");
  assert.equal(knownSoftwareProvider("Would I need to switch from HubSpot?"), "HubSpot");
});

test("plan selection accepts a literal option and advances past the current step", () => {
  const plan: ActionFlow = {
    ...flow,
    id: "plan-selection-literal",
    key: "choose_plan",
    name: "Choose the right plan",
    fields: [
      { id: "usage_type", key: "usage_type", label: "Usage type", type: "select", required: true, question: "Solo or team?", options: ["Solo", "Team"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What is your goal?", options: ["Planning", "Reminders", "Planning + reminders"] },
      { id: "usage_level", key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often?", options: ["Occasionally", "Regularly", "Daily"] },
    ],
    steps: [
      { id: "usage-type", type: "capture", fieldKey: "usage_type" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal" },
      { id: "usage-level", type: "capture", fieldKey: "usage_level" },
    ],
  };
  const state = createActionState(plan);
  const result = applyWorkflowValues(plan, state, extractWorkflowValues(plan, "Solo"));

  assert.deepEqual(result.updated, ["usage_type"]);
  assert.equal(state.values.usage_type, "Solo");
  assert.equal(currentWorkflowStep(plan, state)?.id, "main-goal");
});

test("workflow extraction keeps multiple configured choices in order", () => {
  const action: ActionFlow = {
    ...flow,
    fields: [{ id: "goals", key: "goals", label: "Goals", type: "multi_select", required: true, question: "What should we help with?", options: ["Planning", "Reminders", "Focus"] }],
    steps: [{ id: "goals", type: "capture", fieldKey: "goals" }],
  };
  const values = extractWorkflowValues(action, "Planning, reminders and focus");
  assert.equal(values.goals, "Planning, Reminders, Focus");
});

test("resuming an interruption does not rewind a cursor advanced by the answer", () => {
  const state = createActionState(flow);
  pushWorkflowInterruption(state, { intent: "pricing", question: "How much?", returnStepId: "name" }, "2026-01-01T00:00:00.000Z");
  state.currentStepId = "email";

  resumeWorkflowInterruption(state);

  assert.equal(state.currentStepId, "email");
  assert.equal(state.interruptionStack?.length, 0);
});

test("workflow summary exposes a deterministic next-best action and progress", () => {
  const action: ActionFlow = {
    ...flow,
    key: "enroll_child",
    actionType: "enroll",
    provider: "jackrabbit",
    steps: [
      { id: "age", type: "capture", fieldKey: "name" },
      { id: "lookup", type: "lookup", config: { provider: "jackrabbit" } },
      { id: "confirm", type: "confirm", question: "Continue?" },
      { id: "link", type: "generate_link" },
    ],
  };
  const state = createActionState(action);
  assert.equal(workflowSummary(action, state).nextBestAction, "ASK_FIELD");
  applyWorkflowInput(action, state, "Michael");
  const summary = workflowSummary(action, state);
  assert.equal(summary.currentState, "lookup");
  assert.equal(summary.nextBestAction, "LOOKUP_CLASSES");
  assert.equal(summary.progressPercent, 25);
  assert.deepEqual(summary.missing, ["email"]);
});

