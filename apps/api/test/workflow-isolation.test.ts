import assert from "node:assert/strict";
import test from "node:test";
import type { ActionFlow } from "../src/action-flows.js";
import { validateWorkflowTenantIsolation } from "../src/workflow-isolation.js";
import { validateWorkflowTenantContext } from "../../web/src/workflow-tenant-context.ts";

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

test("workflow isolation allows a provider configured on the active business", () => {
  const result = validateWorkflowTenantIsolation(action({ provider: "jackrabbit" }), {
    businessId: "salonflow-business",
    businessName: "SalonFlow",
    currentProviders: ["jackrabbit"],
    foreignProviders: ["jackrabbit"],
  });
  assert.deepEqual(result, { ok: true });
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

test("PlanCraftAI stays allowed when the active action and goal repeat its brand", () => {
  const tenant = validateWorkflowTenantContext({
    selectedBusinessId: "plancraft-business",
    selectedActionBusinessId: "plancraft-business",
    workspaceBusinessId: "plancraft-business",
    businessContextBusinessId: "plancraft-business",
    createWorkflowBusinessId: "plancraft-business",
    selectedOrganizationId: "org-1",
    actionOrganizationId: "org-1",
    workspaceOrganizationId: "org-1",
    businessContextOrganizationId: "org-1",
    createWorkflowOrganizationId: "org-1",
  });
  assert.deepEqual(tenant, { ok: true });

  const result = validateWorkflowTenantIsolation(
    action({
      businessId: "plancraft-business",
      name: "Sign up for PlanCraftAI",
      description: "Help PlanCraftAI visitors compare plans, use Task Planner, and sign up for PlanCraftAI.",
      steps: [{ id: "try-demo", type: "redirect", label: "Sign up", config: { destinationUrl: "https://plancraftai.com/start" } }],
    }),
    {
      businessId: "plancraft-business",
      businessName: "PlanCraftAI",
      businessAliases: ["PlanCraft AI", "https://plancraftai.com"],
      activeBusinessIdentifiers: ["PlanCraftAI", "PlanCraft AI", "plancraftai.com", "Task Planner"],
      activeActionIdentifiers: ["Sign up for PlanCraftAI"],
      foreignBusinessNames: ["PlanCraftAI", "PlanCraft AI", "plancraftai.com", "Task Planner", "SalonFlow"],
      foreignActionIdentifiers: ["Sign up for PlanCraftAI", "Task Planner"],
    },
  );
  assert.deepEqual(result, { ok: true });
});

test("a business switch fails closed until every workflow reference is current", () => {
  const duringSwitch = validateWorkflowTenantContext({
    selectedBusinessId: "plancraft-business",
    selectedActionBusinessId: "salonflow-business",
    workspaceBusinessId: "salonflow-business",
    businessContextBusinessId: "salonflow-business",
    createWorkflowBusinessId: "plancraft-business",
  });
  assert.equal(duringSwitch.ok, false);

  const afterRefresh = validateWorkflowTenantContext({
    selectedBusinessId: "plancraft-business",
    selectedActionBusinessId: "plancraft-business",
    workspaceBusinessId: "plancraft-business",
    businessContextBusinessId: "plancraft-business",
    createWorkflowBusinessId: "plancraft-business",
  });
  assert.deepEqual(afterRefresh, { ok: true });
});

test("a contaminated action cannot whitelist its own foreign business reference", () => {
  const result = validateWorkflowTenantIsolation(action({
    businessId: "salonflow-business",
    name: "Sign up for PlanCraftAI",
    description: "Help PlanCraftAI visitors.",
  }), {
    businessId: "salonflow-business",
    businessName: "SalonFlow",
    activeActionIdentifiers: ["Sign up for PlanCraftAI"],
    foreignBusinessNames: ["PlanCraftAI"],
  });
  assert.deepEqual(result, { ok: false, code: "foreign_business", identifier: "PlanCraftAI" });
});

test("two business tabs keep their own workflow tenant invariants", () => {
  for (const businessId of ["plancraft-business", "salonflow-business"]) {
    assert.deepEqual(validateWorkflowTenantContext({
      selectedBusinessId: businessId,
      selectedActionBusinessId: businessId,
      workspaceBusinessId: businessId,
      businessContextBusinessId: businessId,
      createWorkflowBusinessId: businessId,
    }), { ok: true });
  }
});

test("stale context versions remain a safe retryable mismatch", () => {
  const result = validateWorkflowTenantIsolation(action({ businessId: "plancraft-business" }), {
    businessId: "plancraft-business",
    businessName: "PlanCraftAI",
    requestedBusinessId: "plancraft-business",
    requestedContextBusinessId: "plancraft-business",
    requestedContextVersion: 4,
    currentContextVersion: 5,
  });
  assert.deepEqual(result, { ok: false, code: "context_mismatch", identifier: "4" });
});

test("organization drift is distinct from sibling-business contamination", () => {
  const result = validateWorkflowTenantIsolation(action({ businessId: "plancraft-business" }), {
    businessId: "plancraft-business",
    businessName: "PlanCraftAI",
    requestedOrganizationId: "org-old",
    currentOrganizationId: "org-current",
  });
  assert.deepEqual(result, { ok: false, code: "organization_mismatch", identifier: "org-old" });
});
