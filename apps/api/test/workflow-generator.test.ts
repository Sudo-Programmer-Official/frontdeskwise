import assert from "node:assert/strict";
import test from "node:test";
import { generateWorkflow, workflowGenerationCacheKey } from "../../web/src/workflow-generator.ts";

const planPrompt = "Help visitors choose the right PlanCraftAI plan. Ask whether they are using it solo or with a team, what they mainly want help with, and roughly how they plan to use it. Based on their answers, recommend the most suitable plan, explain the reason briefly, then show the Get started button. If they ask a side question like pricing, features, cancellation, or privacy, answer it and continue the workflow without losing progress.";
const davePrompt = "Help parents find the right swim lesson for their child. Ask the child’s age, swimming ability, goal, location or ZIP code, and preferred days. Then use Jackrabbit to find matching classes, show available options and pricing, and generate the registration link. If no class is available, offer the waitlist or team handoff. If the parent asks a side question, answer it and continue from where the workflow left off.";
const salonPrompt = "Help salon owners understand whether SalonFlow is a good fit. First, understand what kind of salon or beauty business they run and what they are mainly trying to improve, such as online booking, client management, reminders, staff management, payments, reviews, loyalty, or more bookings. Match verified SalonFlow capabilities, answer side questions while preserving workflow progress, explain why SalonFlow may fit, show verified pricing when relevant, use Try the demo for sales intent, use Request a demo only when explicitly requested, and hand off account help to a person.";

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
  assert.deepEqual(result.fields.slice(0, 3).map((field) => field.key), ["usage_type", "main_goal", "usage_level"]);
  assert.equal(result.fields.find((field) => field.key === "recommended_plan")?.visibility, "hidden");
  assert.equal(result.fields.some((field) => field.key === "business_type" || field.key === "relevant_capabilities"), false);
  assert.deepEqual(result.fields.find((field) => field.key === "usage_level")?.options, ["Occasionally", "Regularly", "Daily"]);
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
  assert.deepEqual(result.steps.slice(0, 6).map((step) => step.fieldKey), ["customer_type", "child_age", "ability", "goal", "location", "schedule_preference"]);
  assert.equal(result.steps.find((step) => step.id === "find-classes")?.config?.provider, "jackrabbit");
  assert.equal(result.steps.find((step) => step.id === "find-classes")?.config?.reviewStatus, "provider_backed");
  assert.equal(result.steps.find((step) => step.id === "class-recommendations")?.config?.reviewStatus, "provider_backed");
  assert.equal(result.steps.find((step) => step.id === "class-selection")?.type, "select");
  assert.equal(result.steps.find((step) => step.id === "parent-contact")?.config?.ensureContact, true);
  assert.deepEqual(result.steps.slice(-5).map((step) => step.id), ["parent-contact", "save-lead", "registration-confirm", "registration-link", "enrollment-complete"]);
  assert.equal(result.steps.find((step) => step.id === "save-lead")?.type, "create_lead");
  assert.equal(result.steps.find((step) => step.id === "registration-link")?.config?.reviewStatus, "provider_backed");
  assert.match(result.steps.find((step) => step.id === "class-recommendations")?.label ?? "", /matching classes/i);
  assert.equal(result.steps.find((step) => step.id === "registration-link")?.type, "generate_link");
  assert.ok(result.fields.some((field) => field.key === "child_age"));
  assert.equal(result.fields.find((field) => field.key === "parent_name")?.required, true);
  assert.equal(result.fields.find((field) => field.key === "email")?.required, false);
  assert.equal(result.fields.find((field) => field.key === "phone")?.required, false);
  assert.equal(result.steps.some((step) => step.fieldKey === "name" || step.fieldKey === "email"), false);
});

