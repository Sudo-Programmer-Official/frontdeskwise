<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, GripVertical, Plus, Sparkles, Trash2, X } from "@lucide/vue";
import { ENROLLMENT_WORKFLOW_GOAL, generateWorkflow, preserveWorkflowGoal, templateSteps, workflowGenerationCacheKey, type WorkflowBusinessContext, type WorkflowFieldDraft, type WorkflowStepDraft } from "../workflow-generator.js";
import { validateWorkflowTenantContext, WORKFLOW_CONTEXT_REFRESH_MESSAGE } from "../workflow-tenant-context.js";

type WorkflowStep = WorkflowStepDraft & { nextStepId?: string; branches?: Record<string, string> };

interface WorkflowAction {
  id: string;
  key: string;
  businessId?: string;
  organizationId?: string;
  name: string;
  description?: string;
  actionType?: string;
  executionMode?: string;
  provider?: string | null;
  fields?: Array<WorkflowFieldDraft & { id?: string; visibility?: string }>;
  steps?: Array<Record<string, unknown>>;
  completion?: Record<string, unknown>;
  enabled?: boolean;
  readiness?: { ready?: boolean; reason?: string };
  workflowSafety?: { status?: string; code?: string; identifier?: string };
}

type CreateWorkflowMode = "action" | "template" | "describe";

interface IntegrationLike {
  provider?: string;
  connectionStatus?: string;
}

const props = defineProps<{
  actions: unknown[];
  integrations: unknown[];
  demoSlug: string;
  selectedBusinessId?: string | null;
  workspaceBusinessId?: string | null;
  workspaceOrganizationId?: string | null;
  organizationId?: string | null;
  apiUrl: (path: string) => string;
  ownerHeaders: () => Record<string, string>;
  businessName?: string;
  businessContext?: WorkflowBusinessContext | null;
  publishingStatus?: "NOT_PUBLISHED" | "PUBLISHING" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
  publishError?: string;
}>();

const emit = defineEmits<{
  (event: "refresh"): void;
  (event: "refresh-workspace"): void;
  (event: "open-action", actionId: string): void;
  (event: "test-workflow", actionId: string): void;
  (event: "publish-workflow"): void;
}>();

const selectedWorkflowId = ref("");
const workflowDraft = ref<WorkflowAction | null>(null);
const selectedStepIndex = ref(-1);
const workflowDescription = ref("");
const workflowSaveLoading = ref(false);
const workflowSaveError = ref("");
const workflowSaveMessage = ref("");
const stepAdvancedOpen = ref(false);
const workflowAdvancedOpen = ref(false);
const setupStatusOpen = ref(false);
const showTemplatePicker = ref(false);
const workflowAssistInput = ref<HTMLTextAreaElement | null>(null);
const workflowStepList = ref<HTMLElement | null>(null);
const workflowGoalExpanded = ref(false);
const workflowTested = ref(false);
const draftIsDirty = ref(false);
const workflowGenerationKey = ref("");
const createWorkflowOpen = ref(false);
const createWorkflowMode = ref<CreateWorkflowMode>("action");
const createWorkflowActionId = ref("");
const createWorkflowTemplateKey = ref("lead");
const createWorkflowDescription = ref("");
const createWorkflowLoading = ref(false);
const createWorkflowError = ref("");
const createNewActionOpen = ref(false);
const createNewActionName = ref("");
const createNewActionDescription = ref("");
const locallyCreatedAction = ref<WorkflowAction | null>(null);
const customFieldOpenFor = ref("");
const customFieldLabel = ref("");
const customFieldKey = ref("");
let draftSourceId = "";

const stepTypes = [
  { value: "capture", label: "Capture details" },
  { value: "ask", label: "Ask a question" },
  { value: "form", label: "Show a form" },
  { value: "condition", label: "Condition / branch" },
  { value: "lookup", label: "Find classes or availability" },
  { value: "recommend", label: "Present recommendations" },
  { value: "select", label: "Let visitor select" },
  { value: "confirm", label: "Confirm selection" },
  { value: "generate_link", label: "Generate registration link" },
  { value: "redirect", label: "Show a call to action" },
  { value: "create_lead", label: "Save a lead" },
  { value: "book", label: "Book" },
  { value: "notify", label: "Notify staff" },
  { value: "handoff", label: "Hand off to a human" },
  { value: "complete", label: "Complete workflow" },
];

const answerTypes: Array<{ value: WorkflowFieldDraft["type"]; label: string }> = [
  { value: "text", label: "Short text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "select", label: "Single select" },
  { value: "multi_select", label: "Multi-select" },
];

const workflowTemplates = [
  { key: "enrollment", label: "Enrollment", description: "Qualify a student, find classes, and hand off to registration." },
  { key: "booking", label: "Booking", description: "Capture a preference, check availability, and confirm a time." },
  { key: "lead", label: "Lead qualification", description: "Ask the essentials, score intent, and notify the team." },
  { key: "service", label: "Service request", description: "Collect the issue, route it, and set expectations." },
  { key: "tour", label: "Tour scheduling", description: "Qualify the visitor and schedule a tour or follow-up." },
  { key: "quote", label: "Quote", description: "Gather requirements and send a quote request to staff." },
  { key: "demo", label: "Demo", description: "Capture buying context and route a product demo request." },
];

function asWorkflowAction(value: unknown): WorkflowAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string") return null;
  return candidate as unknown as WorkflowAction;
}

const allActions = computed(() => {
  const actions = props.actions.map(asWorkflowAction).filter((action): action is WorkflowAction => Boolean(action));
  const localAction = locallyCreatedAction.value;
  return localAction && !actions.some((action) => action.id === localAction.id) ? [...actions, localAction] : actions;
});
const workflowActions = computed(() => allActions.value.filter((action) => {
  const stepCount = Array.isArray(action.steps) ? action.steps.length : 0;
  return action.workflowSafety?.status === "blocked" || stepCount > 1 || action.executionMode === "PROVIDER_FLOW" || (action.fields?.length ?? 0) > 2;
}));
const eligibleActions = computed(() => allActions.value
  .filter((action) => action.enabled !== false && action.workflowSafety?.status !== "blocked" && !actionHasWorkflow(action))
  .sort((left, right) => {
    const leftDemo = /try|demo|start|book|request/i.test(left.name) ? 0 : 1;
    const rightDemo = /try|demo|start|book|request/i.test(right.name) ? 0 : 1;
    return leftDemo - rightDemo || left.name.localeCompare(right.name);
  }));
const selectedWorkflow = computed(() => workflowActions.value.find((action) => action.id === selectedWorkflowId.value) ?? workflowActions.value[0] ?? null);
const draftSteps = computed(() => (workflowDraft.value?.steps ?? []) as unknown as WorkflowStep[]);
const workflowProvider = computed(() => {
  const direct = workflowDraft.value?.provider?.trim();
  if (direct) return direct.toLowerCase();
  const lookup = draftSteps.value.find((step) => step.type === "lookup");
  const provider = lookup ? stepConfigValue(lookup, "provider") : "";
  return provider.toLowerCase();
});
const providerConnected = computed(() => {
  if (!workflowProvider.value) return true;
  return props.integrations.some((value) => {
    const integration = value as IntegrationLike;
    return integration.provider?.toLowerCase() === workflowProvider.value && integration.connectionStatus === "active";
  });
});
const readiness = computed(() => {
  const hasQuestions = draftSteps.value.some((step) => Boolean(step.question?.trim() || step.fieldKey?.trim() || step.type === "form"));
  const hasCompletion = draftSteps.value.some((step) => ["complete", "generate_link", "redirect", "book", "handoff"].includes(step.type ?? ""));
  const hasFailurePath = draftSteps.value.some((step) => ["handoff", "notify"].includes(step.type ?? "") || Boolean(stepConfigValue(step, "failureBehavior")));
  const providerReady = !workflowProvider.value || providerConnected.value;
  return [
    { label: "Workflow goal is defined", complete: Boolean(workflowDraft.value?.name?.trim()) },
    { label: "Questions and capture fields are defined", complete: hasQuestions },
    { label: workflowProvider.value ? `${formatLabel(workflowProvider.value)} is connected` : "No provider required", complete: providerReady },
    { label: "Completion path is defined", complete: hasCompletion },
    { label: "Failure and handoff path is defined", complete: hasFailurePath },
  ];
});
const readinessPercent = computed(() => Math.round((readiness.value.filter((item) => item.complete).length / readiness.value.length) * 100));
const readinessRemaining = computed(() => readiness.value.filter((item) => !item.complete));
const configurationComplete = computed(() => readinessRemaining.value.length === 0);
const configurationLabel = computed(() => configurationComplete.value ? "Configuration complete" : "Needs setup");
const setupChecklist = computed(() => [
  ...readiness.value,
  { label: "Test workflow before publishing", complete: workflowTested.value },
]);
const setupProgressLabel = computed(() => `${setupChecklist.value.filter((item) => item.complete).length} of ${setupChecklist.value.length} checks complete`);
const providerStep = computed(() => draftSteps.value.find((step) => step.type === "lookup" || step.type === "generate_link") ?? null);
const providerFailureBehavior = computed(() => providerStep.value ? stepConfigValue(providerStep.value, "failureBehavior") : "capture_lead");
const providerSummary = computed(() => workflowProvider.value ? formatLabel(workflowProvider.value) : "No provider required");
const completionSummary = computed(() => {
  const completion = workflowDraft.value?.completion;
  if (!completion || typeof completion !== "object" || Array.isArray(completion)) return "Use the linked action completion behavior";
  const value = completion as Record<string, unknown>;
  if (typeof value.linkLabel === "string" && value.linkLabel.trim()) return value.linkLabel.trim();
  if (typeof value.message === "string" && value.message.trim()) return "Show a confirmation message";
  return "Use the linked action completion behavior";
});
const workflowMetadata = computed(() => {
  const value = workflowDraft.value?.completion && typeof workflowDraft.value.completion === "object"
    ? (workflowDraft.value.completion as Record<string, unknown>).workflow
    : null;
  if (!value || typeof value !== "object") return null;
  const metadata = value as Record<string, unknown>;
  return typeof metadata.name === "string" && typeof metadata.actionId === "string"
    ? { name: metadata.name, actionId: metadata.actionId }
    : null;
});
const workflowTitle = computed(() => workflowMetadata.value?.name || workflowDraft.value?.name || "Workflow");
const workflowStatusSummary = computed(() => {
  const published = props.publishingStatus === "LIVE" && !draftIsDirty.value;
  const status = published ? "Published" : "Draft";
  return `${status} · ${draftSteps.value.length} step${draftSteps.value.length === 1 ? "" : "s"} · ${providerSummary.value}`;
});

function isConditionalStep(step: WorkflowStep): boolean {
  const config = step.config && typeof step.config === "object" && !Array.isArray(step.config)
    ? step.config as Record<string, unknown>
    : {};
  const searchable = `${step.label ?? ""} ${step.question ?? ""} ${step.condition ?? ""}`;
  return Boolean(step.condition || step.branches || config.trigger || config.conditional || step.type === "condition" || step.type === "handoff" || /pricing|request a demo|support|handoff|human help|human handoff/i.test(searchable));
}

const workflowDisplaySteps = computed<WorkflowStep[]>(() => {
  const entries = draftSteps.value.map((step, originalIndex) => ({ step, originalIndex, conditional: isConditionalStep(step) }));
  const main = entries.filter((entry) => !entry.conditional);
  const branches = entries.filter((entry) => entry.conditional);
  return [...main.map((entry) => entry.step), ...branches.map((entry) => entry.step)];
});
const workflowMainPathCount = computed(() => draftSteps.value.filter((step) => !isConditionalStep(step)).length);

