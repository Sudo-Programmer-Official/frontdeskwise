import { createHash } from "node:crypto";

/**
 * Publication hashes represent runtime configuration, not persistence or UI
 * bookkeeping. Keeping this projection here makes the published/live state
 * resilient to harmless reloads, normalisation, and version bumps.
 */
const NON_CONFIG_KEYS = new Set([
  "createdAt",
  "created_at",
  "updatedAt",
  "updated_at",
  "lastOpenedAt",
  "last_opened_at",
  "lastCrawledAt",
  "last_crawled_at",
  "publishedAt",
  "published_at",
  "readiness",
  "workflowSafety",
  "workflowStatus",
  "isPrimary",
  "version",
]);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, item]) => !NON_CONFIG_KEYS.has(key) && item !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

function canonicalString(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

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
  return createHash("sha256").update(canonicalString({
    agentConfig: input.agentConfig,
    actions: input.actions,
    primaryActionId: input.primaryActionId,
    contextVersion: input.contextVersion,
  })).digest("hex");
}

export function workflowConfigHash(workflow: unknown): string {
  return createHash("sha256").update(canonicalString(workflow)).digest("hex");
}
