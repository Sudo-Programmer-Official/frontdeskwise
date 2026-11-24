export type HandoffStatus = "AI_ACTIVE" | "HANDOFF_REQUESTED" | "CONTACT_REQUIRED" | "WAITING_FOR_STAFF" | "FOLLOW_UP_PENDING" | "HUMAN_ACTIVE" | "AI_ASSISTED" | "RESOLVED" | "EXPIRED";

const humanRecipient = "(?:someone|somebody|a person|a human|human|real person|live person|human agent|live agent|representative|agent|staff(?: member)?|team(?: member)?|support(?: team)?|customer support|help desk)";
const humanConversationVerb = "(?:talk|speak|chat|connect|reach|contact|transfer|escalate|hand off|put me in touch)";

function normalizeHumanRequest(value: string): string {
  return value
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Detects an explicit request for a human using composable intent signals:
 * an action that names a human recipient, a request for human help, or a
 * request for a person to call/contact the visitor. This stays broad enough
 * for natural language without treating every "someone" question as a
 * handoff (for example, "Can someone explain your privacy policy?").
 */
export function isExplicitHumanRequest(question: string): boolean {
  const value = normalizeHumanRequest(question);
  if (!value) return false;

  const asksToTalkToHuman = new RegExp(`\\b${humanConversationVerb}\\b[\\w ]{0,56}\\b${humanRecipient}\\b`, "i").test(value);
  const asksForHumanHelp = new RegExp(`\\b(?:need|want|would like|looking for|help me get|find|get)\\b[\\w ]{0,56}\\b${humanRecipient}\\b`, "i").test(value);
  const asksHumanForHelp = new RegExp(`\\b(?:can|could|would|will|may)\\b[\\w ]{0,24}\\b(?:a human|a person|a real person|a live person|an agent|a representative)\\b[\\w ]{0,16}\\b(?:help|assist)\\b`, "i").test(value);
  const asksHumanToContactVisitor = new RegExp(`\\b(?:can|could|would|will|may|have)\\b[\\w ]{0,32}\\b${humanRecipient}\\b[\\w ]{0,16}\\b(?:call|contact|reach)\\b[\\w ]{0,12}\\bme\\b`, "i").test(value)
    || new RegExp(`\\b${humanRecipient}\\b[\\w ]{0,12}\\b(?:call|contact|reach)\\b[\\w ]{0,12}\\bme\\b`, "i").test(value);
  const directHumanRequest = new RegExp(`\\b(?:human please|real person|human agent|get me a person|put me through|transfer me)\\b`, "i").test(value);

  return asksToTalkToHuman || asksForHumanHelp || asksHumanForHelp || asksHumanToContactVisitor || directHumanRequest;
}

export function canTakeOver(status: HandoffStatus): boolean {
  return status === "AI_ACTIVE" || status === "HANDOFF_REQUESTED" || status === "CONTACT_REQUIRED" || status === "WAITING_FOR_STAFF" || status === "FOLLOW_UP_PENDING" || status === "AI_ASSISTED";
}

export function canReturnToAi(status: HandoffStatus): boolean {
  return status === "HUMAN_ACTIVE" || status === "AI_ASSISTED";
}

export function canResolve(status: HandoffStatus): boolean {
  return status !== "RESOLVED" && status !== "EXPIRED";
}
