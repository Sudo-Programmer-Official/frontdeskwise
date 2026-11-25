import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertPublicUrl, CrawlError, crawlRunDiagnostics, crawlWebsite, detectSpaIndicators, extractBrandColors, inspectWebsiteEmbedPolicy, normalisePublicUrl, summarizeCrawlCoverage, websiteIdentityKey } from "../src/crawler.ts";
import { PAGE_TYPES } from "../src/page-classification.ts";

test("normalisePublicUrl adds https to a bare domain", () => {
  assert.equal(normalisePublicUrl("  example.com/path  "), "https://example.com/path");
});

test("normalisePublicUrl preserves http and https URLs", () => {
  assert.equal(normalisePublicUrl("http://example.com"), "http://example.com/");
  assert.equal(normalisePublicUrl("https://example.com#section"), "https://example.com/");
});

test("normalisePublicUrl still rejects unsupported protocols", () => {
  assert.throws(
    () => normalisePublicUrl("ftp://example.com"),
    (error: unknown) => error instanceof CrawlError && error.message === "websiteUrl must use http or https",
  );
});

test("crawler rejects literal private and metadata destinations before fetch", async () => {
  await assert.rejects(() => assertPublicUrl("http://127.0.0.1:8080/health"), (error: unknown) => error instanceof CrawlError);
  await assert.rejects(() => assertPublicUrl("http://169.254.169.254/latest/meta-data"), (error: unknown) => error instanceof CrawlError);
  await assert.rejects(() => assertPublicUrl("https://service.internal/health"), (error: unknown) => error instanceof CrawlError);
});

test("websiteIdentityKey treats protocol, www, and trailing slash variants as one site", () => {
  assert.equal(websiteIdentityKey("https://www.example.com/"), "example.com");
  assert.equal(websiteIdentityKey("http://example.com/?utm_source=test"), "example.com");
});

test("extractBrandColors prefers website theme and brand colors over neutrals", () => {
  const colors = extractBrandColors(`
    <meta name="theme-color" content="#4F46E5">
    <style>:root { --brand-primary: #0F766E; --surface: #FFFFFF; }</style>
    <body style="background: #f8fafc; color: #172033"></body>
  `);
  assert.deepEqual(colors.slice(0, 2), ["#4F46E5", "#0F766E"]);
});

test("detectSpaIndicators identifies an empty client-rendered app shell", () => {
  const indicators = detectSpaIndicators(`
    <html><head><script type="module" src="/assets/app.js"></script></head>
    <body><div id="app"></div></body></html>
  `);
  assert.deepEqual(indicators, ["low_visible_text", "app_mount_point", "module_script"]);
});

test("inspectWebsiteEmbedPolicy separates iframe restrictions from crawlability", () => {
  const policy = inspectWebsiteEmbedPolicy(new Headers({
    "x-frame-options": "SAMEORIGIN",
    "content-security-policy": "default-src 'self'; frame-ancestors 'self' https://app.frontdeskwise.com",
  }));
  assert.equal(policy.xFrameOptions, "SAMEORIGIN");
  assert.equal(policy.frameAncestors, "'self' https://app.frontdeskwise.com");
});

test("database source page types stay aligned with the crawler taxonomy", async () => {
  const migration = await readFile(resolve(import.meta.dirname, "../../../infra/db/064_business_source_page_types.sql"), "utf8");
  for (const pageType of PAGE_TYPES) {
    assert.match(migration, new RegExp(`'${pageType}'`), `missing database page type: ${pageType}`);
  }
  assert.match(migration, /'web_page'/);
  assert.match(migration, /'document'/);
});

