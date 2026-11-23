import assert from "node:assert/strict";
import test from "node:test";
import {
  customerSafeFallbacks,
  shouldRunSemanticVerifier,
  validateCustomerResponse,
} from "../src/response-validation.js";

test("customer guard replaces internal formatting language with a safe technical fallback", () => {
  const result = validateCustomerResponse({
    answer: "I found relevant information, but I’m having trouble formatting the answer right now.",
    route: "generative",
    grounded: false,
    hasReliableEvidence: true,
  });

  assert.equal(result.accepted, false);
  assert.equal(result.reason, "ANSWER_RENDER_FAILURE");
  assert.equal(result.answer, customerSafeFallbacks.temporary_technical_failure);
});

test("deterministic state answers do not require evidence or a semantic verifier", () => {
  const result = validateCustomerResponse({
    answer: "I have your email, but I’m still missing your phone number.",
    route: "state",
    grounded: false,
  });

  assert.equal(result.accepted, true);
  assert.equal(shouldRunSemanticVerifier({
    question: "Do you have my email?",
    confidenceScore: 1,
    hasReliableEvidence: true,
  }), false);
});

test("complex or low-confidence knowledge answers escalate to semantic verification", () => {
  assert.equal(shouldRunSemanticVerifier({
    question: "Given what I told you, which plan is best and why?",
    confidenceScore: 0.9,
    hasReliableEvidence: true,
  }), true);
  assert.equal(shouldRunSemanticVerifier({
    question: "What is the price?",
    confidenceScore: 0.72,
    hasReliableEvidence: true,
  }), true);
});

test("semantic verification is recorded as the third validation tier", () => {
  const result = validateCustomerResponse({
    answer: "The Growth plan costs $49 per month.",
    route: "generative",
    grounded: true,
    hasReliableEvidence: true,
    semanticVerified: true,
  });
  assert.equal(result.tier, 3);
});

