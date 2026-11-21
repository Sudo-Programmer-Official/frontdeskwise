import test from "node:test";
import assert from "node:assert/strict";
import {
  activePlanAfterStripeSync,
  billingPaymentFailureContext,
  billingPlanChangeType,
  shouldApplyStripePlanChange,
} from "../src/billing-state.ts";

test("billing plan direction is deterministic across the public catalog", () => {
  assert.equal(billingPlanChangeType("starter", "growth"), "upgrade");
  assert.equal(billingPlanChangeType("growth", "multi_business"), "upgrade");
  assert.equal(billingPlanChangeType("multi_business", "portfolio"), "upgrade");
  assert.equal(billingPlanChangeType("portfolio", "multi_business"), "downgrade");
  assert.equal(billingPlanChangeType("multi_business", "growth"), "downgrade");
  assert.equal(billingPlanChangeType("growth", "starter"), "downgrade");
  assert.equal(billingPlanChangeType("starter", "starter"), "none");
});

test("Stripe subscription observations cannot grant a pending plan before payment confirmation", () => {
  assert.equal(shouldApplyStripePlanChange({
    allowPlanChange: true,
    paymentConfirmed: false,
    stripeStatus: "incomplete",
    hasPendingUpdate: true,
  }), false);
  assert.equal(activePlanAfterStripeSync({
    currentPlanKey: "starter",
    observedPlanKey: "growth",
    allowPlanChange: true,
    paymentConfirmed: false,
    stripeStatus: "incomplete",
    hasPendingUpdate: true,
  }), "starter");
});

test("only a confirmed active Stripe payment can advance active entitlements", () => {
  assert.equal(shouldApplyStripePlanChange({
    allowPlanChange: true,
    paymentConfirmed: true,
    stripeStatus: "active",
    hasPendingUpdate: false,
  }), true);
  assert.equal(activePlanAfterStripeSync({
    currentPlanKey: "starter",
    observedPlanKey: "growth",
    allowPlanChange: true,
    paymentConfirmed: true,
    stripeStatus: "active",
    hasPendingUpdate: false,
  }), "growth");
});

test("subscription.updated cannot regress or advance the active plan on its own", () => {
  assert.equal(activePlanAfterStripeSync({
    currentPlanKey: "growth",
    observedPlanKey: "starter",
    allowPlanChange: false,
    paymentConfirmed: false,
    stripeStatus: "active",
    hasPendingUpdate: false,
  }), "growth");
});

test("renewal and upgrade payment failures have separate grace semantics", () => {
  assert.equal(billingPaymentFailureContext({ billingReason: "subscription_cycle", pendingPlanChangeType: null }), "renewal");
  assert.equal(billingPaymentFailureContext({ billingReason: "subscription_update", pendingPlanChangeType: "upgrade" }), "upgrade");
  assert.equal(billingPaymentFailureContext({ billingReason: "subscription_cycle", pendingPlanChangeType: "upgrade" }), "upgrade");
});
