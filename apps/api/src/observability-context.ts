export type ObservabilityWorkflow = {
  id?: string | null;
  key?: string | null;
  version?: number | null;
};

export type ObservabilityModel = {
  route?: string | null;
  name?: string | null;
};

export type ObservabilityContext = {
  releaseVersion: string;
  deploymentVersion: string | null;
  modelRoutingVersion: string;
  tenantId: string | null;
  organizationId: string | null;
  tenantSlug: string | null;
  publicationVersion: number | null;
  workflowId: string | null;
  workflowKey: string | null;
  workflowVersion: number | null;
  modelRoute: string | null;
  modelName: string | null;
  correlationId: string | null;
};

type ObservabilityBusiness = {
  id?: string | null;
  organizationId?: string | null;
  slug?: string | null;
  publishedConfigVersion?: number | null;
};

function bounded(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/[\u0000-\u001f\u007f]/g, "");
  return normalized ? normalized.slice(0, maxLength) : null;
}

function firstEnvironmentValue(names: string[]): string | null {
  for (const name of names) {
    const value = bounded(process.env[name], 160);
    if (value) return value;
  }
  return null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

export const runtimeObservabilityVersions = Object.freeze({
  releaseVersion: firstEnvironmentValue([
    "FRONTDESKWISE_RELEASE_VERSION",
    "FRONTDESKWISE_RELEASE_SHA",
    "RENDER_GIT_COMMIT",
    "VERCEL_GIT_COMMIT_SHA",
    "GIT_SHA",
  ]) ?? (process.env.NODE_ENV === "production" ? "unknown" : "local"),
  deploymentVersion: firstEnvironmentValue([
    "FRONTDESKWISE_DEPLOYMENT_VERSION",
    "FRONTDESKWISE_DEPLOYMENT_ID",
    "RENDER_DEPLOY_ID",
    "VERCEL_DEPLOYMENT_ID",
  ]),
  modelRoutingVersion: firstEnvironmentValue(["FRONTDESKWISE_MODEL_ROUTING_VERSION"]) ?? "model-routing-v1",
});

export function buildObservabilityContext(input: {
  business?: ObservabilityBusiness | null;
  workflow?: ObservabilityWorkflow | null;
  model?: ObservabilityModel | null;
  publicationVersion?: number | null;
  correlationId?: string | null;
} = {}): ObservabilityContext {
  return {
    releaseVersion: runtimeObservabilityVersions.releaseVersion,
    deploymentVersion: runtimeObservabilityVersions.deploymentVersion,
    modelRoutingVersion: runtimeObservabilityVersions.modelRoutingVersion,
    tenantId: bounded(input.business?.id, 120),
    organizationId: bounded(input.business?.organizationId, 120),
    tenantSlug: bounded(input.business?.slug, 120),
    publicationVersion: positiveInteger(input.publicationVersion ?? input.business?.publishedConfigVersion),
    workflowId: bounded(input.workflow?.id, 120),
    workflowKey: bounded(input.workflow?.key, 160),
    workflowVersion: positiveInteger(input.workflow?.version),
    modelRoute: bounded(input.model?.route, 80),
    modelName: bounded(input.model?.name, 160),
    correlationId: bounded(input.correlationId, 160),
  };
}

/**
 * Stable snake_case names keep JSON metadata, SQL columns, and log fields
 * aligned. Nulls are intentional: a widget performance event may not have a
 * workflow or model, but it should still carry the same correlation shape.
 */
export function observabilityMetadata(context: ObservabilityContext): Record<string, string | number | null> {
  return {
    release_version: context.releaseVersion,
    deployment_version: context.deploymentVersion,
    model_routing_version: context.modelRoutingVersion,
    tenant_id: context.tenantId,
    organization_id: context.organizationId,
    tenant_slug: context.tenantSlug,
    publication_version: context.publicationVersion,
    workflow_id: context.workflowId,
    workflow_key: context.workflowKey,
    workflow_version: context.workflowVersion,
    model_route: context.modelRoute,
    model_name: context.modelName,
    correlation_id: context.correlationId,
  };
}
