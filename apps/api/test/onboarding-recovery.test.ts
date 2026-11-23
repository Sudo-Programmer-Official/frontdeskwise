import test from "node:test";
import assert from "node:assert/strict";
import { deriveOnboardingRecovery, nextOnboardingRecoveryAction } from "../src/onboarding-recovery.js";

function input(overrides: Partial<Parameters<typeof deriveOnboardingRecovery>[0]> = {}) {
  return {
    businessId: "business-1",
    businessName: "Acme Dental",
    businessSlug: "acme-dental",
    organizationId: "org-1",
    ownerUserId: "user-1",
    ownerEmail: "owner@example.com",
    ownerName: "Ava Owner",
    websiteUrl: "https://acme.example",
    onboardingValid: true,
    onboardingMessage: null,
    onboardingFailureCode: null,
    readinessScore: 100,
    sourceCount: 2,
    chunkCount: 8,
    pendingSourceCount: 0,
    failedSourceCount: 0,
    agentTested: true,
    widgetInstalled: true,
    published: false,
    lastActivityAt: "2026-11-22T00:00:00.000Z",
    createdAt: "2026-11-21T00:00:00.000Z",
    reminderCount: 0,
    lastReminderAt: null,
    lastReminderType: null,
    lastReminderCompletionPercent: null,
    emailOpened: false,
    returnedAfterEmail: false,
    unsubscribed: false,
    dormant: false,
    unsubscribeTokenHash: null,
    ...overrides,
  };
}

test("derives contextual progress and the exact next blocker", () => {
  const snapshot = deriveOnboardingRecovery(input({ agentTested: false, widgetInstalled: false }));
  assert.equal(snapshot.completionPercent, 40);
  assert.equal(snapshot.stage, "agent");
  assert.equal(snapshot.nextStep, "Test your assistant");
  assert.match(snapshot.currentBlocker ?? "", /not been tested/i);
  assert.equal(snapshot.intent, "medium");
});

test("selects the five recovery windows from inactivity and intent", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  assert.equal(nextOnboardingRecoveryAction({ completionPercent: 20, currentBlocker: "Add your website", lastActivityAt: "2026-11-22T09:00:00.000Z", reminderCount: 0, published: false, unsubscribed: false, dormant: false }, now), "light");
  assert.equal(nextOnboardingRecoveryAction({ completionPercent: 60, currentBlocker: "Test your assistant", lastActivityAt: "2026-11-21T20:00:00.000Z", reminderCount: 0, published: false, unsubscribed: false, dormant: false }, now), "nearly_ready");
  assert.equal(nextOnboardingRecoveryAction({ completionPercent: 85, currentBlocker: "Publish your assistant", lastActivityAt: "2026-11-21T00:00:00.000Z", reminderCount: 0, published: false, unsubscribed: false, dormant: false }, now), "rescue");
  assert.equal(nextOnboardingRecoveryAction({ completionPercent: 40, currentBlocker: "Test your assistant", lastActivityAt: "2026-11-18T00:00:00.000Z", reminderCount: 0, published: false, unsubscribed: false, dormant: false }, now), "recovery");
  assert.equal(nextOnboardingRecoveryAction({ completionPercent: 40, currentBlocker: "Test your assistant", lastActivityAt: "2026-11-14T00:00:00.000Z", reminderCount: 4, published: false, unsubscribed: false, dormant: false }, now), "nurture");
});

test("stops recovery after publish, unsubscribe, or dormancy", () => {
  const now = new Date("2026-11-22T12:00:00.000Z");
  const base = { completionPercent: 90, currentBlocker: "Publish your assistant", lastActivityAt: "2026-11-14T00:00:00.000Z", reminderCount: 0, published: false, unsubscribed: false, dormant: false };
  assert.equal(nextOnboardingRecoveryAction({ ...base, published: true }, now), null);
  assert.equal(nextOnboardingRecoveryAction({ ...base, unsubscribed: true }, now), null);
  assert.equal(nextOnboardingRecoveryAction({ ...base, dormant: true }, now), null);
});
