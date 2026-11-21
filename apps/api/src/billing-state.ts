export const BILLING_PLAN_ORDER = ["demo", "starter", "growth", "multi_business", "portfolio"] as const;

export type BillingPlanKey = (typeof BILLING_PLAN_ORDER)[number] | (string & {});
export type BillingPlanChangeType = "none" | "upgrade" | "downgrade";
export type BillingPaymentFailureContext = "renewal" | "upgrade";

function planRank(planKey: string): number {
  const index = BILLING_PLAN_ORDER.indexOf(planKey as (typeof BILLING_PLAN_ORDER)[number]);
  return index >= 0 ? index : -1;
}

export function billingPlanChangeType(currentPlanKey: string, requestedPlanKey: string): BillingPlanChangeType {
  const currentRank = planRank(currentPlanKey);
  const requestedRank = planRank(requestedPlanKey);
  if (currentRank < 0 || requestedRank < 0 || currentRank === requestedRank) return "none";
  return requestedRank > currentRank ? "upgrade" : "downgrade";
}

export function billingPaymentFailureContext(input: {
  billingReason: string | null;
  pendingPlanChangeType: string | null;
}): BillingPaymentFailureContext {
  return input.billingReason === "subscription_update" || input.pendingPlanChangeType === "upgrade"
    ? "upgrade"
    : "renewal";
}

export function shouldApplyStripePlanChange(input: {
  allowPlanChange: boolean;
  paymentConfirmed: boolean;
  stripeStatus: string;
  hasPendingUpdate: boolean;
}): boolean {
  return input.allowPlanChange
    && input.paymentConfirmed
    && input.stripeStatus === "active"
    && !input.hasPendingUpdate;
}

export function activePlanAfterStripeSync(input: {
  currentPlanKey: string;
  observedPlanKey: string | null;
  allowPlanChange: boolean;
  paymentConfirmed: boolean;
  stripeStatus: string;
  hasPendingUpdate: boolean;
}): string {
  if (!input.observedPlanKey) return input.currentPlanKey;
  return shouldApplyStripePlanChange(input)
    ? input.observedPlanKey
    : input.currentPlanKey;
}
