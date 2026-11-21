import test from "node:test";
import assert from "node:assert/strict";
import { providerTrace, snapshotConversationWorkflowState, workflowFieldChanges } from "../src/conversation-decision-trace.js";
import type { ActionFlow, ConversationActionState } from "../src/action-flows.js";

const action = {
  id: "enroll-action",
  key: "enroll_child",
  actionType: "enroll",
  name: "Enroll a child",
  provider: "jackrabbit",
  steps: [],
} as unknown as ActionFlow;

function state(values: Record<string, string>): ConversationActionState {
  return {
    actionId: action.id,
    workflowVersion: 2,
    values,
    captureMode: "conversational",
    conversationalKeys: Object.keys(values),
    status: "active",
    startedAt: "2026-11-21T00:00:00.000Z",
    lookupResults: { lookup: { status: "ok", matches: [{ id: "class-1" }] } },
  };
}

test("decision trace snapshots redact contact fields and preserve workflow shape", () => {
  const before = state({ email: "parent@example.com", child_age: "7" });
  const after = state({ email: "parent@example.com", child_age: "8", location: "Tampa" });
  const snapshot = snapshotConversationWorkflowState(after);
  assert.equal(snapshot?.values.email, "[redacted]");
  assert.equal(snapshot?.values.child_age, "8");
  assert.deepEqual(workflowFieldChanges(before, after), {
    child_age: { before: "7", after: "8" },
    location: { before: null, after: "Tampa" },
  });
});

test("provider trace records lookup outcomes and action delivery without raw payloads", () => {
  const result = providerTrace(action, state({ child_age: "8" }), { status: "queued", provider: "hubspot" });
  assert.deepEqual(result, {
    provider: "hubspot",
    operations: ["action_delivery"],
    lookupSteps: [{ stepId: "lookup", status: "ok", matchCount: 1 }],
    actionDelivery: { status: "queued", provider: "hubspot" },
  });
});
