export type WorkflowFieldDraft = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "select" | "multi_select" | "date" | "number";
  required: boolean;
  visibility?: "visible" | "hidden";
  question: string;
  options?: string[];
};

export const WORKFLOW_STEP_PRIMITIVES = [
  "ask",
  "capture",
  "form",
  "knowledge",
  "condition",
  "decision",
  "lookup",
  "recommend",
  "select",
  "confirm",
  "api_action",
  "create_lead",
  "book",
  "generate_link",
  "redirect",
  "notify",
  "handoff",
  "complete",
] as const;

export type WorkflowStepPrimitive = typeof WORKFLOW_STEP_PRIMITIVES[number];

export type WorkflowStepDraft = {
  id: string;
  type: WorkflowStepPrimitive;
  enabled?: boolean;
  label?: string;
  fieldKey?: string;
  answerType?: WorkflowFieldDraft["type"];
  question?: string;
  required?: boolean;
  options?: string[];
  condition?: string;
  conditionText?: string;
  config?: Record<string, unknown>;
};

type WorkflowGenerationStatus = "verified" | "suggested" | "missing";
type WorkflowGenerationSource = "owner_goal" | "business_context" | "verified_business_knowledge" | "approved_action" | "integration" | "industry_pattern" | "missing_information";

/** Owner-facing provenance persisted in step.config; the runtime ignores it. */
type WorkflowGenerationReason = {
  generationSource: WorkflowGenerationSource;
  generationStatus: WorkflowGenerationStatus;
  generationReason: string;
  generationEvidence?: string[];
};

export const KNOWLEDGE_STEP_TYPE = "knowledge" as const;

export type WorkflowGenerationContext = {
  organizationId?: string;
  businessId?: string;
  workflowId?: string;
  actionId?: string;
  contextVersion?: number;
  summaryVersion?: number;
  actionType?: string;
  actionName?: string;
  actionDescription?: string;
  availableActionTypes?: string[];
  availableProviders?: string[];
  knownBusinessKnowledge?: string[];
  completionGoal?: string;
  businessContext?: WorkflowBusinessContext;
};

export type WorkflowContextProvenance = {
  source?: string;
  authority?: string;
  confidence?: number;
  sourceLabel?: string;
};

export type WorkflowBusinessContext = {
  organizationId?: string;
  businessId?: string;
  contextVersion?: number;
  summaryVersion?: number;
  businessName?: string;
  businessType?: string;
  summary?: string;
  primaryGoal?: string | null;
  services?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  products?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  audiences?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  pricing?: { verified?: boolean; summary?: string[]; provenance?: WorkflowContextProvenance[] };
  locations?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  hours?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  providers?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  approvedActions?: Array<{ key: string; name: string; actionType: string; provenance?: WorkflowContextProvenance }>;
  discoveredCtas?: Array<{ label: string; url?: string; provenance?: WorkflowContextProvenance }>;
  knownPolicies?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  knowledgeSummary?: Array<{ value: string; provenance?: WorkflowContextProvenance }>;
  knowledgeGaps?: string[];
  existingWorkflows?: Array<{ key: string; name: string; actionType: string; provider: string | null; executionMode: string | null; version: number; stepTypes: string[]; fieldKeys: string[] }>;
};

export type WorkflowIntent = "plan_selection" | "enrollment" | "business_fit" | "tour" | "booking" | "quote" | "service" | "demo" | "lead";

export type WorkflowGenerationResult = {
  intent: WorkflowIntent;
  name: string;
  description: string;
  steps: WorkflowStepDraft[];
  fields: WorkflowFieldDraft[];
  missingInformation?: string[];
  executionMode?: string;
  provider?: string;
  validation: WorkflowGenerationValidation;
};

export type WorkflowGenerationIssue = {
  code:
    | "missing_step_id"
    | "duplicate_step_id"
    | "unsupported_step_type"
    | "missing_step_label"
    | "placeholder_step"
    | "missing_terminal_step"
    | "provider_fallback_missing"
    | "provider_result_dependency_missing"
    | "selection_dependency_missing"
    | "contact_boundary_missing";
  message: string;
  stepId?: string;
  stepIndex?: number;
};

export type WorkflowGenerationValidation = {
  ok: boolean;
  issues: WorkflowGenerationIssue[];
};

const workflowPlaceholderCopy = [
  /select step actions to configure this step/i,
  /untitled step/i,
  /configure this step/i,
  /enter prompt here/i,
  /select actions?/i,
];

function stepConfig(step: WorkflowStepDraft): Record<string, unknown> {
  return step.config && typeof step.config === "object" ? step.config : {};
}

function stepTargetIds(steps: WorkflowStepDraft[], step: WorkflowStepDraft, index: number): string[] {
  const targets = new Set<string>();
  const nextStepId = (step as WorkflowStepDraft & { nextStepId?: unknown }).nextStepId;
  if (typeof nextStepId === "string" && nextStepId) targets.add(nextStepId);
  const branches = (step as WorkflowStepDraft & { branches?: unknown }).branches;
  if (Array.isArray(branches)) {
    for (const branch of branches) {
      if (branch && typeof branch === "object" && typeof (branch as Record<string, unknown>).nextStepId === "string") {
        targets.add((branch as Record<string, unknown>).nextStepId as string);
      }
    }
  }
  if (!targets.size && steps[index + 1]) targets.add(steps[index + 1].id);
  return [...targets];
}

/**
 * Validate generated steps before they are copied into an editable workflow.
 * This is deliberately deterministic: model/editor placeholder copy and
 * unsafe provider-success paths must never become persisted workflow data.
 */
