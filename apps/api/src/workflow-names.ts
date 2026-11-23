import type { ActionFlow } from "./action-flows.js";

type WorkflowNameSource = Pick<ActionFlow, "id" | "name" | "steps" | "completion">;

/**
 * Workflow names are owner-facing labels, so compare them in a forgiving way
 * while preserving the original spelling for display and error messages.
 */
export function normalizeWorkflowName(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

export function workflowNameForAction(action: Pick<WorkflowNameSource, "name" | "steps" | "completion">): string | null {
  const metadataName = action.completion?.workflow?.name;
  if (typeof metadataName === "string" && metadataName.trim()) return metadataName.trim();
  if ((action.steps?.length ?? 0) > 0 && action.name.trim()) return action.name.trim();
  return null;
}

export function findDuplicateWorkflowName(
  actions: ReadonlyArray<WorkflowNameSource>,
  candidateName: string,
  excludedActionId?: string,
): WorkflowNameSource | null {
  const normalizedCandidate = normalizeWorkflowName(candidateName);
  if (!normalizedCandidate) return null;
  return actions.find((action) => {
    if (excludedActionId && action.id === excludedActionId) return false;
    const existingName = workflowNameForAction(action);
    return Boolean(existingName && normalizeWorkflowName(existingName) === normalizedCandidate);
  }) ?? null;
}
