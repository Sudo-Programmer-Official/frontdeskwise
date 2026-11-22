export type ImprovementSignalType =
  | "low_confidence_answer"
  | "human_handoff"
  | "visitor_correction"
  | "provider_failure"
  | "workflow_loop";

export type ImprovementSignalInput = {
  question: string;
  grounded?: boolean;
  retrievalMode?: string | null;
  handoff?: boolean;
  providerFailure?: boolean;
  workflowLoop?: boolean;
};

export type ImprovementSignal = {
  type: ImprovementSignalType;
  normalizedQuestion: string;
  reason: string;
};

/** Keep evaluation data useful without copying obvious visitor contact data. */
export function normalizeImprovementQuestion(value: string): string {
  return value
    .replace(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/g, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{6,}\d)/g, "[phone]")
    .replace(/\b\d{5}(?:-\d{4})?\b/g, "[postal_code]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500)
    .toLowerCase();
}

export function deriveImprovementSignals(input: ImprovementSignalInput): ImprovementSignal[] {
  const normalizedQuestion = normalizeImprovementQuestion(input.question);
  const signals: ImprovementSignal[] = [];
  const add = (type: ImprovementSignalType, reason: string): void => {
    signals.push({ type, reason, normalizedQuestion });
  };
  if (input.grounded === false && !["tier0_greeting", "approved_answer", "handoff"].includes(input.retrievalMode ?? "")) add("low_confidence_answer", "answer_not_grounded_or_fell_back");
  if (input.handoff) add("human_handoff", "conversation_entered_handoff");
  if (/\b(actually|no,|not what i meant|that is not|that's not|i meant|correction)\b/i.test(input.question)) add("visitor_correction", "visitor_corrected_or_rephrased_request");
  if (input.providerFailure) add("provider_failure", "provider_or_connector_failed");
  if (input.workflowLoop) add("workflow_loop", "loop_guard_triggered");
  return signals;
}