export function validateWorkflowGeneration(input: {
  steps: WorkflowStepDraft[];
  fields?: WorkflowFieldDraft[];
}): WorkflowGenerationValidation {
  const { steps, fields = [] } = input;
  const issues: WorkflowGenerationIssue[] = [];
  const byId = new Map<string, WorkflowStepDraft>();
  const indexById = new Map<string, number>();

  for (const [index, step] of steps.entries()) {
    if (!step.id?.trim()) issues.push({ code: "missing_step_id", message: `Step ${index + 1} is missing an id.`, stepIndex: index });
    else if (byId.has(step.id)) issues.push({ code: "duplicate_step_id", message: `Step id “${step.id}” is duplicated.`, stepId: step.id, stepIndex: index });
    else {
      byId.set(step.id, step);
      indexById.set(step.id, index);
    }

    if (!WORKFLOW_STEP_PRIMITIVES.includes(step.type as WorkflowStepPrimitive)) {
      issues.push({ code: "unsupported_step_type", message: `Step “${step.id || index + 1}” uses unsupported type “${String(step.type)}”.`, stepId: step.id, stepIndex: index });
    }
    if (!step.label?.trim()) issues.push({ code: "missing_step_label", message: `Step “${step.id || index + 1}” needs a human-readable label.`, stepId: step.id, stepIndex: index });
    const copy = `${step.label ?? ""} ${step.question ?? ""} ${step.conditionText ?? ""}`;
    if (workflowPlaceholderCopy.some((pattern) => pattern.test(copy))) {
      issues.push({ code: "placeholder_step", message: `Step “${step.id || index + 1}” contains editor placeholder copy.`, stepId: step.id, stepIndex: index });
    }
  }

  if (steps.length && !steps.some((step) => ["complete", "redirect", "handoff", "book"].includes(step.type))) {
    issues.push({ code: "missing_terminal_step", message: "The generated workflow has no reachable completion, redirect, or handoff step." });
  }

  const reachable = new Set<string>();
  const visit = (id: string, stack: string[] = []): void => {
    if (stack.includes(id) || reachable.has(id)) return;
    const step = byId.get(id);
    if (!step) return;
    reachable.add(id);
    const index = indexById.get(id) ?? -1;
    for (const target of stepTargetIds(steps, step, index)) visit(target, [...stack, id]);
  };
  if (steps[0]?.id) visit(steps[0].id);
  for (const [index, step] of steps.entries()) {
    if (step.enabled === false || !reachable.has(step.id)) continue;
    const config = stepConfig(step);
    if (step.type === "lookup" && typeof config.provider === "string") {
      const fallbackStepId = typeof config.fallbackStepId === "string" ? config.fallbackStepId : "";
      const hasFallbackBehavior = typeof config.failureBehavior === "string" && Boolean(config.failureBehavior.trim());
      if (!hasFallbackBehavior && !fallbackStepId) {
        issues.push({ code: "provider_fallback_missing", message: `Provider step “${step.label || step.id}” has no explicit fallback behavior.`, stepId: step.id, stepIndex: index });
      }
      if (fallbackStepId && !byId.has(fallbackStepId)) {
        issues.push({ code: "provider_fallback_missing", message: `Provider step “${step.label || step.id}” points to missing fallback step “${fallbackStepId}”.`, stepId: step.id, stepIndex: index });
      }
    }
    const requiresProviderResult = config.requiresProviderResult === true;
    if (requiresProviderResult) {
      const sourceId = typeof config.providerResultStepId === "string" ? config.providerResultStepId : typeof config.sourceStepId === "string" ? config.sourceStepId : "";
      const sourceIndex = sourceId ? indexById.get(sourceId) : undefined;
      if (!sourceId || sourceIndex === undefined || sourceIndex >= index || byId.get(sourceId)?.type !== "lookup") {
        issues.push({ code: "provider_result_dependency_missing", message: `“${step.label || step.id}” can run only after a provider lookup with verified results.`, stepId: step.id, stepIndex: index });
      }
    }
    if (config.requiresSelection === true) {
      const priorSelection = steps.slice(0, index).some((candidate) => candidate.type === "select");
      if (!priorSelection) issues.push({ code: "selection_dependency_missing", message: `“${step.label || step.id}” requires a selected provider option first.`, stepId: step.id, stepIndex: index });
      if (config.requiresVerifiedProviderSelection === true && !steps.slice(0, index).some((candidate) => candidate.type === "lookup")) {
        issues.push({ code: "selection_dependency_missing", message: `“${step.label || step.id}” requires a provider-verified selection.`, stepId: step.id, stepIndex: index });
      }
    }
    if (config.requiresContactBeforeHandoff === true) {
      const hasContactBoundary = steps.slice(0, index).some((candidate) => candidate.type === "create_lead" || (candidate.type === "form" && stepConfig(candidate).ensureContact === true));
      if (!hasContactBoundary) issues.push({ code: "contact_boundary_missing", message: `“${step.label || step.id}” needs contact capture before external handoff.`, stepId: step.id, stepIndex: index });
    }
  }

  const requiredFields = fields.filter((field) => field.required && field.visibility !== "hidden");
  const captured = new Set(steps.flatMap((step) => {
    if (step.fieldKey) return [step.fieldKey];
    if (step.type === "form" && Array.isArray(stepConfig(step).fieldKeys)) return (stepConfig(step).fieldKeys as unknown[]).filter((key): key is string => typeof key === "string");
    return [];
  }));
  for (const field of requiredFields) {
    if (!captured.has(field.key)) issues.push({ code: "contact_boundary_missing", message: `Required generated field “${field.label || field.key}” is never captured.`, stepId: field.key });
  }

  const uniqueIssues = [...new Map(issues.map((item) => [`${item.code}|${item.stepId ?? ""}|${item.message}`, item])).values()];
  return { ok: uniqueIssues.length === 0, issues: uniqueIssues };
}

/**
 * Workflow goals are owner-authored instructions. Use trim only to determine
 * whether the value is blank; never rewrite the value that is stored or sent
 * to generation.
 */
export function preserveWorkflowGoal(value: string): string | null {
  return value.trim() ? value : null;
}

export const ENROLLMENT_WORKFLOW_GOAL = "Help parents find the right swim lesson for their child and move them toward registration. Ask only the minimum useful questions about the swimmer's age, ability, goals, preferred location, and schedule. Answer side questions from verified business knowledge and resume the workflow. Use the connected provider for live class availability and waitlist information. Show only verified options, let the parent choose a class, then provide the verified registration link. If no suitable class is available or the provider fails, offer waitlist/help or handoff to the team. Never invent availability, pricing, program levels, or registration URLs.";

