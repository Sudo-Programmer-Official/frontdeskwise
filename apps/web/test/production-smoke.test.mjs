import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseRoute, routePath, routeView } from "../src/router/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const app = await readFile(resolve(here, "../src/App.vue"), "utf8");
const agent = await readFile(resolve(here, "../src/AgentExperience.vue"), "utf8");
const widgetPreview = await readFile(resolve(here, "../src/components/WidgetPreview.vue"), "utf8");
const workflowWorkspace = await readFile(resolve(here, "../src/components/WorkflowWorkspace.vue"), "utf8");
const workflowGenerator = await readFile(resolve(here, "../src/workflow-generator.ts"), "utf8");
const widgetRenderer = await readFile(resolve(here, "../src/widget-ui/renderer.ts"), "utf8");
const markdownRenderer = await readFile(resolve(here, "../src/widget-ui/markdown.ts"), "utf8");
const widgetEmbed = await readFile(resolve(here, "../src/widget-embed.ts"), "utf8");
const widgetLoader = await readFile(resolve(here, "../src/widget-loader.ts"), "utf8");
const styles = await readFile(resolve(here, "../src/styles.css"), "utf8");
const feedback = await readFile(resolve(here, "../src/AppFeedback.vue"), "utf8");
const widget = await readFile(resolve(here, "../public/widget.js"), "utf8");
const widgetShell = await readFile(resolve(here, "../public/widget-shell.js"), "utf8");
const router = await readFile(resolve(here, "../src/router/index.ts"), "utf8");
const marketing = JSON.parse(await readFile(resolve(here, "../src/marketing-pages.json"), "utf8"));
const marketingComponent = await readFile(resolve(here, "../src/MarketingPage.vue"), "utf8");
const metadataScript = await readFile(resolve(here, "../scripts/generate-site-metadata.mjs"), "utf8");
const index = await readFile(resolve(here, "../index.html"), "utf8");
const apiServer = await readFile(resolve(here, "../../api/src/server.ts"), "utf8");

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
    "Answer sources",
    "Show answer sources",
    "When helpful",
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
  assert.match(widgetPreview, /class="preview-website-frame"/);
  assert.match(widgetPreview, /@load="markWebsitePreviewReady"/);
  assert.match(widgetRenderer, /Powered by/);
  assert.match(widgetRenderer, /fdw-status-dot/);
  assert.match(widgetPreview, /createWidgetRenderer/);
  assert.match(widgetRenderer, /@container fdw-preview/);
  assert.match(widgetPreview, /scenarioOptions/);
  assert.doesNotMatch(widgetPreview, /service-card|pricing-card|get-started|preview-form-simulation|preview-chat/);
  assert.doesNotMatch(agent, /test-thread|test-action-form|test-composer/);
  assert.match(markdownRenderer, /markdownToSafeHtml/);
  assert.match(styles, /font-weight: 500; line-height: 1\.35/);
  assert.match(styles, /team-row \.lead-name > span:last-child/);
  assert.match(app, /class="field-label">Name <span class="optional">Optional/);
  assert.match(app, /from "@lucide\/vue"/);
  assert.match(app, /from "simple-icons"/);
  assert.match(app, /class="provider-logo"/);
  assert.match(app, /<component :is="item\.icon"/);
  assert.doesNotMatch(app, /icon: "[⌂✉♧◒▤ϟ✦▦⚙⌁]"/);
});

test("landing page presents an honest, conversion-ready product story", () => {
  for (const marker of [
    "Live illustrative flow",
    "Built to answer, qualify, act, and hand off.",
    "landing-flow-shell",
    "landingSampleMetrics",
    "landingFaqs",
    "Create your workspace",
  ]) {
    assert.ok(app.includes(marker), `missing landing experience marker: ${marker}`);
  }
  assert.doesNotMatch(app, /landing-capability-demo|Higher conversions|Less manual work|Happier customers/);
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
    "citationVisibility",
    "proactiveTriggers",
    "frontdeskwise:visitor:",
    "lead-consent",
    "Powered by FrontDeskWise",
    "powered-by",
    "subtitle-text",
    "Thinking…",
    "fdw-typing-dot",
  ]) {
    assert.ok(`${widget}\n${widgetRenderer}\n${widgetEmbed}`.includes(feature), `missing widget shell feature: ${feature}`);
  }
  assert.match(widgetRenderer, /fdw-typing/);
  assert.match(widgetRenderer, /fdw-preview-root/);
});

