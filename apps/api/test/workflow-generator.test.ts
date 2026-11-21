import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkflow } from "../../web/src/workflow-generator.ts";

const planPrompt = "Help visitors choose the right PlanCraftAI plan. Ask whether they are using it solo or with a team, what they mainly want help with, and roughly how they plan to use it. Based on their answers, recommend the most suitable plan, explain the reason briefly, then show the Get started button. If they ask a side question like pricing, features, cancellation, or privacy, answer it and continue the workflow without losing progress.";
const davePrompt = "Help parents find the right swim lesson for their child. Ask the child’s age, swimming ability, goal, location or ZIP code, and preferred days. Then use Jackrabbit to find matching classes, show available options and pricing, and generate the registration link. If no class is available, offer the waitlist or team handoff. If the parent asks a side question, answer it and continue from where the workflow left off.";

test("PlanCraftAI prompt takes priority over Capture a lead", () => {
  const result = generateWorkflow(planPrompt, [
    { key: "name", label: "Name", type: "text", required: true, question: "What is your name?" },
    { key: "email", label: "Email", type: "email", required: true, question: "What email should we use?" },
  ], {
    actionType: "contact_team",
    actionName: "Capture a lead",
    actionDescription: "Collect contact details and send the request to the team.",
    availableActionTypes: ["contact_team"],
    businessContext: { businessName: "PlanCraftAI", primaryGoal: "signup", pricing: { verified: true, summary: ["Starter — $19/month"] } },
  });

  assert.equal(result.intent, "plan_selection");
  assert.equal(result.steps.map((step) => step.id).join(","), "usage-type,main-goal,usage-level,recommend-plan,explain-plan,show-pricing,get-started");
  assert.deepEqual(result.steps.slice(0, 3).map((step) => step.fieldKey), ["usage_type", "main_goal", "usage_level"]);
  assert.equal(result.steps.at(-1)?.type, "redirect");
  assert.equal(result.steps.at(-1)?.config?.buttonLabel, "Get started");
  assert.equal(result.fields.find((field) => field.key === "name")?.required, false);
  assert.equal(result.steps[0].config?.interruptionPolicy, "answer_and_resume");
  assert.equal(result.steps[0].config?.reviewStatus, "owner_defined");
  assert.equal(result.steps.find((step) => step.id === "recommend-plan")?.config?.reviewStatus, "suggested");
  assert.equal(result.steps.find((step) => step.id === "explain-plan")?.config?.reviewStatus, "suggested");
  assert.equal(result.steps.find((step) => step.id === "show-pricing")?.config?.reviewStatus, "verified");
});

test("Dave swim prompt creates a provider-backed enrollment journey", () => {
  const result = generateWorkflow(davePrompt, [], {
    actionType: "contact_team",
    actionName: "Capture a lead",
    availableProviders: ["jackrabbit"],
    businessContext: { businessName: "British Swim School Tampa Bay", providers: [{ value: "jackrabbit" }] },
  });

  assert.equal(result.intent, "enrollment");
  assert.deepEqual(result.steps.slice(0, 5).map((step) => step.fieldKey), ["child_age", "ability", "goal", "location", "preferred_days"]);
  assert.equal(result.steps.find((step) => step.id === "find-classes")?.config?.provider, "jackrabbit");
  assert.equal(result.steps.find((step) => step.id === "find-classes")?.config?.reviewStatus, "provider_backed");
  assert.equal(result.steps.find((step) => step.id === "show-options")?.config?.reviewStatus, "provider_backed");
  assert.equal(result.steps.find((step) => step.id === "registration-link")?.config?.reviewStatus, "provider_backed");
  assert.match(result.steps.find((step) => step.id === "show-options")?.label ?? "", /pricing/i);
  assert.equal(result.steps.find((step) => step.id === "registration-link")?.type, "generate_link");
  assert.ok(result.fields.some((field) => field.key === "child_age"));
  assert.equal(result.steps.some((step) => step.fieldKey === "name" || step.fieldKey === "email"), false);
});