export function workflowGenerationCacheKey(context: Pick<WorkflowGenerationContext, "organizationId" | "businessId" | "workflowId" | "actionId" | "contextVersion">): string {
  return [
    "workflow_generation_context",
    context.organizationId || "unknown-organization",
    context.businessId || "unknown-business",
    context.workflowId || "unknown-workflow",
    context.actionId || "unknown-action",
    String(context.contextVersion ?? 0),
  ].join(":");
}

const interruptionConfig = {
  interruptionPolicy: "answer_and_resume",
  sideQuestions: ["pricing", "features", "cancellation", "privacy"],
  resumeBehavior: "return_to_previous_step",
};

function answerFromKnowledge(
  id: string,
  label: string,
  topic: string,
  allowedFacts: string,
  options: { conditional?: boolean; reviewStatus?: string } = {},
): WorkflowStepDraft {
  return {
    id,
    type: KNOWLEDGE_STEP_TYPE,
    label,
    question: "Answer naturally from verified business knowledge.",
    config: {
      ...interruptionConfig,
      conditional: options.conditional ?? true,
      topic,
      knowledgeSource: "verified_business_knowledge",
      allowedFacts,
      verifiedBehavior: "answer_naturally",
      unavailableBehavior: "say_not_verified",
      resumeBehavior: "return_to_previous_step",
      ctaBehavior: "keep_current_if_available",
      reviewStatus: options.reviewStatus ?? "verified",
      requiresVerifiedData: true,
    },
  };
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function field(
  key: string,
  label: string,
  type: WorkflowFieldDraft["type"],
  question: string,
  required = true,
  options?: string[],
): WorkflowFieldDraft {
  return { key, label, type, question, required, ...(options ? { options } : {}) };
}

function hiddenField(key: string, label: string): WorkflowFieldDraft {
  return { key, label, type: "text", question: "", required: false, visibility: "hidden" };
}

function capture(
  id: string,
  label: string,
  fieldKey: string,
  question: string,
  options?: string[],
): WorkflowStepDraft {
  return {
    id,
    type: "capture",
    label,
    fieldKey,
    question,
    required: true,
    ...(options ? { options } : {}),
    config: { ...interruptionConfig, reviewStatus: "owner_defined" },
  };
}

function withGenerationReason(step: WorkflowStepDraft, reason: WorkflowGenerationReason): WorkflowStepDraft {
  return {
    ...step,
    config: {
      ...(step.config ?? {}),
      generationSource: reason.generationSource,
      generationStatus: reason.generationStatus,
      generationReason: reason.generationReason,
      ...(reason.generationEvidence?.length ? { generationEvidence: reason.generationEvidence } : {}),
    },
  };
}

function actionLooksLikeDemo(action: { key?: string; name?: string; actionType?: string }): boolean {
  return /demo|trial|tour|start/i.test(`${action.key ?? ""} ${action.name ?? ""} ${action.actionType ?? ""}`);
}

function contextHasBusinessEvidence(context: WorkflowGenerationContext): boolean {
  const business = context.businessContext;
  if (!business) return false;
  const knownType = Boolean(business.businessType?.trim() && !/^unknown$|local[_ -]?business/i.test(business.businessType.trim()));
  return knownType
    || Boolean(business.summary?.trim())
    || Boolean(business.services?.length || business.products?.length || business.audiences?.length || business.knowledgeSummary?.length)
    || Boolean(context.knownBusinessKnowledge?.length);
}

function hasDemoConversionContext(context: WorkflowGenerationContext): boolean {
  const business = context.businessContext;
  return Boolean(
    business?.primaryGoal && /demo|trial|tour|start/i.test(business.primaryGoal)
      || business?.approvedActions?.some(actionLooksLikeDemo)
      || business?.discoveredCtas?.some((cta) => /demo|trial|tour|start/i.test(`${cta.label} ${cta.url ?? ""}`))
      || context.availableActionTypes?.some((actionType) => /demo|trial|tour|start/i.test(actionType))
      || business?.existingWorkflows?.some((workflow) => /demo|trial|tour|start/i.test(`${workflow.key} ${workflow.name} ${workflow.actionType}`)),
  );
}

function isSalonOrBeautyContext(context: WorkflowGenerationContext): boolean {
  return /salon|beauty|spa|barber/i.test(`${context.businessContext?.businessType ?? ""} ${context.businessContext?.businessName ?? ""} ${context.businessContext?.summary ?? ""}`);
}

function currentSoftwareIsRelevant(context: WorkflowGenerationContext): boolean {
  return isSalonOrBeautyContext(context)
    || context.businessContext?.existingWorkflows?.some((workflow) => workflow.fieldKeys.some((fieldKey) => /software|platform|integration/i.test(fieldKey))) === true
    || /software|platform|integration|booking|client management/i.test(`${context.businessContext?.summary ?? ""} ${(context.businessContext?.services ?? []).map((item) => item.value).join(" ")} ${(context.businessContext?.products ?? []).map((item) => item.value).join(" ")}`);
}

function isVerifiedContextEntry(entry: { value: string; provenance?: WorkflowContextProvenance }): boolean {
  return !entry.provenance?.authority || entry.provenance.authority === "verified";
}

function hasCapabilityKnowledge(context: WorkflowGenerationContext): boolean {
  const business = context.businessContext;
  return Boolean(
    business?.services?.some((item) => isVerifiedContextEntry(item) && item.value.trim())
      || business?.products?.some((item) => isVerifiedContextEntry(item) && item.value.trim())
      || business?.knowledgeSummary?.some((item) => isVerifiedContextEntry(item) && /feature|capabilit|booking|reminder|payment|client|software|service|integration/i.test(item.value))
      || context.knownBusinessKnowledge?.some((item) => /feature|capabilit|booking|reminder|payment|client|software|service|integration/i.test(item)),
  );
}

function hasIntegrationKnowledge(context: WorkflowGenerationContext): boolean {
  const business = context.businessContext;
  return Boolean(
    context.availableProviders?.length
      || business?.providers?.length
      || business?.services?.some((item) => isVerifiedContextEntry(item) && /integration|connect|sync|software|platform/i.test(item.value))
      || business?.knowledgeSummary?.some((item) => isVerifiedContextEntry(item) && /integration|connect|sync|software|platform/i.test(item.value)),
  );
}

function generatedFields(intent: WorkflowIntent, context: WorkflowGenerationContext = {}): WorkflowFieldDraft[] {
  if (intent === "plan_selection") {
    const businessName = businessLabel(context);
    return [
      field("usage_type", "Usage type", "select", `Are you planning to use ${businessName} by yourself or with a team?`, true, ["Solo", "Team"]),
      field("main_goal", "Main goal", "select", `What would you mainly like ${businessName} to help you with?`, true, ["Planning", "Reminders", "Planning + reminders", "AI task breakdown", "Team coordination", "Other"]),
      field("usage_level", "Usage level", "select", `How often do you expect to use ${businessName}?`, true, ["Occasionally", "Regularly", "Daily"]),
      hiddenField("recommended_plan", "Recommended plan"),
    ];
  }
  if (intent === "enrollment") {
    return [
      field("customer_type", "Customer type", "select", "Is this for a new student or someone already enrolled?", true, ["New student", "Current student"]),
      field("child_age", "Child’s age", "number", "How old is your child?"),
      field("ability", "Swimming ability", "select", "How comfortable is your child in the water?", true, ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]),
      field("goal", "Lesson goal", "select", "What would you like your child to work toward?", true, ["Learn to swim", "Water safety", "Build water confidence", "Improve technique", "Have fun"]),
      field("location", "Location or ZIP code", "text", "What location or ZIP code should I use to find classes?"),
      field("schedule_preference", "Schedule preference", "text", "Which days or schedule usually work best?"),
      field("parent_name", "Parent or guardian name", "text", "What’s the parent or guardian name?"),
      field("email", "Email", "email", "What email address should we use?", false),
      field("phone", "Phone", "phone", "What’s the best phone number?", false),
    ];
  }
  if (intent === "business_fit") {
    const businessType = naturalBusinessType(context);
    return [
      field("business_type", "Business type", "select", `What kind of ${businessType} do you run?`, true, ["Small salon", "Salon", "Barbershop", "Spa", "Beauty studio", "Other"]),
      field("main_goal", "Main goal", "select", "What are you mainly trying to improve?", true, ["Online booking", "Online booking + reminders", "Client management", "Reminders", "Staff management", "Payments", "Reviews / loyalty", "More bookings"]),
      ...(currentSoftwareIsRelevant(context) ? [field("current_software", "Current software", "text", "Are you using any relevant software today?")] : []),
      field("name", "Name", "text", "What’s your name?"),
      field("email", "Email", "email", "What email address should we use?"),
    ];
  }
  return [];
}