test("lazy-loaded widget shell restores hit testing after launcher handoff", () => {
  assert.match(widgetRenderer, /\.fdw-embed-root \{ pointer-events: auto; \}/);
  assert.match(widgetShell, /fdw-embed-root \{ pointer-events: auto; \}/);
});

test("production proactive engagement carries bootstrap settings into the live widget path", () => {
  const embed = `${widget}\n${widgetEmbed}\n${widgetLoader}`;
  for (const marker of [
    "loader_downloaded",
    "proactiveEnabled: agent.proactiveEnabled === true",
    "proactiveDelaySeconds: Number(agent.proactiveDelaySeconds || 20)",
    "proactiveTriggers: Array.isArray(agent.proactiveTriggers)",
    "proactiveBehavior: agent.proactiveBehavior === \"open\" ? \"open\" : \"teaser\"",
    "proactiveFrequency: agent.proactiveFrequency === \"24h\"",
    "cache: \"no-store\"",
    "window.pageYOffset || 0",
    "documentElement?.scrollTop || 0",
    "body?.scrollTop || 0",
    "event.relatedTarget",
    "hasActiveHandoff()",
    "if (!conversationId) return false;",
    "let userOpened = false;",
  ]) {
    assert.ok(embed.includes(marker), `missing proactive runtime contract: ${marker}`);
  }
  assert.match(apiServer, /proactive_behavior = excluded\.proactive_behavior/);
  assert.match(apiServer, /proactive_frequency = excluded\.proactive_frequency/);
  assert.match(apiServer, /Cache-Control", "public, max-age=60, stale-while-revalidate=300/);
  assert.match(apiServer, /const entityTag =/);
});

