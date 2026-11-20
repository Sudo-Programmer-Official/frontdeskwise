import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseRoute, routePath, routeView } from "../src/router/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = await readFile(resolve(here, "../src/App.vue"), "utf8");
const agent = await readFile(resolve(here, "../src/AgentExperience.vue"), "utf8");
const styles = await readFile(resolve(here, "../src/styles.css"), "utf8");
const feedback = await readFile(resolve(here, "../src/AppFeedback.vue"), "utf8");
const widget = await readFile(resolve(here, "../public/widget.js"), "utf8");
const router = await readFile(resolve(here, "../src/router/index.ts"), "utf8");
const marketing = JSON.parse(await readFile(resolve(here, "../src/marketing-pages.json"), "utf8"));
const marketingComponent = await readFile(resolve(here, "../src/MarketingPage.vue"), "utf8");
const metadataScript = await readFile(resolve(here, "../scripts/generate-site-metadata.mjs"), "utf8");

test("owner production controls remain present", () => {
  const ownerSurface = `${app}\n${agent}`;
  for (const control of [
    "/knowledge/sources/",
    "/leads/",
    "/integrations/",
    "/widget/verify",
    "Check installation",
    "Export CSV",
    "Actions",
    "Integrations",
    "settingsTabs",
    "profile-menu",
    "Test & connect securely",
    "Review tool access",
  ]) {
    assert.ok(ownerSurface.includes(control), `missing owner control: ${control}`);
  }
  assert.match(app, /const navSections/);
  assert.match(app, /label: "Customers"/);
  assert.match(app, /label: "AI front desk"/);
  assert.match(app, /label: "Business"/);
  assert.match(app, /Your AI front desk is ready/);
  assert.match(app, /sidebar-account/);
  assert.match(app, /agent-tabs/);
  assert.doesNotMatch(app, /Preview ↗/);
  assert.doesNotMatch(app, />Edit agent</);
  assert.doesNotMatch(app, /id: "conversations", label: "Conversations"/);
  assert.doesNotMatch(app, /id: "billing", label: "Billing", icon:/);
});

