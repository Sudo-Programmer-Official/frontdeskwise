import assert from "node:assert/strict";
import test from "node:test";
import { markdownToSafeHtml, safeLinkUrl } from "../../web/src/widget-ui/markdown.ts";

test("assistant Markdown renders bold, lists, and safe links", () => {
  const html = markdownToSafeHtml("**Visit PlanCraftAI:**\n\n1. Try it free.\n2. Create a task.\n\n[Get started](https://plancraftai.example/start)");
  assert.match(html, /<strong>Visit PlanCraftAI:<\/strong>/);
  assert.match(html, /<ol><li>1?Try it free\.<\/li><li>Create a task\.<\/li><\/ol>|<ol><li>Try it free\.<\/li><li>Create a task\.<\/li><\/ol>/);
  assert.match(html, /href="https:\/\/plancraftai\.example\/start"/);
  assert.doesNotMatch(html, /\*\*/);
});

test("assistant Markdown escapes XSS and rejects unsafe URLs", () => {
  const html = markdownToSafeHtml("<script>alert(1)</script> [bad](javascript:alert(1)) [good](https://example.com)");
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script|javascript:/i);
  assert.match(html, /href="https:\/\/example\.com\/"/);
  assert.equal(safeLinkUrl("javascript:alert(1)"), null);
});
