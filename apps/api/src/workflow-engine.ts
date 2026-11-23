import {
  actionProviderForFlow,
  validateFieldValue,
  type ActionField,
  type ActionFlow,
  type ActionInterruption,
  type ActionParticipant,
  type ActionStep,
  type ConversationActionState,
} from "./action-flows.js";

export type WorkflowTransition = {
  step: ActionStep | null;
  state: ConversationActionState;
};

export type WorkflowStepStatus = "completed" | "current" | "pending" | "skipped";

export type WorkflowNextBestAction =
  | "ASK_FIELD"
  | "ANSWER_KNOWLEDGE"
  | "ASSESS_ABILITY"
  | "CAPTURE_DETAILS"
  | "LOOKUP_CLASSES"
  | "LOOKUP_OPTIONS"
  | "RECOMMEND_OPTION"
  | "SELECT_OPTION"
  | "CONFIRM_SELECTION"
  | "GENERATE_REGISTRATION_LINK"
  | "CAPTURE_CONTACT"
  | "BOOK"
  | "NOTIFY_STAFF"
  | "HANDOFF"
  | "CONTINUE_WORKFLOW"
  | "COMPLETED";

export type WorkflowSummary = {
  key: string;
  name: string;
  status: ConversationActionState["status"];
  currentStepId: string | null;
  currentState: string | null;
  nextBestAction: WorkflowNextBestAction;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  provider: string | null;
  missing: string[];
  collected: Record<string, string>;
  interruptions: number;
  steps: Array<{
    id: string;
    label: string;
    fieldKey: string | null;
    status: WorkflowStepStatus;
  }>;
};

function normalized(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizedPhrase(value: unknown): string {
  return normalized(value).replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function valueForPath(values: Record<string, unknown>, path: string): unknown {
  if (path in values) return values[path];
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) return (current as Record<string, unknown>)[key];
    return undefined;
  }, values);
}

export function workflowField(action: ActionFlow, fieldKey: string | undefined): ActionField | null {
  if (!fieldKey) return null;
  return action.fields.find((field) => field.key === fieldKey || field.id === fieldKey) ?? null;
}

export function conditionMatches(condition: { field: string; equals?: string; notEquals?: string }, values: Record<string, unknown>): boolean {
  const current = normalized(valueForPath(values, condition.field));
  if (condition.equals !== undefined) return current === normalized(condition.equals);
  if (condition.notEquals !== undefined) return current !== normalized(condition.notEquals);
  return Boolean(current);
}

function workflowStepIsAvailable(step: ActionStep, state: ConversationActionState): boolean {
  if (step.enabled === false) return false;
  const config = step.config ?? {};
  const trigger = typeof config.trigger === "string" ? config.trigger : null;
  if (trigger && state.workflowTrigger !== trigger) return false;
  // Knowledge steps marked as conditional are side paths. They are selected
  // from the visitor's topic by the conversation runtime and must not become
  // the normal cursor just because they appear in the saved step list.
  if (step.type === "knowledge" && config.conditional === true && state.workflowTrigger !== config.topic) return false;
  // Owner-confirmed facts such as pricing must never be surfaced until the
  // business has verified them. The step remains visible in the owner editor,
  // but the runtime skips it and continues to the safe next step.
  if (config.requiresVerifiedData === true && config.reviewStatus === "needs_owner_confirmation") return false;
  if (config.requiresProviderResult === true) {
    const sourceStepId = typeof config.providerResultStepId === "string"
      ? config.providerResultStepId
      : typeof config.sourceStepId === "string" ? config.sourceStepId : null;
    const result = sourceStepId ? state.lookupResults?.[sourceStepId] : undefined;
    const matches = result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).matches)
      ? (result as Record<string, unknown>).matches as unknown[]
      : [];
    const status = result && typeof result === "object" ? (result as Record<string, unknown>).status : undefined;
    if (status !== "matched" || !matches.length) return false;
  }
  if (config.requiresSelection === true && !state.selectedActionResourceId) return false;
  if (config.requiresVerifiedProviderSelection === true) {
    const selectedId = state.selectedActionResourceId;
    const verifiedSelection = Object.values(state.lookupResults ?? {}).some((value) => {
      if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).matches)) return false;
      return ((value as Record<string, unknown>).matches as unknown[]).some((match) => match && typeof match === "object" && String((match as Record<string, unknown>).id ?? "") === selectedId);
    });
    if (!verifiedSelection) return false;
  }
  if (config.requiresCompletionUrl === true && !state.completionUrl) return false;
  return true;
}

