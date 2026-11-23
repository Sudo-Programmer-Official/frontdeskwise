import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  createActionState,
  defaultActionFlows,
  detectAction,
  type ActionField,
  type ActionFlow,
  type ConversationActionState,
} from "./action-flows.js";
import { decideConversationRoute } from "./conversation-orchestrator.js";
import {
  buildConversationRuntimeState,
  assertConversationRuntimeState,
  type ConversationRuntimeState,
  type RuntimeHandoffState,
  type RuntimeRoute,
} from "./conversation-runtime.js";
import { primaryCtaForAction, type PrimaryCta } from "./conversion-goals.js";
import { recommendPlan, type VerifiedPlanFact } from "./workflow-plan.js";
import {
  applyWorkflowValues,
  currentWorkflowStep,
  extractWorkflowValues,
  replayWorkflowTurn,
  resumeWorkflowInterruption,
  transitionWorkflow,
  workflowFormFields,
  workflowNextBestAction,
  workflowSummary,
} from "./workflow-engine.js";
import { verifyWorkflowDefinition, type WorkflowVerificationResult } from "./workflow-verifier.js";

export type ReferenceResponseClass =
  | "workflow_prompt"
  | "knowledge_answer"
  | "recommendation"
  | "provider_result"
  | "cta"
  | "handoff_requested"
  | "handoff_waiting";

export type ReferenceTurn = {
  id: string;
  message: string;
  expected: {
    route: RuntimeRoute;
    extractedFields: string[];
    stateBefore?: { workflowCursor?: string | null; handoffState?: RuntimeHandoffState };
    stateAfter: { workflowCursor?: string | null; values?: Record<string, string | null> };
    providerCall: { provider: string; operation: string; status: string } | null;
    nextBestAction: string | null;
    cta: string | null;
    handoffState: RuntimeHandoffState;
    responseClass: ReferenceResponseClass;
  };
};

type ReferenceBusiness = {
  key: string;
  name: string;
  businessId: string;
  contextVersion: number;
  actions: ActionFlow[];
  workflow: ActionFlow;
  primaryAction: ActionFlow;
  planFacts?: VerifiedPlanFact[];
};

type ReferenceState = {
  action: ActionFlow | null;
  state: ConversationActionState | null;
  handoffState: RuntimeHandoffState;
  providerCall: { provider: string; operation: string; status: string } | null;
  cta: PrimaryCta | null;
};

type ReferenceTurnResult = {
  id: string;
  message: string;
  route: RuntimeRoute;
  extractedFields: string[];
  stateBefore: ConversationRuntimeState;
  stateAfter: ConversationRuntimeState;
  providerCall: ReferenceState["providerCall"];
  nextBestAction: string | null;
  cta: string | null;
  handoffState: RuntimeHandoffState;
  responseClass: ReferenceResponseClass;
  process: { pass: boolean; failures: string[] };
  outcome: { pass: boolean; failures: string[] };
  pass: boolean;
  mismatches: string[];
};

type ReferenceBusinessReport = {
  key: string;
  name: string;
  pass: boolean;
  workflowVerification: WorkflowVerificationResult;
  processPassRate: number;
  outcomePassRate: number;
  turns: ReferenceTurnResult[];
};

type ReferenceFixture = { businesses: Array<{ key: string; turns: ReferenceTurn[] }> };

const stableDate = "2026-01-01T00:00:00.000Z";

function field(key: string, label: string, type: ActionField["type"], question: string, required = true, options?: string[]): ActionField {
  return { id: key, key, label, type, required, visibility: "visible", question, ...(options ? { options } : {}) };
}

