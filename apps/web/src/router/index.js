import { marketingRoutePaths } from "../marketing.js";
const workspaceViews = new Set([
    "overview", "inbox", "team", "conversations", "leads", "knowledge", "actions", "connections", "agent", "analytics", "businesses", "settings", "billing",
]);
const settingsTabs = new Set(["general", "team", "integrations", "verification", "notifications", "billing"]);
const agentTabs = new Set(["behavior", "appearance", "quick-actions", "actions", "test", "install"]);
function cleanPath(pathname) {
    const path = pathname.replace(/\/+/g, "/").replace(/\/$/, "");
    return path || "/";
}
function decodeSegment(value) {
    return value ? decodeURIComponent(value) : "";
}
function safeReturnTo(value) {
    const candidate = value?.trim() ?? "";
    if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\") || /[\r\n]/.test(candidate))
        return undefined;
    return candidate;
}
function testQuestionFromQuery(query, agentTab) {
    if (agentTab !== "test")
        return undefined;
    const question = query.get("q")?.trim();
    return question || undefined;
}
function appendTestQuestion(path, question) {
    const normalized = question?.trim();
    return normalized ? `${path}?q=${encodeURIComponent(normalized)}` : path;
}
export function parseRoute(location = window.location) {
    const path = cleanPath(location.pathname);
    const segments = path.split("/").filter(Boolean).map(decodeSegment);
    const query = new URLSearchParams(location.search);
    if (path === "/") {
        const demoToken = query.get("demo");
        return demoToken ? { kind: "demo-access", token: demoToken } : { kind: "landing" };
    }
    if (path === "/privacy")
        return { kind: "legal", page: "privacy" };
    if (path === "/terms")
        return { kind: "legal", page: "terms" };
    if (marketingRoutePaths.includes(path))
        return { kind: "marketing", page: marketingRoutePaths.find((candidate) => candidate === path)?.slice(1) ?? "" };
    if (segments[0] === "auth") {
        if (segments[1] === "callback")
            return { kind: "auth-callback" };
        if (segments[1] === "reset-password")
            return { kind: "auth-reset", mode: "resetPassword", ...(query.get("oobCode") ? { oobCode: query.get("oobCode") ?? undefined } : {}) };
        const returnTo = safeReturnTo(query.get("returnTo"));
        if (segments[1] === "sign-up")
            return { kind: "auth", mode: "signup", ...(returnTo ? { returnTo } : {}) };
        if (segments[1] === "forgot-password")
            return { kind: "auth", mode: "forgot", ...(returnTo ? { returnTo } : {}) };
        return { kind: "auth", mode: "signin", ...(returnTo ? { returnTo } : {}) };
    }
    if (segments[0] === "agent") {
        const agentTab = segments[1] && agentTabs.has(segments[1]) ? segments[1] : "behavior";
        const testQuestion = testQuestionFromQuery(query, agentTab);
        return { kind: "agent-shortcut", agentTab, ...(testQuestion ? { testQuestion } : {}) };
    }
    if (segments[0] === "demo") {
        if (segments[1] === "access") {
            const token = query.get("token") ?? query.get("demo");
            return token ? { kind: "demo-access", token } : { kind: "not-found", path };
        }
        if (!segments[1])
            return { kind: "not-found", path };
        if (segments[2] === "agent") {
            const agentTab = segments[3] && agentTabs.has(segments[3]) ? segments[3] : "behavior";
            const testQuestion = testQuestionFromQuery(query, agentTab);
            return { kind: "demo", demoId: segments[1], view: agentTab === "test" ? "conversations" : "agent", agentTab, ...(testQuestion ? { testQuestion } : {}) };
        }
        const candidate = segments[2];
        return { kind: "demo", demoId: segments[1], view: candidate && workspaceViews.has(candidate) ? candidate : "overview" };
    }
    if (segments[0] === "onboarding") {
        const step = segments[1] && ["business", "knowledge", "agent", "install"].includes(segments[1]) ? segments[1] : "index";
        return { kind: "onboarding", step };
    }
    if (segments[0] === "platform") {
        if (segments[1] === "organizations" && segments[2])
            return { kind: "platform", section: "organization-detail", organizationId: segments[2] };
        if (segments[1] === "organizations")
            return { kind: "platform", section: "organizations" };
        if (segments[1] === "businesses" && segments[2])
            return { kind: "platform", section: "business-detail", businessId: segments[2] };
        if (segments[1] === "users")
            return { kind: "platform", section: "users" };
        if (segments[1] === "demos")
            return { kind: "platform", section: "demos" };
        if (segments[1] === "messaging")
            return { kind: "platform", section: "messaging" };
        if (segments[1] === "installation-support")
            return { kind: "platform", section: "installation-support" };
        if (segments[1] === "operations")
            return { kind: "platform", section: "operations" };
        return { kind: "platform", section: "overview" };
    }
    if (segments[0] === "app") {
        if (segments[1] === "settings") {
            const tab = segments[2] && settingsTabs.has(segments[2]) ? segments[2] : "general";
            const view = tab === "team" ? "team" : tab === "integrations" ? "connections" : tab === "billing" ? "billing" : "settings";
            return { kind: "workspace-settings", view, tab };
        }
        const businessSlug = segments[1];
        if (!businessSlug)
            return { kind: "not-found", path };
        if (segments[2] === "agent") {
            const agentTab = segments[3] && agentTabs.has(segments[3]) ? segments[3] : "behavior";
            const testQuestion = testQuestionFromQuery(query, agentTab);
            return { kind: "workspace", businessSlug, view: agentTab === "test" ? "conversations" : "agent", agentTab, ...(testQuestion ? { testQuestion } : {}) };
        }
        const candidate = segments[2];
        return { kind: "workspace", businessSlug, view: candidate && workspaceViews.has(candidate) ? candidate : "overview" };
    }
    return { kind: "not-found", path };
}
export function routeView(route) {
    if (route.kind === "marketing")
        return "marketing";
    if (route.kind === "legal")
        return route.page;
    if (route.kind === "agent-shortcut")
        return "agent";
    if (route.kind === "demo")
        return route.view === "agent" || route.view === "conversations" ? "agent" : route.view;
    if (route.kind === "workspace")
        return route.view === "agent" || route.view === "conversations" ? "agent" : route.view;
    if (route.kind === "workspace-settings")
        return route.view;
    if (route.kind === "platform")
        return "admin";
    if (route.kind === "onboarding")
        return route.step === "knowledge" ? "knowledge" : route.step === "agent" || route.step === "install" ? "agent" : "businesses";
    return "home";
}
export function routePath(route) {
    if (route.kind === "landing")
        return "/";
    if (route.kind === "marketing")
        return `/${route.page}`;
    if (route.kind === "legal")
        return `/${route.page}`;
    if (route.kind === "auth") {
        const path = `/auth/${route.mode === "signin" ? "sign-in" : route.mode === "signup" ? "sign-up" : "forgot-password"}`;
        return route.returnTo ? `${path}?returnTo=${encodeURIComponent(route.returnTo)}` : path;
    }
    if (route.kind === "auth-reset") {
        const params = new URLSearchParams({ mode: route.mode });
        if (route.oobCode)
            params.set("oobCode", route.oobCode);
        return `/auth/reset-password?${params.toString()}`;
    }
    if (route.kind === "auth-callback")
        return "/auth/callback";
    if (route.kind === "agent-shortcut")
        return appendTestQuestion(`/agent/${route.agentTab}`, route.agentTab === "test" ? route.testQuestion : undefined);
    if (route.kind === "demo") {
        const base = `/demo/${encodeURIComponent(route.demoId)}`;
        if (route.view === "agent" || route.view === "conversations") {
            const agentTab = route.agentTab ?? (route.view === "conversations" ? "test" : "behavior");
            return appendTestQuestion(`${base}/agent/${agentTab}`, agentTab === "test" ? route.testQuestion : undefined);
        }
        return route.view === "overview" ? base : `${base}/${route.view}`;
    }
    if (route.kind === "demo-access")
        return `/demo/access?token=${encodeURIComponent(route.token)}`;
    if (route.kind === "onboarding")
        return route.step === "index" ? "/onboarding" : `/onboarding/${route.step}`;
    if (route.kind === "workspace-settings")
        return route.tab === "general" ? "/app/settings" : `/app/settings/${route.tab}`;
    if (route.kind === "platform") {
        if (route.section === "organization-detail" && route.organizationId)
            return `/platform/organizations/${encodeURIComponent(route.organizationId)}`;
        if (route.section === "business-detail" && route.businessId)
            return `/platform/businesses/${encodeURIComponent(route.businessId)}`;
        if (route.section === "overview")
            return "/platform";
        return `/platform/${route.section}`;
    }
    if (route.kind === "workspace") {
        const base = `/app/${encodeURIComponent(route.businessSlug)}`;
        if (route.view === "agent" || route.view === "conversations") {
            const agentTab = route.agentTab ?? (route.view === "conversations" ? "test" : "behavior");
            return appendTestQuestion(`${base}/agent/${agentTab}`, agentTab === "test" ? route.testQuestion : undefined);
        }
        return route.view === "overview" ? base : `${base}/${route.view}`;
    }
    return route.kind === "not-found" ? route.path : "/";
}
export function workspaceRoute(businessSlug, view, options = {}) {
    return { kind: "workspace", businessSlug, view, ...(options.agentTab ? { agentTab: options.agentTab } : {}), ...(options.testQuestion?.trim() ? { testQuestion: options.testQuestion.trim() } : {}) };
}
export function demoRoute(demoId, view = "overview", options = {}) {
    return { kind: "demo", demoId, view, ...(options.agentTab ? { agentTab: options.agentTab } : {}), ...(options.testQuestion?.trim() ? { testQuestion: options.testQuestion.trim() } : {}) };
}
export function settingsRoute(tab) {
    const view = tab === "team" ? "team" : tab === "integrations" ? "connections" : tab === "billing" ? "billing" : "settings";
    return { kind: "workspace-settings", view, tab };
}
export function platformRoute(section, ids = {}) {
    return { kind: "platform", section, ...ids };
}