test("owner UI uses the shared product design language", () => {
  assert.match(styles, /font-family:[^;]*Inter/);
  assert.match(styles, /select option\s*\{/);
  assert.match(styles, /mobile-preview/);
  assert.match(agent, /aria-label="Widget preview"|Customer view/);
});

test("landing page presents an honest, conversion-ready product story", () => {
  for (const marker of [
    "Illustrative sample flow",
    "landing-flow-shell",
    "landingSampleMetrics",
    "landingFaqs",
    "Answer grounded in approved knowledge",
    "Create your workspace",
  ]) {
    assert.ok(app.includes(marker), `missing landing experience marker: ${marker}`);
  }
  assert.doesNotMatch(app, /featured-demo-links/);
  assert.doesNotMatch(app, /0 leads in sample workspace|0 booking actions/);
  assert.match(styles, /landing-industry-drift/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("unfinished internal implementation language is not rendered in owner UI", () => {
  assert.doesNotMatch(app, />Human handoff</i);
  assert.doesNotMatch(app, />Model routing</i);
  assert.doesNotMatch(app, /placeholder metrics/i);
});

test("embedded widget uses the responsive conversation shell", () => {
  for (const feature of [
    "mode-expanded",
    "mode-fullscreen",
    "widgetQuickActions",
    "aria-label=\"Expand assistant\"",
    "100dvh",
    "View source ↗",
    "proactiveTriggers",
    "frontdeskwise:visitor:",
    "lead-consent",
  ]) {
    assert.ok(widget.includes(feature), `missing widget shell feature: ${feature}`);
  }
});

test("application navigation is route-driven and refresh-safe", () => {
  for (const marker of [
    'segments[0] === "auth"',
    'segments[0] === "demo"',
    'segments[0] === "onboarding"',
    'segments[0] === "platform"',
    'segments[0] === "app"',
    '"organization-detail"',
    '"business-detail"',
    '"notifications"',
  ]) {
    assert.ok(router.includes(marker), `missing route contract: ${marker}`);
  }
  assert.match(router, /export function parseRoute/);
  assert.match(router, /export function routePath/);
  assert.match(app, /const route = ref<AppRoute>\(parseRoute\(\)\)/);
  assert.match(app, /window\.history\[replace \? "replaceState" : "pushState"\]/);
  assert.match(app, /window\.addEventListener\("popstate", handleRouteChange\)/);
  assert.match(app, /Keep control-plane and onboarding deep links stable/);
});

test("public SEO routes are unique, indexable, and statically packaged", () => {
  assert.ok(marketing.length >= 25, "expected a meaningful first SEO content cluster");
  const paths = new Set();
  for (const page of marketing) {
    assert.ok(page.path.startsWith("/"), `invalid marketing path: ${page.path}`);
    assert.ok(!paths.has(page.path), `duplicate marketing path: ${page.path}`);
    paths.add(page.path);
    const parsed = parseRoute({ pathname: page.path, search: "" });
    assert.equal(parsed.kind, "marketing");
    assert.equal(routePath(parsed), page.path);
    assert.ok(page.title && page.description && page.intro, `missing SEO content for ${page.path}`);
  }
  assert.match(marketingComponent, /marketing-page-faq-list/);
  assert.match(marketingComponent, /Calculate readiness score/);
  assert.match(metadataScript, /sitemap\.xml/);
  assert.match(metadataScript, /Disallow: \/app\//);
});

test("application feedback is visible for async work and notifications", () => {
  assert.match(app, /trackedFetch/);
  assert.match(app, /runWithGlobalLoading/);
  assert.match(app, /notification-badge/);
  assert.match(app, /<AppFeedback/);
  assert.match(feedback, /app-loading-spinner/);
  assert.match(feedback, /app-toast-region/);
  assert.match(styles, /app-loading-overlay/);
  assert.match(styles, /notification-trigger/);
});

test("all Agent tabs keep the Agent shell on direct URLs and refresh", () => {
  for (const tab of ["behavior", "appearance", "quick-actions", "test", "install"]) {
    const pathname = `/app/british-swim-school-tampa-bay/agent/${tab}`;
    const route = parseRoute({ pathname, search: "" });
    assert.equal(routeView(route), "agent");
    assert.equal(routePath(route), pathname);
    assert.equal(route.kind, "workspace");
    assert.equal(route.agentTab, tab);
  }

  const legacyTestRoute = parseRoute({ pathname: "/app/british-swim-school-tampa-bay/conversations", search: "" });
  assert.equal(routeView(legacyTestRoute), "agent");
  assert.equal(routePath(legacyTestRoute), "/app/british-swim-school-tampa-bay/agent/test");
});

test("Agent experience exposes one stable tab strip and customer-facing test flow", () => {
  for (const label of ["Behavior", "Appearance", "Quick actions", "Test", "Install"]) {
    assert.ok(app.includes(`label: "${label}"`) || app.includes(`{{ tab.label }}`) && app.includes(label), `missing Agent tab: ${label}`);
  }
  assert.match(app, /AgentExperience/);
  assert.match(app, /view === 'agent'/);
  assert.match(agent, /Test what customers will experience/);
  assert.match(agent, /Test lead captured/);
  assert.doesNotMatch(agent, /<h2>Capture a lead<\/h2>/);
});

test("Install keeps verification and platform guidance in the Agent flow", () => {
  for (const marker of [
    "Start verification",
    "Check now",
    "verificationInstructions",
    "Choose your platform",
    "installPlatform",
    "installInstructions",
    "Publish AI front desk",
  ]) {
    assert.ok(agent.includes(marker), `missing Install workflow marker: ${marker}`);
  }
  assert.match(app, /@start-verification="startAgentVerification"/);
  assert.match(app, /@check-verification="checkOwnershipVerification"/);
});

test("Actions uses a progressive conversion-flow builder", () => {
  for (const marker of [
    "Quick-start templates",
    "Create an action",
    "action-flow-stepper",
    "AI intent detection",
    "Live customer preview",
    "Drag the ≡ handle to reorder",
    "Delivery history",
    "Capture",
  ]) {
    assert.ok(app.includes(marker), `missing Actions builder marker: ${marker}`);
  }

  const actionsRoute = parseRoute({ pathname: "/app/british-swim-school-tampa-bay/actions", search: "" });
  assert.equal(routeView(actionsRoute), "actions");
  assert.equal(routePath(actionsRoute), "/app/british-swim-school-tampa-bay/actions");
  assert.doesNotMatch(app, /actionDraft && false/);
});
