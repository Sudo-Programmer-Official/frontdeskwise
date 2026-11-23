import test from "node:test";
import assert from "node:assert/strict";
import { canResolve, canReturnToAi, canTakeOver, isExplicitHumanRequest } from "../src/handoff-policy.js";

test("explicit human requests enter the handoff policy", () => {
  assert.equal(isExplicitHumanRequest("Can I talk to a real person?"), true);
  assert.equal(isExplicitHumanRequest("Please have someone contact me"), true);
  assert.equal(isExplicitHumanRequest("What are your opening hours?"), false);
});

test("handoff actions use explicit conversation-state rules", () => {
  assert.equal(canTakeOver("WAITING_FOR_STAFF"), true);
  assert.equal(canTakeOver("CONTACT_REQUIRED"), true);
  assert.equal(canTakeOver("FOLLOW_UP_PENDING"), true);
  assert.equal(canTakeOver("HUMAN_ACTIVE"), false);
  assert.equal(canReturnToAi("HUMAN_ACTIVE"), true);
  assert.equal(canReturnToAi("AI_ACTIVE"), false);
  assert.equal(canResolve("RESOLVED"), false);
  assert.equal(canResolve("AI_ACTIVE"), true);
});
