import test from "node:test";
import assert from "node:assert/strict";
import { assessOnboardingKnowledge, validationFromFailure } from "../src/onboarding-validation.js";

test("marks a reachable site with useful business content as valid", () => {
  const result = assessOnboardingKnowledge({
    expectedBusinessName: "Acme Dental",
    pages: [{ title: "Acme Dental", content: "Acme Dental offers cleanings, emergency appointments, pricing, hours, and locations. Contact our team to book a visit. Our dentists serve new and returning patients with clear next steps and helpful care guidance." }],
  });
  assert.equal(result.status, "valid");
  assert.equal(result.code, null);
  assert.equal(result.knowledgeReady, true);
});

test("distinguishes a reachable site with no useful business content", () => {
  const result = assessOnboardingKnowledge({
    expectedBusinessName: "Acme Dental",
    pages: [{ title: "Acme Dental", content: "Welcome." }],
  });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.code, "NO_USEFUL_CONTENT");
  assert.equal(result.reachable, true);
  assert.match(result.message, /couldn't identify enough business information/i);
});

test("flags a business-name mismatch without blocking useful-content scoring", () => {
  const result = assessOnboardingKnowledge({
    expectedBusinessName: "Acme Dental",
    pages: [{ title: "Northwind Plumbing", content: "Northwind Plumbing offers repairs, pricing, service areas, and emergency appointments. Contact us to schedule service." }],
  });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.code, "WRONG_BUSINESS_DETECTED");
  assert.match(result.suggestedAction, /confirm the domain/i);
});

test("keeps technical failure classification separate from knowledge readiness", () => {
  const result = validationFromFailure({ code: "SSL_FAILURE", reachable: false });
  assert.equal(result.status, "needs_attention");
  assert.equal(result.knowledgeReady, false);
  assert.equal(result.code, "SSL_FAILURE");
});
