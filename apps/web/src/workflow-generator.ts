export type WorkflowFieldDraft = {
  key: string;
  label: string;
  type: "text" | "email" | "phone" | "select" | "date" | "number";
  required: boolean;
  question: string;
  options?: string[];
};

export type WorkflowStepDraft = {
  id: string;
  type: string;
  label?: string;
  fieldKey?: string;
  question?: string;
  required?: boolean;
  options?: string[];
  condition?: string;
  config?: Record<string, unknown>;
};

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
  executionMode?: string;
  provider?: string;
};

/**
 * Workflow goals are owner-authored instructions. Use trim only to determine
 * whether the value is blank; never rewrite the value that is stored or sent
 * to generation.
 */
export function preserveWorkflowGoal(value: string): string | null {
  return value.trim() ? value : null;
}

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

function generatedFields(intent: WorkflowIntent, context: WorkflowGenerationContext = {}): WorkflowFieldDraft[] {
  if (intent === "plan_selection") {
    return [
      field("usage_type", "Usage type", "select", "Are you planning to use PlanCraftAI by yourself or with a team?", true, ["Solo", "Team"]),
      field("main_goal", "Main goal", "select", "What would you mainly like PlanCraftAI to help you with?", true, ["Planning", "Reminders", "Planning + reminders", "AI task breakdown", "Team coordination", "Other"]),
      field("usage_level", "Usage level", "select", "How often do you expect to use PlanCraftAI?", true, ["Occasional", "Regularly", "Every day"]),
    ];
  }
  if (intent === "enrollment") {
    return [
      field("child_age", "Child’s age", "number", "How old is your child?"),
      field("ability", "Swimming ability", "select", "How comfortable is your child in the water?", true, ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]),
      field("goal", "Lesson goal", "select", "What would you like your child to work toward?", true, ["Learn to swim", "Water safety", "Improve technique", "Have fun"]),
      field("location", "Location or ZIP code", "text", "What location or ZIP code should I use to find classes?"),
      field("preferred_days", "Preferred days", "text", "Which days usually work best?"),
    ];
  }
  if (intent === "business_fit") {
    const businessType = naturalBusinessType(context);
    return [
      field("business_type", "Business type", "select", `What kind of ${businessType} do you run?`, true, ["Small salon", "Salon", "Barbershop", "Spa", "Beauty studio", "Other"]),
      field("main_goal", "Main goal", "select", "What are you mainly trying to improve?", true, ["Online booking", "Online booking + reminders", "Client management", "Reminders", "Staff management", "Payments", "Reviews / loyalty", "More bookings"]),
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

function naturalBusinessType(context: WorkflowGenerationContext): string {
  const raw = context.businessContext?.businessType?.trim() || "";
  const evidence = `${raw} ${context.businessContext?.businessName ?? ""} ${context.businessContext?.summary ?? ""}`;
  if (/salon|beauty|spa|barber/i.test(evidence)) return "salon or beauty business";
  if (!raw || /^unknown$|local[_ -]?business/i.test(raw)) return "business";
  return raw.toLowerCase();
}

function planSelectionSteps(): WorkflowStepDraft[] {
  return [
    capture("usage-type", "Usage type", "usage_type", "Are you planning to use PlanCraftAI by yourself or with a team?", ["Solo", "Team"]),
    capture("main-goal", "Main goal", "main_goal", "What would you mainly like PlanCraftAI to help you with?", ["Planning", "Reminders", "Planning + reminders", "AI task breakdown", "Team coordination", "Other"]),
    capture("usage-level", "Usage level", "usage_level", "How often do you expect to use PlanCraftAI?", ["Occasional", "Regularly", "Every day"]),
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
      type: "ask",
      label: "Show verified pricing",
      question: "Here is the current verified pricing for the recommended plan.",
      config: { ...interruptionConfig, reviewStatus: "verified", messageType: "verified_pricing", dataSource: "verified_business_knowledge", requiresVerifiedData: true },
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
    capture("child-age", "Child’s age", "child_age", "How old is your child?"),
    capture("swimming-ability", "Swimming ability", "ability", "How comfortable is your child in the water?", ["Not comfortable in water", "Beginner", "Can swim with help", "Can swim independently"]),
    capture("lesson-goal", "Lesson goal", "goal", "What would you like your child to work toward?", ["Learn to swim", "Water safety", "Improve technique", "Have fun"]),
    capture("location", "Location or ZIP code", "location", "What location or ZIP code should I use to find classes?"),
    capture("preferred-days", "Preferred days", "preferred_days", "Which days usually work best?"),
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
        programField: "goal",
        locationField: "location",
        dayField: "preferred_days",
        searchFields: "child_age, ability, goal, location, preferred_days",
        includeWaitlist: true,
        failureBehavior: "handoff",
      },
    },
    {
      id: "show-options",
      type: "recommend",
      label: "Show available class options and pricing",
      question: "Here are the available classes and current pricing that best match those details.",
      config: { ...interruptionConfig, maxResults: "3", showPricing: true },
    },
    {
      id: "choose-class",
      type: "confirm",
      label: "Confirm a class",
      question: "Which class would you like to continue with?",
      required: true,
      config: { ...interruptionConfig },
    },
    {
      id: "registration-link",
      type: "generate_link",
      label: "Generate registration link",
      config: { ...interruptionConfig, provider: "jackrabbit", failureBehavior: "handoff" },
    },
    {
      id: "enrollment-complete",
      type: "complete",
      label: "Continue registration",
      question: "Your registration link is ready.",
      config: { ...interruptionConfig, buttonLabel: "Continue registration" },
    },
  ];
}

