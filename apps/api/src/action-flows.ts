import type { ActionConnectorSettings } from "./action-connectors.js";
import type { WebsiteActionCandidate, WebsiteActionType } from "./website-actions.js";

export const BUSINESS_ACTION_TYPES = [
  "request_demo",
  "book_appointment",
  "enroll",
  "schedule_service",
  "request_quote",
  "call_business",
  "call_emergency",
  "external_booking",
  "join_waitlist",
  "contact_team",
] as const;

export type BusinessActionType = typeof BUSINESS_ACTION_TYPES[number];
export type ActionMode = "transactional";
export type ActionSafetyPolicy = "standard" | "verified_contact" | "healthcare_emergency" | "manual_review";
export type ActionOrigin = "discovered" | "configured";
export type ActionLifecycleStatus = "discovered" | "needs_review" | "approved" | "active" | "disabled";
export type ActionHandoffBehavior = {
  mode: "none" | "notify_staff" | "require_staff";
  reason?: string;
};
export type ActionReviewReason = "low_confidence" | "unsafe_destination" | "duplicate_action" | "owner_override" | "source_removed" | null;
export type ActionSourceType = "website" | "manual" | "document" | "integration" | "system";

export type ActionEvidence = {
  sourceUrl: string;
  quote: string;
  confidence: number;
};

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
  actionType: BusinessActionType;
  businessId?: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  triggerIntents: string[];
  captureMode: ActionCaptureMode;
  fields: ActionField[];
  /** Present for versioned workflow actions; absent means legacy field flow. */
  steps?: ActionStep[];
  completion: ActionCompletion;
  mode: ActionMode;
  destination: { url: string; label?: string } | null;
  provider: string | null;
  priority: number;
  requiredFields: string[];
  conditions: Array<{ field: string; contains?: string; equals?: string }>;
  safetyPolicy: ActionSafetyPolicy;
  sourceUrl: string | null;
  sourceType?: ActionSourceType | null;
  sourceLabel?: string | null;
  classificationReason?: string | null;
  discoveredAt?: string | null;
  origin?: ActionOrigin;
  lifecycleStatus?: ActionLifecycleStatus;
  reviewReason?: ActionReviewReason;
  evidence: ActionEvidence[];
  confidence: number;
  enabled: boolean;
  optionalFields?: string[];
  handoffBehavior?: ActionHandoffBehavior;
  version?: number;
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
  selectedActionResourceId?: string;
  completionUrl?: string;
  participants?: ActionParticipant[];
  activeParticipantId?: string;
  interruptionStack?: ActionInterruption[];
  skipped?: string[];
  sourcePage?: string | null;
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

type ActionMetadata = Pick<ActionFlow, "actionType" | "businessId" | "mode" | "destination" | "provider" | "priority" | "requiredFields" | "conditions" | "safetyPolicy" | "sourceUrl" | "sourceType" | "sourceLabel" | "classificationReason" | "discoveredAt" | "origin" | "lifecycleStatus" | "reviewReason" | "evidence" | "confidence">;
type ActionTemplate = Omit<ActionFlow, "id" | "createdAt" | "updatedAt" | keyof ActionMetadata> & Partial<ActionMetadata>;

