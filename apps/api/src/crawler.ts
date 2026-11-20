import { createHash } from "node:crypto";

const MAX_HTML_BYTES = 1_000_000;
const CRAWL_TIMEOUT_MS = 8_000;
const MAX_PAGES = 20;
const MAX_DEPTH = 2;
const TARGET_CHUNK_TOKENS = 520;
const CHUNK_OVERLAP_TOKENS = 80;

export class CrawlError extends Error {
  statusCode = 422;
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
  pageType: string;
  lastCrawledAt: string;
  chunks: CrawlChunk[];
};

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

export function normalisePublicUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new CrawlError("websiteUrl is required");
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
    throw new CrawlError("websiteUrl must be a valid URL");
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new CrawlError("websiteUrl must use http or https");
  if (url.username || url.password) throw new CrawlError("websiteUrl cannot contain credentials");

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const octets = hostname.split(".").map((part) => Number(part));
  const isIpv4 = octets.length === 4 && octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255);
  const blockedHost = hostname === "localhost"
    || hostname === "::1"
    || hostname.startsWith("fc")
    || hostname.startsWith("fd")
    || hostname.startsWith("fe80:")
    || hostname.endsWith(".internal")
    || (isIpv4 && (octets[0] === 0 || octets[0] === 10 || octets[0] === 127 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168));
  if (blockedHost) throw new CrawlError("websiteUrl must point to a public website");

  url.hash = "";
  for (const key of [...url.searchParams.keys()]) {
    if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) url.searchParams.delete(key);
  }
  return url.toString();
}

export function websiteIdentityKey(value: unknown): string {
  const normalized = normalisePublicUrl(value);
  const url = new URL(normalized);
  url.hostname = url.hostname.replace(/^www\./i, "");
  url.searchParams.sort();
  const pathname = url.pathname.replace(/\/+$/, "");
  return `${url.hostname}${url.port ? `:${url.port}` : ""}${pathname}${url.search}`;
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

type Section = { headingPath: string[]; text: string };

function extractPage(html: string, url: string): { title: string; sections: Section[]; links: string[] } {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  const title = extractTitle(html, hostname);
  const sections: Section[] = [];
  const headingPath: string[] = [];
  // Do not match article/section wrappers. Matching wrappers swallows nested
  // headings and paragraphs, leaving headings detached from their content.
  const blockPattern = /<(h[1-6]|p|li|dt|dd|td|th|address)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(html))) {
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
  if (!sections.length) sections.push({ headingPath: [], text: stripMarkup(html) });

  const links: string[] = [];
  const linkPattern = /<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = linkPattern.exec(html))) links.push(match[1]);
  return { title, sections, links };
}

function pageType(url: string, title: string): string {
  const value = `${url} ${title}`.toLowerCase();
  if (/price|pricing|cost|rate/.test(value)) return "pricing";
  if (/faq|question/.test(value)) return "faq";
  if (/policy|cancel|terms|privacy|cookie|legal/.test(value)) return "policy";
  if (/location|contact|hours|about/.test(value)) return "location";
  if (/service|solution|product|feature|planner|task|reminder|recap|voice|calendar|workspace|team|offering|program|class|treatment/.test(value)) return "service";
  return "web_page";
}

