import type { ActionConnectorSettings } from "./action-connectors.js";
import type { WebsiteActionCandidate, WebsiteActionType } from "./website-actions.js";

export const BUSINESS_ACTION_TYPES = [
  "open_link",
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
export type ActionExecutionMode = "DIRECT_LINK" | "FORM_FLOW" | "PROVIDER_FLOW" | "PHONE" | "EMAIL" | "HANDOFF" | "API_ACTION";
export type ActionAttachmentPolicy = "always" | "sales_intent" | "high_intent_only" | "explicit_request_only" | "never_auto";
export type ActionSafetyPolicy = "standard" | "verified_contact" | "healthcare_emergency" | "manual_review";
export type ActionOrigin = "discovered" | "configured";
export type ActionLifecycleStatus = "discovered" | "needs_review" | "approved" | "active" | "disabled";
export type ActionReadinessReason = "ready" | "disabled" | "needs_review" | "missing_tracking_key" | "missing_destination" | "invalid_destination" | "missing_configuration" | "missing_provider_connection";
export type ActionReadiness = {
  ready: boolean;
  reason: ActionReadinessReason;
};
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

export type ActionFieldType = "text" | "email" | "phone" | "select" | "multi_select" | "date" | "number";
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
  | "knowledge"
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
  /** Owner can keep a step in the draft while taking it out of the runtime path. */
  enabled?: boolean;
  label?: string;
  /** Owner-facing condition copy. Runtime transitions continue to use `condition`. */
  conditionText?: string;
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
  /** Owner-facing metadata for the workflow builder. Runtime ignores this link. */
  workflow?: {
    name: string;
    actionId: string;
    /** Stable client key used to make generated-workflow creation idempotent. */
    creationRequestId?: string;
  };
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
  /** Response-only tenant context; persistence remains scoped by business_id. */
  organizationId?: string;
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
  executionMode?: ActionExecutionMode;
  attachmentPolicy?: ActionAttachmentPolicy;
  trackingKey?: string;
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
  readiness?: ActionReadiness;
  optionalFields?: string[];
  handoffBehavior?: ActionHandoffBehavior;
  version?: number;
  createdAt: string;
  updatedAt: string;
};