export function workflowStep(action: ActionFlow, stepId: string | undefined): ActionStep | null {
  if (!action.steps?.length || !stepId) return null;
  return action.steps.find((step) => step.id === stepId) ?? null;
}

/**
 * Select the safest existing form when a provider-backed lookup cannot run.
 * Generated enrollment workflows already contain parent contact fields, so a
 * fallback can reuse that form without inventing provider results or adding a
 * second, provider-specific workflow shape.
 */
export function providerFallbackStep(action: ActionFlow): ActionStep | null {
  const configuredFallback = (action.steps ?? []).find((step) => {
    const fallbackStepId = step.config?.fallbackStepId;
    return step.type === "lookup"
      && typeof fallbackStepId === "string"
      && action.steps?.some((candidate) => candidate.id === fallbackStepId && ["form", "handoff", "notify", "complete"].includes(candidate.type));
  });
  const configuredFallbackId = configuredFallback?.config?.fallbackStepId;
  if (typeof configuredFallbackId === "string") {
    const explicit = action.steps?.find((step) => step.id === configuredFallbackId && ["form", "handoff", "notify", "complete"].includes(step.type));
    if (explicit) return explicit;
  }
  const forms = (action.steps ?? []).filter((step) => step.type === "form");
  return forms.find((step) => step.config?.providerFallback === true)
    ?? forms.find((step) => {
      const fieldKeys = Array.isArray(step.config?.fieldKeys)
        ? step.config.fieldKeys.filter((value): value is string => typeof value === "string")
        : [];
      return fieldKeys.some((key) => /^(?:parent_name|name|email|phone)$/i.test(key));
    })
    ?? forms[0]
    ?? null;
}

export function activateProviderFallback(
  action: ActionFlow,
  state: ConversationActionState,
  provider: string,
  reason: "unavailable" | "not_found",
): ActionStep | null {
  const fallback = providerFallbackStep(action);
  if (!fallback) return null;
  state.providerFallback = { provider, reason };
  state.currentStepId = fallback.id;
  state.formShown = true;
  return fallback;
}

function nextSequentialStep(action: ActionFlow, step: ActionStep): ActionStep | null {
  if (!action.steps?.length) return null;
  if (step.nextStepId) return workflowStep(action, step.nextStepId);
  const index = action.steps.findIndex((candidate) => candidate.id === step.id);
  return action.steps[index + 1] ?? null;
}

function nextBranchStep(action: ActionFlow, step: ActionStep, values: Record<string, unknown>): ActionStep | null {
  const branch = step.branches?.find((candidate) => conditionMatches(candidate.when, values));
  return branch ? workflowStep(action, branch.nextStepId) : nextSequentialStep(action, step);
}

/**
 * Resolves non-interactive condition/decision steps and hidden conditional
 * steps without executing side effects. Side effects are performed by the
 * API runtime after this deterministic cursor calculation.
 */
export function currentWorkflowStep(action: ActionFlow, state: ConversationActionState): ActionStep | null {
  if (!action.steps?.length || state.status === "completed") return null;
  let step: ActionStep | null = workflowStep(action, state.currentStepId) ?? action.steps[0] ?? null;
  const visited = new Set<string>();
  while (step && !visited.has(step.id)) {
    visited.add(step.id);
    // A legacy or hand-authored workflow may end on a capture step without an
    // explicit complete step. Once its cursor is exhausted, do not fall back
    // to the first step and loop forever.
    if (state.completedStepIds?.includes(step.id)) {
      step = nextBranchStep(action, step, state.values);
      continue;
    }
    if (!workflowStepIsAvailable(step, state)) {
      step = nextSequentialStep(action, step);
      continue;
    }
    if (step.condition && !conditionMatches(step.condition, state.values)) {
      step = nextSequentialStep(action, step);
      continue;
    }
    if (step.type === "condition" || step.type === "decision") {
      step = nextBranchStep(action, step, state.values);
      continue;
    }
    return step;
  }
  return null;
}

export function workflowFormFields(action: ActionFlow, state: ConversationActionState): ActionField[] {
  const step = currentWorkflowStep(action, state);
  if (!step || step.type !== "form") return [];
  const configured = step.config?.fieldKeys;
  const keys = Array.isArray(configured) ? new Set(configured.filter((value): value is string => typeof value === "string")) : null;
  return action.fields.filter((field) => {
    if (keys && !keys.has(field.key) && !keys.has(field.id)) return false;
    if (field.visibility === "hidden" || state.skipped?.includes(field.key)) return false;
    if (field.condition && !conditionMatches(field.condition, state.values)) return false;
    return !state.values[field.key]?.trim();
  });
}

