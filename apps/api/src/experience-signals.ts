import { normalizeImprovementQuestion } from "./improvement-signals.js";

export type ExperienceSignalType =
  | "frustration"
  | "repeated_question"
  | "correction_loop"
  | "wrong_answer"
  | "failed_action"
  | "provider_error"
  | "confusing_workflow"
  | "handoff_request"
  | "abandonment";

export type ExperienceSignalSeverity = "low" | "medium" | "high" | "critical";

export type ExperienceSignalLayer =
  | "crawl"
  | "retrieval"
  | "generation"
  | "routing"
  | "workflow"
  | "provider"
  | "widget"
  | "ux";

export type ExperienceSignalInput = {
  message: string;
  previousUserMessages?: string[];
  workflow?: {
    stepId?: string | null;
    sameStepAttempts?: number;
    unchangedTurns?: number;
    loopGuardTriggered?: boolean;
  };
  behavior?: {
    failedCtaClicks?: number;
    failedActions?: number;
    abandonedAfterError?: boolean;
  };
  result?: {
    grounded?: boolean;
    confidenceBand?: "high" | "medium" | "low" | null;
    retrievalMode?: string | null;
    retrievalReason?: string | null;
    validationStatus?: "accepted" | "fallback" | null;
    providerStatus?: "idle" | "pending" | "succeeded" | "failed" | null;
    actionDeliveryStatus?: "saved" | "queued" | "failed" | null;
    handoff?: boolean;
  };
};

export type ExperienceSignal = {
  type: ExperienceSignalType;
  severity: ExperienceSignalSeverity;
  confidence: number;
  likelyLayer: ExperienceSignalLayer;
  messageExcerptRedacted: string;
  workflowStep: string | null;
  reason: string;
  clusterKey: string;
};

export type ExperienceSignalAssessment = {
  signals: ExperienceSignal[];
  frustrationScore: number;
  runtimeAdaptation: {
    acknowledge: boolean;
    simplify: boolean;
    offerHumanHelp: boolean;
    suppressCtas: boolean;
  };
};

