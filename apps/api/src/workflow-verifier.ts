import { actionProviderForFlow, type ActionFlow, type ActionStep } from "./action-flows.js";

export type WorkflowVerificationSeverity = "error" | "warning";

export type WorkflowVerificationIssue = {
  code:
  | "duplicate_step_id"
  | "unknown_step_target"
  | "cycle_detected"
  | "unreachable_step"
  | "non_terminal_step"
  | "required_field_not_captured"
  | "provider_missing"
  | "provider_fallback_missing"
  | "provider_dependency_missing"
  | "unverified_link_source"
  | "placeholder_step"
  | "unsupported_step_type"
  | "selection_dependency_missing"
  | "contact_boundary_missing";
  severity: WorkflowVerificationSeverity;
  message: string;
  stepId?: string;
  fieldKey?: string;
};

export type WorkflowVerificationResult = {
  ok: boolean;
  score: number;
  issues: WorkflowVerificationIssue[];
  reachableStepIds: string[];
  terminalStepIds: string[];
};

export type WorkflowSetVerificationResult = {
  ok: boolean;
  workflows: Array<{
    actionId: string;
    actionKey: string;
    result: WorkflowVerificationResult;
  }>;
};

const terminalStepTypes = new Set<ActionStep["type"]>(["complete", "redirect", "handoff"]);
const providerStepTypes = new Set<ActionStep["type"]>(["lookup", "api_action", "book"]);
const mutatingStepTypes = new Set<ActionStep["type"]>(["api_action", "book", "generate_link", "create_lead", "notify"]);
const supportedStepTypes = new Set<ActionStep["type"]>([
  "ask", "capture", "form", "knowledge", "condition", "decision", "lookup", "recommend", "select", "confirm",
  "api_action", "create_lead", "book", "generate_link", "redirect", "notify", "handoff", "complete",
]);

function stepTargets(action: ActionFlow, step: ActionStep): string[] {
  const targets = new Set<string>();
  if (step.nextStepId) targets.add(step.nextStepId);
  for (const branch of step.branches ?? []) targets.add(branch.nextStepId);
  if (!step.nextStepId && !step.branches?.length) {
    const index = action.steps?.findIndex((candidate) => candidate.id === step.id) ?? -1;
    const next = index >= 0 ? action.steps?.[index + 1] : undefined;
    if (next) targets.add(next.id);
  }
  return [...targets];
}

function stepCaptureKeys(action: ActionFlow, step: ActionStep): string[] {
  if (step.enabled === false) return [];
  if (step.fieldKey) return [step.fieldKey];
  if (step.type !== "form") return [];
  const configured = step.config?.fieldKeys;
  if (Array.isArray(configured)) return configured.filter((value): value is string => typeof value === "string");
  return action.fields.filter((field) => field.visibility !== "hidden").map((field) => field.key);
}

function configuredDependencies(step: ActionStep): string[] {
  const config = step.config ?? {};
  const dependencies = new Set<string>();
  for (const [key, value] of Object.entries(config)) {
    if (key.endsWith("Field") && typeof value === "string") dependencies.add(value);
    if (key === "searchFields" && typeof value === "string") value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => dependencies.add(item));
    if (key === "searchFields" && Array.isArray(value)) value.filter((item): item is string => typeof item === "string").forEach((item) => dependencies.add(item));
    if ((key === "requiredFields" || key === "fieldKeys") && Array.isArray(value)) value.filter((item): item is string => typeof item === "string").forEach((item) => dependencies.add(item));
  }
  return [...dependencies];
}

function issue(code: WorkflowVerificationIssue["code"], message: string, stepId?: string, fieldKey?: string): WorkflowVerificationIssue {
  return { code, message, ...(stepId ? { stepId } : {}), ...(fieldKey ? { fieldKey } : {}), severity: "error" };
}

const workflowPlaceholderCopy = [
  /select step actions to configure this step/i,
  /untitled step/i,
  /configure this step/i,
  /enter prompt here/i,
  /select actions?/i,
];

function containsWorkflowPlaceholder(step: ActionStep): boolean {
  const copy = `${step.label ?? ""} ${step.question ?? ""} ${step.conditionText ?? ""}`;
  return workflowPlaceholderCopy.some((pattern) => pattern.test(copy));
}

