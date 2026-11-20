import test from "node:test";
import assert from "node:assert/strict";
import { knowledgeGapMessage, knowledgeGapReason } from "../src/knowledge-gap-policy.js";

test("permissions gaps explain the missing verified knowledge and offer optional contact", () => {
  assert.equal(
    knowledgeGapMessage("PlanCraftAI", "permissions"),
    "I don’t have enough verified information about PlanCraftAI's permissions to answer that confidently. I can help you contact the team if you’d like.",
  );
});

test("knowledge-gap diagnostics identify missing authoritative evidence", () => {
  assert.equal(knowledgeGapReason({
    answerable: false,
    hasMatch: true,
    modelGenerationFailed: false,
    groundingCheckStatus: "not_run",
  }), "no_authoritative_source");
});
