import type { ActionConnectorSettings } from "./action-connectors.js";

export type ActionFieldType = "text" | "email" | "phone" | "select" | "date" | "number";
export type ActionCaptureMode = "auto" | "conversational" | "form" | "hybrid";
export type ResolvedActionCaptureMode = Exclude<ActionCaptureMode, "auto">;

/**
 * Version 2 actions are intentionally made from business-neutral primitives.
 * A swim-school enrollment, salon booking, or HVAC estimate can use the same
 * runtime without teaching the engine industry-specific concepts.
 */
export type ActionStepType =
  | "ask"
  | "capture"
  | "form"
  | "condition"
  | "decision"
  | "lookup"
  | "recommend"
  | "select"
  | "confirm"
  | "api_action"
  | "create_lead"
  | "book"
  | "generate_link"
  | "redirect"
  | "notify"
  | "handoff"
  | "complete";

export type ActionStepBranch = {
  when: ActionFieldCondition;
  nextStepId: string;
};

export type ActionStep = {
  id: string;
  type: ActionStepType;
  label?: string;
  fieldKey?: string;
  question?: string;
  required?: boolean;
  options?: string[];
  condition?: ActionFieldCondition;
  nextStepId?: string;
  branches?: ActionStepBranch[];
  /** JSON configuration for provider lookup, recommendation, or API steps. */
  config?: Record<string, unknown>;
};

export type CompletionMode =
  | "external_provider"
  | "native_form"
  | "booking_connector"
  | "payment_link"
  | "api_webhook"
  | "human_follow_up";

export type CompletionLinkTemplate = {
  baseUrl: string;
  /** Maps a FrontDeskWise value path to a provider query parameter. */
  fieldMappings: Record<string, string>;
  staticParams?: Record<string, string>;
};

export type ActionFieldCondition = {
  field: string;
  equals?: string;
  notEquals?: string;
};

export type ActionField = {
  id: string;
  key: string;
  label: string;
  type: ActionFieldType;
  required: boolean;
  visibility?: "visible" | "hidden";
  question: string;
  options?: string[];
  condition?: ActionFieldCondition;
};

export type ActionCompletion = {
  createLead: boolean;
  leadStatus: "new" | "qualified" | "booked";
  message: string;
  completionMode?: CompletionMode;
  linkTemplate?: CompletionLinkTemplate;
  submitLabel?: string;
  linkUrl?: string;
  linkLabel?: string;
  notifyStaff: boolean;
  requiresStaff?: boolean;
  notifyChannels?: Array<"in_app" | "email">;
  notifyTargets?: Array<"owner" | "business_team" | "assigned_staff">;
  connector?: ActionConnectorSettings;
};

