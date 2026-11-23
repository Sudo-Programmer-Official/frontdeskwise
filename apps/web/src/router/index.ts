import { marketingRoutePaths } from "../marketing.js";

export type WorkspaceView =
  | "overview"
  | "support"
  | "inbox"
  | "team"
  | "conversations"
  | "leads"
  | "knowledge"
  | "actions"
  | "workflows"
  | "connections"
  | "agent"
  | "analytics"
  | "businesses"
  | "settings"
  | "billing";
export type PartnerRouteSection = "overview" | "clients" | "referrals" | "settings";

export type SettingsRouteTab = "general" | "team" | "integrations" | "verification" | "notifications" | "billing";
export type AgentRouteTab = "capabilities" | "behavior" | "knowledge" | "appearance" | "quick-actions" | "actions" | "test" | "install";
export type PlatformRouteSection = "overview" | "organizations" | "organization-detail" | "business-detail" | "action-registry" | "certification" | "experience-signals" | "feature-flags" | "users" | "demos" | "messaging" | "recovery" | "support" | "installation-support" | "operations";
export type OnboardingRouteStep = "index" | "business" | "knowledge" | "agent" | "install";

export type AppRoute =
  | { kind: "landing" }
  | { kind: "marketing"; page: string }
  | { kind: "legal"; page: "privacy" | "terms" }
  | { kind: "auth"; mode: "signin" | "signup" | "forgot"; returnTo?: string }
  | { kind: "auth-reset"; mode: "resetPassword"; oobCode?: string }
  | { kind: "auth-callback" }
  | { kind: "agent-shortcut"; agentTab: AgentRouteTab; testQuestion?: string }
  | { kind: "demo"; demoId: string; view: WorkspaceView; agentTab?: AgentRouteTab; testQuestion?: string; workflowId?: string; workflowActionId?: string }
  | { kind: "demo-access"; token: string }
  | { kind: "partner"; section: PartnerRouteSection }
  | { kind: "onboarding"; step: OnboardingRouteStep }
  | { kind: "billing-success"; sessionId?: string }
  | { kind: "workspace"; businessSlug: string; view: WorkspaceView; agentTab?: AgentRouteTab; testQuestion?: string; workflowId?: string; workflowActionId?: string }
  | { kind: "workspace-settings"; view: "settings" | "team" | "connections" | "billing"; tab: SettingsRouteTab }
  | { kind: "platform"; section: PlatformRouteSection; organizationId?: string; businessId?: string }
  | { kind: "not-found"; path: string };

const workspaceViews = new Set<WorkspaceView>([
  "overview", "support", "inbox", "team", "conversations", "leads", "knowledge", "actions", "workflows", "connections", "agent", "analytics", "businesses", "settings", "billing",
]);
const settingsTabs = new Set<SettingsRouteTab>(["general", "team", "integrations", "verification", "notifications", "billing"]);
const agentTabs = new Set<AgentRouteTab>(["capabilities", "behavior", "knowledge", "appearance", "quick-actions", "actions", "test", "install"]);
const partnerSections = new Set<PartnerRouteSection>(["overview", "clients", "referrals", "settings"]);

function cleanPath(pathname: string): string {
  const path = pathname.replace(/\/+/g, "/").replace(/\/$/, "");
  return path || "/";
}

function decodeSegment(value: string | undefined): string {
  return value ? decodeURIComponent(value) : "";
}

function safeReturnTo(value: string | null): string | undefined {
  const candidate = value?.trim() ?? "";
  if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\r\n]/.test(candidate)) return undefined;
  return candidate;
}

function testQuestionFromQuery(query: URLSearchParams, agentTab: AgentRouteTab): string | undefined {
  if (agentTab !== "test") return undefined;
  const question = query.get("q")?.trim();
  return question || undefined;
}

function appendTestQuestion(path: string, question: string | undefined): string {
  const normalized = question?.trim();
  return normalized ? `${path}?q=${encodeURIComponent(normalized)}` : path;
}

function workflowIdFromQuery(query: URLSearchParams, view: WorkspaceView): string | undefined {
  if (view !== "workflows") return undefined;
  const workflowId = query.get("workflowId")?.trim();
  return workflowId || undefined;
}

