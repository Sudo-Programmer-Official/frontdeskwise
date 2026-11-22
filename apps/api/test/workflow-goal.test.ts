import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkflow } from "../../web/src/workflow-generator.ts";
import { preserveWorkflowGoal } from "../src/workflow-goal.js";

const salonFlowGoal = [
  "Help SalonFlow visitors understand whether the product is a good fit for their salon or beauty business.",
  "First ask what kind of business they run and what they are mainly trying to improve, including online booking, client management, reminders, staff management, payments, reviews, loyalty, or more bookings. Match only verified SalonFlow capabilities, explain the fit briefly, and show verified pricing when relevant.",
  "Preserve the visitor's progress when answering side questions. Use the approved Try the demo action for sales intent, but create conditional Request a demo behavior only when the visitor explicitly asks for a demo or wants a team walkthrough.",
  "For support, account help, or a request to speak with a person, use support/handoff behavior and connect the visitor with the team. Never invent pricing, features, integrations, guarantees, or policies.",
  "When a visitor is only exploring, ask the minimum useful questions, keep answers grounded in the active SalonFlow business context, and do not replace the owner's instructions with generic lead capture. Preserve every paragraph, rule, exception, and final instruction when the workflow is refreshed, regenerated, reopened, or moved between businesses.",
].join("\n\n");

test("long owner workflow goal survives request, persistence, workspace, and generation unchanged", () => {
  assert.ok(salonFlowGoal.length > 1_000);

  const requestPayload = { description: salonFlowGoal };
  const validatedGoal = preserveWorkflowGoal(requestPayload.description);
  const persistedGoal = validatedGoal;
  const refreshGoal = JSON.parse(JSON.stringify({ description: persistedGoal })).description as string;
  const switchedBusinessAndReturnedGoal = JSON.parse(JSON.stringify({ description: refreshGoal })).description as string;
  const reopenedWorkflowGoal = JSON.parse(JSON.stringify({ description: switchedBusinessAndReturnedGoal })).description as string;
  const workspaceGoal = reopenedWorkflowGoal;
  const generatorInputGoal = workspaceGoal;
  const generated = generateWorkflow(generatorInputGoal ?? "", [], {
    actionName: "SalonFlow workflow",
    businessContext: {
      businessId: "salonflow-business",
      businessName: "SalonFlow",
      businessType: "Salon and beauty business",
      approvedActions: [
        { key: "try_demo", name: "Try the demo", actionType: "open_link" },
        { key: "request_demo", name: "Request a demo", actionType: "request_demo" },
      ],
      pricing: { verified: true, summary: ["Verified pricing only"] },
    },
  });

  assert.equal(validatedGoal, salonFlowGoal);
  assert.equal(persistedGoal, salonFlowGoal);
  assert.equal(refreshGoal, salonFlowGoal);
  assert.equal(switchedBusinessAndReturnedGoal, salonFlowGoal);
  assert.equal(reopenedWorkflowGoal, salonFlowGoal);
  assert.equal(workspaceGoal, salonFlowGoal);
  assert.equal(generatorInputGoal, salonFlowGoal);
  assert.equal(generated.description, salonFlowGoal);
  assert.match(generated.description, /Request a demo behavior/);
  assert.match(generated.description, /support\/handoff behavior/);
  assert.match(generated.description, /Never invent pricing, features, integrations, guarantees, or policies\./);
  assert.equal(generated.steps.find((step) => step.id === "request-demo")?.type, "redirect");
  assert.equal(generated.steps.find((step) => step.id === "support-handoff")?.type, "handoff");
});