export type ConversationActionState = {
  actionId: string;
  /** Workflow definition version captured when this conversation started. */
  workflowVersion?: number;
  values: Record<string, string>;
  /** Current V2 workflow cursor. Legacy flows continue to use field order. */
  currentStepId?: string;
  /** One-turn/branch context used by trigger-gated workflow steps. */
  workflowTrigger?: string;
  completedStepIds?: string[];
  lookupResults?: Record<string, unknown>;
  /** Provider-backed lookup could not be completed; collect contact details instead. */
  providerFallback?: {
    provider: string;
    reason: "unavailable" | "not_found";
  };
  /** Lead captured at the workflow conversion boundary, before external handoff. */
  leadId?: string | null;
  /** A meaningful journey can be paused and saved without completing the action. */
  exitRescue?: {
    status: "offered" | "saved" | "declined";
    reason: "language" | "browser" | "inactivity";
    returnStepId?: string | null;
    offeredAt?: string;
    savedAt?: string;
    declinedAt?: string;
    returnedAt?: string;
    convertedAt?: string;
  };
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
  /** A qualified conversion CTA is currently available to the visitor. */
  conversionAvailable?: boolean;
  status: "active" | "completed";
  startedAt: string;
  completedAt?: string;
  loopGuard?: {
    lastFingerprint: string | null;
    consecutiveUnchangedTurns: number;
    triggered: boolean;
  };
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

const canonicalEnrollmentGoal = "Help parents find the right swim lesson for their child and move them toward registration. Ask only the minimum useful questions about the swimmer's age, ability, goals, preferred location, and schedule. Answer side questions from verified business knowledge and resume the workflow. Use the connected provider for live class availability and waitlist information. Show only verified options, let the parent choose a class, then provide the verified registration link. If no suitable class is available or the provider fails, offer waitlist/help or handoff to the team. Never invent availability, pricing, program levels, or registration URLs.";

function canonicalEnrollmentSteps(): ActionStep[] {
  return [
    { id: "customer-type", type: "capture", label: "Customer type", question: "Is this for a new student or someone already enrolled?", fieldKey: "customer_type", config: { repeatableEntity: true, entityType: "student", entityLabel: "child", participantFieldKeys: ["customer_type", "child_age", "ability", "goal"], maxParticipants: 8 } },
    { id: "student-age", type: "capture", label: "Child’s age", question: "How old is your child?", fieldKey: "child_age" },
    { id: "student-ability", type: "capture", label: "Swimming ability", question: "How comfortable is your child in the water?", fieldKey: "ability" },
    { id: "student-goal", type: "capture", label: "Lesson goal", question: "What would you like your child to work toward?", fieldKey: "goal" },
    { id: "student-location", type: "capture", label: "Location or ZIP code", question: "What location or ZIP code should I use to find classes?", fieldKey: "location" },
    { id: "student-schedule", type: "capture", label: "Schedule preference", question: "Which days or schedule usually work best?", fieldKey: "schedule_preference" },
    { id: "registration-options", type: "lookup", label: "Find matching classes", config: { provider: "jackrabbit", resourceType: "registration", programField: "program", locationField: "location", dayField: "schedule_preference", searchFields: "child_age, ability, goal, location, schedule_preference", includeWaitlist: true, failureBehavior: "capture_lead", fallbackStepId: "parent-contact", providerUnavailableBehavior: "capture_request_and_notify" } },
    { id: "class-recommendations", type: "recommend", label: "Present matching classes", question: "I found these matching classes. Which one would you like to consider?", config: { sourceStepId: "registration-options", providerResultStepId: "registration-options", requiresProviderResult: true, maxResults: 5 } },
    { id: "class-selection", type: "select", label: "Let visitor select a class", question: "Reply with the number of the class you want.", config: { sourceStepId: "registration-options", providerResultStepId: "registration-options", requiresProviderResult: true, maxResults: 5 } },
    { id: "parent-contact", type: "form", label: "Parent contact details", config: { fieldKeys: ["parent_name", "email", "phone"], ensureContact: true, contactFields: ["email", "phone"], providerFallback: true } },
    { id: "save-lead", type: "create_lead", label: "Save parent request", config: { ensureContact: true, failureBehavior: "handoff" } },
    { id: "enrollment-confirm", type: "confirm", label: "Confirm registration path", question: "I have the class details. Shall I prepare the registration link?", config: { requiresSelection: true, requiresVerifiedProviderSelection: true } },
    { id: "registration-link", type: "generate_link", label: "Generate registration link", config: { provider: "jackrabbit", completion: "external_provider", requiresSelection: true, requiresVerifiedProviderSelection: true, requiresContactBeforeHandoff: true, failureBehavior: "handoff" } },
    { id: "enrollment-complete", type: "complete", label: "Complete workflow", config: { requiresCompletionUrl: true } },
  ];
}

export const ACTION_TEMPLATES: ActionTemplate[] = [
  {
    key: "open_link",
    name: "Send visitors to a link",
    description: "Open a verified page such as a demo, registration, booking, pricing, or checkout page.",
    actionType: "open_link",
    triggerPhrases: ["open the link", "visit the link", "try the demo", "see the demo"],
    triggerIntents: ["general"],
    captureMode: "form",
    fields: [],
    executionMode: "DIRECT_LINK",
    attachmentPolicy: "sales_intent",
    completion: {
      createLead: false,
      leadStatus: "new",
      message: "You can try the demo here.",
      submitLabel: "Open link",
      linkLabel: "Open link",
      notifyStaff: false,
      notifyChannels: [],
      notifyTargets: [],
    },
    enabled: true,
  },
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
    name: "Find the right swim lesson",
    description: canonicalEnrollmentGoal,
    triggerPhrases: ["find a lesson", "find swimming lessons", "swimming lessons for my child", "sign me up", "enroll", "register my child", "register my student", "start enrollment"],
    triggerIntents: ["enrollment", "registration", "lead"],
    captureMode: "hybrid",
    fields: [
      field("customer_type", "Customer type", "select", "Is this for a new student or someone already enrolled?", true, ["New student", "Current student"]),
      field("child_age", "Child’s age", "number", "How old is the student?"),
      field("ability", "Swimming ability", "select", "How comfortable is the student in the water?", true, ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]),
      field("goal", "Lesson goal", "select", "What would you like the student to work on?", true, ["Learn to swim", "Water safety", "Build water confidence", "Improve technique", "Have fun"]),
      field("location", "Preferred location or ZIP code", "text", "Which location or ZIP code is most convenient?"),
      field("program", "Program", "text", "Which program are you interested in?", false),
      field("schedule_preference", "Schedule preference", "text", "Which days or schedule usually work best?", false),
      field("parent_name", "Parent or guardian name", "text", "What’s the parent or guardian name?"),
      field("email", "Email", "email", "What email address should we use?", false),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ],
    executionMode: "PROVIDER_FLOW",
    attachmentPolicy: "high_intent_only",
    provider: "jackrabbit",
    steps: canonicalEnrollmentSteps(),
    completion: {
      ...completion("Thanks — your registration request is ready for the team.", "qualified", "Continue registration"),
      completionMode: "external_provider",
    },
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
    description: "Send the visitor to the verified demo request destination.",
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
    executionMode: template.executionMode ?? defaultExecutionMode(template),
    attachmentPolicy: template.attachmentPolicy ?? defaultAttachmentPolicy(template),
    trackingKey: template.trackingKey ?? template.key,
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
    version: template.key === "enroll_child" ? 2 : 1,
    id,
    createdAt: now,
    updatedAt: now,
  })) as ActionFlow;
}