function canonicalBusinessName(context: WorkflowGenerationContext): string {
  const business = context.businessContext;
  const declared = business?.businessName?.trim() || "";
  const evidence = [
    business?.summary,
    ...(business?.knowledgeSummary ?? []).map((item) => item.value),
    ...(business?.services ?? []).map((item) => item.value),
    ...(business?.products ?? []).map((item) => item.value),
    ...(context.knownBusinessKnowledge ?? []),
    ...(business?.approvedActions ?? []).map((item) => `${item.key} ${item.name}`),
    ...(business?.discoveredCtas ?? []).flatMap((item) => [item.label, item.url]),
  ].filter(Boolean).join(" ");
  const brandCandidates = [...evidence.matchAll(/\b([A-Z][A-Za-z0-9]*(?:Flow|AI|CRM|Hub|Works|Labs|Studio))\b/g)].map((match) => match[1]);
  const brand = brandCandidates.find((candidate) => !/^business$/i.test(candidate));
  const declaredIsDescriptor = !declared || /local[_ -]?business|software|management|more bookings|^business$/i.test(declared);
  return declaredIsDescriptor ? (brand || "this business") : declared;
}

function businessLabel(context: WorkflowGenerationContext): string {
  const name = canonicalBusinessName(context);
  return name === "this business" ? "your business" : name;
}

function naturalBusinessType(context: WorkflowGenerationContext): string {
  const raw = context.businessContext?.businessType?.trim() || "";
  const evidence = `${raw} ${context.businessContext?.businessName ?? ""} ${context.businessContext?.summary ?? ""}`;
  if (/salon|beauty|spa|barber/i.test(evidence)) return "salon or beauty business";
  if (!raw || /^unknown$|local[_ -]?business/i.test(raw)) return "business";
  return raw.toLowerCase();
}

function planSelectionSteps(context: WorkflowGenerationContext = {}): WorkflowStepDraft[] {
  const businessName = businessLabel(context);
  return [
    capture("usage-type", "Usage type", "usage_type", `Are you planning to use ${businessName} by yourself or with a team?`, ["Solo", "Team"]),
    capture("main-goal", "Main goal", "main_goal", `What would you mainly like ${businessName} to help you with?`, ["Planning", "Reminders", "Planning + reminders", "AI task breakdown", "Team coordination", "Other"]),
    capture("usage-level", "Usage level", "usage_level", `How often do you expect to use ${businessName}?`, ["Occasionally", "Regularly", "Daily"]),
    {
      id: "recommend-plan",
      type: "recommend",
      label: "Recommend the best plan",
      question: "Based on your answers, I’ll choose the plan that fits best.",
      config: {
        ...interruptionConfig,
        reviewStatus: "suggested",
        reviewReason: "Recommendation rules need owner confirmation unless verified plan rules are available.",
        recommendationType: "plan",
        dataSource: "verified_business_knowledge",
        requiresVerifiedData: true,
        basedOn: ["usage_type", "main_goal", "usage_level"],
      },
    },
    {
      id: "explain-plan",
      type: "ask",
      label: "Explain the recommendation",
      question: "Based on what you told me, the recommended plan looks like the best fit because it matches your team size, goals, and expected usage.",
      config: {
        ...interruptionConfig,
        reviewStatus: "suggested",
        reviewReason: "Recommendation explanation is a suggested scaffold for owner review.",
        messageType: "recommendation_reason",
      },
    },
    {
      id: "show-pricing",
      type: KNOWLEDGE_STEP_TYPE,
      label: "Show verified pricing",
      question: "Here is the current verified pricing for the recommended plan.",
      config: {
        ...interruptionConfig,
        conditional: true,
        topic: "pricing",
        knowledgeSource: "verified_business_knowledge",
        allowedFacts: "pricing",
        verifiedBehavior: "answer_naturally",
        unavailableBehavior: "say_not_verified",
        resumeBehavior: "return_to_previous_step",
        ctaBehavior: "keep_current_if_available",
        reviewStatus: "verified",
        requiresVerifiedData: true,
      },
    },
    {
      id: "get-started",
      type: "redirect",
      label: "Get started",
      question: "Ready to get started?",
      config: { ...interruptionConfig, buttonLabel: "Get started", destinationSource: "action_destination" },
    },
  ];
}

