import assert from "node:assert/strict";
import test from "node:test";
import type { ActionFlow } from "../src/action-flows.js";
import type { BusinessFact } from "../src/business-knowledge.js";
import { buildWorkflowContext } from "../src/workflow-context.js";

const now = new Date().toISOString();

function fact(kind: BusinessFact["kind"], valueText: string, sourceType: BusinessFact["sourceType"] = "owner_structured"): BusinessFact {
  return {
    id: `${kind}-${valueText}`,
    businessId: "business-1",
    kind,
    subject: "PlanCraftAI",
    predicate: kind === "pricing" ? "plan price" : "offers",
    value: valueText,
    valueText,
    sourceType,
    authority: sourceType === "owner_structured" ? "owner_verified" : "website",
    sourceId: "source-1",
    sourceLabel: "Owner details",
    confidence: 1,
    freshnessPolicy: "until_replaced",
    observedAt: now,
    expiresAt: null,
    active: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

function action(key: string, name: string, provider: string | null = null): ActionFlow {
  return {
    id: key,
    key,
    actionType: "contact_team",
    name,
    description: `${name} action`,
    triggerPhrases: [],
    triggerIntents: [],
    captureMode: "auto",
    fields: [],
    steps: provider ? [{ id: "provider", type: "lookup", config: { provider } }] : [],
    completion: { createLead: false, leadStatus: "new", message: "", notifyStaff: false },
    mode: "transactional",
    executionMode: provider ? "PROVIDER_FLOW" : "FORM_FLOW",
    destination: null,
    provider,
    priority: 1,
    requiredFields: [],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: null,
    evidence: [],
    confidence: 0.9,
    enabled: true,
    lifecycleStatus: "active",
    origin: "configured",
    version: 2,
    createdAt: now,
    updatedAt: now,
  };
}

test("workflow context is compact, grounded, and provenance-aware", () => {
  const context = buildWorkflowContext({
    businessName: "PlanCraftAI",
    businessType: "AI planning SaaS",
    primaryAction: action("signup", "Get started"),
    actions: [action("capture_lead", "Capture a lead"), action("signup", "Get started")],
    actionResources: [],
    facts: [fact("service", "AI planning, reminders, and task breakdown"), fact("pricing", "Starter — $19/month")],
    chunks: [{ sourceId: "source-1", content: "PlanCraftAI helps individuals and teams turn work into clear plans." }],
    sources: [{ id: "source-1", title: "Home", url: "https://plancraft.ai", crawlStatus: "ready" }],
    knowledgeGaps: [{ question: "Can I cancel anytime?", status: "open" }],
    privacyNoticeUrl: "https://plancraft.ai/privacy",
  });

  assert.equal(context.businessName, "PlanCraftAI");
  assert.match(context.summary ?? "", /PlanCraftAI is AI planning SaaS/);
  assert.equal(context.primaryGoal, "Get started (contact_team)");
  assert.equal(context.pricing.verified, true);
  assert.ok(context.services.some((item) => item.value.includes("AI planning")));
  assert.deepEqual(context.products, []);
  assert.equal(context.services.some((item) => item.value.includes("Capture a lead")), false);
  assert.ok(context.knownPolicies.some((item) => item.value.includes("privacy")));
  assert.deepEqual(context.knowledgeGaps, ["Can I cancel anytime?"]);
  assert.equal(context.knowledgeSummary.length, 1);
  assert.equal(context.knowledgeSummary[0].provenance.source, "website");
  assert.equal(context.pricing.provenance[0].authority, "verified");
  assert.equal(context.existingWorkflows.length, 2);
});

test("website-only pricing is explicitly unverified", () => {
  const context = buildWorkflowContext({
    businessName: "Example",
    actions: [],
    actionResources: [],
    facts: [fact("pricing", "Pricing is described on the website", "website")],
    chunks: [],
    sources: [],
    knowledgeGaps: [],
  });

  assert.equal(context.pricing.verified, false);
  assert.equal(context.pricing.provenance[0].authority, "supported");
});