function workflowStepLabel(action: ActionFlow, step: ActionStep): string {
  const field = workflowField(action, step.fieldKey);
  return field?.label ?? step.label ?? step.question ?? step.id.replace(/[-_]+/g, " ");
}

export function workflowNextBestAction(action: ActionFlow, step: ActionStep | null): WorkflowNextBestAction {
  if (!step) return "COMPLETED";
  if (step.type === "knowledge") return "ANSWER_KNOWLEDGE";
  if (step.fieldKey === "ability") return "ASSESS_ABILITY";
  if (step.type === "lookup") return actionProviderForFlow(action) ? "LOOKUP_CLASSES" : "LOOKUP_OPTIONS";
  if (step.type === "recommend") return "RECOMMEND_OPTION";
  if (step.type === "select") return "SELECT_OPTION";
  if (step.type === "confirm") return "CONFIRM_SELECTION";
  if (step.type === "generate_link") return "GENERATE_REGISTRATION_LINK";
  if (step.type === "create_lead") return "CAPTURE_CONTACT";
  if (step.type === "book") return "BOOK";
  if (step.type === "notify") return "NOTIFY_STAFF";
  if (step.type === "handoff") return "HANDOFF";
  if (step.type === "redirect") return "CONTINUE_WORKFLOW";
  if (step.type === "form") return "CAPTURE_DETAILS";
  if (step.fieldKey) return "ASK_FIELD";
  return "CAPTURE_DETAILS";
}

export function workflowSummary(action: ActionFlow, state: ConversationActionState): WorkflowSummary {
  const current = currentWorkflowStep(action, state);
  const completed = new Set(state.completedStepIds ?? []);
  const steps = (action.steps ?? []).map((step) => ({
    id: step.id,
    label: workflowStepLabel(action, step),
    fieldKey: step.fieldKey ?? null,
    status: (completed.has(step.id)
      ? "completed"
      : current?.id === step.id
        ? "current"
        : state.skipped?.includes(step.id)
          ? "skipped"
          : "pending") as WorkflowStepStatus,
  }));
  const completedSteps = steps.filter((step) => step.status === "completed").length;
  const totalSteps = steps.length;
  const currentState = current?.id ?? (state.status === "completed" ? "completed" : null);
  const missing = action.fields
    .filter((field) => field.required && field.visibility !== "hidden" && !state.skipped?.includes(field.key) && !state.values[field.key]?.trim())
    .filter((field) => !field.condition || conditionMatches(field.condition, state.values))
    .map((field) => field.key);
  return {
    key: action.key,
    name: action.name,
    status: state.status,
    currentStepId: current?.id ?? null,
    currentState,
    nextBestAction: state.status === "completed" ? "COMPLETED" : workflowNextBestAction(action, current),
    completedSteps,
    totalSteps,
    progressPercent: state.status === "completed" ? 100 : totalSteps ? Math.round((completedSteps / totalSteps) * 100) : 0,
    provider: actionProviderForFlow(action),
    missing,
    collected: { ...state.values },
    interruptions: state.interruptionStack?.length ?? 0,
    steps,
  };
}

export type WorkflowMigrationResult = {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  reason: "current" | "missing_cursor" | "removed_step" | "completed_step";
};

function cloneWorkflowState(state: ConversationActionState): ConversationActionState {
  return JSON.parse(JSON.stringify(state)) as ConversationActionState;
}

/**
 * Safely moves a persisted conversation cursor onto the current workflow
 * definition. Collected values are preserved; only an invalid or completed
 * cursor is moved to the first still-actionable step.
 */
