export type IntegrationOperation = "completion_action" | "agent_tool";
export type IntegrationMechanism = "direct_api" | "mcp" | "generic_webhook" | "email";

export type IntegrationRouteInput = {
  operation: IntegrationOperation;
  preferred?: IntegrationMechanism;
  deterministic?: boolean;
};

export type IntegrationRoute = {
  mechanism: IntegrationMechanism;
  reason: "deterministic_completion" | "explicit_mcp_preference" | "configured_direct_api" | "fallback";
};

/**
 * The router is intentionally policy-first. Completion actions remain
 * deterministic even when an MCP connection exists; MCP is selected only for
 * explicitly configured agent-tool work or a future non-critical workflow.
 */
export function routeIntegration(input: IntegrationRouteInput): IntegrationRoute {
  if (input.operation === "completion_action" || input.deterministic !== false) {
    return { mechanism: input.preferred === "email" || input.preferred === "generic_webhook" ? input.preferred : "direct_api", reason: "deterministic_completion" };
  }
  if (input.preferred === "mcp") return { mechanism: "mcp", reason: "explicit_mcp_preference" };
  if (input.preferred === "direct_api") return { mechanism: "direct_api", reason: "configured_direct_api" };
  return { mechanism: "direct_api", reason: "fallback" };
}
