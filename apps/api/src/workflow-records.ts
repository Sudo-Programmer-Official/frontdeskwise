import type { ActionFlow } from "./action-flows.js";

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
