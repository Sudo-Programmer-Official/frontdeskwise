import assert from "node:assert/strict";
import test from "node:test";
import { planRecommendationMessage, planRecommendationPayload, recommendPlan } from "../src/workflow-plan.js";

test("plan recommendations use verified workflow facts and respect solo/team context", () => {
  const facts = [
    { subject: "Solo Starter", predicate: "monthly price", valueText: "$19/month", verified: true },
    { subject: "Solo Pro", predicate: "monthly price", valueText: "$29/month", verified: true },
    { subject: "Team Pro", predicate: "monthly price", valueText: "$79/month for teams", verified: true },
    { subject: "Enterprise", predicate: "monthly price", valueText: "$199/month", verified: false },
  ];
  const solo = recommendPlan({ usage_type: "Solo", main_goal: "Planning + reminders", usage_level: "Every day" }, facts);
  assert.equal(solo?.plan, "Solo Pro");
  assert.equal(solo?.price, "$29/month");
  assert.match(planRecommendationMessage(solo!), /Solo Pro/);
  assert.doesNotMatch(planRecommendationMessage(solo!), /Team Pro/);

  const team = recommendPlan({ usage_type: "Team", main_goal: "Team coordination", usage_level: "Regularly" }, facts);
  assert.equal(team?.plan, "Team Pro");
});

test("plan recommendation fails closed when verified plan data is absent", () => {
  assert.equal(recommendPlan({ usage_type: "Solo", usage_level: "Daily" }, [{ subject: "Solo Starter", predicate: "price", valueText: "$19/month", verified: false }]), null);
});

test("PlanCraftAI daily solo answers deterministically recommend Solo Premium from verified facts", () => {
  const recommendation = recommendPlan({
    usage_type: "Solo",
    main_goal: "Planning + reminders",
    usage_level: "Daily",
  }, [
    { subject: "PlanCraftAI", predicate: "plan price", valueText: "Free — $0", verified: true },
    { subject: "PlanCraftAI", predicate: "plan price", valueText: "Solo Premium — $5/month", verified: true },
    { subject: "PlanCraftAI", predicate: "plan price", valueText: "Team Pro — $20/month", verified: true },
  ]);

  assert.equal(recommendation?.plan, "Solo Premium");
  assert.equal(recommendation?.price, "$5/month");
  assert.deepEqual(planRecommendationPayload(recommendation!), {
    recommendedPlan: "Solo Premium",
    verifiedPrice: "$5/month",
    reason: recommendation?.reason,
  });
  assert.match(planRecommendationMessage(recommendation!), /Solo Premium/);
  assert.match(planRecommendationMessage(recommendation!), /\$5\/month/);
});

test("team recommendations fail closed when only solo verified plans exist", () => {
  assert.equal(recommendPlan({ usage_type: "Team", main_goal: "Planning", usage_level: "Daily" }, [
    { subject: "Free", predicate: "plan price", valueText: "$0", verified: true },
    { subject: "Solo Premium", predicate: "plan price", valueText: "$5/month", verified: true },
  ]), null);
});