function defaultExecutionMode(template: Pick<ActionFlow, "key" | "completion"> & { actionType?: ActionFlow["actionType"]; destination?: ActionFlow["destination"] }): ActionExecutionMode {
  if (template.actionType === "call_business" || template.actionType === "call_emergency") return "PHONE";
  if (template.actionType === "contact_team" && template.completion.requiresStaff) return "HANDOFF";
  if (template.completion.connector) return "API_ACTION";
  if (template.destination?.url || template.completion.linkUrl) return "DIRECT_LINK";
  if (template.completion.completionMode === "external_provider" || template.completion.completionMode === "booking_connector") return "PROVIDER_FLOW";
  return "FORM_FLOW";
}

function defaultAttachmentPolicy(template: Pick<ActionFlow, "key"> & { actionType?: ActionFlow["actionType"] }): ActionAttachmentPolicy {
  if (template.actionType === "call_emergency") return "explicit_request_only";
  if (template.key === "request_demo" || template.key === "contact_team") return "explicit_request_only";
  if (template.key === "capture_lead") return "explicit_request_only";
  if (template.actionType === "external_booking" || template.actionType === "enroll" || template.actionType === "book_appointment") return "high_intent_only";
  return "sales_intent";
}

export function actionDestinationUrl(action: Pick<ActionFlow, "completion" | "destination">): string | null {
  const value = action.completion.linkUrl?.trim() || action.destination?.url?.trim() || "";
  return value || null;
}