test("DaycareSpots-style multi-page fixture follows public internal links", async () => {
  const originalFetch = globalThis.fetch;
  const pages: Record<string, string> = {
    "/": `<html><head><title>DaycareSpots</title></head><body><header><nav>
      <a href="/ourprocess/daycare">Our Process</a><a href="/registration">Registration</a><a href="/contact">Contact</a>
      <a href="/blogs">Blogs</a><a href="/terms">Terms</a><a href="/parent">Parents</a><a href="/login">Login</a><a href="/search?page=2">Search results</a>
    </nav></header><main><h1>Find your next daycare spot with DaycareSpots</h1><p>DaycareSpots helps parents find quality childcare and helps providers connect with families. Contact our team to learn more.</p></main></body></html>`,
    "/ourprocess/daycare": `<html><head><title>Daycare provider process | DaycareSpots</title></head><body><main><h1>Daycare provider process</h1><p>Providers can claim their daycare, build visibility, connect with families, and grow their childcare business with DaycareSpots.</p></main></body></html>`,
    "/registration": `<html><head><title>Registration | DaycareSpots</title></head><body><main><h1>Registration</h1><p>Parents can register for a daycare tour and share their care needs with a provider through our public registration process.</p></main></body></html>`,
    "/contact": `<html><head><title>Contact DaycareSpots</title></head><body><main><h1>Contact us</h1><p>Call or email the DaycareSpots team for support, provider questions, and help finding childcare near you.</p></main></body></html>`,
    "/blogs": `<html><head><title>DaycareSpots blogs</title></head><body><main><h1>Blogs</h1><p>Read childcare guidance, provider insights, and helpful articles for families looking for safe daycare.</p></main></body></html>`,
    "/terms": `<html><head><title>Terms | DaycareSpots</title></head><body><main><h1>Terms of service</h1><p>These terms explain how visitors and providers may use the DaycareSpots website and marketplace.</p></main></body></html>`,
    "/parent": `<html><head><title>Parents | DaycareSpots</title></head><body><main><h1>For parents</h1><p>Parents can discover childcare options, compare providers, and request information from daycare centers.</p></main></body></html>`,
    "/login": `<html><head><title>Login | DaycareSpots</title></head><body><main><h1>Login</h1><p>Sign in to manage your account and private daycare information.</p></main></body></html>`,
  };
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname === "/robots.txt" || url.pathname === "/sitemap.xml") return new Response("", { status: 404 });
    const html = pages[url.pathname];
    return html
      ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
      : new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  }) as typeof fetch;
  try {
    const result = await crawlWebsite("https://example.com", {
      maxPages: 20,
      maxDepth: 2,
      validateUrl: async (value) => new URL(value),
    });
    const coverage = summarizeCrawlCoverage(result.audit);
    assert.ok(result.pages.length >= 6, "the crawl should index more than the seed page");
    assert.ok(result.pages.some((page) => page.url.endsWith("/ourprocess/daycare")));
    assert.ok(result.pages.some((page) => page.url.endsWith("/registration")), "public registration content should not be classified as an account route");
    assert.ok(!result.pages.some((page) => page.url.endsWith("/login")), "authenticated account routes should stay out of knowledge");
    assert.equal(coverage.discoveredUrls, 9);
    assert.equal(coverage.eligibleUrls, 7);
    assert.equal(coverage.successfulPages, 7);
    assert.equal(coverage.skippedUrls, 2);
    assert.ok(coverage.successfulPages <= coverage.attemptedUrls);
    assert.ok(coverage.attemptedUrls <= coverage.eligibleUrls);
    assert.equal(result.audit.legacyCodePathUsed, false);
    assert.equal(result.audit.backgroundWorkerUsed, false);
    const diagnostics = crawlRunDiagnostics(result.audit, coverage);
    assert.equal(diagnostics.crawlRunId, result.audit.crawlRunId);
    assert.ok(diagnostics.routes.length >= result.audit.routes.length);
    assert.ok(diagnostics.routes.some((route) => route.url.endsWith("/ourprocess/daycare")));
    assert.equal(diagnostics.routes.find((route) => route.url.endsWith("/login"))?.failureReason, "excluded_route");
    assert.equal(result.audit.failureCode, null);

    const seedOnly = await crawlWebsite("https://example.com", {
      maxPages: 1,
      maxDepth: 2,
      validateUrl: async (value) => new URL(value),
    });
    const seedOnlyCoverage = summarizeCrawlCoverage(seedOnly.audit);
    assert.equal(seedOnlyCoverage.successfulPages, 1);
    assert.ok(seedOnlyCoverage.successfulPages <= seedOnlyCoverage.attemptedUrls);
    assert.ok(seedOnlyCoverage.attemptedUrls <= seedOnlyCoverage.eligibleUrls);
    assert.equal(seedOnlyCoverage.unprocessedUrls, 6);
    assert.equal(seedOnly.audit.failureCode, "CRAWL_PARTIAL");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