export function migrateWorkflowState(action: ActionFlow, state: ConversationActionState): WorkflowMigrationResult {
  const toVersion = action.version ?? 1;
  const fromVersion = state.workflowVersion ?? toVersion;
  if (!action.steps?.length) return { migrated: false, fromVersion, toVersion, reason: "current" };

  const stepIds = new Set(action.steps.map((step) => step.id));
  const completed = new Set((state.completedStepIds ?? []).filter((stepId) => stepIds.has(stepId)));
  state.completedStepIds = [...completed];
  const current = state.currentStepId ? workflowStep(action, state.currentStepId) : null;
  const currentIsComplete = Boolean(state.currentStepId && completed.has(state.currentStepId));
  const currentValuePresent = Boolean(current?.fieldKey && state.values[current.fieldKey]?.trim());
  const cursorIsValid = Boolean(current && !currentIsComplete && !currentValuePresent);
  if (cursorIsValid && fromVersion === toVersion) {
    state.workflowVersion = toVersion;
    return { migrated: false, fromVersion, toVersion, reason: "current" };
  }

  const next = action.steps.find((step) => !completed.has(step.id) && !(step.fieldKey && state.values[step.fieldKey]?.trim())) ?? null;
  state.currentStepId = next?.id;
  state.workflowVersion = toVersion;
  if (!next) {
    state.status = "completed";
    state.completedAt = state.completedAt ?? new Date().toISOString();
  }
  return {
    migrated: fromVersion !== toVersion || !cursorIsValid,
    fromVersion,
    toVersion,
    reason: fromVersion !== toVersion ? "removed_step" : currentIsComplete || currentValuePresent ? "completed_step" : "missing_cursor",
  };
}

function lookupDependencyKeys(step: ActionStep): Set<string> {
  const dependencies = new Set(["customer_type", "child_age", "ability", "goal", "location", "program", "schedule_preference", "service", "preferred_date", "preferred_time", "usage_type", "main_goal", "usage_level"]);
  const config = step.config ?? {};
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith("Field") && typeof value === "string") dependencies.add(value);
    if (key === "searchFields" && typeof value === "string") value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => dependencies.add(item));
    if (key === "searchFields" && Array.isArray(value)) value.filter((item): item is string => typeof item === "string").forEach((item) => dependencies.add(item));
  }
  return dependencies;
}

/** Invalidate cached provider results when a visitor changes lookup inputs. */
export function invalidateWorkflowLookups(action: ActionFlow, state: ConversationActionState, updatedKeys: string[]): boolean {
  if (!action.steps?.length || !updatedKeys.length) return false;
  const lookupSteps = action.steps.filter((step) => ["lookup", "recommend", "generate_link"].includes(step.type));
  const staleSteps = lookupSteps.filter((step) => updatedKeys.some((key) => lookupDependencyKeys(step).has(key)));
  if (!staleSteps.length) return false;
  const firstStaleIndex = Math.min(...staleSteps.map((step) => action.steps!.findIndex((candidate) => candidate.id === step.id)));
  const currentIndex = state.currentStepId ? action.steps.findIndex((step) => step.id === state.currentStepId) : -1;
  state.lookupResults = Object.fromEntries(Object.entries(state.lookupResults ?? {}).filter(([stepId]) => !staleSteps.some((step) => step.id === stepId)));
  const isPlanSelection = action.fields.some((field) => field.key === "recommended_plan")
    || action.steps.some((step) => step.type === "recommend" && step.config?.recommendationType === "plan");
  if (isPlanSelection && updatedKeys.some((key) => ["usage_type", "main_goal", "usage_level"].includes(key))) {
    delete state.values.recommended_plan;
    delete state.lookupResults?.pricing_context;
  }
  state.selectedActionResourceId = undefined;
  state.completionUrl = undefined;
  if (currentIndex >= firstStaleIndex || staleSteps.some((step) => state.completedStepIds?.includes(step.id))) {
    const invalidatedIds = new Set(action.steps.slice(firstStaleIndex).map((step) => step.id));
    state.completedStepIds = (state.completedStepIds ?? []).filter((stepId) => !invalidatedIds.has(stepId));
    state.currentStepId = action.steps[firstStaleIndex]?.id;
    state.status = "active";
    state.completedAt = undefined;
  }
  return true;
}

export type WorkflowReplayResult = {
  stateBefore: ConversationActionState;
  extracted: Record<string, string>;
  updated: string[];
  nextBestActionBefore: WorkflowNextBestAction;
  stateAfter: ConversationActionState;
  nextBestActionAfter: WorkflowNextBestAction;
};

/** Pure, non-persisting turn replay used by certification and admin tooling. */
export function replayWorkflowTurn(action: ActionFlow, inputState: ConversationActionState, rawInput: string): WorkflowReplayResult {
  const state = cloneWorkflowState(inputState);
  migrateWorkflowState(action, state);
  const stateBefore = cloneWorkflowState(state);
  const beforeStep = currentWorkflowStep(action, state);
  const extracted = extractWorkflowValues(action, rawInput);
  const applied = applyWorkflowValues(action, state, extracted);
  invalidateWorkflowLookups(action, state, applied.updated);
  if (!applied.updated.length) {
    const current = currentWorkflowStep(action, state);
    if (current?.fieldKey) applyWorkflowInput(action, state, rawInput);
  }
  return {
    stateBefore,
    extracted,
    updated: applied.updated,
    nextBestActionBefore: workflowNextBestAction(action, beforeStep),
    stateAfter: state,
    nextBestActionAfter: workflowNextBestAction(action, currentWorkflowStep(action, state)),
  };
}

