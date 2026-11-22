import assert from "node:assert/strict";
import test from "node:test";
import { createActionState, type ActionFlow } from "../src/action-flows.js";
import { decideConversationRoute } from "../src/conversation-orchestrator.js";
import { recomputeWorkflowResume } from "../src/workflow-resume.js";

const salonWorkflow: ActionFlow = {
  id: "salon-fit",
  key: "business_fit",
  actionType: "open_link",
  name: "Help visitors find the right SalonFlow fit",
  description: "Qualify a salon owner and guide them toward the demo.",
  triggerPhrases: ["I run a salon"],
  triggerIntents: ["lead"],
  captureMode: "conversational",
  fields: [
    { id: "business_type", key: "business_type", label: "Business type", type: "text", required: true, question: "What kind of salon do you run?" },
    { id: "main_goal", key: "main_goal", label: "Main goal", type: "text", required: true, question: "What are you mainly trying to improve?" },
    { id: "current_software", key: "current_software", label: "Current software", type: "text", required: true, question: "Are you using any salon software today?" },
  ],
  steps: [
    { id: "business-type", type: "capture", fieldKey: "business_type" },
    { id: "main-goal", type: "capture", fieldKey: "main_goal" },
    { id: "current-software", type: "capture", fieldKey: "current_software" },
    { id: "fit", type: "ask", question: "Does that sound like the kind of workflow you want to improve?" },
    { id: "try-demo", type: "redirect", question: "Ready to see how SalonFlow can help?" },
  ],
  completion: { createLead: false, leadStatus: "new", message: "", notifyStaff: false },
  mode: "transactional",
  executionMode: "DIRECT_LINK",
  destination: { url: "https://example.com/demo" },
  provider: null,
  priority: 1,
  requiredFields: ["business_type", "main_goal", "current_software"],
  conditions: [],
  safetyPolicy: "standard",
  sourceUrl: null,
  evidence: [],
  confidence: 1,
  enabled: true,
  createdAt: "2026-11-22T00:00:00.000Z",
  updatedAt: "2026-11-22T00:00:00.000Z",
};

test("pricing interruption resumes at the next meaningful SalonFlow step", () => {
  const state = createActionState(salonWorkflow);
  state.values = {
    business_type: "Small salon",
    main_goal: "Online booking + reminders",
    current_software: "Mindbody",
  };
  state.currentStepId = "fit";
  state.completedStepIds = ["business-type", "main-goal", "current-software"];

  const interruption = decideConversationRoute({
    message: "How much does it cost?",
    activeAction: salonWorkflow,
    actionState: state,
  });
  assert.equal(interruption.route, "INTERRUPTION");

  const resume = recomputeWorkflowResume(salonWorkflow, state);
  assert.equal(resume.step?.id, "try-demo");
  assert.deepEqual(resume.skippedStepIds, ["fit"]);
  assert.notEqual(resume.step?.question, "Does that sound like the kind of workflow you want to improve?");
});

test("resume keeps the next unresolved qualification field instead of skipping ahead", () => {
  const state = createActionState(salonWorkflow);
  state.values = {
    business_type: "Small salon",
    main_goal: "Online booking + reminders",
  };
  state.currentStepId = "current-software";
  state.completedStepIds = ["business-type", "main-goal"];

  const resume = recomputeWorkflowResume(salonWorkflow, state);
  assert.equal(resume.step?.id, "current-software");
  assert.deepEqual(resume.skippedStepIds, []);
});