export function validActionDestinationUrl(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Resolve a workflow provider. The enrollment fallback is intentionally
 * narrow: only the canonical enroll_child/enroll workflow is migrated to
 * Jackrabbit, so an unrelated custom provider flow is never silently claimed
 * by this connector.
 */
export function actionProviderForFlow(action: Pick<ActionFlow, "key" | "actionType" | "provider" | "steps">): string | null {
  if (action.provider?.trim()) return action.provider.trim().toLowerCase();
  for (const step of action.steps ?? []) {
    const provider = step.config?.provider;
    if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  }
  if (action.key === "enroll_child" && action.actionType === "enroll") return "jackrabbit";
  return null;
}

/**
 * Upgrade the built-in enrollment contract when an older persisted action is
 * loaded. Owner-authored actions keep their exact schema; only the canonical
 * Jackrabbit enrollment action receives the new qualification steps.
 */
export function normalizeCanonicalEnrollmentWorkflow(action: ActionFlow): ActionFlow {
  if (action.key !== "enroll_child" || action.actionType !== "enroll" || actionProviderForFlow(action) !== "jackrabbit") return action;
  const fields = [...action.fields];
  const addField = (field: ActionFlow["fields"][number], afterKey: string) => {
    if (fields.some((candidate) => candidate.key === field.key)) return;
    const index = fields.findIndex((candidate) => candidate.key === afterKey);
    fields.splice(index >= 0 ? index + 1 : fields.length, 0, field);
  };
  addField(field("ability", "Swimming ability", "select", "How comfortable is the student in the water?", true, ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]), "child_age");
  addField(field("goal", "Lesson goal", "select", "What would you like the student to work on?", true, ["Learn to swim", "Water safety", "Build water confidence", "Improve technique", "Have fun"]), "ability");
  // A discovered Action is the source for the owner’s generated workflow, but
  // once the owner has named that workflow we must preserve the generated
  // definition. Replacing it on the read path silently returned the old
  // canonical scaffold (including unlabeled steps) after a successful create.
  const ownerGeneratedWorkflow = Boolean(action.completion.workflow?.name?.trim());
  // A named owner-generated workflow is authoritative even when an older
  // attempt persisted an empty steps array. Do not replace that incomplete
  // record with the canonical scaffold: the workflow create endpoint must see
  // the zero-step state and repair the same Action id from the generated
  // definition. The canonical scaffold remains the fallback only for an
  // unnamed discovered enrollment Action.
  const steps = action.origin === "discovered" && !ownerGeneratedWorkflow
    ? canonicalEnrollmentSteps()
    : (action.steps ?? []).map((step) => ({ ...step, config: step.config ? { ...step.config } : undefined }));
  const firstStep = steps[0];
  if (firstStep?.config?.repeatableEntity === true) {
    firstStep.config = { ...firstStep.config, participantFieldKeys: ["customer_type", "child_age", "ability", "goal"] };
  }
  return {
    ...action,
    ...(action.origin === "discovered" && !ownerGeneratedWorkflow
      ? { name: "Find the right swim lesson", description: canonicalEnrollmentGoal }
      : {}),
    fields,
    steps,
    requiredFields: fields.filter((item) => item.required && item.visibility !== "hidden").map((item) => item.key),
    optionalFields: fields.filter((item) => !item.required && item.visibility !== "hidden").map((item) => item.key),
    completion: { ...action.completion, completionMode: action.completion.completionMode ?? "external_provider" },
    version: Math.max(action.version ?? 1, action.origin === "discovered" ? 2 : 1),
  };
}

/**
 * The single readiness contract for owner UI, primary-goal selection, and runtime.
 * Keep this stricter than the lifecycle flag: a link action is not ready until
 * it has a real web destination and an analytics key.
 */
export function actionReadiness(action: ActionFlow): ActionReadiness {
  if (!action.enabled) return { ready: false, reason: "disabled" };
  if (action.lifecycleStatus && !["approved", "active"].includes(action.lifecycleStatus)) {
    return { ready: false, reason: "needs_review" };
  }
  if (!action.trackingKey?.trim()) return { ready: false, reason: "missing_tracking_key" };
  if (action.executionMode === "PROVIDER_FLOW") {
    const provider = actionProviderForFlow(action);
    if (!provider) return { ready: false, reason: "missing_configuration" };
  }
  if (action.executionMode === "DIRECT_LINK") {
    const destination = actionDestinationUrl(action);
    if (!destination) return { ready: false, reason: "missing_destination" };
    if (!validActionDestinationUrl(destination)) return { ready: false, reason: "invalid_destination" };
    return { ready: true, reason: "ready" };
  }
  if (!action.fields.length && !action.completion.createLead && !action.completion.linkUrl) {
    return { ready: false, reason: "missing_configuration" };
  }
  return { ready: true, reason: "ready" };
}