function action(input: {
  id: string;
  key: string;
  name: string;
  actionType: ActionFlow["actionType"];
  fields?: ActionField[];
  steps?: ActionFlow["steps"];
  executionMode?: ActionFlow["executionMode"];
  provider?: string | null;
  url?: string;
  label?: string;
  triggerPhrases?: string[];
  triggerIntents?: string[];
}): ActionFlow {
  const fields = input.fields ?? [];
  return {
    id: input.id,
    key: input.key,
    actionType: input.actionType,
    name: input.name,
    description: input.name,
    triggerPhrases: input.triggerPhrases ?? [input.name],
    triggerIntents: input.triggerIntents ?? ["general"],
    captureMode: "conversational",
    fields,
    ...(input.steps ? { steps: input.steps } : {}),
    completion: {
      createLead: input.executionMode !== "DIRECT_LINK",
      leadStatus: "qualified",
      message: "The next step is ready.",
      notifyStaff: false,
      linkUrl: input.url,
      linkLabel: input.label,
    },
    mode: "transactional",
    executionMode: input.executionMode ?? "FORM_FLOW",
    trackingKey: input.key,
    destination: input.url ? { url: input.url, label: input.label } : null,
    provider: input.provider ?? null,
    priority: 10,
    requiredFields: fields.filter((candidate) => candidate.required).map((candidate) => candidate.key),
    optionalFields: fields.filter((candidate) => !candidate.required).map((candidate) => candidate.key),
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: null,
    sourceType: "manual",
    sourceLabel: "Reference certification",
    classificationReason: "reference_business",
    discoveredAt: null,
    origin: "configured",
    lifecycleStatus: "active",
    reviewReason: null,
    evidence: [],
    confidence: 1,
    enabled: true,
    readiness: { ready: true, reason: "ready" },
    version: 1,
    createdAt: stableDate,
    updatedAt: stableDate,
  };
}

