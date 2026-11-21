import assert from "node:assert/strict";
import test from "node:test";
import { buildCanonicalBusinessModel, createBusinessContextSnapshot, getBusinessContext } from "../src/business-context.js";
import { normalizeBusinessFact } from "../src/business-knowledge.js";

const now = "2026-11-21T12:00:00.000Z";

function fact(id: string, kind: "pricing" | "availability" | "service" | "custom", value: string, sourceType: "owner_structured" | "website" | "live_system" | "inferred", observedAt = now) {
  return normalizeBusinessFact({
    id,
    businessId: "business-1",
    kind,
    subject: "PlanCraftAI",
    predicate: kind === "pricing" ? "monthly price" : kind === "availability" ? "class availability" : kind === "custom" ? "audience" : "offers",
    value,
    sourceType,
    sourceId: sourceType === "website" ? "website-1" : null,
    sourceLabel: sourceType === "owner_structured" ? "Owner details" : undefined,
    observedAt,
    createdAt: observedAt,
    updatedAt: observedAt,
  }, now);
}

function modelWithFacts(facts: ReturnType<typeof fact>[]) {
  return buildCanonicalBusinessModel({
    businessId: "business-1",
    businessName: "PlanCraftAI",
    businessType: "AI planning SaaS",
    location: "Remote",
    actions: [],
    actionResources: [],
    facts,
    chunks: [{ sourceId: "website-1", content: "PlanCraftAI helps teams plan work." }],
    sources: [{ id: "website-1", title: "Home", url: "https://plancraft.ai", crawlStatus: "ready", lastCrawledAt: now }],
    knowledgeGaps: [{ question: "Can I cancel?", status: "open" }],
    now,
  });
}

test("canonical model preserves provenance and fails closed on conflicted critical facts", () => {
  const model = modelWithFacts([
    fact("price-owner", "pricing", "$19/month", "owner_structured"),
    fact("price-site", "pricing", "$29/month", "website"),
    fact("service", "service", "AI planning", "owner_structured"),
    fact("availability", "availability", "Live", "live_system"),
    fact("inferred-audience", "custom", "teams", "inferred"),
  ]);

  const pricing = model.knowledge.facts.find((item) => item.kind === "pricing");
  assert.equal(pricing?.status, "CONFLICTED");
  assert.equal(pricing?.usableForCritical, false);
  assert.equal(pricing?.provenance.authority, "owner_verified");
  assert.equal(model.knowledge.facts.find((item) => item.kind === "availability")?.status, "VERIFIED");
  assert.equal(model.knowledge.facts.find((item) => item.kind === "custom")?.status, "INFERRED");
  assert.match(model.summary, /pricing exists but requires verification/);
  assert.equal(model.conflicts.length, 1);

  const staleWebsite = modelWithFacts([
    fact("price-owner-current", "pricing", "$19/month", "owner_structured"),
    fact("price-website-stale", "pricing", "$29/month", "website", "2020-01-01T00:00:00.000Z"),
  ]);
  assert.equal(staleWebsite.knowledge.facts.find((item) => item.kind === "pricing")?.status, "VERIFIED");
  assert.equal(staleWebsite.conflicts.length, 0);

  const workflowContext = getBusinessContext(model, "workflow_generation");
  assert.deepEqual(workflowContext.constraints.usableCriticalStatuses, ["VERIFIED"]);
  assert.ok(workflowContext.relevantFacts.some((item) => item.kind === "service"));
  assert.ok(workflowContext.knowledgeGaps.includes("Can I cancel?"));
});

test("business context snapshots advance only when material business intelligence changes", () => {
  const firstModel = modelWithFacts([fact("service", "service", "AI planning", "owner_structured")]);
  const first = createBusinessContextSnapshot(firstModel);
  const unchanged = createBusinessContextSnapshot(firstModel, first);
  assert.equal(unchanged.version, 1);
  assert.equal(unchanged.generatedAt, first.generatedAt);

  const changedModel = modelWithFacts([
    fact("service", "service", "AI planning", "owner_structured"),
    fact("price", "pricing", "$19/month", "owner_structured"),
  ]);
  const changed = createBusinessContextSnapshot(changedModel, unchanged);
  assert.equal(changed.version, 2);
  assert.notEqual(changed.materialFingerprint, unchanged.materialFingerprint);
});
