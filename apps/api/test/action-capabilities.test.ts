import assert from "node:assert/strict";
import test from "node:test";
import { actionCapability, actionRelationships, actionsCompatible, findCompatibleAction } from "../src/action-capabilities.js";
import { defaultActionFlows, type ActionFlow } from "../src/action-flows.js";
import type { WebsiteActionCandidate } from "../src/website-actions.js";

function actions() {
  const demoCandidate: WebsiteActionCandidate = {
    actionType: "request_demo",
    label: "Request a demo",
    description: "Request a demo",
    mode: "transactional",
    destination: { url: "https://example.test/demo", label: "Request a demo" },
    provider: null,
    priority: 880,
    requiredFields: [],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: "https://example.test/",
    sourceType: "website",
    sourceLabel: "Request a demo",
    discoveredAt: "2026-11-23T00:00:00.000Z",
    classificationReason: "test",
    reviewReason: null,
    evidence: ["Request a demo"],
    confidence: 1,
    enabled: true,
  };
  return defaultActionFlows("Example Business", "demo booking and service", (key) => key, [demoCandidate]);
}

test("demo Actions reuse by capability rather than display name", () => {
  const base = actions().find((action) => action.key === "request_demo")!;
  const existing: ActionFlow = {
    ...base,
    key: "try_demo",
    name: "Try the demo",
    actionType: "open_link",
    executionMode: "DIRECT_LINK",
    fields: [],
    requiredFields: [],
    optionalFields: [],
    destination: { url: "https://example.test/start", label: "Try the demo" },
    completion: { ...base.completion, createLead: false, linkUrl: "https://example.test/start", linkLabel: "Try the demo" },
  };
  const candidate: ActionFlow = {
    ...existing,
    id: "request-demo",
    key: "request_demo",
    name: "Request a demo",
    actionType: "request_demo",
    destination: { url: "https://example.test/start", label: "Request a demo" },
    completion: { ...existing.completion, linkLabel: "Request a demo" },
  };
  assert.equal(actionsCompatible(existing, candidate), true);
  assert.equal(findCompatibleAction([existing], candidate)?.id, existing.id);
  assert.equal(actionsCompatible(existing, { ...candidate, destination: { url: "https://example.test/other" }, completion: { ...candidate.completion, linkUrl: "https://example.test/other" } }), false);
});

test("capability projection separates execution requirements from recommended lead context", () => {
  const booking = actions().find((action) => action.key === "book_appointment")!;
  const capability = actionCapability(booking);
  assert.ok(capability.requiredInputs.includes("service"));
  assert.ok(!capability.requiredInputs.includes("email"));
  assert.ok(capability.recommendedInputs.includes("email"));
  assert.equal(capability.completionType, "collect_details");
});

test("Action relationships count workflow references without changing persisted records", () => {
  const action = {
    ...actions().find((item) => item.key === "request_demo")!,
    enabled: true,
    lifecycleStatus: "active" as const,
  };
  const workflow: ActionFlow = {
    ...action,
    id: "workflow-1",
    key: "qualify_for_demo",
    name: "Help visitors find the right demo",
    steps: [{ id: "demo", type: "redirect" }],
    completion: { ...action.completion, workflow: { name: "Help visitors find the right demo", actionId: action.id } },
  };
  assert.deepEqual(actionRelationships([action, workflow], action), {
    workflowCount: 1,
    workflowIds: ["workflow-1"],
    workflowNames: ["Help visitors find the right demo"],
  });
});

test("Action relationships do not expose disabled or orphaned workflow references", () => {
  const action = actions().find((item) => item.key === "request_demo")!;
  const disabledWorkflow: ActionFlow = {
    ...action,
    id: "disabled-workflow",
    key: "disabled_workflow",
    name: "Archived demo journey",
    enabled: false,
    lifecycleStatus: "disabled",
    steps: [{ id: "demo", type: "redirect" }],
    completion: { ...action.completion, workflow: { name: "Archived demo journey", actionId: action.id } },
  };
  const orphanWorkflow: ActionFlow = {
    ...action,
    id: "orphan-workflow",
    key: "orphan_workflow",
    name: "Orphaned journey",
    steps: [{ id: "demo", type: "redirect" }],
    completion: { ...action.completion, workflow: { name: "Orphaned journey", actionId: "deleted-action" } },
  };

  assert.deepEqual(actionRelationships([action, disabledWorkflow, orphanWorkflow], action), {
    workflowCount: 0,
    workflowIds: [],
    workflowNames: [],
  });
  assert.deepEqual(actionRelationships([{ ...action, enabled: false, lifecycleStatus: "disabled" }, disabledWorkflow], action), {
    workflowCount: 0,
    workflowIds: [],
    workflowNames: [],
  });
});