function salonFlow(): ReferenceBusiness {
  const tryDemo = action({ id: "salon-try-demo", key: "try_demo", name: "Try the SalonFlow demo", actionType: "open_link", executionMode: "DIRECT_LINK", url: "https://salonflow.example/demo", label: "Try the demo", triggerPhrases: ["try the demo"] });
  const requestDemo = action({ id: "salon-request-demo", key: "request_demo", name: "Request a SalonFlow demo", actionType: "request_demo", executionMode: "DIRECT_LINK", url: "https://salonflow.example/request-demo", label: "Request a demo", triggerPhrases: ["request a demo", "guided demo"] });
  const workflow = action({
    id: "salon-fit-workflow",
    key: "salon_fit",
    name: "SalonFlow fit",
    actionType: "request_demo",
    fields: [
      field("business_type", "Business type", "select", "What kind of salon or beauty business do you run?", true, ["Small salon", "Salon", "Barbershop", "Spa", "Beauty studio"]),
      field("main_goal", "Main goal", "multi_select", "What are you mainly trying to improve?", true, ["Online booking", "Online booking + reminders", "Client management", "Reminders", "Staff management", "Payments", "Reviews / loyalty", "More bookings"]),
    ],
    steps: [
      { id: "business-type", type: "capture", fieldKey: "business_type", question: "What kind of salon or beauty business do you run?" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal", question: "What are you mainly trying to improve?" },
      { id: "capabilities", type: "recommend", label: "Relevant capabilities", config: { reviewStatus: "verified" } },
      { id: "pricing", type: "knowledge", label: "Pricing", question: "Answer naturally from verified business knowledge.", config: { conditional: true, topic: "pricing", knowledgeSource: "verified_business_knowledge", allowedFacts: "pricing", verifiedBehavior: "answer_naturally", unavailableBehavior: "say_not_verified", resumeBehavior: "return_to_previous_step", ctaBehavior: "keep_current_if_available", reviewStatus: "verified", requiresVerifiedData: true } },
      { id: "try-demo", type: "redirect", label: "Try the demo", config: { actionKey: "try_demo", buttonLabel: "Try the demo", normalConversionEndpoint: true } },
      { id: "request-demo", type: "redirect", label: "Request a demo", config: { actionKey: "request_demo", buttonLabel: "Request a demo", trigger: "explicit_guided_demo_request", conditional: true } },
      { id: "support-handoff", type: "handoff", label: "Support / handoff", config: { trigger: "explicit_support_or_human_request", conditional: true } },
    ],
    triggerPhrases: ["I run a salon", "help me choose SalonFlow"],
    triggerIntents: ["general", "lead"],
  });
  return {
    key: "salonflow",
    name: "SalonFlow",
    businessId: "reference-salonflow",
    contextVersion: 11,
    actions: [workflow, tryDemo, requestDemo],
    workflow,
    primaryAction: tryDemo,
  };
}

function planFlow(): ReferenceBusiness {
  const signup = action({ id: "plancraft-signup", key: "signup", name: "Start PlanCraftAI", actionType: "open_link", executionMode: "DIRECT_LINK", url: "https://plancraft.example/signup", label: "Start PlanCraftAI", triggerPhrases: ["sign up"] });
  const workflow = action({
    id: "plancraft-plan-workflow",
    key: "plan_selection",
    name: "Choose a PlanCraftAI plan",
    actionType: "request_demo",
    fields: [
      field("usage_type", "Usage type", "select", "Will you use PlanCraftAI by yourself or with a team?", true, ["Solo", "Team"]),
      field("main_goal", "Main goal", "select", "What would you mainly like PlanCraftAI to help with?", true, ["Planning", "Reminders", "Planning + reminders", "Team coordination"]),
      field("usage_level", "Usage level", "select", "How often will you use PlanCraftAI?", true, ["Occasionally", "Regularly", "Daily"]),
      field("recommended_plan", "Recommended plan", "text", "", false),
    ],
    steps: [
      { id: "usage-type", type: "capture", fieldKey: "usage_type", question: "Will you use PlanCraftAI by yourself or with a team?" },
      { id: "main-goal", type: "capture", fieldKey: "main_goal", question: "What would you mainly like PlanCraftAI to help with?" },
      { id: "usage-level", type: "capture", fieldKey: "usage_level", question: "How often will you use PlanCraftAI?" },
      { id: "recommend-plan", type: "recommend", label: "Recommend the best plan", config: { recommendationType: "plan", reviewStatus: "verified" } },
      { id: "explain-plan", type: "ask", label: "Explain the recommendation", question: "This plan matches your goals and usage." },
      { id: "show-pricing", type: "ask", label: "Show verified pricing", question: "Here is the current verified pricing." },
      { id: "get-started", type: "redirect", label: "Get started", config: { actionKey: "signup", buttonLabel: "Start PlanCraftAI", normalConversionEndpoint: true } },
    ],
    triggerPhrases: ["choose a plan", "help me choose the right plan"],
    triggerIntents: ["plan_selection"],
  });
  return {
    key: "plancraftai",
    name: "PlanCraftAI",
    businessId: "reference-plancraftai",
    contextVersion: 12,
    actions: [workflow, signup],
    workflow,
    primaryAction: signup,
    planFacts: [
      { subject: "PlanCraftAI", predicate: "plan price", valueText: "Free — $0", verified: true },
      { subject: "PlanCraftAI", predicate: "plan price", valueText: "Solo Premium — $5/month", verified: true },
      { subject: "PlanCraftAI", predicate: "plan price", valueText: "Team Pro — $20/month for teams", verified: true },
    ],
  };
}

function swimFlow(): ReferenceBusiness {
  const workflow = defaultActionFlows("British Swim School", "swim lessons and enrollment", (key) => `reference-swim-${key}`).find((candidate) => candidate.key === "enroll_child");
  if (!workflow) throw new Error("reference_swim_workflow_missing");
  return {
    key: "british-swim-school",
    name: "British Swim School",
    businessId: "reference-british-swim-school",
    contextVersion: 13,
    actions: [workflow],
    workflow,
    primaryAction: workflow,
  };
}

export function referenceBusinesses(): ReferenceBusiness[] {
  return [salonFlow(), planFlow(), swimFlow()];
}

function cloneState(state: ConversationActionState | null): ConversationActionState | null {
  return state ? JSON.parse(JSON.stringify(state)) as ConversationActionState : null;
}

function ctaForStep(business: ReferenceBusiness, step: NonNullable<ReturnType<typeof currentWorkflowStep>>): PrimaryCta | null {
  if (step.type !== "redirect") return null;
  const key = typeof step.config?.actionKey === "string" ? step.config.actionKey : business.primaryAction.key;
  const target = business.actions.find((candidate) => candidate.key === key);
  if (!target) return null;
  const cta = primaryCtaForAction(target);
  const label = typeof step.config?.buttonLabel === "string" ? step.config.buttonLabel : cta?.label;
  return cta && label ? { ...cta, label } : cta;
}

function valuesMatch(actual: Record<string, string>, expected: Record<string, string | null> | undefined): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => (actual[key] ?? null) === value);
}

