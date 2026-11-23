import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateFeatureFlag,
  featureFlagBucket,
  normalizeFeatureFlagKey,
  normalizeFeatureFlagStage,
  normalizeRolloutPercentage,
  type FeatureFlagConfig,
} from "../src/feature-flags.js";

const flag = (stage: FeatureFlagConfig["stage"], overrides: Partial<FeatureFlagConfig> = {}): FeatureFlagConfig => ({
  key: "workflow.runtime_v2",
  description: "test",
  stage,
  rolloutPercentage: 0,
  referenceOrganizationIds: [],
  ...overrides,
});

test("feature flag stages target the intended cohorts", () => {
  assert.equal(evaluateFeatureFlag(flag("off"), { isInternal: true }).enabled, false);
  assert.equal(evaluateFeatureFlag(flag("internal"), { isInternal: true }).enabled, true);
  assert.equal(evaluateFeatureFlag(flag("internal"), { isInternal: false }).enabled, false);
  assert.equal(evaluateFeatureFlag(flag("reference_tenants"), { isReference: true }).enabled, true);
  assert.equal(evaluateFeatureFlag(flag("reference_tenants"), { isReference: false }).enabled, false);
  assert.equal(evaluateFeatureFlag(flag("all"), {}).enabled, true);
});

test("percentage rollout is deterministic and requires tenant context", () => {
  const first = evaluateFeatureFlag(flag("percentage", { rolloutPercentage: 50 }), { organizationId: "org-123" });
  const second = evaluateFeatureFlag(flag("percentage", { rolloutPercentage: 50 }), { organizationId: "org-123" });
  assert.deepEqual(first, second);
  assert.equal(first.reason, "percentage");
  assert.equal(first.bucket, featureFlagBucket("workflow.runtime_v2", "org-123"));
  assert.equal(evaluateFeatureFlag(flag("percentage", { rolloutPercentage: 100 }), {}).enabled, false);
  assert.equal(evaluateFeatureFlag(flag("percentage", { rolloutPercentage: 0 }), { organizationId: "org-123" }).enabled, false);
});

test("tenant overrides take precedence over rollout stage", () => {
  assert.equal(evaluateFeatureFlag(flag("off"), { override: "on" }).reason, "override_on");
  assert.equal(evaluateFeatureFlag(flag("all"), { override: "off" }).reason, "override_off");
});

test("feature flag inputs are normalized and bounded", () => {
  assert.equal(normalizeFeatureFlagKey("  Workflow.Runtime_V2 "), "workflow.runtime_v2");
  assert.equal(normalizeFeatureFlagStage("percentage"), "percentage");
  assert.equal(normalizeRolloutPercentage("12.345"), 12.35);
  assert.throws(() => normalizeFeatureFlagKey("not valid"));
  assert.throws(() => normalizeFeatureFlagStage("beta"));
  assert.throws(() => normalizeRolloutPercentage(101));
});