function workflowStepIndex(step: WorkflowStep): number {
  return draftSteps.value.indexOf(step);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function syncDraft(force = false) {
  const selected = selectedWorkflow.value;
  if (!selected) {
    workflowDraft.value = null;
    draftSourceId = "";
    return;
  }
  if (!force && draftIsDirty.value && draftSourceId === selected.id) return;
  workflowDraft.value = clone(selected);
  workflowDraft.value.steps ??= [];
  draftSourceId = selected.id;
  draftIsDirty.value = false;
  workflowGoalExpanded.value = false;
  workflowTested.value = false;
  selectedStepIndex.value = -1;
  if (selected.workflowSafety?.status === "blocked") {
    const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "Business";
    workflowDraft.value.name = `${businessName} workflow`;
    workflowDraft.value.description = defaultBusinessWorkflowDescription();
    workflowDescription.value = workflowDraft.value.description;
  } else {
    workflowDescription.value = selected.description ?? "";
  }
}

function resizeWorkflowGoalEditor(target: HTMLTextAreaElement | null = workflowAssistInput.value): void {
  if (!target) return;
  const maxHeight = 280;
  target.style.height = "auto";
  const height = Math.min(target.scrollHeight, maxHeight);
  target.style.height = `${height}px`;
  target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
}

function syncWorkflowGoalEditor(): void {
  void nextTick(() => resizeWorkflowGoalEditor());
}

function defaultBusinessWorkflowDescription(): string {
  const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "this business";
  const businessEvidence = `${businessName} ${props.businessContext?.summary ?? ""}`;
  if (/swim/i.test(businessEvidence)) return ENROLLMENT_WORKFLOW_GOAL;
  const businessType = props.businessContext?.businessType?.trim() && props.businessContext.businessType !== "Unknown"
    ? props.businessContext.businessType.trim().toLowerCase()
    : "business";
  return `Help visitors understand whether ${businessName} is a good fit. First ask what kind of ${businessType} they run and what they are mainly trying to improve. Match verified capabilities, explain the fit briefly, show verified pricing when relevant, and use the approved primary conversion action. Offer a demo request only when explicitly requested and hand off account or human-help questions.`;
}

function workflowCompletion(action: WorkflowAction): Record<string, unknown> {
  return action.completion && typeof action.completion === "object" && !Array.isArray(action.completion) ? action.completion : {};
}

function ensureWorkflowCompletion(action: WorkflowAction): Record<string, unknown> {
  if (!action.completion || typeof action.completion !== "object" || Array.isArray(action.completion)) action.completion = {};
  return action.completion;
}

function setWorkflowMetadata(action: WorkflowAction, name: string): void {
  ensureWorkflowCompletion(action).workflow = { name: name.trim().slice(0, 160), actionId: action.id };
}

function workflowNameForTemplate(key: string): string {
  return workflowTemplates.find((template) => template.key === key)?.label ?? "Workflow";
}

function workflowDisplayName(action: WorkflowAction): string {
  const value = workflowCompletion(action).workflow;
  if (value && typeof value === "object" && typeof (value as Record<string, unknown>).name === "string") return String((value as Record<string, unknown>).name);
  return action.name;
}

function actionHasWorkflow(action: WorkflowAction): boolean {
  return Boolean((action.steps?.length ?? 0) > 0 || workflowCompletion(action).workflow);
}

function openCreateWorkflow(): void {
  createWorkflowOpen.value = true;
  createWorkflowMode.value = "action";
  createWorkflowError.value = "";
  createNewActionOpen.value = false;
  createWorkflowActionId.value = eligibleActions.value.find((action) => /try|demo/i.test(action.name))?.id
    ?? eligibleActions.value[0]?.id
    ?? "";
  createWorkflowTemplateKey.value = "lead";
  createWorkflowDescription.value = defaultBusinessWorkflowDescription();
}

function closeCreateWorkflow(): void {
  if (createWorkflowLoading.value) return;
  createWorkflowOpen.value = false;
  createNewActionOpen.value = false;
  createWorkflowError.value = "";
}

function selectCreateWorkflowMode(mode: CreateWorkflowMode): void {
  createWorkflowMode.value = mode;
  createWorkflowError.value = "";
  if (mode === "template") createWorkflowDescription.value = workflowNameForTemplate(createWorkflowTemplateKey.value);
  if (mode === "describe" && !createWorkflowDescription.value.trim()) createWorkflowDescription.value = defaultBusinessWorkflowDescription();
}

function openNewActionFlow(): void {
  createNewActionOpen.value = true;
  createWorkflowError.value = "";
  createNewActionName.value = "";
  createNewActionDescription.value = "";
}

function closeNewActionFlow(): void {
  if (createWorkflowLoading.value) return;
  createNewActionOpen.value = false;
  createWorkflowError.value = "";
}

function workflowGenerationContext(action: WorkflowAction) {
  const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "";
  return {
    organizationId: props.organizationId ?? props.businessContext?.organizationId,
    businessId: props.businessContext?.businessId,
    workflowId: action.id,
    actionId: action.id,
    contextVersion: props.businessContext?.contextVersion,
    summaryVersion: props.businessContext?.summaryVersion,
    actionType: action.actionType,
    actionName: action.name,
    actionDescription: action.description,
    availableActionTypes: allActions.value.map((candidate) => candidate.actionType || candidate.key),
    availableProviders: props.integrations.filter((integration) => (integration as IntegrationLike).connectionStatus === "active").map((integration) => String((integration as IntegrationLike).provider ?? "")).filter(Boolean),
    knownBusinessKnowledge: props.businessContext?.knowledgeSummary?.map((item) => item.value) ?? [],
    completionGoal: String(action.completion && (action.completion.message ?? action.completion.linkLabel ?? "")),
    businessContext: props.businessContext ?? undefined,
    businessName,
  };
}

function workflowTenantContext(action: WorkflowAction, createWorkflowBusinessId: string | null, createWorkflowOrganizationId: string | null) {
  return validateWorkflowTenantContext({
    selectedBusinessId: props.selectedBusinessId,
    selectedActionBusinessId: action.businessId,
    workspaceBusinessId: props.workspaceBusinessId,
    businessContextBusinessId: props.businessContext?.businessId,
    createWorkflowBusinessId,
    selectedOrganizationId: props.organizationId,
    actionOrganizationId: action.organizationId,
    workspaceOrganizationId: props.workspaceOrganizationId,
    businessContextOrganizationId: props.businessContext?.organizationId,
    createWorkflowOrganizationId,
  });
}

function refreshWorkflowContext(): void {
  createWorkflowError.value = WORKFLOW_CONTEXT_REFRESH_MESSAGE;
  emit("refresh-workspace");
}

function generatedWorkflowFor(action: WorkflowAction): { name: string; description: string; steps: WorkflowStep[]; fields: Array<WorkflowFieldDraft & { id?: string; visibility?: string }>; executionMode?: string; provider?: string } {
  if (createWorkflowMode.value === "template") {
    const template = workflowTemplates.find((candidate) => candidate.key === createWorkflowTemplateKey.value) ?? workflowTemplates[0];
    const generated = generateWorkflow(template.description, [], workflowGenerationContext(action));
    return {
      name: template.label,
      description: template.description,
      steps: templateSteps(template.key) as unknown as WorkflowStep[],
      fields: generated.fields as Array<WorkflowFieldDraft & { id?: string; visibility?: string }>,
      executionMode: generated.executionMode,
      provider: generated.provider,
    };
  }
  const description = preserveWorkflowGoal(createWorkflowDescription.value) ?? defaultBusinessWorkflowDescription();
  const generated = generateWorkflow(description, [], workflowGenerationContext(action));
  return {
    name: generated.name || "Workflow",
    description: generated.description,
    steps: generated.steps as unknown as WorkflowStep[],
    fields: generated.fields as Array<WorkflowFieldDraft & { id?: string; visibility?: string }>,
    executionMode: generated.executionMode,
    provider: generated.provider,
  };
}

async function createInlineAction(): Promise<void> {
  const name = createNewActionName.value.trim();
  if (!name || createWorkflowLoading.value) return;
  const duplicate = allActions.value.find((action) => action.name.trim().toLowerCase() === name.toLowerCase());
  if (duplicate) {
    createWorkflowActionId.value = duplicate.id;
    createNewActionOpen.value = false;
    createWorkflowError.value = "That action already exists, so it has been selected instead of duplicated.";
    return;
  }
  createWorkflowLoading.value = true;
  createWorkflowError.value = "";
  try {
    const keyBase = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "custom_action";
    const key = allActions.value.some((action) => action.key === keyBase) ? `${keyBase}_${Date.now()}` : keyBase;
    const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions`), {
      method: "POST",
      headers: { "content-type": "application/json", ...props.ownerHeaders() },
      body: JSON.stringify({
        key,
        actionType: "contact_team",
        name,
        description: createNewActionDescription.value.trim() || `Help visitors with ${name.toLowerCase()}.`,
        captureMode: "auto",
        fields: [
          { id: "name", key: "name", label: "Name", type: "text", required: true, visibility: "visible", question: "What’s your name?" },
          { id: "email", key: "email", label: "Email", type: "email", required: true, visibility: "visible", question: "What email address should we use?" },
        ],
        completion: { createLead: true, leadStatus: "new", message: "Thanks — I’ve sent your request to the team.", notifyStaff: true, notifyChannels: ["in_app", "email"], notifyTargets: ["business_team"] },
        enabled: true,
      }),
    });
    const payload = await response.json() as { error?: string; action?: WorkflowAction };
    if (!response.ok || !payload.action) throw new Error(payload.error ?? "Could not create the action.");
    locallyCreatedAction.value = payload.action;
    createWorkflowActionId.value = payload.action.id;
    createWorkflowMode.value = "describe";
    createWorkflowDescription.value = defaultBusinessWorkflowDescription();
    createNewActionOpen.value = false;
    emit("refresh");
  } catch (error) {
    createWorkflowError.value = error instanceof Error ? error.message : "Could not create the action.";
  } finally {
    createWorkflowLoading.value = false;
  }
}

async function createWorkflow(): Promise<void> {
  if (createWorkflowLoading.value) return;
  const action = allActions.value.find((candidate) => candidate.id === createWorkflowActionId.value);
  if (!action) {
    createWorkflowError.value = "Choose an action to connect to this workflow, or create one inline.";
    return;
  }
  if (actionHasWorkflow(action)) {
    selectedWorkflowId.value = action.id;
    workflowDraft.value = clone(action);
    draftSourceId = action.id;
    draftIsDirty.value = false;
    createWorkflowOpen.value = false;
    return;
  }
  const createWorkflowBusinessId = props.selectedBusinessId ?? null;
  const createWorkflowOrganizationId = props.organizationId ?? props.businessContext?.organizationId ?? null;
  const tenantContext = workflowTenantContext(action, createWorkflowBusinessId, createWorkflowOrganizationId);
  if (!tenantContext.ok) {
    refreshWorkflowContext();
    return;
  }
  createWorkflowLoading.value = true;
  createWorkflowError.value = "";
  try {
    const generated = generatedWorkflowFor(action);
    const nextAction = clone(action);
    nextAction.steps = generated.steps as unknown as Array<Record<string, unknown>>;
    nextAction.description = generated.description;
    nextAction.fields = generated.fields.length ? generated.fields : nextAction.fields;
    setWorkflowMetadata(nextAction, generated.name);
    if (generated.executionMode) nextAction.executionMode = generated.executionMode;
    if (generated.provider) nextAction.provider = generated.provider;
    const workflowContextPayload = {
      businessId: createWorkflowBusinessId,
      organizationId: createWorkflowOrganizationId,
      contextVersion: props.businessContext?.contextVersion,
      summaryVersion: props.businessContext?.summaryVersion,
    };
    const createWorkflowPayload = {
      ...nextAction,
      businessId: createWorkflowBusinessId,
      organizationId: createWorkflowOrganizationId,
      workflowContext: workflowContextPayload,
      businessContext: workflowContextPayload,
      workflowContextBusinessId: createWorkflowBusinessId,
      workflowContextOrganizationId: createWorkflowOrganizationId,
      ...(props.businessContext?.contextVersion !== undefined ? { workflowContextVersion: props.businessContext.contextVersion } : {}),
      ...(props.businessContext?.summaryVersion !== undefined ? { workflowContextSummaryVersion: props.businessContext.summaryVersion } : {}),
    };
    const requestTenantContext = workflowTenantContext(action, createWorkflowPayload.businessId, createWorkflowPayload.organizationId);
    if (!requestTenantContext.ok) {
      refreshWorkflowContext();
      return;
    }
    const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions/${encodeURIComponent(action.id)}`), {
      method: "PUT",
      headers: { "content-type": "application/json", ...props.ownerHeaders() },
      body: JSON.stringify(createWorkflowPayload),
    });
    const payload = await response.json() as { error?: string; action?: WorkflowAction };
    if (!response.ok && response.status === 409 && /different workflow context|organization mismatch|context changed/i.test(payload.error ?? "")) {
      refreshWorkflowContext();
      return;
    }
    if (!response.ok || !payload.action) throw new Error(payload.error ?? "Could not create this workflow.");
    const savedWorkflow = payload.action;
    locallyCreatedAction.value = savedWorkflow;
    selectedWorkflowId.value = savedWorkflow.id;
    workflowDraft.value = clone(savedWorkflow);
    workflowDraft.value.steps ??= [];
    draftSourceId = savedWorkflow.id;
    draftIsDirty.value = false;
    selectedStepIndex.value = savedWorkflow.steps?.length ? 0 : -1;
    workflowSaveMessage.value = `Workflow created and linked to ${action.name}.`;
    createWorkflowOpen.value = false;
    emit("refresh");
  } catch (error) {
    createWorkflowError.value = error instanceof Error ? error.message : "Could not create this workflow.";
  } finally {
    createWorkflowLoading.value = false;
  }
}

watch(workflowActions, () => {
  if (!workflowActions.value.some((action) => action.id === selectedWorkflowId.value)) {
    selectedWorkflowId.value = workflowActions.value[0]?.id ?? "";
  }
  syncDraft();
}, { immediate: true, deep: true });

watch(selectedWorkflowId, () => {
  selectedStepIndex.value = -1;
  showTemplatePicker.value = false;
  workflowSaveError.value = "";
  workflowSaveMessage.value = "";
  syncDraft(true);
});

watch(workflowDescription, syncWorkflowGoalEditor);
watch(createWorkflowOpen, (isOpen) => {
  if (isOpen) void nextTick(() => resizeWorkflowGoalEditor());
});

function markDirty() {
  draftIsDirty.value = true;
  workflowSaveMessage.value = "";
}

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function readinessLabel(label: string): string {
  if (label === "Workflow goal is defined") return "Goal defined";
  if (label === "Questions and capture fields are defined") return "Add at least one step";
  if (label === "No provider required") return "No provider required";
  if (label === "Completion path is defined") return "Add completion behavior";
  if (label === "Failure and handoff path is defined") return "Decide what happens if unavailable";
  if (label.endsWith(" is connected")) return label;
  return label;
}

function stepTypeLabel(type?: string): string {
  return stepTypes.find((item) => item.value === type)?.label ?? formatLabel(type || "Step");
}

function ensureStepConfig(step: WorkflowStep): Record<string, unknown> {
  if (!step.config || Array.isArray(step.config)) step.config = {};
  return step.config;
}

