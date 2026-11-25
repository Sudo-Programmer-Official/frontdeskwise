import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyRequestTraffic,
  normalizeRequestRoute,
  requestFailureClass,
  RequestTelemetryBuffer,
} from "../src/request-telemetry.js";

test("request telemetry classifies health, polling, customer, and internal traffic", () => {
  assert.equal(classifyRequestTraffic("/ready", "GET"), "health_check");
  assert.equal(classifyRequestTraffic("/api/v1/widget/site/conversations/id/status", "GET"), "polling");
  assert.equal(classifyRequestTraffic("/api/v1/demo/demo-slug/inbox", "GET"), "polling");
  assert.equal(classifyRequestTraffic("/api/v1/widget/site/conversations/id/messages", "POST"), "customer_value");
  assert.equal(classifyRequestTraffic("/api/v1/admin/organizations", "GET"), "internal");
  assert.equal(classifyRequestTraffic("/api/v1/widget/site/performance", "POST"), "background");
});

test("request telemetry normalizes tenant and resource identifiers", () => {
  assert.equal(
    normalizeRequestRoute("/api/v1/widget/site-key/conversations/123e4567-e89b-12d3-a456-426614174000/status"),
    "/api/v1/widget/:siteKey/conversations/:id/status",
  );
  assert.equal(normalizeRequestRoute("/api/v1/demo/harbor-home/leads/123"), "/api/v1/demo/:slug/leads/:id");
});

test("request telemetry aggregates counts, errors, latency buckets, and hourly dimensions", () => {
  const buffer = new RequestTelemetryBuffer();
  const occurredAt = new Date("2026-11-22T15:42:00.000Z");
  buffer.record({ route: "/api/v1/widget/site/conversations/id/status", method: "GET", trafficClass: "polling", statusCode: 200, durationMs: 42, occurredAt });
  buffer.record({ route: "/api/v1/widget/site/conversations/id/status", method: "GET", trafficClass: "polling", statusCode: 503, durationMs: 1_240, occurredAt });
  const [row] = buffer.snapshot();
  assert.equal(buffer.size, 1);
  assert.equal(row.requestCount, 2);
  assert.equal(row.errorCount, 1);
  assert.equal(row.durationLe50, 1);
  assert.equal(row.durationLe2000, 1);
  assert.deepEqual(row.statusCounts, { "200": 1, "503": 1 });
  assert.equal(row.bucketStart.toISOString(), "2026-11-22T15:00:00.000Z");
});

test("request telemetry classifies polling lifecycle failures separately from actionable failures", () => {
  assert.equal(requestFailureClass(404, "polling"), "expected_lifecycle");
  assert.equal(requestFailureClass(401, "customer_value"), "auth");
  assert.equal(requestFailureClass(429, "polling"), "rate_limit");
  assert.equal(requestFailureClass(500, "customer_value"), "internal_server");
});
