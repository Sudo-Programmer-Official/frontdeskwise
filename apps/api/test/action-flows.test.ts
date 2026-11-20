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
} from "../src/action-flows.js";

const ids = (key: string) => key + "-id";

test("swim school enrollment uses progressive capture", () => {
  const actions = defaultActionFlows("British Swim School", "swim lessons for students", ids);
  const action = detectAction(actions, "Sign me up");
  assert.equal(action?.key, "enroll_child");
  const state = createActionState(action!);
  assert.equal(nextActionField(action!, state)?.key, "customer_type");
  assert.match(fieldPrompt(nextActionField(action!, state)!), /new student/i);
  const customerType = validateFieldValue(nextActionField(action!, state)!, "new");
  assert.equal(customerType.value, "New student");
  state.values.customer_type = customerType.value!;
  assert.equal(nextActionField(action!, state)?.key, "child_age");
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
