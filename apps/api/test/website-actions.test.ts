import assert from "node:assert/strict";
import test from "node:test";
import { classifyVisitorRequest, defaultActionFlows, detectAction } from "../src/action-flows.js";
import { classifyPage, crawlPriority } from "../src/page-classification.js";
import { extractWebsiteActions } from "../src/website-actions.js";
import { primaryCtaForQuestion, primaryCtaIntroduction, shouldAttachPrimaryCta } from "../src/conversion-goals.js";
import type { ActionFlow } from "../src/action-flows.js";

test("page classification prioritizes conversion routes over blogs and carts", () => {
  assert.equal(classifyPage("https://example.test/request-a-demo", "Request a demo"), "demo");
  assert.equal(classifyPage("https://example.test/emergency-ac-repair", "Emergency repair"), "emergency");
  assert.equal(classifyPage("https://example.test/blog/news", "News"), "blog");
  assert.equal(classifyPage("https://example.test/cart", "Cart"), "cart");
  assert.ok(crawlPriority("https://example.test/emergency-ac-repair") > crawlPriority("https://example.test/blog/news"));
});

test("website action extraction records safe evidence and keeps uncertain candidates disabled", () => {
  const html = `
    <a href="/start">Request a demo</a>
    <a href="https://bookeo.com/example">Book a birthday</a>
    <a href="tel:+18005550199">24/7 Emergency Dentist Call</a>
    <form action="/contact"><button>Contact the team</button></form>
  `;
  const candidates = extractWebsiteActions(html, "https://dental.example.test/");
  assert.equal(candidates.find((item) => item.actionType === "request_demo")?.destination?.url, "https://dental.example.test/start");
  assert.equal(candidates.find((item) => item.actionType === "external_booking")?.provider, "bookeo.com");
  const emergency = candidates.find((item) => item.actionType === "call_emergency");
  assert.equal(emergency?.safetyPolicy, "healthcare_emergency");
  assert.equal(emergency?.enabled, true);
  assert.equal(extractWebsiteActions(`<a href="tel:(813)%20636-9400">Call</a>`, "https://example.test/").find((item) => item.actionType === "call_business")?.destination?.url, "tel:8136369400");
  assert.ok(candidates.every((item) => item.evidence.length > 0 && item.confidence > 0));
});

test("visitor request classification separates explanation from explicit action", () => {
  assert.equal(classifyVisitorRequest("How does booking work?").mode, "informational");
  assert.equal(classifyVisitorRequest("How does enrollment work?").mode, "informational");
  assert.equal(classifyVisitorRequest("What happens during a demo?").mode, "informational");
  assert.equal(classifyVisitorRequest("I need pricing").mode, "informational");
  assert.equal(classifyVisitorRequest("I need a quote").mode, "transactional");
  assert.equal(classifyVisitorRequest("Book me an appointment").mode, "transactional");
  assert.equal(classifyVisitorRequest("Sign my child up").mode, "transactional");
  assert.equal(classifyVisitorRequest("Try the demo").mode, "transactional");
  assert.equal(classifyVisitorRequest("I want a demo").actionIntent, "demo");
});

test("plan-selection requests route to a generated workflow before the primary lead action", () => {
  const planWorkflow = {
    id: "plan-workflow",
    key: "choose_plan",
    actionType: "contact_team",
    name: "Choose the right plan",
    description: "Help visitors choose a plan.",
    triggerPhrases: ["choose a plan"],
    triggerIntents: [],
    captureMode: "conversational",
    fields: [
      { id: "usage_type", key: "usage_type", label: "Usage type", type: "select", required: true, question: "Solo or team?" },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What is your goal?" },
      { id: "usage_level", key: "usage_level", label: "Usage level", type: "select", required: true, question: "How often?" },
    ],
    steps: [{ id: "usage-type", type: "capture", fieldKey: "usage_type" }],
    completion: { createLead: true, leadStatus: "new", message: "", notifyStaff: true },
    mode: "transactional",
    executionMode: "FORM_FLOW",
    attachmentPolicy: "explicit_request_only",
    trackingKey: "choose_plan",
    destination: null,
    provider: null,
    priority: 1,
    requiredFields: ["usage_type", "main_goal", "usage_level"],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: null,
    evidence: [],
    confidence: 1,
    enabled: true,
    lifecycleStatus: "active",
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  } as unknown as ActionFlow;
  const lead = { ...planWorkflow, id: "lead", key: "capture_lead", name: "Capture a lead", fields: [], steps: undefined, triggerPhrases: ["contact me"], requiredFields: [] } as ActionFlow;
  assert.equal(classifyVisitorRequest("I need help choosing a plan").actionIntent, "plan_selection");
  assert.equal(detectAction([lead, planWorkflow], "I need help choosing a plan", lead.id)?.id, planWorkflow.id);
});