function stepConfigValue(step: WorkflowStep, key: string): string {
  const value = ensureStepConfig(step)[key];
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function setStepConfig(step: WorkflowStep, key: string, value: string) {
  ensureStepConfig(step)[key] = value || undefined;
  markDirty();
}

function setStepConfigFromEvent(step: WorkflowStep, key: string, event: Event) {
  setStepConfig(step, key, (event.target as HTMLInputElement | HTMLSelectElement).value);
}

function stepOptionsText(step: WorkflowStep): string {
  return (step.options ?? []).join(", ");
}

function setStepOptions(step: WorkflowStep, event: Event) {
  step.options = (event.target as HTMLInputElement).value.split(",").map((value) => value.trim()).filter(Boolean);
  markDirty();
}

function workflowFieldForStep(step: WorkflowStep): (WorkflowFieldDraft & { id?: string; visibility?: string }) | null {
  const fields = workflowDraft.value?.fields ?? [];
  return fields.find((field) => field.key === step.fieldKey || field.id === step.fieldKey) ?? null;
}

function captureAnswerType(step: WorkflowStep): WorkflowFieldDraft["type"] {
  return workflowFieldForStep(step)?.type ?? step.answerType ?? "text";
}

function captureAnswerTypeLabel(step: WorkflowStep): string {
  return answerTypes.find((type) => type.value === captureAnswerType(step))?.label ?? "Short text";
}

function captureAnswerUsesOptions(step: WorkflowStep): boolean {
  return ["select", "multi_select"].includes(captureAnswerType(step));
}

function captureOptions(step: WorkflowStep): string[] {
  const field = workflowFieldForStep(step);
  return [...(field?.options ?? step.options ?? [])];
}

function selectCaptureField(step: WorkflowStep, event: Event): void {
  const fieldKey = (event.target as HTMLSelectElement).value;
  step.fieldKey = fieldKey || undefined;
  const field = workflowFieldForStep(step);
  if (field) {
    if (!step.label || step.label === "Capture details") step.label = field.label;
    step.answerType = field.type;
    step.question = field.question;
    step.required = field.required;
    step.options = field.options ? [...field.options] : undefined;
  }
  markDirty();
}

function updateCaptureQuestion(step: WorkflowStep, event: Event): void {
  step.question = (event.target as HTMLInputElement).value;
  const field = workflowFieldForStep(step);
  if (field) field.question = step.question ?? "";
  markDirty();
}

function updateCaptureRequired(step: WorkflowStep, event: Event): void {
  const required = (event.target as HTMLInputElement).checked;
  step.required = required;
  const field = workflowFieldForStep(step);
  if (field) field.required = required;
  markDirty();
}

function setCaptureAnswerType(step: WorkflowStep, event: Event): void {
  const type = (event.target as HTMLSelectElement).value as WorkflowFieldDraft["type"];
  step.answerType = type;
  const field = workflowFieldForStep(step);
  if (field) {
    field.type = type;
    if (!captureAnswerUsesOptions({ ...step, fieldKey: field.key })) {
      delete field.options;
      delete step.options;
    } else {
      step.options = field.options ? [...field.options] : [];
    }
  }
  markDirty();
}

function setCaptureOption(step: WorkflowStep, index: number, event: Event): void {
  const options = captureOptions(step);
  options[index] = (event.target as HTMLInputElement).value;
  const field = workflowFieldForStep(step);
  if (field) field.options = [...options];
  step.options = [...options];
  markDirty();
}

function addCaptureOption(step: WorkflowStep): void {
  const options = captureOptions(step);
  options.push("New option");
  const field = workflowFieldForStep(step);
  if (field) field.options = [...options];
  step.options = [...options];
  markDirty();
}

function removeCaptureOption(step: WorkflowStep, index: number): void {
  const options = captureOptions(step);
  options.splice(index, 1);
  const field = workflowFieldForStep(step);
  if (field) {
    if (options.length) field.options = [...options];
    else delete field.options;
  }
  if (options.length) step.options = [...options];
  else delete step.options;
  markDirty();
}

function fieldKeyFromLabel(label: string, fields: Array<{ key: string }>): string {
  const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${fields.length + 1}`;
  const existing = new Set(fields.map((field) => field.key));
  let key = base;
  let suffix = 2;
  while (existing.has(key)) key = `${base}_${suffix++}`;
  return key;
}

function openCustomFieldEditor(step: WorkflowStep): void {
  const fields = workflowDraft.value?.fields ?? [];
  const suggestedLabel = step.label && step.label !== "Capture details" ? step.label : "New field";
  customFieldOpenFor.value = step.id;
  customFieldLabel.value = suggestedLabel;
  customFieldKey.value = fieldKeyFromLabel(suggestedLabel, fields);
}

function closeCustomFieldEditor(): void {
  customFieldOpenFor.value = "";
  customFieldLabel.value = "";
  customFieldKey.value = "";
}

function createCustomField(step: WorkflowStep): void {
  if (!workflowDraft.value) return;
  const label = customFieldLabel.value.trim();
  if (!label) return;
  const fields = workflowDraft.value.fields ?? (workflowDraft.value.fields = []);
  const key = customFieldKey.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || fieldKeyFromLabel(label, fields);
  const uniqueKey = fieldKeyFromLabel(key, fields);
  const type = captureAnswerType(step);
  const options = captureAnswerUsesOptions(step) ? captureOptions(step).filter((option) => option.trim()) : [];
  const question = step.question?.trim() || `What is your ${label.toLowerCase()}?`;
  const field: WorkflowFieldDraft & { id?: string; visibility?: string } = {
    id: `field-${Date.now()}`,
    key: uniqueKey,
    label,
    type,
    required: step.required !== false,
    question,
    ...(options.length ? { options } : {}),
  };
  fields.push(field);
  step.label = label;
  step.fieldKey = uniqueKey;
  step.answerType = type;
  step.question = question;
  step.required = field.required;
  step.options = options.length ? [...options] : undefined;
  closeCustomFieldEditor();
  markDirty();
}

function stepConditionText(step: WorkflowStep): string {
  return typeof step.condition === "string" ? step.condition : "";
}

function addWorkflowStep(type = "capture") {
  if (!workflowDraft.value) return;
  workflowDraft.value.steps ??= [];
  const nextIndex = workflowDraft.value.steps.length + 1;
  (workflowDraft.value.steps as WorkflowStep[]).push({
    id: `step-${Date.now()}-${nextIndex}`,
    type,
    label: stepTypeLabel(type),
    question: type === "capture" || type === "ask" ? "What should we know?" : undefined,
    required: type === "capture" || type === "ask",
    config: type === "lookup" ? { provider: workflowProvider.value || "jackrabbit", operation: "find_classes", failureBehavior: "handoff", searchFields: "location, schedule, age" } : {},
  } as WorkflowStep);
  selectedStepIndex.value = draftSteps.value.length - 1;
  markDirty();
}

function removeWorkflowStep(index: number) {
  if (!workflowDraft.value?.steps) return;
  workflowDraft.value.steps.splice(index, 1);
  selectedStepIndex.value = Math.max(0, Math.min(selectedStepIndex.value, draftSteps.value.length - 1));
  markDirty();
}

function moveWorkflowStep(index: number, direction: -1 | 1) {
  if (!workflowDraft.value?.steps) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= workflowDraft.value.steps.length) return;
  const steps = workflowDraft.value.steps;
  [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
  selectedStepIndex.value = nextIndex;
  markDirty();
}

function legacyTemplateSteps(key: string): WorkflowStep[] {
  const field = (id: string, label: string, fieldKey: string, question: string): WorkflowStep => ({ id, type: "capture", label, fieldKey, question, required: true, config: {} });
  if (key === "enrollment") {
    return [
      field("student-details", "Student details", "student_name", "What is the student’s name?"),
      field("ability", "Ability", "ability", "What can the student comfortably do today?"),
      field("goal", "Goal", "goal", "What would you like the student to work toward?"),
      field("location", "Location", "location", "Which location works best for you?"),
      field("schedule", "Schedule", "schedule", "What days or times usually work?"),
      { id: "find-classes", type: "lookup", label: "Find classes in Jackrabbit", config: { provider: "jackrabbit", operation: "find_classes", searchFields: "location, schedule, age, ability", failureBehavior: "handoff", retryCount: "2" } },
      { id: "present-options", type: "recommend", label: "Present class options", question: "Here are the best matches. Which option feels right?", config: { maxResults: "3" } },
      { id: "registration", type: "confirm", label: "Confirm registration path", question: "Would you like to continue with registration?", required: true, config: {} },
      { id: "registration-link", type: "generate_link", label: "Generate registration link", config: { provider: "jackrabbit", failureBehavior: "handoff" } },
      { id: "follow-up", type: "notify", label: "Notify staff for follow-up", config: { failureBehavior: "capture_lead" } },
    ];
  }
  if (key === "booking" || key === "tour") {
    return [field("service", "Service", "service", "What would you like to book?") , field("schedule", "Schedule", "schedule", "What day or time works best?") , { id: "availability", type: "lookup", label: "Check availability", config: { provider: "booking", operation: "get_availability", searchFields: "service, schedule", failureBehavior: "handoff" } }, { id: "select", type: "select", label: "Select a time", options: ["First available", "Morning", "Afternoon"], config: {} }, { id: "confirm", type: "confirm", label: "Confirm booking", question: "Should I reserve this time for you?", config: {} }, { id: "book", type: "book", label: "Book", config: { failureBehavior: "handoff" } }];
  }
  if (key === "service") {
    return [field("contact", "Contact", "name", "Who should we follow up with?"), field("request", "Request", "request", "What do you need help with?"), { id: "route", type: "condition", label: "Route request", condition: "If the request needs a specialist, send it to the service team.", config: {} }, { id: "save", type: "create_lead", label: "Save service request", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify staff", config: { failureBehavior: "handoff" } }, { id: "complete", type: "complete", label: "Confirm next step", config: {} }];
  }
  if (key === "quote") return [field("contact", "Contact", "name", "What is your name?"), field("requirements", "Requirements", "requirements", "What would you like a quote for?"), { id: "quote-review", type: "condition", label: "Review requirements", condition: "If requirements are complete, create a quote request.", config: {} }, { id: "save", type: "create_lead", label: "Save quote request", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify sales", config: {} }, { id: "complete", type: "complete", label: "Confirm quote follow-up", config: {} }];
  return [field("contact", "Contact", "name", "What is your name?"), field("email", "Email", "email", "What email should we use?"), field("context", "Context", "context", "What are you hoping to accomplish?"), { id: "qualify", type: "condition", label: "Qualify request", condition: "If the visitor is ready, mark the lead qualified.", config: {} }, { id: "save", type: "create_lead", label: "Save qualified lead", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify the team", config: {} }, { id: "complete", type: "complete", label: "Confirm follow-up", config: {} }];
}

function applyTemplate(key: string) {
  if (!workflowDraft.value) return;
  workflowDraft.value.steps = templateSteps(key) as unknown as Array<Record<string, unknown>>;
  setWorkflowMetadata(workflowDraft.value, workflowNameForTemplate(key));
  if (key === "enrollment") {
    workflowDraft.value.executionMode = "PROVIDER_FLOW";
    workflowDraft.value.provider = "jackrabbit";
  }
  selectedStepIndex.value = 0;
  showTemplatePicker.value = false;
  markDirty();
}

function generateStarter() {
  if (!workflowDraft.value) return;
  const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "";
  const generationContext = {
    organizationId: props.organizationId ?? props.businessContext?.organizationId,
    businessId: props.businessContext?.businessId,
    workflowId: workflowDraft.value.id,
    actionId: workflowDraft.value.id,
    contextVersion: props.businessContext?.contextVersion,
    actionType: workflowDraft.value.actionType,
    actionName: businessName ? `${businessName} workflow` : workflowDraft.value.name,
    actionDescription: businessName ? defaultBusinessWorkflowDescription() : workflowDraft.value.description,
    availableActionTypes: allActions.value.map((action) => action.actionType || action.key),
    availableProviders: props.integrations.filter((integration) => (integration as IntegrationLike).connectionStatus === "active").map((integration) => String((integration as IntegrationLike).provider ?? "")).filter(Boolean),
    knownBusinessKnowledge: props.businessContext?.knowledgeSummary?.map((item) => item.value) ?? [],
    completionGoal: String(workflowDraft.value.completion?.message ?? workflowDraft.value.completion?.linkLabel ?? ""),
    businessContext: props.businessContext ?? undefined,
  };
  workflowGenerationKey.value = workflowGenerationCacheKey(generationContext);
  const ownerGoal = workflowDraft.value.key === "enroll_child"
    ? ENROLLMENT_WORKFLOW_GOAL
    : preserveWorkflowGoal(workflowDescription.value) ?? defaultBusinessWorkflowDescription();
  const result = generateWorkflow(ownerGoal, [], generationContext);
  workflowDraft.value.description = result.description;
  workflowDraft.value.steps = result.steps as unknown as Array<Record<string, unknown>>;
  workflowDraft.value.fields = result.fields as unknown as WorkflowAction["fields"];
  setWorkflowMetadata(workflowDraft.value, result.name);
  if (result.executionMode) workflowDraft.value.executionMode = result.executionMode;
  if (result.provider) workflowDraft.value.provider = result.provider;
  selectedStepIndex.value = 0;
  markDirty();
  workflowSaveMessage.value = `${formatLabel(result.intent)} workflow generated from the owner goal. Review suggested steps and provenance before saving.`;
}

async function saveWorkflow() {
  if (!workflowDraft.value || workflowSaveLoading.value) return;
  workflowSaveLoading.value = true;
  workflowSaveError.value = "";
  workflowSaveMessage.value = "";
  try {
    const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions/${encodeURIComponent(workflowDraft.value.id)}`), {
      method: "PUT",
      headers: { "content-type": "application/json", ...props.ownerHeaders() },
      body: JSON.stringify({
        ...workflowDraft.value,
        ...(props.businessContext?.businessId ? { businessId: props.businessContext.businessId, workflowContextBusinessId: props.businessContext.businessId } : {}),
        ...(props.businessContext?.contextVersion !== undefined ? { workflowContextVersion: props.businessContext.contextVersion } : {}),
      }),
    });
    const payload = await response.json() as { error?: string; action?: WorkflowAction };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this workflow.");
    if (payload.action) workflowDraft.value = clone(payload.action);
    draftIsDirty.value = false;
    workflowSaveMessage.value = "Saved. Runtime will use the updated steps.";
    emit("refresh");
  } catch (error) {
    workflowSaveError.value = error instanceof Error ? error.message : "Could not save this workflow.";
  } finally {
    workflowSaveLoading.value = false;
  }
}

function openAction() {
  if (workflowDraft.value) emit("open-action", workflowDraft.value.id);
}

function continueSetup() {
  if (!workflowDraft.value) return;
  if (!draftSteps.value.length) {
    workflowAssistInput.value?.focus();
    return;
  }
  workflowStepList.value?.scrollIntoView({ behavior: "smooth", block: "start" });
  selectedStepIndex.value = selectedStepIndex.value >= 0 ? selectedStepIndex.value : 0;
}

async function testWorkflow() {
  if (!workflowDraft.value || workflowSaveLoading.value) return;
  if (draftIsDirty.value) {
    await saveWorkflow();
    if (workflowSaveError.value) return;
  }
  workflowTested.value = true;
  emit("test-workflow", workflowDraft.value.id);
}

async function publishWorkflow() {
  if (!workflowDraft.value || workflowSaveLoading.value) return;
  if (draftIsDirty.value) {
    await saveWorkflow();
    if (workflowSaveError.value) return;
  }
  emit("publish-workflow");
}

