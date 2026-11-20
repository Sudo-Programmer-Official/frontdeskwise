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