function workflowActionIdFromQuery(query: URLSearchParams, view: WorkspaceView): string | undefined {
  if (view !== "workflows") return undefined;
  const actionId = query.get("actionId")?.trim();
  return actionId || undefined;
}

export function parseRoute(location: Pick<Location, "pathname" | "search"> = window.location): AppRoute {
  const path = cleanPath(location.pathname);
  const segments = path.split("/").filter(Boolean).map(decodeSegment);
  const query = new URLSearchParams(location.search);

  if (path === "/") {
    const demoToken = query.get("demo");
    return demoToken ? { kind: "demo-access", token: demoToken } : { kind: "landing" };
  }
  if (path === "/privacy") return { kind: "legal", page: "privacy" };
  if (path === "/terms") return { kind: "legal", page: "terms" };
  if (marketingRoutePaths.includes(path)) return { kind: "marketing", page: marketingRoutePaths.find((candidate) => candidate === path)?.slice(1) ?? "" };
  if (segments[0] === "auth") {
    if (segments[1] === "callback") return { kind: "auth-callback" };
    if (segments[1] === "reset-password") return { kind: "auth-reset", mode: "resetPassword", ...(query.get("oobCode") ? { oobCode: query.get("oobCode") ?? undefined } : {}) };
    const returnTo = safeReturnTo(query.get("returnTo"));
    if (segments[1] === "sign-up") return { kind: "auth", mode: "signup", ...(returnTo ? { returnTo } : {}) };
    if (segments[1] === "forgot-password") return { kind: "auth", mode: "forgot", ...(returnTo ? { returnTo } : {}) };
    return { kind: "auth", mode: "signin", ...(returnTo ? { returnTo } : {}) };
  }
  if (segments[0] === "agent") {
    const agentTab = segments[1] && agentTabs.has(segments[1] as AgentRouteTab) ? segments[1] as AgentRouteTab : "capabilities";
    const testQuestion = testQuestionFromQuery(query, agentTab);
    return { kind: "agent-shortcut", agentTab, ...(testQuestion ? { testQuestion } : {}) };
  }
  if (segments[0] === "demo") {
    if (segments[1] === "access") {
      const token = query.get("token") ?? query.get("demo");
      return token ? { kind: "demo-access", token } : { kind: "not-found", path };
    }
    if (!segments[1]) return { kind: "not-found", path };
    if (segments[2] === "agent") {
      const agentTab = segments[3] && agentTabs.has(segments[3] as AgentRouteTab) ? segments[3] as AgentRouteTab : "capabilities";
      const testQuestion = testQuestionFromQuery(query, agentTab);
      return { kind: "demo", demoId: segments[1], view: agentTab === "test" ? "conversations" : "agent", agentTab, ...(testQuestion ? { testQuestion } : {}) };
    }
    const candidate = segments[2] as WorkspaceView | undefined;
    const view = candidate && workspaceViews.has(candidate) ? candidate : "overview";
    const workflowId = workflowIdFromQuery(query, view);
    const workflowActionId = workflowActionIdFromQuery(query, view);
    return { kind: "demo", demoId: segments[1], view, ...(workflowId ? { workflowId } : {}), ...(workflowActionId ? { workflowActionId } : {}) };
  }
  if (segments[0] === "onboarding") {
    const step = segments[1] && ["business", "knowledge", "agent", "install"].includes(segments[1]) ? segments[1] as OnboardingRouteStep : "index";
    return { kind: "onboarding", step };
  }
  if (segments[0] === "partner") {
    const section = segments[1] && partnerSections.has(segments[1] as PartnerRouteSection) ? segments[1] as PartnerRouteSection : "overview";
    return { kind: "partner", section };
  }
  if (segments[0] === "app" && segments[1] === "settings" && segments[2] === "billing" && segments[3] === "success") {
    const sessionId = query.get("session_id")?.trim();
    return { kind: "billing-success", ...(sessionId ? { sessionId } : {}) };
  }
  if (segments[0] === "platform") {
    if (segments[1] === "organizations" && segments[2]) return { kind: "platform", section: "organization-detail", organizationId: segments[2] };
    if (segments[1] === "organizations") return { kind: "platform", section: "organizations" };
    if (segments[1] === "businesses" && segments[2]) return { kind: "platform", section: "business-detail", businessId: segments[2] };
    if (segments[1] === "action-registry") return { kind: "platform", section: "action-registry" };
    if (segments[1] === "experience-signals") return { kind: "platform", section: "experience-signals" };
    if (segments[1] === "feature-flags") return { kind: "platform", section: "feature-flags" };
    if (segments[1] === "users") return { kind: "platform", section: "users" };
    if (segments[1] === "demos") return { kind: "platform", section: "demos" };
    if (segments[1] === "messaging") return { kind: "platform", section: "messaging" };
    if (segments[1] === "recovery") return { kind: "platform", section: "recovery" };
    if (segments[1] === "support") return { kind: "platform", section: "support" };
    if (segments[1] === "installation-support") return { kind: "platform", section: "installation-support" };
    if (segments[1] === "operations") return { kind: "platform", section: "operations" };
    return { kind: "platform", section: "overview" };
  }
  if (segments[0] === "app") {
    if (segments[1] === "settings") {
      const tab = segments[2] && settingsTabs.has(segments[2] as SettingsRouteTab) ? segments[2] as SettingsRouteTab : "general";
      const view = tab === "team" ? "team" : tab === "integrations" ? "connections" : tab === "billing" ? "billing" : "settings";
      return { kind: "workspace-settings", view, tab };
    }
    const businessSlug = segments[1];
    if (!businessSlug) return { kind: "not-found", path };
    if (segments[2] === "agent") {
      const agentTab = segments[3] && agentTabs.has(segments[3] as AgentRouteTab) ? segments[3] as AgentRouteTab : "capabilities";
      const testQuestion = testQuestionFromQuery(query, agentTab);
      return { kind: "workspace", businessSlug, view: agentTab === "test" ? "conversations" : "agent", agentTab, ...(testQuestion ? { testQuestion } : {}) };
    }
    const candidate = segments[2] as WorkspaceView | undefined;
    const view = candidate && workspaceViews.has(candidate) ? candidate : "overview";
    const workflowId = workflowIdFromQuery(query, view);
    const workflowActionId = workflowActionIdFromQuery(query, view);
    return { kind: "workspace", businessSlug, view, ...(workflowId ? { workflowId } : {}), ...(workflowActionId ? { workflowActionId } : {}) };
  }
  return { kind: "not-found", path };
}

