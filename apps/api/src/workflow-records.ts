import type { ActionFlow } from "./action-flows.js";

export type WorkflowOwnerSchemaDiagnostic = {
  code: "missing_steps" | "missing_step_id" | "missing_step_type" | "missing_step_label";
  stepId?: string;
  stepIndex?: number;
};

/** Workflows are persisted as complete Action records, never as relationship-only rows. */
export function isStoredWorkflow(action: Pick<ActionFlow, "steps">): boolean {
  return (action.steps?.length ?? 0) > 0;
}

export function workflowRecordsForBusiness(actions: ActionFlow[]): ActionFlow[] {
  return actions.filter(isStoredWorkflow);
}

export function findStoredWorkflow(actions: ActionFlow[], workflowId: string): ActionFlow | null {
  return actions.find((action) => action.id === workflowId && isStoredWorkflow(action)) ?? null;
}

/**
 * Owner-facing workflow records need labels even though the runtime can
 * execute a step without them. Keep this separate from runtime verification:
 * it is a response/persistence contract, not a relaxed publication check.
 */
export function workflowOwnerSchemaDiagnostics(action: Pick<ActionFlow, "steps">): WorkflowOwnerSchemaDiagnostic[] {
  const steps = action.steps ?? [];
  const diagnostics: WorkflowOwnerSchemaDiagnostic[] = [];
  if (!steps.length) diagnostics.push({ code: "missing_steps" });
  for (const [stepIndex, step] of steps.entries()) {
    if (!step.id?.trim()) diagnostics.push({ code: "missing_step_id", stepIndex });
    if (!step.type) diagnostics.push({ code: "missing_step_type", stepId: step.id, stepIndex });
    if (!step.label?.trim()) diagnostics.push({ code: "missing_step_label", stepId: step.id, stepIndex });
  }
  return diagnostics;
}
