import assert from "node:assert/strict";
import { crawlWebsite, summarizeCrawlCoverage } from "./crawler.js";

const originalFetch = globalThis.fetch;
const fixturePages: Record<string, string> = {
  "/": `<html><head><title>DaycareSpots</title></head><body><nav>
    <a href="/ourprocess/daycare">Provider process</a><a href="/registration">Registration</a>
    <a href="/contact">Contact</a><a href="/blogs">Blogs</a><a href="/terms">Legal</a>
    <a href="/login">Login</a>
  </nav><main><h1>Find your next daycare spot</h1><p>DaycareSpots helps parents find childcare and helps providers connect with families. Contact us for registration, tours, locations, and support.</p></main></body></html>`,
  "/ourprocess/daycare": `<html><head><title>Provider process</title></head><body><h1>Provider process</h1><p>Providers can claim their daycare, build visibility, and connect with families.</p></body></html>`,
  "/registration": `<html><head><title>Registration</title></head><body><h1>Registration</h1><p>Parents can register for a daycare tour and share care needs with a provider.</p></body></html>`,
  "/contact": `<html><head><title>Contact</title></head><body><h1>Contact us</h1><p>Call or email the DaycareSpots team for support and help finding childcare.</p></body></html>`,
  "/blogs": `<html><head><title>Blogs</title></head><body><h1>Blogs</h1><p>Read childcare guidance and provider insights for families looking for safe daycare.</p></body></html>`,
  "/terms": `<html><head><title>Terms</title></head><body><h1>Terms of service</h1><p>These terms explain how visitors and providers may use the marketplace.</p></body></html>`,
  "/login": `<html><head><title>Login</title></head><body><h1>Login</h1><p>Sign in to manage private account information.</p></body></html>`,
};

globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  const html = fixturePages[url.pathname];
  return html
    ? new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } })
    : new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
}) as typeof fetch;

try {
  const result = await crawlWebsite("https://daycarespots.fixture", {
    maxPages: 20,
    maxDepth: 2,
    validateUrl: async (value) => new URL(value),
  });
  const coverage = summarizeCrawlCoverage(result.audit);
  assert.ok(coverage.eligibleUrls > 1, "fixture must discover multiple eligible public pages");
  assert.ok(coverage.attemptedUrls > 1, "crawler must attempt more than the seed page");
  assert.ok(result.pages.length > 1, "crawler must persist more than the seed page");
  assert.ok(!result.pages.some((page) => page.url.endsWith("/login")), "login must be excluded");
  assert.ok(coverage.successfulPages <= coverage.attemptedUrls);
  assert.ok(coverage.attemptedUrls <= coverage.eligibleUrls);
  assert.equal(result.audit.legacyCodePathUsed, false);
  assert.equal(result.audit.backgroundWorkerUsed, false);
  console.log(JSON.stringify({
    certification: "crawler",
    pass: true,
    discoveredUrls: coverage.discoveredUrls,
    eligibleUrls: coverage.eligibleUrls,
    attemptedUrls: coverage.attemptedUrls,
    successfulPages: coverage.successfulPages,
    skippedUrls: coverage.skippedUrls,
    coveragePercent: coverage.coveragePercent,
    crawlRunId: result.audit.crawlRunId,
  }));
} finally {
  globalThis.fetch = originalFetch;
}
