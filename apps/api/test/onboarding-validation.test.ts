import assert from "node:assert/strict";
import test from "node:test";
import { assessOnboardingKnowledge, validationFromFailure } from "../src/onboarding-validation.ts";

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

const usefulPage = {
  title: "DaycareSpots",
  content: "DaycareSpots helps parents find childcare and helps daycare providers connect with families. Contact us for registration, tours, locations, and support.",
  extractedCharacterCount: 520,
};

test("multi-page coverage prevents a seed-only crawl from becoming knowledge ready", () => {
  const validation = assessOnboardingKnowledge({
    pages: [usefulPage],
    crawlCoverage: {
      discoveredUrls: 38,
      attemptedUrls: 12,
      successfulPages: 1,
      skippedUrls: 21,
      failedUrls: 10,
      unprocessedUrls: 26,
      coveragePercent: 3,
      additionalPagesDetected: true,
      rejectionReasons: { timeout: 2, excluded_route: 7 },
    },
  });

  assert.equal(validation.status, "needs_attention");
  assert.equal(validation.code, "CRAWL_PARTIAL");
  assert.equal(validation.knowledgeReady, false);
  assert.match(validation.message, /some website pages could not be read/i);
  assert.equal(validation.crawlCoverage?.discoveredUrls, 38);
});

test("a single-page site remains valid when the crawler found no additional pages", () => {
  const validation = assessOnboardingKnowledge({
    pages: [usefulPage],
    crawlCoverage: {
      discoveredUrls: 1,
      attemptedUrls: 1,
      successfulPages: 1,
      skippedUrls: 0,
      failedUrls: 0,
      unprocessedUrls: 0,
      coveragePercent: 100,
      additionalPagesDetected: false,
      rejectionReasons: {},
    },
  });

  assert.equal(validation.status, "valid");
  assert.equal(validation.knowledgeReady, true);
  assert.equal(validation.code, null);
});
