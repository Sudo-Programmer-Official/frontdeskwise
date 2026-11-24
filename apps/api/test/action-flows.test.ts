import assert from "node:assert/strict";
import test from "node:test";
import {
  createActionState,
  defaultActionFlows,
  detectAction,
  fieldPrompt,
  formFields,
  nextActionField,
  resolveCaptureMode,
  validateFieldValue,
  actionTemplate,
  actionReadiness,
} from "../src/action-flows.js";
import { currentWorkflowStep, replayWorkflowTurn } from "../src/workflow-engine.js";
import type { ActionField } from "../src/action-flows.js";

const ids = (key: string) => key + "-id";

test("swim school enrollment uses progressive capture", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons for students", ids);
  const action = detectAction(actions, "Sign me up");
  assert.equal(action?.key, "enroll_child");
  assert.equal(action?.name, "Find the right swim lesson");
  assert.match(action?.description ?? "", /verified registration/i);
  assert.deepEqual(action?.steps?.map((step) => step.id), [
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
    "save-lead",
    "enrollment-confirm",
    "registration-link",
    "enrollment-complete",
  ]);
  assert.equal(action?.steps?.find((step) => step.id === "class-selection")?.type, "select");
  assert.equal(action?.steps?.find((step) => step.id === "parent-contact")?.config?.ensureContact, true);
  assert.equal(action?.fields.find((field) => field.key === "email")?.required, false);
  assert.equal(action?.executionMode, "PROVIDER_FLOW");
  assert.equal(action?.provider, "jackrabbit");
  assert.equal(action?.attachmentPolicy, "high_intent_only");
  const state = createActionState(action!);
  assert.equal(nextActionField(action!, state)?.key, "customer_type");
  assert.match(fieldPrompt(nextActionField(action!, state)!), /new student/i);
  const customerType = validateFieldValue(nextActionField(action!, state)!, "new");
  assert.equal(customerType.value, "New student");
  state.values.customer_type = customerType.value!;
  assert.equal(nextActionField(action!, state)?.key, "child_age");
  assert.ok(action!.fields.some((field) => field.key === "ability"));
  assert.ok(action!.fields.some((field) => field.key === "goal"));
  assert.equal(action!.steps?.find((step) => step.id === "student-ability")?.fieldKey, "ability");
});

test("child swim-lesson search pre-fills known fields and asks about ability next", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons for students", ids);
  const action = actions.find((item) => item.key === "enroll_child")!;
  const replay = replayWorkflowTurn(action, createActionState(action), "I'm looking for swim lessons for my 6-year-old son.");

  assert.deepEqual(replay.extracted, { customer_type: "New student", child_age: "6" });
  assert.equal(replay.stateAfter.values.customer_type, "New student");
  assert.equal(replay.stateAfter.values.child_age, "6");
  assert.equal(currentWorkflowStep(action, replay.stateAfter)?.id, "student-ability");
  assert.match(currentWorkflowStep(action, replay.stateAfter)?.question ?? "", /comfortable.*water/i);
});

test("canonical legacy enrollment workflows infer Jackrabbit narrowly", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons", ids);
  const enrollment = actions.find((action) => action.key === "enroll_child")!;
  assert.deepEqual(actionReadiness(enrollment), { ready: true, reason: "ready" });
  assert.deepEqual(actionReadiness({ ...enrollment, provider: null, steps: undefined }), { ready: true, reason: "ready" });
  assert.deepEqual(actionReadiness({ ...enrollment, key: "custom_enrollment", provider: null, steps: undefined }), { ready: false, reason: "missing_configuration" });
});

test("salon booking is available from the same action engine", () => {
  const actions = defaultActionFlows("Glow Salon", "appointments with a stylist", ids);
  assert.equal(detectAction(actions, "Book an appointment")?.key, "book_appointment");
});

test("HVAC quote request is available from the same action engine", () => {
  const actions = defaultActionFlows("Cool Air HVAC", "air conditioning repair and estimates", ids);
  assert.equal(detectAction(actions, "I need a quote")?.key, "request_quote");
});

test("dental consultation is available from the same action engine", () => {
  const actions = defaultActionFlows("Family Dental", "dental consultations and exams", ids);
  assert.equal(detectAction(actions, "Schedule a consultation")?.key, "schedule_consultation");
});

test("daycare tour is available from the same action engine", () => {
  const actions = defaultActionFlows("Little Sprouts Daycare", "childcare and preschool tours", ids);
  assert.equal(detectAction(actions, "Book a tour")?.key, "book_tour");
});

