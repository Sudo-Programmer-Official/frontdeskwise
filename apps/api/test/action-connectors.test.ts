import assert from "node:assert/strict";
import test from "node:test";
import { createActionConnector, type ActionInput } from "../src/action-connectors.js";

const input: ActionInput = {
  idempotencyKey: "action.completed:conversation:flow",
  tenant: { id: "business", slug: "demo", name: "Demo business" },
  conversationId: "conversation",
  flow: { id: "flow", key: "enroll_child", name: "Register or enroll" },
  values: { email: "parent@example.com", child_age: "6" },
  lead: { id: "lead", name: "Parent", email: "parent@example.com", phone: null, intent: "Register or enroll", status: "qualified" },
  completedAt: new Date().toISOString(),
};

test("generic webhook connector validates and forwards an idempotent action payload", async () => {
  let body = "";
  let idempotencyKey = "";
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const headers = new Headers(init?.headers);
    idempotencyKey = headers.get("x-frontdeskwise-idempotency-key") ?? "";
    body = String(init?.body ?? "");
    return new Response(JSON.stringify({ id: "remote-123", url: "https://example.com/remote-123" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  try {
    const connector = createActionConnector("generic_webhook", { endpoint: "http://127.0.0.1/action", signingSecret: "secret" });
    assert.equal(await connector.validateConfig(), true);
    const result = await connector.execute(input);
    assert.equal(result.remoteObjectId, "remote-123");
    assert.equal(idempotencyKey, input.idempotencyKey);
    assert.equal(JSON.parse(body).event, "action.completed");
    assert.equal(JSON.parse(body).values.child_age, "6");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
