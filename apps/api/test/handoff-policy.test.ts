import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitHumanRequest } from "../src/handoff-policy.js";

test("knowledge questions about permissions do not trigger human handoff", () => {
  assert.equal(isExplicitHumanRequest("Can someone explain what permissions you use?"), false);
  assert.equal(isExplicitHumanRequest("What should I know about permissions used?"), false);
});

test("direct human requests trigger handoff", () => {
  assert.equal(isExplicitHumanRequest("I want to speak to someone about permissions."), true);
  assert.equal(isExplicitHumanRequest("Get me a person."), true);
});

test("natural human-request variants share the same handoff intent", () => {
  for (const phrase of [
    "i wanna talk to somebody",
    "I want to speak to someone about this.",
    "speak to a person",
    "real person",
    "human please",
    "can someone call me",
    "can I talk to the team",
    "I need help from a person",
    "connect me with someone",
  ]) {
    assert.equal(isExplicitHumanRequest(phrase), true, phrase);
  }
});
