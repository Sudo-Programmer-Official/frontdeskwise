import test from "node:test";
import assert from "node:assert/strict";
import { interpolateTemplate, renderLifecycleEmail } from "../src/lifecycle-messaging.js";

test("lifecycle templates interpolate variables and preserve a safe HTML envelope", () => {
  const rendered = renderLifecycleEmail({
    subject: "Hello {{first_name}}",
    previewText: "Preview for {{business_name}}",
    heading: "Your front desk is ready",
    body: "Welcome, {{first_name}}.\n\nYour business is {{business_name}}.",
    ctaLabel: "Open dashboard",
    ctaUrl: "{{dashboard_url}}",
    footer: "Transactional message",
  }, {
    first_name: "Ava & Co",
    business_name: "Ava <Dental>",
    dashboard_url: "https://app.example.test/workspace",
  });

  assert.equal(rendered.subject, "Hello Ava & Co");
  assert.match(rendered.text, /Ava & Co/);
  assert.match(rendered.html, /Ava &lt;Dental&gt;/);
  assert.ok(rendered.html.includes("https://app.example.test/workspace"));
});

test("missing lifecycle variables render as empty strings", () => {
  assert.equal(interpolateTemplate("{{known}}/{{missing}}", { known: "value" }), "value/");
});

test("subscription lifecycle emails render branded secondary billing and support links", () => {
  const rendered = renderLifecycleEmail({
    subject: "Welcome {{plan_name}}",
    previewText: "Your plan is active",
    heading: "You’re all set",
    body: "Your {{plan_name}} plan is active.",
    ctaLabel: "Open FrontDeskWise",
    ctaUrl: "{{dashboard_url}}",
    secondaryCtas: [
      { label: "Manage billing", url: "{{billing_url}}" },
      { label: "Get support", url: "{{support_url}}" },
    ],
    footer: "FrontDeskWise is a product of Sudo Programmer, Inc.",
  }, {
    plan_name: "Growth",
    dashboard_url: "https://app.example.test",
    billing_url: "https://app.example.test/app/settings/billing",
    support_url: "mailto:support@example.test",
  });

  assert.match(rendered.html, /Open FrontDeskWise/);
  assert.match(rendered.html, /Manage billing/);
  assert.match(rendered.html, /Get support/);
  assert.match(rendered.text, /mailto:support@example.test/);
});
