import assert from "node:assert/strict";
import test from "node:test";
import { validateActionExecutionPolicy } from "../src/action-policy.ts";
import type { ActionFlow, ConversationActionState } from "../src/action-flows.ts";

function action(overrides: Partial<ActionFlow> = {}): ActionFlow {
  return {
    id: "action-1", key: "contact_team", actionType: "contact_team", name: "Contact team", description: "", triggerPhrases: [], triggerIntents: [], captureMode: "form", fields: [], completion: { createLead: true, leadStatus: "new", message: "Saved", notifyStaff: true, requiresStaff: true }, mode: "transactional", executionMode: "HANDOFF", destination: null, provider: null, priority: 1, requiredFields: [], conditions: [], safetyPolicy: "standard", sourceUrl: null, evidence: [], confidence: 1, enabled: true, lifecycleStatus: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...overrides,
  };
}

const state: ConversationActionState = { actionId: "action-1", values: { name: "Visitor" }, captureMode: "form", conversationalKeys: [], status: "active", startedAt: new Date().toISOString() };

test("policy rejects foreign, disabled, and unapproved actions", () => {
  assert.equal(validateActionExecutionPolicy(action({ businessId: "other" }), state, "business-1").allowed, false);
  assert.equal(validateActionExecutionPolicy(action({ enabled: false }), state, "business-1").allowed, false);
  assert.equal(validateActionExecutionPolicy(action({ lifecycleStatus: "needs_review" }), state, "business-1").allowed, false);
});

test("policy requires staff approval for manual-review actions", () => {
  const decision = validateActionExecutionPolicy(action({ safetyPolicy: "manual_review", completion: { ...action().completion, requiresStaff: false } }), state, "business-1");
  assert.equal(decision.allowed, false);
  assert.equal(decision.risk, "HIGH_RISK");
});

test("policy accepts a tenant-scoped active handoff", () => {
  const decision = validateActionExecutionPolicy(action({ businessId: "business-1" }), state, "business-1");
  assert.deepEqual(decision, { allowed: true, risk: "LOW_RISK_WRITE", reason: null });
});

test("policy allows a configured generic webhook endpoint to be validated at execution", () => {
  const decision = validateActionExecutionPolicy(action({
    businessId: "business-1",
    executionMode: "API_ACTION",
    completion: {
      ...action().completion,
      connector: { provider: "generic_webhook", endpoint: "https://hooks.example.com/frontdeskwise" },
    },
  }), state, "business-1");
  assert.deepEqual(decision, { allowed: true, risk: "LOW_RISK_WRITE", reason: null });
});