function stateProjection(state: ConversationActionState | null): ConversationActionState | null {
  return cloneState(state);
}

function advanceSyntheticSteps(business: ReferenceBusiness, state: ConversationActionState, message: string): { providerCall: ReferenceState["providerCall"]; cta: PrimaryCta | null; responseClass: ReferenceResponseClass } {
  let providerCall: ReferenceState["providerCall"] = null;
  let cta: PrimaryCta | null = null;
  let responseClass: ReferenceResponseClass = "workflow_prompt";
  let step = currentWorkflowStep(business.workflow, state);
  if (!step) return { providerCall, cta, responseClass };

  // The API shows a form as one workflow step. A certification turn that
  // supplies every required form value advances the same cursor before any
  // provider call is made.
  if (step.type === "form" && workflowFormFields(business.workflow, state).length === 0) {
    transitionWorkflow(business.workflow, state, step.id);
    step = currentWorkflowStep(business.workflow, state);
  }

  if (step?.type === "recommend" && !step.config?.sourceStepId) {
    const recommendation = business.planFacts
      ? recommendPlan(state.values, business.planFacts)
      : { plan: "Relevant capabilities", price: null, usageType: "", usageLevel: "", reason: "Verified capabilities match the stated business goals." };
    if (recommendation) {
      state.values.recommended_plan = recommendation.plan;
      state.lookupResults = { ...(state.lookupResults ?? {}), [step.id]: { status: "matched", recommendation } };
      transitionWorkflow(business.workflow, state, step.id);
      responseClass = business.planFacts ? "recommendation" : "workflow_prompt";
      step = currentWorkflowStep(business.workflow, state);
    }
  }

  // Plan recommendations are presented together with verified pricing and the
  // allowed signup CTA, matching the production PlanCraftAI path.
  if (business.planFacts && step?.id === "explain-plan") {
    transitionWorkflow(business.workflow, state, step.id);
    const pricing = currentWorkflowStep(business.workflow, state);
    if (pricing?.id === "show-pricing") transitionWorkflow(business.workflow, state, pricing.id);
    step = currentWorkflowStep(business.workflow, state);
  }

  if (step?.type === "lookup") {
    state.lookupResults = {
      ...(state.lookupResults ?? {}),
      [step.id]: { status: "matched", matches: [{ id: "reference-class-1", name: "Turtle 2", location: state.values.location ?? "Largo", day: state.values.schedule_preference ?? "Saturday" }] },
    };
    providerCall = { provider: typeof step.config?.provider === "string" ? step.config.provider : "unknown", operation: typeof step.config?.operation === "string" ? step.config.operation : "lookup", status: "succeeded" };
    transitionWorkflow(business.workflow, state, step.id);
    step = currentWorkflowStep(business.workflow, state);
    responseClass = "provider_result";
  }

  if (step?.type === "recommend" || step?.type === "select") {
    const resolution = Object.values(state.lookupResults ?? {}).find((value) => value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).matches)) as { matches?: Array<{ id: string }> } | undefined;
    const selectedIndex = /^(?:option\s*)?(\d+)\s*(?:,?\s*(?:please|thanks?))?$/i.exec(message.trim())
      ?? /\boption\s*(\d+)\b/i.exec(message.trim());
    if (resolution?.matches?.length && selectedIndex) {
      const selected = resolution.matches[Number(selectedIndex[1]) - 1];
      if (selected) {
        state.selectedActionResourceId = selected.id;
        transitionWorkflow(business.workflow, state, step.id);
        const selectionStep = currentWorkflowStep(business.workflow, state);
        if (step.type === "recommend" && selectionStep?.type === "select") transitionWorkflow(business.workflow, state, selectionStep.id);
        step = currentWorkflowStep(business.workflow, state);
        while (step?.type === "form" && workflowFormFields(business.workflow, state).length === 0) {
          transitionWorkflow(business.workflow, state, step.id);
          step = currentWorkflowStep(business.workflow, state);
        }
      }
    }
  }

  // Lead persistence is a non-interactive workflow capability. Once the
  // contact form has supplied a recoverable identity, the certification
  // runtime should advance through it before handling the next confirmation
  // or registration step, just like the production runtime does.
  while (step?.type === "create_lead") {
    transitionWorkflow(business.workflow, state, step.id);
    step = currentWorkflowStep(business.workflow, state);
  }

  if (step?.type === "confirm") {
    if (/^(yes|y|sure|ok|okay|please|continue|do it|go ahead|option\s*1)\b/i.test(message.trim()) || /option\s*1/i.test(message)) {
      state.selectedActionResourceId = "reference-class-1";
      transitionWorkflow(business.workflow, state, step.id);
      step = currentWorkflowStep(business.workflow, state);
    }
  }

  if (step?.type === "generate_link") {
    state.completionUrl = "https://register.example/start?classId=reference-class-1";
    transitionWorkflow(business.workflow, state, step.id);
    cta = {
      actionId: business.workflow.id,
      key: business.workflow.key,
      label: "Continue registration",
      executionMode: "PROVIDER_FLOW",
      trackingKey: business.workflow.trackingKey ?? business.workflow.key,
      url: state.completionUrl,
    };
    responseClass = "cta";
    step = currentWorkflowStep(business.workflow, state);
  }

  if (step?.type === "complete") {
    transitionWorkflow(business.workflow, state, step.id);
  }

  if (step?.type === "redirect") {
    cta = ctaForStep(business, step);
    responseClass = cta && responseClass !== "recommendation" ? "cta" : responseClass;
  }
  return { providerCall, cta, responseClass };
}

