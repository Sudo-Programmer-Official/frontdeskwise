/**
 * Workflow goals are owner-authored instructions, not display copy. Keep the
 * original string intact so paragraph breaks and final rules reach generation
 * and persistence unchanged.
 */
export function preserveWorkflowGoal(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