test("widget installation supports optional path scoping", () => {
  assert.match(widgetLoader, /parseWidgetPagePatterns/);
  assert.match(widgetLoader, /widgetPageMatches/);
  assert.match(widgetLoader, /script\.dataset\.pages/);
  assert.match(widgetLoader, /window\.location\.pathname/);
  assert.match(widgetLoader, /api\.frontdeskwise\.com/);
  assert.match(widgetLoader, /configuredApiOrigin/);
  assert.match(widget, /dataset\.pages/);
  assert.match(apiServer, /data-site=\"\$\{business\.widget\.siteKey\}\"/);
  assert.match(apiServer, /data-shell/);
  assert.match(apiServer, /https:\/\/api\.frontdeskwise\.com/);
});

test("active production widget state cannot be closed by stale updates or form rerenders", () => {
  const rendererSource = `${widgetRenderer}\n${widget}`;
  const embedSource = `${widgetEmbed}\n${widget}`;
  for (const marker of [
    "openedByUser",
    "onOpen: (source, userInitiated = true)",
    "state = { ...state, isOpen: true",
    "actionValues",
    "onActionValuesChange",
    "actionForm.addEventListener(\"input\", rememberActionValues)",
    "actionForm.addEventListener(\"change\", rememberActionValues)",
    "sessionStorage",
    "if (state.isOpen && patch.state.isOpen === false)",
  ]) {
    assert.ok(`${rendererSource}\n${embedSource}`.includes(marker), `missing sticky widget-state contract: ${marker}`);
  }
  assert.doesNotMatch(`${rendererSource}\n${embedSource}`, /document\.addEventListener\(["'](?:click|pointerdown|touchstart)/);
  assert.doesNotMatch(`${rendererSource}\n${embedSource}`, /window\.addEventListener\(["'](?:blur|visibilitychange|resize)/);
});

test("widget preserves visitor messages through send and history reconciliation", () => {
  assert.match(widgetEmbed, /addMessage\(question, "user"/);
  assert.match(widgetEmbed, /pendingLocalMessages = state\.messages\.filter/);
  assert.match(widgetEmbed, /messages: \[\.\.\.hydratedMessages, \.\.\.pendingLocalMessages/);
  assert.match(widgetEmbed, /resetConversationUi\(pendingMessage\)/);
  assert.match(widgetEmbed, /id = message\.id \|\|/);
  assert.match(widgetRenderer, /message\.role === "user"/);
  assert.match(widgetRenderer, /precedingMessage = state\.messages\.at\(-2\)/);
});

test("embedded widget keeps knowledge gaps optional and exposes contact action", () => {
  assert.match(widgetEmbed, /updateState\(\{ quickActions: \[\], leadVisible: false/);
  assert.match(widgetEmbed, /leadCaptured: true, leadVisible: false/);
  assert.match(widgetEmbed, /if \(!leadCaptured && !answer\.grounded/);
  assert.match(widgetEmbed, /!answer\.grounded && !answer\.action && !\(answer\.quickActions && answer\.quickActions\.length\)/);
  assert.match(widgetEmbed, /updateState\(\{[^}]*typing: true/);
  assert.match(widgetEmbed, /MESSAGE_CONTEXT_TIMEOUT_MS = 4_000/);
  assert.match(widgetEmbed, /Working on that…/);
  assert.match(widgetEmbed, /Still working…/);
  assert.match(widgetRenderer, /typingMessage = state\.typingMessage \|\| "Thinking…"/);
});

test("embedded widget handoff notice is temporary, dismissible, and session-scoped", () => {
  assert.match(widgetRenderer, /fdw-handoff-dismiss/);
  assert.match(widgetEmbed, /HANDOFF_NOTICE_TIMEOUT_MS = 6000/);
  assert.match(widgetEmbed, /frontdeskwise:handoff-dismissed:/);
  assert.match(widgetEmbed, /if \(!handoffWaiting\)/);
  assert.match(widgetRenderer, /onHandoffDismiss/);
  assert.match(widgetEmbed, /window\.sessionStorage\.setItem\(key, "1"\)/);
  assert.match(widgetRenderer, /Team member joined/);
  assert.match(widgetEmbed, /hideHandoffNotice\(\);/);
});

test("widget header and live polling follow the canonical conversation status", () => {
  const source = `${widgetRenderer}\n${widgetEmbed}\n${widgetShell}`;
  assert.match(source, /status === "HUMAN_ACTIVE"\) subtitleText\.textContent = "Team member joined"/);
  assert.match(source, /AI assistant online/);
  assert.doesNotMatch(source, /status === "HUMAN_ACTIVE" \|\| status === "AI_ASSISTED"/);
  assert.match(widgetEmbed, /conversations\/\$\{encodeURIComponent\(conversationId\)\}\/status/);
  assert.match(widgetEmbed, /startPolling\(\);/);
  assert.match(widgetEmbed, /if \(pollTimer !== null \|\| !state\.isOpen \|\| !conversationId\) return/);
  assert.match(widgetEmbed, /updatedAt \|\| payload\.conversation\?\.lastActivityAt/);
});

test("Inbox takeover and handoff notifications keep their contracts explicit", () => {
  assert.match(app, /headers: \{ \.\.\.\(body \?/);
  assert.match(app, /globalLoading: false/);
  assert.match(app, /\/conversations\/\$\{conversation\.id\}\/read/);
  assert.match(app, /const inboxPageSize = 50/);
  assert.match(app, /class="collection-pagination"/);
  assert.match(app, /loadInbox\(inboxPage - 1\)/);
  assert.match(app, /notification-settings/);
  assert.match(app, /Save handoff alerts/);
  assert.match(app, /Staff only/);
  assert.match(styles, /conversation-inbox-grid \.table-row-button/);
  assert.match(styles, /\.collection-viewport/);
  assert.match(styles, /max-height: min\(560px, calc\(100vh - 470px\)\)/);
  assert.match(styles, /-webkit-line-clamp: 2/);
  assert.match(apiServer, /const limit = Math\.min\(100/);
  assert.match(apiServer, /pagination: \{ page, pageSize: limit, total/);
});

test("Inbox exposes deterministic workflow state and lead qualification context", () => {
  assert.match(app, /interface WorkflowSummary/);
  assert.match(app, /workflow-floating-card/);
  assert.match(app, /nextBestAction/);
  assert.match(app, /lead-qualification-card/);
  assert.match(apiServer, /workflowSummary\(action, actionState\)/);
  assert.match(apiServer, /providerObjectId/);
  assert.match(apiServer, /workflowProgressPercent/);
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

test("Stripe checkout keeps the webhook-authoritative success journey visible", () => {
  const successRoute = parseRoute({ pathname: "/app/settings/billing/success", search: "?session_id=cs_test_123" });
  assert.deepEqual(successRoute, { kind: "billing-success", sessionId: "cs_test_123" });
  assert.equal(routeView(successRoute), "billing");
  assert.equal(routePath(successRoute), "/app/settings/billing/success?session_id=cs_test_123");
  assert.match(apiServer, /app\/settings\/billing\/success\?session_id=\{CHECKOUT_SESSION_ID\}/);
  assert.match(apiServer, /app\.post\("\/api\/v1\/billing\/events"/);
  assert.match(apiServer, /activationEmailQueuedAt/);
  assert.match(app, /billingSuccessState/);
  assert.match(app, /billingSuccessState === 'active'/);
  assert.match(app, /billing\?\.status === "active" && billing\.planKey === expectedPlanKey/);
  assert.match(app, /subscription_success_screen_viewed/);
  assert.match(app, /frontdeskwise:billing-success-toast/);
  assert.match(app, /Your \{\{ billingSuccessPlanName \}\} plan is now active/);
});

test("responsive shell and auth recovery contracts are present", () => {
  assert.match(index, /name="viewport" content="width=device-width, initial-scale=1(?:\.0)?"/);
  for (const marker of [
    "mobile-header",
    "mobile-nav-backdrop",
    "mobile-nav-open",
    "inbox-detail-open",
    "env(safe-area-inset-top)",
    "env(safe-area-inset-bottom)",
    "@media (max-width: 1023px)",
    "@media (max-width: 640px)",
    "width: min(86vw, 360px)",
    "grid-template-columns: 1fr",
  ]) {
    assert.ok(styles.includes(marker), `missing responsive contract: ${marker}`);
  }
  assert.match(app, /<Menu/);
  assert.match(app, /aria-controls="mobile-navigation-drawer"/);
  assert.match(app, /handleMobileNavKeydown/);
  assert.match(app, /document\.body\.style\.overflow = "hidden"/);
  assert.match(app, /Back to Inbox/);
  assert.match(app, /confirmFrontDeskWisePasswordReset/);
  assert.match(app, /auth-success/);
  assert.doesNotMatch(app, /authError\.value = "Password reset instructions sent/);
  const resetRoute = parseRoute({ pathname: "/auth/reset-password", search: "?mode=resetPassword&oobCode=example-code" });
  assert.deepEqual(resetRoute, { kind: "auth-reset", mode: "resetPassword", oobCode: "example-code" });
  assert.equal(routePath(resetRoute), "/auth/reset-password?mode=resetPassword&oobCode=example-code");
});

test("invalid sessions refresh once and preserve the deep return route", () => {
  const returnTo = "/app/plancraftai-ajg8l/agent/install";
  const signInRoute = parseRoute({ pathname: "/auth/sign-in", search: `?returnTo=${encodeURIComponent(returnTo)}` });
  assert.deepEqual(signInRoute, { kind: "auth", mode: "signin", returnTo });
  assert.equal(routePath(signInRoute), `/auth/sign-in?returnTo=${encodeURIComponent(returnTo)}`);

  const unsafeRoute = parseRoute({ pathname: "/auth/sign-in", search: "?returnTo=https%3A%2F%2Fevil.example" });
  assert.deepEqual(unsafeRoute, { kind: "auth", mode: "signin" });
  assert.match(app, /currentFirebaseToken\(true\)/);
  assert.match(app, /refreshRetryCompleted/);
  assert.match(app, /function redirectToSignIn/);
  assert.match(app, /const authInitializing = ref/);
  assert.doesNotMatch(app, /auth-initializing-spinner|<LoaderCircle/);
  assert.doesNotMatch(app, /Your session may have expired/);
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
  assert.match(app, /:loading="!authInitializing && \(globalLoading \|\| authLoading\)"/);
  assert.match(feedback, /app-loading-spinner/);
  assert.match(feedback, /app-toast-region/);
  assert.match(styles, /app-loading-overlay/);
  assert.match(styles, /notification-trigger/);
});

test("Agent Test keeps conversation loading local to the chat thread", () => {
  assert.match(app, /const testMessages = ref<TestConversationMessage\[\]>/);
  assert.match(app, /function conversationFetch\(/);
  assert.match(app, /globalLoading: false/);
  assert.match(app, /testMessages\.value\.push\(\{\s*id: testMessageId\("user"\)/);
  assert.match(agent, /testWidgetState/);
  assert.match(agent, /createWidgetRenderer|<WidgetPreview/);
  assert.match(agent, /sessionHasGroundedAnswer/);
  assert.match(agent, /sessionHasCompletedAction/);
  assert.match(agent, /submit-action/);
  assert.match(agent, /@submit-action="submitPreviewAction"/);
});

test("all Agent tabs keep the Agent shell on direct URLs and refresh", () => {
  for (const tab of ["capabilities", "behavior", "appearance", "quick-actions", "test", "install"]) {
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

  const questionRoute = parseRoute({ pathname: "/app/plancraftai-ajg8l/agent/test", search: "?q=What%20are%20your%20business%20hours" });
  assert.equal(questionRoute.kind, "workspace");
  assert.equal(questionRoute.testQuestion, "What are your business hours");
  assert.equal(routePath(questionRoute), "/app/plancraftai-ajg8l/agent/test?q=What%20are%20your%20business%20hours");
});

test("Agent experience exposes one stable tab strip and customer-facing test flow", () => {
  for (const label of ["Capabilities", "Behavior", "Appearance", "Quick actions", "Test", "Install"]) {
    assert.ok(app.includes(`label: "${label}"`) || app.includes(`{{ tab.label }}`) && app.includes(label), `missing Agent tab: ${label}`);
  }
  assert.match(app, /AgentExperience/);
  assert.match(app, /view === 'agent'/);
  assert.match(agent, /Test what customers will experience/);
  assert.match(agent, /Test lead captured/);
  assert.match(agent, /What your AI front desk can do/);
  assert.match(agent, /Where connections live/);
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
  assert.match(app, /<div v-else-if="view === 'overview'" class="view-content">/);
  assert.match(app, /if \(payload\.verification\?\.status === "verified"\) await loadWidgetInstall\(\);/);
});

test("Actions uses a progressive conversion-flow builder", () => {
  for (const marker of [
    "Quick-start templates",
    "Create an action",
    "Primary conversion goal",
    "Choose a primary goal",
    "Change goal",
    "Destination URL",
    "Customer-facing copy",
    "Button label",
    "Message before button",
    "I’d like to",
    "Current primary",
    "action-flow-stepper",
    "AI intent detection",
    "Live customer preview",
    "Drag the ≡ handle to reorder",
    "Delivery history",
    "Capture",
    "Test flow",
    "runActionTest",
  ]) {
    assert.ok(app.includes(marker), `missing Actions builder marker: ${marker}`);
  }

  const actionsRoute = parseRoute({ pathname: "/app/british-swim-school-tampa-bay/actions", search: "" });
  assert.equal(routeView(actionsRoute), "actions");
  assert.equal(routePath(actionsRoute), "/app/british-swim-school-tampa-bay/actions");
  assert.doesNotMatch(app, /actionDraft && false/);
});

test("Workflows exposes an owner-safe step builder connected to Actions", () => {
  assert.match(router, /"workflows"/);
  assert.match(app, /WorkflowWorkspace/);
  assert.match(app, /Open workflow/);
  for (const marker of [
    "Actions are what · Workflows are how",
    "Create workflow",
    "Use an existing action",
    "Start from a template",
    "Describe it in plain English",
    "Create new action",
    "Action",
    "Generate steps",
    "Choose what happens if unavailable",
    "Provider",
    "Condition in plain English",
    "Workflow preview",
    "Runtime will use the updated steps",
    "Configuration complete",
    "Needs testing",
  ]) {
    assert.ok(workflowWorkspace.includes(marker), `missing workflow builder marker: ${marker}`);
  }
  assert.match(workflowWorkspace, /@click="openCreateWorkflow"/);
  assert.doesNotMatch(workflowWorkspace, /@click="emit\('open-action', ''\)"/);
  assert.match(workflowWorkspace, /actions\/\$\{encodeURIComponent\(action\.id\)\}/);
  assert.match(apiServer, /workflowActionId/);
  for (const marker of [
    "WorkflowBusinessContext",
    "plan_selection",
    "usage_type",
    "answer_and_resume",
    "verified_business_knowledge",
    "reviewStatus",
    "provider_backed",
    "child_age",
    "preferred_days",
    "redirect",
    "business_fit",
    "workflow_generation_context",
  ]) {
    assert.ok(workflowGenerator.includes(marker), `missing grounded workflow generation marker: ${marker}`);
  }
  for (const marker of [
    "actionsLoadGeneration",
    "integrationsLoadGeneration",
    "workspaceLoadGeneration",
    "workflowContext?.businessId",
    "workflowContext?.organizationId",
    "workflowContext?.contextVersion",
  ]) {
    assert.ok(app.includes(marker), `missing tenant isolation marker: ${marker}`);
  }
  assert.match(workflowWorkspace, /workflow-isolation-warning/);
  assert.match(workflowWorkspace, /overflow-wrap: anywhere/);
  assert.match(apiServer, /validateWorkflowTenantIsolation/);
  assert.match(apiServer, /workflowContextBusinessId/);
  assert.match(app, /Replay workflow/);
  assert.match(app, /replayAdminWorkflow/);
  assert.match(apiServer, /app\.post\("\/api\/v1\/admin\/workflow-replay/);
  assert.match(apiServer, /productionDataChanged: false/);
  const workflowsRoute = parseRoute({ pathname: "/app/british-swim-school-tampa-bay/workflows", search: "" });
  assert.equal(routeView(workflowsRoute), "workflows");
  assert.equal(routePath(workflowsRoute), "/app/british-swim-school-tampa-bay/workflows");
});
