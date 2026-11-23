import assert from "node:assert/strict";
import test from "node:test";
import { defaultActionFlows, type ActionFlow } from "../src/action-flows.js";
import { findStoredWorkflow, isStoredWorkflow, workflowRecordsForBusiness } from "../src/workflow-records.js";

const action = defaultActionFlows("British Swim School", "swim lessons", (key) => `action-${key}`).find((item) => item.key === "enroll_child")!;

test("workflow catalog is sourced from complete stored records, not Action relationships", () => {
  const staleActionProjection = { ...action, workflowCount: 1, workflowIds: ["missing-workflow"], steps: undefined } as ActionFlow;
  const workflow = {
    ...action,
    steps: action.steps?.slice(0, 14),
    completion: { ...action.completion, workflow: { name: "Find the right swim lesson", actionId: action.id } },
  } satisfies ActionFlow;

  assert.equal(isStoredWorkflow(staleActionProjection), false);
  assert.deepEqual(workflowRecordsForBusiness([staleActionProjection, workflow]).map((item) => item.id), [workflow.id]);
  assert.equal(findStoredWorkflow([staleActionProjection, workflow], workflow.id)?.steps?.length, 14);
});

test("workflow read-after-write identity remains stable when one Action owns the workflow", () => {
  const workflow = { ...action, steps: action.steps?.slice(0, 14) } satisfies ActionFlow;
  const firstRead = findStoredWorkflow([workflow], workflow.id);
  const refreshedRead = findStoredWorkflow([workflow], workflow.id);

  assert.equal(firstRead?.id, workflow.id);
  assert.deepEqual(refreshedRead?.steps, firstRead?.steps);
});
