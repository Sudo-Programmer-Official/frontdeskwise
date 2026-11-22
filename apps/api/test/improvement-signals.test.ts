import assert from "node:assert/strict";
import test from "node:test";
import { deriveImprovementSignals, normalizeImprovementQuestion } from "../src/improvement-signals.js";

test("improvement signals retain tenant-scoped question shape without contact data", () => {
  const signals = deriveImprovementSignals({
    question: "Actually, call me at 727-555-0199 about parent@example.com",
    grounded: false,
    retrievalMode: "degraded_full_text",
    handoff: true,
  });
  assert.deepEqual(signals.map((signal) => signal.type), ["low_confidence_answer", "human_handoff", "visitor_correction"]);
  assert.equal(signals[0].normalizedQuestion, "actually, call me at [phone] about [email]");
});

test("improvement signal derivation stays quiet for a grounded normal turn", () => {
  assert.deepEqual(deriveImprovementSignals({ question: "What are your hours?", grounded: true, retrievalMode: "hybrid_rrf" }), []);
  assert.equal(normalizeImprovementQuestion("  What   are your hours?  "), "what are your hours?");
});
