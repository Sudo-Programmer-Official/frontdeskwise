import assert from "node:assert/strict";
import test from "node:test";
import { assessExperienceSignals } from "../src/experience-signals.js";

test("language plus workflow behavior produces an actionable high-severity signal", () => {
  const assessment = assessExperienceSignals({
    message: "You keep asking me the same thing. I already told you.",
    previousUserMessages: ["Saturday works", "Saturday works"],
    workflow: { stepId: "schedule", sameStepAttempts: 2, unchangedTurns: 2 },
    result: { actionDeliveryStatus: "failed", validationStatus: "fallback" },
  });

  assert.equal(assessment.runtimeAdaptation.suppressCtas, true);
  assert.equal(assessment.runtimeAdaptation.offerHumanHelp, true);
  assert.equal(assessment.signals.find((signal) => signal.type === "frustration")?.severity, "critical");
  assert.equal(assessment.signals.find((signal) => signal.type === "confusing_workflow")?.likelyLayer, "workflow");
});

test("a mild abandonment is recorded without exposing contact data", () => {
  const assessment = assessExperienceSignals({
    message: "Never mind, email me at visitor@example.com",
    behavior: { abandonedAfterError: true },
  });

  assert.equal(assessment.signals.some((signal) => signal.type === "abandonment"), true);
  assert.equal(assessment.signals[0]?.messageExcerptRedacted.includes("visitor@example.com"), false);
  assert.equal(assessment.signals[0]?.messageExcerptRedacted.includes("[email]"), true);
});

test("normal grounded turns do not create experience signals", () => {
  const assessment = assessExperienceSignals({
    message: "What are your hours?",
    result: { grounded: true, validationStatus: "accepted", providerStatus: "succeeded" },
  });

  assert.deepEqual(assessment.signals, []);
  assert.equal(assessment.runtimeAdaptation.acknowledge, false);
});

test("a single non-threatening abusive turn uses a calm recovery boundary", () => {
  const assessment = assessExperienceSignals({
    message: "Fuck off, this is useless.",
  });

  assert.equal(assessment.abusive, true);
  assert.equal(assessment.repeatedAbuse, false);
  assert.equal(assessment.likelyCause, "abusive_language");
  assert.equal(assessment.runtimeAdaptation.strategy, "calm_boundary");
  assert.equal(assessment.runtimeAdaptation.suppressCtas, true);
  assert.equal(assessment.runtimeAdaptation.offerHumanHelp, true);
  assert.equal(assessment.signals.find((signal) => signal.type === "frustration")?.reason, "non_threatening_abuse");
});

test("repeated abuse without service intent politely limits the interaction", () => {
  const assessment = assessExperienceSignals({
    message: "Shut up.",
    previousUserMessages: ["Fuck off."],
  });

  assert.equal(assessment.repeatedAbuse, true);
  assert.equal(assessment.runtimeAdaptation.strategy, "politely_end");
  assert.equal(assessment.runtimeAdaptation.suppressCtas, true);
});

test("medium friction acknowledges the problem while preserving the existing answer path", () => {
  const assessment = assessExperienceSignals({
    message: "Never mind.",
  });

  assert.equal(assessment.likelyCause, "general_frustration");
  assert.equal(assessment.runtimeAdaptation.strategy, "acknowledge_and_recover");
  assert.equal(assessment.runtimeAdaptation.preserveContext, true);
  assert.equal(assessment.runtimeAdaptation.suppressCtas, true);
});
