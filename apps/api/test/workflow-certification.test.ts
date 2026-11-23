import assert from "node:assert/strict";
import test from "node:test";
import {
  actionResourceFromJackrabbit,
  resolveAction,
} from "../src/action-registry.js";
import {
  createActionState,
  defaultActionFlows,
  type ActionFlow,
  type ConversationActionState,
} from "../src/action-flows.js";
import { JackrabbitProvider } from "../src/jackrabbit-provider.js";
import {
  addWorkflowParticipant,
  activateProviderFallback,
  applyWorkflowInput,
  currentWorkflowStep,
  extractWorkflowValues,
  invalidateWorkflowLookups,
  migrateWorkflowState,
  pushWorkflowInterruption,
  replayWorkflowTurn,
  resumeWorkflowInterruption,
  setWorkflowParticipantValue,
  workflowNextBestAction,
  workflowSummary,
  providerFallbackStep,
} from "../src/workflow-engine.js";

const ids = (key: string) => `${key}-certification-id`;
const enrollment = defaultActionFlows("British Swim School", "swim lessons and enrollment", ids).find((action) => action.key === "enroll_child")!;

function stateAt(stepId: string, values: Record<string, string> = {}, completedStepIds: string[] = []): ConversationActionState {
  const state = createActionState(enrollment, "2026-01-01T00:00:00.000Z");
  state.currentStepId = stepId;
  state.values = { ...values };
  state.completedStepIds = [...completedStepIds];
  return state;
}

function stepIdsThrough(stepId: string): string[] {
  const index = enrollment.steps!.findIndex((step) => step.id === stepId);
  return enrollment.steps!.slice(0, index + 1).map((step) => step.id);
}

test("British Swim School certification uses the canonical reference workflow", () => {
  assert.deepEqual(enrollment.steps?.map((step) => step.id), [
    "customer-type",
    "student-age",
    "student-ability",
    "student-goal",
    "student-location",
    "student-schedule",
    "registration-options",
    "class-recommendations",
    "class-selection",
    "parent-contact",
    "enrollment-confirm",
    "registration-link",
    "enrollment-complete",
  ]);
  assert.equal(enrollment.provider, "jackrabbit");
  assert.equal(enrollment.version, 2);
});

test("provider fallback reuses the enrollment contact form and never fabricates a class", () => {
  const state = createActionState(enrollment);
  const fallback = activateProviderFallback(enrollment, state, "jackrabbit", "unavailable");

  assert.equal(providerFallbackStep(enrollment)?.id, "parent-contact");
  assert.equal(fallback?.id, "parent-contact");
  assert.deepEqual(state.providerFallback, { provider: "jackrabbit", reason: "unavailable" });
  assert.equal(state.currentStepId, "parent-contact");
  assert.equal(state.formShown, true);
  assert.equal(currentWorkflowStep(enrollment, state)?.id, "parent-contact");
  assert.equal(state.lookupResults, undefined);
});