function compareTurn(expected: ReferenceTurn["expected"], actual: ReferenceTurnResult): { process: string[]; outcome: string[] } {
  const process: string[] = [];
  const outcome: string[] = [];
  if (expected.route !== actual.route) process.push(`route expected ${expected.route} got ${actual.route}`);
  if (JSON.stringify(expected.extractedFields) !== JSON.stringify(actual.extractedFields)) process.push(`fields expected ${JSON.stringify(expected.extractedFields)} got ${JSON.stringify(actual.extractedFields)}`);
  if (expected.stateBefore?.workflowCursor !== undefined && expected.stateBefore.workflowCursor !== actual.stateBefore.workflowCursor) process.push(`stateBefore.cursor expected ${expected.stateBefore.workflowCursor} got ${actual.stateBefore.workflowCursor}`);
  if (expected.stateBefore?.handoffState !== undefined && expected.stateBefore.handoffState !== actual.stateBefore.handoffState) process.push(`stateBefore.handoff expected ${expected.stateBefore.handoffState} got ${actual.stateBefore.handoffState}`);
  if (expected.nextBestAction !== actual.nextBestAction) process.push(`nextBestAction expected ${expected.nextBestAction} got ${actual.nextBestAction}`);
  if (expected.stateAfter.workflowCursor !== undefined && expected.stateAfter.workflowCursor !== actual.stateAfter.workflowCursor) outcome.push(`stateAfter.cursor expected ${expected.stateAfter.workflowCursor} got ${actual.stateAfter.workflowCursor}`);
  if (!valuesMatch(actual.stateAfter.collectedFields, expected.stateAfter.values)) outcome.push("stateAfter.values mismatch");
  if (JSON.stringify(expected.providerCall) !== JSON.stringify(actual.providerCall)) outcome.push(`provider expected ${JSON.stringify(expected.providerCall)} got ${JSON.stringify(actual.providerCall)}`);
  if (expected.cta !== actual.cta) outcome.push(`cta expected ${expected.cta} got ${actual.cta}`);
  if (expected.handoffState !== actual.handoffState) outcome.push(`handoff expected ${expected.handoffState} got ${actual.handoffState}`);
  if (expected.responseClass !== actual.responseClass) outcome.push(`responseClass expected ${expected.responseClass} got ${actual.responseClass}`);
  return { process, outcome };
}