function chunkSections(sections: Section[], pageTypeValue: string): CrawlChunk[] {
  const wordsWithHeadings = sections.flatMap((section) => {
    const heading = section.headingPath.length ? `${section.headingPath.join(" > ")}\n` : "";
    return `${heading}${section.text}`.split(/\s+/).filter(Boolean).map((word) => ({ word, headingPath: section.headingPath }));
  });
  const words = wordsWithHeadings.map((item) => item.word);
  const chunks: CrawlChunk[] = [];
  const step = Math.max(1, TARGET_CHUNK_TOKENS - CHUNK_OVERLAP_TOKENS);
  for (let start = 0; start < words.length; start += step) {
    const end = Math.min(words.length, start + TARGET_CHUNK_TOKENS);
    const slice = wordsWithHeadings.slice(start, end);
    const content = slice.map((item) => item.word).join(" ").trim();
    if (content.length < 24) continue;
    const headingPath = slice.find((item) => item.headingPath.length)?.headingPath ?? [];
    chunks.push({
      content,
      contentHash: hash(content),
      metadata: {
        headingPath,
        pageType: pageTypeValue,
        tokenCount: slice.length,
        overlapTokens: start === 0 ? 0 : CHUNK_OVERLAP_TOKENS,
      },
    });
    if (end >= words.length) break;
  }
  return chunks.slice(0, 100);
}

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) return response.text();
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
      throw new CrawlError("The website is too large to crawl for a demo");
    }
    parts.push(decoder.decode(result.value, { stream: true }));
  }
  parts.push(decoder.decode());
  return parts.join("");
}

async function fetchText(url: string, accept: string): Promise<{ response: Response; text: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "user-agent": "FrontDeskWise-DemoCrawler/0.2", accept },
      redirect: "follow",
    });
    return { response, text: await readResponseText(response) };
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw new CrawlError("The website took too long to respond");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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

function sameSite(candidate: URL, root: URL): boolean {
  const candidateHost = candidate.hostname.replace(/^www\./, "").toLowerCase();
  const rootHost = root.hostname.replace(/^www\./, "").toLowerCase();
  return candidateHost === rootHost && ["http:", "https:"].includes(candidate.protocol);
}

export async function crawlWebsite(websiteUrl: string): Promise<{ pages: CrawledPage[] }> {
  const root = new URL(websiteUrl);
  const queue: Array<{ url: string; depth: number }> = [{ url: websiteUrl, depth: 0 }];
  const visited = new Set<string>();
  const pages: CrawledPage[] = [];
  let robotsText = "";
  try {
    const robots = await fetchText(new URL("/robots.txt", root).toString(), "text/plain");
    if (robots.response.ok) robotsText = robots.text;
  } catch {
    // A missing or unreachable robots file does not block a demo crawl.
  }

  while (queue.length && pages.length < MAX_PAGES) {
    const next = queue.shift();
    if (!next || visited.has(next.url)) continue;
    visited.add(next.url);
    const pageUrl = new URL(next.url);
    if (!sameSite(pageUrl, root) || robotsDisallows(robotsText, pageUrl)) continue;

    let fetched: { response: Response; text: string };
    try {
      fetched = await fetchText(next.url, "text/html,application/xhtml+xml");
    } catch {
      continue;
    }
    if (!fetched.response.ok) continue;
    const contentType = fetched.response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) continue;

    const canonicalUrl = normalisePublicUrl(fetched.response.url || next.url);
    if (!sameSite(new URL(canonicalUrl), root)) continue;
    const extracted = extractPage(fetched.text, canonicalUrl);
    const type = pageType(canonicalUrl, extracted.title);
    const readable = extracted.sections.map((section) => section.text).join(" ").trim();
    if (readable.length < 40) continue;
    const now = new Date().toISOString();
    pages.push({
      url: canonicalUrl,
      canonicalUrl,
      title: extracted.title,
      contentHash: hash(readable),
      pageType: type,
      lastCrawledAt: now,
      chunks: chunkSections(extracted.sections, type),
    });

    if (next.depth < MAX_DEPTH) {
      for (const href of extracted.links) {
        try {
          const candidate = new URL(href, canonicalUrl);
          candidate.hash = "";
          if (sameSite(candidate, root) && ["http:", "https:"].includes(candidate.protocol)) {
            const normalized = candidate.toString();
            if (!visited.has(normalized) && !queue.some((item) => item.url === normalized)) queue.push({ url: normalized, depth: next.depth + 1 });
          }
        } catch {
          // Ignore malformed or non-URL links.
        }
      }
    }
  }

  if (!pages.length) throw new CrawlError("The website did not contain readable pages for a demo");
  return { pages };
}
