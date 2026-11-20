import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const server = await readFile(resolve(process.cwd(), "src/server.ts"), "utf8");
const settingsMigration = await readFile(resolve(process.cwd(), "../../infra/db/030_handoff_notification_settings.sql"), "utf8");
const templateMigration = await readFile(resolve(process.cwd(), "../../infra/db/031_human_handoff_template.sql"), "utf8");
const gapTemplateMigration = await readFile(resolve(process.cwd(), "../../infra/db/032_knowledge_gap_template.sql"), "utf8");

test("handoff storage and delivery are business-scoped and actionable", () => {
  assert.match(settingsMigration, /create table if not exists business_notification_settings/);
  assert.match(settingsMigration, /business_id uuid primary key references businesses\(id\)/);
  assert.match(templateMigration, /Customer waiting for help — FrontDeskWise/);
  assert.match(templateMigration, /Open conversation/);
  assert.match(gapTemplateMigration, /knowledge_gap/);
  assert.match(server, /\/notification-settings/);
  assert.match(server, /inbox_url: lifecycleAppUrl\(`\/app\/\$\{business\.slug\}\/inbox\?conversation=/);
});

test("takeover and staff replies use explicit state and transaction boundaries", () => {
  assert.match(server, /await client\.query\("begin"\)/);
  assert.match(server, /status = 'HUMAN_ACTIVE'/);
  assert.match(server, /if \(conversation\.status !== "HUMAN_ACTIVE"\) throw httpError\(409, "Take over this conversation before replying"\)/);
  assert.match(server, /kind: "message", authorUserId/);
  assert.match(server, /conversation_messages|persistMessage/);
});
