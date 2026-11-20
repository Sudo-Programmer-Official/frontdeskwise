import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const app = await readFile(resolve(here, "../src/App.vue"), "utf8");
const styles = await readFile(resolve(here, "../src/styles.css"), "utf8");
const widget = await readFile(resolve(here, "../public/widget.js"), "utf8");

test("owner production controls remain present", () => {
  for (const control of [
    "/knowledge/sources/",
    "/leads/",
    "/integrations/",
    "/widget/verify",
    "Verify installation",
    "Export CSV",
    "Actions",
    "Integrations",
    "settingsTabs",
    "profile-menu",
    "Test & connect securely",
    "Review tool access",
  ]) {
    assert.ok(app.includes(control), `missing owner control: ${control}`);
  }
  assert.match(app, /const navSections/);
  assert.match(app, /label: "Customers"/);
  assert.match(app, /label: "AI front desk"/);
  assert.match(app, /label: "Business"/);
  assert.match(app, /Your AI front desk is ready/);
  assert.match(app, /sidebar-account/);
  assert.match(app, /agent-tabs/);
  assert.doesNotMatch(app, /Preview ↗/);
  assert.doesNotMatch(app, />Edit agent</);
  assert.doesNotMatch(app, /id: "conversations", label: "Conversations"/);
  assert.doesNotMatch(app, /id: "billing", label: "Billing", icon:/);
});

test("owner UI uses the shared product design language", () => {
  assert.match(styles, /font-family:[^;]*Inter/);
  assert.match(styles, /select option\s*\{/);
  assert.match(styles, /mobile-preview/);
  assert.match(app, /aria-label="Widget preview"/);
});

test("unfinished internal implementation language is not rendered in owner UI", () => {
  assert.doesNotMatch(app, />Human handoff</i);
  assert.doesNotMatch(app, />Model routing</i);
  assert.doesNotMatch(app, /placeholder metrics/i);
});

test("embedded widget uses the responsive conversation shell", () => {
  for (const feature of [
    "mode-expanded",
    "mode-fullscreen",
    "widgetQuickActions",
    "aria-label=\"Expand assistant\"",
    "100dvh",
    "View source ↗",
    "proactiveTriggers",
    "frontdeskwise:visitor:",
    "lead-consent",
  ]) {
    assert.ok(widget.includes(feature), `missing widget shell feature: ${feature}`);
  }
});