test("business-fit statements start the workflow and guided demos outrank Try the demo", () => {
  const businessFit = {
    id: "business-fit",
    key: "business_fit",
    actionType: "contact_team",
    name: "SalonFlow fit",
    description: "Help visitors understand fit.",
    triggerPhrases: [],
    triggerIntents: [],
    captureMode: "conversational",
    fields: [
      { id: "business_type", key: "business_type", label: "Business type", type: "select", required: true, question: "What kind of business do you run?", options: ["Small salon", "Salon", "Spa"] },
      { id: "main_goal", key: "main_goal", label: "Main goal", type: "select", required: true, question: "What are you trying to improve?", options: ["Online booking", "Online booking + reminders", "Reminders"] },
    ],
    steps: [{ id: "business-type", type: "capture", fieldKey: "business_type" }],
    completion: { createLead: true, leadStatus: "new", message: "", notifyStaff: true },
    mode: "transactional",
    executionMode: "FORM_FLOW",
    attachmentPolicy: "explicit_request_only",
    trackingKey: "business_fit",
    destination: null,
    provider: null,
    priority: 1,
    requiredFields: ["business_type", "main_goal"],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: null,
    evidence: [],
    confidence: 1,
    enabled: true,
    lifecycleStatus: "active",
    createdAt: "2026-11-21T00:00:00.000Z",
    updatedAt: "2026-11-21T00:00:00.000Z",
  } as unknown as ActionFlow;
  const lead = { ...businessFit, id: "lead", key: "capture_lead", name: "Capture a lead", fields: [], steps: undefined, triggerPhrases: ["contact me"], requiredFields: [] } as ActionFlow;
  assert.equal(detectAction([lead, businessFit], "I run a small salon and I'm looking for software", lead.id)?.id, businessFit.id);

  const tryDemo = {
    ...lead,
    id: "try-demo",
    key: "try_demo",
    name: "Try the demo",
    actionType: "open_link",
    triggerPhrases: ["try the demo"],
    triggerIntents: ["demo"],
    executionMode: "DIRECT_LINK",
    completion: { ...lead.completion, createLead: false, linkUrl: "https://example.test/start", linkLabel: "Try the demo" },
    destination: { url: "https://example.test/start", label: "Try the demo" },
  } as unknown as ActionFlow;
  const configuredPrimary = {
    ...tryDemo,
    id: "configured-primary",
    key: "try_demo",
    triggerPhrases: ["software"],
  } as unknown as ActionFlow;
  assert.equal(detectAction([configuredPrimary, businessFit], "I run a small salon and I'm looking for software", configuredPrimary.id)?.id, businessFit.id);
  const requestDemo = {
    ...tryDemo,
    id: "request-demo",
    key: "request_demo",
    name: "Request a demo",
    actionType: "request_demo",
    triggerPhrases: ["request a demo"],
    executionMode: "FORM_FLOW",
    fields: [{ id: "email", key: "email", label: "Email", type: "email", required: true, question: "What email should we use?" }],
    completion: { ...lead.completion, createLead: true, linkUrl: undefined, linkLabel: undefined },
    destination: null,
  } as unknown as ActionFlow;
  assert.equal(detectAction([tryDemo, requestDemo], "Can someone give me a demo and walk me through it?", tryDemo.id)?.id, requestDemo.id);
});

test("demo actions are created from evidence and do not trigger on explanatory questions", () => {
  const candidates = extractWebsiteActions('<a href="/start">Try the demo</a>', "https://example.test/");
  const actions = defaultActionFlows("Example SaaS", "website and online booking", (key) => key, candidates);
  const demo = actions.find((action) => action.actionType === "request_demo");
  assert.equal(demo?.destination?.url, "https://example.test/start");
  assert.equal(demo?.executionMode, "DIRECT_LINK");
  assert.equal(demo?.attachmentPolicy, "sales_intent");
  assert.deepEqual(demo?.triggerIntents, []);
  assert.ok(demo?.triggerPhrases.includes("try the demo"));
  assert.equal(demo?.origin, "discovered");
  assert.equal(demo?.lifecycleStatus, "needs_review");
  assert.equal(demo?.enabled, false);
  assert.equal(detectAction(actions, "What happens during a demo?"), null);
  assert.equal(detectAction(actions, "I want a demo"), null);
  demo!.enabled = true;
  demo!.lifecycleStatus = "approved";
  assert.equal(detectAction(actions, "Try the demo")?.actionType, "request_demo");
  assert.equal(detectAction(actions, "Book a demo"), null);
});