export function runReferenceTurn(business: ReferenceBusiness, prior: ReferenceState, turn: ReferenceTurn): { state: ReferenceState; result: ReferenceTurnResult } {
  const stateBefore = buildConversationRuntimeState({
    businessId: business.businessId,
    conversationId: `reference-${business.key}`,
    businessContextVersion: business.contextVersion,
    handoffState: prior.handoffState,
    action: prior.action,
    actionState: prior.state,
    allowedCtas: prior.cta ? [prior.cta] : [],
  });
  let actionState = prior.state;
  let activeAction = prior.action;
  let handoffState = prior.handoffState;
  let providerCall: ReferenceState["providerCall"] = null;
  let cta: PrimaryCta | null = null;
  let responseClass: ReferenceResponseClass = "workflow_prompt";
  let route: RuntimeRoute;
  let extractedFields: string[] = [];

  const orchestration = decideConversationRoute({ message: turn.message, activeAction, actionState, handoffState });
  route = orchestration.route;
  if (handoffState === "HUMAN_ACTIVE" || handoffState === "AI_ASSISTED") {
    responseClass = "handoff_waiting";
  } else if (route === "HUMAN_HANDOFF") {
    handoffState = "WAITING_FOR_STAFF";
    responseClass = "handoff_requested";
  } else if (route === "INTERRUPTION") {
    if (actionState) {
      actionState = cloneState(actionState);
      const current = currentWorkflowStep(activeAction!, actionState!);
      actionState!.interruptionStack = [...(actionState!.interruptionStack ?? []), { intent: orchestration.interruptionIntent ?? "general", question: turn.message, returnStepId: current?.id ?? actionState!.currentStepId ?? null, startedAt: stableDate }];
    }
    responseClass = "knowledge_answer";
  } else {
    if (!activeAction || !actionState || actionState.status === "completed") {
      const detected = detectAction(business.actions, turn.message);
      if (detected) {
        activeAction = detected;
        actionState = createActionState(detected, stableDate);
      }
    }
    if (activeAction && actionState?.status === "active" && activeAction.steps?.length) {
      const guidedDemo = /\b(guided|live|team|request|book|schedule|talk to|walk me through)\b.{0,36}\bdemo\b|\bdemo\b.{0,36}\b(guided|live|team|request|book|schedule|talk to|walk me through)\b/i.test(turn.message);
      const guidedDemoStep = activeAction.steps.find((step) => step.config?.trigger === "explicit_guided_demo_request");
      if (guidedDemo && guidedDemoStep) {
        actionState = cloneState(actionState);
        actionState!.workflowTrigger = "explicit_guided_demo_request";
        actionState!.currentStepId = guidedDemoStep.id;
      }
      const replay = replayWorkflowTurn(activeAction, actionState!, turn.message);
      actionState = replay.stateAfter;
      extractedFields = replay.updated;
      if (actionState.interruptionStack?.length) resumeWorkflowInterruption(actionState);
      const advanced = advanceSyntheticSteps(business, actionState, turn.message);
      providerCall = advanced.providerCall;
      cta = advanced.cta;
      responseClass = advanced.responseClass;
    } else if (activeAction) {
      cta = primaryCtaForAction(activeAction);
      responseClass = cta ? "cta" : "workflow_prompt";
    } else {
      responseClass = "knowledge_answer";
    }
  }

  const stateAfter = buildConversationRuntimeState({
    businessId: business.businessId,
    conversationId: `reference-${business.key}`,
    businessContextVersion: business.contextVersion,
    handoffState,
    action: activeAction,
    actionState,
    providerResult: providerCall ? { status: providerCall.status } : null,
    allowedCtas: cta ? [cta] : [],
  });
  assertConversationRuntimeState(stateBefore);
  assertConversationRuntimeState(stateAfter);
  const actual: ReferenceTurnResult = {
    id: turn.id,
    message: turn.message,
    route,
    extractedFields,
    stateBefore,
    stateAfter,
    providerCall,
    nextBestAction: stateAfter.nextBestAction,
    cta: cta?.key ?? null,
    handoffState,
    responseClass,
    process: { pass: false, failures: [] },
    outcome: { pass: false, failures: [] },
    pass: false,
    mismatches: [],
  };
  const checks = compareTurn(turn.expected, actual);
  actual.process = { pass: checks.process.length === 0, failures: checks.process };
  actual.outcome = { pass: checks.outcome.length === 0, failures: checks.outcome };
  actual.mismatches = [...checks.process, ...checks.outcome];
  actual.pass = actual.mismatches.length === 0;
  return { state: { action: activeAction, state: actionState, handoffState, providerCall, cta }, result: actual };
}

