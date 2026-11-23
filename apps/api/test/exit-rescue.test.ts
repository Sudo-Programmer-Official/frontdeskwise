import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, defaultActionFlows, type ConversationActionState } from "../src/action-flows.js";
import {
  declineExitRescueState,
  exitRescueFunnelMetrics,
  exitRescueNotificationDetails,
  hasRecoverableContact,
  markExitRescueConverted,
  markExitRescueReturned,
  offerExitRescueState,
  saveExitRescueState,
  shouldOfferExitRescue,
} from "../src/exit-rescue.js";

const action = defaultActionFlows("British Swim School", "swim lessons and enrollment", (key) => `${key}-id`)
  .find((candidate) => candidate.key === "enroll_child")!;

function engagedState(): ConversationActionState {
  const state = createActionState(action, "2026-11-23T12:00:00.000Z");
  state.values = { child_age: "7", location: "Largo" };
  state.currentStepId = "student-schedule";
  return state;
}

test("low-intent and already-contacted visitors are not offered Exit Rescue", () => {
  const state = createActionState(action);
  assert.equal(shouldOfferExitRescue(action, state), false);
  state.values = { email: "parent@example.com" };
  assert.equal(hasRecoverableContact(state), true);
  assert.equal(shouldOfferExitRescue(action, state), false);
  state.values = { child_age: "7", location: "Largo" };
  assert.equal(shouldOfferExitRescue(action, state), true);
});

test("declining Exit Rescue is terminal for the journey", () => {
  const state = engagedState();
  assert.equal(shouldOfferExitRescue(action, state), true);
  assert.equal(offerExitRescueState(action, state, "2026-11-23T12:01:00.000Z"), "student-schedule");
  assert.equal(declineExitRescueState(state, "2026-11-23T12:02:00.000Z"), true);
  assert.equal(state.exitRescue?.status, "declined");
  assert.equal(state.formShown, false);
  assert.equal(shouldOfferExitRescue(action, state), false);
  assert.equal(declineExitRescueState(state), false);
});

test("saved Exit Rescue resumes at the original step and records each milestone once", () => {
  const state = engagedState();
  offerExitRescueState(action, state, "2026-11-23T12:01:00.000Z");
  assert.equal(saveExitRescueState(state, "2026-11-23T12:03:00.000Z"), true);
  const restored = JSON.parse(JSON.stringify(state)) as ConversationActionState;
  assert.equal(restored.exitRescue?.status, "saved");
  assert.equal(restored.exitRescue?.returnStepId, "student-schedule");
  assert.equal(markExitRescueReturned(restored, "2026-11-23T13:00:00.000Z"), true);
  assert.equal(markExitRescueReturned(restored), false);
  assert.equal(markExitRescueConverted(restored, "2026-11-23T13:04:00.000Z"), true);
  assert.equal(markExitRescueConverted(restored), false);
});

test("paused-lead notification includes qualification summary and paused step", () => {
  const state = engagedState();
  offerExitRescueState(action, state, "2026-11-23T12:01:00.000Z");
  const notification = exitRescueNotificationDetails("British Swim School Tampa Bay", action, state);
  assert.equal(notification.title, "Paused Find the right swim lesson request");
  assert.match(notification.body, /Child[’']s age: 7/);
  assert.match(notification.body, /Preferred location or ZIP code: Largo/);
  assert.match(notification.body, /Paused step: /);
  assert.doesNotMatch(notification.body, /parent@example\.com/);
});

test("Exit Rescue funnel metrics are journey-level and de-duplicate repeated events", () => {
  assert.deepEqual(exitRescueFunnelMetrics([
    { event: "EXIT_RESCUE_OFFERED", conversationId: "conversation-1" },
    { event: "EXIT_RESCUE_SAVED", conversationId: "conversation-1" },
    { event: "EXIT_RESCUE_RETURNED", conversationId: "conversation-1" },
    { event: "EXIT_RESCUE_RETURNED", conversationId: "conversation-1" },
    { event: "EXIT_RESCUE_CONVERTED", conversationId: "conversation-1" },
    { event: "EXIT_RESCUE_OFFERED", conversationId: "conversation-2" },
    { event: "EXIT_RESCUE_DECLINED", conversationId: "conversation-2" },
  ]), {
    offered: 2,
    saved: 1,
    returned: 1,
    converted: 1,
    declined: 1,
  });
});