function optionForField(field: ActionField, input: string): string | null {
  const value = normalizedPhrase(input);
  const exact = field.options?.find((option) => normalizedPhrase(option) === value);
  if (exact) return exact;
  const partial = !["usage_type", "main_goal", "usage_level"].includes(field.key)
    ? field.options?.find((option) => normalizedPhrase(option).includes(value) || value.includes(normalizedPhrase(option)))
    : undefined;
  if (partial) return partial;
  if (field.key === "customer_type") {
    if (/\b(new|first|not enrolled|never)\b/.test(value)) return "New student";
    if (/\b(current|already|existing|enrolled)\b/.test(value)) return "Current student";
  }
  if (field.key === "ability") {
    if (/\b(beginner|can t(?:\s+\w+){0,2}\s+swim|cannot(?:\s+\w+){0,2}\s+swim|can not(?:\s+\w+){0,2}\s+swim|doesn t(?:\s+\w+){0,2}\s+swim|not comfortable|not really|just starting|new to swimming)\b/.test(value)) return "Beginner";
    if (/\b(independent|independently|confident|swims well|strong swimmer)\b/.test(value)) return "Can swim independently";
    if (/\b(help|assistance|with an adult|with support)\b/.test(value)) return "Can swim with help";
  }
  if (field.key === "goal") {
    if (/\b(learn|learning|teach|start|begin)\b/.test(value)) return "Learn to swim";
    if (/\b(safety|safe|survival)\b/.test(value)) return "Water safety";
    if (/\b(technique|stroke|improve|competitive)\b/.test(value)) return "Improve technique";
    if (/\b(fun|confidence|activity)\b/.test(value)) return "Have fun";
  }
  if (field.key === "usage_type" || fieldLooksLike(field, "usage type", "audience", "team size")) {
    if (/\b(just for me|only me|by myself|myself|individual|solo|personal use|one person|single user)\b/.test(value)) return field.options?.find((option) => /solo|individual|personal|one person/i.test(option)) ?? "Solo";
    if (/\b(team|teams|coworkers?|colleagues?|multiple users?|small group|we[' ]?ll use|use it together)\b/.test(value)) return field.options?.find((option) => /team|group|multiple/i.test(option)) ?? "Team";
  }
  if (field.key === "business_type" || fieldLooksLike(field, "business type", "business", "industry")) {
    if (/\bsmall\s+(?:salon|beauty business)\b/.test(value)) return field.options?.find((option) => /small\s+(?:salon|beauty)/i.test(option)) ?? field.options?.find((option) => /salon/i.test(option)) ?? "Salon";
    if (/\bsalon\b/.test(value)) return field.options?.find((option) => /salon/i.test(option)) ?? "Salon";
    if (/\bbarber(?:shop)?\b/.test(value)) return field.options?.find((option) => /barber/i.test(option)) ?? "Barbershop";
    if (/\bspa\b/.test(value)) return field.options?.find((option) => /spa/i.test(option)) ?? "Spa";
    if (/\bbeauty\s+(?:studio|business)\b/.test(value)) return field.options?.find((option) => /beauty/i.test(option)) ?? "Beauty studio";
  }
  if (field.key === "main_goal" || fieldLooksLike(field, "main goal", "goal", "objective")) {
    // "daily" is a usage-frequency answer, not evidence that the visitor
    // changed their planning goal. Treating it as a goal caused a later turn
    // to overwrite an earlier qualified goal with stale inferred state.
    const planning = /\b(plan|planning|organize|priorit)\w*/.test(value);
    const reminders = /\b(reminder|reminders|nudge|recap|alert|notifications?)\b/.test(value);
    const onlineBooking = /\bonline\s+book(?:ing)?\b/.test(value);
    if (onlineBooking && reminders) {
      return field.options?.find((option) => /online\s+book(?:ing)?/i.test(option) && /reminder/i.test(option))
        ?? (field.options?.some((option) => /online\s+book(?:ing)?/i.test(option))
          && field.options?.some((option) => /reminder/i.test(option))
          ? "Online booking + reminders"
          : field.options?.find((option) => /online\s+book(?:ing)?/i.test(option)))
        ?? "Online booking";
    }
    if (planning && reminders) {
      return field.options?.find((option) => {
        const candidate = normalizedPhrase(option);
        return candidate.includes("planning") && candidate.includes("reminder");
      })
        ?? field.options?.find((option) => /planning/i.test(option))
        ?? "Planning";
    }
    if (planning) return field.options?.find((option) => /planning|organ|priorit/i.test(option)) ?? "Planning";
    if (reminders) return field.options?.find((option) => /^reminders?$/i.test(option.trim()))
      ?? field.options?.find((option) => /reminder|nudge|recap/i.test(option))
      ?? "Reminders";
    if (/\b(task breakdown|break down tasks|tasks? into steps)\b/.test(value)) return field.options?.find((option) => /task/i.test(option)) ?? "AI task breakdown";
    if (/\b(team|collaborat|shared|workspace)\b/.test(value)) return field.options?.find((option) => /team|coordination|workspace/i.test(option)) ?? "Team coordination";
  }
  if (field.key === "usage_level" || fieldLooksLike(field, "usage level", "frequency", "often")) {
    if (/\b(every day|each day|daily|day to day|all the time|frequently)\b/.test(value)) return field.options?.find((option) => /every day|daily|heavy|frequent/i.test(option)) ?? "Daily";
    if (/\b(regularly|regular|most days|several times|often)\b/.test(value)) return field.options?.find((option) => /regular|often/i.test(option)) ?? "Regularly";
    if (/\b(occasionally|occasional|sometimes|once in a while|rarely)\b/.test(value)) return field.options?.find((option) => /occasional|occasionally|sometimes/i.test(option)) ?? "Occasionally";
  }
  return null;
}

function multiSelectForField(field: ActionField, input: string): string | null {
  const requested = input.split(/[,;]|\s+and\s+/i).map((item) => item.trim()).filter(Boolean);
  if (!requested.length) return null;
  const choices = requested.map((item) => field.options?.find((option) => normalizedPhrase(option) === normalizedPhrase(item))
    ?? field.options?.find((option) => normalizedPhrase(option).includes(normalizedPhrase(item)) || normalizedPhrase(item).includes(normalizedPhrase(option))));
  if (choices.some((choice): choice is undefined => !choice)) return null;
  return [...new Set(choices as string[])].join(", ");
}

function fieldLooksLike(field: ActionField, ...terms: string[]): boolean {
  const haystack = `${field.key} ${field.label}`.toLowerCase();
  return terms.some((term) => haystack.includes(term));
}

/**
 * Fields that describe an existing system can be answered incidentally while
 * the visitor is asking a compatibility question. Keep this classification
 * narrow enough that an arbitrary product mention does not populate a random
 * text field in the workflow.
 */
export function isSoftwareContextField(field: ActionField): boolean {
  return fieldLooksLike(field, "software", "platform", "pos", "accounting", "crm", "system");
}

const knownSoftwareProviders = [
  "QuickBooks Online",
  "GlossGenius",
  "Mindbody",
  "Jackrabbit",
  "QuickBooks",
  "HubSpot",
  "Booksy",
  "Fresha",
  "Zenoti",
  "Vagaro",
  "Square",
  "Toast",
  "Clover",
  "Shopify",
  "Acuity",
] as const;

/** Return a canonical provider name when the visitor mentions a known system. */
export function knownSoftwareProvider(input: string): string | null {
  for (const provider of knownSoftwareProviders) {
    const pattern = new RegExp(`\\b${provider.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\b`, "i");
    if (pattern.test(input)) return provider;
  }
  return null;
}

/**
 * Turn conversational software answers into a useful stored value. The
 * workflow needs the product name for context and resume copy, not the full
 * sentence the visitor used to provide it.
 */
export function normalizeWorkflowFieldValue(field: ActionField, rawValue: string): string {
  let value = rawValue.trim();
  if (!isSoftwareContextField(field)) return value;
  value = value.replace(/[.!?]+$/, "").trim();
  value = value.replace(/^(?:(?:we(?:'re| are)?|i(?:'m| am)?|our|my)\s+)?(?:currently\s+)?(?:using|use)\s+/i, "");
  value = value.replace(/\s+(?:right\s+now|currently|at\s+the\s+moment)$/i, "").trim();
  return value || rawValue.trim();
}

/**
 * Extracts safe, typed values without giving the language model authority over
 * workflow transitions. This intentionally returns only fields defined by the
 * action; unknown text remains available to the current step as a fallback.
 */
export function extractWorkflowValues(action: ActionFlow, input: string): Record<string, string> {
  const value = input.trim();
  if (!value) return {};
  const extracted: Record<string, string> = {};
  const email = value.match(/\b[^\s@]+@[^\s@]+\.[^\s@]+\b/)?.[0];
  const phone = value.match(/(?:\+?\d[\d\s().-]{6,}\d)/)?.[0]?.trim();
  const zip = value.match(/\b\d{5}(?:-\d{4})?\b/)?.[0];
  const age = value.match(/\b(?:age\s*|(?:is|are)\s+|(?:she|he|they)\s+(?:is|are)\s+)(\d{1,3})(?:\s*(?:years?|year)\s*old)?\b/i)?.[1]
    ?? value.match(/\b(\d{1,3})\s*[- ]?year[- ]?old\b/i)?.[1];
  const day = value.match(/\b(?:weekends?|weekdays?|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)s?|mornings?|afternoons?|evenings?|after school)\b/i)?.[0];
  const location = value.match(/\b(?:location|at|in|near)\s+(?:is\s+)?([a-z][a-z0-9 &'./-]{2,60}?)(?=\s+(?:on|for|and|but|because|this|next)\b|[,.!?]|$)/i)?.[1]?.trim()
    ?? value.match(/\bactually\s*,?\s+([A-Z][a-z0-9 &'./-]{2,60}?)(?=\s+(?:on|for|and|but|because|this|next)\b|[,.!?]|$)/)?.[1]?.trim()
    ?? value.match(/\b(?:at|in|near)\s+([A-Z][a-z0-9 &'./-]{2,60}?)(?=\s+(?:on|for|and|but|because|this|next)\b|[,.!?]|$)/)?.[1]?.trim();
  const correctedLocation = value.match(/\b(?:location is|prefer(?:red)? location is)\s*,?\s+([a-z][a-z0-9'-]{2,40}(?:\s+[A-Z][a-z0-9'-]{2,40})?)/i)?.[1]?.trim()
    ?? value.match(/\bActually\s*,?\s+([A-Z][a-z0-9'-]{2,40}(?:\s+[A-Z][a-z0-9'-]{2,40})?)/)?.[1]?.trim();
  const program = value.match(/\b(?:program|class)\s*(?:is|:)\s*([a-z0-9][a-z0-9 &'./-]{1,50}?)(?=\s+(?:in|at|on|for|and|but)\b|[,.!?]|$)/i)?.[1]?.trim()
    ?? value.match(/\b(?:program|class)\s+([a-z0-9][a-z0-9 &'./-]{1,50}?)(?=\s+(?:in|at|on|for|and|but)\b|[,.!?]|$)/i)?.[1]?.trim();
  const name = value.match(/\b(?:my name is|i am|i'm|parent(?:'s)? name is|guardian(?:'s)? name is)\s+([a-z][a-z .'-]{1,80})/i)?.[1]?.trim();
  const softwareProvider = knownSoftwareProvider(value);

  for (const field of action.fields) {
    if (field.visibility === "hidden") continue;
    if (softwareProvider && isSoftwareContextField(field)) extracted[field.key] = softwareProvider;
    if (field.type === "email" && email) extracted[field.key] = email;
    else if (field.type === "phone" && phone) extracted[field.key] = phone;
    else if (field.type === "number" && age && fieldLooksLike(field, "age", "year", "student", "child")) extracted[field.key] = age;
    else if (fieldLooksLike(field, "zip", "postal", "location") && zip) extracted[field.key] = zip;
    if (fieldLooksLike(field, "location") && (correctedLocation || location)) extracted[field.key] = correctedLocation || location!;
    if (fieldLooksLike(field, "schedule", "day", "time") && day) extracted[field.key] = day;
    else if (field.key === "name" || field.key === "parent_name" || fieldLooksLike(field, "guardian")) {
      if (name) extracted[field.key] = name;
    }
    const option = field.type === "select"
      ? optionForField(field, value)
      : field.type === "multi_select"
        ? multiSelectForField(field, value)
        : null;
    if (option) extracted[field.key] = option;
    if (field.key === "program") {
      const namedProgram = program ?? value.match(/\b(?:turtle|level|program)\s*[-#]?\s*[a-z0-9]+\b/i)?.[0];
      if (namedProgram) extracted[field.key] = namedProgram.replace(/^(program\s*)/i, "").trim();
    }
  }
  return extracted;
}

export function applyWorkflowValues(
  action: ActionFlow,
  state: ConversationActionState,
  values: Record<string, string>,
): { updated: string[]; transition: WorkflowTransition } {
  const updated: string[] = [];
  for (const field of action.fields) {
    const raw = values[field.key];
    if (raw === undefined) continue;
    const validation = validateFieldValue(field, normalizeWorkflowFieldValue(field, raw));
    if (!validation.value) continue;
    if (state.values[field.key] !== validation.value) {
      state.values[field.key] = validation.value;
      updated.push(field.key);
    }
  }
  let step = currentWorkflowStep(action, state);
  while (step?.fieldKey && state.values[step.fieldKey]?.trim()) {
    const transition = transitionWorkflow(action, state, step.id);
    step = transition.step;
  }
  return { updated, transition: { step, state } };
}

export function transitionWorkflow(action: ActionFlow, state: ConversationActionState, completedStepId?: string): WorkflowTransition {
  if (!action.steps?.length) return { step: null, state };
  const current = workflowStep(action, completedStepId ?? state.currentStepId) ?? action.steps[0];
  if (current && !state.completedStepIds?.includes(current.id)) {
    state.completedStepIds = [...(state.completedStepIds ?? []), current.id];
  }
  const next = current ? nextBranchStep(action, current, state.values) : action.steps[0];
  state.currentStepId = next?.id;
  const resolved = currentWorkflowStep(action, state);
  state.currentStepId = resolved?.id;
  if (!resolved) {
    state.status = "completed";
    state.completedAt = state.completedAt ?? new Date().toISOString();
  }
  return { step: resolved, state };
}

export function applyWorkflowInput(
  action: ActionFlow,
  state: ConversationActionState,
  rawValue: string,
): { ok: boolean; value?: string; error?: string; transition: WorkflowTransition } {
  const step = currentWorkflowStep(action, state);
  if (!step) return { ok: false, error: "This workflow is already complete.", transition: { step: null, state } };
  const field = workflowField(action, step.fieldKey);
  const validation = field
    ? validateFieldValue(field, normalizeWorkflowFieldValue(field, rawValue))
    : { value: rawValue.trim() };
  if (!validation.value) return { ok: false, error: validation.error, transition: { step, state } };
  if (field) state.values[field.key] = validation.value;
  else if (step.fieldKey) state.values[step.fieldKey] = validation.value;
  return { ok: true, value: validation.value, transition: transitionWorkflow(action, state, step.id) };
}

export function pushWorkflowInterruption(
  state: ConversationActionState,
  input: Omit<ActionInterruption, "startedAt">,
  now = new Date().toISOString(),
): void {
  const stack = state.interruptionStack ?? [];
  const current = stack[stack.length - 1];
  if (current?.question === input.question && current.intent === input.intent) return;
  state.interruptionStack = [...stack, { ...input, startedAt: now }].slice(-8);
}

export function resumeWorkflowInterruption(state: ConversationActionState): ActionInterruption | null {
  const stack = state.interruptionStack ?? [];
  if (!stack.length) return null;
  const interruption = stack[stack.length - 1];
  state.interruptionStack = stack.slice(0, -1);
  // The workflow cursor may have advanced while the interruption was being
  // answered (for example, a visitor can answer the paused field on the same
  // turn that the interruption stack is popped). Do not rewind that progress;
  // only restore a cursor when an older/legacy state has no cursor at all.
  if (interruption.returnStepId && !state.currentStepId) state.currentStepId = interruption.returnStepId;
  return interruption;
}

export function addWorkflowParticipant(
  state: ConversationActionState,
  entityType = "participant",
  label?: string,
  now = new Date().toISOString(),
): ActionParticipant {
  const participants = state.participants ?? [];
  const participant: ActionParticipant = {
    id: `${entityType}-${participants.length + 1}`,
    entityType,
    ...(label ? { label } : {}),
    values: {},
    status: "active",
    createdAt: now,
  };
  state.participants = [...participants, participant];
  state.activeParticipantId = participant.id;
  return participant;
}

export function activeWorkflowParticipant(state: ConversationActionState): ActionParticipant | null {
  return state.participants?.find((participant) => participant.id === state.activeParticipantId) ?? null;
}

export function setWorkflowParticipantValue(state: ConversationActionState, key: string, value: string): void {
  const participant = activeWorkflowParticipant(state);
  if (!participant) {
    state.values[key] = value;
    return;
  }
  participant.values[key] = value;
  state.values[`participants.${participant.id}.${key}`] = value;
}

export function completeActiveWorkflowParticipant(state: ConversationActionState): void {
  const participant = activeWorkflowParticipant(state);
  if (participant) participant.status = "completed";
}

