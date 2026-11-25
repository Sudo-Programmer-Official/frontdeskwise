import { createHash, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { classifyPage, crawlPriority, type PageType } from "./page-classification.js";
import { extractWebsiteActions, type WebsiteActionCandidate } from "./website-actions.js";
import { type OnboardingFailureCode } from "./onboarding-validation.js";

const MAX_HTML_BYTES = 1_000_000;
const CRAWL_TIMEOUT_MS = 8_000;
const MAX_PAGES = 20;
const MAX_DEPTH = 2;
const TARGET_CHUNK_TOKENS = 520;
const CHUNK_OVERLAP_TOKENS = 80;
const MIN_VISIBLE_TEXT_FOR_SPA_CHECK = 120;
const MAX_SITEMAPS = 4;
const MAX_SITEMAP_URLS = 100;
const MAX_REDIRECTS = 5;

export class CrawlError extends Error {
  statusCode = 422;
  audit?: CrawlAudit;
  code: OnboardingFailureCode;
  retryable: boolean;

  constructor(message: string, code: OnboardingFailureCode = "CRAWL_ERROR", retryable = true) {
    super(message);
    this.name = "CrawlError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type CrawlChunk = {
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
};

export type CrawledPage = {
  url: string;
  canonicalUrl: string;
  title: string;
  contentHash: string;
  pageType: PageType;
  lastCrawledAt: string;
  chunks: CrawlChunk[];
  httpStatus?: number | null;
  rawHtmlBytes?: number;
  extractedCharacterCount?: number;
  discoveredLinkCount?: number;
  crawlMode?: "static" | "rendered";
  renderAttempted?: boolean;
  renderSuccess?: boolean;
  renderDurationMs?: number | null;
  renderDiagnostics?: RenderDiagnostics | null;
  crawlDepth?: number;
  discoveryParentUrl?: string | null;
  actionCandidates?: WebsiteActionCandidate[];
};

export type WebsiteEmbedPolicy = {
  xFrameOptions: string | null;
  frameAncestors: string | null;
};

/**
 * Read the response directives that browsers use to decide whether a page may
 * be rendered in an iframe. The crawler can still read/index a page when these
 * directives reject embedding, so this is intentionally separate from crawl
 * success.
 */
export function inspectWebsiteEmbedPolicy(headers: Headers): WebsiteEmbedPolicy {
  const contentSecurityPolicy = headers.get("content-security-policy") ?? "";
  const frameAncestors = contentSecurityPolicy
    .split(";")
    .map((directive) => directive.trim())
    .find((directive) => /^frame-ancestors(?:\s|$)/i.test(directive))
    ?.replace(/^frame-ancestors\s*/i, "")
    .trim() || null;
  return {
    xFrameOptions: headers.get("x-frame-options")?.trim() || null,
    frameAncestors,
  };
}

export type CrawlRejection = {
  url: string;
  reason: string;
  depth?: number;
  status?: number | null;
  contentType?: string | null;
};

export type CrawlFetchStrategy = "static" | "rendered" | "static_then_rendered";

export type CrawlAudit = {
  crawlRunId: string;
  startedAt: string;
  completedAt: string | null;
  maxPages: number;
  maxDepth: number;
  legacyCodePathUsed: boolean;
  backgroundWorkerUsed: boolean;
  workerJobId: string | null;
  initialUrl: string;
  finalCanonicalUrl: string | null;
  responseStatus: number | null;
  contentType: string | null;
  rawHtmlBytes: number;
  extractedVisibleTextSize: number;
  discoveredInternalLinks: string[];
  acceptedInternalLinks: string[];
  attemptedUrls: string[];
  rejectedInternalLinks: CrawlRejection[];
  rejectionReasons: Record<string, number>;
  spaIndicators: string[];
  sitemap: {
    discovered: boolean;
    urls: string[];
    sourceUrls: string[];
  };
  robots: {
    discovered: boolean;
    status: number | null;
    sitemapUrls: string[];
  };
  canonicalTags: string[];
  routeUrls: string[];
  renderedCrawl: {
    available: boolean;
    attempted: boolean;
    successful: number;
    failed: number;
    reason: string | null;
  };
  routes: Array<{
    requestedUrl: string;
    finalUrl: string;
    canonicalUrl: string;
    status: number;
    contentType: string;
    crawlMode: "static" | "rendered";
    fetchStrategy: CrawlFetchStrategy;
    renderAttempted: boolean;
    renderSuccess: boolean;
    renderDurationMs: number | null;
    renderDiagnostics?: RenderDiagnostics | null;
    extractedCharacters: number;
    discoveredLinks: string[];
    chunks: number;
    accepted: boolean;
    rejectionReason: string | null;
  }>;
  pages: Array<{
    requestedUrl: string;
    finalUrl: string;
    canonicalUrl: string;
    status: number;
    contentType: string;
    rawHtmlBytes: number;
    extractedVisibleTextSize: number;
    chunkCount: number;
    crawlMode: "static" | "rendered";
  }>;
  failureCode?: OnboardingFailureCode | null;
};

export type CrawlCoverage = {
  discoveredUrls: number;
  eligibleUrls: number;
  attemptedUrls: number;
  successfulPages: number;
  skippedUrls: number;
  failedUrls: number;
  unprocessedUrls: number;
  coveragePercent: number;
  additionalPagesDetected: boolean;
  rejectionReasons: Record<string, number>;
};

export type CrawlRunDiagnostics = {
  crawlRunId: string;
  seedUrl: string;
  startedAt: string;
  completedAt: string | null;
  discoveredUrls: number;
  eligibleUrls: number;
  attemptedUrls: number;
  successfulPages: number;
  failedUrls: number;
  skippedUrls: number;
  unprocessedUrls: number;
  coveragePercent: number;
  rejectionReasons: Record<string, number>;
  routes: Array<{
    url: string;
    finalUrl: string | null;
    status: number | null;
    fetchStrategy: CrawlFetchStrategy | null;
    accepted: boolean;
    failureReason: string | null;
  }>;
  legacyCodePathUsed: boolean;
  backgroundWorkerUsed: boolean;
  workerJobId: string | null;
  maxPages: number;
  maxDepth: number;
  finalReadiness?: {
    status: "valid" | "needs_attention";
    knowledgeReady: boolean;
    readinessScore: number;
    code: OnboardingFailureCode | null;
  } | null;
};

export type RenderDiagnostics = {
  attempted: true;
  success: boolean;
  durationMs: number;
  failureReason?: string | null;
  httpStatus?: number | null;
  rootSelector?: string | null;
  initialTextCharacters?: number;
  renderedTextCharacters?: number;
  domBytes?: number;
  networkSettled?: boolean;
  timeoutStage?: string | null;
  routeType?: string | null;
};

export type RenderedPage = {
  html: string;
  url?: string;
  contentType?: string;
  rawHtmlBytes?: number;
  renderDiagnostics?: RenderDiagnostics;
};

export type CrawlOptions = {
  /** Optional browser-backed renderer supplied by a deployment that has one. */
  renderPage?: (url: string) => Promise<RenderedPage | null>;
  /** Bounds are explicit so certification fixtures can prove the crawl is not seed-only. */
  maxPages?: number;
  maxDepth?: number;
  /** Injectable URL guard for deterministic crawler certification fixtures. */
  validateUrl?: (url: string) => Promise<URL>;
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function normalizeHexColor(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  if (/^#[0-9A-F]{6}$/.test(normalized)) return normalized;
  if (/^#[0-9A-F]{3}$/.test(normalized)) return `#${normalized.slice(1).split("").map((channel) => channel + channel).join("")}`;
  return null;
}

function isNeutralColor(value: string): boolean {
  const red = Number.parseInt(value.slice(1, 3), 16);
  const green = Number.parseInt(value.slice(3, 5), 16);
  const blue = Number.parseInt(value.slice(5, 7), 16);
  const spread = Math.max(red, green, blue) - Math.min(red, green, blue);
  return spread < 18 && (Math.max(red, green, blue) > 235 || Math.min(red, green, blue) < 25 || spread < 8);
}

/** Extracts high-signal colors from static website branding without downloading third-party assets. */
export function extractBrandColors(html: string): string[] {
  const prioritized: string[] = [];
  const collect = (value: string): void => {
    for (const match of value.matchAll(/#[0-9a-f]{3,6}\b/gi)) {
      const color = normalizeHexColor(match[0]);
      if (color && !prioritized.includes(color)) prioritized.push(color);
    }
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (/theme-color|brand|accent|primary/i.test(match[0])) collect(match[0]);
  }
  for (const match of html.matchAll(/--(?:brand|primary|accent|action|cta|theme)[\w-]*\s*:\s*([^;}]+)/gi)) collect(match[1]);
  for (const match of html.matchAll(/style\s*=\s*["'][^"']*(?:color|background)[^"']*["']/gi)) collect(match[0]);
  collect(html);

  const chromatic = prioritized.filter((color) => !isNeutralColor(color));
  return [...chromatic, ...prioritized.filter((color) => isNeutralColor(color))].slice(0, 6);
}

export function normalisePublicUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new CrawlError("websiteUrl is required", "INVALID_URL", false);
  const trimmed = value.trim();
  const candidate = trimmed.startsWith("//")
    ? `https:${trimmed}`
    : /^[a-z][a-z\d+.-]*:/i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new CrawlError("websiteUrl must be a valid URL", "INVALID_URL", false);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new CrawlError("websiteUrl must use http or https", "INVALID_URL", false);
  if (url.username || url.password) throw new CrawlError("websiteUrl cannot contain credentials", "INVALID_URL", false);

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = hostname.split(".").map((part) => Number(part));
  const isIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const blockedHost = isPrivateIpAddress(hostname)
    || hostname === "localhost"
    || hostname.endsWith(".internal")
    || (isIpv4 && octets[0] === 0);
  if (blockedHost) throw new CrawlError("websiteUrl must point to a public website", "INVALID_URL", false);

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

function isPrivateIpAddress(value: string): boolean {
  const hostname = value.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(hostname) === 4) {
    const octets = hostname.split(".").map(Number);
    const [first, second] = octets;
    return first === 0 || first === 10 || first === 127 || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 0) || (first === 192 && second === 168)
      || (first === 198 && (second === 18 || second === 19)) || first >= 224;
  }
  if (isIP(hostname) !== 6) return false;
  const normalized = hostname.replace(/^::ffff:/i, "");
  if (isIP(normalized) === 4) return isPrivateIpAddress(normalized);
  return hostname === "::1"
    || hostname === "::"
    || /^f[cd]/i.test(hostname)
    || /^fe[89ab]/i.test(hostname)
    || /^2001:db8/i.test(hostname)
    || /^ff/i.test(hostname);
}

/**
 * Resolve the destination immediately before every server-side fetch. This
 * closes the redirect/DNS-rebinding gap left by checking only the user-supplied
 * hostname: a public hostname must not resolve to localhost, RFC1918 space, or
 * a cloud metadata address at request time.
 */
export async function assertPublicUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CrawlError("websiteUrl must be a valid URL");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!['http:', 'https:'].includes(url.protocol)
    || url.username
    || url.password
    || hostname === "localhost"
    || hostname.endsWith(".internal")
    || isPrivateIpAddress(hostname)) {
    throw new CrawlError("websiteUrl must point to a public website");
  }
  try {
    const addresses = await lookup(url.hostname, { all: true, verbatim: true });
    if (!addresses.length || addresses.some((address) => isPrivateIpAddress(address.address))) {
      throw new CrawlError("websiteUrl must point to a public website");
    }
  } catch (error) {
    if (error instanceof CrawlError) throw error;
    const code = networkFailureCode(error);
    throw new CrawlError("The website hostname could not be resolved safely", code);
  }
  return url;
}

export function websiteIdentityKey(value: unknown): string {
  const normalized = normalisePublicUrl(value);
  const url = new URL(normalized);
  url.hostname = url.hostname.replace(/^www\./i, "");
  url.searchParams.sort();
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.hostname}${url.port ? `:${url.port}` : ""}${pathname}${url.search}`;
}

function normalizeCrawlUrl(value: string, base?: string): string {
  const url = new URL(value, base);
  url.hostname = url.hostname.replace(/^www\./i, "");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|gbraid$|wbraid$|dclid$|msclkid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function crawlExclusionReason(candidate: URL): string | null {
  const path = candidate.pathname.toLowerCase();
  if (/(^|\/)(login|logout|signin|sign-in|account|admin)(\/|$)/.test(path)) return "excluded_route";
  if (/(^|\/)(search|results|directory|listings?)(\/|$)/.test(path)) return "dynamic_listing";
  const dynamicQuery = [...candidate.searchParams.keys()].some((key) => /^(page|page_num|offset|limit|sort|filter|query|q|location|lat|lng)$/i.test(key));
  return dynamicQuery ? "dynamic_listing" : null;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function stripMarkup(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style|noscript|svg|template|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/[\u0000-\u001f]+/g, " "),
  ).replace(/\s+/g, " ").trim();
}

function extractVisibleText(html: string): string {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? "";
  return stripMarkup(body);
}

function readAttributes(tag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/gi)) {
    attributes[match[1].toLowerCase()] = decodeEntities(match[3]);
  }
  return attributes;
}

function extractCanonicalTag(html: string, baseUrl: string): string | null {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attributes = readAttributes(match[0]);
    if (attributes.rel?.toLowerCase().split(/\s+/).includes("canonical") && attributes.href) {
      try {
        return normalizeCrawlUrl(attributes.href, baseUrl);
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function detectSpaIndicators(html: string, visibleText = extractVisibleText(html)): string[] {
  const indicators: string[] = [];
  if (visibleText.length < MIN_VISIBLE_TEXT_FOR_SPA_CHECK) indicators.push("low_visible_text");
  if (/<(?:div|main|body)\b[^>]*(?:id|class)\s*=\s*["'][^"']*(?:app|root|__next|__nuxt|svelte)[^"']*["']/i.test(html)) indicators.push("app_mount_point");
  if (/<script\b[^>]*type\s*=\s*["']module["'][^>]*>/i.test(html)) indicators.push("module_script");
  if (/enable javascript|javascript required|works best with javascript/i.test(html)) indicators.push("javascript_notice");
  return [...new Set(indicators)];
}

function isClientRenderedShell(indicators: string[]): boolean {
  return indicators.includes("low_visible_text") && indicators.length >= 2;
}

function isBoilerplateText(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/works best with javascript enabled|all rights reserved/i.test(text)) return true;
  if (text.length <= 140 && /^(home|menu|navigation|learn more|read more|sign in|log in|try it free|start planning free|create workspace|review pricing|see (more|details|reminder engine)|explore (voice|recurring reminders)|launch the reminder engine)\b/i.test(text)) return true;
  return false;
}

function extractTitle(html: string, fallback: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return (match ? stripMarkup(match[1]) : "").slice(0, 240) || fallback;
}

function removeNonContentContainers(html: string): string {
  return html.replace(/<(script|style|noscript|svg|template|nav|footer|header|aside|form|dialog)[^>]*>[\s\S]*?<\/\1>/gi, " ");
}

type Section = { headingPath: string[]; text: string };

function extractPage(html: string, url: string): { title: string; sections: Section[]; links: string[]; visibleText: string; canonicalUrl: string | null } {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const title = extractTitle(html, hostname);
  const sections: Section[] = [];
  const headingPath: string[] = [];
  // Do not match article/section wrappers. Matching wrappers swallows nested
  // headings and paragraphs, leaving headings detached from their content.
  const contentHtml = removeNonContentContainers(html);
  const blockPattern = /<(h[1-6]|p|li|dt|dd|td|th|address)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(contentHtml))) {
    const tag = match[1].toLowerCase();
    const text = stripMarkup(match[2]);
    if (!text || isBoilerplateText(text)) continue;
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag.slice(1));
      headingPath.splice(level - 1);
      headingPath[level - 1] = text.slice(0, 180);
      continue;
    }
    sections.push({ headingPath: headingPath.filter(Boolean), text });
  }
  const visibleText = extractVisibleText(html);
  if (!sections.length && visibleText) sections.push({ headingPath: [], text: visibleText });

  const links: string[] = [];
  const linkPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = linkPattern.exec(html))) links.push(match[1]);
  return { title, sections, links, visibleText, canonicalUrl: extractCanonicalTag(html, url) };
}

function chunkSections(sections: Section[], pageTypeValue: string, brandColors: string[] = []): CrawlChunk[] {
  const blocks = sections.map((section) => {
    const heading = section.headingPath.length ? `${section.headingPath.join(" > ")}\n` : "";
    return {
      headingPath: section.headingPath,
      words: `${heading}${section.text}`.split(/\s+/).filter(Boolean).map((word) => ({ word, headingPath: section.headingPath })),
    };
  });
  const chunks: CrawlChunk[] = [];
  const step = Math.max(1, TARGET_CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS);
  let pending: Array<{ word: string; headingPath: string[] }> = [];

  const addChunk = (slice: Array<{ word: string; headingPath: string[] }>, overlapTokens: number): void => {
    const content = slice.map((item) => item.word).join(" ").trim();
    if (content.length < 24) return;
    const headingPath = slice.find((item) => item.headingPath.length)?.headingPath ?? [];
    chunks.push({
      content,
      contentHash: hash(content),
      metadata: {
        headingPath,
        pageType: pageTypeValue,
        tokenCount: slice.length,
        overlapTokens,
        ...(chunks.length === 0 && brandColors.length ? { brandColors } : {}),
      },
    });
  };

  const flushPending = (): void => {
    if (!pending.length) return;
    addChunk(pending, 0);
    pending = [];
  };

  for (const block of blocks) {
    // Keep major heading sections separate when they are independently
    // meaningful. This prevents a short one-page site from collapsing into a
    // single undifferentiated chunk while still grouping paragraphs under the
    // same heading.
    if (pending.length && block.headingPath.length === 1 && pending.length >= 80) flushPending();

    if (block.words.length <= TARGET_CHUNK_TOKENS) {
      if (pending.length && pending.length + block.words.length > TARGET_CHUNK_TOKENS) flushPending();
      pending.push(...block.words);
      continue;
    }

    flushPending();
    for (let start = 0; start < block.words.length; start += step) {
      const end = Math.min(block.words.length, start + TARGET_CHUNK_TOKENS);
      addChunk(block.words.slice(start, end), start === 0 ? 0 : CHUNK_OVERLAP_TOKENS);
      if (end >= block.words.length) break;
    }
  }
  flushPending();
  return chunks.slice(0, 100);
}

async function readResponseText(response: Response): Promise<{ text: string; bytes: number }> {
  if (!response.body) {
    const text = await response.text();
    return { text, bytes: new TextEncoder().encode(text).byteLength };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new CrawlError("The website is too large to crawl for a demo", "HTTP_ERROR", false);
    }
    parts.push(decoder.decode(result.value, { stream: true }));
  }
  parts.push(decoder.decode());
  const text = parts.join("");
  return { text, bytes: total };
}

async function fetchText(url: string, accept: string, validateUrl: (url: string) => Promise<URL> = assertPublicUrl): Promise<{ response: Response; text: string; bytes: number; finalUrl: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
  try {
    let currentUrl = url;
    let response: Response;
    for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
      await validateUrl(currentUrl);
      response = await fetch(currentUrl, {
        signal: controller.signal,
        headers: { "user-agent": "FrontDeskWise-DemoCrawler/0.2", accept },
        redirect: "manual",
      });
      if (![301, 302, 303, 307, 308].includes(response.status)) {
        const body = await readResponseText(response);
        return { response, ...body, finalUrl: currentUrl };
      }
      const location = response.headers.get("location");
      await response.body?.cancel().catch(() => undefined);
      if (!location) throw new CrawlError("The website returned an invalid redirect");
      if (redirects === MAX_REDIRECTS) throw new CrawlError("The website redirected too many times");
      currentUrl = new URL(location, currentUrl).toString();
    }
    throw new CrawlError("The website redirected too many times");
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new CrawlError("The website took too long to respond", "TIMEOUT");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function networkFailureCode(error: unknown): OnboardingFailureCode {
  if (error instanceof CrawlError) return error.code;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  const code = String(candidate?.code ?? candidate?.cause?.code ?? "").toUpperCase();
  if (["ENOTFOUND", "EAI_NONAME", "NXDOMAIN"].includes(code)) return "DOMAIN_NOT_FOUND";
  if (["EAI_AGAIN", "EAI_FAIL", "ESERVFAIL", "ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH"].includes(code)) return "DNS_FAILURE";
  if (["CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN"].includes(code)) return "SSL_FAILURE";
  if (error instanceof DOMException && error.name === "AbortError") return "TIMEOUT";
  return "CRAWL_ERROR";
}

function failureCodeForAudit(audit: CrawlAudit, rootFailureCode: OnboardingFailureCode | null): OnboardingFailureCode {
  if (rootFailureCode && rootFailureCode !== "CRAWL_ERROR") return rootFailureCode;
  const rootRoute = audit.routes.find((route) => route.requestedUrl === audit.initialUrl) ?? audit.routes[0];
  const rootRejected = audit.rejectedInternalLinks.some((rejection) => rejection.url === audit.initialUrl);
  if (audit.rejectionReasons.robots_disallow && !audit.pages.length && rootRejected) return "ROBOTS_BLOCKED";
  if (rootRoute?.status === 401 || rootRoute?.status === 403) return "AUTH_REQUIRED";
  if (rootRoute?.status === 404) return "DOMAIN_NOT_FOUND";
  if (rootRoute && rootRoute.status >= 400) return rootRoute.status === 408 || rootRoute.status === 504 ? "TIMEOUT" : "HTTP_ERROR";
  if (audit.renderedCrawl.failed || audit.rejectionReasons.render_failed || audit.rejectionReasons.rendered_content_empty || audit.rejectionReasons.client_rendered_shell) return "SPA_RENDER_FAILURE";
  return "NO_USEFUL_CONTENT";
}

function robotsDisallows(robotsText: string, target: URL): boolean {
  let applies = false;
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (key === "user-agent") applies = value === "*" || value.toLowerCase() === "frontdeskwise-democrawler";
    if (applies && key === "disallow" && value && target.pathname.startsWith(value)) return true;
  }
  return false;
}

function robotsSitemapUrls(robotsText: string, root: URL): string[] {
  const urls: string[] = [];
  for (const rawLine of robotsText.split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    const separator = line.indexOf(":");
    if (separator < 0 || line.slice(0, separator).trim().toLowerCase() !== "sitemap") continue;
    try {
      const candidate = new URL(line.slice(separator + 1).trim(), root);
      if (sameSite(candidate, root)) urls.push(normalizeCrawlUrl(candidate.toString()));
    } catch {
      // Ignore malformed sitemap declarations.
    }
  }
  return [...new Set(urls)];
}

function sitemapLocations(xml: string, baseUrl: string, root: URL): string[] {
  const urls: string[] = [];
  for (const match of xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)) {
    try {
      const candidate = new URL(decodeEntities(match[1].trim()), baseUrl);
      if (sameSite(candidate, root)) urls.push(normalizeCrawlUrl(candidate.toString()));
    } catch {
      // Ignore malformed sitemap locations.
    }
  }
  return [...new Set(urls)];
}

function sameSite(candidate: URL, root: URL): boolean {
  const candidateHost = candidate.hostname.replace(/^www\./, "").toLowerCase();
  const rootHost = root.hostname.replace(/^www\./, "").toLowerCase();
  return candidateHost === rootHost && ["http:", "https:"].includes(candidate.protocol);
}

function isFailedCrawlReason(reason: string): boolean {
  return reason === "fetch_error"
    || reason === "render_failed"
    || reason === "rendered_content_empty"
    || reason === "client_rendered_shell"
    || reason === "redirected_cross_origin"
    || reason === "invalid_final_url"
    || reason === "insufficient_visible_text"
    || reason === "non_html_content_type"
    || /^http_\d+$/.test(reason);
}

function isIntentionalSkipReason(reason: string): boolean {
  return reason === "duplicate_canonical"
    || reason === "duplicate_content"
    || reason === "excluded_route"
    || reason === "low_value_page_type"
    || reason === "dynamic_listing";
}

export function summarizeCrawlCoverage(audit: CrawlAudit): CrawlCoverage {
  const discovered = new Set([audit.initialUrl, ...audit.discoveredInternalLinks, ...audit.routeUrls]);
  const attempted = new Set([
    ...(audit.attemptedUrls ?? []),
    ...audit.routes.map((route) => route.requestedUrl),
  ]);
  const rejected = new Map<string, Set<string>>();
  for (const rejection of audit.rejectedInternalLinks) {
    const reasons = rejected.get(rejection.url) ?? new Set<string>();
    reasons.add(rejection.reason);
    rejected.set(rejection.url, reasons);
  }
  const skippedUrlSet = new Set([...rejected.entries()]
    .filter(([, reasons]) => [...reasons].every(isIntentionalSkipReason))
    .map(([url]) => url));
  const failedUrls = [...rejected.values()].filter((reasons) => [...reasons].some(isFailedCrawlReason)).length;
  const skippedUrls = skippedUrlSet.size;
  const discoveredUrls = discovered.size;
  const successfulPages = audit.pages.length;
  // Coverage counts attempts against eligible URLs. URLs intentionally
  // excluded by policy may still appear in the raw audit if the exclusion was
  // discovered after a fetch (for example, a duplicate canonical page), but
  // they must not inflate the eligible-attempt denominator.
  const attemptedUrls = [...attempted].filter((url) => !skippedUrlSet.has(url)).length;
  const unprocessedUrls = Math.max(0, discoveredUrls - attemptedUrls - skippedUrls);
  const eligibleUrls = Math.max(1, discoveredUrls - skippedUrls);
  return {
    discoveredUrls,
    eligibleUrls,
    attemptedUrls,
    successfulPages,
    skippedUrls,
    failedUrls,
    unprocessedUrls,
    coveragePercent: Math.round((successfulPages / eligibleUrls) * 100),
    additionalPagesDetected: discoveredUrls > 1,
    rejectionReasons: { ...audit.rejectionReasons },
  };
}

export function crawlRunDiagnostics(
  audit: CrawlAudit,
  coverage: CrawlCoverage = summarizeCrawlCoverage(audit),
  finalReadiness?: CrawlRunDiagnostics["finalReadiness"],
): CrawlRunDiagnostics {
  const routeDiagnostics: CrawlRunDiagnostics["routes"] = audit.routes.map((route) => ({
    url: route.requestedUrl,
    finalUrl: route.finalUrl || null,
    status: Number.isFinite(route.status) ? route.status : null,
    fetchStrategy: route.fetchStrategy ?? null,
    accepted: route.accepted,
    failureReason: route.rejectionReason,
  }));
  const knownRouteUrls = new Set(routeDiagnostics.map((route) => route.url));
  for (const rejection of audit.rejectedInternalLinks) {
    if (knownRouteUrls.has(rejection.url)) continue;
    knownRouteUrls.add(rejection.url);
    routeDiagnostics.push({
      url: rejection.url,
      finalUrl: null,
      status: rejection.status ?? null,
      fetchStrategy: null,
      accepted: false,
      failureReason: rejection.reason,
    });
  }
  return {
    crawlRunId: audit.crawlRunId,
    seedUrl: audit.initialUrl,
    startedAt: audit.startedAt,
    completedAt: audit.completedAt,
    discoveredUrls: coverage.discoveredUrls,
    eligibleUrls: coverage.eligibleUrls,
    attemptedUrls: coverage.attemptedUrls,
    successfulPages: coverage.successfulPages,
    failedUrls: coverage.failedUrls,
    skippedUrls: coverage.skippedUrls,
    unprocessedUrls: coverage.unprocessedUrls,
    coveragePercent: coverage.coveragePercent,
    rejectionReasons: { ...coverage.rejectionReasons },
    routes: routeDiagnostics,
    legacyCodePathUsed: audit.legacyCodePathUsed,
    backgroundWorkerUsed: audit.backgroundWorkerUsed,
    workerJobId: audit.workerJobId,
    maxPages: audit.maxPages,
    maxDepth: audit.maxDepth,
    ...(finalReadiness ? { finalReadiness } : {}),
  };
}

export async function crawlWebsite(websiteUrl: string, options: CrawlOptions = {}): Promise<{ pages: CrawledPage[]; audit: CrawlAudit }> {
  const maxPages = Math.max(1, Math.floor(options.maxPages ?? MAX_PAGES));
  const maxDepth = Math.max(0, Math.floor(options.maxDepth ?? MAX_DEPTH));
  const validateUrl = options.validateUrl ?? assertPublicUrl;
  const initialUrl = normalizeCrawlUrl(normalisePublicUrl(websiteUrl));
  const root = new URL(initialUrl);
  const queue: Array<{ url: string; depth: number; discoveryParentUrl: string | null; priority: number }> = [{ url: initialUrl, depth: 0, discoveryParentUrl: null, priority: Number.MAX_SAFE_INTEGER }];
  const queued = new Set<string>([initialUrl]);
  const visited = new Set<string>();
  const seenCanonicalUrls = new Set<string>();
  const seenContentHashes = new Set<string>();
  const pages: CrawledPage[] = [];
  let brandColors: string[] = [];
  let robotsText = "";
  let rootFailureCode: OnboardingFailureCode | null = null;
  const audit: CrawlAudit = {
    crawlRunId: randomUUID(),
    startedAt: new Date().toISOString(),
    completedAt: null,
    maxPages,
    maxDepth,
    legacyCodePathUsed: false,
    backgroundWorkerUsed: false,
    workerJobId: null,
    initialUrl,
    finalCanonicalUrl: null,
    responseStatus: null,
    contentType: null,
    rawHtmlBytes: 0,
    extractedVisibleTextSize: 0,
    discoveredInternalLinks: [],
    acceptedInternalLinks: [initialUrl],
    attemptedUrls: [],
    rejectedInternalLinks: [],
    rejectionReasons: {},
    spaIndicators: [],
    sitemap: { discovered: false, urls: [], sourceUrls: [] },
    robots: { discovered: false, status: null, sitemapUrls: [] },
    canonicalTags: [],
    routeUrls: [initialUrl],
    renderedCrawl: {
      available: Boolean(options.renderPage),
      attempted: false,
      successful: 0,
      failed: 0,
      reason: options.renderPage ? null : "no_rendered_crawl_adapter",
    },
    routes: [],
    pages: [],
    failureCode: null,
  };

  const reject = (url: string, reason: string, details: Omit<CrawlRejection, "url" | "reason"> = {}): void => {
    audit.rejectedInternalLinks.push({ url, reason, ...details });
    audit.rejectionReasons[reason] = (audit.rejectionReasons[reason] ?? 0) + 1;
  };

  const addInternalUrl = (value: string, depth: number, discoveryParentUrl: string | null = null): void => {
    let normalized: string;
    try {
      normalized = normalizeCrawlUrl(value);
    } catch {
      return;
    }
    const candidate = new URL(normalized);
    if (!sameSite(candidate, root)) return;
    if (!audit.discoveredInternalLinks.includes(normalized)) audit.discoveredInternalLinks.push(normalized);
    if (!audit.routeUrls.includes(normalized)) audit.routeUrls.push(normalized);
    const exclusionReason = crawlExclusionReason(candidate);
    if (exclusionReason) {
      reject(normalized, exclusionReason, { depth });
      return;
    }
    if (robotsDisallows(robotsText, candidate)) {
      reject(normalized, "robots_disallow", { depth });
      return;
    }
    if (depth > maxDepth) {
      reject(normalized, "max_depth", { depth });
      return;
    }
    if (visited.has(normalized) || queued.has(normalized)) return;
    queued.add(normalized);
    audit.acceptedInternalLinks.push(normalized);
    queue.push({ url: normalized, depth, discoveryParentUrl, priority: crawlPriority(normalized, depth) });
    queue.sort((left, right) => right.priority - left.priority);
  };

  try {
    const robotsUrl = normalizeCrawlUrl(new URL("/robots.txt", root).toString());
    const robots = await fetchText(robotsUrl, "text/plain", validateUrl);
    audit.robots.status = robots.response.status;
    if (robots.response.ok) {
      robotsText = robots.text;
      audit.robots.discovered = true;
      audit.robots.sitemapUrls = robotsSitemapUrls(robotsText, root);
    }
  } catch {
    // A missing or unreachable robots file does not block a crawl.
  }

  const sitemapQueue = [...new Set([
    ...audit.robots.sitemapUrls,
    normalizeCrawlUrl(new URL("/sitemap.xml", root).toString()),
  ])];
  const visitedSitemaps = new Set<string>();
  while (sitemapQueue.length && visitedSitemaps.size < MAX_SITEMAPS) {
    const sitemapUrl = sitemapQueue.shift();
    if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) continue;
    visitedSitemaps.add(sitemapUrl);
    try {
      const sitemap = await fetchText(sitemapUrl, "application/xml,text/xml,text/plain", validateUrl);
      if (!sitemap.response.ok) continue;
      const locations = sitemapLocations(sitemap.text, sitemapUrl, root);
      if (!locations.length) continue;
      audit.sitemap.discovered = true;
      audit.sitemap.sourceUrls.push(sitemapUrl);
      for (const location of locations) {
        if (/<sitemapindex\b/i.test(sitemap.text) && sitemapQueue.length + visitedSitemaps.size < MAX_SITEMAPS) sitemapQueue.push(location);
        else if (audit.sitemap.urls.length < MAX_SITEMAP_URLS && !audit.sitemap.urls.includes(location)) {
          audit.sitemap.urls.push(location);
          addInternalUrl(location, 1, sitemapUrl);
        }
      }
    } catch {
      // A missing or malformed sitemap does not block anchor crawling.
    }
  }

  while (queue.length && pages.length < maxPages) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);
    audit.attemptedUrls.push(next.url);
    const pageUrl = new URL(next.url);
    if (!sameSite(pageUrl, root)) {
      reject(next.url, "cross_origin", { depth: next.depth });
      continue;
    }
    if (robotsDisallows(robotsText, pageUrl)) {
      reject(next.url, "robots_disallow", { depth: next.depth });
      continue;
    }

    let fetched: { response: Response; text: string; bytes: number; finalUrl: string };
    try {
      fetched = await fetchText(next.url, "text/html,application/xhtml+xml", validateUrl);
    } catch (error) {
      if (next.depth === 0) rootFailureCode = networkFailureCode(error);
      reject(next.url, "fetch_error", { depth: next.depth });
      continue;
    }
    const status = fetched.response.status;
    const contentType = fetched.response.headers.get("content-type") ?? "";
    if (next.depth === 0) {
      audit.responseStatus = status;
      audit.contentType = contentType;
      audit.rawHtmlBytes = fetched.bytes;
    }
    if (!fetched.response.ok) {
      reject(next.url, `http_${status}`, { depth: next.depth, status, contentType });
      continue;
    }
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      reject(next.url, "non_html_content_type", { depth: next.depth, status, contentType });
      continue;
    }

    let responseUrl: string;
    try {
      responseUrl = normalizeCrawlUrl(fetched.finalUrl || fetched.response.url || next.url);
    } catch {
      reject(next.url, "invalid_final_url", { depth: next.depth, status, contentType });
      continue;
    }
    if (!sameSite(new URL(responseUrl), root)) {
      reject(next.url, "redirected_cross_origin", { depth: next.depth, status, contentType });
      continue;
    }
    if (next.depth === 0) brandColors = extractBrandColors(fetched.text);

    let html = fetched.text;
    let htmlBytes = fetched.bytes;
    let extracted = extractPage(html, responseUrl);
    let shellIndicators = detectSpaIndicators(html, extracted.visibleText);
    let renderedPageUsed = false;
    let renderAttempted = false;
    let renderSuccess = false;
    let fetchStrategy: CrawlFetchStrategy = "static";
    let renderDurationMs: number | null = null;
    let renderDiagnostics: RenderDiagnostics | null = null;
    if (next.depth === 0) {
      audit.extractedVisibleTextSize = extracted.visibleText.length;
      audit.spaIndicators = shellIndicators;
    }

    if (isClientRenderedShell(shellIndicators) && options.renderPage) {
      fetchStrategy = "static_then_rendered";
      audit.renderedCrawl.attempted = true;
      renderAttempted = true;
      const renderStartedAt = Date.now();
      try {
        const rendered = await options.renderPage(responseUrl);
        renderDiagnostics = rendered?.renderDiagnostics ?? null;
        renderDurationMs = rendered?.renderDiagnostics?.durationMs ?? Math.max(0, Date.now() - renderStartedAt);
        if (rendered?.html) {
          renderedPageUsed = true;
          renderSuccess = true;
          audit.renderedCrawl.successful += 1;
          html = rendered.html;
          htmlBytes = rendered.rawHtmlBytes ?? new TextEncoder().encode(html).byteLength;
          responseUrl = normalizeCrawlUrl(rendered.url ?? responseUrl);
          extracted = extractPage(html, responseUrl);
          shellIndicators = detectSpaIndicators(html, extracted.visibleText);
        } else {
          audit.renderedCrawl.failed += 1;
          audit.renderedCrawl.reason = rendered?.renderDiagnostics?.failureReason ?? "renderer_returned_no_html";
        }
      } catch {
        renderDurationMs = Math.max(0, Date.now() - renderStartedAt);
        audit.renderedCrawl.failed += 1;
        audit.renderedCrawl.reason = "renderer_failed";
      }
    }
    if (isClientRenderedShell(shellIndicators) && next.depth === 0) audit.spaIndicators = shellIndicators;
    if (next.depth === 0) {
      audit.rawHtmlBytes = htmlBytes;
      audit.extractedVisibleTextSize = extracted.visibleText.length;
    }

    const requestedRoute = normalizeCrawlUrl(next.url);
    const staticSpaCanonical = renderedPageUsed
      && new URL(requestedRoute).pathname !== "/"
      && extracted.canonicalUrl === normalizeCrawlUrl(root.toString());
    const canonicalCandidate = !staticSpaCanonical && extracted.canonicalUrl && sameSite(new URL(extracted.canonicalUrl), root)
      ? extracted.canonicalUrl
      : responseUrl;
    if (extracted.canonicalUrl) audit.canonicalTags.push(extracted.canonicalUrl);
    if (next.depth === 0) audit.finalCanonicalUrl = canonicalCandidate;

    const readable = extracted.visibleText.trim();
    const discoveredLinks = [...new Set(extracted.links.flatMap((href) => {
      try {
        const candidate = new URL(href, responseUrl);
        return sameSite(candidate, root) ? [normalizeCrawlUrl(candidate.toString())] : [];
      } catch {
        return [];
      }
    }))];
    const routeAudit = {
      requestedUrl: next.url,
      finalUrl: responseUrl,
      canonicalUrl: canonicalCandidate,
      status,
      contentType,
      crawlMode: renderedPageUsed ? "rendered" as const : "static" as const,
      fetchStrategy,
      renderAttempted,
      renderSuccess,
      renderDurationMs,
      renderDiagnostics,
      extractedCharacters: readable.length,
      discoveredLinks,
      chunks: 0,
      accepted: false,
      rejectionReason: null as string | null,
    };
    audit.routes.push(routeAudit);
    const rejectRoute = (reason: string): void => {
      routeAudit.rejectionReason = reason;
      reject(next.url, reason, { depth: next.depth, status, contentType });
    };
    if (isClientRenderedShell(shellIndicators) && !renderAttempted) {
      rejectRoute("client_rendered_shell");
    } else if (renderAttempted && !renderSuccess) {
      rejectRoute("render_failed");
    } else if (isClientRenderedShell(shellIndicators)) {
      rejectRoute("rendered_content_empty");
    } else if (readable.length < 40) {
      rejectRoute("insufficient_visible_text");
    } else {
      const canonicalKey = normalizeCrawlUrl(canonicalCandidate);
      const contentHash = hash(readable);
      const type = classifyPage(responseUrl, extracted.title, readable);
      const actionCandidates = extractWebsiteActions(html, responseUrl);
      if (type === "cart" || type === "checkout" || type === "account") {
        rejectRoute("low_value_page_type");
      } else if (!seenCanonicalUrls.has(canonicalKey) && !seenContentHashes.has(contentHash)) {
        const chunks = chunkSections(extracted.sections, type, brandColors);
        seenCanonicalUrls.add(canonicalKey);
        seenContentHashes.add(contentHash);
        routeAudit.chunks = chunks.length;
        routeAudit.accepted = true;
        audit.pages.push({
          requestedUrl: next.url,
          finalUrl: responseUrl,
          canonicalUrl: canonicalCandidate,
          status,
          contentType,
          rawHtmlBytes: htmlBytes,
          extractedVisibleTextSize: readable.length,
          chunkCount: chunks.length,
          crawlMode: routeAudit.crawlMode,
        });
        pages.push({
          url: responseUrl,
          canonicalUrl: canonicalCandidate,
          title: extracted.title,
          contentHash,
          pageType: type,
          lastCrawledAt: new Date().toISOString(),
          chunks,
          httpStatus: status,
          rawHtmlBytes: htmlBytes,
          extractedCharacterCount: readable.length,
          discoveredLinkCount: discoveredLinks.length,
          crawlMode: routeAudit.crawlMode,
          renderAttempted,
          renderSuccess,
          renderDurationMs,
          renderDiagnostics,
          crawlDepth: next.depth,
          discoveryParentUrl: next.discoveryParentUrl,
          actionCandidates,
        });
      } else {
        rejectRoute(seenCanonicalUrls.has(canonicalKey) ? "duplicate_canonical" : "duplicate_content");
      }
    }

    if (next.depth < maxDepth) {
      for (const href of extracted.links) {
        try {
          const candidate = new URL(href, responseUrl);
          if (!sameSite(candidate, root)) continue;
          addInternalUrl(candidate.toString(), next.depth + 1, responseUrl);
        } catch {
          // Ignore malformed or non-URL links.
        }
      }
    }
  }

  audit.completedAt = new Date().toISOString();
  if (!pages.length) {
    const renderFailure = audit.renderedCrawl.reason;
    const code = failureCodeForAudit(audit, rootFailureCode);
    audit.failureCode = code;
    const error = new CrawlError(isClientRenderedShell(audit.spaIndicators)
      ? options.renderPage && renderFailure
        ? `The website requires client-side rendering, but the rendered crawl failed (${renderFailure})`
        : "The website requires client-side rendering, but no rendered crawl adapter is configured"
      : code === "NO_USEFUL_CONTENT"
        ? "The website did not contain enough useful business information"
        : "The website could not be read",
      code,
      code === "INVALID_URL" || code === "AUTH_REQUIRED" || code === "ROBOTS_BLOCKED",
    );
    error.audit = audit;
    throw error;
  }
  const coverage = summarizeCrawlCoverage(audit);
  if (coverage.failedUrls > 0 || coverage.unprocessedUrls > 0) {
    audit.failureCode = "CRAWL_PARTIAL";
  }
  return { pages, audit };
}