function enrollmentSteps(): WorkflowStepDraft[] {
  return [
    capture("customer-type", "Customer type", "customer_type", "Is this for a new student or someone already enrolled?", ["New student", "Current student"]),
    capture("child-age", "Child’s age", "child_age", "How old is your child?"),
    capture("swimming-ability", "Swimming ability", "ability", "How comfortable is your child in the water?", ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]),
    capture("lesson-goal", "Lesson goal", "goal", "What would you like your child to work toward?", ["Learn to swim", "Water safety", "Build water confidence", "Improve technique", "Have fun"]),
    capture("location", "Location or ZIP code", "location", "What location or ZIP code should I use to find classes?"),
    capture("schedule-preference", "Schedule preference", "schedule_preference", "Which days or schedule usually work best?"),
    {
      id: "find-classes",
      type: "lookup",
      label: "Find matching classes in Jackrabbit",
      config: {
        ...interruptionConfig,
        reviewStatus: "provider_backed",
        providerSource: "integration",
        provider: "jackrabbit",
        operation: "find_classes",
        resourceType: "registration",
        locationField: "location",
        dayField: "schedule_preference",
        searchFields: "child_age, ability, goal, location, schedule_preference",
        includeWaitlist: true,
        failureBehavior: "capture_lead",
        fallbackStepId: "parent-contact",
        providerUnavailableBehavior: "capture_request_and_notify",
      },
    },
    {
      id: "class-recommendations",
      type: "recommend",
      label: "Present matching classes",
      question: "I found these matching classes. Which one would you like to consider?",
      config: { ...interruptionConfig, sourceStepId: "find-classes", providerResultStepId: "find-classes", requiresProviderResult: true, maxResults: 5 },
    },
    {
      id: "class-selection",
      type: "select",
      label: "Let visitor select a class",
      question: "Reply with the number of the class you want.",
      config: { ...interruptionConfig, sourceStepId: "find-classes", providerResultStepId: "find-classes", requiresProviderResult: true, maxResults: 5 },
    },
    {
      id: "parent-contact",
      type: "form",
      label: "Parent contact details",
      config: { ...interruptionConfig, fieldKeys: ["parent_name", "email", "phone"], ensureContact: true, contactFields: ["email", "phone"] },
    },
    {
      id: "save-lead",
      type: "create_lead",
      label: "Save parent request",
      config: { ...interruptionConfig, ensureContact: true, failureBehavior: "handoff" },
    },
    {
      id: "registration-confirm",
      type: "confirm",
      label: "Confirm registration path",
      question: "I have the class details. Shall I prepare the registration link?",
      required: true,
      config: { ...interruptionConfig },
    },
    {
      id: "registration-link",
      type: "generate_link",
      label: "Generate registration link",
      config: { ...interruptionConfig, provider: "jackrabbit", requiresSelection: true, requiresVerifiedProviderSelection: true, requiresContactBeforeHandoff: true, failureBehavior: "handoff" },
    },
    {
      id: "enrollment-complete",
      type: "complete",
      label: "Continue registration",
      question: "Your registration link is ready.",
      config: { ...interruptionConfig, buttonLabel: "Continue registration", requiresCompletionUrl: true },
    },
  ];
}