export function routeView(route: AppRoute): "home" | "marketing" | "privacy" | "terms" | "overview" | "support" | "inbox" | "team" | "conversations" | "leads" | "knowledge" | "actions" | "workflows" | "connections" | "agent" | "analytics" | "businesses" | "settings" | "billing" | "admin" | "partner" {
  if (route.kind === "marketing") return "marketing";
  if (route.kind === "legal") return route.page;
  if (route.kind === "agent-shortcut") return "agent";
  if (route.kind === "demo") return route.view === "agent" || route.view === "conversations" ? "agent" : route.view;
  if (route.kind === "workspace") return route.view === "agent" || route.view === "conversations" ? "agent" : route.view;
  if (route.kind === "workspace-settings") return route.view;
  if (route.kind === "billing-success") return "billing";
  if (route.kind === "platform") return "admin";
  if (route.kind === "partner") return "partner";
  if (route.kind === "onboarding") return route.step === "knowledge" ? "knowledge" : route.step === "agent" || route.step === "install" ? "agent" : "businesses";
  return "home";
}

export function routePath(route: AppRoute): string {
  if (route.kind === "landing") return "/";
  if (route.kind === "marketing") return `/${route.page}`;
  if (route.kind === "legal") return `/${route.page}`;
  if (route.kind === "auth") {
    const path = `/auth/${route.mode === "signin" ? "sign-in" : route.mode === "signup" ? "sign-up" : "forgot-password"}`;
    return route.returnTo ? `${path}?returnTo=${encodeURIComponent(route.returnTo)}` : path;
  }
  if (route.kind === "auth-reset") {
    const params = new URLSearchParams({ mode: route.mode });
    if (route.oobCode) params.set("oobCode", route.oobCode);
    return `/auth/reset-password?${params.toString()}`;
  }
  if (route.kind === "auth-callback") return "/auth/callback";
  if (route.kind === "agent-shortcut") return appendTestQuestion(`/agent/${route.agentTab}`, route.agentTab === "test" ? route.testQuestion : undefined);
  if (route.kind === "demo") {
    const base = `/demo/${encodeURIComponent(route.demoId)}`;
    if (route.view === "agent" || route.view === "conversations") {
    const agentTab = route.agentTab ?? (route.view === "conversations" ? "test" : "capabilities");
      return appendTestQuestion(`${base}/agent/${agentTab}`, agentTab === "test" ? route.testQuestion : undefined);
    }
    if (route.view === "overview") return base;
    const path = `${base}/${route.view}`;
    if (route.view !== "workflows") return path;
    const query = new URLSearchParams();
    if (route.workflowId) query.set("workflowId", route.workflowId);
    if (route.workflowActionId) query.set("actionId", route.workflowActionId);
    return query.toString() ? `${path}?${query.toString()}` : path;
  }
  if (route.kind === "demo-access") return `/demo/access?token=${encodeURIComponent(route.token)}`;
  if (route.kind === "partner") return route.section === "overview" ? "/partner" : `/partner/${route.section}`;
  if (route.kind === "onboarding") return route.step === "index" ? "/onboarding" : `/onboarding/${route.step}`;
  if (route.kind === "billing-success") {
    const query = route.sessionId ? `?session_id=${encodeURIComponent(route.sessionId)}` : "";
    return `/app/settings/billing/success${query}`;
  }
  if (route.kind === "workspace-settings") return route.tab === "general" ? "/app/settings" : `/app/settings/${route.tab}`;
  if (route.kind === "platform") {
    if (route.section === "organization-detail" && route.organizationId) return `/platform/organizations/${encodeURIComponent(route.organizationId)}`;
    if (route.section === "business-detail" && route.businessId) return `/platform/businesses/${encodeURIComponent(route.businessId)}`;
    if (route.section === "overview") return "/platform";
    return `/platform/${route.section}`;
  }
  if (route.kind === "workspace") {
    const base = `/app/${encodeURIComponent(route.businessSlug)}`;
    if (route.view === "agent" || route.view === "conversations") {
    const agentTab = route.agentTab ?? (route.view === "conversations" ? "test" : "capabilities");
      return appendTestQuestion(`${base}/agent/${agentTab}`, agentTab === "test" ? route.testQuestion : undefined);
    }
    if (route.view === "overview") return base;
    const path = `${base}/${route.view}`;
    if (route.view !== "workflows") return path;
    const query = new URLSearchParams();
    if (route.workflowId) query.set("workflowId", route.workflowId);
    if (route.workflowActionId) query.set("actionId", route.workflowActionId);
    return query.toString() ? `${path}?${query.toString()}` : path;
  }
  return route.kind === "not-found" ? route.path : "/";
}

