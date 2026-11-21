import assert from "node:assert/strict";
import test from "node:test";
import { CrawlError, detectSpaIndicators, extractBrandColors, normalisePublicUrl, websiteIdentityKey } from "../src/crawler.ts";

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
