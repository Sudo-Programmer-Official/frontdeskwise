import assert from "node:assert/strict";
import test from "node:test";
import { defaultActionFlows, type ActionFlow } from "../src/action-flows.js";
import { verifyWorkflowDefinition, verifyWorkflowSet } from "../src/workflow-verifier.js";

const swim = defaultActionFlows("British Swim School", "swim lessons enrollment", (key) => `verify:${key}`).find((action) => action.key === "enroll_child")!;

test("canonical provider workflow passes deterministic verification", () => {
  const result = verifyWorkflowDefinition(swim);
  assert.equal(result.ok, true, JSON.stringify(result, null, 2));
  assert.equal(result.issues.length, 0);
  assert.ok(result.terminalStepIds.includes("enrollment-complete"));
});

test("workflow verifier catches missing fields, cycles, and unverified links", () => {
  const broken: ActionFlow = {
    ...swim,
    id: "broken-workflow",
    provider: null,
    steps: [
      { id: "start", type: "capture", fieldKey: "child_age", nextStepId: "link" },
      { id: "link", type: "generate_link", nextStepId: "start" },
      { id: "dead", type: "complete" },
    ],
  };
  const result = verifyWorkflowDefinition(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "cycle_detected"));
  assert.ok(result.issues.some((issue) => issue.code === "unreachable_step"));
  assert.ok(result.issues.some((issue) => issue.code === "required_field_not_captured"));
  assert.ok(result.issues.some((issue) => issue.code === "unverified_link_source"));
});

test("workflow verifier blocks editor placeholder copy", () => {
  const broken: ActionFlow = {
    ...swim,
    id: "placeholder-workflow",
    steps: [
      { id: "start", type: "capture", label: "Select step actions to configure this step", fieldKey: "child_age", nextStepId: "done" },
      { id: "done", type: "complete", label: "Complete workflow" },
    ],
  };
  const result = verifyWorkflowDefinition(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "placeholder_step" && issue.stepId === "start"));
});

test("provider lookups require an explicit fallback path", () => {
  const broken: ActionFlow = {
    ...swim,
    id: "missing-provider-fallback",
    steps: swim.steps?.map((step) => step.id === "registration-options"
      ? { ...step, config: { ...step.config, failureBehavior: undefined, fallbackStepId: undefined } }
      : step),
  };
  const result = verifyWorkflowDefinition(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "provider_fallback_missing" && issue.stepId === "registration-options"));
});

test("provider writes require an earlier confirmation step before publication", () => {
  const broken: ActionFlow = {
    ...swim,
    id: "missing-provider-confirmation",
    steps: [
      { id: "write", type: "api_action", config: { capabilityKey: "join_waitlist" }, nextStepId: "done" },
      { id: "done", type: "complete" },
    ],
  };
  const result = verifyWorkflowDefinition(broken);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "provider_confirmation_missing" && issue.stepId === "write"));
});

test("disabled steps do not satisfy required-field verification", () => {
  const draft: ActionFlow = {
    ...swim,
    id: "disabled-required-step",
    steps: [
      { id: "age", type: "capture", fieldKey: "child_age", enabled: false },
      { id: "done", type: "complete" },
    ],
  };
  const result = verifyWorkflowDefinition(draft);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.code === "required_field_not_captured" && issue.fieldKey === "child_age"));
});

test("workflow set verification is the publication gate for versioned actions", () => {
  const swim = defaultActionFlows("British Swim School", "swim school", (key) => `action-${key}`)
    .find((action) => action.key === "enroll_child");
  assert.ok(swim);
  const result = verifyWorkflowSet([swim]);
  assert.equal(result.ok, true);
  assert.equal(result.workflows.length, 1);
});