function configureProvider() {
  const providerIndex = draftSteps.value.findIndex((step) => step.type === "lookup" || step.type === "generate_link");
  if (providerIndex >= 0) {
    selectedStepIndex.value = providerIndex;
    workflowStepList.value?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  addWorkflowStep("lookup");
}

onMounted(() => {
  void nextTick(() => resizeWorkflowGoalEditor());
});
</script>

<template>
  <div class="view-content workflow-workspace" :data-workflow-generation-key="workflowGenerationKey || undefined">
    <div class="workflow-page-header workflow-sticky-header">
      <div class="workflow-page-heading">
        <p class="eyebrow">Workflow</p>
        <h2>{{ workflowTitle }}</h2>
        <p class="workflow-header-status"><span :class="['workflow-status-dot', { published: props.publishingStatus === 'LIVE' && !draftIsDirty }]" aria-hidden="true"></span>{{ workflowStatusSummary }}<span class="workflow-header-separator">·</span>{{ draftIsDirty ? 'Unsaved changes' : 'Last saved' }}</p>
      </div>
      <div class="toolbar-actions workflow-page-actions">
        <button class="text-button workflow-header-secondary-action" type="button" @click="emit('refresh')">Refresh</button>
        <button class="outline-button small workflow-test-button" type="button" :disabled="!workflowDraft" @click="testWorkflow">Test workflow</button>
        <button class="primary-button small" type="button" :disabled="!workflowDraft || workflowSaveLoading" @click="publishWorkflow">{{ workflowSaveLoading ? 'Saving…' : 'Publish' }}</button>
      </div>
    </div>
    <p v-if="publishError" class="form-error workflow-publish-error" role="alert">{{ publishError }}</p>

    <div :class="['workflow-layout', { 'workflow-layout-empty': !workflowActions.length }]">
      <div v-if="workflowActions.length" class="workflow-selector-bar">
        <div class="workflow-selector-copy"><p class="eyebrow">Your workflows</p><strong>{{ workflowActions.length }} configured</strong></div>
        <label class="workflow-library-select">Switch workflow<select v-model="selectedWorkflowId"><option v-for="action in workflowActions" :key="action.id" :value="action.id">{{ workflowDisplayName(action) }}</option></select></label>
        <button class="outline-button small" type="button" @click="openCreateWorkflow"><Plus :size="14" :stroke-width="1.9" aria-hidden="true" />Create workflow</button>
      </div>
      <div v-else class="workflow-empty workflow-layout-empty-state"><span class="workflow-empty-icon"><GitBranch :size="28" :stroke-width="1.8" aria-hidden="true" /></span><strong>No workflows yet.</strong><p>Build your first guided customer journey with questions, branches, provider lookups, and a clear next step.</p><button class="primary-button" type="button" @click="openCreateWorkflow"><Plus :size="16" :stroke-width="1.8" aria-hidden="true" />Create workflow</button></div>

      <main v-if="workflowDraft" class="workflow-builder">
        <section class="workflow-goal-summary" aria-labelledby="workflow-goal-heading">
          <div class="workflow-goal-summary-row"><div class="workflow-goal-icon"><Sparkles :size="17" :stroke-width="1.8" aria-hidden="true" /></div><div class="workflow-goal-copy"><p class="eyebrow">Workflow goal</p><h3 id="workflow-goal-heading">What should this workflow accomplish?</h3><p>{{ workflowDraft.description || 'Describe the customer outcome this workflow owns.' }}</p></div><button class="text-button workflow-goal-toggle" type="button" @click="workflowGoalExpanded = !workflowGoalExpanded">{{ workflowGoalExpanded ? 'Done' : 'Edit goal' }} <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
          <div v-if="workflowGoalExpanded" class="workflow-goal-editor"><textarea ref="workflowAssistInput" v-model="workflowDescription" rows="4" placeholder="Example: Ask what kind of salon they run, match verified capabilities, then offer the right next step." @input="resizeWorkflowGoalEditor($event.target as HTMLTextAreaElement)" @keydown.meta.enter="generateStarter" @keydown.ctrl.enter="generateStarter"></textarea><div class="workflow-assist-footer"><span>Include what the customer needs and what should happen next. · {{ workflowDescription.length.toLocaleString() }} characters</span><button class="primary-button small" type="button" aria-label="Generate steps" :disabled="!workflowDescription.trim()" @click="generateStarter"><Sparkles :size="14" :stroke-width="1.8" aria-hidden="true" />Generate workflow</button></div><div class="workflow-template-flow"><button class="text-button workflow-template-trigger" type="button" @click="showTemplatePicker = !showTemplatePicker">Start with a template <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></button><div v-if="showTemplatePicker" class="workflow-template-picker"><p>Choose a starting point</p><button v-for="template in workflowTemplates" :key="template.key" type="button" @click="applyTemplate(template.key)"><strong>{{ template.label }}</strong><small>{{ template.description }}</small></button></div></div></div>
          <div v-if="workflowDraft.workflowSafety?.status === 'blocked'" class="workflow-isolation-warning" role="alert"><strong>Previous draft blocked for safety.</strong><span>It referenced a different business context. Regenerate from the active Business Brain before saving.</span></div>
        </section>

        <section class="workflow-readiness-card" aria-labelledby="workflow-setup-heading">
          <div class="workflow-readiness-summary"><div class="workflow-readiness-mark" :class="{ complete: configurationComplete }"><Check v-if="configurationComplete" :size="15" :stroke-width="2.4" aria-hidden="true" /><span v-else aria-hidden="true">!</span></div><div><p class="eyebrow">Status</p><strong id="workflow-setup-heading">{{ configurationLabel }}</strong><small>{{ setupProgressLabel }}</small></div><button class="text-button workflow-readiness-toggle" type="button" :aria-expanded="setupStatusOpen" @click="setupStatusOpen = !setupStatusOpen">{{ setupStatusOpen ? 'Hide details' : 'View details' }} <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
          <div v-if="setupStatusOpen" class="workflow-readiness-details"><span v-for="item in setupChecklist" :key="item.label" :class="{ complete: item.complete, incomplete: !item.complete }"><Check v-if="item.complete" :size="14" :stroke-width="2" aria-hidden="true" /><i v-else aria-hidden="true">○</i>{{ readinessLabel(item.label) }}</span><button v-if="readinessRemaining.length" class="text-button" type="button" @click="continueSetup">Continue setup <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
        </section>

        <div ref="workflowStepList" class="workflow-step-list">
          <div class="workflow-section-heading"><div><p class="eyebrow">Main path</p><h3>Customer journey</h3><p>Follow the path your customer experiences from first question to next step.</p></div><button class="outline-button small" type="button" @click="addWorkflowStep()"><Plus :size="14" :stroke-width="1.9" aria-hidden="true" />Add step</button></div>
          <template v-for="(step, index) in workflowDisplaySteps" :key="step.id || index">
            <div v-if="index === workflowMainPathCount && workflowMainPathCount < workflowDisplaySteps.length" class="workflow-conditional-heading"><div><p class="eyebrow">Side paths</p><h4>Conditional paths</h4><p>These paths attach when the visitor asks for something specific.</p></div></div>
          <article :class="['workflow-step-card', { selected: selectedStepIndex === workflowStepIndex(step), conditional: isConditionalStep(step) }]" @click="selectedStepIndex = workflowStepIndex(step)">
            <div class="workflow-step-rail"><span>{{ workflowStepIndex(step) + 1 }}</span><i v-if="index < workflowDisplaySteps.length - 1"></i></div>
            <div class="workflow-step-body">
              <div class="workflow-step-toolbar"><div class="workflow-step-title"><GripVertical :size="16" :stroke-width="1.8" aria-hidden="true" /><input v-if="selectedStepIndex === workflowStepIndex(step)" v-model="step.label" type="text" aria-label="Workflow step label" @input="markDirty" /><strong v-else>{{ step.label || stepTypeLabel(step.type) }}</strong><span class="status-pill qualified">{{ stepTypeLabel(step.type) }}</span></div><div class="workflow-step-actions"><button class="workflow-edit-button" type="button" @click.stop="selectedStepIndex = selectedStepIndex === workflowStepIndex(step) ? -1 : workflowStepIndex(step)">{{ selectedStepIndex === workflowStepIndex(step) ? 'Done' : 'Edit' }}</button></div></div>
              <div v-if="selectedStepIndex !== workflowStepIndex(step)" class="workflow-step-summary"><span>{{ step.question || step.fieldKey || (step.type === 'condition' ? 'Add a condition' : step.type === 'lookup' ? 'Find availability with a provider' : 'Select Edit to configure this step') }}</span><span v-if="step.condition" class="workflow-summary-tag">Condition</span><span v-if="step.config?.trigger" class="workflow-summary-tag">Conditional</span><span v-if="step.type === 'lookup' || step.type === 'generate_link'" class="workflow-summary-tag">{{ formatLabel(stepConfigValue(step, 'provider') || 'Provider') }}</span><span v-if="step.config?.reviewStatus" class="workflow-summary-tag">{{ formatLabel(String(step.config.reviewStatus)) }}</span></div>
              <div v-else>
                <div v-if="step.type === 'capture'" class="workflow-capture-config">
                  <div class="workflow-step-grid">
                    <label>Step type<select v-model="step.type" @change="markDirty"><option v-for="type in stepTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
                    <div class="workflow-field-picker"><label>Field<select :value="step.fieldKey ?? ''" @change="selectCaptureField(step, $event)"><option value="">No stored field</option><option v-for="field in workflowDraft.fields ?? []" :key="field.key" :value="field.key">{{ field.label || field.key }}</option></select></label><button class="text-button workflow-create-field-button" type="button" @click.stop="openCustomFieldEditor(step)">+ Create custom field</button></div>
                    <label>Customer-facing question<input :value="step.question ?? ''" type="text" placeholder="What should the visitor answer?" @input="updateCaptureQuestion(step, $event)" /></label>
                    <label>Answer type<select :value="captureAnswerType(step)" @change="setCaptureAnswerType(step, $event)"><option v-for="type in answerTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label>
                    <label class="toggle-row"><span>Required</span><input :checked="step.required !== false" type="checkbox" @change="updateCaptureRequired(step, $event)" /></label>
                  </div>
                  <div v-if="customFieldOpenFor === step.id" class="workflow-custom-field-box"><div><p class="eyebrow">New stored field</p><strong>Create a field for this step</strong><small>Use this when the field you need is not in the list above.</small></div><div class="workflow-step-grid"><label>Field label<input v-model="customFieldLabel" type="text" placeholder="Usage type" /></label><label>Field key<input v-model="customFieldKey" type="text" placeholder="usage_type" /></label></div><div class="workflow-custom-field-actions"><button class="text-button" type="button" @click="closeCustomFieldEditor">Cancel</button><button class="primary-button small" type="button" :disabled="!customFieldLabel.trim()" @click="createCustomField(step)">Create field</button></div></div>
                  <div v-if="captureAnswerUsesOptions(step)" class="workflow-options-editor"><div class="workflow-options-heading"><div><strong>Options</strong><small>{{ captureAnswerTypeLabel(step) === 'Multi-select' ? 'Visitors can choose more than one.' : 'Visitors choose one.' }}</small></div><button class="text-button" type="button" @click.stop="addCaptureOption(step)">+ Add option</button></div><div v-if="captureOptions(step).length" class="workflow-option-list"><div v-for="(option, optionIndex) in captureOptions(step)" :key="`${step.id}-option-${optionIndex}`" class="workflow-option-row"><input :value="option" type="text" placeholder="Option" @input="setCaptureOption(step, optionIndex, $event)" /><button type="button" aria-label="Remove option" @click.stop="removeCaptureOption(step, optionIndex)"><X :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div></div><p v-else class="form-help">Add at least two options so visitors can answer this question.</p></div>
                </div>
                <div v-else class="workflow-step-grid"><label>Step type<select v-model="step.type" @change="markDirty"><option v-for="type in stepTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><label v-if="step.type === 'ask' || step.type === 'form'">Field<select v-model="step.fieldKey" @change="markDirty"><option value="">No stored field</option><option v-for="field in workflowDraft.fields ?? []" :key="field.key" :value="field.key">{{ field.label || field.key }}</option></select></label><label v-if="step.type === 'ask' || step.type === 'form' || step.type === 'recommend' || step.type === 'confirm'">Customer-facing question<input v-model="step.question" type="text" placeholder="What should the assistant ask?" @input="markDirty" /></label><label v-if="step.type === 'ask' || step.type === 'form'" class="toggle-row"><span>Required</span><input v-model="step.required" type="checkbox" @change="markDirty" /></label></div>
                <label v-if="step.type === 'select' || step.type === 'recommend'">Options <span class="optional">comma separated</span><input :value="stepOptionsText(step)" type="text" placeholder="Option one, Option two" @input="setStepOptions(step, $event)" /></label>
                <div v-if="step.type === 'condition'" class="workflow-condition-box"><span class="workflow-condition-icon"><GitBranch :size="15" :stroke-width="1.8" aria-hidden="true" /></span><label>Condition in plain English<textarea v-model="step.condition" rows="2" placeholder="If the visitor is ready to register, continue to the provider lookup." @input="markDirty"></textarea></label></div>
                <div v-if="step.type === 'lookup' || step.type === 'generate_link'" class="workflow-provider-box"><div class="workflow-provider-heading"><div><p class="eyebrow">Provider</p><strong>{{ step.type === 'lookup' ? 'Find availability' : 'Complete with provider' }}</strong></div><span :class="['status-pill', providerConnected ? 'booked' : 'new']">{{ providerConnected ? 'Connected' : 'Needs connection' }}</span></div><div class="workflow-step-grid"><label>Provider<select :value="stepConfigValue(step, 'provider')" @change="setStepConfigFromEvent(step, 'provider', $event)"><option value="">Select provider…</option><option value="jackrabbit">Jackrabbit</option><option value="booking">Booking provider</option><option value="crm">CRM / automation</option></select></label><label v-if="step.type === 'lookup'">Operation<select :value="stepConfigValue(step, 'operation')" @change="setStepConfigFromEvent(step, 'operation', $event)"><option value="find_locations">Find locations</option><option value="find_classes">Find classes</option><option value="get_availability">Get availability</option><option value="get_class_price">Get class price</option></select></label><label v-if="step.type === 'lookup'">Search fields<input :value="stepConfigValue(step, 'searchFields')" type="text" placeholder="location, schedule, age" @input="setStepConfigFromEvent(step, 'searchFields', $event)" /></label></div><small class="form-help">We’ll use the provider for this step and explain what happens if it is unavailable.</small></div>
                <details class="workflow-advanced-settings" :open="stepAdvancedOpen"><summary @click.prevent="stepAdvancedOpen = !stepAdvancedOpen">Advanced <span>{{ stepAdvancedOpen ? 'Hide' : 'Show' }}</span></summary><div class="workflow-step-footer"><label>If this step fails<select :value="stepConfigValue(step, 'failureBehavior')" @change="setStepConfigFromEvent(step, 'failureBehavior', $event)"><option value="handoff">Hand off to staff</option><option value="capture_lead">Save details and follow up</option><option value="retry">Retry automatically</option><option value="stop">Stop and explain</option></select></label><label>Next step<select v-model="step.nextStepId" @change="markDirty"><option value="">Continue in order</option><option v-for="nextStep in draftSteps.filter((candidate) => candidate.id !== step.id)" :key="nextStep.id" :value="nextStep.id">{{ nextStep.label || nextStep.id }}</option></select></label></div><div class="workflow-step-management"><button type="button" :disabled="workflowStepIndex(step) === 0" @click.stop="moveWorkflowStep(workflowStepIndex(step), -1)">Move up</button><button type="button" :disabled="workflowStepIndex(step) === draftSteps.length - 1" @click.stop="moveWorkflowStep(workflowStepIndex(step), 1)">Move down</button><button class="danger-text" type="button" @click.stop="removeWorkflowStep(workflowStepIndex(step))">Delete step</button></div><details class="workflow-technical-details"><summary>Technical details <span>Show</span></summary><div><code>{{ step.id || 'generated-step' }}</code><code>type: {{ step.type }}</code><pre>{{ JSON.stringify(step.config || {}, null, 2) }}</pre></div></details></details>
              </div>
            </div>
          </article>
          </template>
          <div v-if="!draftSteps.length" class="workflow-empty workflow-empty-builder"><strong>No steps yet.</strong><p>Describe the workflow above and generate steps, or add one manually.</p><div class="workflow-empty-actions"><button class="primary-button small" type="button" :disabled="!workflowDescription.trim()" @click="generateStarter"><Sparkles :size="14" :stroke-width="1.8" aria-hidden="true" />Generate workflow</button><button class="outline-button small" type="button" @click="addWorkflowStep()"><Plus :size="14" :stroke-width="1.8" aria-hidden="true" />Add step</button></div></div>
        </div>

        <section class="workflow-advanced-card" aria-labelledby="workflow-advanced-heading">
          <button class="workflow-advanced-toggle" type="button" :aria-expanded="workflowAdvancedOpen" @click="workflowAdvancedOpen = !workflowAdvancedOpen"><span><p class="eyebrow">Advanced</p><strong id="workflow-advanced-heading">Provider, fallback, and completion</strong><small>{{ providerSummary }} · {{ completionSummary }}</small></span><span class="workflow-advanced-toggle-action">{{ workflowAdvancedOpen ? 'Hide' : 'Show' }} <ChevronDown :size="15" :stroke-width="1.8" aria-hidden="true" /></span></button>
          <div v-if="workflowAdvancedOpen" class="workflow-advanced-content">
            <div class="workflow-advanced-row"><div><span class="workflow-advanced-label">Provider</span><strong>{{ providerSummary }}</strong><small>{{ providerStep ? 'Used for live availability or external actions.' : 'Optional for a workflow that only asks questions and routes visitors.' }}</small></div><button v-if="!providerStep" class="outline-button small" type="button" @click="configureProvider">Add provider</button><button v-else class="text-button" type="button" @click="selectedStepIndex = draftSteps.findIndex((step) => step.id === providerStep?.id)">Edit provider step</button></div>
            <div class="workflow-advanced-row"><div><span class="workflow-advanced-label">Fallback behavior</span><strong>{{ providerStep ? formatLabel(providerFailureBehavior) : 'Use the configured handoff path' }}</strong><small>Keep the visitor moving when a provider or step is unavailable.</small></div><select v-if="providerStep" :value="providerFailureBehavior" @change="setStepConfigFromEvent(providerStep, 'failureBehavior', $event)"><option value="capture_lead">Capture the request and notify the team</option><option value="handoff">Hand off to staff</option><option value="retry">Retry automatically</option><option value="stop">Stop and explain</option></select></div>
            <div class="workflow-advanced-row"><div><span class="workflow-advanced-label">Completion behavior</span><strong>{{ completionSummary }}</strong><small>What the visitor sees after the journey reaches its outcome.</small></div><button class="text-button" type="button" @click="openAction">Edit action settings</button></div>
          </div>
        </section>
      </main>

    </div>

    <p v-if="workflowSaveError" class="form-error">{{ workflowSaveError }}</p><p v-if="workflowSaveMessage" class="saved-message">✓ {{ workflowSaveMessage }}</p><div v-if="workflowDraft && workflowDraft.readiness?.ready === false" class="workflow-save-note"><X :size="15" :stroke-width="1.8" aria-hidden="true" /> This workflow is still in setup. Review the readiness checklist before making the action primary.</div>

    <div v-if="createWorkflowOpen" class="workflow-modal-backdrop" role="presentation" @click.self="closeCreateWorkflow">
      <section class="workflow-create-modal" role="dialog" aria-modal="true" aria-labelledby="create-workflow-title">
        <button class="workflow-modal-close" type="button" aria-label="Close" @click="closeCreateWorkflow">×</button>
        <p class="eyebrow">Workflows</p>
        <h2 id="create-workflow-title">Create workflow</h2>
        <h3 class="workflow-modal-question">What should this workflow help with?</h3>
        <p class="workflow-modal-copy">Choose how this workflow should help visitors. You’ll stay in Workflows while it is generated and configured.</p>

        <div class="workflow-create-choice-list" role="tablist" aria-label="Workflow starting point">
          <button type="button" :class="['workflow-create-choice', { selected: createWorkflowMode === 'action' }]" @click="selectCreateWorkflowMode('action')"><span class="workflow-choice-radio" aria-hidden="true"></span><span><strong>Use an existing action</strong><small>Connect the journey to an action that already exists.</small></span></button>
          <button type="button" :class="['workflow-create-choice', { selected: createWorkflowMode === 'template' }]" @click="selectCreateWorkflowMode('template')"><span class="workflow-choice-radio" aria-hidden="true"></span><span><strong>Start from a template</strong><small>Begin with a proven path for booking, qualification, enrollment, or service.</small></span></button>
          <button type="button" :class="['workflow-create-choice', { selected: createWorkflowMode === 'describe' }]" @click="selectCreateWorkflowMode('describe')"><span class="workflow-choice-radio" aria-hidden="true"></span><span><strong>Describe it in plain English</strong><small>Explain the outcome and let FrontDeskWise suggest the steps.</small></span></button>
        </div>

        <div class="workflow-create-fields">
          <label v-if="createWorkflowMode === 'action' || createWorkflowMode === 'template' || createWorkflowMode === 'describe'">Action <span class="optional">what the assistant can do</span><select v-model="createWorkflowActionId"><option value="" disabled>Choose an action…</option><option v-for="action in eligibleActions" :key="action.id" :value="action.id">{{ action.name }}</option></select></label>
          <div v-if="!eligibleActions.length" class="workflow-create-empty"><strong>No eligible actions yet.</strong><span>Create one inline, then continue without leaving Workflows.</span></div>
          <button class="workflow-inline-action-button" type="button" @click="openNewActionFlow"><Plus :size="15" :stroke-width="1.9" aria-hidden="true" /> Create new action</button>
          <label v-if="createWorkflowMode === 'template'">Template <select v-model="createWorkflowTemplateKey" @change="createWorkflowDescription = workflowNameForTemplate(createWorkflowTemplateKey)"><option v-for="template in workflowTemplates" :key="template.key" :value="template.key">{{ template.label }}</option></select></label>
        <label v-if="createWorkflowMode === 'describe' || createWorkflowMode === 'action'">Workflow goal <textarea v-model="createWorkflowDescription" rows="4" placeholder="Describe the customer journey this workflow should complete…" @input="resizeWorkflowGoalEditor($event.target as HTMLTextAreaElement)"></textarea><small class="workflow-goal-count">{{ createWorkflowDescription.length.toLocaleString() }} characters</small></label>
        </div>

        <div v-if="createNewActionOpen" class="workflow-new-action-panel">
          <div><p class="eyebrow">Inline action</p><h3>Create a new action</h3><p>This action will be created for this business and selected for the workflow.</p></div>
          <label>Action name<input v-model="createNewActionName" type="text" maxlength="120" placeholder="Request a quote" /></label>
          <label>Description <span class="optional">optional</span><textarea v-model="createNewActionDescription" rows="2" placeholder="What should the assistant do when the visitor is ready?"></textarea></label>
          <div class="workflow-modal-actions"><button class="outline-button small" type="button" @click="closeNewActionFlow">Back</button><button class="primary-button small" type="button" :disabled="createWorkflowLoading || !createNewActionName.trim()" @click="createInlineAction">{{ createWorkflowLoading ? 'Creating…' : 'Create action' }}</button></div>
        </div>

        <p v-if="createWorkflowError" class="form-error">{{ createWorkflowError }}</p>
        <div v-if="!createNewActionOpen" class="workflow-modal-actions"><button class="outline-button small" type="button" @click="closeCreateWorkflow">Cancel</button><button class="primary-button small" type="button" :disabled="createWorkflowLoading || !createWorkflowActionId" @click="createWorkflow">{{ createWorkflowLoading ? 'Creating…' : 'Create workflow' }}</button></div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.workflow-workspace { gap: 18px; }
.workflow-page-header, .workflow-builder-heading, .workflow-section-heading, .workflow-provider-heading, .workflow-step-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.workflow-page-header h2, .workflow-builder-heading h2, .workflow-model-banner h3, .workflow-section-heading h3 { margin: 3px 0 5px; }
.workflow-page-header p:not(.eyebrow), .workflow-builder-heading p:not(.eyebrow), .workflow-model-banner p:not(.eyebrow), .workflow-section-heading p:not(.eyebrow) { max-width: 720px; margin: 0; color: var(--muted-text, #64748b); }
.workflow-model-banner { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border: 1px solid #dbe5f0; border-radius: 14px; background: linear-gradient(120deg, #f4f8ff, #f8fbff); }
.workflow-model-icon, .workflow-assist-icon, .workflow-empty-icon, .workflow-condition-icon { display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; color: #2563eb; border-radius: 11px; background: #e7efff; }
.workflow-model-banner > div:nth-child(2) { flex: 1; }
.workflow-layout { display: grid; grid-template-columns: minmax(220px, 250px) minmax(0, 1fr); align-items: start; gap: 24px; }
.workflow-library { padding: 16px; }
.workflow-library .panel-heading { margin-bottom: 12px; }
.workflow-library-item { display: flex; align-items: center; width: 100%; gap: 9px; padding: 11px 9px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: inherit; text-align: left; cursor: pointer; }
.workflow-library-item:hover, .workflow-library-item.active { border-color: #c7d8f7; background: #f5f8ff; }
.workflow-library-item > span:nth-child(2) { display: grid; flex: 1; gap: 2px; min-width: 0; }
.workflow-library-item strong, .workflow-library-item small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-library-item small { color: #718096; font-size: 11px; }
.workflow-library-item-icon { display: grid; place-items: center; width: 28px; height: 28px; color: #3859a8; border-radius: 8px; background: #e8efff; }
.workflow-template-section { padding-top: 18px; margin-top: 15px; border-top: 1px solid #e7edf4; }
.workflow-template-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.workflow-template-chips button { padding: 6px 8px; border: 1px solid #d9e3ef; border-radius: 999px; background: #fff; color: #37506d; font-size: 11px; cursor: pointer; }
.workflow-template-chips button:hover { border-color: #8eb0ec; color: #1f4da4; }
.workflow-builder { min-width: 0; }
.workflow-builder-heading { padding: 4px 2px 12px; }
.workflow-goal-preview { max-width: 68ch; margin: 0; }
.workflow-goal-preview p { max-width: none !important; max-height: none !important; margin: 0 !important; overflow: hidden !important; white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
.workflow-goal-preview p.expanded { display: block; max-height: 260px !important; overflow: auto !important; }
.workflow-goal-preview .text-button { margin-top: 7px; padding: 0; color: #315ba9; font-size: 11px; }
.workflow-link-summary { display: flex; flex-wrap: wrap; gap: 7px; margin-top: 12px; }
.workflow-link-summary span { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 1px solid #dce6f2; border-radius: 7px; background: #f8fbff; color: #4f6682; font-size: 11px; }
.workflow-link-summary strong { color: #263f65; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
.workflow-builder-actions { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.workflow-assist-card { display: flex; align-items: center; gap: 11px; padding: 12px 14px; margin-bottom: 13px; border: 1px solid #e2d9ff; border-radius: 12px; background: #fbf9ff; }
.workflow-assist-card > div:nth-child(2) { min-width: 190px; }
.workflow-assist-card p { margin: 3px 0 0; color: #73708b; font-size: 12px; }
.workflow-assist-card input { flex: 1; min-width: 120px; }
.workflow-readiness-card { padding: 14px; margin-bottom: 15px; border: 1px solid #dfe7f0; border-radius: 12px; background: #fff; }
.workflow-readiness-card h3 { margin: 3px 0 0; font-size: 15px; }
.workflow-readiness-list { display: flex; flex-wrap: wrap; gap: 7px 14px; margin-top: 12px; }
.workflow-readiness-list span { display: inline-flex; align-items: center; gap: 5px; color: #7b8797; font-size: 12px; }
.workflow-readiness-list span svg { color: #b1bcc9; }
.workflow-readiness-list span.complete { color: #26734d; }
.workflow-readiness-list span.complete svg { color: #2c9d68; }
.workflow-section-heading { margin-bottom: 10px; }
.workflow-step-card { display: flex; gap: 12px; padding: 13px 13px 13px 0; margin-bottom: 10px; border: 1px solid #e0e7ef; border-radius: 13px; background: #fff; transition: border-color .15s ease, box-shadow .15s ease; }
.workflow-step-card.selected { border-color: #a9c1f1; box-shadow: 0 5px 18px rgba(42, 78, 140, .08); }
.workflow-step-rail { display: flex; flex-direction: column; align-items: center; width: 35px; }
.workflow-step-rail span { display: grid; place-items: center; width: 25px; height: 25px; border-radius: 50%; background: #e8efff; color: #2e5bb3; font-size: 12px; font-weight: 700; }
.workflow-step-rail i { width: 1px; flex: 1; margin-top: 6px; background: #dbe5f0; }
.workflow-step-body { flex: 1; min-width: 0; }
.workflow-step-title { display: flex; align-items: center; flex: 1; min-width: 0; gap: 7px; color: #91a0b2; }
.workflow-step-title input { min-width: 0; padding: 4px 6px; border: 0; background: transparent; color: #14253a; font-weight: 700; }
.workflow-step-title input:focus { outline: 1px solid #a9c1f1; border-radius: 5px; }
.workflow-step-actions { display: flex; gap: 4px; }
.workflow-step-actions button { display: grid; place-items: center; width: 25px; height: 25px; padding: 0; border: 1px solid #dce4ed; border-radius: 6px; background: #fff; color: #61728a; cursor: pointer; }
.workflow-step-actions button:hover:not(:disabled) { border-color: #93afe5; color: #2458b2; }
.workflow-step-actions button:disabled { cursor: not-allowed; opacity: .4; }
.workflow-step-grid { display: grid; grid-template-columns: minmax(130px, .85fr) minmax(130px, 1fr); gap: 10px; margin-top: 11px; }
.workflow-step-grid label:last-child:nth-child(3) { grid-column: 1 / -1; }
.workflow-step-grid .toggle-row { align-self: end; }
.workflow-step-body label, .workflow-step-footer label { display: grid; gap: 5px; color: #4d6077; font-size: 11px; font-weight: 600; }
.workflow-step-body input, .workflow-step-body select, .workflow-step-body textarea { width: 100%; box-sizing: border-box; }
.workflow-field-picker { display: grid; align-content: start; gap: 5px; }
.workflow-field-picker > label { min-width: 0; }
.workflow-create-field-button { justify-self: start; padding: 0; color: #315ba9; font-size: 10px; }
.workflow-custom-field-box { display: grid; gap: 10px; padding: 12px; margin-top: 11px; border: 1px solid #d5e2f4; border-radius: 10px; background: #f7faff; }
.workflow-custom-field-box > div:first-child { display: grid; gap: 3px; }
.workflow-custom-field-box strong { color: #304563; font-size: 12px; }
.workflow-custom-field-box small { color: #7b8ba0; font-size: 10px; line-height: 1.4; }
.workflow-custom-field-box .workflow-step-grid { margin-top: 0; }
.workflow-custom-field-actions { display: flex; justify-content: flex-end; align-items: center; gap: 10px; }
.workflow-custom-field-actions .text-button { padding: 5px 0; }
.workflow-options-editor { display: grid; gap: 9px; padding: 12px; margin-top: 11px; border: 1px solid #e4ebf3; border-radius: 10px; background: #fbfcfe; }
.workflow-options-heading { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.workflow-options-heading > div { display: grid; gap: 2px; }
.workflow-options-heading strong { color: #4d6077; font-size: 11px; }
.workflow-options-heading small { color: #8290a1; font-size: 10px; font-weight: 500; }
.workflow-options-heading .text-button { padding: 0; font-size: 10px; }
.workflow-option-list { display: grid; gap: 7px; }
.workflow-option-row { display: flex; align-items: center; gap: 7px; }
.workflow-option-row input { flex: 1; min-width: 0; }
.workflow-option-row button { display: inline-grid; place-items: center; width: 28px; height: 30px; padding: 0; border: 1px solid #dfe6ef; border-radius: 7px; color: #9aa8b8; background: #fff; cursor: pointer; }
.workflow-option-row button:hover { color: #b34135; border-color: #edc7c2; background: #fff9f8; }
.workflow-condition-box, .workflow-provider-box { padding: 11px; margin-top: 11px; border-radius: 10px; background: #f8fafc; border: 1px solid #e4ebf3; }
.workflow-condition-box { display: flex; gap: 9px; }
.workflow-condition-box label { flex: 1; }
.workflow-provider-heading { align-items: center; margin-bottom: 9px; }
.workflow-provider-heading strong { display: block; margin-top: 2px; }
.workflow-step-footer { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; padding-top: 11px; margin-top: 11px; border-top: 1px solid #edf1f5; }
.workflow-technical-details { margin-top: 10px; color: #65758a; font-size: 11px; }
.workflow-technical-details summary { cursor: pointer; list-style: none; }
.workflow-technical-details summary::-webkit-details-marker { display: none; }
.workflow-technical-details summary span { float: right; color: #3c6ac0; }
.workflow-technical-details div { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 8px; }
.workflow-technical-details code { padding: 3px 5px; border-radius: 4px; background: #f1f5f9; }
.workflow-technical-details pre { width: 100%; padding: 8px; overflow: auto; border-radius: 7px; background: #101827; color: #c7dcff; }
.workflow-empty { display: grid; justify-items: start; gap: 8px; padding: 25px 8px; color: #65758a; }
.workflow-empty strong { color: #263950; }
.workflow-empty p { margin: 0; font-size: 12px; line-height: 1.45; }
.workflow-empty-builder { justify-items: center; text-align: center; border: 1px dashed #c9d6e6; border-radius: 12px; }
.workflow-save-note { display: flex; align-items: center; gap: 7px; padding: 9px 11px; border: 1px solid #f2d6a3; border-radius: 9px; background: #fff9ed; color: #8b5b18; font-size: 12px; }
.workflow-model-banner { position: relative; padding-right: 92px; }
.workflow-model-banner > .text-button { position: absolute; top: 16px; right: 18px; }
.workflow-library { min-height: 100%; }
.workflow-library .panel-heading { align-items: center; }
.workflow-library .panel-heading .outline-button { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.workflow-template-trigger { display: inline-flex; align-items: center; gap: 5px; padding: 0; color: #315ba9; font-size: 11px; font-weight: 800; }
.workflow-template-picker { display: grid; gap: 5px; padding-top: 10px; }
.workflow-template-picker p { margin: 0 0 2px; color: #8996a8; font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .08em; }
.workflow-template-picker button { display: grid; gap: 3px; padding: 8px 9px; border: 1px solid #e1e8f2; border-radius: 8px; background: #fff; color: #37506d; text-align: left; cursor: pointer; }
.workflow-template-picker button:hover { border-color: #a9c4f1; background: #f7faff; }
.workflow-template-picker strong { font-size: 11px; }
.workflow-template-picker small { color: #8290a1; font-size: 10px; line-height: 1.35; }
.workflow-assist-card { display: grid; grid-template-columns: auto minmax(190px, 1fr) minmax(240px, 1.4fr) auto; align-items: center; gap: 12px; padding: 17px; border-color: #d8ccff; background: linear-gradient(120deg, #fbf9ff, #f8fbff); }
.workflow-assist-copy h3 { margin: 2px 0 3px; color: #1e3151; font-size: 16px; }
.workflow-assist-copy .eyebrow { color: #6d53c4; }
.workflow-assist-copy p:not(.eyebrow) { margin: 0; }
.workflow-assist-card textarea { width: 100%; min-height: 56px; box-sizing: border-box; resize: vertical; padding: 10px 11px; border: 1px solid #cad8ea; border-radius: 9px; outline: none; color: #263950; background: #fff; font: inherit; font-size: 12px; line-height: 1.4; }
.workflow-assist-card textarea:focus { border-color: #86aef0; box-shadow: 0 0 0 3px rgba(61, 116, 219, .1); }
.workflow-assist-card .primary-button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; white-space: nowrap; }
.workflow-readiness-card { display: grid; grid-template-columns: minmax(180px, .75fr) minmax(0, 1.6fr) auto; align-items: center; gap: 14px; }
.workflow-readiness-list { margin-top: 0; }
.workflow-readiness-list span { line-height: 1.35; }
.workflow-readiness-list span i { width: 14px; color: #a8b4c2; font-style: normal; font-size: 14px; }
.workflow-readiness-card > .text-button { display: inline-flex; align-items: center; gap: 4px; white-space: nowrap; }
.workflow-provider-summary { padding: 13px 14px; margin-bottom: 18px; border: 1px solid #dfe7f0; border-radius: 12px; background: #fff; }
.workflow-provider-summary-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.workflow-provider-summary-heading h3 { margin: 3px 0 0; font-size: 15px; }
.workflow-provider-summary-detail { display: flex; align-items: center; gap: 10px; padding-top: 11px; margin-top: 11px; border-top: 1px solid #edf1f5; color: #64758a; font-size: 11px; }
.workflow-provider-summary-detail span { flex: 1; }
.workflow-provider-summary-detail select { max-width: 290px; }
.workflow-provider-summary-detail .outline-button { white-space: nowrap; }
.workflow-step-summary { display: flex; align-items: center; gap: 7px; min-height: 28px; margin-top: 5px; color: #64758a; font-size: 12px; }
.workflow-step-summary > span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-summary-tag { flex: 0 0 auto; padding: 4px 6px; border-radius: 5px; background: #f1f5fa; color: #728197; font-size: 10px; }
.workflow-test-status { color: #8b5b18 !important; }
.workflow-edit-button { width: auto !important; padding: 0 8px !important; color: #315ba9 !important; font-size: 10px; font-weight: 800; }
.workflow-advanced-settings { margin-top: 11px; padding-top: 10px; border-top: 1px solid #edf1f5; color: #65758a; font-size: 11px; }
.workflow-advanced-settings > summary { cursor: pointer; list-style: none; color: #315ba9; font-weight: 800; }
.workflow-advanced-settings > summary::-webkit-details-marker { display: none; }
.workflow-advanced-settings > summary span { float: right; color: #8290a1; font-weight: 600; }
.workflow-modal-backdrop { position: fixed; z-index: 45; inset: 0; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(20, 35, 61, .32); }
.workflow-create-modal { position: relative; width: min(620px, 100%); max-height: min(760px, calc(100vh - 40px)); overflow: auto; padding: 28px; border: 1px solid #dbe5f0; border-radius: 18px; background: #fff; box-shadow: 0 22px 70px rgba(20, 42, 74, .22); }
.workflow-modal-close { position: absolute; top: 17px; right: 20px; width: 30px; height: 30px; border: 0; border-radius: 8px; background: transparent; color: #6b7b90; font-size: 24px; line-height: 1; cursor: pointer; }
.workflow-modal-close:hover { background: #f1f5f9; color: #253b5d; }
.workflow-create-modal h2 { margin: 4px 35px 7px 0; color: #1e3151; font-size: 27px; letter-spacing: -.045em; }
.workflow-modal-question { margin: 0 0 6px; color: #304c70; font-size: 15px; }
.workflow-modal-copy { max-width: 500px; margin: 0 0 21px; color: #71839a; font-size: 13px; line-height: 1.5; }
.workflow-create-choice-list { display: grid; gap: 8px; }
.workflow-create-choice { display: flex; align-items: flex-start; gap: 10px; width: 100%; padding: 12px; border: 1px solid #dfe7f0; border-radius: 10px; background: #fff; color: #2b405e; text-align: left; cursor: pointer; }
.workflow-create-choice:hover, .workflow-create-choice.selected { border-color: #9db9ed; background: #f7faff; }
.workflow-choice-radio { display: block; flex: 0 0 auto; width: 15px; height: 15px; margin-top: 1px; border: 1px solid #a7b8ce; border-radius: 50%; background: #fff; box-shadow: inset 0 0 0 3px #fff; }
.workflow-create-choice.selected .workflow-choice-radio { border-color: #2f6fd3; background: #2f6fd3; }
.workflow-create-choice span:last-child { display: grid; gap: 3px; }
.workflow-create-choice strong { color: #29466d; font-size: 12px; }
.workflow-create-choice small { color: #788ba3; font-size: 11px; line-height: 1.4; }
.workflow-create-fields { display: grid; gap: 13px; margin-top: 18px; }
.workflow-create-fields > label, .workflow-new-action-panel > label { display: grid; gap: 6px; color: #4d6077; font-size: 11px; font-weight: 700; }
.workflow-create-fields select, .workflow-create-fields textarea, .workflow-new-action-panel input, .workflow-new-action-panel textarea { width: 100%; box-sizing: border-box; padding: 10px 11px; border: 1px solid #cbd9e8; border-radius: 8px; color: #263950; background: #fff; font: inherit; font-size: 12px; font-weight: 500; }
.workflow-create-fields textarea, .workflow-new-action-panel textarea { resize: vertical; line-height: 1.45; }
.workflow-inline-action-button { display: inline-flex; align-items: center; gap: 6px; justify-self: start; padding: 0; border: 0; background: transparent; color: #2d63b6; font-size: 11px; font-weight: 800; cursor: pointer; }
.workflow-inline-action-button:hover { text-decoration: underline; }
.workflow-create-empty { display: grid; gap: 3px; padding: 11px 12px; border: 1px dashed #cbd9e8; border-radius: 9px; background: #fbfdff; color: #71839a; font-size: 11px; }
.workflow-create-empty strong { color: #304c70; font-size: 12px; }
.workflow-new-action-panel { display: grid; gap: 13px; padding: 15px; margin-top: 17px; border: 1px solid #cfdcf0; border-radius: 11px; background: #f8fbff; }
.workflow-new-action-panel h3 { margin: 3px 0 3px; color: #29466d; font-size: 15px; }
.workflow-new-action-panel p:not(.eyebrow) { margin: 0; color: #71839a; font-size: 11px; line-height: 1.4; }
.workflow-modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 21px; }
@media (max-width: 1260px) { .workflow-layout { grid-template-columns: 215px minmax(0, 1fr); } .workflow-assist-card { grid-template-columns: auto minmax(150px, 1fr) minmax(180px, 1.2fr) auto; } }
@media (max-width: 820px) { .workflow-layout { display: block; } .workflow-library, .workflow-builder { margin-bottom: 15px; } .workflow-model-banner, .workflow-assist-card { align-items: flex-start; flex-wrap: wrap; } .workflow-assist-card { display: flex; } .workflow-assist-card textarea { flex-basis: 100%; } .workflow-readiness-card { display: block; } .workflow-readiness-card > .text-button { margin-top: 12px; } .workflow-provider-summary-detail { align-items: flex-start; flex-direction: column; } .workflow-provider-summary-detail select { max-width: none; width: 100%; } .workflow-page-header, .workflow-builder-heading { flex-direction: column; } }
@media (max-width: 560px) { .workflow-modal-backdrop { align-items: flex-end; padding: 0; } .workflow-create-modal { max-height: calc(100vh - 16px); padding: 24px 18px 20px; border-radius: 17px 17px 0 0; } }
/* Keep the editor readable while the workflow library remains in view. */
/* Calm owner-facing hierarchy */
.workflow-workspace { display: grid; gap: 30px; padding-top: 32px; }
.workflow-page-header { align-items: flex-end; }
.workflow-page-header h2 { font-size: 28px; letter-spacing: -.045em; }
.workflow-page-header p:not(.eyebrow) { margin-top: 8px; font-size: 13px; line-height: 1.55; }
.workflow-page-actions { align-items: center; gap: 12px; }
.workflow-page-actions .text-button { padding: 8px 2px; color: #6f7f93; font-size: 12px; font-weight: 650; }
.workflow-page-actions .text-button:hover { color: #315ba9; }
.workflow-page-actions .save-clean { color: #297459; border-color: #cce7db; background: #f3fbf7; box-shadow: none; }
.workflow-page-actions .save-clean:disabled { opacity: 1; cursor: default; }
.workflow-model-banner { min-height: 0; padding: 14px 18px; border: 1px solid #e4ebf4; border-radius: 13px; background: #f7faff; box-shadow: none; }
.workflow-model-banner h3 { font-size: 14px; }
.workflow-model-banner p:not(.eyebrow) { font-size: 12px; line-height: 1.45; }
.workflow-model-banner .workflow-model-icon { width: 34px; height: 34px; border-radius: 10px; color: #5576b3; background: #eaf1fc; }
.workflow-model-banner > .text-button { top: 13px; right: 16px; color: #65758a; font-size: 11px; font-weight: 650; }
.workflow-layout { grid-template-columns: minmax(220px, 250px) minmax(0, 1fr); gap: clamp(22px, 2.4vw, 36px); }
.workflow-library { padding: 4px 0; border: 0; background: transparent; box-shadow: none; }
.workflow-library .panel-heading { padding: 0 2px 12px; border-bottom: 1px solid #e8edf3; }
.workflow-library .panel-heading h3 { margin: 3px 0 0; color: #304563; font-size: 14px; }
.workflow-library .panel-heading .outline-button { font-size: 11px; }
.workflow-library-item { min-height: 54px; padding: 10px 8px; border-color: transparent; border-radius: 9px; }
.workflow-library-item:hover { border-color: transparent; background: #f5f8fc; }
.workflow-library-item.active { border-color: #dce7f7; background: #eef5ff; }
.workflow-library-item-icon { width: 26px; height: 26px; color: #5573ac; background: #e8f0ff; }
.workflow-library-item.active .workflow-library-item-icon { color: #2f66c6; background: #dceaff; }
.workflow-library-item small { font-size: 10px; }
.workflow-library-select { display: none; }
.workflow-builder { display: grid; gap: 24px; }
.workflow-builder-heading { padding: 0 2px; align-items: center; }
.workflow-builder-heading h2 { margin: 4px 0 6px; font-size: 24px; letter-spacing: -.04em; }
.workflow-builder-heading p:not(.eyebrow) { font-size: 13px; line-height: 1.5; }
.workflow-builder-actions { align-items: center; }
.workflow-status-group { display: inline-flex; align-items: center; gap: 8px; padding-left: 4px; }
.workflow-mode-label { color: #8290a1; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.workflow-workspace .workflow-builder-actions .status-pill,
.workflow-workspace .workflow-step-title .status-pill,
.workflow-workspace .workflow-provider-summary .status-pill { border: 0; background: #f1f4f8; color: #77869a; font-size: 10px; font-weight: 700; }
.workflow-workspace .workflow-builder-actions .status-pill.new { background: #fff5df; color: #9a6b1e; }
.workflow-workspace .workflow-provider-summary .status-pill.booked { background: #e8f7f1; color: #2c805f; }
.workflow-assist-card { display: grid; grid-template-columns: minmax(0, 1fr); gap: 18px; padding: 24px; margin: 0; border: 1px solid #ded4ff; border-radius: 16px; background: linear-gradient(135deg, #fbf9ff 0%, #f8fbff 100%); box-shadow: 0 10px 28px rgba(95, 73, 166, .07); }
.workflow-assist-heading { display: flex; align-items: flex-start; gap: 13px; }
.workflow-assist-icon { width: 42px; height: 42px; border-radius: 12px; color: #6b52c5; background: #eee8ff; }
.workflow-assist-copy { min-width: 0; }
.workflow-assist-copy h3 { margin: 2px 0 5px; color: #243758; font-size: 18px; letter-spacing: -.025em; }
.workflow-assist-copy p:not(.eyebrow) { color: #717d91; font-size: 12px; line-height: 1.5; }
.workflow-assist-card textarea { min-height: 112px; max-height: 280px; padding: 13px 14px; border-color: #cec5ed; border-radius: 10px; color: #263950; font-size: 13px; line-height: 1.5; overflow-y: hidden; resize: none; }
.workflow-assist-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.workflow-assist-footer > span { color: #7f8aa0; font-size: 11px; line-height: 1.4; }
.workflow-goal-count { color: #7f8aa0; font-size: 11px; font-weight: 500; }
.workflow-assist-footer .primary-button { min-height: 40px; white-space: nowrap; }
.workflow-template-flow { padding-top: 14px; border-top: 1px solid rgba(131, 109, 198, .16); }
.workflow-template-trigger { display: inline-flex; align-items: center; gap: 5px; padding: 0; color: #5e4bb0; font-size: 11px; }
.workflow-template-picker { max-width: 560px; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; padding-top: 12px; }
.workflow-template-picker p { grid-column: 1 / -1; }
.workflow-template-picker button { padding: 10px; border-color: #e0dafa; background: rgba(255,255,255,.72); }
.workflow-template-picker button:hover { border-color: #b7aaf0; background: #fff; }
.workflow-readiness-card { display: grid; grid-template-columns: 150px minmax(0, 1fr) auto; align-items: center; gap: 18px; padding: 18px 2px; margin: 0; border: 0; border-top: 1px solid #e4eaf1; border-bottom: 1px solid #e4eaf1; border-radius: 0; background: transparent; }
.workflow-readiness-heading { display: grid; gap: 4px; }
.workflow-readiness-heading .eyebrow { margin: 0; }
.workflow-readiness-heading h3 { margin: 0; color: #304563; font-size: 15px; }
.workflow-configuration-label { color: #9a6b1e; font-size: 11px; font-weight: 750; }
.workflow-configuration-label.complete { color: #2c805f; }
.workflow-readiness-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 18px; margin: 0; }
.workflow-readiness-list span { min-width: 0; color: #9aa6b5; font-size: 11px; line-height: 1.35; }
.workflow-readiness-list span.complete { color: #8a98a9; }
.workflow-readiness-list span.incomplete { color: #5f6f84; }
.workflow-readiness-list span i { width: 14px; color: #c4ccd6; }
.workflow-readiness-list span.complete svg { color: #54a37e; }
.workflow-readiness-list .workflow-test-status { color: #9a6b1e !important; }
.workflow-readiness-card > .text-button { display: inline-flex; align-items: center; gap: 4px; padding: 6px 0; white-space: nowrap; }
.workflow-step-list { display: grid; gap: 12px; }
.workflow-section-heading { align-items: center; margin: 4px 0 4px; }
.workflow-section-heading h3 { margin: 3px 0 5px; color: #243758; font-size: 18px; letter-spacing: -.025em; }
.workflow-section-heading p:not(.eyebrow) { font-size: 12px; line-height: 1.45; }
.workflow-step-card { gap: 12px; padding: 13px 16px 13px 0; margin: 0; border-color: #e1e8f0; border-radius: 12px; box-shadow: none; }
.workflow-step-card.selected { border-color: #aec6ef; box-shadow: 0 7px 22px rgba(42, 78, 140, .08); }
.workflow-step-rail { width: 40px; }
.workflow-step-rail span { width: 27px; height: 27px; color: #456dab; background: #edf3ff; }
.workflow-step-title { gap: 8px; color: #a0adbc; }
.workflow-step-title strong { color: #2e415d; font-size: 13px; }
.workflow-step-summary { min-height: 25px; color: #75859a; font-size: 12px; }
.workflow-step-actions button { border-color: transparent; background: transparent; }
.workflow-step-actions button:hover:not(:disabled) { border-color: #dce6f3; background: #f5f8fc; }
.workflow-edit-button { color: #315ba9 !important; }
.workflow-condition-box, .workflow-provider-box { border-color: #e4ebf3; background: #f8fafc; }
.workflow-advanced-settings { margin-top: 14px; padding-top: 12px; }
.workflow-advanced-settings > summary { color: #64758a; font-size: 11px; }
.workflow-step-management { display: flex; flex-wrap: wrap; gap: 8px; padding-top: 12px; margin-top: 12px; border-top: 1px solid #edf1f5; }
.workflow-step-management button { padding: 0; border: 0; color: #65758a; background: transparent; font-size: 11px; font-weight: 650; cursor: pointer; }
.workflow-step-management button:hover:not(:disabled) { color: #315ba9; }
.workflow-step-management button:disabled { color: #b7c0cb; cursor: not-allowed; }
.workflow-step-management .danger-text { margin-left: auto; color: #b34135; }
.workflow-empty-builder { gap: 7px; padding: 24px 16px; border-color: #d4deeb; border-radius: 12px; }
.workflow-empty-builder strong { color: #304563; font-size: 13px; }
.workflow-empty-builder p { font-size: 12px; }
.workflow-empty-actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin-top: 5px; }
.workflow-provider-summary { padding: 18px 2px 2px; margin: 4px 0 0; border: 0; border-top: 1px solid #e4eaf1; border-radius: 0; background: transparent; }
.workflow-provider-summary-heading h3 { color: #304563; }
.workflow-provider-summary-detail { padding-top: 10px; margin-top: 10px; border-top-color: #edf1f5; }
.workflow-provider-summary-detail span { color: #7c8b9e; line-height: 1.45; }
.workflow-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 1260px) {
  .workflow-layout { grid-template-columns: 220px minmax(0, 1fr); gap: 24px; }
  .workflow-assist-card { padding: 20px; }
}
@media (max-width: 1100px) {
  .workflow-layout { grid-template-columns: 210px minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .workflow-workspace { gap: 24px; padding-top: 24px; }
  .workflow-page-header, .workflow-builder-heading { align-items: flex-start; flex-direction: column; }
  .workflow-page-actions { width: 100%; justify-content: flex-end; }
  .workflow-model-banner { align-items: flex-start; padding: 14px; }
  .workflow-layout { display: block; }
  .workflow-library, .workflow-builder { margin-bottom: 24px; }
  .workflow-library { padding: 0; }
  .workflow-library .panel-heading { border-bottom: 0; }
  .workflow-library-select { display: grid; gap: 6px; margin: 0 0 12px; color: #708096; font-size: 11px; font-weight: 700; }
  .workflow-library-select select { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid #d5dfeb; border-radius: 9px; background: #fff; color: #304563; font: inherit; }
  .workflow-library-item { display: none; }
  .workflow-builder { gap: 20px; }
  .workflow-assist-card { padding: 18px; }
  .workflow-assist-footer { align-items: flex-start; flex-direction: column; }
  .workflow-assist-footer .primary-button { width: 100%; }
  .workflow-readiness-card { display: grid; grid-template-columns: 1fr; gap: 12px; padding: 16px 0; }
  .workflow-readiness-list { grid-template-columns: 1fr; }
  .workflow-readiness-card > .text-button { justify-self: start; }
  .workflow-section-heading { align-items: flex-start; flex-direction: column; }
  .workflow-section-heading .outline-button { align-self: flex-start; }
  .workflow-step-card { padding-right: 11px; }
  .workflow-step-title .status-pill { display: none; }
  .workflow-step-grid { grid-template-columns: 1fr; }
  .workflow-step-grid label:last-child:nth-child(3) { grid-column: auto; }
  .workflow-step-footer { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .workflow-page-actions { justify-content: space-between; }
  .workflow-page-actions .primary-button { flex: 1; }
  .workflow-model-banner { padding-right: 52px; }
  .workflow-model-banner > .text-button { top: 10px; right: 12px; }
  .workflow-assist-heading { gap: 10px; }
  .workflow-assist-copy h3 { font-size: 16px; }
  .workflow-assist-card textarea { min-height: 128px; }
  .workflow-template-picker { grid-template-columns: 1fr; }
  .workflow-step-toolbar { gap: 8px; }
  .workflow-step-title svg { display: none; }
  .workflow-step-management .danger-text { margin-left: 0; }
}

/* Final layout polish */
.workflow-layout { grid-template-columns: minmax(220px, 250px) minmax(0, 1fr); gap: clamp(22px, 2.4vw, 36px); }
.workflow-library, .workflow-builder { min-width: 0; }
.workflow-library .panel-heading { align-items: center; gap: 16px; flex-wrap: nowrap; }
.workflow-library .panel-heading > div { min-width: 0; flex: 1 1 auto; }
.workflow-library .panel-heading h3 { white-space: nowrap; }
.workflow-library .panel-heading .outline-button { flex: 0 0 auto; }
.workflow-library-item { min-height: 58px; gap: 11px; padding: 11px 10px; }
.workflow-library-item > span:nth-child(2) { min-width: 0; gap: 3px; }
.workflow-library-item strong, .workflow-library-item small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workflow-library-item > svg { flex: 0 0 auto; margin-left: auto; }
.workflow-builder { width: 100%; gap: 26px; }
.workflow-assist-card, .workflow-readiness-card, .workflow-step-list, .workflow-provider-summary { width: 100%; min-width: 0; box-sizing: border-box; }
.workflow-step-list { gap: 14px; }
.workflow-section-heading { margin: 0 0 2px; }
.workflow-empty-builder { width: 100%; min-height: 126px; box-sizing: border-box; padding: 22px 20px; }
.workflow-provider-summary { margin-top: 0; }
.workflow-builder-heading > div:first-child,
.workflow-builder-heading p:not(.eyebrow),
.workflow-step-title,
.workflow-step-body { min-width: 0; }
.workflow-builder-heading p:not(.eyebrow) { max-width: 68ch; max-height: 8.4em; overflow: auto; overflow-wrap: anywhere; word-break: break-word; }
.workflow-step-title { flex-wrap: wrap; }
.workflow-step-title strong, .workflow-step-title input { min-width: 0; max-width: 100%; overflow-wrap: anywhere; word-break: break-word; }
.workflow-step-title .status-pill { flex: 0 0 auto; }
.workflow-step-summary { align-items: flex-start; flex-wrap: wrap; }
.workflow-step-summary > span:first-child { min-width: 0; flex: 1 1 220px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
.workflow-isolation-warning { display: grid; gap: 3px; max-width: 68ch; padding: 10px 12px; margin-top: 12px; border: 1px solid #f2d49d; border-radius: 9px; background: #fff9ed; color: #805b19; font-size: 11px; line-height: 1.4; }
.workflow-isolation-warning strong { color: #67470e; }

@media (max-width: 1260px) {
  .workflow-layout { grid-template-columns: 220px minmax(0, 1fr); gap: 24px; }
}
@media (max-width: 1100px) {
  .workflow-layout { grid-template-columns: 230px minmax(0, 1fr); gap: 24px; }
  .workflow-library { padding: 0; }
  .workflow-library .panel-heading { padding-bottom: 10px; border-bottom: 0; }
  .workflow-library-select { display: grid; gap: 6px; margin: 0 0 12px; color: #708096; font-size: 11px; font-weight: 700; }
  .workflow-library-select select { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid #d5dfeb; border-radius: 9px; background: #fff; color: #304563; font: inherit; }
  .workflow-library-item { display: none; }
}

/* Give the first-run state the same visual weight as the workspace it introduces. */
.workflow-layout-empty { display: block; }
.workflow-layout-empty .workflow-library { width: 100%; padding: 0; }
.workflow-layout-empty .workflow-library .panel-heading { padding-bottom: 14px; }
.workflow-layout-empty .workflow-empty {
  align-content: center;
  justify-items: center;
  min-height: clamp(340px, 45vh, 560px);
  box-sizing: border-box;
  padding: clamp(36px, 6vw, 76px) 24px;
  margin-top: 0;
  border: 1px solid #dfe8f3;
  border-radius: 18px;
  background: radial-gradient(circle at 50% 0%, #f7faff 0%, #ffffff 58%);
  color: #708096;
  text-align: center;
  box-shadow: 0 12px 32px rgba(47, 83, 137, .05);
}
.workflow-layout-empty .workflow-empty-icon { width: 64px; height: 64px; border-radius: 18px; color: #2f66c6; background: #e8f0ff; }
.workflow-layout-empty .workflow-empty strong { color: #243758; font-size: 22px; letter-spacing: -.025em; }
.workflow-layout-empty .workflow-empty p { max-width: 520px; font-size: 14px; line-height: 1.6; }
.workflow-layout-empty .workflow-empty .primary-button { display: inline-flex; align-items: center; gap: 7px; min-height: 42px; margin-top: 8px; padding-inline: 18px; }

@media (max-width: 560px) {
  .workflow-layout-empty .workflow-empty { min-height: 320px; padding: 36px 18px; }
  .workflow-layout-empty .workflow-empty strong { font-size: 19px; }
  .workflow-layout-empty .workflow-empty p { font-size: 13px; }
}

/* Journey-builder hierarchy: summary first, path second, configuration last. */
.workflow-workspace { max-width: 1120px; gap: 20px; padding-top: 22px; }
.workflow-sticky-header { position: sticky; z-index: 7; top: var(--workspace-header-height); align-items: center; padding: 14px 18px; margin: -22px -18px 0; border-bottom: 1px solid #e3eaf2; background: rgba(255,255,255,.96); box-shadow: 0 5px 18px rgba(25, 54, 92, .06); backdrop-filter: blur(12px); }
.workflow-page-heading { min-width: 0; }
.workflow-page-heading .eyebrow { margin-bottom: 5px; }
.workflow-page-heading h2 { margin: 0; color: #243758; font-size: 23px; letter-spacing: -.04em; }
.workflow-header-status { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin: 6px 0 0; color: #77889e; font-size: 11px; }
.workflow-status-dot { width: 7px; height: 7px; border-radius: 50%; background: #efb44e; box-shadow: 0 0 0 3px #fff4da; }
.workflow-status-dot.published { background: #1da875; box-shadow: 0 0 0 3px #e8f8f1; }
.workflow-publish-error { margin: 12px 0 0; }
.workflow-header-separator { color: #b6c1cf; }
.workflow-page-actions { gap: 8px; }
.workflow-header-secondary-action { padding: 7px 2px; color: #7b8b9f; font-size: 11px; }
.workflow-test-button { border-color: #c9d9ee; color: #315ba9; }
.workflow-layout { display: block; }
.workflow-selector-bar { display: flex; align-items: center; gap: 14px; min-height: 48px; padding: 8px 0 14px; border-bottom: 1px solid #e7edf4; }
.workflow-selector-copy { display: grid; flex: 0 0 auto; gap: 2px; }
.workflow-selector-copy .eyebrow { margin: 0; }
.workflow-selector-copy strong { color: #304563; font-size: 12px; }
.workflow-library-select { display: grid; flex: 1 1 260px; gap: 0; color: #708096; font-size: 10px; font-weight: 700; }
.workflow-library-select select { width: min(100%, 360px); min-height: 36px; margin-top: 0; padding: 7px 32px 7px 10px; border: 1px solid #d5dfeb; border-radius: 8px; color: #304563; background-color: #fff; font: inherit; }
.workflow-selector-bar > .outline-button { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; }
.workflow-builder { width: 100%; gap: 18px; padding-top: 18px; }
.workflow-goal-summary { padding: 17px 18px; border: 1px solid #dce5f0; border-radius: 13px; background: #fff; box-shadow: 0 4px 16px rgba(35, 63, 100, .035); }
.workflow-goal-summary-row { display: flex; align-items: flex-start; gap: 12px; }
.workflow-goal-icon { display: grid; flex: 0 0 34px; width: 34px; height: 34px; place-items: center; border-radius: 10px; color: #3567bd; background: #edf4ff; }
.workflow-goal-copy { min-width: 0; flex: 1; }
.workflow-goal-copy .eyebrow { margin-bottom: 4px; }
.workflow-goal-copy h3 { margin: 0 0 4px; color: #2e415d; font-size: 15px; letter-spacing: -.02em; }
.workflow-goal-copy p:not(.eyebrow) { display: -webkit-box; margin: 0; overflow: hidden; color: #71829a; font-size: 12px; line-height: 1.5; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.workflow-goal-toggle { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; padding: 4px 0; font-size: 11px; }
.workflow-goal-toggle svg { transition: transform .15s ease; }
.workflow-goal-editor { display: grid; gap: 12px; padding-top: 15px; margin-top: 15px; border-top: 1px solid #edf1f5; }
.workflow-goal-editor textarea { width: 100%; box-sizing: border-box; min-height: 108px; padding: 11px 12px; border: 1px solid #cbd9e8; border-radius: 9px; color: #263950; background: #fff; font: inherit; font-size: 12px; line-height: 1.5; resize: none; }
.workflow-goal-editor .workflow-assist-footer { align-items: center; }
.workflow-goal-editor .workflow-template-flow { padding-top: 12px; }
.workflow-readiness-card { display: block; padding: 12px 0; margin: 0; border-top: 1px solid #e4eaf1; border-bottom: 1px solid #e4eaf1; }
.workflow-readiness-summary { display: flex; align-items: center; gap: 10px; }
.workflow-readiness-mark { display: grid; width: 28px; height: 28px; flex: 0 0 28px; place-items: center; border: 1px solid #f0d79f; border-radius: 50%; color: #98691a; background: #fff8e8; font-size: 13px; font-weight: 800; }
.workflow-readiness-mark.complete { border-color: #b9e8d9; color: #19805e; background: #edfaf5; }
.workflow-readiness-summary > div:nth-child(2) { display: grid; gap: 2px; min-width: 0; }
.workflow-readiness-summary .eyebrow { margin: 0; }
.workflow-readiness-summary strong { color: #304563; font-size: 13px; }
.workflow-readiness-summary small { color: #8b99aa; font-size: 10px; }
.workflow-readiness-toggle { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; padding: 5px 0; font-size: 11px; }
.workflow-readiness-details { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 17px; padding: 12px 0 2px 38px; }
.workflow-readiness-details span { display: inline-flex; align-items: center; gap: 5px; color: #9aa6b5; font-size: 11px; line-height: 1.35; }
.workflow-readiness-details span.complete { color: #7f8d9e; }
.workflow-readiness-details span.incomplete { color: #5f6f84; }
.workflow-readiness-details span svg { color: #54a37e; }
.workflow-readiness-details span i { width: 14px; color: #c4ccd6; font-style: normal; font-size: 14px; }
.workflow-readiness-details > .text-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; font-size: 11px; }
.workflow-journey-section { min-width: 0; }
.workflow-section-heading { align-items: center; margin: 2px 0 11px; }
.workflow-section-heading .eyebrow { margin-bottom: 5px; }
.workflow-section-heading h3 { margin: 0 0 4px; color: #243758; font-size: 19px; letter-spacing: -.03em; }
.workflow-section-heading p:not(.eyebrow) { color: #7a8aa0; font-size: 12px; }
.workflow-step-list { display: grid; gap: 10px; }
.workflow-step-card { position: relative; gap: 12px; padding: 13px 15px 13px 0; border-color: #dfe7f0; border-radius: 11px; background: #fff; }
.workflow-step-card:hover { border-color: #cbd9eb; }
.workflow-step-card.selected { border-color: #a9c1ed; box-shadow: 0 7px 20px rgba(42, 78, 140, .08); }
.workflow-step-card.conditional { margin-left: 25px; border-style: dashed; background: #fbfdff; }
.workflow-step-card.conditional::before { position: absolute; top: -11px; left: -14px; width: 13px; height: 23px; border-left: 1px solid #cbd9eb; border-bottom: 1px solid #cbd9eb; border-radius: 0 0 0 8px; content: ""; }
.workflow-conditional-heading { display: flex; align-items: flex-start; gap: 12px; padding: 12px 0 1px 25px; margin-top: 10px; border-top: 1px solid #e8edf4; }
.workflow-conditional-heading h4 { margin: 0 0 3px; color: #304563; font-size: 14px; }
.workflow-conditional-heading p:not(.eyebrow) { margin: 0; color: #7a8aa0; font-size: 11px; line-height: 1.4; }
.workflow-conditional-heading .eyebrow { margin-bottom: 4px; color: #617db5; }
.workflow-step-rail { width: 40px; }
.workflow-step-rail span { width: 27px; height: 27px; color: #456dab; background: #edf3ff; }
.workflow-step-card.conditional .workflow-step-rail span { color: #62799e; background: #f0f4fa; }
.workflow-step-title strong { color: #2e415d; font-size: 13px; }
.workflow-step-summary { min-height: 24px; color: #75859a; font-size: 12px; }
.workflow-advanced-card { border-top: 1px solid #e4eaf1; border-bottom: 1px solid #e4eaf1; }
.workflow-advanced-toggle { display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; padding: 16px 0; border: 0; color: #304563; background: transparent; text-align: left; cursor: pointer; }
.workflow-advanced-toggle > span:first-child { display: grid; gap: 3px; min-width: 0; }
.workflow-advanced-toggle .eyebrow { margin: 0; }
.workflow-advanced-toggle strong { font-size: 14px; }
.workflow-advanced-toggle small { overflow: hidden; color: #8190a3; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.workflow-advanced-toggle-action { display: inline-flex; align-items: center; gap: 4px; flex: 0 0 auto; color: #315ba9; font-size: 11px; font-weight: 750; }
.workflow-advanced-content { display: grid; border-top: 1px solid #edf1f5; }
.workflow-advanced-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid #edf1f5; }
.workflow-advanced-row:last-child { border-bottom: 0; }
.workflow-advanced-row > div { display: grid; gap: 3px; min-width: 0; }
.workflow-advanced-label { color: #8a98a9; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.workflow-advanced-row strong { color: #304563; font-size: 12px; }
.workflow-advanced-row small { color: #8190a3; font-size: 11px; line-height: 1.4; }
.workflow-advanced-row select { width: min(100%, 290px); min-height: 36px; }
.workflow-layout-empty-state { align-content: center; justify-items: center; min-height: clamp(300px, 42vh, 500px); box-sizing: border-box; padding: 40px 24px; border: 1px solid #dfe8f3; border-radius: 16px; background: radial-gradient(circle at 50% 0%, #f7faff 0%, #fff 58%); text-align: center; }
.workflow-workspace .workflow-step-list { display: grid; grid-template-columns: minmax(0, 1fr); align-items: stretch; gap: 10px; }
.workflow-workspace .workflow-step-list > .workflow-step-card,
.workflow-workspace .workflow-step-list > .workflow-conditional-heading,
.workflow-workspace .workflow-step-list > .workflow-empty { grid-column: 1 / -1; }

@media (max-width: 820px) {
  .workflow-sticky-header { position: static; margin: -10px 0 0; padding-inline: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
  .workflow-page-header { align-items: flex-start; flex-direction: column; }
  .workflow-page-actions { width: 100%; justify-content: flex-end; }
  .workflow-selector-bar { align-items: flex-start; flex-wrap: wrap; }
  .workflow-selector-copy { flex: 1 1 140px; }
  .workflow-library-select { flex: 1 1 100%; order: 3; }
  .workflow-library-select select { width: 100%; }
  .workflow-goal-summary-row { align-items: flex-start; }
  .workflow-readiness-details { padding-left: 0; }
}
@media (max-width: 520px) {
  .workflow-page-actions { justify-content: space-between; }
  .workflow-header-secondary-action { display: none; }
  .workflow-page-actions .outline-button, .workflow-page-actions .primary-button { flex: 1; }
  .workflow-step-card.conditional { margin-left: 12px; }
  .workflow-step-card.conditional::before { left: -8px; width: 7px; }
  .workflow-conditional-heading { padding-left: 12px; }
  .workflow-advanced-row { align-items: flex-start; flex-direction: column; }
  .workflow-advanced-row select { width: 100%; }
}
</style>
