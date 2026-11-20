import { requiredUrl } from "./mcp-url.js";

export type McpProvider = "hubspot" | "zapier" | "make" | "custom";

export type McpTool = {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
};

export type McpToolPermission = McpTool & {
  readOnly: boolean;
  destructive: boolean;
  approvalRequired: boolean;
  allowed: boolean;
};

export type McpConnectionConfig = {
  serverUrl: string;
  bearerToken: string;
  protocolVersion?: string;
};

type JsonRpcResponse = {
  result?: Record<string, unknown>;
  error?: { code?: number; message?: string };
};

function timeoutSignal(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

function compactError(error: unknown): Error {
  if (error instanceof Error && error.name === "AbortError") return new Error("MCP server did not respond in time");
  return error instanceof Error ? error : new Error("MCP request failed");
}

async function responsePayload(response: Response): Promise<JsonRpcResponse> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const text = await response.text();
    const data = text
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .filter(Boolean)
      .at(-1);
    if (!data) throw new Error("MCP server returned an empty event stream");
    return JSON.parse(data) as JsonRpcResponse;
  }
  return await response.json() as JsonRpcResponse;
}

function toolFromValue(value: unknown): McpTool | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.name !== "string" || !record.name.trim()) return null;
  const annotations = record.annotations && typeof record.annotations === "object"
    ? record.annotations as Record<string, unknown>
    : undefined;
  return {
    name: record.name.trim().slice(0, 160),
    title: typeof record.title === "string" ? record.title.slice(0, 240) : undefined,
    description: typeof record.description === "string" ? record.description.slice(0, 2_000) : undefined,
    inputSchema: record.inputSchema && typeof record.inputSchema === "object" ? record.inputSchema as Record<string, unknown> : undefined,
    annotations: annotations ? {
      readOnlyHint: annotations.readOnlyHint === true,
      destructiveHint: annotations.destructiveHint === true,
      idempotentHint: annotations.idempotentHint === true,
    } : undefined,
  };
}

export function classifyMcpTool(tool: McpTool): Pick<McpToolPermission, "readOnly" | "destructive" | "approvalRequired"> {
  const name = tool.name.toLowerCase();
  const readOnly = tool.annotations?.readOnlyHint === true
    || /^(search|find|get|list|lookup|read|fetch|retrieve|describe|check|view|query|who|what|when|where)/.test(name);
  const destructive = tool.annotations?.destructiveHint === true
    || /(^|_)(delete|remove|destroy|purge|archive|bulk_delete)(_|$)/.test(name);
  return { readOnly, destructive, approvalRequired: !readOnly || destructive };
}

export function toolPermissions(tools: McpTool[], allowedTools: string[] = []): McpToolPermission[] {
  const allowed = new Set(allowedTools);
  return tools.map((tool) => ({
    ...tool,
    ...classifyMcpTool(tool),
    allowed: allowed.has(tool.name),
  }));
}

export class McpClient {
  private requestId = 0;
  private sessionId: string | null = null;
  private initialized = false;

  constructor(private readonly config: McpConnectionConfig) {
    requiredUrl(config.serverUrl);
    if (!config.bearerToken.trim()) throw new Error("MCP access token is required");
  }

  private async request(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const request = timeoutSignal();
    const id = ++this.requestId;
    try {
      const response = await fetch(requiredUrl(this.config.serverUrl), {
        method: "POST",
        signal: request.signal,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          authorization: `Bearer ${this.config.bearerToken.trim()}`,
          "mcp-protocol-version": this.config.protocolVersion ?? "2025-06-18",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      });
      if (!response.ok) throw new Error(`MCP server request failed (${response.status})`);
      this.sessionId = response.headers.get("mcp-session-id") ?? this.sessionId;
      const payload = await responsePayload(response);
      if (payload.error) throw new Error(payload.error.message ?? "MCP server returned an error");
      return payload.result ?? {};
    } catch (error) {
      throw compactError(error);
    } finally {
      request.cleanup();
    }
  }

  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const request = timeoutSignal();
    try {
      const response = await fetch(requiredUrl(this.config.serverUrl), {
        method: "POST",
        signal: request.signal,
        headers: {
          accept: "application/json, text/event-stream",
          "content-type": "application/json",
          authorization: `Bearer ${this.config.bearerToken.trim()}`,
          "mcp-protocol-version": this.config.protocolVersion ?? "2025-06-18",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method, params }),
      });
      if (!response.ok) throw new Error(`MCP server notification failed (${response.status})`);
    } catch (error) {
      throw compactError(error);
    } finally {
      request.cleanup();
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.request("initialize", {
      protocolVersion: this.config.protocolVersion ?? "2025-06-18",
      capabilities: {},
      clientInfo: { name: "FrontDeskWise", version: "0.1.0" },
    });
    this.initialized = true;
    try { await this.notify("notifications/initialized"); } catch { /* Notifications are optional for compatibility. */ }
  }

  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const result = await this.request("tools/list");
    const tools = Array.isArray(result.tools) ? result.tools.map(toolFromValue).filter((tool): tool is McpTool => Boolean(tool)) : [];
    return tools.slice(0, 200);
  }

  async callTool(toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await this.initialize();
    return this.request("tools/call", { name: toolName, arguments: argumentsValue });
  }
}

export async function executeAllowedReadOnlyTool(
  client: McpClient,
  tools: McpTool[],
  allowedTools: string[],
  toolName: string,
  argumentsValue: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  const permission = toolPermissions(tools, allowedTools).find((tool) => tool.name === toolName);
  if (!permission || !permission.allowed) throw new Error("This MCP tool is not enabled for the business");
  if (!permission.readOnly || permission.destructive) throw new Error("Only read-only MCP tools are available to the assistant right now");
  return client.callTool(toolName, argumentsValue);
}

/** Provider-labeled adapter for the first MCP rollout. HubSpot's tool names
 * can evolve, so discovery stays schema-driven while execution remains
 * read-only and policy-gated. */
export class HubSpotMcpConnector {
  constructor(private readonly client: McpClient) {}

  async listReadOnlyTools(): Promise<McpTool[]> {
    const tools = await this.client.listTools();
    return tools.filter((tool) => classifyMcpTool(tool).readOnly && !classifyMcpTool(tool).destructive);
  }

  async executeReadOnlyTool(tools: McpTool[], allowedTools: string[], toolName: string, argumentsValue: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return executeAllowedReadOnlyTool(this.client, tools, allowedTools, toolName, argumentsValue);
  }
}

export function createMcpClient(config: McpConnectionConfig): McpClient {
  return new McpClient(config);
}

export function createHubSpotMcpConnector(config: McpConnectionConfig): HubSpotMcpConnector {
  return new HubSpotMcpConnector(createMcpClient(config));
}
