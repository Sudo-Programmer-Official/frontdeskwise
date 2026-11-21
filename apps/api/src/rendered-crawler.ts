import { chromium, type Browser, type Page } from "playwright";
import type { RenderedPage } from "./crawler.js";

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

async function renderPage(url: string): Promise<RenderedPage> {
  const startedAt = Date.now();
  const root = new URL(url);
  let context: Awaited<ReturnType<Browser["newContext"]>> | null = null;
  let stage = "browser_launch";
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
      if (!sameOriginSite(requestUrl, root)) return route.abort();
      return route.continue();
    });
    page.on("dialog", (dialog) => void dialog.dismiss());

    stage = "navigation";
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: RENDER_NAVIGATION_TIMEOUT_MS,
    });
    const httpStatus = response?.status() ?? null;
    if (httpStatus !== null && (httpStatus < 200 || httpStatus >= 400)) {
      return {
        html: "",
        renderDiagnostics: {
          attempted: true,
          success: false,
          durationMs: Date.now() - startedAt,
          httpStatus,
          failureReason: `render_http_${httpStatus}`,
        },
      };
    }

    stage = "settling";
    await page.waitForLoadState("networkidle", { timeout: RENDER_NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
    await page.waitForFunction(
      (minimumChars) => {
        const rootElement = document.querySelector("#app, #root, [data-reactroot], [data-v-app], main") ?? document.body;
        return ((rootElement as HTMLElement | null)?.innerText ?? "").trim().length >= minimumChars;
      },
      MIN_RENDERED_TEXT_CHARS,
      { timeout: RENDER_SETTLE_TIMEOUT_MS },
    );
    await page.waitForTimeout(250);
    stage = "content_extraction";
    await removeNonContentNoise(page);
    const html = await page.content();
    const bytes = new TextEncoder().encode(html).byteLength;
    if (bytes > RENDER_MAX_HTML_BYTES) {
      return {
        html: "",
        renderDiagnostics: {
          attempted: true,
          success: false,
          durationMs: Date.now() - startedAt,
          httpStatus,
          failureReason: "rendered_html_too_large",
        },
      };
    }
    return {
      html,
      url: page.url(),
      contentType: response?.headers()["content-type"] ?? "text/html; charset=utf-8",
      rawHtmlBytes: bytes,
      renderDiagnostics: {
        attempted: true,
        success: true,
        durationMs: Date.now() - startedAt,
        httpStatus,
      },
    };
  } catch (error) {
    const detail = error instanceof Error
      ? error.message.replace(/https?:\/\/\S+/gi, "[url]").replace(/\s+/g, " ").trim().slice(0, 240)
      : "unknown error";
    return {
      html: "",
      renderDiagnostics: {
        attempted: true,
        success: false,
        durationMs: Date.now() - startedAt,
        failureReason: error instanceof Error && /timeout/i.test(error.message)
          ? `render_timeout:${stage}`
          : `render_error:${stage}:${detail}`,
      },
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

