import assert from "node:assert/strict";
import test from "node:test";
import { defaultActionFlows, normalizeCanonicalEnrollmentWorkflow, type ActionFlow } from "../src/action-flows.js";
import { verifyWorkflowDefinition } from "../src/workflow-verifier.js";
import { findStoredWorkflow, isStoredWorkflow, workflowOwnerSchemaDiagnostics, workflowRecordsForBusiness } from "../src/workflow-records.js";
import { ENROLLMENT_WORKFLOW_GOAL, generateWorkflow, validateWorkflowGeneration, type WorkflowStepDraft } from "../../web/src/workflow-generator.ts";

const action = defaultActionFlows("British Swim School", "swim lessons", (key) => `action-${key}`).find((item) => item.key === "enroll_child")!;

test("workflow catalog is sourced from complete stored records, not Action relationships", () => {
  const staleActionProjection = { ...action, workflowCount: 1, workflowIds: ["missing-workflow"], steps: undefined } as ActionFlow;
  const workflow = {
    ...action,
    steps: action.steps?.slice(0, 14),
    completion: { ...action.completion, workflow: { name: "Find the right swim lesson", actionId: action.id } },
  } satisfies ActionFlow;

  assert.equal(isStoredWorkflow(staleActionProjection), false);
  assert.deepEqual(workflowRecordsForBusiness([staleActionProjection, workflow]).map((item) => item.id), [workflow.id]);
  assert.equal(findStoredWorkflow([staleActionProjection, workflow], workflow.id)?.steps?.length, 14);
});

test("workflow read-after-write identity remains stable when one Action owns the workflow", () => {
  const workflow = { ...action, steps: action.steps?.slice(0, 14) } satisfies ActionFlow;
  const firstRead = findStoredWorkflow([workflow], workflow.id);
  const refreshedRead = findStoredWorkflow([workflow], workflow.id);

  assert.equal(firstRead?.id, workflow.id);
  assert.deepEqual(refreshedRead?.steps, firstRead?.steps);
});

test("British Swim one-click generation survives the persisted read path as 14 complete steps", () => {
  const discoveredAction: ActionFlow = {
    ...action,
    origin: "discovered",
    enabled: false,
    lifecycleStatus: "needs_review",
    businessId: "british-swim-tampa-bay",
  };
  const generated = generateWorkflow(ENROLLMENT_WORKFLOW_GOAL, [], {
    businessId: discoveredAction.businessId,
    actionType: "enroll",
    actionName: "Find the right swim lesson",
    actionDescription: "Help parents find a suitable lesson, check live availability, and continue to verified registration.",
    availableProviders: [],
    businessContext: { businessId: discoveredAction.businessId, businessName: "British Swim School Tampa Bay", providers: [] },
  });
  assert.equal(generated.intent, "enrollment");
  assert.equal(generated.steps.length, 14);
  assert.equal(generated.validation.ok, true, JSON.stringify(generated.validation.issues));

  const persisted: ActionFlow = {
    ...discoveredAction,
    name: "Find the right swim lesson",
    description: generated.description,
    fields: generated.fields.map((field) => ({ ...field, id: field.key })),
    steps: generated.steps as ActionFlow["steps"],
    executionMode: "PROVIDER_FLOW",
    provider: "jackrabbit",
    completion: {
      ...discoveredAction.completion,
      workflow: { name: "Find the right swim lesson", actionId: discoveredAction.id, creationRequestId: "british-swim-one-click" },
    },
  };

  // This is the authoritative DB read normalization that previously replaced
  // the generated definition with the unlabeled canonical scaffold.
  const readAfterWrite = normalizeCanonicalEnrollmentWorkflow(persisted);
  assert.equal(readAfterWrite.steps?.length, 14);
  assert.deepEqual(readAfterWrite.steps?.map((step) => step.id), generated.steps.map((step) => step.id));
  assert.equal(workflowOwnerSchemaDiagnostics(readAfterWrite).length, 0);
  assert.equal(validateWorkflowGeneration({ steps: readAfterWrite.steps as WorkflowStepDraft[], fields: generated.fields }).ok, true);
  assert.equal(verifyWorkflowDefinition(readAfterWrite).ok, true, JSON.stringify(verifyWorkflowDefinition(readAfterWrite).issues));
});

test("a zero-step named workflow is not replaced by the canonical scaffold on read", () => {
  const incomplete: ActionFlow = {
    ...action,
    origin: "discovered",
    name: "Find the right swim lesson",
    description: "Owner-generated description that must survive the read path.",
    steps: [],
    completion: {
      ...action.completion,
      workflow: {
        name: "Find the right swim lesson",
        actionId: action.id,
        creationRequestId: "british-swim-retry",
      },
    },
  };

  const readAfterWrite = normalizeCanonicalEnrollmentWorkflow(incomplete);
  assert.equal(readAfterWrite.id, action.id);
  assert.equal(readAfterWrite.steps?.length, 0);
  assert.equal(readAfterWrite.name, incomplete.name);
  assert.equal(readAfterWrite.description, incomplete.description);
  assert.equal(readAfterWrite.completion.workflow?.creationRequestId, "british-swim-retry");
  assert.deepEqual(workflowOwnerSchemaDiagnostics(readAfterWrite), [{ code: "missing_steps" }]);
});

test("retry repair keeps the existing workflow id while replacing its zero-step definition", () => {
  const incomplete: ActionFlow = {
    ...action,
    steps: [],
    completion: {
      ...action.completion,
      workflow: { name: "Find the right swim lesson", actionId: action.id, creationRequestId: "first-attempt" },
    },
  };
  const generated = generateWorkflow(ENROLLMENT_WORKFLOW_GOAL, [], {
    businessId: incomplete.businessId,
    actionType: "enroll",
    actionName: "Find the right swim lesson",
    actionDescription: "Help parents find a suitable lesson and continue to verified registration.",
    availableProviders: [],
    businessContext: { businessId: incomplete.businessId, businessName: "British Swim School Tampa Bay", providers: [] },
  });
  const repaired: ActionFlow = {
    ...incomplete,
    steps: generated.steps as ActionFlow["steps"],
    completion: {
      ...incomplete.completion,
      workflow: { ...incomplete.completion.workflow!, creationRequestId: "retry-attempt" },
    },
  };

  assert.equal(repaired.id, incomplete.id);
  assert.equal(repaired.steps?.length, 14);
  assert.equal(workflowOwnerSchemaDiagnostics(repaired).length, 0);
  assert.equal(verifyWorkflowDefinition(repaired).ok, true, JSON.stringify(verifyWorkflowDefinition(repaired).issues));
});
