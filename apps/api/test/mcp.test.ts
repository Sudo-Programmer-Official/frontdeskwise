import assert from "node:assert/strict";
import test from "node:test";
import { createMcpClient, executeAllowedReadOnlyTool, toolPermissions, type McpClient } from "../src/mcp.js";

test("MCP client initializes and discovers tools over JSON responses", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { method?: string };
    requests.push(body.method ?? "");
    if (body.method === "initialize") return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { protocolVersion: "2025-06-18", capabilities: {} } }), { status: 200, headers: { "content-type": "application/json", "mcp-session-id": "session-1" } });
    if (body.method === "notifications/initialized") return new Response("", { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search_contact", description: "Find a contact", annotations: { readOnlyHint: true } }, { name: "delete_contact", description: "Delete a contact" }] } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const tools = await createMcpClient({ serverUrl: "http://127.0.0.1/mcp", bearerToken: "token" }).listTools();
    assert.deepEqual(tools.map((tool) => tool.name), ["search_contact", "delete_contact"]);
    assert.deepEqual(requests.slice(0, 3), ["initialize", "notifications/initialized", "tools/list"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("MCP policy classifies read-only and risky tools", () => {
  const permissions = toolPermissions([
    { name: "search_contact", annotations: { readOnlyHint: true } },
    { name: "create_task" },
    { name: "delete_contact", annotations: { destructiveHint: true } },
  ]);
  assert.equal(permissions[0].readOnly, true);
  assert.equal(permissions[0].approvalRequired, false);
  assert.equal(permissions[1].approvalRequired, true);
  assert.equal(permissions[2].destructive, true);
});

test("MCP execution is gated by the saved allowlist and read-only policy", async () => {
  const calls: string[] = [];
  const client = { callTool: async (name: string) => { calls.push(name); return { ok: true }; } } as unknown as McpClient;
  const tools = [{ name: "search_contact", annotations: { readOnlyHint: true } }, { name: "create_task" }];
  await assert.rejects(
    executeAllowedReadOnlyTool(client, tools, [], "search_contact"),
    /not enabled/,
  );
  await executeAllowedReadOnlyTool(client, tools, ["search_contact"], "search_contact");
  assert.deepEqual(calls, ["search_contact"]);
  await assert.rejects(
    executeAllowedReadOnlyTool(client, tools, ["create_task"], "create_task"),
    /Only read-only/,
  );
});
