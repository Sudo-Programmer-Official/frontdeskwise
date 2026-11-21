import { chromium, type Browser, type Page } from "playwright";
import type { RenderedPage } from "./crawler.js";
import { classifyPage } from "./page-classification.js";

const RENDER_NAVIGATION_TIMEOUT_MS = 12_000;
const RENDER_SETTLE_TIMEOUT_MS = 8_000;
const RENDER_NETWORK_IDLE_TIMEOUT_MS = 3_500;
const RENDER_MAX_HTML_BYTES = 4_000_000;
const MIN_RENDERED_TEXT_CHARS = 120;

type RenderedPageAdapter = ((url: string) => Promise<RenderedPage | null>) & {
  close: () => Promise<void>;
};

let browserPromise: Promise<Browser> | null = null;

function siteKey(url: URL): string {
  return `${url.protocol}//${url.hostname.replace(/^www\./i, "")}${url.port ? `:${url.port}` : ""}`;
}

function sameOriginSite(value: string, root: URL): boolean {
  try {
    const candidate = new URL(value);
    return ["http:", "https:"].includes(candidate.protocol) && siteKey(candidate) === siteKey(root);
  } catch {
    return false;
  }
}

async function browserInstance(): Promise<Browser> {
  if (!browserPromise) {
    const args = ["--disable-dev-shm-usage"];
    if (process.env.FRONTDESKWISE_BROWSER_NO_SANDBOX?.trim().toLowerCase() === "true") args.push("--no-sandbox");
    browserPromise = chromium.launch({ headless: true, args });
  }
  return browserPromise;
}

async function removeNonContentNoise(page: Page): Promise<void> {
  await page.evaluate(() => {
    const selectors = [
      "script",
      "style",
      "noscript",
      "template",
      "svg",
      "[hidden]",
      '[aria-hidden="true"]',
      '[role="dialog"]',
      '[role="alertdialog"]',
      '[id*="cookie" i]',
      '[class*="cookie" i]',
      '[id*="consent" i]',
      '[class*="consent" i]',
    ];
    for (const node of document.querySelectorAll(selectors.join(","))) node.remove();
  });
}

async function rootStats(page: Page): Promise<{ selector: string; textCharacters: number }> {
  return page.evaluate(() => {
    const selectors = ["#app", "#root", "[data-reactroot]", "[data-v-app]", "main", "body"];
    for (const selector of selectors) {
      const element = document.querySelector(selector) as HTMLElement | null;
      const textCharacters = element?.innerText?.trim().length ?? 0;
      if (element && textCharacters > 0) return { selector, textCharacters };
    }
    return { selector: "body", textCharacters: document.body?.innerText?.trim().length ?? 0 };
  });
}

async function renderPage(url: string): Promise<RenderedPage> {
  const startedAt = Date.now();
  const root = new URL(url);
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  let stage = "browser_launch";
  let httpStatus: number | null = null;
  let rootSelector: string | null = null;
  let initialTextCharacters = 0;
  let renderedTextCharacters = 0;
  let domBytes = 0;
  let networkSettled = false;
  const routeType = classifyPage(url);
  const diagnostics = (success: boolean, failureReason: string | null = null): RenderedPage["renderDiagnostics"] => ({
    attempted: true,
    success,
    durationMs: Date.now() - startedAt,
    httpStatus,
    failureReason,
    rootSelector,
    initialTextCharacters,
    renderedTextCharacters,
    domBytes,
    networkSettled,
    timeoutStage: failureReason?.startsWith("render_timeout:") ? stage : null,
    routeType,
  });
  try {
    const browser = await browserInstance();
    stage = "context_create";
    context = await browser.newContext({
      javaScriptEnabled: true,
      serviceWorkers: "block",
      viewport: { width: 1440, height: 1200 },
      userAgent: "FrontDeskWise-RenderedCrawler/1.0",
    });
    stage = "page_create";
    const page = await context.newPage();
    stage = "route_setup";
    await page.route("**/*", async (route) => {
      const requestUrl = route.request().url();
      if (/^(data:|blob:|about:)/i.test(requestUrl)) return route.abort();
      // Keep discovery and top-level navigation same-origin, but allow the
      // page's own public scripts/XHR/styles/images to load from a CDN or API
      // origin. Many legitimate SPAs cannot render without those resources.
      // No clicks, form submissions, or cross-origin document navigation are
      // performed by this renderer.
      if (!sameOriginSite(requestUrl, root) && (route.request().isNavigationRequest() || route.request().resourceType() === "document")) return route.abort();
      return route.continue();
    });
    page.on("dialog", (dialog) => void dialog.dismiss());

    stage = "navigation";
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: RENDER_NAVIGATION_TIMEOUT_MS,
    });
    httpStatus = response?.status() ?? null;
    if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 400)) {
      return {
        html: "",
        renderDiagnostics: diagnostics(false, `render_http_${httpStatus}`),
      };
    }

    stage = "settling";
    const initialStats = await rootStats(page);
    rootSelector = initialStats.selector;
    initialTextCharacters = initialStats.textCharacters;
    try {
      await page.waitForLoadState("networkidle", { timeout: RENDER_NETWORK_IDLE_TIMEOUT_MS });
      networkSettled = true;
    } catch {
      // Some sites keep analytics connections open. The bounded root-content
      // wait below is the authoritative readiness signal.
    }
    await page.waitForFunction(
      (minimumChars) => {
        const selectors = ["#app", "#root", "[data-reactroot]", "[data-v-app]", "main", "body"];
        return selectors.some((selector) => ((document.querySelector(selector) as HTMLElement | null)?.innerText ?? "").trim().length >= minimumChars);
      },
      MIN_RENDERED_TEXT_CHARS,
      { timeout: RENDER_SETTLE_TIMEOUT_MS },
    );
    await page.waitForTimeout(250);
    stage = "content_extraction";
    await removeNonContentNoise(page);
    const finalStats = await rootStats(page);
    rootSelector = finalStats.selector;
    renderedTextCharacters = finalStats.textCharacters;
    const html = await page.content();
    domBytes = new TextEncoder().encode(html).byteLength;
    if (domBytes > RENDER_MAX_HTML_BYTES) {
      return {
        html: "",
        renderDiagnostics: diagnostics(false, "rendered_html_too_large"),
      };
    }
    if (renderedTextCharacters < MIN_RENDERED_TEXT_CHARS) return { html: "", renderDiagnostics: diagnostics(false, "rendered_content_below_threshold") };
    return {
      html,
      url: page.url(),
      contentType: response?.headers()["content-type"] ?? "text/html; charset=utf-8",
      rawHtmlBytes: domBytes,
      renderDiagnostics: diagnostics(true),
    };
  } catch (error) {
    const detail = error instanceof Error
      ? error.message.replace(/https?:\/\/\S+/gi, "[url]").replace(/\s+/g, " ").trim().slice(0, 240)
      : "unknown error";
    return {
      html: "",
      renderDiagnostics: diagnostics(false, error instanceof Error && /timeout/i.test(error.message)
        ? `render_timeout:${stage}`
        : `render_error:${stage}:${detail}`),
    };
  } finally {
    await context?.close().catch(() => undefined);
  }
}

export function createRenderedPageAdapter(): RenderedPageAdapter {
  const adapter = (url: string) => renderPage(url);
  adapter.close = async () => {
    const current = browserPromise;
    browserPromise = null;
    if (current) await (await current).close().catch(() => undefined);
  };
  return adapter;
}

