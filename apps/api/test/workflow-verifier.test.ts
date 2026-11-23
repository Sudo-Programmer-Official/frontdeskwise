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
