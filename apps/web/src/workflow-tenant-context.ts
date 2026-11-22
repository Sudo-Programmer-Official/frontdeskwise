export type WorkflowTenantContext = {
  selectedBusinessId?: string | null;
  selectedActionBusinessId?: string | null;
  workspaceBusinessId?: string | null;
  businessContextBusinessId?: string | null;
  createWorkflowBusinessId?: string | null;
  selectedOrganizationId?: string | null;
  actionOrganizationId?: string | null;
  workspaceOrganizationId?: string | null;
  businessContextOrganizationId?: string | null;
  createWorkflowOrganizationId?: string | null;
};

export type WorkflowTenantContextValidation =
  | { ok: true }
  | { ok: false; dimension: "business" | "organization"; values: string[] };

function normalizedId(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function validateEqual(values: Array<string | null | undefined>): { ok: boolean; values: string[] } {
  const normalizedValues = values.map(normalizedId);
  return {
    ok: normalizedValues.every(Boolean) && new Set(normalizedValues).size === 1,
    values: normalizedValues,
  };
}

/**
 * Workflow creation is only safe when every client-side tenant reference is
 * from the same workspace snapshot. Missing IDs fail closed so a partially
 * hydrated business switch cannot submit a workflow against stale state.
 */
export function validateWorkflowTenantContext(input: WorkflowTenantContext): WorkflowTenantContextValidation {
  const business = validateEqual([
    input.selectedBusinessId,
    input.selectedActionBusinessId,
    input.workspaceBusinessId,
    input.businessContextBusinessId,
    input.createWorkflowBusinessId,
  ]);
  if (!business.ok) return { ok: false, dimension: "business", values: business.values };

  const organizationValues = [
    input.selectedOrganizationId,
    input.actionOrganizationId,
    input.workspaceOrganizationId,
    input.businessContextOrganizationId,
    input.createWorkflowOrganizationId,
  ].map(normalizedId);
  if (organizationValues.some(Boolean)) {
    const organization = validateEqual(organizationValues);
    if (!organization.ok) return { ok: false, dimension: "organization", values: organization.values };
  }

  return { ok: true };
}

export const WORKFLOW_CONTEXT_REFRESH_MESSAGE = "Business context changed. Refreshing business data…";