const correctionPattern = /\b(actually|no[,\s]+|not what i meant|that(?:'s| is) (?:wrong|not|incorrect)|i meant|correction|you(?:'re| are) wrong|that's not right)\b/i;
const handoffPattern = /\b(?:can|could|may) i (?:just )?(?:talk|speak) (?:to|with) (?:a|someone|the) (?:person|human|team|staff)|(?:talk|speak) to (?:a|someone|the) (?:person|human|team|staff)|human agent|real person|call me|contact the team\b/i;
const explicitFrustrationPatterns: Array<{ pattern: RegExp; weight: number; mild?: boolean }> = [
  { pattern: /\b(?:this|that) (?:is|was) stupid\b/i, weight: 3 },
  { pattern: /\b(?:this|that) (?:is|was) (?:not )?working\b/i, weight: 3 },
  { pattern: /\b(?:it|this|that) makes no sense\b/i, weight: 3 },
  { pattern: /\b(?:you )?keep asking me the same(?: thing| question)?\b/i, weight: 4 },
  { pattern: /\b(?:i )?already told you\b/i, weight: 4 },
  { pattern: /\b(?:this|that) is useless\b/i, weight: 3 },
  { pattern: /\bwhat(?: the hell| the heck)\b/i, weight: 3 },
  { pattern: /\bnever mind\b/i, weight: 2, mild: true },
  { pattern: /\bforget it\b/i, weight: 2, mild: true },
  { pattern: /\bthis is frustrating\b|\bso frustrating\b/i, weight: 3 },
];

function tokens(value: string): Set<string> {
  return new Set(value.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function similarity(left: string, right: string): number {
  const a = tokens(left);
  const b = tokens(right);
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return overlap / (a.size + b.size - overlap);
}

function repeatedQuestion(message: string, previous: string[]): boolean {
  const normalized = normalizeImprovementQuestion(message);
  if (!normalized) return false;
  return previous.slice(-8).some((candidate) => {
    const other = normalizeImprovementQuestion(candidate);
    return other === normalized || similarity(normalized, other) >= 0.62;
  });
}

function addSignal(
  signals: ExperienceSignal[],
  input: ExperienceSignalInput,
  type: ExperienceSignalType,
  severity: ExperienceSignalSeverity,
  confidence: number,
  likelyLayer: ExperienceSignalLayer,
  reason: string,
): void {
  const workflowStep = input.workflow?.stepId ?? null;
  signals.push({
    type,
    severity,
    confidence: Math.max(0, Math.min(1, Number(confidence.toFixed(2)))),
    likelyLayer,
    messageExcerptRedacted: normalizeImprovementQuestion(input.message).slice(0, 240),
    workflowStep,
    reason,
    clusterKey: `${type}:${likelyLayer}:${workflowStep ?? "general"}`,
  });
}

function severityFor(score: number, input: ExperienceSignalInput): ExperienceSignalSeverity {
  const workflowFailure = Boolean(
    input.workflow?.loopGuardTriggered
      || (input.workflow?.sameStepAttempts ?? 0) >= 2
      || (input.behavior?.failedActions ?? 0) > 0
      || input.result?.actionDeliveryStatus === "failed"
      || input.behavior?.abandonedAfterError,
  );
  if ((score >= 5 && workflowFailure) || input.workflow?.loopGuardTriggered || input.behavior?.abandonedAfterError && (input.behavior.failedActions ?? 0) > 0) return "critical";
  if (score >= 3 || workflowFailure) return "high";
  if (score >= 2) return "medium";
  return "low";
}

export function assessExperienceSignals(input: ExperienceSignalInput): ExperienceSignalAssessment {
  const message = input.message.trim();
  const previous = input.previousUserMessages ?? [];
  const signals: ExperienceSignal[] = [];
  const frustrationMatches = explicitFrustrationPatterns.filter(({ pattern }) => pattern.test(message));
  const explicitFrustrationScore = frustrationMatches.reduce((total, match) => total + match.weight, 0);
  const isRepeated = repeatedQuestion(message, previous);
  const isCorrection = correctionPattern.test(message);
  const requestedHandoff = Boolean(input.result?.handoff) || handoffPattern.test(message);
  const hasWorkflowFailure = Boolean(
    input.workflow?.loopGuardTriggered
      || (input.workflow?.sameStepAttempts ?? 0) >= 2
      || (input.workflow?.unchangedTurns ?? 0) >= 2,
  );
  const failedAction = input.result?.actionDeliveryStatus === "failed"
    || (input.behavior?.failedActions ?? 0) > 0
    || (input.behavior?.failedCtaClicks ?? 0) >= 2;
  const providerError = input.result?.providerStatus === "failed"
    || /provider|connector|timeout|availability lookup/i.test(input.result?.retrievalReason ?? "");
  const wrongAnswer = /\b(?:wrong|incorrect|not right|that answer is|you misunderstood)\b/i.test(message)
    || (isCorrection && input.result?.validationStatus === "fallback");
  const abandoned = input.behavior?.abandonedAfterError === true;

  const frustrationScore = Math.min(10, explicitFrustrationScore
    + (isRepeated ? 2 : 0)
    + (isCorrection ? 1 : 0)
    + (hasWorkflowFailure ? 2 : 0)
    + (failedAction ? 2 : 0)
    + (abandoned ? 2 : 0)
    + (requestedHandoff ? 1 : 0));
  const severity = severityFor(frustrationScore, input);

  if (explicitFrustrationScore > 0 || isRepeated || isCorrection || hasWorkflowFailure || abandoned) {
    const mild = frustrationMatches.length > 0 && frustrationMatches.every((match) => match.mild);
    addSignal(
      signals,
      input,
      "frustration",
      mild && frustrationScore < 3 ? "low" : severity,
      Math.min(0.98, 0.52 + frustrationScore * 0.05),
      hasWorkflowFailure ? "workflow" : "ux",
      explicitFrustrationScore > 0 ? "frustrated_language" : abandoned ? "abandoned_after_friction" : "behavioral_friction",
    );
  }
  if (isRepeated) addSignal(signals, input, "repeated_question", severity === "low" ? "medium" : severity, 0.78, "workflow", "visitor_rephrased_a_recent_question");
  if (isCorrection) addSignal(signals, input, "correction_loop", severity === "low" ? "medium" : severity, 0.76, "generation", "visitor_corrected_or_rephrased_the_assistant");
  if (wrongAnswer) addSignal(signals, input, "wrong_answer", severity === "low" ? "medium" : severity, 0.73, input.result?.validationStatus === "fallback" ? "retrieval" : "generation", "visitor_rejected_or_corrected_the_answer");
  if (failedAction) addSignal(signals, input, "failed_action", severity, 0.9, "provider", "high_value_action_failed_or_was_retried");
  if (providerError) addSignal(signals, input, "provider_error", severity, 0.9, "provider", "provider_or_connector_reported_an_error");
  if (hasWorkflowFailure) addSignal(signals, input, "confusing_workflow", severity, 0.88, "workflow", input.workflow?.loopGuardTriggered ? "workflow_loop_guard_triggered" : "workflow_did_not_advance");
  if (requestedHandoff) addSignal(signals, input, "handoff_request", severity === "low" ? "medium" : severity, 0.96, "routing", "visitor_requested_human_help");
  if (abandoned) addSignal(signals, input, "abandonment", severity, 0.86, "ux", "visitor_abandoned_after_an_error_or_friction");

  const shouldAdapt = frustrationScore >= 2 || requestedHandoff || hasWorkflowFailure || failedAction;
  return {
    signals,
    frustrationScore,
    runtimeAdaptation: {
      acknowledge: shouldAdapt,
      simplify: shouldAdapt,
      offerHumanHelp: frustrationScore >= 3 || requestedHandoff || hasWorkflowFailure || failedAction,
      suppressCtas: frustrationScore >= 3 || hasWorkflowFailure || failedAction,
    },
  };
}