function businessFitSteps(context: WorkflowGenerationContext, ownerGoal: string): WorkflowStepDraft[] {
  const business = context.businessContext;
  const businessName = businessLabel(context);
  const businessType = naturalBusinessType(context);
  const requestDemoAction = business?.approvedActions?.find((action) => action.actionType === "request_demo" || /request.?demo/i.test(`${action.key} ${action.name}`));
  const tryDemoAction = business?.approvedActions?.find((action) => action.key === "try_demo" || /try.?demo|trial/i.test(`${action.key} ${action.name}`));
  const hasRequestDemoAction = Boolean(requestDemoAction || business?.discoveredCtas?.some((cta) => /request.?demo/i.test(cta.label)));
  const explicitRequestOnly = /request\s+(?:a\s+)?demo\s+only\s+when|only\s+when\s+(?:the\s+visitor\s+)?explicitly|explicitly\s+requested/i.test(ownerGoal);
  const ownerPrefersTryDemo = /try\s+(?:the\s+)?demo|sales intent|self.?serve|start a trial/i.test(ownerGoal);
  const primaryGoal = business?.primaryGoal ?? "";
  const primaryGoalRequestsDemo = /request.?demo|request a demo/i.test(primaryGoal);
  const primaryGoalPrefersTryDemo = /try.?demo|trial|self.?serve/i.test(primaryGoal);
  const useRequestDemo = !explicitRequestOnly
    && Boolean(requestDemoAction || business?.discoveredCtas?.some((cta) => /request.?demo/i.test(cta.label)))
    && !ownerPrefersTryDemo
    && !primaryGoalPrefersTryDemo
    && (primaryGoalRequestsDemo || !tryDemoAction);
  const selectedAction = useRequestDemo
    ? requestDemoAction
    : tryDemoAction ?? business?.approvedActions?.find((action) => !/request.?demo/i.test(`${action.key} ${action.name}`) && actionLooksLikeDemo(action));
  const selectedCta = business?.discoveredCtas?.find((cta) => {
    const text = `${cta.label} ${cta.url ?? ""}`;
    return useRequestDemo ? /request.?demo/i.test(text) : /try|demo|trial|start/i.test(text);
  }) ?? business?.discoveredCtas?.find((cta) => Boolean(cta.url));
  const selectedLabel = selectedAction?.name?.trim() || selectedCta?.label?.trim() || (useRequestDemo ? "Request a demo" : "Try the demo");
  const selectedActionKnown = Boolean(selectedAction || selectedCta?.url);
  const capabilitiesKnown = hasCapabilityKnowledge(context);
  const pricingKnown = business?.pricing?.verified === true;
  const integrationsKnown = hasIntegrationKnowledge(context);
  const steps: WorkflowStepDraft[] = [
    withGenerationReason(
      capture("business-type", "Business type", "business_type", `What kind of ${businessType} do you run?`, isSalonOrBeautyContext(context) ? ["Salon", "Barbershop", "Spa", "Beauty studio", "Other"] : ["Professional service", "Retail or ecommerce", "Software or technology", "Other"]),
      { generationSource: "business_context", generationStatus: "suggested", generationReason: "Suggested from the business context so the journey can match the visitor to the right capabilities.", generationEvidence: business?.businessType ? [businessType] : undefined },
    ),
    withGenerationReason(
      capture("main-goal", "Main goal", "main_goal", "What are you mainly trying to improve?", ["Online booking", "Client management", "Reminders", "Staff management", "Payments", "Reviews / loyalty", "More bookings"]),
      { generationSource: "owner_goal", generationStatus: "suggested", generationReason: "The owner wants visitors guided to a relevant next step, so this is the minimum useful qualification question." },
    ),
  ];
  if (currentSoftwareIsRelevant(context)) {
    steps.push(withGenerationReason(
      capture("current-software", "Current software", "current_software", "Are you using any relevant software today?"),
      { generationSource: "business_context", generationStatus: "suggested", generationReason: "Suggested from the business context because current software can affect fit and integration questions.", generationEvidence: [businessType, "software compatibility is relevant"] },
    ));
  }
  steps.push(withGenerationReason({
    id: "relevant-capabilities",
    type: "recommend",
    label: "Relevant capabilities",
    question: `Match only verified ${businessName} capabilities to the visitor’s needs.`,
    config: { ...interruptionConfig, reviewStatus: capabilitiesKnown ? "verified" : "needs_owner_confirmation", dataSource: "verified_business_knowledge", requiresVerifiedData: true, basedOn: ["business_type", "main_goal"], ...(!capabilitiesKnown ? { reviewReason: "No verified capabilities are available in Business Brain." } : {}) },
  }, {
    generationSource: capabilitiesKnown ? "verified_business_knowledge" : "missing_information",
    generationStatus: capabilitiesKnown ? "verified" : "missing",
    generationReason: capabilitiesKnown ? "Matches capabilities already present in verified Business Brain knowledge." : "Missing information — add verified capabilities before publishing this matching step.",
  }));
  steps.push(withGenerationReason(answerFromKnowledge("pricing", "Pricing", "pricing", "pricing", {
    conditional: true,
    reviewStatus: pricingKnown ? "verified" : "needs_owner_confirmation",
  }), {
    generationSource: pricingKnown ? "verified_business_knowledge" : "missing_information",
    generationStatus: pricingKnown ? "verified" : "missing",
    generationReason: pricingKnown ? "Answers pricing questions from verified Business Brain knowledge and resumes the journey." : "Missing information — pricing is not verified, so the assistant must say it is not verified.",
  }));
  steps.push(withGenerationReason(answerFromKnowledge("integrations", "Integrations", "integrations", "services", {
    conditional: true,
    reviewStatus: integrationsKnown ? "verified" : "needs_owner_confirmation",
  }), {
    generationSource: integrationsKnown ? "verified_business_knowledge" : "missing_information",
    generationStatus: integrationsKnown ? "verified" : "missing",
    generationReason: integrationsKnown ? "Answers integration questions only from verified services, providers, or Business Brain knowledge." : "Missing information — no verified integration details are available.",
  }));
  steps.push(withGenerationReason(capture("contact-name", "Name", "name", "What’s your name?"), {
    generationSource: "owner_goal",
    generationStatus: "suggested",
    generationReason: "Required for lead capture before offering the demo path.",
  }));
  steps.push(withGenerationReason(capture("contact-email", "Email", "email", "What email address should we use?"), {
    generationSource: "owner_goal",
    generationStatus: "suggested",
    generationReason: "Required for lead capture and demo follow-up.",
  }));
  steps.push(withGenerationReason({
    id: "save-lead",
    type: "create_lead",
    label: "Save lead",
    config: { ...interruptionConfig, failureBehavior: "handoff" },
  }, {
    generationSource: "owner_goal",
    generationStatus: "suggested",
    generationReason: "Saves the captured contact details before the conversion action is offered.",
  }));
  if (useRequestDemo) {
    steps.push(withGenerationReason({
      id: "request-demo",
      type: "redirect",
      label: selectedLabel,
      question: `Ready to request a demo of ${businessName}?`,
      config: { ...interruptionConfig, buttonLabel: selectedLabel, destinationSource: "approved_action", normalConversionEndpoint: true, ...(selectedAction?.key ? { actionKey: selectedAction.key } : {}), ...(selectedCta?.url ? { destinationUrl: selectedCta.url } : {}), ...(!selectedActionKnown ? { reviewStatus: "needs_owner_confirmation", requiresVerifiedData: true, reviewReason: "Connect or approve the primary demo action before publishing." } : {}) },
    }, {
      generationSource: selectedActionKnown ? "approved_action" : "missing_information",
      generationStatus: selectedActionKnown ? "verified" : "missing",
      generationReason: selectedActionKnown ? "Matches the selected primary conversion action in the business context." : "Missing information — approve a Request Demo action or provide its verified destination.",
      generationEvidence: selectedAction?.name ? [selectedAction.name] : undefined,
    }));
  } else {
    steps.push(withGenerationReason({
      id: "try-demo",
      type: "redirect",
      label: selectedLabel,
      question: `Ready to see how ${businessName} can help?`,
      config: { ...interruptionConfig, buttonLabel: selectedLabel, destinationSource: "approved_action", normalConversionEndpoint: true, ...(selectedAction?.key ? { actionKey: selectedAction.key } : {}), ...(selectedCta?.url ? { destinationUrl: selectedCta.url } : {}), ...(!selectedActionKnown ? { reviewStatus: "needs_owner_confirmation", requiresVerifiedData: true, reviewReason: "Connect or approve the primary demo action before publishing." } : {}) },
    }, {
      generationSource: selectedActionKnown ? "approved_action" : "missing_information",
      generationStatus: selectedActionKnown ? "verified" : "missing",
      generationReason: selectedActionKnown ? "Matches the selected primary conversion action in the business context." : "Missing information — approve a demo action or provide its verified destination.",
      generationEvidence: selectedAction?.name ? [selectedAction.name] : undefined,
    }));
  }
  if (hasRequestDemoAction && !useRequestDemo) {
    steps.push(withGenerationReason({
      id: "request-demo",
      type: "redirect",
      label: "Request a demo",
      question: "If you would like the team to walk you through it, request a demo.",
      config: { ...interruptionConfig, buttonLabel: "Request a demo", destinationSource: "approved_action", explicitRequestOnly: true, conditional: true, trigger: "explicit_guided_demo_request", ...(requestDemoAction?.key ? { actionKey: requestDemoAction.key } : {}) },
    }, {
      generationSource: explicitRequestOnly ? "owner_goal" : "approved_action",
      generationStatus: "verified",
      generationReason: explicitRequestOnly ? "The owner asked for a team demo only when the visitor explicitly requests it." : "Keeps the approved Request Demo action available for explicit requests without replacing the primary path.",
    }));
  }
  steps.push(withGenerationReason({
    id: "support-handoff",
    type: "handoff",
    label: "Support / handoff",
    question: "If you need account help or a person, I’ll connect you with the team.",
    config: { ...interruptionConfig, trigger: "explicit_support_or_human_request", conditional: true, failureBehavior: "handoff" },
  }, {
    generationSource: "industry_pattern",
    generationStatus: "suggested",
    generationReason: "Provides a safe path for account help or human requests instead of guessing.",
  }));
  return steps;
}

