import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeBusinessFact,
  resolveBusinessFacts,
  type BusinessFact,
} from "../src/business-knowledge.js";

const now = "2026-11-21T15:00:00.000Z";

function fact(input: Partial<BusinessFact> & Pick<BusinessFact, "sourceType" | "valueText">): BusinessFact {
  return normalizeBusinessFact({
    id: input.id ?? `${input.sourceType}-${input.valueText}`,
    businessId: "business-1",
    kind: input.kind ?? "pricing",
    subject: input.subject ?? "Turtle 2",
    predicate: input.predicate ?? "price",
    value: input.valueText,
    valueText: input.valueText,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? null,
    observedAt: input.observedAt ?? now,
    confidence: input.confidence ?? 1,
  });
}

test("owner facts outrank website evidence and expose the conflict", () => {
  const result = resolveBusinessFacts([
    fact({ sourceType: "website", valueText: "$120", sourceId: "website-price" }),
    fact({ sourceType: "owner_structured", valueText: "$145", sourceId: "owner-price" }),
  ], { kind: "pricing", terms: ["what", "price", "turtle"], now });

  assert.equal(result.status, "conflict");
  assert.equal(result.matches[0]?.fact.valueText, "$145");
  assert.equal(result.conflicts[0]?.winner.valueText, "$145");
  assert.deepEqual(result.conflicts[0]?.alternatives.map((item) => item.valueText), ["$120"]);
});

test("a fresh system-of-record fact outranks an owner override", () => {
  const result = resolveBusinessFacts([
    fact({ sourceType: "owner_structured", valueText: "$145", sourceId: "owner-price" }),
    fact({ sourceType: "live_system", valueText: "$155", sourceId: "jackrabbit", observedAt: "2026-11-21T14:55:00.000Z" }),
  ], { kind: "pricing", terms: ["price", "turtle"], now });

  assert.equal(result.matches[0]?.fact.valueText, "$155");
  assert.equal(result.matches[0]?.fact.sourceType, "live_system");
});

test("stale realtime facts are not answerable", () => {
  const result = resolveBusinessFacts([
    fact({ sourceType: "live_system", valueText: "3 spots", kind: "availability", predicate: "openings", observedAt: "2026-11-21T12:00:00.000Z" }),
  ], { kind: "availability", terms: ["turtle", "spots"], now });

  assert.equal(result.status, "not_found");
  assert.equal(result.matches.length, 0);
});

test("manual facts normalize to a durable freshness policy", () => {
  const normalized = normalizeBusinessFact({
    businessId: "business-1",
    kind: "hours",
    subject: "Saturday",
    predicate: "open_hours",
    value: { open: "9:00 AM", close: "5:00 PM" },
    sourceType: "owner_structured",
  }, now);

  assert.equal(normalized.valueText, "open: 9:00 AM, close: 5:00 PM");
  assert.equal(normalized.freshnessPolicy, "until_replaced");
  assert.equal(normalized.observedAt, now);
});
