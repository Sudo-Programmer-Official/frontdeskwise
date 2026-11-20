import assert from "node:assert/strict";
import test from "node:test";
import {
  addWorkflowParticipant,
  applyWorkflowInput,
  currentWorkflowStep,
  pushWorkflowInterruption,
  resumeWorkflowInterruption,
  setWorkflowParticipantValue,
  transitionWorkflow,
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