export function isActionReady(action: ActionFlow): boolean {
  return actionReadiness(action).ready;
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
  const isSwimSchool = /\bswim(?:ming)?\b|\bswim school\b/.test(value);
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
  else if (/swim|lesson|student/.test(value)) keys.add("enroll_child");
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
    const canonicalName = key === "enroll_child" && isSwimSchool
      ? "Find the right swim lesson"
      : action.name;
    const canonicalDescription = key === "enroll_child" && isSwimSchool
      ? "Help parents find a suitable lesson, check live availability, and continue to verified registration."
      : action.description;
    action.name = canonicalName;
    action.description = canonicalDescription;
    const candidate = candidateByKey.get(key);
    if (!candidate) return action;
    const tryDemoCandidate = candidate.actionType === "request_demo"
      && /\b(try|start|see|view|explore)\b/i.test(candidate.label);
    return {
      ...action,
      actionType: candidate.actionType,
      ...(candidate.destination?.url ? { executionMode: "DIRECT_LINK" as const } : {}),
      ...(tryDemoCandidate
        ? { attachmentPolicy: "sales_intent" as const }
        : {}),
      ...(tryDemoCandidate
        ? {
          triggerPhrases: ["try the demo", "start the demo", "see the demo", "view the demo", "explore the demo"],
          triggerIntents: [],
        }
        : {}),
      name: canonicalName,
      description: canonicalDescription,
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
  const explicitRequest = /^(i want|i d like|id like|i need|please|help me|sign|enroll|register|book|schedule|request|get|try|see|view|watch|explore|open|call|connect me|send me|take me|let s|lets|join)\b/.test(value)
    || /\b(sign my child up|sign me up|book an appointment|schedule service|request a demo|book a demo|try the demo|see the demo|open the demo|join the waitlist|call now|call emergency)\b/.test(value)
    || /^(?:can|could)\s+(?:someone|you|a team|the team)\b.*\b(?:demo|walk me through|talk to)\b/.test(value);
  const pricingKnowledge = /\b(pricing|price|prices|cost|costs|how much)\b/.test(value)
    && !/\b(request|requesting|get|getting|quote|estimate|book|schedule|appointment)\b/.test(value);
  let actionIntent = "general";
  if (/\b(choose|choosing|recommend|right|best)\b.{0,32}\bplans?\b|\bplans?\b.{0,32}\b(choose|recommend|right|best)\b|\bsolo\b|\bteam\b.{0,24}\bplans?\b/.test(value)) actionIntent = "plan_selection";
  else if (/demo/.test(value)) actionIntent = "demo";
  else if (/sign my child up|sign me up|enroll|registration|new student|current student|swim(?:ming)?\s+lessons?|lessons?\s+for\s+(?:my|a)\s+(?:child|kid|student)/.test(value)) actionIntent = "enrollment";
  else if (/tour|visit the (daycare|school)/.test(value)) actionIntent = "tour";
  else if (/book|appointment|schedule|reserve|birthday|open play/.test(value)) actionIntent = "booking";
  else if (/quote|estimate|how much|cost|pricing/.test(value)) actionIntent = "quote";
  else if (/consult|specialist/.test(value)) actionIntent = "consultation";
  else if (/waitlist|waiting list/.test(value)) actionIntent = "waitlist";
  else if (/emergency|urgent/.test(value)) actionIntent = "emergency";
  else if (/contact|reach|talk to someone|call me|call now/.test(value)) actionIntent = "lead";
  if (pricingKnowledge) return { mode: "informational", actionIntent: "quote", confidence: 0.93, reason: "pricing_information_request" };
  if (explicitRequest && !informational) return { mode: "transactional", actionIntent, confidence: 0.94, reason: "explicit_action_request" };
  return { mode: "informational", actionIntent, confidence: informational ? 0.93 : 0.72, reason: informational ? "explanatory_question" : "no_explicit_action_request" };
}

export function inferActionIntent(question: string): string {
  return classifyVisitorRequest(question).actionIntent;
}

function workflowStartScore(action: ActionFlow, question: string): number {
  if (!action.steps?.length) return 0;
  const value = normalize(question);
  const fieldKeys = new Set(action.fields.map((field) => field.key));
  let score = 0;

  // A parent looking for lessons is expressing conversion intent even when
  // they are not using a command such as "enroll" or "sign up". Treat the
  // canonical swim workflow as the owner of that journey so a knowledge
  // answer cannot end the turn before qualification starts.
  const swimLessonSearch = /\bswim(?:ming)?\s+lessons?\b/.test(value)
    && /\b(looking for|find|need|want|search(?:ing)?|help)\b/.test(value)
    && (/\b(child|kid|son|daughter|student|swimmer|boy|girl)\b/.test(value)
      || /\b\d{1,3}\s*[- ]?year[- ]?old\b/.test(value));
  if (fieldKeys.has("customer_type") && fieldKeys.has("child_age") && swimLessonSearch
    && (action.key === "enroll_child" || action.actionType === "enroll")) {
    score += 30;
  }

  // Business-fit workflows need to be allowed to start from a visitor's
  // qualification statement. Those statements are intentionally not phrased
  // as commands ("I run a small salon..."), so transactional-only detection
  // skips them.
  if (fieldKeys.has("business_type") && fieldKeys.has("main_goal")) {
    if (/\b(salon|barber(?:shop)?|spa|beauty studio|beauty business)\b/.test(value)) score += 20;
    if (/\b(run|own|operate|looking for|need|trying to improve|software)\b/.test(value)) score += 8;
  }

  // Keep plan-selection starts narrow so ordinary pricing or feature
  // questions do not unexpectedly open a workflow.
  if (isPlanSelectionWorkflow(action) && /\b(choose|choosing|right|best|recommend|looking for|need help)\b/.test(value)) score += 12;
  return score;
}

function guidedDemoRequest(question: string): boolean {
  const value = normalize(question);
  return /\b(walk me through|guided|live|someone|team|request|book|schedule|talk to)\b.{0,36}\bdemo\b|\bdemo\b.{0,36}\b(walk me through|guided|live|someone|team|request|book|schedule|talk to)\b/.test(value);
}

export function detectAction(actions: ActionFlow[], question: string, primaryActionId?: string | null): ActionFlow | null {
  const request = classifyVisitorRequest(question);
  const value = normalize(question);
  const intent = request.actionIntent;
  const workflowStart = request.mode === "informational"
    ? actions.map((action) => ({ action, score: workflowStartScore(action, question) })).sort((left, right) => right.score - left.score)[0]
    : undefined;
  const canStartWorkflow = Boolean(workflowStart && workflowStart.score > 0);
  if (request.mode !== "transactional" && !canStartWorkflow) return null;

  const scored = actions
    .filter((action) => isActionReady(action))
    .map((action) => ({
      action,
      phraseScore: action.triggerPhrases.reduce((score, phrase) => value.includes(normalize(phrase)) ? score + normalize(phrase).length + 10 : score, 0),
      intentScore: action.triggerIntents.some((item) => normalize(item) === intent) ? 4 : 0,
      workflowScore: intent === "plan_selection" && isPlanSelectionWorkflow(action) ? 10_000 : 0,
      workflowStartScore: workflowStart?.action.id === action.id ? workflowStart.score : 0,
      // A primary conversion is a fallback for a generic sales request. It
      // must not outrank a separately configured guided-demo flow.
      primaryScore: primaryActionId && action.id === primaryActionId && !(intent === "demo" && guidedDemoRequest(question)) ? 100_000 : 0,
    }))
    .filter((item) => !(item.action.executionMode === "DIRECT_LINK"
      && (item.action.actionType === "request_demo" || item.action.key === "open_link")
      && /\b(demo|trial)\b/i.test(`${item.action.name} ${item.action.completion.linkLabel ?? ""}`)
      && /\b(book|schedule)\b.{0,24}\b(demo|trial)\b/i.test(question)))
    .filter((item) => item.phraseScore > 0 || item.intentScore > 0 || item.workflowScore > 0 || item.workflowStartScore > 0);

  // If a non-link request-demo flow exists, explicit demo language should
  // select it instead of the global "Try the demo" link. A direct link remains
  // valid for the ordinary "Try the demo" path when no request flow exists.
  const nonLinkDemo = scored.filter((item) => intent === "demo" && item.action.executionMode !== "DIRECT_LINK");
  const guidedDemo = intent === "demo" && guidedDemoRequest(question);
  const candidates = nonLinkDemo.length
    ? scored.filter((item) => !(intent === "demo" && item.action.executionMode === "DIRECT_LINK"))
    : scored.filter((item) => !(guidedDemo
      && item.action.executionMode === "DIRECT_LINK"
      && /\b(try|start|see|view|explore|open)\b/i.test(item.action.name)));

  // A qualification statement is a workflow start, not a generic sales CTA.
  // Keep this explicit so a configured primary action cannot win merely
  // because it happens to be present in the action registry. This is the
  // discovery-time equivalent of the active-workflow precedence enforced by
  // the conversation orchestrator.
  const workflowStartCandidate = candidates
    .filter((item) => item.workflowStartScore > 0 && Boolean(item.action.steps?.length))
    .sort((left, right) => right.workflowStartScore - left.workflowStartScore || right.phraseScore - left.phraseScore)[0];
  if (workflowStartCandidate) return workflowStartCandidate.action;
  return candidates.sort((left, right) => right.primaryScore + right.workflowScore + right.workflowStartScore + right.phraseScore + right.intentScore - left.primaryScore - left.workflowScore - left.workflowStartScore - left.phraseScore - left.intentScore)[0]?.action ?? null;
}

/**
 * Generated workflows may be saved on top of a generic lead action, so their
 * original trigger phrases are not a reliable routing contract. Keep the
 * shape-based fallback deliberately narrow and business-neutral.
 */
export function isPlanSelectionWorkflow(action: Pick<ActionFlow, "key" | "name" | "description" | "fields" | "steps">): boolean {
  const fieldKeys = new Set(action.fields.map((field) => field.key));
  const stepText = (action.steps ?? []).map((step) => `${step.id} ${step.label ?? ""} ${step.question ?? ""}`).join(" ");
  const text = `${action.key} ${action.name} ${action.description} ${stepText}`.toLowerCase();
  return fieldKeys.has("usage_type") && fieldKeys.has("main_goal") && fieldKeys.has("usage_level")
    || /recommend-plan|plan-selection|choose the right .* plan/.test(text);
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
  if (field.type === "multi_select" && field.options?.length) {
    const requested = value.split(/[,;]|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
    const choices = requested.map((item) => field.options?.find((option) => normalize(option) === normalize(item))
      ?? field.options?.find((option) => normalize(option).includes(normalize(item)) || normalize(item).includes(normalize(option))));
    if (!choices.length || choices.some((choice): choice is undefined => !choice)) return { value: null, error: "Please choose one or more of: " + field.options.join(", ") + "." };
    return { value: [...new Set(choices)].join(", ") };
  }
  if (field.type === "select" && field.options?.length) {
    const exact = field.options.find((option) => normalize(option) === normalize(value));
    const choice = exact ?? (!["usage_type", "main_goal", "usage_level"].includes(field.key)
      ? field.options.find((option) => normalize(option).includes(normalize(value)) || normalize(value).includes(normalize(option)))
      : undefined);
    if (!choice && field.key === "main_goal" && /online\s+book(?:ing)?/i.test(value) && /reminder/i.test(value)
      && field.options.some((option) => /online\s+book(?:ing)?/i.test(option))
      && field.options.some((option) => /reminder/i.test(option))) {
      return { value: "Online booking + reminders" };
    }
    if (!choice) return { value: null, error: "Please choose one of: " + field.options.join(", ") + "." };
    return { value: choice };
  }
  return { value };
}

export function fieldPrompt(field: ActionField): string {
  if (field.type === "multi_select" && field.options?.length) return field.question + " (choose one or more: " + field.options.join(", ") + ")";
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
    ...(action.steps?.length ? { workflowVersion: action.version ?? 1 } : {}),
    values: {},
    ...(action.steps?.length ? { currentStepId: action.steps[0].id, completedStepIds: [], interruptionStack: [] } : {}),
    captureMode,
    conversationalKeys,
    status: "active",
    startedAt: now,
  };
}