/** Deterministic graph and provider-safety checks used before publication. */
export function verifyWorkflowDefinition(action: ActionFlow): WorkflowVerificationResult {
  const steps = action.steps ?? [];
  if (!steps.length) return { ok: true, score: 1, issues: [], reachableStepIds: [], terminalStepIds: [] };
  const issues: WorkflowVerificationIssue[] = [];
  const byId = new Map<string, ActionStep>();
  for (const step of steps) {
    if (byId.has(step.id)) issues.push(issue("duplicate_step_id", `Workflow step id is duplicated: ${step.id}`, step.id));
    else byId.set(step.id, step);
    if (!supportedStepTypes.has(step.type)) issues.push(issue("unsupported_step_type", `Workflow step ${step.id} uses an unsupported type`, step.id));
    if (containsWorkflowPlaceholder(step)) issues.push(issue("placeholder_step", `Workflow step ${step.id} contains editor placeholder text`, step.id));
  }

  const reachable = new Set<string>();
  const terminal = new Set<string>();
  const visiting: string[] = [];
  const visit = (stepId: string): void => {
    const step = byId.get(stepId);
    if (!step) {
      issues.push(issue("unknown_step_target", `Workflow points to an unknown step: ${stepId}`, visiting.at(-1)));
      return;
    }
    if (visiting.includes(stepId)) {
      issues.push(issue("cycle_detected", `Workflow contains a cycle through step ${stepId}`, stepId));
      return;
    }
    if (reachable.has(stepId)) return;
    reachable.add(stepId);
    if (terminalStepTypes.has(step.type)) terminal.add(stepId);
    visiting.push(stepId);
    for (const target of stepTargets(action, step)) visit(target);
    visiting.pop();
  };
  visit(steps[0].id);

  for (const step of steps) {
    if (!reachable.has(step.id)) issues.push(issue("unreachable_step", `Workflow step is unreachable from the entry point: ${step.id}`, step.id));
  }
  for (const step of steps.filter((candidate) => reachable.has(candidate.id))) {
    if (step.enabled === false) continue;
    if (!terminalStepTypes.has(step.type) && !stepTargets(action, step).length) issues.push(issue("non_terminal_step", `Workflow path stops before a terminal step: ${step.id}`, step.id));
    for (const target of stepTargets(action, step)) if (!byId.has(target)) issues.push(issue("unknown_step_target", `Workflow step ${step.id} targets missing step ${target}`, step.id));
  }

  const requiredFields = action.fields.filter((field) => field.required && field.visibility !== "hidden");
  const capturedFields = new Set(steps.flatMap((step) => stepCaptureKeys(action, step)));
  for (const field of requiredFields) {
    if (!capturedFields.has(field.key) && !capturedFields.has(field.id)) issues.push(issue("required_field_not_captured", `Required field is never captured: ${field.key}`, undefined, field.key));
  }

  const provider = actionProviderForFlow(action);
  for (const step of steps.filter((candidate) => reachable.has(candidate.id))) {
    if (providerStepTypes.has(step.type) && !provider && typeof step.config?.provider !== "string") issues.push(issue("provider_missing", `Provider step ${step.id} has no configured provider`, step.id));
    const config = step.config ?? {};
    if (step.type === "lookup" && (typeof config.provider === "string" || provider)) {
      const hasFallback = typeof config.failureBehavior === "string" && Boolean(config.failureBehavior.trim())
        || typeof config.fallbackStepId === "string" && Boolean(config.fallbackStepId.trim());
      if (!hasFallback) issues.push(issue("provider_fallback_missing", `Provider step ${step.id} has no explicit fallback behavior`, step.id));
      if (typeof config.fallbackStepId === "string" && config.fallbackStepId && !byId.has(config.fallbackStepId)) {
        issues.push(issue("provider_fallback_missing", `Provider step ${step.id} points to an unknown fallback step`, step.id));
      }
    }
    if (config.requiresProviderResult === true) {
      const sourceId = typeof config.providerResultStepId === "string"
        ? config.providerResultStepId
        : typeof config.sourceStepId === "string" ? config.sourceStepId : "";
      const source = byId.get(sourceId);
      if (!source || source.type !== "lookup") issues.push(issue("provider_dependency_missing", `Workflow step ${step.id} requires a provider lookup result from a valid lookup step`, step.id));
    }
    if (config.requiresSelection === true) {
      const currentIndex = steps.findIndex((candidate) => candidate.id === step.id);
      const hasSelection = steps.slice(0, currentIndex).some((candidate) => candidate.type === "select");
      if (!hasSelection) issues.push(issue("selection_dependency_missing", `Workflow step ${step.id} requires a visitor-selected option`, step.id));
      if (config.requiresVerifiedProviderSelection === true && !steps.slice(0, currentIndex).some((candidate) => candidate.type === "lookup")) {
        issues.push(issue("selection_dependency_missing", `Workflow step ${step.id} requires a provider-verified option`, step.id));
      }
    }
    if (config.requiresContactBeforeHandoff === true) {
      const currentIndex = steps.findIndex((candidate) => candidate.id === step.id);
      const hasContact = steps.slice(0, currentIndex).some((candidate) => candidate.type === "create_lead" || (candidate.type === "form" && candidate.config?.ensureContact === true));
      if (!hasContact) issues.push(issue("contact_boundary_missing", `Workflow step ${step.id} requires contact capture before external handoff`, step.id));
    }
  }

  const pathSeen = new Set<string>();
  const inspectPath = (stepId: string, fields: Set<string>, verifiedProviderOutput: boolean, stack: string[] = []): void => {
    const step = byId.get(stepId);
    if (!step || stack.includes(stepId)) return;
    if (step.enabled === false) {
      for (const target of stepTargets(action, step)) inspectPath(target, fields, verifiedProviderOutput, [...stack, stepId]);
      return;
    }
    const nextFields = new Set([...fields, ...stepCaptureKeys(action, step)]);
    const signature = `${stepId}|${[...nextFields].sort().join(",")}|${verifiedProviderOutput}`;
    if (pathSeen.has(signature)) return;
    pathSeen.add(signature);
    const requiredKeys = new Set(action.fields.filter((field) => field.required && field.visibility !== "hidden").flatMap((field) => [field.key, field.id]));
    const dependencies = configuredDependencies(step).filter((field) => requiredKeys.has(field));
    if (providerStepTypes.has(step.type)) {
      const missing = dependencies.filter((field) => !fields.has(field) && !nextFields.has(field));
      if (missing.length) issues.push(issue("provider_dependency_missing", `Provider step ${step.id} can run before required inputs: ${missing.join(", ")}`, step.id));
    }
    if (mutatingStepTypes.has(step.type)) {
      const missing = requiredFields.filter((field) => !fields.has(field.key) && !fields.has(field.id) && !nextFields.has(field.key) && !nextFields.has(field.id)).map((field) => field.key);
      if (missing.length) issues.push(issue("provider_dependency_missing", `Action step ${step.id} can run before required qualification: ${missing.join(", ")}`, step.id));
    }
    const hasVerifiedOutput = verifiedProviderOutput || providerStepTypes.has(step.type);
    if (step.type === "generate_link" && !hasVerifiedOutput && !step.config?.linkSource) issues.push(issue("unverified_link_source", `Completion link step ${step.id} has no verified provider output`, step.id));
    for (const target of stepTargets(action, step)) inspectPath(target, nextFields, hasVerifiedOutput, [...stack, stepId]);
  };
  inspectPath(steps[0].id, new Set(), false);

  const uniqueIssues = [...new Map(issues.map((item) => [`${item.code}|${item.stepId ?? ""}|${item.fieldKey ?? ""}|${item.message}`, item])).values()];
  const errors = uniqueIssues.filter((item) => item.severity === "error").length;
  return {
    ok: errors === 0,
    score: Number(Math.max(0, 1 - Math.min(1, errors / Math.max(1, steps.length))).toFixed(4)),
    issues: uniqueIssues,
    reachableStepIds: [...reachable],
    terminalStepIds: [...terminal],
  };
}

/** Verify every versioned workflow before a tenant publication is created. */
export function verifyWorkflowSet(actions: ActionFlow[]): WorkflowSetVerificationResult {
  const workflows = actions
    .filter((action) => Array.isArray(action.steps) && action.steps.length > 0)
    .map((action) => ({
      actionId: action.id,
      actionKey: action.key,
      result: verifyWorkflowDefinition(action),
    }));
  return { ok: workflows.every((workflow) => workflow.result.ok), workflows };
}
