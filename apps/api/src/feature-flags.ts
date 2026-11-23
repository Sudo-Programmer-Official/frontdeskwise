import { createHash } from "node:crypto";

export const FEATURE_FLAG_STAGES = ["off", "internal", "reference_tenants", "percentage", "all"] as const;
export type FeatureFlagStage = (typeof FEATURE_FLAG_STAGES)[number];
export type FeatureFlagOverrideState = "on" | "off";

export type FeatureFlagConfig = {
  key: string;
  description: string;
  stage: FeatureFlagStage;
  rolloutPercentage: number;
  referenceOrganizationIds: string[];
};

export type FeatureFlagEvaluationContext = {
  organizationId?: string | null;
  isInternal?: boolean;
  isReference?: boolean;
  override?: FeatureFlagOverrideState | null;
};

export type FeatureFlagDecision = {
  enabled: boolean;
  reason: "override_on" | "override_off" | "off" | "internal" | "reference_tenant" | "percentage" | "all" | "missing_context" | "missing_flag";
  bucket?: number;
};

export function normalizeFeatureFlagKey(value: unknown): string {
  if (typeof value !== "string") throw new Error("Feature flag key is required");
  const key = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9._-]{1,79}$/.test(key)) {
    throw new Error("Feature flag keys must be 2-80 characters and use lowercase letters, numbers, dots, underscores, or hyphens");
  }
  return key;
}

export function normalizeFeatureFlagStage(value: unknown): FeatureFlagStage {
  if (typeof value !== "string" || !FEATURE_FLAG_STAGES.includes(value as FeatureFlagStage)) {
    throw new Error(`stage must be one of: ${FEATURE_FLAG_STAGES.join(", ")}`);
  }
  return value as FeatureFlagStage;
}

export function normalizeRolloutPercentage(value: unknown, fallback = 0): number {
  const candidate = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isFinite(candidate) || candidate < 0 || candidate > 100) {
    throw new Error("rolloutPercentage must be a number between 0 and 100");
  }
  return Math.round(candidate * 100) / 100;
}

/** Stable organization bucket from 0 through 99.99. The same tenant stays in the same cohort. */
export function featureFlagBucket(key: string, organizationId: string): number {
  const digest = createHash("sha256").update(`${key}:${organizationId}`).digest("hex");
  const basisPoints = Number.parseInt(digest.slice(0, 8), 16) % 10_000;
  return basisPoints / 100;
}

export function evaluateFeatureFlag(flag: FeatureFlagConfig, context: FeatureFlagEvaluationContext = {}): FeatureFlagDecision {
  if (context.override === "on") return { enabled: true, reason: "override_on" };
  if (context.override === "off") return { enabled: false, reason: "override_off" };

  switch (flag.stage) {
    case "off":
      return { enabled: false, reason: "off" };
    case "internal":
      return { enabled: context.isInternal === true, reason: "internal" };
    case "reference_tenants":
      return { enabled: context.isReference === true, reason: "reference_tenant" };
    case "all":
      return { enabled: true, reason: "all" };
    case "percentage": {
      if (!context.organizationId) return { enabled: false, reason: "missing_context" };
      const bucket = featureFlagBucket(flag.key, context.organizationId);
      return { enabled: bucket < flag.rolloutPercentage, reason: "percentage", bucket };
    }
  }
}
