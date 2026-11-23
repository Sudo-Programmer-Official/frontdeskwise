import assert from "node:assert/strict";
import test from "node:test";
import { findDuplicateWorkflowName, normalizeWorkflowName, workflowNameForAction } from "../src/workflow-names.js";

const workflow = (id: string, name: string) => ({
  id,
  name: `${name} action`,
  steps: [{ id: "start", type: "capture" as const }],
  completion: { workflow: { name, actionId: id } },
});

test("workflow names compare case-insensitively and collapse whitespace", () => {
  assert.equal(normalizeWorkflowName("  Lead   Qualification "), "lead qualification");
  assert.equal(workflowNameForAction(workflow("one", "Lead Qualification")), "Lead Qualification");
});

test("duplicate workflow names exclude the workflow being updated", () => {
  const existing = workflow("one", "Lead Qualification");
  const actions = [existing, workflow("two", "Booking")];
  assert.equal(findDuplicateWorkflowName(actions, " lead qualification ")?.id, "one");
  assert.equal(findDuplicateWorkflowName(actions, "Lead Qualification", "one"), null);
});

test("legacy step workflows fall back to their action name", () => {
  const legacy = { id: "legacy", name: "Enrollment", steps: [{ id: "start", type: "capture" as const }], completion: {} };
  assert.equal(workflowNameForAction(legacy), "Enrollment");
});
