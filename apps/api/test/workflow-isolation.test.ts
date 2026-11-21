import assert from "node:assert/strict";
import test from "node:test";
import type { ActionFlow } from "../src/action-flows.js";
import { validateWorkflowTenantIsolation } from "../src/workflow-isolation.js";

function action(overrides: Partial<ActionFlow> = {}): ActionFlow {
  return {
    id: "workflow-1",
    key: "primary_conversion",
    actionType: "open_link",
    businessId: "salonflow-business",
    name: "SalonFlow workflow",
    description: "Help salon owners find the right fit.",
    triggerPhrases: [],
    triggerIntents: [],
    captureMode: "form",
    fields: [],
    steps: [{ id: "try-demo", type: "redirect", label: "Try the demo", config: { destinationUrl: "https://www.salonflow.studio/start" } }],
    completion: { createLead: false, leadStatus: "new", message: "", notifyStaff: false },
    mode: "transactional",
    executionMode: "FORM_FLOW",
    destination: null,
    provider: null,
    priority: 1,
    requiredFields: [],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: null,
    evidence: [],
    confidence: 1,
    enabled: true,
    lifecycleStatus: "active",
    origin: "configured",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("workflow isolation rejects a foreign business name", () => {
  const result = validateWorkflowTenantIsolation(
    action({ description: "Help PlanCraftAI users choose a plan." }),
    {
      businessId: "salonflow-business",
      businessName: "SalonFlow",
      foreignBusinessNames: ["PlanCraftAI"],
    },
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "foreign_business");
});

test("workflow isolation rejects stale business and context identifiers", () => {
  const businessMismatch = validateWorkflowTenantIsolation(action({ businessId: "plancraft-business" }), {
    businessId: "salonflow-business",
    businessName: "SalonFlow",
  });
  assert.deepEqual(businessMismatch, { ok: false, code: "business_mismatch", identifier: "plancraft-business" });

  const contextMismatch = validateWorkflowTenantIsolation(action(), {
    businessId: "salonflow-business",
    businessName: "SalonFlow",
    requestedContextBusinessId: "plancraft-business",
  });
  assert.deepEqual(contextMismatch, { ok: false, code: "context_mismatch", identifier: "plancraft-business" });
});

test("workflow isolation rejects a provider known only to a sibling business", () => {
  const result = validateWorkflowTenantIsolation(action({ provider: "jackrabbit" }), {
    businessId: "salonflow-business",
    businessName: "SalonFlow",
    foreignProviders: ["jackrabbit"],
    currentProviders: [],
  });
  assert.deepEqual(result, { ok: false, code: "foreign_provider", identifier: "jackrabbit" });
});

test("workflow isolation rejects a sibling business action identifier", () => {
  const result = validateWorkflowTenantIsolation(
    action({ description: "Route qualified visitors through PlanCraft onboarding." }),
    {
      businessId: "salonflow-business",
      businessName: "SalonFlow",
      foreignActionIdentifiers: ["PlanCraft onboarding"],
    },
  );
  assert.deepEqual(result, { ok: false, code: "foreign_action", identifier: "PlanCraft onboarding" });
});
