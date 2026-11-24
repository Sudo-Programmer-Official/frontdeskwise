import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeProviderCapability,
  customerVerificationFromResult,
  executeProviderCapability,
  ingestOpenApiDocument,
  manualProviderCapability,
  providerCapabilityInputErrors,
  providerOperationHonesty,
} from "../src/provider-capabilities.js";

test("OpenAPI operations become reviewable typed capabilities with safe defaults", () => {
  const result = ingestOpenApiDocument("connection-1", {
    openapi: "3.0.3",
    servers: [{ url: "https://example.com" }],
    security: [{ bearerAuth: [] }],
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } },
    paths: {
      "/daycares/search": {
        get: {
          operationId: "searchDaycares",
          summary: "Search daycares",
          parameters: [
            { name: "zip", in: "query", required: true, schema: { type: "string" } },
            { name: "age", in: "query", required: true, schema: { type: "integer" } },
          ],
          responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
      "/tours": {
        post: {
          operationId: "scheduleTour",
          requestBody: { content: { "application/json": { schema: { type: "object", required: ["daycare_id"], properties: { daycare_id: { type: "string" } } } } } },
          responses: { "201": { content: { "application/json": { schema: { type: "object", properties: { id: { type: "string" } } } } } } },
        },
      },
    },
  });

  assert.equal(result.baseUrl, "https://example.com");
  assert.deepEqual(result.capabilities.map((capability) => ({ key: capability.key, type: capability.type, method: capability.method })), [
    { key: "search_daycares", type: "READ", method: "GET" },
    { key: "schedule_tour", type: "WRITE", method: "POST" },
  ]);
  assert.deepEqual(result.capabilities[0].inputSchema.required, ["zip", "age"]);
  assert.equal(result.capabilities[0].authScope, "bearerAuth");
  assert.equal(result.capabilities[0].enabled, false);
  assert.equal(result.capabilities[1].confirmationRequired, true);
  assert.equal(result.capabilities[1].requiresVerifiedCustomer, true);
  assert.equal(result.capabilities[1].fallbackBehavior, "capture_request");
  assert.deepEqual(providerCapabilityInputErrors(result.capabilities[0].inputSchema, { zip: "33755" }), ["age"]);
});

test("approved read capabilities execute only their registered inputs", async () => {
  const imported = ingestOpenApiDocument("connection-1", {
    openapi: "3.0.0",
    servers: [{ url: "https://example.com" }],
    paths: {
      "/daycares/search": {
        get: {
          operationId: "searchDaycares",
          parameters: [{ name: "zip", in: "query", required: true, schema: { type: "string" } }],
          responses: { "200": { content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } } },
        },
      },
    },
  });
  const capability = { ...imported.capabilities[0], lifecycleStatus: "approved" as const, enabled: true };
  let calledUrl = "";
  let calledHeaders: Headers | null = null;
  const output = await executeProviderCapability(
    capability,
    { baseUrl: "https://example.com", status: "active" },
    { type: "bearer_token", token: "secret" },
    { zip: "33755", ignored: "not forwarded" },
    {
      fetcher: async (input, init) => {
        calledUrl = String(input);
        calledHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify([{ id: "daycare-1" }]), { status: 200, headers: { "content-type": "application/json" } });
      },
      urlValidator: async (value) => new URL(value),
    },
  );
  assert.deepEqual(output, [{ id: "daycare-1" }]);
  assert.equal(calledUrl, "https://example.com/daycares/search?zip=33755");
  assert.equal(calledHeaders?.get("authorization"), "Bearer secret");
  assert.equal(calledHeaders?.get("ignored"), null);
});

test("manual capabilities default writes to confirmation and validate their path", () => {
  const capability = manualProviderCapability("connection-1", { key: "join_waitlist", method: "POST", path: "/daycares/{id}/waitlist" });
  assert.equal(capability.type, "WRITE");
  assert.equal(capability.confirmationRequired, true);
  assert.throws(() => manualProviderCapability("connection-1", { key: "bad", method: "GET", path: "https://evil.example" }), /absolute API path/);
});

test("write authorization requires verified identity and explicit confirmation", () => {
  const capability = {
    ...manualProviderCapability("connection-1", {
      key: "schedule_tour",
      method: "POST",
      path: "/tours",
      inputSchema: { type: "object", required: ["daycare_id"], properties: { daycare_id: { type: "string" } } },
    }),
    lifecycleStatus: "approved" as const,
    enabled: true,
  };
  const base = {
    capability,
    providerConnected: true,
    tenantMatch: true,
    input: { daycare_id: "daycare-1" },
    customerVerification: { status: "UNKNOWN" as const },
  };
  assert.equal(authorizeProviderCapability({ ...base, confirmationReceived: true }).reason, "customer_not_verified");
  assert.equal(authorizeProviderCapability({ ...base, customerVerification: { status: "VERIFIED" }, confirmationReceived: false }).reason, "confirmation_required");
  assert.equal(authorizeProviderCapability({ ...base, customerVerification: { status: "VERIFIED" }, confirmationReceived: true }).allowed, true);
});

test("operation honesty separates lookup, preparation, submission, and confirmed success", () => {
  assert.deepEqual(providerOperationHonesty({ type: "READ", status: "succeeded", authorization: "allowed", resultStatus: "matched" }), {
    canAnswer: true,
    canLookup: true,
    canPrepare: true,
    canSubmit: false,
    canConfirmSuccess: false,
  });
  assert.equal(providerOperationHonesty({ type: "WRITE", status: "failed", authorization: "allowed", resultStatus: "failed" }).canConfirmSuccess, false);
  assert.equal(providerOperationHonesty({ type: "WRITE", status: "succeeded", authorization: "allowed", resultStatus: "succeeded" }).canConfirmSuccess, true);
});

test("customer lookup capabilities persist explicit verification outcomes", () => {
  const capability = {
    ...manualProviderCapability("connection-1", { key: "lookup_customer", method: "GET", path: "/customers" }),
    lifecycleStatus: "approved" as const,
    enabled: true,
  };
  assert.equal(customerVerificationFromResult(capability, { status: "matched", matches: [{ id: "customer-1" }] })?.status, "VERIFIED");
  assert.equal(customerVerificationFromResult(capability, { status: "matched", matches: [{ id: "a" }, { id: "b" }] })?.status, "AMBIGUOUS");
  assert.equal(customerVerificationFromResult(capability, { status: "not_found", matches: [] })?.status, "NOT_FOUND");
  assert.equal(customerVerificationFromResult(capability, { status: "unavailable", matches: [] })?.status, "PROVIDER_UNAVAILABLE");
});
