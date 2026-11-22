import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, defaultActionFlows } from "../src/action-flows.js";
import { observeWorkflowLoop, workflowStateFingerprint } from "../src/workflow-loop-guard.js";

const workflow = defaultActionFlows("British Swim School", "swim lessons enrollment", (key) => `loop:${key}`).find((action) => action.key === "enroll_child")!;

test("loop guard triggers only after repeated unchanged workflow state", () => {
  const state = createActionState(workflow);
  const first = observeWorkflowLoop(undefined, { stateBefore: state, stateAfter: JSON.parse(JSON.stringify(state)) });
  assert.equal(first.triggered, false);
  assert.equal(first.guard.consecutiveUnchangedTurns, 1);

  const second = observeWorkflowLoop(first.guard, { stateBefore: state, stateAfter: JSON.parse(JSON.stringify(state)) });
  assert.equal(second.triggered, true);
  assert.equal(second.reason, "unchanged_state");
  assert.equal(second.guard.consecutiveUnchangedTurns, 2);
});

test("loop guard resets its repeat count when workflow state progresses", () => {
  const state = createActionState(workflow);
  const first = observeWorkflowLoop(undefined, { stateBefore: state, stateAfter: JSON.parse(JSON.stringify(state)) });
  const progressed = JSON.parse(JSON.stringify(state));
  progressed.currentStepId = "student-age";
  const next = observeWorkflowLoop(first.guard, { stateBefore: state, stateAfter: progressed });
  assert.equal(next.triggered, false);
  assert.equal(next.reason, "progressed");
  assert.equal(next.guard.consecutiveUnchangedTurns, 0);
  assert.ok(workflowStateFingerprint(progressed));
});
