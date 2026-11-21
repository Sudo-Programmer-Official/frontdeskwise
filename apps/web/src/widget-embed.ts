import {
  createWidgetRenderer,
  DEFAULT_CONFIG,
  type WidgetAction,
  type WidgetConfig,
  type WidgetHandoffStatus,
  type WidgetMessage,
  type WidgetRendererController,
  type WidgetState,
} from "./widget-ui/renderer";

(() => {
  "use strict";

  const script = document.currentScript as HTMLScriptElement | null;
  if (!script || !script.dataset.site) return;

  const siteKey = script.dataset.site;
  const apiBase = (script.dataset.api || new URL(script.src, window.location.href).origin).replace(/\/$/, "");
  const host = document.createElement("div");
  host.setAttribute("data-frontdeskwise-widget", siteKey);
  (document.body || document.documentElement).appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const mount = document.createElement("div");
  shadow.appendChild(mount);

  type AgentConfig = WidgetConfig & {
    collectLeads?: boolean;
    proactiveEnabled?: boolean;
    proactiveDelaySeconds?: number;
    proactiveMessage?: string;
    proactiveTriggers?: string[];
    proactiveBehavior?: "teaser" | "open";
    proactiveFrequency?: "session" | "24h" | "visit";
  };
  type WidgetConfigResponse = { agent?: AgentConfig };
  type ConversationPayload = { conversation?: { status?: string }; messages?: Array<{ role?: string; authorName?: string; content?: string; createdAt?: string; citations?: Array<{ title?: string; url?: string; pageType?: string }> }> };

  let config: AgentConfig | null = null;
  let visitorId = "";
  let conversationId: string | null = null;
  let lastQuestion = "";
  let state: WidgetState = { isOpen: false, messages: [], quickActions: [], handoffStatus: "AI_ACTIVE", handoffNotice: { visible: false, message: "" }, proactive: { visible: false, message: "" } };
  let renderer: WidgetRendererController;
  let pollTimer: number | null = null;
  let handoffNoticeTimer: number | null = null;
  let handoffWaiting = false;
  let handoffDismissedKey: string | null = null;
  let proactiveTimers: number[] = [];
  let proactiveCleanups: Array<() => void> = [];
  let proactiveShown = false;
  const renderedRemoteMessages: Record<string, boolean> = {};
  const HANDOFF_NOTICE_TIMEOUT_MS = 6000;

  function accessibleTextColor(hex: string): string {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.48 ? "#14233d" : "#ffffff";
  }

  function updateState(patch: Partial<WidgetState>): void {
    state = { ...state, ...patch };
    renderer.update({ state });
  }

  function getVisitorId(): string {
    try {
      const key = "frontdeskwise:visitor:" + siteKey;
      const existing = window.localStorage.getItem(key);
      if (existing) return existing;
      const value = window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(key, value);
      return value;
    } catch {
      return `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function deviceType(): "mobile" | "desktop" {
    return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
  }

  function telemetry(event: string, extra: Record<string, unknown> = {}): void {
    void fetch(`${apiBase}/api/v1/widget/${encodeURIComponent(siteKey)}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, conversationId, sourcePage: window.location.href, deviceType: deviceType(), ...extra }),
    }).catch(() => { /* Telemetry must never interrupt the visitor flow. */ });
  }

  function handoffDismissalKey(): string {
    return `frontdeskwise:handoff-dismissed:${siteKey}:${conversationId ? `conversation:${conversationId}` : `session:${visitorId}`}`;
  }

  function handoffNoticeDismissed(): boolean {
    const key = handoffDismissalKey();
    if (handoffDismissedKey === key) return true;
    try {
      return window.sessionStorage.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  function persistHandoffDismissal(): void {
    const key = handoffDismissalKey();
    handoffDismissedKey = key;
    try {
      window.sessionStorage.setItem(key, "1");
    } catch {
      // Dismissal still lasts for this widget instance if storage is unavailable.
    }
  }

  function hideHandoffNotice(): void {
    if (handoffNoticeTimer !== null) {
      window.clearTimeout(handoffNoticeTimer);
      handoffNoticeTimer = null;
    }
    updateState({ handoffNotice: { visible: false, message: "" } });
  }

  function showHandoffNotice(message: string): void {
    if (handoffNoticeDismissed()) return;
    updateState({ handoffNotice: { visible: true, message } });
    if (handoffNoticeTimer !== null) window.clearTimeout(handoffNoticeTimer);
    handoffNoticeTimer = window.setTimeout(() => {
      handoffNoticeTimer = null;
      hideHandoffNotice();
    }, HANDOFF_NOTICE_TIMEOUT_MS);
  }

  function renderConversationStatus(status: string | undefined): void {
    const waitingForStaff = status === "WAITING_FOR_STAFF" || status === "HANDOFF_REQUESTED";
    const normalizedStatus = (status || "AI_ACTIVE") as WidgetHandoffStatus;
    if (waitingForStaff) {
      updateState({ handoffStatus: normalizedStatus });
      if (!handoffWaiting) {
        handoffWaiting = true;
        showHandoffNotice("A team member has been notified.");
      }
      return;
    }
    handoffWaiting = false;
    updateState({ handoffStatus: normalizedStatus });
    hideHandoffNotice();
  }

  function addMessage(content: string, role: WidgetMessage["role"], citations: WidgetMessage["citations"] = [], remoteKey?: string): void {
    if (remoteKey && renderedRemoteMessages[remoteKey]) return;
    if (remoteKey) renderedRemoteMessages[remoteKey] = true;
    updateState({ messages: [...state.messages, { id: remoteKey || `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`, remoteKey, role, content, citations }] });
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(apiBase + path, { headers: { "content-type": "application/json", ...(init.headers || {}) }, ...init });
    const payload = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(payload.error || "The front desk is unavailable.");
    return payload;
  }

  async function syncConversation(): Promise<void> {
    if (!conversationId) return;
    try {
      const payload = await api<ConversationPayload>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}`);
      renderConversationStatus(payload.conversation?.status);
      for (const message of payload.messages || []) {
        if (message.role !== "human" && message.role !== "system") continue;
        const key = `${message.createdAt || ""}:${message.role || ""}:${message.content || ""}`;
        addMessage(`${message.authorName ? `${message.authorName}: ` : ""}${message.content || ""}`, "assistant", [], key);
      }
    } catch {
      // Polling is best-effort; the visitor can continue using the assistant.
    }
  }

  function startPolling(): void {
    if (pollTimer !== null) return;
    pollTimer = window.setInterval(() => void syncConversation(), 5000);
  }

  function renderActionForm(action: WidgetAction | null | undefined): void {
    updateState({ action: action || null });
  }

  async function loadConfig(): Promise<void> {
    const payload = await api<WidgetConfigResponse>(`/api/v1/widget/${encodeURIComponent(siteKey)}/config`);
    const agent: Partial<AgentConfig> = payload.agent || {};
    config = {
      assistantName: agent.assistantName || "AI front desk",
      welcomeMessage: agent.welcomeMessage || "Hi! How can I help?",
      widgetColor: agent.widgetColor || "#0d6efd",
      widgetTheme: agent.widgetTheme || "auto",
      widgetPosition: agent.widgetPosition || "bottom-right",
      widgetDefaultMode: agent.widgetDefaultMode || "compact",
      widgetAllowExpand: agent.widgetAllowExpand !== false,
      widgetLogoUrl: agent.widgetLogoUrl || "",
      widgetQuickActions: agent.widgetQuickActions || [],
      showAiDisclosure: agent.showAiDisclosure !== false,
      showPoweredBy: true,
      showSources: true,
      showLeadCapture: agent.collectLeads !== false,
      requireLeadConsent: agent.requireLeadConsent === true,
      privacyNoticeUrl: agent.privacyNoticeUrl || null,
      fallbackBehavior: agent.fallbackBehavior,
      humanHandoffEnabled: agent.humanHandoffEnabled,
      tone: agent.tone,
    };
    renderer.update({ config, state: { quickActions: state.quickActions.length ? state.quickActions : config.widgetQuickActions } });
    if (!state.messages.length) addMessage(config.welcomeMessage, "assistant");
    armProactiveEngagement(agent);
  }

  function proactiveStorageKey(suffix: string): string {
    return `frontdeskwise:proactive:${siteKey}:${suffix}`;
  }

  function proactiveSuppressed(frequency: string): boolean {
    try {
      if (window.sessionStorage.getItem(proactiveStorageKey("session")) || window.sessionStorage.getItem(`frontdeskwise:proactive:${siteKey}`)) return true;
      if (frequency === "24h") {
        const timestamp = Number(window.localStorage.getItem(proactiveStorageKey("24h")) || 0);
        return timestamp > 0 && Date.now() - timestamp < 24 * 60 * 60 * 1000;
      }
    } catch {
      // Best effort.
    }
    return false;
  }

  function suppressProactive(frequency: string): void {
    try {
      if (frequency === "session") window.sessionStorage.setItem(proactiveStorageKey("session"), "1");
      if (frequency === "24h") window.localStorage.setItem(proactiveStorageKey("24h"), String(Date.now()));
    } catch {
      // Best effort.
    }
  }

  function clearProactiveEngagement(): void {
    proactiveTimers.forEach((timer) => window.clearTimeout(timer));
    proactiveTimers = [];
    proactiveCleanups.forEach((cleanup) => cleanup());
    proactiveCleanups = [];
  }

  function showProactivePrompt(): void {
    if (proactiveShown || !config || !config.proactiveEnabled || state.isOpen) return;
    proactiveShown = true;
    clearProactiveEngagement();
    suppressProactive(config.proactiveFrequency || "session");
    telemetry("CTA_CLICKED", { metadata: { source: "proactive", action: "shown", behavior: config.proactiveBehavior || "teaser" } });
    if ((config.proactiveBehavior || "teaser") === "open") {
      renderer.open("proactive");
      addMessage(config.proactiveMessage || "Looking for the right service? I can help.", "assistant");
      return;
    }
    updateState({ proactive: { visible: true, message: config.proactiveMessage || "Looking for the right service? I can help." } });
  }

  function armProactiveEngagement(agent: Partial<AgentConfig>): void {
    if (!agent.proactiveEnabled || proactiveShown || proactiveSuppressed(agent.proactiveFrequency || "session")) return;
    const triggers = Array.isArray(agent.proactiveTriggers) ? agent.proactiveTriggers : [];
    const oneShot = (): void => showProactivePrompt();
    if (triggers.includes("delay")) proactiveTimers.push(window.setTimeout(oneShot, Number(agent.proactiveDelaySeconds || 20) * 1000));
    if (triggers.includes("returning")) {
      try {
        if (window.localStorage.getItem(`frontdeskwise:visited:${siteKey}`)) proactiveTimers.push(window.setTimeout(oneShot, 900));
        window.localStorage.setItem(`frontdeskwise:visited:${siteKey}`, "1");
      } catch {
        // Best effort.
      }
    }
    if (triggers.includes("scroll")) {
      const onScroll = (): void => {
        const max = document.documentElement.scrollHeight - window.innerHeight;
        if (max > 0 && window.scrollY / max >= 0.7) oneShot();
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      proactiveCleanups.push(() => window.removeEventListener("scroll", onScroll));
    }
    if (triggers.includes("exit") && deviceType() === "desktop") {
      const onExit = (event: MouseEvent): void => { if (event.clientY <= 0) oneShot(); };
      document.addEventListener("mouseout", onExit);
      proactiveCleanups.push(() => document.removeEventListener("mouseout", onExit));
    }
  }

  async function ask(question: string): Promise<void> {
    if (!question) return;
    updateState({ quickActions: [], leadVisible: false, typing: false });
    lastQuestion = question;
    try {
      if (!conversationId) {
        const started = await api<{ conversationId: string; resumed?: boolean }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations`, { method: "POST", body: JSON.stringify({ sessionId: visitorId }) });
        conversationId = started.conversationId;
        if (started.resumed) {
          const history = await api<ConversationPayload>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}`);
          for (const message of history.messages || []) addMessage(`${message.authorName ? `${message.authorName}: ` : ""}${message.content || ""}`, message.role === "user" ? "user" : "assistant", message.citations, `${message.createdAt || ""}:history`);
          renderConversationStatus(history.conversation?.status);
        }
      }
      addMessage(question, "user");
      updateState({ typing: true });
      const answer = await api<{ answer: string; grounded?: boolean; citations?: WidgetMessage["citations"]; quickActions?: WidgetState["quickActions"]; action?: WidgetAction; conversation?: { status?: string } }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify({ question }) });
      updateState({ typing: false });
      addMessage(answer.answer, "assistant", answer.citations || []);
      renderConversationStatus(answer.conversation?.status);
      if (answer.conversation?.status && answer.conversation.status !== "AI_ACTIVE") startPolling();
      updateState({ quickActions: answer.quickActions || [] });
      renderActionForm(answer.action);
      if (answer.action) updateState({ leadVisible: false });
      if (!answer.grounded && !answer.action && !(answer.quickActions && answer.quickActions.length) && config?.showLeadCapture !== false) updateState({ leadVisible: true });
    } catch (error) {
      updateState({ typing: false });
      addMessage(error instanceof Error ? error.message : "The front desk is unavailable.", "assistant");
    }
  }

  async function submitAction(values: Record<string, string>, action: WidgetAction): Promise<void> {
    if (!conversationId || state.actionSubmitting) return;
    updateState({ actionSubmitting: true });
    const consent = values.consent === "true" || values.consent === "on";
    delete values.consent;
    addMessage("Submitted your details.", "user");
    try {
      const answer = await api<{ answer: string; citations?: WidgetMessage["citations"]; action?: WidgetAction; conversation?: { status?: string } }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}/actions/${encodeURIComponent(action.id)}/submit`, { method: "POST", body: JSON.stringify({ values, consent }) });
      addMessage(answer.answer, "assistant", answer.citations || []);
      renderConversationStatus(answer.conversation?.status);
      if (answer.conversation?.status && answer.conversation.status !== "AI_ACTIVE") startPolling();
      renderActionForm(answer.action);
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "Could not send your details.", "assistant");
    } finally {
      updateState({ actionSubmitting: false });
    }
  }

  async function submitLead(values: { name: string; email: string; phone: string; consent: boolean }): Promise<void> {
    if (!values.name || !values.email || !conversationId || state.leadSubmitting) return;
    if (config?.requireLeadConsent && !values.consent) {
      addMessage("Please confirm that you agree to share your details.", "assistant");
      return;
    }
    updateState({ leadSubmitting: true });
    try {
      await api(`/api/v1/widget/${encodeURIComponent(siteKey)}/leads`, { method: "POST", body: JSON.stringify({ conversationId, name: values.name, email: values.email, phone: values.phone || null, intent: lastQuestion, consent: true, consentAt: new Date().toISOString() }) });
      updateState({ leadVisible: false });
      addMessage("Thanks — the team can follow up with you.", "assistant");
    } catch (error) {
      addMessage(error instanceof Error ? error.message : "Could not send your details.", "assistant");
    } finally {
      updateState({ leadSubmitting: false });
    }
  }

  function recordAbandonment(): void {
    if (!conversationId) return;
    if (state.action?.status === "completed") return;
    telemetry("CONVERSATION_ABANDONED", { flowId: state.action?.id });
  }

  visitorId = getVisitorId();
  renderer = createWidgetRenderer(mount, {
    surface: "embed",
    config: DEFAULT_CONFIG,
    state,
    onOpen: (source) => {
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session");
      telemetry("CTA_CLICKED", { metadata: { source } });
    },
    onClose: () => {
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session");
    },
    onAsk: (question) => { void ask(question); },
    onActionSubmit: (values, action) => { void submitAction(values, action); },
    onLeadSubmit: (values) => { void submitLead(values); },
    onHandoffDismiss: () => {
      persistHandoffDismissal();
      hideHandoffNotice();
      telemetry("CTA_CLICKED", { metadata: { source: "handoff-status", action: "dismissed", conversationStatus: handoffWaiting ? "WAITING_FOR_STAFF" : undefined } });
    },
    onProactiveDismiss: () => {
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session");
      telemetry("CTA_CLICKED", { metadata: { source: "proactive", action: "dismissed" } });
    },
  });
  renderer.update({ state });
  window.addEventListener("pagehide", recordAbandonment);
  void loadConfig().catch(() => { /* A manual open retries when the API is available. */ });
})();