test("SalonFlow prompt is generated from the active business context", () => {
  const result = generateWorkflow(salonPrompt, [
    { key: "usage_type", label: "Usage type", type: "select", required: true, question: "Are you planning to use PlanCraftAI by yourself or with a team?" },
    { key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often do you expect to use PlanCraftAI?" },
  ], {
    actionName: "Choose the right SalonFlow plan",
    businessContext: {
      businessId: "salonflow-business",
      contextVersion: 4,
      businessName: "Salon Management Software for More Bookings",
      businessType: "local_business",
      summary: "SalonFlow helps salons and beauty businesses manage bookings and reminders.",
      knowledgeSummary: [{ value: "Canonical brand: SalonFlow" }],
      approvedActions: [
        { key: "try_demo", name: "Try the demo", actionType: "open_link" },
        { key: "request_demo", name: "Request a demo", actionType: "request_demo" },
      ],
      discoveredCtas: [{ label: "Try the demo", url: "https://www.salonflow.studio/start" }],
      pricing: { verified: false, summary: [] },
    },
  });

  assert.equal(result.intent, "business_fit");
  assert.deepEqual(result.steps.slice(0, 5).map((step) => step.label), ["Business type", "Main goal", "Current software", "Relevant capabilities", "Pricing"]);
  assert.equal(result.steps[0].question, "What kind of salon or beauty business do you run?");
  assert.equal(result.steps.find((step) => step.id === "try-demo")?.config?.destinationUrl, "https://www.salonflow.studio/start");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.reviewStatus, "needs_owner_confirmation");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.requiresVerifiedData, true);
  assert.equal(result.steps.find((step) => step.id === "pricing")?.type, "knowledge");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.topic, "pricing");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.knowledgeSource, "verified_business_knowledge");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.allowedFacts, "pricing");
  assert.equal(result.steps.find((step) => step.id === "pricing")?.config?.resumeBehavior, "return_to_previous_step");
  assert.deepEqual(result.steps.slice(-5).map((step) => step.id), ["contact-email", "save-lead", "try-demo", "request-demo", "support-handoff"]);
  assert.equal(result.steps.find((step) => step.id === "save-lead")?.type, "create_lead");
  assert.ok(result.fields.some((field) => field.key === "name" && field.required));
  assert.ok(result.fields.some((field) => field.key === "email" && field.required));
  assert.equal(JSON.stringify(result.steps.find((step) => step.id === "pricing")).includes("$65"), false);
  assert.equal(result.steps.some((step) => step.id === "fit-explanation"), false);
  assert.equal(result.steps.find((step) => step.id === "try-demo")?.config?.normalConversionEndpoint, true);
  assert.equal(result.steps.find((step) => step.id === "try-demo")?.config?.actionKey, "try_demo");
  assert.equal(result.steps.find((step) => step.id === "try-demo")?.config?.trigger, undefined);
  assert.equal(result.steps.find((step) => step.id === "request-demo")?.config?.trigger, "explicit_guided_demo_request");
  assert.equal(result.steps.find((step) => step.id === "request-demo")?.config?.actionKey, "request_demo");
  assert.equal(result.steps.find((step) => step.id === "request-demo")?.config?.conditional, true);
  assert.equal(result.steps.find((step) => step.id === "support-handoff")?.config?.trigger, "explicit_support_or_human_request");
  assert.equal(result.steps.find((step) => step.id === "support-handoff")?.config?.conditional, true);
  assert.equal(JSON.stringify(result).includes("local_business"), false);
  assert.equal(JSON.stringify(result).includes("Salon Management Software for More Bookings"), false);
  assert.match(JSON.stringify(result), /SalonFlow/);
  assert.equal(result.steps.some((step) => JSON.stringify(step).includes("PlanCraftAI")), false);
  assert.equal(result.fields.some((field) => field.question.includes("PlanCraftAI")), false);
  assert.equal(result.fields.some((field) => field.key === "usage_type"), false);
  assert.equal(result.steps.some((step) => step.id === "request-demo"), true);
});

test("short demo goal expands from Business Brain without inventing contact or demo data", () => {
  const result = generateWorkflow("Capture contact details and guide them to a demo.", [], {
    businessContext: {
      businessName: "Salon Management Software for More Bookings",
      businessType: "local_business",
      summary: "SalonFlow is salon software for online booking and client reminders.",
      services: [{ value: "Online booking" }, { value: "Client reminders" }],
      primaryGoal: "request_demo",
      approvedActions: [{ key: "request_demo", name: "Request a demo", actionType: "request_demo" }],
      discoveredCtas: [{ label: "Request a demo", url: "https://salonflow.example/demo" }],
      pricing: { verified: false },
    },
  });

  assert.equal(result.intent, "business_fit");
  assert.deepEqual(result.steps.map((step) => step.id), [
    "business-type",
    "main-goal",
    "current-software",
    "relevant-capabilities",
    "pricing",
    "integrations",
    "contact-name",
    "contact-email",
    "save-lead",
    "request-demo",
    "support-handoff",
  ]);
  assert.deepEqual(result.fields.map((field) => field.key), ["business_type", "main_goal", "current_software", "name", "email"]);
  assert.equal(result.fields.some((field) => field.key === "phone"), false);
  assert.equal(result.steps.find((step) => step.id === "save-lead")?.type, "create_lead");
  assert.equal(result.steps.find((step) => step.id === "request-demo")?.config?.actionKey, "request_demo");
  assert.equal(result.steps.find((step) => step.id === "request-demo")?.config?.destinationUrl, "https://salonflow.example/demo");
  assert.match(String(result.steps.find((step) => step.id === "contact-email")?.config?.generationReason), /Required for lead capture/);
  assert.match(String(result.steps.find((step) => step.id === "request-demo")?.config?.generationReason), /selected primary conversion action/);
  assert.ok(result.missingInformation?.some((item) => /pricing is not verified/i.test(item)));
});

test("missing demo context is surfaced instead of turning into a guessed URL", () => {
  const result = generateWorkflow("Capture contact details and guide them to a demo.", [], {
    businessContext: {
      businessName: "SalonFlow",
      businessType: "Salon",
      summary: "Salon software for bookings.",
      services: [{ value: "Online booking" }],
      pricing: { verified: true },
    },
  });
  const demoStep = result.steps.find((step) => step.type === "redirect");
  assert.equal(result.intent, "business_fit");
  assert.equal(demoStep?.config?.destinationUrl, undefined);
  assert.equal(demoStep?.config?.generationStatus, "missing");
  assert.match(String(demoStep?.config?.generationReason), /approve a demo action|verified destination/i);
  assert.doesNotMatch(JSON.stringify(result), /https?:\/\//);
});

test("workflow generation cache keys are tenant, workflow, action, and context scoped", () => {
  assert.equal(
    workflowGenerationCacheKey({
      organizationId: "org-1",
      businessId: "business-2",
      workflowId: "workflow-3",
      actionId: "action-4",
      contextVersion: 5,
    }),
    "workflow_generation_context:org-1:business-2:workflow-3:action-4:5",
  );
});
