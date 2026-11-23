import type { RetrievalIntent } from "./retrieval.js";

export type KnowledgeGapReason =
  | "no_authoritative_source"
  | "low_confidence_evidence"
  | "answer_generation_failed"
  | "grounding_check_failed";

export function knowledgeGapMessage(businessName: string, intent: RetrievalIntent): string {
  const topics: Partial<Record<RetrievalIntent, string>> = {
    permissions: "permissions",
    privacy: "privacy and data handling",
    policy: "policies",
    pricing: "pricing",
    support: "support options",
  };
  const topic = topics[intent];
  const subject = topic ? `${businessName}'s ${topic}` : "that question";
  return `I don’t have enough verified information about ${subject} to answer that confidently. I can help you contact the team if you’d like.`;
}

export function knowledgeGapReason(args: {
  answerable: boolean;
  hasMatch: boolean;
  modelGenerationFailed: boolean;
  groundingCheckStatus: "not_run" | "passed" | "rejected" | "failed" | "skipped";
}): KnowledgeGapReason {
  if (!args.answerable || !args.hasMatch) return "no_authoritative_source";
  if (args.groundingCheckStatus === "failed") return "grounding_check_failed";
  if (args.modelGenerationFailed) return "answer_generation_failed";
  return "low_confidence_evidence";
}

export const knowledgeGapContactAction = {
  label: "Contact the team",
  question: "I want to speak to someone about this.",
};
