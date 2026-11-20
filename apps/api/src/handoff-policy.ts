export type HandoffStatus = "AI_ACTIVE" | "HANDOFF_REQUESTED" | "WAITING_FOR_STAFF" | "HUMAN_ACTIVE" | "AI_ASSISTED" | "RESOLVED";

export function isExplicitHumanRequest(question: string): boolean {
  return /\b(talk|speak|connect|chat|reach)\b.{0,24}\b(person|human|staff|team|representative|agent)\b|\b(human|staff|team member|representative|real person)\b/i.test(question)
    || /\b(someone|a person)\s+(call|contact|help|reach)\s+me\b/i.test(question);
}

export function canTakeOver(status: HandoffStatus): boolean {
  return status === "AI_ACTIVE" || status === "HANDOFF_REQUESTED" || status === "WAITING_FOR_STAFF" || status === "AI_ASSISTED";
}

export function canReturnToAi(status: HandoffStatus): boolean {
  return status === "HUMAN_ACTIVE" || status === "AI_ASSISTED";
}

export function canResolve(status: HandoffStatus): boolean {
  return status !== "RESOLVED";
}
