import { createHash } from "node:crypto";

export type TenantPublicationHashInput = {
  agentConfig: unknown;
  actions: unknown[];
  primaryActionId: string | null;
  contextVersion: number | null;
};

export function nextTenantPublicationVersion(current: number | null | undefined): number {
  return Math.max(1, Number.isInteger(current) ? Number(current) + 1 : 1);
}

export function tenantPublicationHash(input: TenantPublicationHashInput): string {
  return createHash("sha256").update(JSON.stringify({
    agentConfig: input.agentConfig,
    actions: input.actions,
    primaryActionId: input.primaryActionId,
    contextVersion: input.contextVersion,
  })).digest("hex");
}
