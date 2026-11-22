import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { CrawlError, detectSpaIndicators, extractBrandColors, inspectWebsiteEmbedPolicy, normalisePublicUrl, websiteIdentityKey } from "../src/crawler.ts";
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