test("generic classes do not create a cross-tenant swim enrollment action", () => {
  const actions = defaultActionFlows(
    "Munchkin Town",
    "open play, birthday parties, memberships, and classes for children",
    (key) => key,
  );
  assert.equal(actions.some((action) => action.key === "enroll_child"), false);
});

test("action registry lifecycle controls runtime availability and primary precedence", () => {
  const candidates = extractWebsiteActions('<a href="/demo">Request a demo</a><a href="/book">Book now</a>', "https://example.test/");
  const actions = defaultActionFlows("Example SaaS", "demo and booking", (key) => key, candidates);
  const discovered = actions.find((action) => action.actionType === "request_demo");
  assert.ok(discovered);
  assert.equal(discovered.enabled, false);
  assert.equal(detectAction(actions, "I want a demo"), null);

  discovered.enabled = true;
  discovered.lifecycleStatus = "approved";
  const configured = {
    ...discovered,
    id: "configured-primary",
    key: "request_demo_owner",
    origin: "configured" as const,
    lifecycleStatus: "active" as const,
    triggerPhrases: ["demo"],
  };
  actions.push(configured);
  assert.equal(detectAction(actions, "I want a demo", configured.id)?.id, configured.id);

  configured.enabled = false;
  configured.lifecycleStatus = "disabled";
  assert.equal(detectAction(actions, "I want a demo", configured.id)?.id, discovered.id);

  discovered.enabled = false;
  discovered.lifecycleStatus = "disabled";
  assert.equal(detectAction(actions, "I want a demo"), null);
});

test("sales-intent CTA policy excludes privacy, support, and anti-sales questions", () => {
  const action = {
    id: "try-demo",
    key: "request_demo",
    name: "Try the Demo",
    actionType: "request_demo",
    description: "Try SalonFlow.",
    triggerPhrases: ["try the demo"],
    triggerIntents: ["demo"],
    captureMode: "hybrid",
    fields: [],
    completion: { createLead: true, leadStatus: "qualified", message: "", notifyStaff: true, linkUrl: "https://www.salonflow.studio/start", linkLabel: "Try the Demo" },
    mode: "transactional",
    executionMode: "DIRECT_LINK",
    attachmentPolicy: "sales_intent",
    trackingKey: "salonflow_try_demo",
    destination: { url: "https://www.salonflow.studio/start", label: "Try the Demo" },
    provider: null,
    priority: 880,
    requiredFields: [],
    enabled: true,
    lifecycleStatus: "active",
  } as ActionFlow;
  assert.equal(shouldAttachPrimaryCta(action, "What does SalonFlow do?", "services"), false);
  assert.equal(shouldAttachPrimaryCta(action, "What's pricing?", "pricing"), false);
  assert.equal(shouldAttachPrimaryCta(action, "How do I get started?", "getting_started"), false);
  assert.equal(shouldAttachPrimaryCta(action, "I want to try the demo.", "general"), true);
  assert.equal(shouldAttachPrimaryCta(action, "Do you sell my data?", "privacy"), false);
  assert.equal(shouldAttachPrimaryCta(action, "I need account help", "support"), false);
  assert.equal(shouldAttachPrimaryCta(action, "I hate sales calls", "general"), false);
  assert.equal(shouldAttachPrimaryCta(action, "Book a demo", "booking"), false);
  assert.equal(primaryCtaForQuestion({ primaryActionId: action.id, actions: [action] }, "What's pricing?", "pricing"), null);
  assert.deepEqual(primaryCtaForQuestion({ primaryActionId: action.id, actions: [action] }, "I want to try the demo.", "general"), {
    actionId: "try-demo",
    key: "request_demo",
    label: "Try the Demo",
    executionMode: "DIRECT_LINK",
    trackingKey: "salonflow_try_demo",
    url: "https://www.salonflow.studio/start",
  });
  const cta = primaryCtaForQuestion({ primaryActionId: action.id, actions: [action] }, "I want to try the demo.", "general");
  assert.equal(primaryCtaIntroduction(cta, "pricing"), "Want to see how it works in practice?");
  assert.equal(primaryCtaIntroduction(cta, "services"), "You can explore these features in the live demo.");
  assert.equal(primaryCtaIntroduction(cta, "getting_started"), "The fastest way to get started is to try the demo.");
  assert.equal(primaryCtaIntroduction(cta, "privacy"), null);
  assert.equal(primaryCtaForQuestion({ primaryActionId: action.id, actions: [action] }, "Book a demo", "booking"), null);
});
