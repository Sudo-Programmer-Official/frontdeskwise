import assert from "node:assert/strict";
import test from "node:test";
import {
  customerSafeFallbacks,
  isInternalCustomerCopy,
  rewriteCustomerFacingTerminology,
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

test("customer-facing terminology is rewritten before a response is accepted", () => {
  const result = validateCustomerResponse({
    answer: "I couldn’t check live jackrabbit availability right now. The provider API workflow uses retrieval.",
    route: "system",
  });

  assert.equal(result.accepted, true);
  assert.equal(result.customerCopyRewritten, true);
  assert.equal(result.answer, "I can’t confirm live availability right now. The connected system next steps uses business information.");
  assert.equal(isInternalCustomerCopy(result.answer), false);
});

test("explicit verified brand questions may retain Jackrabbit while hiding other plumbing", () => {
  const result = validateCustomerResponse({
    question: "Do you use Jackrabbit?",
    answer: "Yes, Jackrabbit is connected through our provider API.",
    route: "knowledge",
    grounded: true,
    confidenceScore: 0.95,
    hasReliableEvidence: true,
  });

  assert.equal(result.accepted, true);
  assert.match(result.answer, /Jackrabbit/);
  assert.doesNotMatch(result.answer, /\bprovider\b|\bAPI\b/i);
  assert.equal(isInternalCustomerCopy(result.answer, "Do you use Jackrabbit?"), false);
});

test("terminology rewriting is available as a standalone customer-copy guard", () => {
  const result = rewriteCustomerFacingTerminology("The workflow called the provider endpoint through RAG.");

  assert.equal(result.rewritten, true);
  assert.equal(result.text, "The next steps called the connected system link through business information.");
});

test("business-owned phrases and URLs are preserved by the terminology guard", () => {
  const result = validateCustomerResponse({
    answer: "Use API Workflow or Provider Portal here: https://api.example.com/workflow.",
    route: "knowledge",
    grounded: true,
    confidenceScore: 0.95,
    hasReliableEvidence: true,
    publicTerms: ["API Workflow", "Provider Portal"],
  });

  assert.equal(result.accepted, true);
  assert.equal(result.customerCopyRewritten, false);
  assert.equal(result.answer, "Use API Workflow or Provider Portal here: https://api.example.com/workflow.");
});