const actionTypeForKey: Record<string, BusinessActionType> = {
  capture_lead: "contact_team",
  book_appointment: "book_appointment",
  request_demo: "request_demo",
  request_quote: "request_quote",
  enroll_child: "enroll",
  schedule_consultation: "book_appointment",
  book_tour: "external_booking",
  schedule_service: "schedule_service",
  call_business: "call_business",
  call_emergency: "call_emergency",
  external_booking: "external_booking",
  join_waitlist: "join_waitlist",
  contact_team: "contact_team",
};

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
      field("schedule_preference", "Schedule preference", "text", "Do you have a preferred day or schedule?", false),
      field("parent_name", "Parent or guardian name", "text", "What’s the parent or guardian name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    steps: [
      { id: "customer-type", type: "capture", fieldKey: "customer_type", config: { repeatableEntity: true, entityType: "student", entityLabel: "child", participantFieldKeys: ["customer_type", "child_age"], maxParticipants: 8 } },
      { id: "student-age", type: "capture", fieldKey: "child_age" },
      { id: "enrollment-details", type: "form", config: { fieldKeys: ["location", "program", "schedule_preference", "parent_name", "email", "phone"] } },
      { id: "registration-options", type: "lookup", config: { provider: "jackrabbit", resourceType: "registration", programField: "program", locationField: "location", dayField: "schedule_preference", includeWaitlist: true } },
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
  {
    key: "request_demo",
    name: "Request a demo",
    description: "Collect business context and contact details before sending the visitor to the demo request flow.",
    triggerPhrases: ["request a demo", "book a demo", "I want a demo", "show me a demo"],
    triggerIntents: ["demo", "lead"],
    captureMode: "hybrid",
    fields: [
      field("business_name", "Business name", "text", "What is your business name?"),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    completion: completion("Thanks — your demo request is ready to send to the team.", "qualified", "Continue to demo"),
    enabled: true,
  },
  {
    key: "schedule_service",
    name: "Schedule service",
    description: "Collect the issue and contact details needed to schedule a service visit.",
    triggerPhrases: ["schedule service", "schedule repair", "book service", "schedule maintenance"],
    triggerIntents: ["service", "booking", "lead"],
    captureMode: "hybrid",
    fields: [field("service", "Service", "text", "What service do you need?"), field("name", "Name", "text", "What’s your name?"), field("email", "Email", "email", "What email address should we use?"), field("phone", "Phone", "phone", "What’s the best phone number?", false)],
    completion: completion("Thanks — your service request is ready for the team.", "qualified"),
    enabled: true,
  },
  {
    key: "call_business",
    name: "Call the business",
    description: "Offer a verified business phone destination.",
    triggerPhrases: ["call the business", "call now", "call someone", "phone number"],
    triggerIntents: ["call", "contact"],
    captureMode: "form",
    fields: [],
    completion: completion("Here is the verified phone number for the business."),
    enabled: true,
  },
  {
    key: "call_emergency",
    name: "Call emergency support",
    description: "Route an explicit emergency request only to a verified emergency contact.",
    triggerPhrases: ["call emergency support", "call for emergency service", "emergency phone number"],
    triggerIntents: ["emergency", "call"],
    captureMode: "form",
    fields: [],
    completion: completion("For an emergency, use the verified emergency contact below."),
    enabled: true,
  },
  {
    key: "external_booking",
    name: "Continue to booking",
    description: "Send the visitor to the business's verified external booking provider.",
    triggerPhrases: ["book online", "continue to booking", "book a birthday", "book open play"],
    triggerIntents: ["booking", "reservation"],
    captureMode: "form",
    fields: [],
    completion: completion("The verified booking link is ready.", "booked", "Continue to booking"),
    enabled: true,
  },
  {
    key: "join_waitlist",
    name: "Join the waitlist",
    description: "Collect contact details for a verified waitlist request.",
    triggerPhrases: ["join the waitlist", "join a waiting list", "add me to the waitlist"],
    triggerIntents: ["waitlist", "lead"],
    captureMode: "hybrid",
    fields: [field("name", "Name", "text", "What’s your name?"), field("email", "Email", "email", "What email address should we use?")],
    completion: completion("Thanks — your waitlist request is ready for the team.", "qualified"),
    enabled: true,
  },
  {
    key: "contact_team",
    name: "Contact the team",
    description: "Collect a message and contact details for the business team.",
    triggerPhrases: ["contact the team", "send a message", "talk to someone", "have someone reach out"],
    triggerIntents: ["contact", "lead"],
    captureMode: "hybrid",
    fields: [field("message", "Message", "text", "What would you like the team to know?"), field("name", "Name", "text", "What’s your name?"), field("email", "Email", "email", "What email address should we use?")],
    completion: completion("Thanks — your message is ready for the team."),
    enabled: true,
  },
];

function cloneTemplate(template: ActionTemplate, id: string, now: string): ActionFlow {
  return JSON.parse(JSON.stringify({
    ...template,
    actionType: template.actionType ?? actionTypeForKey[template.key] ?? "contact_team",
    mode: template.mode ?? "transactional",
    destination: template.destination ?? null,
    provider: template.provider ?? null,
    priority: template.priority ?? 500,
    requiredFields: template.requiredFields ?? template.fields.map((item) => item.key),
    optionalFields: template.fields.filter((item) => !item.required).map((item) => item.key),
    conditions: template.conditions ?? [],
    safetyPolicy: template.safetyPolicy ?? "standard",
    sourceUrl: template.sourceUrl ?? null,
    sourceType: template.sourceType ?? "manual",
    sourceLabel: template.sourceLabel ?? template.name,
    classificationReason: template.classificationReason ?? null,
    discoveredAt: template.discoveredAt ?? null,
    origin: template.origin ?? "configured",
    lifecycleStatus: template.lifecycleStatus ?? (template.enabled === false ? "disabled" : "active"),
    reviewReason: template.reviewReason ?? null,
    evidence: template.evidence ?? [],
    confidence: template.confidence ?? 0.5,
    handoffBehavior: template.completion.requiresStaff
      ? { mode: "require_staff", reason: "Configured action requires staff" }
      : template.completion.notifyStaff
        ? { mode: "notify_staff" }
        : { mode: "none" },
    version: 1,
    id,
    createdAt: now,
    updatedAt: now,
  })) as ActionFlow;
}

export function actionTemplate(key: string): ActionTemplate | null {
  return ACTION_TEMPLATES.find((template) => template.key === key) ?? null;
}

function templateKeyForActionType(type: WebsiteActionType | BusinessActionType): string | null {
  const keys: Record<string, string> = {
    request_demo: "request_demo",
    book_appointment: "book_appointment",
    enroll: "enroll_child",
    schedule_service: "schedule_service",
    request_quote: "request_quote",
    call_business: "call_business",
    call_emergency: "call_emergency",
    external_booking: "external_booking",
    join_waitlist: "join_waitlist",
    contact_team: "contact_team",
  };
  return keys[type] ?? null;
}

export function defaultActionFlows(
  name: string,
  websiteContent: string,
  idFactory: (key: string) => string,
  candidates: WebsiteActionCandidate[] = [],
): ActionFlow[] {
  const value = (name + " " + websiteContent).toLowerCase();
  const keys = new Set<string>(["capture_lead"]);
  const bestCandidateByType = new Map<string, WebsiteActionCandidate>();
  for (const candidate of candidates.sort((left, right) => right.priority - left.priority || right.confidence - left.confidence)) {
    if (!bestCandidateByType.has(candidate.actionType)) bestCandidateByType.set(candidate.actionType, candidate);
  }
  for (const candidate of bestCandidateByType.values()) {
    const key = templateKeyForActionType(candidate.actionType);
    if (key) keys.add(key);
  }
  if (keys.size === 1 && /daycare|childcare|preschool|nursery|tour/.test(value)) keys.add("book_tour");
  else if (/swim|lesson|student|school|class/.test(value)) keys.add("enroll_child");
  else if (/salon|stylist|barber|spa|appointment/.test(value)) keys.add("book_appointment");
  else if (/hvac|air condition|heating|cooling|plumb|roof|repair/.test(value)) keys.add("request_quote");
  else if (/dental|dentist|clinic|medical|health/.test(value)) keys.add("schedule_consultation");
  else {
    keys.add("book_appointment");
    keys.add("request_quote");
  }
  const now = new Date().toISOString();
  const candidateByKey = new Map([...bestCandidateByType.values()].map((candidate) => [templateKeyForActionType(candidate.actionType), candidate]));
  return [...keys].map((key) => {
    const template = actionTemplate(key);
    if (!template) return null;
    const action = cloneTemplate(template, idFactory(key), now);
    const candidate = candidateByKey.get(key);
    if (!candidate) return action;
    return {
      ...action,
      actionType: candidate.actionType,
      name: candidate.label || action.name,
      description: candidate.description || action.description,
      destination: candidate.destination,
      provider: candidate.provider,
      priority: candidate.priority,
      requiredFields: candidate.requiredFields,
      conditions: candidate.conditions,
      safetyPolicy: candidate.safetyPolicy,
      sourceUrl: candidate.sourceUrl,
      sourceType: candidate.sourceType,
      sourceLabel: candidate.sourceLabel,
      classificationReason: candidate.classificationReason,
      discoveredAt: candidate.discoveredAt,
      origin: "discovered",
      lifecycleStatus: "needs_review",
      reviewReason: candidate.reviewReason,
      evidence: [{ sourceUrl: candidate.sourceUrl, quote: candidate.evidence[0] ?? candidate.label, confidence: candidate.confidence }],
      confidence: candidate.confidence,
      // Website-derived actions must be reviewed by Super Admin before they
      // can affect a visitor conversation.
      enabled: false,
      completion: {
        ...action.completion,
        ...(candidate.destination?.url ? { linkUrl: candidate.destination.url, linkLabel: candidate.destination.label ?? candidate.label, completionMode: "external_provider" as const } : {}),
      },
    };
  }).filter((item): item is ActionFlow => Boolean(item));
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

export type VisitorRequestMode = "informational" | "transactional";

export type VisitorRequestClassification = {
  mode: VisitorRequestMode;
  actionIntent: string;
  confidence: number;
  reason: string;
};

export function classifyVisitorRequest(question: string): VisitorRequestClassification {
  const value = normalize(question);
  const informational = /^(how|what|when|where|why|does|is|are|can i|could i|tell me|explain)\b/.test(value)
    || /\bhow does\b|\bwhat happens\b|\bwhat is the process\b/.test(value);
  const explicitRequest = /^(i want|i d like|id like|i need|please|help me|sign|enroll|register|book|schedule|request|get|call|connect me|send me|take me|let s|lets|join)\b/.test(value)
    || /\b(sign my child up|sign me up|book an appointment|schedule service|request a demo|book a demo|join the waitlist|call now|call emergency)\b/.test(value);
  const pricingKnowledge = /\b(pricing|price|prices|cost|costs|how much)\b/.test(value)
    && !/\b(request|requesting|get|getting|quote|estimate|book|schedule|appointment)\b/.test(value);
  let actionIntent = "general";
  if (/demo/.test(value)) actionIntent = "demo";
  else if (/sign my child up|sign me up|enroll|register|registration|new student|current student/.test(value)) actionIntent = "enrollment";
  else if (/book|appointment|schedule|reserve|birthday|open play/.test(value)) actionIntent = "booking";
  else if (/quote|estimate|how much|cost|pricing/.test(value)) actionIntent = "quote";
  else if (/consult|specialist/.test(value)) actionIntent = "consultation";
  else if (/tour|visit the (daycare|school)/.test(value)) actionIntent = "tour";
  else if (/waitlist|waiting list/.test(value)) actionIntent = "waitlist";
  else if (/emergency|urgent/.test(value)) actionIntent = "emergency";
  else if (/contact|reach|talk to someone|call me|call now/.test(value)) actionIntent = "lead";
  if (pricingKnowledge) return { mode: "informational", actionIntent, confidence: 0.93, reason: "pricing_information_request" };
  if (explicitRequest && !informational) return { mode: "transactional", actionIntent, confidence: 0.94, reason: "explicit_action_request" };
  return { mode: "informational", actionIntent, confidence: informational ? 0.93 : 0.72, reason: informational ? "explanatory_question" : "no_explicit_action_request" };
}

export function inferActionIntent(question: string): string {
  return classifyVisitorRequest(question).actionIntent;
}

export function detectAction(actions: ActionFlow[], question: string, primaryActionId?: string | null): ActionFlow | null {
  const request = classifyVisitorRequest(question);
  if (request.mode !== "transactional") return null;
  const value = normalize(question);
  const intent = request.actionIntent;
  return actions
    .filter((action) => action.enabled && (!action.lifecycleStatus || action.lifecycleStatus === "active" || action.lifecycleStatus === "approved"))
    .map((action) => ({
      action,
      phraseScore: action.triggerPhrases.reduce((score, phrase) => value.includes(normalize(phrase)) ? score + normalize(phrase).length + 10 : score, 0),
      intentScore: action.triggerIntents.some((item) => normalize(item) === intent) ? 4 : 0,
      primaryScore: primaryActionId && action.id === primaryActionId ? 100_000 : 0,
    }))
    .filter((item) => item.phraseScore > 0 || item.intentScore > 0)
    .sort((left, right) => right.primaryScore + right.phraseScore + right.intentScore - left.primaryScore - left.phraseScore - left.intentScore)[0]?.action ?? null;
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