function businessFitSteps(context: WorkflowGenerationContext): WorkflowStepDraft[] {
  const business = context.businessContext;
  const businessName = canonicalBusinessName(context);
  const businessType = naturalBusinessType(context);
  const primaryCta = business?.discoveredCtas?.find((cta) => cta.url && /try|demo|book|start/i.test(`${cta.label} ${cta.url}`))
    ?? business?.discoveredCtas?.find((cta) => Boolean(cta.url));
  const primaryLabel = primaryCta?.label?.trim() || "Try the demo";
  const requestDemoAction = business?.approvedActions?.find((action) => action.actionType === "request_demo" || /request.?demo/i.test(`${action.key} ${action.name}`));
  const hasRequestDemoAction = Boolean(requestDemoAction || business?.discoveredCtas?.some((cta) => /request.?demo/i.test(cta.label)));
  const primaryAction = business?.approvedActions?.find((action) => action.key === "try_demo")
    ?? business?.approvedActions?.find((action) => !/request.?demo/i.test(`${action.key} ${action.name}`) && /try|start|see|view|demo|trial/i.test(`${action.key} ${action.name}`));
  return [
    capture("business-type", "Business type", "business_type", `What kind of ${businessType} do you run?`, ["Salon", "Barbershop", "Spa", "Beauty studio", "Other"]),
    capture("main-goal", "Main goal", "main_goal", "What are you mainly trying to improve?", ["Online booking", "Client management", "Reminders", "Staff management", "Payments", "Reviews / loyalty", "More bookings"]),
    {
      id: "relevant-capabilities",
      type: "recommend",
      label: "Relevant capabilities",
      question: `Match verified ${businessName} features to the visitor’s needs.`,
      config: { ...interruptionConfig, reviewStatus: "verified", dataSource: "verified_business_knowledge", requiresVerifiedData: true, basedOn: ["business_type", "main_goal"] },
    },
    {
      id: "fit-explanation",
      type: "ask",
      label: "Fit explanation",
      question: `Briefly explain why ${businessName} may be a good fit based on the visitor’s needs.`,
      config: { ...interruptionConfig, reviewStatus: "suggested", messageType: "fit_explanation", dataSource: "verified_business_knowledge" },
    },
    {
      id: "pricing",
      type: "ask",
      label: "Pricing",
      question: "Show only verified pricing when it is relevant to the visitor’s question.",
      config: { ...interruptionConfig, reviewStatus: business?.pricing?.verified ? "verified" : "needs_owner_confirmation", messageType: "verified_pricing", dataSource: "verified_business_knowledge", requiresVerifiedData: true },
    },
    {
      id: "try-demo",
      type: "redirect",
      label: primaryLabel,
      question: `Ready to see how ${businessName} can help?`,
      config: { ...interruptionConfig, buttonLabel: primaryLabel, destinationSource: "approved_action", normalConversionEndpoint: true, ...(primaryAction?.key ? { actionKey: primaryAction.key } : {}), ...(primaryCta?.url ? { destinationUrl: primaryCta.url } : {}) },
    },
    ...(hasRequestDemoAction ? [{
      id: "request-demo",
      type: "redirect",
      label: "Request a demo",
      question: "If you would like the team to walk you through it, request a demo.",
      config: { ...interruptionConfig, buttonLabel: "Request a demo", destinationSource: "approved_action", explicitRequestOnly: true, conditional: true, trigger: "explicit_guided_demo_request", ...(requestDemoAction?.key ? { actionKey: requestDemoAction.key } : {}) },
    } satisfies WorkflowStepDraft] : []),
    {
      id: "support-handoff",
      type: "handoff",
      label: "Support / handoff",
      question: "If you need account help or a person, I’ll connect you with the team.",
      config: { ...interruptionConfig, trigger: "explicit_support_or_human_request", conditional: true, failureBehavior: "handoff" },
    },
  ];
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
  if (context.businessContext && /good fit|relevant capabilit|business type|try the demo|primary conversion|salon|beauty/i.test(ownerGoal)) return "business_fit";
  if (/\b(plan|plans|pricing|solo|team|usage|recommend|right fit|best fit)\b/.test(ownerGoal)
    && !/swim|lesson|child|student|jackrabbit/.test(ownerGoal)) return "plan_selection";
  if (/swim|lesson|child|student|jackrabbit|class/.test(ownerGoal)) return "enrollment";
  if (/tour|visit/.test(ownerGoal)) return "tour";
  if (/quote|estimate/.test(ownerGoal)) return "quote";
  if (/support|service|issue|repair/.test(ownerGoal)) return "service";
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
  const steps = intent === "plan_selection"
    ? planSelectionSteps()
    : intent === "enrollment"
      ? enrollmentSteps()
      : intent === "business_fit"
        ? businessFitSteps(context)
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
  const pricingVerified = context.businessContext?.pricing?.verified === true;
  const providers = context.availableProviders !== undefined
    ? context.availableProviders.map((provider) => provider.toLowerCase())
    : context.businessContext?.providers?.map((provider) => provider.value.toLowerCase()) ?? [];
  const normalizedDescription = description;
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
    const optionsStep = steps.find((step) => step.id === "show-options");
    if (optionsStep) {
      optionsStep.config = {
        ...(optionsStep.config ?? {}),
        reviewStatus: providers.includes("jackrabbit") ? "provider_backed" : "suggested",
        ...(providers.includes("jackrabbit") ? {} : { reviewReason: "Connect Jackrabbit before presenting live class options." }),
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
    ? businessName ? `Choose the right ${businessName} plan` : "Choose the right plan"
    : intent === "enrollment"
      ? "Find the right swim lesson"
      : intent === "business_fit"
        ? businessName ? `Help visitors find the right ${businessName} fit` : "Help visitors find the right fit"
      : context.actionName ?? "Workflow";
  return {
    intent,
    name: defaultName,
    description: normalizedDescription,
    steps,
    // Business-fit journeys are rebuilt from the active Business Brain. Do not
    // merge fields from the previous draft because that is the exact path by
    // which a previous tenant's qualification questions can survive a switch.
    fields: mergeFields(intent === "business_fit" ? [] : baseFields, generated),
    ...(intent === "enrollment" ? { executionMode: "PROVIDER_FLOW", provider: "jackrabbit" } : {}),
  };
}

export function templateSteps(key: string): WorkflowStepDraft[] {
  return generateWorkflow(key === "enrollment" ? "Help parents find the right swim lesson for their child" : key, [], { actionName: key }).steps;
}
