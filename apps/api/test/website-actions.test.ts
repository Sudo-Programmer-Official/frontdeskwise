import assert from "node:assert/strict";
import test from "node:test";
import { classifyVisitorRequest, defaultActionFlows, detectAction } from "../src/action-flows.js";
import { classifyPage, crawlPriority } from "../src/page-classification.js";
import { extractWebsiteActions } from "../src/website-actions.js";

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

test("demo actions are created from evidence and do not trigger on explanatory questions", () => {
  const candidates = extractWebsiteActions('<a href="/start">Try the demo</a>', "https://example.test/");
  const actions = defaultActionFlows("Example SaaS", "website and online booking", (key) => key, candidates);
  const demo = actions.find((action) => action.actionType === "request_demo");
  assert.equal(demo?.destination?.url, "https://example.test/start");
  assert.equal(demo?.executionMode, "DIRECT_LINK");
  assert.equal(demo?.attachmentPolicy, "sales_intent");
  assert.equal(demo?.origin, "discovered");
  assert.equal(demo?.lifecycleStatus, "needs_review");
  assert.equal(demo?.enabled, false);
  assert.equal(detectAction(actions, "What happens during a demo?"), null);
  assert.equal(detectAction(actions, "I want a demo"), null);
  demo!.enabled = true;
  demo!.lifecycleStatus = "approved";
  assert.equal(detectAction(actions, "I want a demo")?.actionType, "request_demo");
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