function mergeFields(baseFields: WorkflowFieldDraft[], generated: WorkflowFieldDraft[]): WorkflowFieldDraft[] {
  const generatedKeys = new Set(generated.map((item) => item.key));
  const optionalContext = baseFields
    .filter((item) => !generatedKeys.has(item.key))
    .map((item) => ({ ...item, required: false }));
  return [...generated, ...optionalContext];
}

export function inferWorkflowIntent(description: string, context: WorkflowGenerationContext = {}): WorkflowIntent {
  const ownerGoal = normalized(description);
  const actionContext = normalized(`${context.actionName ?? ""} ${context.actionDescription ?? ""} ${context.actionType ?? ""} ${(context.availableActionTypes ?? []).join(" ")} ${(context.availableProviders ?? []).join(" ")} ${context.completionGoal ?? ""} ${(context.knownBusinessKnowledge ?? []).join(" ")}`);

  // Owner-authored intent is deliberately checked before action metadata. The
  // action template is useful context, but must never override the goal.
  if (/\b(plan|plans|solo|usage|right fit|best fit)\b/.test(ownerGoal)
    && !/swim|lesson|child|student|jackrabbit/.test(ownerGoal)) return "plan_selection";
  if (/swim|lesson|child|student|jackrabbit|class/.test(ownerGoal)) return "enrollment";
  if (/\b(tour|visit)\b/.test(ownerGoal)) return "tour";
  if (/quote|estimate/.test(ownerGoal)) return "quote";

  // Keep an explicit business-fit goal ahead of generic support/service words
  // that may appear in the owner's fallback or handoff instructions.
  if (context.businessContext && /good fit|relevant capabilit|business type|try the demo|primary conversion|salon|beauty/i.test(ownerGoal)) return "business_fit";
  if (/support|service|issue|repair/.test(ownerGoal)) return "service";

  // A terse sales goal becomes business-fit only when the active Business
  // Brain can ground it in a real business and a known demo/conversion path.
  // Without that evidence, keep the generic lead journey and do not guess.
  if (context.businessContext && contextHasBusinessEvidence(context)
    && /capture|contact|lead|guide|convert|sales|demo/.test(ownerGoal)) return "business_fit";
  if (/demo/.test(ownerGoal)) return "demo";
  if (/book|schedule|appointment|reserve/.test(ownerGoal)) return "booking";

  // Metadata only participates when the owner description is ambiguous.
  if (/jackrabbit|enroll/.test(actionContext)) return "enrollment";
  if (/quote/.test(actionContext)) return "quote";
  if (/book|appointment/.test(actionContext)) return "booking";
  if (/demo/.test(actionContext)) return "demo";
  return "lead";
}

