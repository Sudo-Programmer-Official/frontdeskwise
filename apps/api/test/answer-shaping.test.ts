import assert from "node:assert/strict";
import test from "node:test";
import { shapeCustomerAnswer, toneInstructions } from "../src/answer-shaping.js";

test("long knowledge material is shaped into a compact visitor answer", () => {
  const answer = shapeCustomerAnswer([
    "Getting started is easy:",
    "1. Visit PlanCraftAI and click Try it free.",
    "2. Create your first task by typing or speaking naturally.",
    "3. Use AI planning to organize your day and set reminders.",
    "4. Connect your calendar.",
    "5. Review the daily recap.",
    "6. Invite your team.",
    "7. Adjust your settings.",
    "You can start without a credit card.",
  ].join("\n"), "concise");

  assert.match(answer, /1\. Visit PlanCraftAI/);
  assert.match(answer, /3\. Use AI planning/);
  assert.doesNotMatch(answer, /4\. Connect your calendar/);
  assert.ok(answer.split(/\s+/).length <= 85);
});

test("tone instructions distinguish concise, friendly, and professional", () => {
  assert.match(toneInstructions("concise"), /under 80 words/);
  assert.match(toneInstructions("friendly"), /warm, conversational/);
  assert.match(toneInstructions("professional"), /structured but compact/);
});
