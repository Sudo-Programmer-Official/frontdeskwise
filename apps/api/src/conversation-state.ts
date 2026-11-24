/**
 * Deterministic answers for questions about the current visitor/session.
 * These questions must not go through business-knowledge retrieval.
 */

export type ConversationStateQuestion = "details" | "email" | "phone" | "waiting" | "selected_class";

export type ConversationStateSnapshot = {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  handoffState?: string | null;
  collectedFields?: Record<string, unknown>;
  selectedClass?: string | null;
};

export type ConversationStateAnswer = {
  kind: ConversationStateQuestion;
  answer: string;
};

export type ConversationAcknowledgementContext = {
  requestSaved?: boolean;
  waitingForStaff?: boolean;
  workflowPrompt?: string | null;
};

function normalized(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function present(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function isAcknowledgement(question: string): boolean {
  const value = normalized(question).replace(/[.!?]+$/, "");
  return /^(?:okay|ok|sounds good|great|perfect|awesome|got it|thanks?|thank you(?: so much)?|cool|works for me|that works)$/i.test(value);
}

export function answerConversationAcknowledgement(
  question: string,
  context: ConversationAcknowledgementContext = {},
): string | null {
  if (!isAcknowledgement(question)) return null;
  const workflowPrompt = context.workflowPrompt?.trim();
  if (workflowPrompt) {
    return `Got it — ${workflowPrompt.charAt(0).toLowerCase()}${workflowPrompt.slice(1)}`;
  }
  if (context.requestSaved && context.waitingForStaff) {
    return "Perfect — the team has your request. I’m still here if you need anything else.";
  }
  if (context.requestSaved) return "Perfect — your request is saved. Let me know if you need anything else.";
  if (context.waitingForStaff) return "Thanks — I’m still here while we wait for the team.";
  return "Sounds good — let me know if you need anything else.";
}

export function classifyConversationStateQuestion(question: string): ConversationStateQuestion | null {
  const value = normalized(question);
  if (!value) return null;
  if (/\b(?:which|what)\s+(?:class|lesson|program|course|session)\b/.test(value)
    || /\b(?:class|lesson|program|course|session)\b[\s\S]{0,24}\b(?:choose|chose|selected|picked)\b/.test(value)) return "selected_class";
  if (/\b(?:am i|are we)\s+waiting\b|\bwaiting for (?:someone|a person|the team|staff)\b|\b(?:has|did)\s+(?:the )?team\s+(?:replied|responded|seen)\b/.test(value)) return "waiting";
  if (/\b(?:did you|do you|have you)\s+(?:save|saved|keep|kept|record|recorded|remember|remembered|have)\b[\s\S]{0,36}\bmy\s+email\b|\bmy\s+email\b[\s\S]{0,24}\b(?:saved|stored|have|remember)\b/.test(value)) return "email";
  if (/\b(?:did you|do you|have you)\s+(?:save|saved|keep|kept|record|recorded|remember|remembered|have)\b[\s\S]{0,36}\bmy\s+(?:phone|number)\b|\bmy\s+(?:phone|number)\b[\s\S]{0,24}\b(?:saved|stored|have|remember)\b/.test(value)) return "phone";
  if (/\b(?:do you|have you)\s+(?:have|keep|know|remember|saved|save|record|recorded)\b[\s\S]{0,40}\bmy\s+(?:details|contact|information|info)\b/.test(value)
    || /\b(?:what details|what information|what info)\s+(?:do you have|did i give|have i given)\b/.test(value)
    || /\bwhat did i tell you earlier\b/.test(value)) return "details";
  return null;
}

export function answerConversationStateQuestion(
  question: string,
  state: ConversationStateSnapshot,
): ConversationStateAnswer | null {
  const kind = classifyConversationStateQuestion(question);
  if (!kind) return null;
  const email = present(state.email) ?? present(state.collectedFields?.email);
  const phone = present(state.phone) ?? present(state.collectedFields?.phone) ?? present(state.collectedFields?.phone_number);
  const name = present(state.name) ?? present(state.collectedFields?.name) ?? present(state.collectedFields?.full_name) ?? present(state.collectedFields?.parent_name);
  const handoffState = state.handoffState ?? "AI_ACTIVE";
  const waiting = ["HANDOFF_REQUESTED", "CONTACT_REQUIRED", "WAITING_FOR_STAFF", "FOLLOW_UP_PENDING"].includes(handoffState);
  const humanActive = ["HUMAN_ACTIVE", "AI_ASSISTED"].includes(handoffState);

  if (kind === "email") return { kind, answer: email ? "Yes — I have your email saved." : "I don’t have your email saved yet." };
  if (kind === "phone") return { kind, answer: phone ? "Yes — I have your phone number saved." : "I don’t have your phone number saved yet." };
  if (kind === "waiting") {
    if (humanActive) return { kind, answer: "Yes — a team member is handling this conversation." };
    if (waiting) return { kind, answer: "Yes — your message has been saved for the team. A team member will reply here shortly." };
    return { kind, answer: "You’re not currently waiting for a team member. I’m here to help." };
  }
  if (kind === "selected_class") {
    const selected = present(state.selectedClass);
    return { kind, answer: selected ? `You selected ${selected}.` : "I don’t have a class selection saved yet." };
  }

  const channels = [email ? "email" : null, phone ? "phone number" : null].filter((value): value is string => Boolean(value));
  if (!channels.length) {
    return {
      kind,
      answer: waiting
        ? "I don’t have your contact details yet. While we wait for the team, what’s the best email or phone number to reach you if you step away?"
        : "I don’t have your contact details yet. What’s the best email or phone number to reach you?",
    };
  }
  if (channels.length === 1) {
    const missing = email ? "phone number" : "email";
    return { kind, answer: `I have your ${channels[0]}${name ? ` and your name` : ""}, but I’m still missing your ${missing}.` };
  }
  return { kind, answer: `Yes — I have your email and phone number${name ? " and your name" : ""} saved.` };
}

