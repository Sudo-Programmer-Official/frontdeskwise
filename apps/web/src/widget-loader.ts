type AgentConfig = {
  assistantName?: string;
  welcomeMessage?: string;
  widgetColor?: string;
  widgetPosition?: "bottom-right" | "bottom-left";
  proactiveEnabled?: boolean;
  proactiveDelaySeconds?: number;
  proactiveMessage?: string;
  proactiveTriggers?: string[];
  proactiveBehavior?: "teaser" | "open";
  proactiveFrequency?: "session" | "24h" | "visit";
  [key: string]: unknown;
};

type WidgetConfigResponse = { agent?: AgentConfig };

type PerformanceEvent = {
  event: string;
  atMs: number;
  durationMs?: number;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

type WidgetPerformanceRuntime = {
  siteKey: string;
  apiBase: string;
  events: PerformanceEvent[];
  sentCount: number;
  mark: (event: string, details?: Omit<PerformanceEvent, "event" | "atMs">) => void;
  flush: () => Promise<void>;
};

type WidgetBootstrap = {
  siteKey: string;
  apiBase: string;
  host: HTMLDivElement;
  shadow: ShadowRoot;
  config: AgentConfig | null;
  openOnReady?: boolean;
  openSource?: "launcher" | "proactive";
  configPromise?: Promise<unknown>;
  performance: WidgetPerformanceRuntime;
};

type CachedConfig = {
  agent: AgentConfig;
  cachedAt: number;
};

type FrontDeskWiseWindow = Window & {
  __FRONTDESKWISE_WIDGET_BOOTSTRAP__?: WidgetBootstrap;
};

function normalizeWidgetPath(value: string): string {
  const path = value.trim().split(/[?#]/, 1)[0] || "/";
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  const collapsed = withLeadingSlash.replace(/\/+/g, "/");
  return collapsed === "/" ? "/" : collapsed.replace(/\/+$/, "");
}

function parseWidgetPagePatterns(value: string | undefined): string[] {
  return [...new Set((value || "")
    .split(",")
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .map((pattern) => pattern === "*" ? "*" : normalizeWidgetPath(pattern)))];
}

function widgetPageMatches(patterns: string[], pathname: string): boolean {
  if (!patterns.length) return true;
  const currentPath = normalizeWidgetPath(pathname);
  return patterns.some((pattern) => {
    if (pattern === "*" || pattern === "/*") return true;
    if (!pattern.endsWith("*")) return currentPath === normalizeWidgetPath(pattern);
    const prefix = normalizeWidgetPath(pattern.slice(0, -1));
    return currentPath === prefix || currentPath.startsWith(`${prefix}/`);
  });
}

(() => {
  "use strict";

  const startedAt = typeof performance !== "undefined" ? performance.now() : 0;
  const currentScript = document.currentScript as HTMLScriptElement | null;
  if (!currentScript || !currentScript.dataset.site) return;
  const script = currentScript;
  const pagePatterns = parseWidgetPagePatterns(script.dataset.pages);
  if (!widgetPageMatches(pagePatterns, window.location.pathname)) return;

  const siteKey = script.dataset.site || "";
  if (!siteKey) return;
  const scriptUrl = new URL(script.src, window.location.href);
  const configuredApiOrigin = script.dataset.api?.trim();
  const fallbackApiOrigin = /(^|\.)frontdeskwise\.com$/i.test(scriptUrl.hostname)
    ? "https://api.frontdeskwise.com"
    : scriptUrl.origin;
  const apiBase = (configuredApiOrigin || fallbackApiOrigin).replace(/\/$/, "");
  const widgetWindow = window as FrontDeskWiseWindow;
  const cacheTtlMs = 60_000;
  const staleWhileRevalidateMs = 5 * 60_000;
  const performanceRuntime: WidgetPerformanceRuntime = {
    siteKey,
    apiBase,
    events: [],
    sentCount: 0,
    mark(event, details = {}) {
      this.events.push({ event, atMs: Math.round((performance.now?.() ?? 0) - startedAt), ...details });
    },
    async flush() {
      if (this.sentCount >= this.events.length) return;
      const events = this.events.slice(this.sentCount, this.events.length);
      this.sentCount = this.events.length;
      try {
        await fetch(`${apiBase}/api/v1/widget/${encodeURIComponent(siteKey)}/performance`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ events, sourcePage: window.location.href, device: deviceType() }),
          keepalive: true,
        });
      } catch {
        // Diagnostics must never interrupt the visitor flow.
      }
    },
  };
  performanceRuntime.mark("loader_requested");
  const loaderResource = typeof performance !== "undefined" && typeof performance.getEntriesByName === "function"
    ? performance.getEntriesByName(script.src, "resource")[0] as PerformanceResourceTiming | undefined
    : undefined;
  performanceRuntime.mark("loader_downloaded", {
    durationMs: loaderResource?.responseEnd && loaderResource.startTime >= 0
      ? Math.round(loaderResource.responseEnd - loaderResource.startTime)
      : undefined,
    metadata: { resourceTimingAvailable: Boolean(loaderResource) },
  });

  const host = document.createElement("div");
  host.setAttribute("data-frontdeskwise-widget", siteKey);
  host.style.cssText = "position:fixed;inset:auto 0 0 0;width:0;height:0;z-index:2147483000;pointer-events:none;";
  const parent = document.body || document.documentElement;
  parent.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = `
    :host { all: initial; }
    .fdw-loader-launcher, .fdw-loader-teaser { font-family: Inter, ui-sans-serif, system-ui, -apple-system, sans-serif; }
    .fdw-loader-launcher { position: fixed; right: 22px; bottom: 22px; display: grid; place-items: center; width: 58px; height: 58px; padding: 0; border: 0; border-radius: 18px; color: #fff; background: #0d6efd; box-shadow: 0 14px 30px rgba(13, 75, 160, .28); cursor: pointer; pointer-events: auto; transition: transform .18s ease, opacity .18s ease; }
    .fdw-loader-launcher:hover { transform: translateY(-2px); }
    .fdw-loader-launcher:focus-visible, .fdw-loader-teaser button:focus-visible { outline: 3px solid rgba(13, 110, 253, .35); outline-offset: 3px; }
    .fdw-loader-launcher[hidden], .fdw-loader-teaser[hidden] { display: none; }
    .fdw-loader-symbol { width: 26px; height: 26px; }
    .fdw-loader-teaser { position: fixed; right: 22px; bottom: 92px; display: flex; align-items: flex-start; gap: 9px; width: min(320px, calc(100vw - 32px)); padding: 14px 13px; border: 1px solid #d3e1f2; border-radius: 14px; color: #244d7e; background: #fff; box-shadow: 0 18px 42px rgba(13, 44, 91, .2); pointer-events: auto; }
    .fdw-loader-teaser-copy { min-width: 0; flex: 1; font-size: 12px; font-weight: 650; line-height: 1.4; }
    .fdw-loader-teaser-action { display: inline-flex; margin-top: 8px; padding: 0; border: 0; color: #0d6efd; background: transparent; cursor: pointer; font-size: 11px; font-weight: 800; }
    .fdw-loader-teaser-dismiss { display: grid; width: 22px; height: 22px; flex: 0 0 22px; place-items: center; margin: -4px -4px 0 0; padding: 0; border: 0; border-radius: 50%; color: #6c7e94; background: transparent; cursor: pointer; font-size: 17px; line-height: 1; }
    .fdw-loader-teaser-dismiss:hover { color: #244d7e; background: #edf4fc; }
    @media (max-width: 640px) { .fdw-loader-launcher { right: 16px; bottom: 16px; } .fdw-loader-teaser { right: 16px; bottom: 84px; } }
  `;
  const launcher = document.createElement("button");
  launcher.className = "fdw-loader-launcher";
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open AI front desk");
  launcher.innerHTML = '<svg class="fdw-loader-symbol" viewBox="0 0 64 64" aria-hidden="true"><path d="m32 12 4.8 12.2L49 29l-12.2 4.8L32 46l-4.8-12.2L15 29l12.2-4.8L32 12Z" fill="currentColor"></path></svg>';
  const teaser = document.createElement("div");
  teaser.className = "fdw-loader-teaser";
  teaser.hidden = true;
  teaser.setAttribute("role", "status");
  teaser.innerHTML = '<div class="fdw-loader-teaser-copy"><span class="fdw-loader-teaser-message"></span><button class="fdw-loader-teaser-action" type="button">Open assistant →</button></div><button class="fdw-loader-teaser-dismiss" type="button" aria-label="Dismiss assistant message">×</button>';
  shadow.append(style, launcher, teaser);
  performanceRuntime.mark("launcher_rendered");
  window.addEventListener("pagehide", () => { void performanceRuntime.flush(); }, { once: true });

  const cacheKey = `frontdeskwise:widget-config:${apiBase}:${siteKey}`;
  let config: AgentConfig | null = null;
  let configPromise: Promise<AgentConfig | null> = Promise.resolve(null);
  let shellPromise: Promise<void> | null = null;
  let proactiveShown = false;
  let userOpened = false;
  let proactiveTimers: number[] = [];
  let proactiveCleanups: Array<() => void> = [];
  let scrollFrame: number | null = null;

  function deviceType(): "mobile" | "desktop" {
    return window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
  }

  function normalizeHex(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const hex = value.trim();
    return /^#[0-9a-f]{6}$/i.test(hex) ? hex : null;
  }

  function applyLauncherConfig(agent: AgentConfig): void {
    const color = normalizeHex(agent.widgetColor);
    if (color) launcher.style.background = color;
    if (agent.widgetPosition === "bottom-left") {
      launcher.style.right = "auto";
      launcher.style.left = "22px";
      teaser.style.right = "auto";
      teaser.style.left = "22px";
    }
    const message = typeof agent.proactiveMessage === "string" && agent.proactiveMessage.trim()
      ? agent.proactiveMessage.trim()
      : "Looking for the right service? I can help.";
    teaser.querySelector<HTMLElement>(".fdw-loader-teaser-message")!.textContent = message;
  }

  function cacheRead(): CachedConfig | null {
    try {
      const raw = window.localStorage.getItem(cacheKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<CachedConfig>;
      return parsed.agent && typeof parsed.cachedAt === "number" ? { agent: parsed.agent, cachedAt: parsed.cachedAt } : null;
    } catch {
      return null;
    }
  }

  function cacheWrite(agent: AgentConfig): void {
    try {
      window.localStorage.setItem(cacheKey, JSON.stringify({ agent, cachedAt: Date.now() } satisfies CachedConfig));
    } catch {
      // Best effort; a fresh network response remains authoritative.
    }
  }

  async function fetchConfig(): Promise<AgentConfig | null> {
    try {
      const response = await fetch(`${apiBase}/api/v1/widget/${encodeURIComponent(siteKey)}/config`, {
        headers: { accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) return null;
      const payload = await response.json() as WidgetConfigResponse;
      const agent = payload.agent && typeof payload.agent === "object" ? payload.agent : null;
      if (agent) cacheWrite(agent);
      return agent;
    } catch {
      return null;
    }
  }

  function clearProactiveEngagement(): void {
    proactiveTimers.forEach((timer) => window.clearTimeout(timer));
    proactiveTimers = [];
    proactiveCleanups.forEach((cleanup) => cleanup());
    proactiveCleanups = [];
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    scrollFrame = null;
  }

  function proactiveStorageKey(suffix: string): string {
    const hostName = window.location.hostname || "unknown-host";
    return `frontdeskwise:${siteKey}:${hostName}:proactive:${suffix}`;
  }

  function proactiveSuppressed(frequency: string): boolean {
    try {
      if (window.sessionStorage.getItem(proactiveStorageKey("opened")) === "1") return true;
      if (frequency === "session" && ["shown", "dismissed"].some((suffix) => window.sessionStorage.getItem(proactiveStorageKey(suffix)) === "1")) return true;
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
      if (frequency === "session" || reason === "opened") window.sessionStorage.setItem(proactiveStorageKey(reason), "1");
      if (frequency === "24h") window.localStorage.setItem(proactiveStorageKey(`${reason}At`), String(Date.now()));
    } catch {
      // Best effort.
    }
  }

  function loadShell(source: "launcher" | "proactive"): Promise<void> {
    if (shellPromise) return shellPromise;
    clearProactiveEngagement();
    launcher.disabled = true;
    launcher.style.opacity = "0.72";
    const bootstrap: WidgetBootstrap = {
      siteKey,
      apiBase,
      host,
      shadow,
      config,
      openOnReady: true,
      openSource: source,
      configPromise,
      performance: performanceRuntime,
    };
    widgetWindow.__FRONTDESKWISE_WIDGET_BOOTSTRAP__ = bootstrap;
    const configuredShell = script.dataset.shell;
    const scriptUrl = new URL(script.src, window.location.href);
    let shellUrl = configuredShell || new URL("widget-shell.js", scriptUrl).toString();
    if (!configuredShell && scriptUrl.hostname === "frontdeskwise.com") {
      scriptUrl.hostname = "www.frontdeskwise.com";
      shellUrl = new URL("widget-shell.js", scriptUrl).toString();
    }
    shellPromise = new Promise<void>((resolve, reject) => {
      const shell = document.createElement("script");
      shell.async = true;
      shell.src = shellUrl;
      shell.dataset.site = siteKey;
      shell.dataset.api = apiBase;
      if (script.dataset.pages) shell.dataset.pages = script.dataset.pages;
      shell.onload = () => resolve();
      shell.onerror = () => {
        shellPromise = null;
        launcher.disabled = false;
        launcher.style.opacity = "";
        reject(new Error("The assistant could not be loaded."));
      };
      (document.head || document.documentElement).appendChild(shell);
    });
    return shellPromise;
  }

  function showProactivePrompt(): void {
    if (proactiveShown || userOpened || !config?.proactiveEnabled) return;
    proactiveShown = true;
    clearProactiveEngagement();
    const frequency = config.proactiveFrequency || "session";
    suppressProactive(frequency, "shown");
    performanceRuntime.mark("proactive_triggered");
    if (config.proactiveBehavior === "open") {
      void loadShell("proactive");
      return;
    }
    teaser.hidden = false;
    performanceRuntime.mark("teaser_rendered");
  }

  function armProactiveEngagement(agent: AgentConfig): void {
    if (!agent.proactiveEnabled || proactiveShown || userOpened || proactiveSuppressed(agent.proactiveFrequency || "session")) return;
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
      const scrollProgress = (): number => {
        const documentElement = document.documentElement;
        const body = document.body;
        const scrollTop = Math.max(window.pageYOffset || 0, window.scrollY || 0, documentElement?.scrollTop || 0, body?.scrollTop || 0);
        const documentHeight = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0);
        const viewportHeight = window.innerHeight || documentElement?.clientHeight || 0;
        const maxScroll = documentHeight - viewportHeight;
        return maxScroll > 0 ? scrollTop / maxScroll : 0;
      };
      const onScroll = (): void => {
        if (scrollFrame !== null) return;
        scrollFrame = window.requestAnimationFrame(() => {
          scrollFrame = null;
          if (scrollProgress() >= 0.7) oneShot();
        });
      };
      window.addEventListener("scroll", onScroll, { passive: true });
      proactiveCleanups.push(() => window.removeEventListener("scroll", onScroll));
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

  launcher.addEventListener("click", () => {
    userOpened = true;
    proactiveShown = true;
    clearProactiveEngagement();
    suppressProactive(config?.proactiveFrequency || "session", "opened");
    performanceRuntime.mark("launcher_clicked");
    void loadShell("launcher").then(() => performanceRuntime.flush()).catch(() => { /* Shell failure is visible through launcher recovery. */ });
  });
  teaser.querySelector<HTMLButtonElement>(".fdw-loader-teaser-action")!.addEventListener("click", () => {
    performanceRuntime.mark("teaser_clicked");
    teaser.hidden = true;
    if (config) suppressProactive(config.proactiveFrequency || "session", "opened");
    void loadShell("proactive").then(() => performanceRuntime.flush()).catch(() => { /* Shell failure is visible through launcher recovery. */ });
  });
  teaser.querySelector<HTMLButtonElement>(".fdw-loader-teaser-dismiss")!.addEventListener("click", () => {
    performanceRuntime.mark("teaser_dismissed");
    teaser.hidden = true;
    clearProactiveEngagement();
    proactiveShown = true;
    if (config) suppressProactive(config.proactiveFrequency || "session", "dismissed");
  });

  const cached = cacheRead();
  if (cached) {
    config = cached.agent;
    applyLauncherConfig(config);
    performanceRuntime.mark("proactive_config_available", { metadata: { source: "cache" } });
    if (Date.now() - cached.cachedAt <= cacheTtlMs) {
      armProactiveEngagement(config);
    } else if (Date.now() - cached.cachedAt <= cacheTtlMs + staleWhileRevalidateMs) {
      armProactiveEngagement(config);
      configPromise = fetchConfig().then((fresh) => {
        if (!fresh) return null;
        config = fresh;
        applyLauncherConfig(fresh);
        performanceRuntime.mark("proactive_config_revalidated", { metadata: { source: "network" } });
        return fresh;
      });
    }
  }
  if (!cached || Date.now() - cached.cachedAt > cacheTtlMs + staleWhileRevalidateMs) {
    configPromise = fetchConfig().then((fresh) => {
      if (!fresh) return null;
      config = fresh;
      applyLauncherConfig(fresh);
      performanceRuntime.mark("proactive_config_available", { metadata: { source: "network" } });
      if (!proactiveShown && !userOpened) {
        clearProactiveEngagement();
        armProactiveEngagement(fresh);
      }
      return fresh;
    });
  }
})();
