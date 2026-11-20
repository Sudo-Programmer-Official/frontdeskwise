import assert from "node:assert/strict";
import test from "node:test";
import { CrawlError, normalisePublicUrl, websiteIdentityKey } from "../src/crawler.ts";

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
