import assert from "node:assert/strict";
import test from "node:test";
import { planRecommendationMessage, recommendPlan } from "../src/workflow-plan.js";

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
  assert.equal(recommendPlan({ usage_type: "Solo", usage_level: "Every day" }, [{ subject: "Solo Starter", predicate: "price", valueText: "$19/month", verified: false }]), null);
});
