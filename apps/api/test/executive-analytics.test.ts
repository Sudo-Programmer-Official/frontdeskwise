import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutiveAnalytics } from "../src/executive-analytics.js";

const now = new Date("2026-11-22T12:00:00.000Z");

test("builds the executive funnel and quality metrics from recent activity", () => {
  const result = buildExecutiveAnalytics({
    businessCreatedAt: "2026-11-01T12:00:00.000Z",
    verified: true,
    published: true,
    widgetInstalled: true,
    knowledgeReadinessScore: 86,
    conversations: [
      {
        id: "conversation-1",
        status: "AI_ACTIVE",
        createdAt: "2026-11-20T10:00:00.000Z",
        messages: [
          { role: "assistant", createdAt: "2026-11-20T10:00:01.000Z", retrieval: { validationStatus: "accepted", estimatedCostUsd: 0.01 } },
        ],
      },
      {
        id: "conversation-2",
        status: "HUMAN_ACTIVE",
        createdAt: "2026-11-21T10:00:00.000Z",
        humanJoinedAt: "2026-11-21T10:01:00.000Z",
        messages: [
          { role: "assistant", createdAt: "2026-11-21T10:00:01.000Z", retrieval: { validationStatus: "fallback", estimatedCostUsd: 0.005 } },
        ],
      },
    ],
    leads: [
      { id: "lead-1", conversationId: "conversation-1", status: "qualified", createdAt: "2026-11-20T10:02:00.000Z" },
      { id: "lead-2", conversationId: "conversation-1", status: "booked", createdAt: "2026-11-20T10:03:00.000Z" },
    ],
    conversionEvents: [
      { id: "event-1", event: "FLOW_STARTED", conversationId: "conversation-1", timestamp: "2026-11-20T10:00:00.000Z" },
      { id: "event-2", event: "FLOW_COMPLETED", conversationId: "conversation-1", timestamp: "2026-11-20T10:04:00.000Z" },
      { id: "event-3", event: "HANDOFF_REQUESTED", conversationId: "conversation-2", timestamp: "2026-11-21T10:01:00.000Z" },
    ],
    experience: { totalSignals: 1, affectedSessions: 1 },
    now,
  });

  assert.deepEqual(result.funnel.steps.slice(0, 6).map((step) => step.value), [1, 1, 1, 1, 1, 1]);
  assert.equal(result.funnel.qualifiedLeads, 2);
  assert.equal(result.funnel.conversions, 1, "booked lead should not double-count a completed flow");
  assert.equal(result.quality.totalConversations, 2);
  assert.equal(result.quality.assistantResponses, 2);
  assert.equal(result.quality.fallbackResponses, 1);
  assert.equal(result.quality.totalLlmCostUsd, 0.015);

  const metric = (key: string) => result.quality.metrics.find((item) => item.key === key);
  assert.equal(metric("workflow_success")?.value, 100);
  assert.equal(metric("safe_fallback_rate")?.value, 50);
  assert.equal(metric("frustration_rate")?.value, 50);
  assert.equal(metric("handoff_rate")?.value, 50);
  assert.equal(metric("conversion_rate")?.value, 50);
  assert.equal(metric("cost_per_conversation")?.value, 0.0075);
  assert.equal(metric("cost_per_conversion")?.value, 0.015);
});

test("keeps missing telemetry explicit instead of turning it into false precision", () => {
  const result = buildExecutiveAnalytics({
    businessCreatedAt: "2026-11-22T10:00:00.000Z",
    verified: false,
    published: false,
    widgetInstalled: false,
    knowledgeReadinessScore: 0,
    conversations: [],
    leads: [],
    conversionEvents: [],
    experience: { totalSignals: 0, affectedSessions: 0 },
    now,
  });

  const metric = (key: string) => result.quality.metrics.find((item) => item.key === key);
  assert.equal(metric("workflow_success")?.value, null);
  assert.equal(metric("safe_fallback_rate")?.value, null);
  assert.equal(metric("frustration_rate")?.value, null);
  assert.equal(metric("cost_per_conversation")?.value, null);
  assert.equal(metric("cost_per_conversion")?.value, null);
  assert.equal(metric("knowledge_readiness")?.status, "no_data");
});
