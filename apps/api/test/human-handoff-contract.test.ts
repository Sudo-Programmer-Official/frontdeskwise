import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const server = await readFile(resolve(process.cwd(), "src/server.ts"), "utf8");
const settingsMigration = await readFile(resolve(process.cwd(), "../../infra/db/030_handoff_notification_settings.sql"), "utf8");
const templateMigration = await readFile(resolve(process.cwd(), "../../infra/db/031_human_handoff_template.sql"), "utf8");
const gapTemplateMigration = await readFile(resolve(process.cwd(), "../../infra/db/032_knowledge_gap_template.sql"), "utf8");
const gapRepairMigration = await readFile(resolve(process.cwd(), "../../infra/db/033_knowledge_gap_diagnostics_repair.sql"), "utf8");
const followUpMigration = await readFile(resolve(process.cwd(), "../../infra/db/068_handoff_follow_up_pending.sql"), "utf8");

test("handoff storage and delivery are business-scoped and actionable", () => {
  assert.match(settingsMigration, /create table if not exists business_notification_settings/);
  assert.match(settingsMigration, /business_id uuid primary key references businesses\(id\)/);
  assert.match(templateMigration, /Customer waiting for help — FrontDeskWise/);
  assert.match(templateMigration, /Open conversation/);
  assert.match(gapTemplateMigration, /knowledge_gap/);
  assert.match(gapRepairMigration, /add column if not exists intent/);
  assert.match(gapRepairMigration, /add column if not exists reason/);
  assert.match(followUpMigration, /FOLLOW_UP_PENDING/);
  assert.match(followUpMigration, /handoff_timeout_seconds/);
  assert.match(server, /\/notification-settings/);
  assert.match(server, /inbox_url: lifecycleAppUrl\(`\/app\/\$\{business\.slug\}\/inbox\?conversation=/);
  assert.match(server, /using legacy schema/);
  assert.match(server, /Knowledge-gap follow-up failed after answer was generated/);
});

test("takeover and staff replies use explicit state and transaction boundaries", () => {
  assert.match(server, /await client\.query\("begin"\)/);
  assert.match(server, /status = 'HUMAN_ACTIVE'/);
  assert.match(server, /if \(conversation\.status !== "HUMAN_ACTIVE"\) throw httpError\(409, "Take over this conversation before replying"\)/);
  assert.match(server, /kind: "message", authorUserId/);
  assert.match(server, /conversation_messages|persistMessage/);
});

test("returning a conversation to AI clears live takeover state", () => {
  assert.match(server, /app\.post\("\/api\/v1\/demo\/:slug\/conversations\/:conversationId\/return-to-ai"/);
  assert.match(server, /set status = 'AI_ACTIVE', assigned_user_id = null, assigned_at = null/);
  assert.match(server, /handoff_reason = null, handoff_requested_at = null, handoff_notification_status = null/);
  assert.match(server, /human_joined_at = null/);
  assert.match(server, /conversation\.status = "AI_ACTIVE"/);
  assert.match(server, /conversation\.handoffReason = null/);
  assert.match(server, /conversation\.handoffRequestedAt = null/);
  assert.match(server, /conversation\.humanJoinedAt = null/);
  assert.match(server, /conversation_assignments set status = 'released'/);
});

test("widget status polling has a lightweight canonical status contract", () => {
  assert.match(server, /conversations\/:conversationId\/status/);
  assert.match(server, /updatedAt: conversation\.updatedAt/);
  assert.match(server, /return \{ conversation: conversationStatusPayload\(conversation, business\) \}/);
});
