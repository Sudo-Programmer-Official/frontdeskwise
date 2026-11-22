import assert from "node:assert/strict";
import test from "node:test";
import { ndcgAtK, precisionAtK, recallAtK, reciprocalRank, scoreRanking } from "../src/certification-metrics.js";
import { certificationScoreDeltas, certificationScoreSnapshot } from "../src/certification-deltas.js";

test("ranking metrics score relevant evidence independently", () => {
  const ranked = ["wrong", "relevant-late", "relevant-first", "other"];
  const relevant = ["relevant-first", "relevant-late"];
  assert.equal(recallAtK(ranked, relevant, 3), 1);
  assert.equal(precisionAtK(ranked, relevant, 3), 0.6667);
  assert.equal(reciprocalRank(ranked, relevant), 0.5);
  assert.equal(ndcgAtK(ranked, relevant, 3), 0.6934);
  assert.deepEqual(scoreRanking(ranked, relevant, 3), {
    recallAtK: 1,
    precisionAtK: 0.6667,
    reciprocalRank: 0.5,
    ndcgAtK: 0.6934,
  });
});

test("graded NDCG rewards the most relevant evidence at the top", () => {
  const relevant = { primary: 3, supporting: 1 };
  assert.equal(ndcgAtK(["primary", "supporting"], relevant, 2), 1);
  assert.ok(ndcgAtK(["supporting", "primary"], relevant, 2) < 1);
});

test("certification score snapshots expose deltas beyond pass or fail", () => {
  const current = certificationScoreSnapshot({
    layers: {
      retrieval: { metrics: { recallAtK: 1, precisionAtK: 0.8, reciprocalRank: 1, ndcgAtK: 0.86 }, forbiddenEvidenceRate: 0 },
      routing: { summary: { routeAccuracy: 0.98, actionAccuracy: 0.97, argumentAccuracy: 0.96, incorrectActionRate: 0.02, unnecessaryActionRate: 0.01 } },
      workflow: { businesses: [{ pass: true, processPassRate: 1, outcomePassRate: 1 }] },
    },
  });
  const baseline = certificationScoreSnapshot({
    layers: {
      retrieval: { metrics: { recallAtK: 1, precisionAtK: 0.8, reciprocalRank: 1, ndcgAtK: 0.91 }, forbiddenEvidenceRate: 0 },
      routing: { summary: { routeAccuracy: 0.98, actionAccuracy: 0.97, argumentAccuracy: 0.96, incorrectActionRate: 0.02, unnecessaryActionRate: 0.01 } },
      workflow: { businesses: [{ pass: true, processPassRate: 1, outcomePassRate: 1 }] },
    },
  });
  assert.equal(current["retrieval.ndcgAtK"], 0.86);
  assert.equal(certificationScoreDeltas(current, baseline)["retrieval.ndcgAtK"], -0.05);
});