export type ActionFlow = {
  id: string;
  key: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  triggerIntents: string[];
  captureMode: ActionCaptureMode;
  fields: ActionField[];
  /** Present for versioned workflow actions; absent means legacy field flow. */
  steps?: ActionStep[];
  completion: ActionCompletion;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ConversationActionState = {
  actionId: string;
  values: Record<string, string>;
  /** Current V2 workflow cursor. Legacy flows continue to use field order. */
  currentStepId?: string;
  completedStepIds?: string[];
  lookupResults?: Record<string, unknown>;
  completionUrl?: string;
  participants?: ActionParticipant[];
  activeParticipantId?: string;
  interruptionStack?: ActionInterruption[];
  skipped?: string[];
  captureMode: ResolvedActionCaptureMode;
  conversationalKeys: string[];
  formShown?: boolean;
  status: "active" | "completed";
  startedAt: string;
  completedAt?: string;
};

export type ActionParticipant = {
  id: string;
  entityType: string;
  label?: string;
  values: Record<string, string>;
  status: "active" | "completed";
  createdAt: string;
};

export type ActionInterruption = {
  intent: string;
  question: string;
  returnStepId: string | null;
  startedAt: string;
};

type ActionTemplate = Omit<ActionFlow, "id" | "createdAt" | "updatedAt">;

const field = (
  key: string,
  label: string,
  type: ActionFieldType,
  question: string,
  required = true,
  options?: string[],
  condition?: ActionFieldCondition,
): ActionField => ({ id: key, key, label, type, required, visibility: "visible", question, ...(options ? { options } : {}), ...(condition ? { condition } : {}) });

const completion = (message: string, leadStatus: ActionCompletion["leadStatus"] = "new", linkLabel?: string): ActionCompletion => ({
  createLead: true,
  leadStatus,
  message,
  ...(linkLabel ? { submitLabel: linkLabel } : {}),
  ...(linkLabel ? { linkLabel } : {}),
  notifyStaff: true,
  notifyChannels: ["in_app", "email"],
  notifyTargets: ["business_team"],
});

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    key: "capture_lead",
    name: "Capture a lead",
    description: "Collect a visitor’s contact details and send the request to the team.",
    triggerPhrases: ["contact me", "have someone reach out", "talk to someone", "get in touch"],
    triggerIntents: ["contact", "lead"],
    captureMode: "auto",
    fields: [
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should the team use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — I’ve sent your request to the team."),
    enabled: true,
  },
  {
    key: "book_appointment",
    name: "Book an appointment",
    description: "Collect the details needed to request an appointment or booking.",
    triggerPhrases: ["book an appointment", "make an appointment", "book a service", "schedule a visit"],
    triggerIntents: ["booking", "appointment"],
    captureMode: "hybrid",
    fields: [
      field("service", "Service", "text", "What service would you like to book?"),
      field("preferred_date", "Preferred date", "date", "What date works best?"),
      field("preferred_time", "Preferred time", "text", "What time works best?"),
      field("staff_preference", "Staff preference", "text", "Do you have a staff preference?", false),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — your appointment request is ready for the team to confirm.", "qualified"),
    enabled: true,
  },
  {
    key: "request_quote",
    name: "Request a quote",
    description: "Understand the project or issue, then collect contact details for a quote.",
    triggerPhrases: ["get a quote", "request a quote", "how much would it cost", "need an estimate"],
    triggerIntents: ["pricing", "quote", "lead"],
    captureMode: "hybrid",
    fields: [
      field("project", "Project or issue", "text", "What would you like a quote for?"),
      field("urgency", "Urgency", "select", "How urgent is this?", false, ["Today", "This week", "This month", "Just exploring"]),
      field("postal_code", "ZIP or postal code", "text", "What ZIP or postal code should we use?", false),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — I’ve sent the quote request to the team.", "qualified"),
    enabled: true,
  },
  {
    key: "enroll_child",
    name: "Register or enroll",
    description: "Progressively collect the minimum information needed to register a child or student.",
    triggerPhrases: ["sign me up", "enroll", "register my child", "register my student", "start enrollment"],
    triggerIntents: ["enrollment", "registration", "lead"],
    captureMode: "hybrid",
    fields: [
      field("customer_type", "Customer type", "select", "Is this for a new student or someone already enrolled?", true, ["New student", "Current student"]),
      field("child_age", "Child’s age", "number", "How old is the student?"),
      field("location", "Preferred location", "text", "Which location would you prefer?"),
      field("program", "Program", "text", "Which program are you interested in?", false),
      field("parent_name", "Parent or guardian name", "text", "What’s the parent or guardian name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    steps: [
      { id: "customer-type", type: "capture", fieldKey: "customer_type", config: { repeatableEntity: true, entityType: "student", entityLabel: "child", participantFieldKeys: ["customer_type", "child_age"], maxParticipants: 8 } },
      { id: "student-age", type: "capture", fieldKey: "child_age" },
      { id: "enrollment-details", type: "form", config: { fieldKeys: ["location", "program", "parent_name", "email", "phone"] } },
      { id: "enrollment-confirm", type: "confirm", question: "I have the details I need. Shall I prepare the registration link?" },
      { id: "registration-link", type: "generate_link", config: { completion: "external_provider" } },
      { id: "enrollment-complete", type: "complete" },
    ],
    completion: completion("Thanks — your registration request is ready for the team.", "qualified", "Continue registration"),
    enabled: true,
  },
  {
    key: "schedule_consultation",
    name: "Schedule a consultation",
    description: "Collect service and timing preferences before handing the consultation request to staff.",
    triggerPhrases: ["schedule a consultation", "book a consultation", "talk to a specialist", "consult with someone"],
    triggerIntents: ["consultation", "booking", "lead"],
    captureMode: "hybrid",
    fields: [
      field("service_type", "Service type", "text", "What would you like to discuss?"),
      field("preferred_time", "Preferred time", "text", "When would you prefer to speak?"),
      field("insurance", "Insurance", "text", "Do you have an insurance provider you’d like us to note?", false),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — your consultation request is ready for the team.", "qualified"),
    enabled: true,
  },
  {
    key: "book_tour",
    name: "Book a tour",
    description: "Collect child and start-date details before sending a tour request to the team.",
    triggerPhrases: ["book a tour", "schedule a tour", "visit the daycare", "visit the school"],
    triggerIntents: ["tour", "booking", "lead"],
    captureMode: "hybrid",
    fields: [
      field("child_age", "Child’s age", "number", "How old is your child?"),
      field("desired_start_date", "Desired start date", "date", "When would you like care to start?"),
      field("location", "Location", "text", "Which location are you interested in?"),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — your tour request is ready for the team.", "qualified"),
    enabled: true,
  },
];

function cloneTemplate(template: ActionTemplate, id: string, now: string): ActionFlow {
  return JSON.parse(JSON.stringify({ ...template, id, createdAt: now, updatedAt: now })) as ActionFlow;
}

export function actionTemplate(key: string): ActionTemplate | null {
  return ACTION_TEMPLATES.find((template) => template.key === key) ?? null;
}

export function defaultActionFlows(name: string, websiteContent: string, idFactory: (key: string) => string): ActionFlow[] {
  const value = (name + " " + websiteContent).toLowerCase();
  const keys = new Set<string>(["capture_lead"]);
  if (/daycare|childcare|preschool|nursery|tour/.test(value)) keys.add("book_tour");
  else if (/swim|lesson|student|school|class/.test(value)) keys.add("enroll_child");
  else if (/salon|stylist|barber|spa|appointment/.test(value)) keys.add("book_appointment");
  else if (/hvac|air condition|heating|cooling|plumb|roof|repair/.test(value)) keys.add("request_quote");
  else if (/dental|dentist|clinic|medical|health/.test(value)) keys.add("schedule_consultation");
  else {
    keys.add("book_appointment");
    keys.add("request_quote");
  }
  const now = new Date().toISOString();
  return [...keys].map((key) => {
    const template = actionTemplate(key);
    return template ? cloneTemplate(template, idFactory(key), now) : null;
  }).filter((item): item is ActionFlow => Boolean(item));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export function inferActionIntent(question: string): string {
  const value = normalize(question);
  if (/sign me up|enroll|register|registration|new student|current student/.test(value)) return "enrollment";
  if (/book|appointment|schedule|reserve/.test(value)) return "booking";
  if (/quote|estimate|how much|cost|pricing/.test(value)) return "quote";
  if (/consult|specialist/.test(value)) return "consultation";
  if (/tour|visit the (daycare|school)/.test(value)) return "tour";
  if (/contact|reach|talk to someone|call me/.test(value)) return "lead";
  return "general";
}

export function detectAction(actions: ActionFlow[], question: string): ActionFlow | null {
  const value = normalize(question);
  const intent = inferActionIntent(question);
  return actions
    .filter((action) => action.enabled)
    .map((action) => ({
      action,
      phraseScore: action.triggerPhrases.reduce((score, phrase) => value.includes(normalize(phrase)) ? score + normalize(phrase).length + 10 : score, 0),
      intentScore: action.triggerIntents.some((item) => normalize(item) === intent) ? 4 : 0,
    }))
    .filter((item) => item.phraseScore > 0 || item.intentScore > 0)
    .sort((left, right) => right.phraseScore + right.intentScore - left.phraseScore - left.intentScore)[0]?.action ?? null;
}

export function isContactField(field: ActionField): boolean {
  return /^(name|full_name|parent_name|email|phone|mobile|contact|contact_name)$/i.test(field.key)
    || /\b(email|phone|name)\b/i.test(field.label);
}

export function resolveCaptureMode(action: ActionFlow): ResolvedActionCaptureMode {
  if (action.captureMode !== "auto") return action.captureMode;
  const visible = action.fields.filter((field) => field.visibility !== "hidden");
  const contextual = visible.filter((field) => !isContactField(field));
  if (visible.length <= 4 && contextual.length === 0) return "form";
  if (contextual.length <= 4 && visible.some(isContactField)) return "hybrid";
  return "conversational";
}

export function fieldIsVisible(field: ActionField, values: Record<string, string>): boolean {
  if (field.visibility === "hidden") return false;
  if (!field.condition) return true;
  const current = values[field.condition.field]?.trim().toLowerCase();
  if (field.condition.equals) return current === field.condition.equals.trim().toLowerCase();
  if (field.condition.notEquals) return current !== field.condition.notEquals.trim().toLowerCase();
  return true;
}

export function nextActionField(action: ActionFlow, state: ConversationActionState): ActionField | null {
  const skipped = new Set(state.skipped ?? []);
  return action.fields.find((field) => field.required && fieldIsVisible(field, state.values) && !skipped.has(field.key) && !state.values[field.key]?.trim())
    ?? action.fields.find((field) => fieldIsVisible(field, state.values) && !skipped.has(field.key) && !state.values[field.key]?.trim())
    ?? null;
}

export function nextConversationalField(action: ActionFlow, state: ConversationActionState): ActionField | null {
  const keys = new Set(state.conversationalKeys);
  const skipped = new Set(state.skipped ?? []);
  return action.fields.find((field) => keys.has(field.key) && field.required && fieldIsVisible(field, state.values) && !skipped.has(field.key) && !state.values[field.key]?.trim())
    ?? action.fields.find((field) => keys.has(field.key) && fieldIsVisible(field, state.values) && !skipped.has(field.key) && !state.values[field.key]?.trim())
    ?? null;
}

export function formFields(action: ActionFlow, state: ConversationActionState): ActionField[] {
  const skipped = new Set(state.skipped ?? []);
  return action.fields.filter((field) => fieldIsVisible(field, state.values) && !skipped.has(field.key) && !state.values[field.key]?.trim());
}

export function validateFieldValue(field: ActionField, rawValue: string): { value: string | null; error?: string } {
  const value = rawValue.trim().replace(/\s+/g, " ");
  if (!value) return { value: null, error: "I still need your " + field.label.toLowerCase() + "." };
  if (field.type === "email" && !/^\S+@\S+\.\S+$/.test(value)) return { value: null, error: "Please share a valid email address." };
  if (field.type === "phone" && value.replace(/\D/g, "").length < 7) return { value: null, error: "Please share a phone number with at least 7 digits." };
  if (field.type === "number" && !/^\d+(?:\.\d+)?$/.test(value)) return { value: null, error: "Please share a number for " + field.label.toLowerCase() + "." };
  if (field.type === "date" && Number.isNaN(Date.parse(value))) return { value: null, error: "Please share a date for " + field.label.toLowerCase() + "." };
  if (field.type === "select" && field.options?.length) {
    const choice = field.options.find((option) => normalize(option) === normalize(value) || normalize(option).includes(normalize(value)) || normalize(value).includes(normalize(option)));
    if (!choice) return { value: null, error: "Please choose one of: " + field.options.join(", ") + "." };
    return { value: choice };
  }
  return { value };
}

export function fieldPrompt(field: ActionField): string {
  return field.type === "select" && field.options?.length
    ? field.question + " (" + field.options.join(", ") + ")"
    : field.question;
}

export function createActionState(action: ActionFlow, now = new Date().toISOString()): ConversationActionState {
  const captureMode = resolveCaptureMode(action);
  const conversationalKeys = captureMode === "conversational"
    ? action.fields.map((field) => field.key)
    : captureMode === "hybrid"
      ? action.fields.filter((field) => !isContactField(field) && field.visibility !== "hidden").slice(0, 2).map((field) => field.key)
      : [];
  return {
    actionId: action.id,
    values: {},
    ...(action.steps?.length ? { currentStepId: action.steps[0].id, completedStepIds: [], interruptionStack: [] } : {}),
    captureMode,
    conversationalKeys,
    status: "active",
    startedAt: now,
  };
}