const goldenTurns: Array<{
  name: string;
  input: string;
  state: ConversationActionState;
  expectedUpdated?: string[];
  expectedCurrent?: string;
}> = [
  {
    name: "captures multiple qualification fields in one sentence",
    input: "New student, age 7, beginner, learn to swim, at Largo, Saturdays.",
    state: createActionState(enrollment),
    expectedUpdated: ["customer_type", "child_age", "ability", "goal", "location", "schedule_preference"],
    expectedCurrent: "registration-options",
  },
  {
    name: "captures contact fields together when the visitor volunteers them",
    input: "My name is Jamie Rivera, jamie@example.com, 727-555-0199.",
    state: stateAt("parent-contact", { customer_type: "New student", child_age: "8", ability: "Beginner", goal: "Learn to swim", location: "Largo", schedule_preference: "Saturdays" }, stepIdsThrough("class-selection")),
    expectedUpdated: ["parent_name", "email", "phone"],
    expectedCurrent: "parent-contact",
  },
  {
    name: "accepts a future age answer without moving past the current step blindly",
    input: "She is 8, and Saturdays work for us.",
    state: stateAt("customer-type"),
    expectedUpdated: ["child_age", "schedule_preference"],
    expectedCurrent: "customer-type",
  },
  {
    name: "accepts a future ability answer without moving past customer type",
    input: "He is a beginner and wants water safety.",
    state: stateAt("customer-type"),
    expectedUpdated: ["ability", "goal"],
    expectedCurrent: "customer-type",
  },
  {
    name: "corrects age and ability in the same turn",
    input: "Actually, she is 7 and can swim with help.",
    state: stateAt("student-ability", { customer_type: "New student", child_age: "6" }, stepIdsThrough("student-age")),
    expectedUpdated: ["child_age", "ability"],
    expectedCurrent: "student-goal",
  },
  {
    name: "corrects the goal before the provider lookup",
    input: "Actually, the goal is water safety.",
    state: stateAt("student-goal", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim" }, stepIdsThrough("student-ability")),
    expectedUpdated: ["goal"],
    expectedCurrent: "student-location",
  },
  {
    name: "extracts a named program for a provider search",
    input: "We are looking for the Turtle 2 program.",
    state: stateAt("parent-contact", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", location: "Largo", schedule_preference: "Saturdays" }, stepIdsThrough("class-selection")),
    expectedUpdated: ["program"],
    expectedCurrent: "registration-options",
  },
  {
    name: "rejects an invalid email instead of storing it",
    input: "My email is parent-at-example.",
    state: stateAt("parent-contact", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", location: "Largo", schedule_preference: "Saturdays" }, stepIdsThrough("class-selection")),
    expectedUpdated: [],
    expectedCurrent: "parent-contact",
  },
  {
    name: "captures a phone number without changing the workflow cursor",
    input: "You can reach me at +1 (727) 555-0199.",
    state: stateAt("parent-contact", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", location: "Largo", schedule_preference: "Saturdays" }, stepIdsThrough("class-selection")),
    expectedUpdated: ["phone"],
    expectedCurrent: "parent-contact",
  },
  {
    name: "captures a location correction after lookup has started",
    input: "Actually, Clearwater works better.",
    state: stateAt("enrollment-confirm", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", location: "Largo" }, stepIdsThrough("registration-options")),
    expectedUpdated: ["location"],
    expectedCurrent: "registration-options",
  },
  {
    name: "captures a schedule correction after lookup has started",
    input: "Please switch to Sundays instead.",
    state: stateAt("enrollment-confirm", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", schedule_preference: "Saturday" }, stepIdsThrough("registration-options")),
    expectedUpdated: ["schedule_preference"],
    expectedCurrent: "registration-options",
  },
];

for (const scenario of goldenTurns) {
  test(`golden turn: ${scenario.name}`, () => {
    const original = JSON.parse(JSON.stringify(scenario.state)) as ConversationActionState;
    const result = replayWorkflowTurn(enrollment, scenario.state, scenario.input);
    assert.deepEqual(result.updated, scenario.expectedUpdated ?? []);
    assert.equal(result.stateAfter.currentStepId, scenario.expectedCurrent);
    assert.deepEqual(scenario.state, original, "replay must not mutate the production snapshot");
  });
}

test("side questions are stacked and resume on the same workflow step", () => {
  const state = stateAt("student-ability", { customer_type: "New student", child_age: "7" }, stepIdsThrough("student-age"));
  pushWorkflowInterruption(state, { intent: "pricing", question: "How much are lessons?", returnStepId: "student-ability" }, "2026-01-01T00:00:00.000Z");
  assert.equal(state.interruptionStack?.length, 1);
  assert.equal(resumeWorkflowInterruption(state)?.returnStepId, "student-ability");
  assert.equal(currentWorkflowStep(enrollment, state)?.id, "student-ability");
});

test("lookup cache is invalidated when a lookup dependency changes", () => {
  const state = stateAt("enrollment-confirm", { location: "Largo", schedule_preference: "Saturday" }, stepIdsThrough("registration-options"));
  state.lookupResults = { "registration-options": { status: "matched", matches: [{ id: "class-largo" }] } };
  assert.equal(invalidateWorkflowLookups(enrollment, state, ["location"]), true);
  assert.equal(state.lookupResults?.["registration-options"], undefined);
  assert.equal(state.selectedActionResourceId, undefined);
  assert.equal(state.currentStepId, "registration-options");
  assert.equal(state.status, "active");
});

test("contact-only corrections do not invalidate a provider lookup", () => {
  const state = stateAt("enrollment-confirm", { location: "Largo" }, stepIdsThrough("registration-options"));
  state.lookupResults = { "registration-options": { status: "matched", matches: [{ id: "class-largo" }] } };
  assert.equal(invalidateWorkflowLookups(enrollment, state, ["email"]), false);
  assert.ok(state.lookupResults?.["registration-options"]);
});

test("stale workflow versions preserve values and move a removed cursor safely", () => {
  const state = stateAt("removed-step", { customer_type: "New student", child_age: "7" }, ["customer-type"]);
  state.workflowVersion = 0;
  const migration = migrateWorkflowState(enrollment, state);
  assert.equal(migration.migrated, true);
  assert.equal(migration.toVersion, 2);
  assert.equal(state.values.child_age, "7");
  assert.equal(state.currentStepId, "student-ability");
  assert.equal(state.workflowVersion, 2);
});

test("a returned conversation survives serialization with its cursor intact", () => {
  const state = stateAt("student-goal", { customer_type: "New student", child_age: "7", ability: "Beginner" }, stepIdsThrough("student-ability"));
  const returned = JSON.parse(JSON.stringify(state)) as ConversationActionState;
  migrateWorkflowState(enrollment, returned);
  assert.equal(returned.currentStepId, "student-goal");
  assert.deepEqual(returned.values, state.values);
});

test("human takeover handback keeps the workflow cursor resumable", () => {
  const state = stateAt("student-goal", { customer_type: "New student", child_age: "7", ability: "Beginner" }, stepIdsThrough("student-ability"));
  state.status = "active";
  const cursor = state.currentStepId;
  state.status = "active";
  assert.equal(state.currentStepId, cursor);
  assert.equal(currentWorkflowStep(enrollment, state)?.id, "student-goal");
});

test("waitlist-only provider resources remain actionable when explicitly allowed", () => {
  const waitlist = actionResourceFromJackrabbit({
    businessId: "business-1",
    option: { id: "class-waitlist", name: "Turtle 2", location: "Largo", days: ["Sunday"], startTime: "10:30 AM", endTime: null, openings: 0, waitlistAvailable: true, tuition: null, registrationUrl: "https://register.example/waitlist" },
  });
  const resolution = resolveAction([waitlist], { type: "registration", filters: { location: "Largo" }, includeWaitlist: true });
  assert.equal(resolution.status, "matched");
  assert.equal(resolution.matches[0].status, "WAITLIST");
});

test("full provider resources remain separate from waitlist-only resources", () => {
  const active = actionResourceFromJackrabbit({
    businessId: "business-1",
    option: { id: "class-active", name: "Turtle 2", location: "Largo", days: ["Wednesday"], startTime: "10:30 AM", endTime: null, openings: 3, waitlistAvailable: false, tuition: null, registrationUrl: "https://register.example/active" },
  });
  const waitlist = actionResourceFromJackrabbit({
    businessId: "business-1",
    option: { id: "class-waitlist", name: "Turtle 2", location: "Largo", days: ["Sunday"], startTime: "10:30 AM", endTime: null, openings: 0, waitlistAvailable: true, tuition: null, registrationUrl: "https://register.example/waitlist" },
  });
  const resolution = resolveAction([active, waitlist], { type: "registration", filters: { location: "Largo" }, includeWaitlist: true });
  assert.deepEqual(resolution.matches.map((match) => match.id), ["jackrabbit:class-active", "jackrabbit:class-waitlist"]);
});

test("no availability fails closed instead of inventing a class", () => {
  const resolution = resolveAction([], { type: "registration", filters: { location: "Largo" }, includeWaitlist: true });
  assert.equal(resolution.status, "not_found");
  assert.deepEqual(resolution.matches, []);
});

test("provider timeouts surface as retryable connector errors", async () => {
  const provider = new JackrabbitProvider({ accessToken: "test-token", baseUrl: "http://127.0.0.1:9999", fetcher: async () => {
    const error = new Error("aborted");
    error.name = "AbortError";
    throw error;
  } });
  await assert.rejects(() => provider.verifyConnection(), /timed out/);
});

test("provider failures retain correlation context for traceability", async () => {
  const provider = new JackrabbitProvider({ accessToken: "test-token", baseUrl: "http://127.0.0.1:9999", fetcher: async () => new Response("{}", { status: 504, headers: { "x-trace-id": "trace-504" } }) });
  await assert.rejects(() => provider.verifyConnection(), /504; trace trace-504/);
});

test("registration links never expose provider credentials", () => {
  const provider = new JackrabbitProvider({ accessToken: "secret-token", baseUrl: "http://127.0.0.1:9999" });
  const result = provider.buildRegistrationLink({ baseUrl: "https://register.example/start", classIdParam: "classId", fieldMappings: { email: "email" } }, { id: "class-active" }, { email: "parent@example.com" });
  assert.match(result.url, /classId=class-active/);
  assert.doesNotMatch(result.url, /secret-token/);
});

test("provider call replay is deterministic for an unchanged snapshot", () => {
  const state = stateAt("enrollment-confirm", { location: "Largo", schedule_preference: "Saturday" }, stepIdsThrough("registration-options"));
  state.lookupResults = { "registration-options": { status: "matched", matches: [{ id: "class-active" }] } };
  const first = replayWorkflowTurn(enrollment, state, "Yes, please continue.");
  const second = replayWorkflowTurn(enrollment, state, "Yes, please continue.");
  assert.deepEqual(first.stateAfter, second.stateAfter);
  assert.equal(first.nextBestActionAfter, second.nextBestActionAfter);
});

test("repeatable participants keep each student's qualification independent", () => {
  const state = createActionState(enrollment);
  const first = addWorkflowParticipant(state, "student", "Michael");
  setWorkflowParticipantValue(state, "ability", "Beginner");
  const second = addWorkflowParticipant(state, "student", "Sophia");
  setWorkflowParticipantValue(state, "ability", "Can swim with help");
  assert.equal(first.values.ability, "Beginner");
  assert.equal(second.values.ability, "Can swim with help");
  assert.equal(state.values[`participants.${second.id}.ability`], "Can swim with help");
});

test("workflow summary exposes provider lookup as the next best action", () => {
  const state = stateAt("registration-options", { customer_type: "New student", child_age: "7", ability: "Beginner", goal: "Learn to swim", location: "Largo", schedule_preference: "Saturdays" }, stepIdsThrough("student-schedule"));
  const summary = workflowSummary(enrollment, state);
  assert.equal(summary.nextBestAction, "LOOKUP_CLASSES");
  assert.equal(summary.provider, "jackrabbit");
  assert.equal(summary.currentStepId, "registration-options");
});

test("confirm, link, and completion states expose deterministic next actions", () => {
  const confirm = stateAt("enrollment-confirm");
  assert.equal(workflowNextBestAction(enrollment, currentWorkflowStep(enrollment, confirm)), "CONFIRM_SELECTION");
  const link = stateAt("registration-link");
  assert.equal(workflowNextBestAction(enrollment, currentWorkflowStep(enrollment, link)), "GENERATE_REGISTRATION_LINK");
  const done = stateAt("enrollment-complete");
  done.status = "completed";
  assert.equal(workflowSummary(enrollment, done).nextBestAction, "COMPLETED");
});

test("direct-link actions remain outside the workflow engine", () => {
  const direct: ActionFlow = {
    ...enrollment,
    key: "open_link",
    name: "Try the demo",
    fields: [],
    steps: undefined,
    captureMode: "form",
    executionMode: "DIRECT_LINK",
  };
  const state = createActionState(direct);
  const result = replayWorkflowTurn(direct, state, "Try the demo");
  assert.equal(result.nextBestActionBefore, "COMPLETED");
  assert.equal(result.nextBestActionAfter, "COMPLETED");
  assert.deepEqual(result.updated, []);
});

test("a current field answer still transitions when extraction has no typed match", () => {
  const locationAction: ActionFlow = {
    ...enrollment,
    fields: [{ id: "location", key: "location", label: "Location", type: "text", required: true, question: "Which location works best?" }],
    steps: [{ id: "location", type: "capture", fieldKey: "location" }, { id: "done", type: "complete" }],
  };
  const result = replayWorkflowTurn(locationAction, createActionState(locationAction), "Largo");
  assert.equal(result.stateAfter.values.location, "Largo");
  assert.equal(result.stateAfter.currentStepId, "done");
});

test("invalidated lookup results do not survive a serialized stale snapshot", () => {
  const state = stateAt("enrollment-confirm", { location: "Largo" }, stepIdsThrough("registration-options"));
  state.lookupResults = { "registration-options": { status: "matched", matches: [{ id: "old-class" }] } };
  const restored = JSON.parse(JSON.stringify(state)) as ConversationActionState;
  invalidateWorkflowLookups(enrollment, restored, ["location"]);
  assert.equal(restored.lookupResults?.["registration-options"], undefined);
  assert.equal(restored.currentStepId, "registration-options");
});

test("a completed workflow reports full progress and no missing fields", () => {
  const state = createActionState(enrollment);
  state.status = "completed";
  state.completedStepIds = enrollment.steps!.map((step) => step.id);
  state.values = Object.fromEntries(enrollment.fields.map((field) => [field.key, field.type === "email" ? "parent@example.com" : "provided"]));
  const summary = workflowSummary(enrollment, state);
  assert.equal(summary.progressPercent, 100);
  assert.deepEqual(summary.missing, []);
});
