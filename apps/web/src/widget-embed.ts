import {
  createWidgetRenderer,
  DEFAULT_CONFIG,
  type WidgetAction,
  type WidgetConfig,
  type WidgetFallbackContacts,
  type WidgetHealthState,
  type WidgetHandoffStatus,
  type WidgetMessage,
  type WidgetPrimaryCta,
  type WidgetRendererController,
  type WidgetState,
} from "./widget-ui/renderer";

type PerformanceEventDetails = {
  durationMs?: number;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type WidgetPerformanceRuntime = {
  mark: (event: string, details?: PerformanceEventDetails) => void;
  flush: () => Promise<void>;
};

type WidgetBootstrap = {
  siteKey: string;
  apiBase: string;
  host: HTMLDivElement;
  shadow: ShadowRoot;
  config: Record<string, unknown> | null;
  openOnReady?: boolean;
  openSource?: "launcher" | "proactive";
  configPromise?: Promise<unknown>;
  configError?: boolean;
  performance: WidgetPerformanceRuntime;
};

type FrontDeskWiseWindow = Window & {
  __FRONTDESKWISE_WIDGET_BOOTSTRAP__?: WidgetBootstrap;
};

(() => {
  "use strict";

  const script = document.currentScript as HTMLScriptElement | null;
  if (!script || !script.dataset.site) return;

  const widgetWindow = window as FrontDeskWiseWindow;
  const bootstrap = widgetWindow.__FRONTDESKWISE_WIDGET_BOOTSTRAP__;
  const siteKey = bootstrap?.siteKey || script.dataset.site;
  const apiBase = bootstrap?.apiBase || (script.dataset.api || new URL(script.src, window.location.href).origin).replace(/\/$/, "");
  const host = bootstrap?.host || document.createElement("div");
  host.setAttribute("data-frontdeskwise-widget", siteKey);
  if (!bootstrap) (document.body || document.documentElement).appendChild(host);
  const shadow = bootstrap?.shadow || host.attachShadow({ mode: "open" });
  shadow.replaceChildren();
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
  type ConversationPayload = { conversation?: { id?: string; status?: string; leadCaptured?: boolean; lastActivityAt?: string; updatedAt?: string; handoffNotificationStatus?: string }; messages?: Array<{ id?: string; role?: string; authorName?: string; content?: string; createdAt?: string; citations?: Array<{ title?: string; url?: string; pageType?: string }> }> };

  class WidgetRequestError extends Error {
    readonly retryable: boolean;
    readonly timedOut: boolean;
    readonly status: number;
    constructor(message: string, options: { retryable?: boolean; timedOut?: boolean; status?: number } = {}) {
      super(message);
      this.name = "WidgetRequestError";
      this.retryable = options.retryable !== false;
      this.timedOut = options.timedOut === true;
      this.status = options.status ?? 0;
    }
  }

  let config: AgentConfig | null = null;
  let visitorId = "";
  let conversationId: string | null = null;
  let lastQuestion = "";
  let state: WidgetState = { isOpen: false, openedByUser: false, messages: [], quickActions: [], primaryCta: null, actionStep: 0, actionValues: {}, consentGiven: false, leadCaptured: false, handoffStatus: "AI_ACTIVE", handoffNotice: { visible: false, message: "" }, proactive: { visible: false, message: "" }, healthState: "LOADING", connectionState: "online" };
  let renderer: WidgetRendererController;
  let pollTimer: number | null = null;
  let statusSyncInFlight = false;
  let lastConversationUpdatedAt = "";
  let handoffNoticeTimer: number | null = null;
  let handoffWaiting = false;
  let handoffDismissedKey: string | null = null;
  let proactiveTimers: number[] = [];
  let proactiveCleanups: Array<() => void> = [];
  let proactiveShown = false;
  let proactiveArmed = false;
  let lastRequestId = "";
  const renderedRemoteMessages: Record<string, boolean> = {};
  const HANDOFF_NOTICE_TIMEOUT_MS = 6000;
  const MESSAGE_SOFT_TIMEOUT_MS = 8_000;
  const MESSAGE_TIMEOUT_MS = 15_000;
  let online = typeof navigator === "undefined" ? true : navigator.onLine !== false;
  let restoredStatusTimer: number | null = null;

  function accessibleTextColor(hex: string): string {
    const channels = [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
    return luminance > 0.48 ? "#14233d" : "#ffffff";
  }

  function updateState(patch: Partial<WidgetState>): void {
    if (state.isOpen && patch.isOpen === false) patch = { ...patch, isOpen: true };
    state = { ...state, ...patch };
    persistInteractionState();
    renderer.update({ state });
  }

  function setHealth(healthState: WidgetHealthState, statusMessage = "", patch: Partial<WidgetState> = {}): void {
    updateState({ healthState, statusMessage, ...patch });
  }

  function getVisitorId(): string {
    try {
      const key = `fdw:${siteKey}:visitorId`;
      const legacyKey = "frontdeskwise:visitor:" + siteKey;
      const existing = window.localStorage.getItem(key) || window.localStorage.getItem(legacyKey);
      if (existing) return existing;
      const value = window.crypto?.randomUUID?.() || `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(key, value);
      return value;
    } catch {
      return `visitor-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
  }

  function interactionStorageKey(): string {
    const hostName = window.location.hostname || "unknown-host";
    return `frontdeskwise:${siteKey}:${hostName}:interaction`;
  }

  function currentConversationStorageKey(): string {
    const hostName = window.location.hostname || "unknown-host";
    return `fdw:${siteKey}:${hostName}:currentConversationId`;
  }

  function consentStorageKey(): string {
    const hostName = window.location.hostname || "unknown-host";
    return `frontdeskwise:${siteKey}:${hostName}:consent`;
  }

  function hasRememberedConsent(): boolean {
    try {
      return window.sessionStorage.getItem(consentStorageKey()) === "1";
    } catch {
      return false;
    }
  }

  function rememberConsent(): void {
    try {
      window.sessionStorage.setItem(consentStorageKey(), "1");
    } catch {
      // The renderer still keeps consent for this widget instance if storage is unavailable.
    }
  }

  function forgetConsent(): void {
    try {
      window.sessionStorage.removeItem(consentStorageKey());
    } catch {
      // The renderer still keeps the current consent state if storage is unavailable.
    }
  }

  function persistInteractionState(): void {
    try {
      if (conversationId) window.sessionStorage.setItem(currentConversationStorageKey(), conversationId);
      else window.sessionStorage.removeItem(currentConversationStorageKey());
      if (!conversationId && !state.action) {
        window.sessionStorage.removeItem(interactionStorageKey());
        return;
      }
      window.sessionStorage.setItem(interactionStorageKey(), JSON.stringify({
        conversationId,
        action: state.action && state.action.status !== "completed" ? state.action : null,
        actionStep: state.actionStep || 0,
        actionValues: state.actionValues || {},
        leadCaptured: state.leadCaptured === true,
      }));
    } catch {
      // Best effort; the live widget state remains authoritative for this mount.
    }
  }

  function restoreInteractionState(): void {
    try {
      const raw = window.sessionStorage.getItem(interactionStorageKey());
      if (!raw) return;
      const saved = JSON.parse(raw) as { conversationId?: unknown; action?: unknown; actionStep?: unknown; actionValues?: unknown; leadCaptured?: unknown };
      const savedConversationId = window.sessionStorage.getItem(currentConversationStorageKey());
      if (savedConversationId) conversationId = savedConversationId;
      else if (typeof saved.conversationId === "string" && saved.conversationId) conversationId = saved.conversationId;
      const action = saved.action && typeof saved.action === "object" ? saved.action as WidgetAction : null;
      const actionValues = saved.actionValues && typeof saved.actionValues === "object" ? saved.actionValues as Record<string, string> : {};
      state = {
        ...state,
        action,
        actionStep: typeof saved.actionStep === "number" ? saved.actionStep : 0,
        actionValues,
        leadCaptured: saved.leadCaptured === true,
      };
    } catch {
      // Ignore malformed or unavailable session state.
    }
  }

  function deviceType(): "mobile" | "desktop" {
    return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
  }

  function markPerformance(event: string, details: PerformanceEventDetails = {}): void {
    bootstrap?.performance.mark(event, details);
  }

  function flushPerformance(): void {
    void bootstrap?.performance.flush();
  }

  function telemetry(event: string, extra: Record<string, unknown> = {}): void {
    void fetch(`${apiBase}/api/v1/widget/${encodeURIComponent(siteKey)}/telemetry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, conversationId, sourcePage: window.location.href, device: deviceType(), ...extra }),
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

  function showHandoffNotice(message: string, choice = false): void {
    if (handoffNoticeDismissed()) return;
    updateState({ handoffNotice: { visible: true, message, choice } });
    if (handoffNoticeTimer !== null) window.clearTimeout(handoffNoticeTimer);
    handoffNoticeTimer = window.setTimeout(() => {
      handoffNoticeTimer = null;
      hideHandoffNotice();
    }, HANDOFF_NOTICE_TIMEOUT_MS);
  }

  function renderConversationStatus(status: string | undefined, options: { returning?: boolean; notificationStatus?: string } = {}): void {
    const waitingForStaff = status === "WAITING_FOR_STAFF" || status === "HANDOFF_REQUESTED";
    const normalizedStatus = (status || "AI_ACTIVE") as WidgetHandoffStatus;
    if (normalizedStatus === "HUMAN_ACTIVE" || waitingForStaff) {
      clearProactiveEngagement();
      proactiveShown = true;
    }
    if (waitingForStaff) {
      updateState({ handoffStatus: normalizedStatus });
      if (!handoffWaiting) {
        handoffWaiting = true;
        showHandoffNotice(
          options.notificationStatus === "failed"
            ? "Your message has been saved for the team."
            : options.returning ? "You still have a conversation waiting for the team." : "A team member has been notified.",
          options.returning,
        );
      }
      if (options.notificationStatus === "failed") setHealth("HANDOFF_DEGRADED", "Your message has been saved for the team.", { statusContacts: fallbackContacts() });
      return;
    }
    handoffWaiting = false;
    updateState({ handoffStatus: normalizedStatus });
    hideHandoffNotice();
  }

  function addMessage(content: string, role: WidgetMessage["role"], citations: WidgetMessage["citations"] = [], remoteKey?: string, messageOptions: Pick<WidgetMessage, "status" | "retryable" | "clientMessageId"> = {}): string {
    if (remoteKey && renderedRemoteMessages[remoteKey]) return remoteKey;
    if (remoteKey) renderedRemoteMessages[remoteKey] = true;
    const id = remoteKey || `${role}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    updateState({ messages: [...state.messages, { id, remoteKey, role, content, citations, ...messageOptions }] });
    return id;
  }

  function updateMessage(messageId: string, patch: Partial<WidgetMessage>): void {
    const index = state.messages.findIndex((message) => message.id === messageId);
    if (index < 0) return;
    const messages = [...state.messages];
    messages[index] = { ...messages[index], ...patch };
    updateState({ messages });
  }

  function fallbackContacts(): WidgetFallbackContacts {
    return config?.fallbackContacts || {};
  }

  function errorMessage(error: unknown, fallback: string): string {
    if (error instanceof WidgetRequestError && error.timedOut) return "This is taking longer than expected.";
    return error instanceof Error && error.message && !/^HTTP \d+$/i.test(error.message) ? error.message : fallback;
  }

  async function api<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(apiBase + path, { headers: { "content-type": "application/json", ...(init.headers || {}) }, ...init, signal: init.signal || controller.signal });
      lastRequestId = response.headers.get("x-request-id") || "";
      const payload = await response.json().catch(() => ({})) as T & { error?: string };
      if (!response.ok) throw new WidgetRequestError(payload.error || "The front desk is temporarily unavailable.", { status: response.status, retryable: response.status >= 500 || response.status === 408 || response.status === 429 });
      return payload;
    } catch (error) {
      if (error instanceof WidgetRequestError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") throw new WidgetRequestError("This is taking longer than expected.", { timedOut: true });
      throw new WidgetRequestError("The front desk is temporarily unavailable.");
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function syncConversation(includeHistory = false): Promise<void> {
    if (!conversationId) return;
    try {
      const payload = await api<ConversationPayload>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}`);
      if (payload.conversation?.status === "RESOLVED" || payload.conversation?.status === "EXPIRED") {
        conversationId = null;
        resetConversationUi();
        return;
      }
      lastConversationUpdatedAt = payload.conversation?.updatedAt || payload.conversation?.lastActivityAt || lastConversationUpdatedAt;
      if (payload.conversation?.leadCaptured) updateState({ leadCaptured: true, leadVisible: false });
      renderConversationStatus(payload.conversation?.status, { returning: includeHistory, notificationStatus: payload.conversation?.handoffNotificationStatus });
      const remoteMessages = payload.messages || [];
      if (includeHistory && remoteMessages.length) {
        state = {
          ...state,
          messages: remoteMessages.map((message) => ({
            id: `${message.createdAt || ""}:${message.role || ""}:${message.content || ""}`,
            remoteKey: `${message.createdAt || ""}:${message.role || ""}:${message.content || ""}`,
            role: message.role === "user" ? "user" : "assistant",
            content: `${message.authorName ? `${message.authorName}: ` : ""}${message.content || ""}`,
            citations: message.citations || [],
          })),
        };
        renderer.update({ state });
      } else {
        for (const message of remoteMessages) {
          if (message.role !== "human" && message.role !== "system") continue;
          const key = `${message.createdAt || ""}:${message.role || ""}:${message.content || ""}`;
          addMessage(`${message.authorName ? `${message.authorName}: ` : ""}${message.content || ""}`, "assistant", [], key);
        }
      }
      markPerformance("conversation_restored", { requestId: lastRequestId });
      setHealth("READY", "", { statusAction: undefined });
      flushPerformance();
    } catch {
      if (includeHistory) {
        markPerformance("conversation_restore_failed", { requestId: lastRequestId });
        setHealth("DEGRADED", "We couldn’t restore your previous conversation, but you can start a new one.", { statusAction: "new_conversation" });
        addMessage("We couldn’t restore your previous conversation, but you can start a new one.", "assistant");
      }
      // Polling is best-effort; the visitor can continue using the assistant.
    }
  }

  async function syncConversationStatus(): Promise<void> {
    if (!conversationId || statusSyncInFlight) return;
    statusSyncInFlight = true;
    try {
      const payload = await api<ConversationPayload>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}/status`);
      const remoteStatus = payload.conversation?.status || "AI_ACTIVE";
      if (remoteStatus === "RESOLVED" || remoteStatus === "EXPIRED") {
        conversationId = null;
        resetConversationUi();
        return;
      }
      if (payload.conversation?.leadCaptured) updateState({ leadCaptured: true, leadVisible: false });
      const remoteUpdatedAt = payload.conversation?.updatedAt || payload.conversation?.lastActivityAt || "";
      const statusChanged = remoteStatus !== (state.handoffStatus || "AI_ACTIVE");
      const conversationChanged = Boolean(remoteUpdatedAt && remoteUpdatedAt !== lastConversationUpdatedAt);
      lastConversationUpdatedAt = remoteUpdatedAt || lastConversationUpdatedAt;
      renderConversationStatus(remoteStatus, { notificationStatus: payload.conversation?.handoffNotificationStatus });
      if (conversationChanged || statusChanged) await syncConversation();
    } catch {
      // Status polling is best-effort; the visitor can continue using the assistant.
    } finally {
      statusSyncInFlight = false;
    }
  }

  function startPolling(): void {
    if (pollTimer !== null || !state.isOpen || !conversationId) return;
    void syncConversationStatus();
    pollTimer = window.setInterval(() => void syncConversationStatus(), 5000);
  }

  function stopPolling(): void {
    if (pollTimer === null) return;
    window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function renderActionForm(action: WidgetAction | null | undefined): void {
    const nextAction = action || null;
    const sameAction = Boolean(nextAction && state.action?.id === nextAction.id);
    updateState({
      action: nextAction,
      actionStep: sameAction ? state.actionStep || 0 : 0,
      actionValues: sameAction ? state.actionValues || {} : {},
    });
  }

  async function loadConfig(): Promise<void> {
    setHealth("LOADING", "Connecting to the front desk…");
    let agent: Partial<AgentConfig> = {};
    let configFailed = Boolean(bootstrap?.configError);
    try {
      const pendingConfig = bootstrap?.configPromise ? await bootstrap.configPromise : null;
      const payload = bootstrap?.config && !bootstrap.configError
        ? { agent: bootstrap.config as Partial<AgentConfig> }
        : pendingConfig
          ? { agent: pendingConfig as Partial<AgentConfig> }
          : await api<WidgetConfigResponse>(`/api/v1/widget/${encodeURIComponent(siteKey)}/config`, { cache: "default" });
      agent = payload.agent || {};
    } catch {
      configFailed = true;
    }
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
      fallbackContacts: agent.fallbackContacts || {},
      proactiveEnabled: agent.proactiveEnabled === true,
      proactiveDelaySeconds: Number(agent.proactiveDelaySeconds || 20),
      proactiveMessage: agent.proactiveMessage || "Looking for the right service? I can help.",
      proactiveTriggers: Array.isArray(agent.proactiveTriggers) ? agent.proactiveTriggers : [],
      proactiveBehavior: agent.proactiveBehavior === "open" ? "open" : "teaser",
      proactiveFrequency: agent.proactiveFrequency === "24h" || agent.proactiveFrequency === "visit" ? agent.proactiveFrequency : "session",
    };
    if (bootstrap) bootstrap.configError = configFailed;
    if (configFailed) markPerformance("bootstrap_config_failed");
    const shouldHydrateHistory = Boolean(conversationId && !state.messages.length);
    renderer.update({ config, state: { quickActions: state.quickActions.length ? state.quickActions : config.widgetQuickActions } });
    if (!state.messages.length) addMessage(config.welcomeMessage, "assistant");
    updateState({
      healthState: configFailed ? "CONFIG_ERROR" : "READY",
      statusMessage: configFailed ? "Front desk temporarily unavailable. Please try again in a moment." : "",
      statusContacts: config.fallbackContacts,
      statusAction: configFailed ? "retry" : undefined,
    });
    markPerformance("bootstrap_config_completed", { metadata: { source: bootstrap?.config ? "loader" : "shell" } });
    if (conversationId && state.isOpen) {
      void syncConversation(shouldHydrateHistory);
      startPolling();
    }
    if (!bootstrap) armProactiveEngagement(agent);
  }

  function proactiveStorageKey(suffix: string): string {
    const host = window.location.hostname || "unknown-host";
    return `frontdeskwise:${siteKey}:${host}:proactive:${suffix}`;
  }

  function proactiveSuppressed(frequency: string): boolean {
    try {
      if (frequency === "session" && ["shown", "dismissed", "opened"].some((suffix) => window.sessionStorage.getItem(proactiveStorageKey(suffix)) === "1")) return true;
      if (frequency === "24h") {
        const timestamp = Math.max(
          Number(window.localStorage.getItem(proactiveStorageKey("shownAt")) || 0),
          Number(window.localStorage.getItem(proactiveStorageKey("dismissedAt")) || 0),
          Number(window.localStorage.getItem(proactiveStorageKey("openedAt")) || 0),
        );
        return timestamp > 0 && Date.now() - timestamp < 24 * 60 * 60 * 1000;
      }
    } catch {
      // Best effort.
    }
    return false;
  }

  function suppressProactive(frequency: string, reason: "shown" | "dismissed" | "opened" = "shown"): void {
    try {
      if (frequency === "session") window.sessionStorage.setItem(proactiveStorageKey(reason), "1");
      if (frequency === "24h") window.localStorage.setItem(proactiveStorageKey(`${reason}At`), String(Date.now()));
    } catch {
      // Best effort.
    }
  }

  function hasActiveHandoff(): boolean {
    if (!conversationId) return false;
    return state.handoffStatus === "HUMAN_ACTIVE" || state.handoffStatus === "WAITING_FOR_STAFF" || state.handoffStatus === "HANDOFF_REQUESTED";
  }

  function clearProactiveEngagement(): void {
    proactiveTimers.forEach((timer) => window.clearTimeout(timer));
    proactiveTimers = [];
    proactiveCleanups.forEach((cleanup) => cleanup());
    proactiveCleanups = [];
  }

  function showProactivePrompt(): void {
    const activeHandoff = hasActiveHandoff();
    if (proactiveShown || !config || !config.proactiveEnabled || state.isOpen || activeHandoff) {
      if (activeHandoff) clearProactiveEngagement();
      return;
    }
    proactiveShown = true;
    clearProactiveEngagement();
    suppressProactive(config.proactiveFrequency || "session", "shown");
    markPerformance("proactive_triggered");
    telemetry("CTA_CLICKED", { metadata: { source: "proactive", action: "shown", behavior: config.proactiveBehavior || "teaser" } });
    if ((config.proactiveBehavior || "teaser") === "open") {
      renderer.open("proactive", false);
      addMessage(config.proactiveMessage || "Looking for the right service? I can help.", "assistant");
      return;
    }
    updateState({ proactive: { visible: true, message: config.proactiveMessage || "Looking for the right service? I can help." } });
    markPerformance("teaser_rendered");
  }

  function armProactiveEngagement(agent: Partial<AgentConfig>): void {
    if (proactiveArmed || !agent.proactiveEnabled || proactiveShown || hasActiveHandoff() || proactiveSuppressed(agent.proactiveFrequency || "session")) return;
    proactiveArmed = true;
    const triggers = Array.isArray(agent.proactiveTriggers) ? agent.proactiveTriggers : [];
    const oneShot = (): void => showProactivePrompt();
    if (triggers.includes("delay")) {
      const delaySeconds = Number(agent.proactiveDelaySeconds);
      proactiveTimers.push(window.setTimeout(oneShot, (Number.isFinite(delaySeconds) ? Math.max(10, delaySeconds) : 20) * 1000));
    }
    if (triggers.includes("returning")) {
      try {
        if (window.localStorage.getItem(proactiveStorageKey("visited"))) proactiveTimers.push(window.setTimeout(oneShot, 900));
        window.localStorage.setItem(proactiveStorageKey("visited"), "1");
      } catch {
        // Best effort.
      }
    }
    if (triggers.includes("scroll")) {
      // The embed listens to the host document's normal scroll position. Custom
      // overflow containers must forward their scroll state to the page to use
      // this trigger; PlanCraftAI uses normal document scrolling.
      const scrollProgress = (): number => {
        const documentElement = document.documentElement;
        const body = document.body;
        const scrollTop = Math.max(
          window.pageYOffset || 0,
          window.scrollY || 0,
          documentElement?.scrollTop || 0,
          body?.scrollTop || 0,
        );
        const documentHeight = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0);
        const viewportHeight = window.innerHeight || documentElement?.clientHeight || 0;
        const maxScroll = documentHeight - viewportHeight;
        return maxScroll > 0 ? scrollTop / maxScroll : 0;
      };
      let scrollFrame: number | null = null;
      const onScroll = (): void => {
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(() => {
          scrollFrame = null;
          if (scrollProgress() >= 0.7) oneShot();
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      proactiveCleanups.push(() => {
        window.removeEventListener("scroll", onScroll);
        if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
        scrollFrame = null;
      });
      onScroll();
    }
    if (triggers.includes("exit") && deviceType() === "desktop") {
      const onExit = (event: MouseEvent): void => {
        if (event.clientY > 0 || event.relatedTarget) return;
        if (event.target instanceof Node && host.contains(event.target)) return;
        oneShot();
      };
      document.addEventListener("mouseout", onExit, { passive: true });
      proactiveCleanups.push(() => document.removeEventListener("mouseout", onExit));
    }
  }

  function resetConversationUi(preserveMessage?: WidgetMessage): void {
    stopPolling();
    lastConversationUpdatedAt = "";
    handoffWaiting = false;
    handoffDismissedKey = null;
    if (handoffNoticeTimer !== null) {
      window.clearTimeout(handoffNoticeTimer);
      handoffNoticeTimer = null;
    }
    Object.keys(renderedRemoteMessages).forEach((key) => delete renderedRemoteMessages[key]);
    state = {
      ...state,
      messages: preserveMessage ? [preserveMessage] : [],
      quickActions: config?.widgetQuickActions || [],
      primaryCta: null,
      action: null,
      actionStep: 0,
      actionValues: {},
      leadCaptured: false,
      leadVisible: false,
      handoffStatus: "AI_ACTIVE",
      handoffNotice: { visible: false, message: "" },
    };
    renderer.update({ state });
    if (!preserveMessage && config?.welcomeMessage) addMessage(config.welcomeMessage, "assistant");
    else persistInteractionState();
  }

  async function startNewConversation(): Promise<void> {
    try {
      const started = await api<{ conversationId: string; resumed?: boolean }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations`, {
        method: "POST",
        body: JSON.stringify({ sessionId: visitorId, newConversation: true }),
      });
      conversationId = started.conversationId;
      resetConversationUi();
      setHealth("READY", "", { statusAction: undefined });
    } catch (error) {
      setHealth("TEMPORARY_ERROR", errorMessage(error, "We couldn’t start a new conversation. Please try again."), { statusAction: "new_conversation", statusContacts: fallbackContacts() });
    }
  }

  async function ask(question: string, retry: { messageId?: string; clientMessageId?: string } = {}): Promise<void> {
    if (!question) return;
    const sendStartedAt = performance.now();
    const clientMessageId = retry.clientMessageId || window.crypto?.randomUUID?.() || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const messageId = retry.messageId || addMessage(question, "user", [], undefined, { status: "sending", retryable: true, clientMessageId });
    if (retry.messageId) markPerformance("message_retry", { metadata: { retryable: true } });
    if (!online) {
      updateMessage(messageId, { status: "failed", retryable: true });
      setHealth("OFFLINE", "You’re offline. Your message is saved here and ready to retry when you reconnect.", { statusContacts: fallbackContacts() });
      return;
    }
    markPerformance("user_message_sent");
    updateState({ quickActions: [], leadVisible: false, primaryCta: null, typing: false, statusMessage: "", statusAction: undefined });
    lastQuestion = question;
    const softTimer = window.setTimeout(() => updateState({ typingMessage: "Still working…" }), MESSAGE_SOFT_TIMEOUT_MS);
    try {
      const started = await api<{ conversationId: string; resumed?: boolean }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations`, {
        method: "POST",
        body: JSON.stringify({ sessionId: visitorId }),
      });
      const conversationChanged = conversationId !== started.conversationId;
      conversationId = started.conversationId;
      if (conversationChanged) {
        const pendingMessage = state.messages.find((message) => message.id === messageId);
        resetConversationUi(pendingMessage);
      }
      if (started.resumed && (conversationChanged || state.messages.length <= 1)) await syncConversation(true);
      updateMessage(messageId, { status: "sending" });
      updateState({ typing: true });
      updateState({ typingMessage: "Assistant is thinking…", healthState: "LOADING" });
      const responseStartedAt = performance.now();
      const answer = await api<{ conversationId?: string; answer: string; grounded?: boolean; citations?: WidgetMessage["citations"]; quickActions?: WidgetState["quickActions"]; primaryCta?: WidgetPrimaryCta | null; action?: WidgetAction; handoff?: { notificationStatus?: string }; failure?: { kind?: string; retrievedEvidence?: boolean; retryable?: boolean }; conversation?: { status?: string; leadCaptured?: boolean; updatedAt?: string; handoffNotificationStatus?: string } }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}/messages`, { method: "POST", body: JSON.stringify({ question, sessionId: visitorId, pageUrl: window.location.href, clientMessageId }) }, MESSAGE_TIMEOUT_MS);
      const responseCompletedAt = performance.now();
      markPerformance("first_assistant_content_available", {
        durationMs: Math.round(responseCompletedAt - responseStartedAt),
        requestId: lastRequestId,
        metadata: { network_round_trip_ms: Math.round(responseCompletedAt - responseStartedAt) },
      });
      updateMessage(messageId, { status: "sent", retryable: false });
      updateState({ typing: false, typingMessage: "", healthState: answer.failure ? "TEMPORARY_ERROR" : "READY", statusMessage: answer.failure ? "I’m having trouble responding right now. Please try again in a moment." : "", statusAction: answer.failure ? "retry" : undefined });
      if (answer.conversationId && answer.conversationId !== conversationId) {
        conversationId = answer.conversationId;
        resetConversationUi();
      }
      if (answer.answer?.trim()) addMessage(answer.answer, "assistant", answer.citations || []);
      lastConversationUpdatedAt = answer.conversation?.updatedAt || lastConversationUpdatedAt;
      renderConversationStatus(answer.conversation?.status, { notificationStatus: answer.conversation?.handoffNotificationStatus || answer.handoff?.notificationStatus });
      if (conversationId && state.isOpen) startPolling();
      updateState({ quickActions: answer.quickActions || [], primaryCta: answer.primaryCta || null });
      if (answer.primaryCta) {
        telemetry("CTA_SHOWN", {
          flowId: answer.primaryCta.actionId,
          metadata: {
            source: "primary-conversion",
            actionId: answer.primaryCta.actionId,
            actionKey: answer.primaryCta.key,
            trackingKey: answer.primaryCta.trackingKey,
            executionMode: answer.primaryCta.executionMode,
          },
        });
      }
      renderActionForm(answer.action);
      const leadCaptured = state.leadCaptured === true || answer.conversation?.leadCaptured === true;
      if (leadCaptured) updateState({ leadCaptured: true, leadVisible: false });
      if (answer.action) updateState({ leadVisible: false });
      if (!leadCaptured && !answer.grounded && !answer.action && !(answer.quickActions && answer.quickActions.length) && !answer.failure && config?.showLeadCapture !== false) updateState({ leadVisible: true });
      requestAnimationFrame(() => {
        const renderedAt = performance.now();
        markPerformance("full_response_rendered", {
          durationMs: Math.round(renderedAt - sendStartedAt),
          requestId: lastRequestId,
          metadata: {
            frontend_send_ms: Math.round(responseStartedAt - sendStartedAt),
            network_round_trip_ms: Math.round(responseCompletedAt - responseStartedAt),
            render_ms: Math.round(renderedAt - responseCompletedAt),
            total_response_ms: Math.round(renderedAt - sendStartedAt),
          },
        });
        flushPerformance();
      });
    } catch (error) {
      updateMessage(messageId, { status: "failed", retryable: true });
      const offlineFailure = !navigator.onLine || (error instanceof WidgetRequestError && error.status === 0 && !error.timedOut);
      updateState({ typing: false, typingMessage: "", healthState: offlineFailure ? "OFFLINE" : "MESSAGE_FAILED", statusMessage: offlineFailure ? "Connection lost — trying to reconnect…" : errorMessage(error, "I’m having trouble responding right now. Please try again in a moment."), statusAction: "retry", statusContacts: fallbackContacts() });
      markPerformance("response_error", { requestId: lastRequestId, metadata: { retryable: true, timedOut: error instanceof WidgetRequestError && error.timedOut } });
      flushPerformance();
    } finally {
      window.clearTimeout(softTimer);
    }
  }

  async function submitAction(values: Record<string, string>, action: WidgetAction): Promise<void> {
    if (!conversationId || state.actionSubmitting) return;
    updateState({ actionSubmitting: true });
    const consent = state.consentGiven === true || values.consent === "true" || values.consent === "on";
    if (consent) rememberConsent();
    delete values.consent;
    const submissionMessageId = addMessage("Submitted your details.", "user", [], undefined, { status: "sending", retryable: false });
    updateState({ actionError: "" });
    try {
      const answer = await api<{ answer: string; citations?: WidgetMessage["citations"]; action?: WidgetAction; conversation?: { status?: string; leadCaptured?: boolean; updatedAt?: string } }>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(conversationId)}/actions/${encodeURIComponent(action.id)}/submit`, { method: "POST", body: JSON.stringify({ values, consent, pageUrl: window.location.href }) });
      updateMessage(submissionMessageId, { status: "sent" });
      addMessage(answer.answer, "assistant", answer.citations || []);
      updateState({ actionError: "", healthState: "READY" });
      lastConversationUpdatedAt = answer.conversation?.updatedAt || lastConversationUpdatedAt;
      renderConversationStatus(answer.conversation?.status);
      if (conversationId && state.isOpen) startPolling();
      if (answer.conversation?.leadCaptured) updateState({ leadCaptured: true, leadVisible: false });
      renderActionForm(answer.action);
    } catch (error) {
      updateMessage(submissionMessageId, { status: "failed", retryable: false });
      updateState({ actionError: "We couldn’t send your details. Your entries are still here — please try again.", healthState: "ACTION_FAILED" });
    } finally {
      updateState({ actionSubmitting: false });
    }
  }

  async function submitLead(values: { name: string; email: string; phone: string; consent: boolean }): Promise<void> {
    if (!values.name || !values.email || !conversationId || state.leadSubmitting) return;
    const consent = state.consentGiven === true || values.consent;
    if (config?.requireLeadConsent && !consent) {
      addMessage("Please confirm that you agree to share your details.", "assistant");
      return;
    }
    if (consent) rememberConsent();
    updateState({ leadSubmitting: true });
    try {
      await api(`/api/v1/widget/${encodeURIComponent(siteKey)}/leads`, { method: "POST", body: JSON.stringify({ conversationId, name: values.name, email: values.email, phone: values.phone || null, intent: lastQuestion, consent: true, consentAt: new Date().toISOString() }) });
      updateState({ leadCaptured: true, leadVisible: false });
      addMessage("Thanks — the team can follow up with you.", "assistant");
    } catch (error) {
      addMessage("We couldn’t send your details. Your entries are still here — please try again.", "assistant");
      setHealth("ACTION_FAILED", "", { statusContacts: fallbackContacts() });
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
  state = { ...state, consentGiven: hasRememberedConsent() };
  restoreInteractionState();
  window.addEventListener("offline", () => {
    online = false;
    markPerformance("network_offline");
    setHealth("OFFLINE", "", { connectionState: "offline", statusContacts: fallbackContacts() });
  });
  window.addEventListener("online", () => {
    online = true;
    markPerformance("network_restored");
    if (restoredStatusTimer !== null) window.clearTimeout(restoredStatusTimer);
    setHealth("READY", "Connected", { connectionState: "restored", statusAction: undefined, statusContacts: undefined });
    restoredStatusTimer = window.setTimeout(() => {
      restoredStatusTimer = null;
      updateState({ statusMessage: "", connectionState: "online" });
    }, 2200);
  });
  renderer = createWidgetRenderer(mount, {
    surface: "embed",
    config: DEFAULT_CONFIG,
    state,
    onOpen: (source, userInitiated = true) => {
      state = {
        ...state,
        isOpen: true,
        openedByUser: state.openedByUser || userInitiated,
        proactive: { ...(state.proactive || { visible: false, message: "" }), visible: false },
      };
      persistInteractionState();
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session", "opened");
      startPolling();
      telemetry("CTA_CLICKED", { metadata: { source } });
      requestAnimationFrame(() => {
        markPerformance("full_shell_visible");
        flushPerformance();
      });
    },
    onClose: () => {
      state = { ...state, isOpen: false, openedByUser: false };
      persistInteractionState();
      stopPolling();
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session", "opened");
    },
    onAsk: (question) => { void ask(question); },
    onPrimaryCtaClick: (cta) => {
      telemetry(cta.executionMode === "DIRECT_LINK" ? "DEMO_LINK_OPENED" : "CTA_CLICKED", { flowId: cta.actionId, metadata: { source: "primary-conversion", actionId: cta.actionId, actionKey: cta.key, trackingKey: cta.trackingKey, executionMode: cta.executionMode } });
    },
    onRetryConfig: () => { void loadConfig(); },
    onRetryMessage: (message) => { void ask(message.content, { messageId: message.id, clientMessageId: message.status === "failed" ? message.clientMessageId : undefined }); },
    onActionSubmit: (values, action) => { void submitAction(values, action); },
    onActionValuesChange: (values, action) => {
      if (state.action?.id !== action.id) return;
      state = { ...state, actionValues: values };
      persistInteractionState();
    },
    onConsentChange: (consent) => {
      if (consent) rememberConsent();
      else forgetConsent();
      state = { ...state, consentGiven: consent };
      persistInteractionState();
    },
    onLeadSubmit: (values) => { void submitLead(values); },
    onHandoffContinue: () => {
      showHandoffNotice(state.healthState === "HANDOFF_DEGRADED" ? "Your message has been saved for the team." : "A team member has been notified.");
    },
    onNewConversation: () => { void startNewConversation(); },
    onHandoffDismiss: () => {
      persistHandoffDismissal();
      hideHandoffNotice();
      telemetry("CTA_CLICKED", { metadata: { source: "handoff-status", action: "dismissed", conversationStatus: handoffWaiting ? "WAITING_FOR_STAFF" : undefined } });
    },
    onProactiveDismiss: () => {
      state = { ...state, proactive: { ...(state.proactive || { visible: false, message: "" }), visible: false } };
      persistInteractionState();
      clearProactiveEngagement();
      proactiveShown = true;
      if (config) suppressProactive(config.proactiveFrequency || "session", "dismissed");
      telemetry("CTA_CLICKED", { metadata: { source: "proactive", action: "dismissed" } });
    },
  });
  renderer.update({ state });
  if (bootstrap?.openOnReady) renderer.open(bootstrap.openSource || "launcher", true);
  window.addEventListener("pagehide", recordAbandonment);
  void loadConfig().catch(() => { /* A manual open retries when the API is available. */ });
})();

