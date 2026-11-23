import assert from "node:assert/strict";
import test from "node:test";
import { extractWebsitePricingCandidates } from "../src/pricing-extraction.js";

test("extracts plan prices from crawled pricing chunks", () => {
  const candidates = extractWebsitePricingCandidates({
    sources: [{
      id: "pricing-source",
      url: "https://salonflow.studio/pricing",
      title: "SalonFlow pricing",
      pageType: "pricing",
      lastCrawledAt: "2026-11-22T12:00:00.000Z",
    }],
    chunks: [{
      sourceId: "pricing-source",
      content: "Pricing Core $65/mo Online booking and reminders Growth $99/mo More automation and Complete $129/mo Everything included",
      metadata: { headingPath: ["Pricing"] },
    }],
  });

  assert.deepEqual(candidates.map((candidate) => [candidate.subject, candidate.valueText]), [
    ["Core", "$65/month"],
    ["Growth", "$99/month"],
    ["Complete", "$129/month"],
  ]);
  assert.deepEqual(candidates[0]?.value, { plan: "Core", amount: 65, currency: "$", billingPeriod: "month" });
  assert.equal(candidates.every((candidate) => candidate.sourceId === "pricing-source"), true);
});

test("does not treat unrelated website numbers as pricing facts", () => {
  const candidates = extractWebsitePricingCandidates({
    sources: [{ id: "home", url: "https://salonflow.studio/", title: "SalonFlow", pageType: "service" }],
    chunks: [{ sourceId: "home", content: "We opened in 2026 and serve 65 local salons.", metadata: { pageType: "service" } }],
  });

  assert.deepEqual(candidates, []);
});