export async function loadReferenceFixture(): Promise<ReferenceFixture> {
  const raw = await readFile(new URL("../test/fixtures/reference-certification.json", import.meta.url), "utf8");
  return JSON.parse(raw) as ReferenceFixture;
}

export async function runReferenceCertification(fixture?: ReferenceFixture) {
  const loaded = fixture ?? await loadReferenceFixture();
  const businesses = new Map(referenceBusinesses().map((business) => [business.key, business]));
  const reports: ReferenceBusinessReport[] = [];
  for (const entry of loaded.businesses) {
    const business = businesses.get(entry.key);
    if (!business) throw new Error(`reference_business_missing:${entry.key}`);
    let state: ReferenceState = { action: null, state: null, handoffState: "AI_ACTIVE", providerCall: null, cta: null };
    const workflowVerification = verifyWorkflowDefinition(business.workflow);
    const turns: ReferenceTurnResult[] = [];
    for (const turn of entry.turns) {
      const next = runReferenceTurn(business, state, turn);
      state = next.state;
      turns.push(next.result);
    }
    reports.push({
      key: business.key,
      name: business.name,
      workflowVerification,
      processPassRate: turns.length ? Number((turns.filter((turn) => turn.process.pass).length / turns.length).toFixed(4)) : 0,
      outcomePassRate: turns.length ? Number((turns.filter((turn) => turn.outcome.pass).length / turns.length).toFixed(4)) : 0,
      pass: workflowVerification.ok && turns.every((turn) => turn.pass),
      turns,
    });
  }
  return { generatedAt: new Date().toISOString(), businesses: reports, pass: reports.every((business) => business.pass) };
}

async function main(): Promise<void> {
  const report = await runReferenceCertification();
  const outputDirectory = join(process.cwd(), "benchmark-results");
  await mkdir(outputDirectory, { recursive: true });
  const outputPath = join(outputDirectory, `reference-certification-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, pass: report.pass, businesses: report.businesses.map((business) => ({ key: business.key, pass: business.pass, turns: business.turns.length })) }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("reference-certification.ts")) void main();
