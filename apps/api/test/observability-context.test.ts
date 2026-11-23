import assert from "node:assert/strict";
import test from "node:test";
import { buildObservabilityContext, observabilityMetadata, runtimeObservabilityVersions } from "../src/observability-context.js";

test("observability context correlates tenant publication, workflow, model, and request versions", () => {
  const context = buildObservabilityContext({
    business: { id: "business-1", organizationId: "org-1", slug: "demo", publishedConfigVersion: 7 },
    workflow: { id: "action-1", key: "book_demo", version: 3 },
    model: { route: "tier1", name: "gpt-test" },
    correlationId: "turn-1",
  });

  assert.equal(context.tenantId, "business-1");
  assert.equal(context.organizationId, "org-1");
  assert.equal(context.publicationVersion, 7);
  assert.equal(context.workflowVersion, 3);
  assert.equal(context.modelName, "gpt-test");
  assert.equal(context.correlationId, "turn-1");
  assert.equal(context.releaseVersion, runtimeObservabilityVersions.releaseVersion);
  assert.equal(observabilityMetadata(context).workflow_key, "book_demo");
});

test("observability context bounds and sanitizes operator-controlled identifiers", () => {
  const context = buildObservabilityContext({
    business: { id: "\u0000business", slug: "  tenant  " },
    workflow: { key: "x".repeat(200), version: 0 },
    correlationId: "\nrequest",
  });

  assert.equal(context.tenantId, "business");
  assert.equal(context.tenantSlug, "tenant");
  assert.equal(context.workflowKey?.length, 160);
  assert.equal(context.workflowVersion, null);
  assert.equal(context.correlationId, "request");
});