export function generateWorkflow(description: string, baseFields: WorkflowFieldDraft[] = [], context: WorkflowGenerationContext = {}): WorkflowGenerationResult {
  const intent = inferWorkflowIntent(description, context);
  const steps: WorkflowStepDraft[] = intent === "plan_selection"
    ? planSelectionSteps(context)
    : intent === "enrollment"
      ? enrollmentSteps()
      : intent === "business_fit"
        ? businessFitSteps(context, description)
      : intent === "booking" || intent === "tour"
        ? [
          capture("service", "Service", "service", "What would you like to book?"),
          capture("schedule", "Schedule", "schedule", "What day or time works best?"),
          { id: "availability", type: "lookup", label: "Check availability", config: { ...interruptionConfig, provider: "booking", operation: "get_availability", searchFields: "service, schedule", failureBehavior: "handoff" } },
          { id: "confirm", type: "confirm", label: "Confirm booking", question: "Should I reserve this time for you?", config: { ...interruptionConfig } },
          { id: "book", type: "book", label: "Book", config: { ...interruptionConfig, failureBehavior: "handoff" } },
        ]
        : intent === "quote"
          ? [
            capture("requirements", "Requirements", "requirements", "What would you like a quote for?"),
            capture("contact", "Contact", "name", "What is your name?"),
            { id: "quote-review", type: "condition", label: "Review requirements", condition: "If the requirements are complete, create a quote request.", config: { ...interruptionConfig } },
            { id: "save", type: "create_lead", label: "Save quote request", config: { ...interruptionConfig, failureBehavior: "handoff" } },
            { id: "complete", type: "complete", label: "Confirm quote follow-up", config: { ...interruptionConfig } },
          ]
          : [
            capture("contact", "Contact", "name", "What is your name?"),
            capture("email", "Email", "email", "What email should we use?"),
            capture("context", "Context", "context", "What are you hoping to accomplish?"),
            { id: "qualify", type: "condition", label: "Qualify request", condition: "If the visitor is ready, mark the lead qualified.", config: { ...interruptionConfig } },
            { id: "save", type: "create_lead", label: "Save qualified lead", config: { ...interruptionConfig, failureBehavior: "handoff" } },
            { id: "notify", type: "notify", label: "Notify the team", config: { ...interruptionConfig } },
            { id: "complete", type: "complete", label: "Confirm follow-up", config: { ...interruptionConfig } },
          ];
  const generated = generatedFields(intent, context);
  const businessName = canonicalBusinessName(context);
  const businessNameForCopy = businessName === "this business" ? "" : businessName;
  const pricingVerified = context.businessContext?.pricing?.verified === true;
  const providers = context.availableProviders !== undefined
    ? context.availableProviders.map((provider) => provider.toLowerCase())
    : context.businessContext?.providers?.map((provider) => provider.value.toLowerCase()) ?? [];
  const normalizedDescription = intent === "enrollment" && /enroll today|discovered on other page/i.test(description)
    ? ENROLLMENT_WORKFLOW_GOAL
    : description;
  if (intent === "plan_selection") {
    const planRecommendation = steps.find((step) => step.id === "recommend-plan");
    if (planRecommendation) {
      planRecommendation.config = {
        ...(planRecommendation.config ?? {}),
        reviewStatus: "suggested",
        reviewReason: "No verified plan recommendation rule is available; confirm the mapping before publishing.",
      };
    }
    const pricingStep = steps.find((step) => step.id === "show-pricing");
    if (pricingStep) {
      pricingStep.config = {
        ...(pricingStep.config ?? {}),
        reviewStatus: pricingVerified ? "verified" : "needs_owner_confirmation",
        ...(pricingVerified ? {} : { reviewReason: "Pricing was not verified in business knowledge." }),
      };
    }
  }
  if (intent === "enrollment") {
    const lookupStep = steps.find((step) => step.id === "find-classes");
    if (lookupStep) {
      lookupStep.config = {
        ...(lookupStep.config ?? {}),
        reviewStatus: providers.includes("jackrabbit") ? "provider_backed" : "suggested",
        ...(providers.includes("jackrabbit") ? {} : { reviewReason: "Connect Jackrabbit before relying on live class availability." }),
      };
    }
    const optionsStep = steps.find((step) => step.id === "class-recommendations");
    if (optionsStep) {
      optionsStep.config = {
        ...(optionsStep.config ?? {}),
        reviewStatus: providers.includes("jackrabbit") ? "provider_backed" : "suggested",
        ...(providers.includes("jackrabbit") ? {} : { reviewReason: "Connect Jackrabbit before presenting live class options." }),
      };
    }
    const selectionStep = steps.find((step) => step.id === "class-selection");
    if (selectionStep) {
      selectionStep.config = {
        ...(selectionStep.config ?? {}),
        reviewStatus: providers.includes("jackrabbit") ? "provider_backed" : "suggested",
        ...(providers.includes("jackrabbit") ? {} : { reviewReason: "Connect Jackrabbit before allowing class selection." }),
      };
    }
    const linkStep = steps.find((step) => step.id === "registration-link");
    if (linkStep) {
      linkStep.config = {
        ...(linkStep.config ?? {}),
        reviewStatus: providers.includes("jackrabbit") ? "provider_backed" : "suggested",
        ...(providers.includes("jackrabbit") ? {} : { reviewReason: "Connect Jackrabbit before generating registration links." }),
      };
    }
  }
  const defaultName = intent === "plan_selection"
    ? businessNameForCopy ? `Choose the right ${businessNameForCopy} plan` : "Choose the right plan"
    : intent === "enrollment"
      ? "Find the right swim lesson"
      : intent === "business_fit"
        ? businessName ? `Help visitors find the right ${businessName} fit` : "Help visitors find the right fit"
      : context.actionName ?? "Workflow";
  const missingInformation = [...new Set(steps.flatMap((step) => {
    const config: Record<string, unknown> = step.config ?? {};
    return config.generationStatus === "missing" && typeof config.generationReason === "string" ? [config.generationReason] : [];
  }))];
  const generatedWorkflowFields = mergeFields(intent === "business_fit" ? [] : baseFields, generated);
  return {
    intent,
    name: defaultName,
    description: normalizedDescription,
    steps,
    // Business-fit journeys are rebuilt from the active Business Brain. Do not
    // merge fields from the previous draft because that is the exact path by
    // which a previous tenant's qualification questions can survive a switch.
    fields: generatedWorkflowFields,
    ...(missingInformation.length ? { missingInformation } : {}),
    ...(intent === "enrollment" ? { executionMode: "PROVIDER_FLOW", provider: "jackrabbit" } : {}),
    validation: validateWorkflowGeneration({ steps, fields: generatedWorkflowFields }),
  };
}

export function templateSteps(key: string): WorkflowStepDraft[] {
  return generateWorkflow(key === "enrollment" ? "Help parents find the right swim lesson for their child" : key, [], { actionName: key }).steps;
}
