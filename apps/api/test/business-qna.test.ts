import assert from "node:assert/strict";
import test from "node:test";
import { findCompatibleQna, qnaIsRuntimeUsable, qnaMatchScore, qnaStatusAfterFactRefresh, type BusinessQna } from "../src/business-qna.js";
import { normalizeBusinessFact } from "../src/business-knowledge.js";

const qna: BusinessQna = {
  id: "qna-1",
  organizationId: "org-1",
  businessId: "business-1",
  canonicalQuestion: "How much does SalonFlow cost?",
  canonicalAnswer: "Core is $65/mo and Growth is $99/mo.",
  variants: ["What is the price?", "How much is SalonFlow?"],
  status: "VERIFIED",
  sourceType: "OWNER_CONFIRMED",
  sourceReferences: [],
  answerGapId: null,
  createdBy: null,
  updatedBy: null,
  createdAt: "2026-11-20T12:00:00.000Z",
  updatedAt: "2026-11-20T12:00:00.000Z",
  lastReviewedAt: "2026-11-20T12:00:00.000Z",
  validUntil: null,
  timesUsed: 0,
  lastUsedAt: null,
};

test("Q&A variants match the same canonical answer", () => {
  assert.equal(qnaMatchScore("What is the price?", qna), 1);
  assert.equal(findCompatibleQna("How much is SalonFlow?", [qna])?.qna.id, "qna-1");
});

test("archived and stale Q&A are not runtime usable", () => {
  assert.equal(qnaIsRuntimeUsable(qna), true);
  assert.equal(qnaIsRuntimeUsable({ ...qna, status: "ARCHIVED" }), false);
  assert.equal(qnaIsRuntimeUsable({ ...qna, validUntil: "2026-11-01T00:00:00.000Z" }, new Date("2026-11-23T00:00:00.000Z")), false);
});

test("newer website pricing conflicts with owner Q&A", () => {
  const websiteFact = normalizeBusinessFact({
    id: "fact-1",
    businessId: "business-1",
    kind: "pricing",
    subject: "SalonFlow Growth",
    predicate: "price",
    value: "$129/mo",
    valueText: "$129/mo",
    sourceType: "website",
    updatedAt: "2026-11-22T12:00:00.000Z",
  });
  assert.equal(qnaStatusAfterFactRefresh(qna, [websiteFact]), "CONFLICTED");
});