export function workspaceRoute(businessSlug: string, view: WorkspaceView, options: { agentTab?: AgentRouteTab; testQuestion?: string; workflowId?: string; workflowActionId?: string } = {}): AppRoute {
  return { kind: "workspace", businessSlug, view, ...(options.agentTab ? { agentTab: options.agentTab } : {}), ...(options.testQuestion?.trim() ? { testQuestion: options.testQuestion.trim() } : {}), ...(options.workflowId?.trim() ? { workflowId: options.workflowId.trim() } : {}), ...(options.workflowActionId?.trim() ? { workflowActionId: options.workflowActionId.trim() } : {}) };
}

export function demoRoute(demoId: string, view: WorkspaceView = "overview", options: { agentTab?: AgentRouteTab; testQuestion?: string; workflowId?: string; workflowActionId?: string } = {}): AppRoute {
  return { kind: "demo", demoId, view, ...(options.agentTab ? { agentTab: options.agentTab } : {}), ...(options.testQuestion?.trim() ? { testQuestion: options.testQuestion.trim() } : {}), ...(options.workflowId?.trim() ? { workflowId: options.workflowId.trim() } : {}), ...(options.workflowActionId?.trim() ? { workflowActionId: options.workflowActionId.trim() } : {}) };
}

export function settingsRoute(tab: SettingsRouteTab): AppRoute {
  const view = tab === "team" ? "team" : tab === "integrations" ? "connections" : tab === "billing" ? "billing" : "settings";
  return { kind: "workspace-settings", view, tab };
}

export function platformRoute(section: PlatformRouteSection, ids: { organizationId?: string; businessId?: string } = {}): AppRoute {
  return { kind: "platform", section, ...ids };
}