test("field validation keeps the backend in control of structured answers", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons", ids);
  const enrollment = actions.find((action) => action.key === "enroll_child")!;
  const email = enrollment.fields.find((field) => field.key === "email")!;
  assert.equal(validateFieldValue(email, "not-an-email").value, null);
  assert.equal(validateFieldValue(email, "parent@example.com").value, "parent@example.com");
  const customerType = enrollment.fields.find((field) => field.key === "customer_type")!;
  assert.equal(validateFieldValue(customerType, "current").value, "Current student");
  assert.equal(validateFieldValue(customerType, "maybe").value, null);
  const phone = enrollment.fields.find((field) => field.key === "phone")!;
  const state = createActionState(enrollment);
  for (const field of enrollment.fields) {
    if (field.key !== phone.key) state.values[field.key] = "provided";
  }
  state.skipped = [phone.key];
  assert.equal(nextActionField(enrollment, state), null);
});

test("multi-select fields accept multiple configured options", () => {
  const field: ActionField = {
    id: "main_goal",
    key: "main_goal",
    label: "Main goal",
    type: "multi_select",
    required: true,
    question: "What would you like help with?",
    options: ["Planning", "Reminders", "Focus", "Research", "Calendar", "Team collaboration"],
  };
  assert.equal(validateFieldValue(field, "Planning, reminders and focus").value, "Planning, Reminders, Focus");
  assert.equal(validateFieldValue(field, "Planning, unknown").value, null);
  assert.match(fieldPrompt(field), /Planning, Reminders, Focus/);
});

test("capture mode minimizes friction for simple leads and preserves qualification for enrollment", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons", ids);
  const simpleLead = actions.find((action) => action.key === "capture_lead")!;
  const enrollment = actions.find((action) => action.key === "enroll_child")!;
  assert.equal(resolveCaptureMode(simpleLead), "form");
  assert.equal(resolveCaptureMode(enrollment), "hybrid");
  const state = createActionState(enrollment);
  assert.deepEqual(state.conversationalKeys, ["customer_type", "child_age"]);
  state.values.customer_type = "New student";
  state.values.child_age = "6";
  state.formShown = true;
  assert.ok(formFields(enrollment, state).some((field) => field.key === "email"));
  assert.ok(formFields(enrollment, state).some((field) => field.key === "location"));
});

test("action templates expose one canonical versioned field contract", () => {
  const actions = defaultActionFlows("Example Business", "appointments and enrollment", ids);
  const booking = actions.find((action) => action.key === "book_appointment")!;
  assert.equal(booking.version, 1);
  assert.deepEqual(booking.optionalFields, booking.fields.filter((field) => !field.required).map((field) => field.key));
  assert.equal(booking.handoffBehavior?.mode, "notify_staff");
});

test("direct-link readiness is the canonical primary-action gate", () => {
  const action = {
    ...defaultActionFlows("Example Business", "appointments", ids)[0],
    key: "open_link",
    name: "Try the demo",
    triggerPhrases: ["try the demo"],
    fields: [],
    executionMode: "DIRECT_LINK" as const,
    trackingKey: "try_demo",
    completion: {
      ...defaultActionFlows("Example Business", "appointments", ids)[0].completion,
      createLead: false,
      linkUrl: "https://example.test/start",
      linkLabel: "Try the demo",
    },
  };
  assert.deepEqual(actionReadiness(action), { ready: true, reason: "ready" });
  assert.deepEqual(actionReadiness({ ...action, completion: { ...action.completion, linkUrl: "" } }), { ready: false, reason: "missing_destination" });
  assert.deepEqual(actionReadiness({ ...action, completion: { ...action.completion, linkUrl: "not-a-url" } }), { ready: false, reason: "invalid_destination" });
  assert.deepEqual(actionReadiness({ ...action, trackingKey: "" }), { ready: false, reason: "missing_tracking_key" });
  assert.deepEqual(actionReadiness({ ...action, enabled: false }), { ready: false, reason: "disabled" });
  assert.equal(actionTemplate("open_link")?.name, "Send visitors to a link");
});

test("link actions provide a direct-link template without form fields", () => {
  const template = actionTemplate("open_link");
  assert.equal(template?.actionType, "open_link");
  assert.equal(template?.executionMode, "DIRECT_LINK");
  assert.equal(template?.attachmentPolicy, "sales_intent");
  assert.deepEqual(template?.fields, []);
  assert.equal(template?.completion.message, "You can try the demo here.");
  assert.equal(template?.completion.linkLabel, "Open link");
});
