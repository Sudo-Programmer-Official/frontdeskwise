<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, GripVertical, Plus, Save, Sparkles, Trash2, X } from "@lucide/vue";
import { generateWorkflow, templateSteps, type WorkflowBusinessContext, type WorkflowFieldDraft, type WorkflowStepDraft } from "../workflow-generator.js";

type WorkflowStep = WorkflowStepDraft & { nextStepId?: string; branches?: Record<string, string> };

interface WorkflowAction {
  id: string;
  key: string;
  name: string;
  description?: string;
  actionType?: string;
  executionMode?: string;
  provider?: string | null;
  fields?: Array<WorkflowFieldDraft & { id?: string; visibility?: string }>;
  steps?: Array<Record<string, unknown>>;
  completion?: Record<string, unknown>;
  readiness?: { ready?: boolean; reason?: string };
}

interface IntegrationLike {
  provider?: string;
  connectionStatus?: string;
}

const props = defineProps<{
  actions: unknown[];
  integrations: unknown[];
  demoSlug: string;
  apiUrl: (path: string) => string;
  ownerHeaders: () => Record<string, string>;
  businessName?: string;
  businessContext?: WorkflowBusinessContext | null;
}>();

const emit = defineEmits<{
  (event: "refresh"): void;
  (event: "open-action", actionId: string): void;
}>();

const selectedWorkflowId = ref("");
const workflowDraft = ref<WorkflowAction | null>(null);
const selectedStepIndex = ref(-1);
const workflowDescription = ref("");
const workflowSaveLoading = ref(false);
const workflowSaveError = ref("");
const workflowSaveMessage = ref("");
const advancedOpen = ref(false);
const showModelBanner = ref(true);
const showTemplatePicker = ref(false);
const workflowAssistInput = ref<HTMLTextAreaElement | null>(null);
const workflowStepList = ref<HTMLElement | null>(null);
const draftIsDirty = ref(false);
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

const allActions = computed(() => props.actions.map(asWorkflowAction).filter((action): action is WorkflowAction => Boolean(action)));
const workflowActions = computed(() => allActions.value.filter((action) => {
  const stepCount = Array.isArray(action.steps) ? action.steps.length : 0;
  return stepCount > 1 || action.executionMode === "PROVIDER_FLOW" || (action.fields?.length ?? 0) > 2;
}));
const selectedWorkflow = computed(() => workflowActions.value.find((action) => action.id === selectedWorkflowId.value) ?? workflowActions.value[0] ?? null);
const draftSteps = computed(() => (workflowDraft.value?.steps ?? []) as unknown as WorkflowStep[]);
const previewStep = computed(() => selectedStepIndex.value >= 0 ? draftSteps.value[selectedStepIndex.value] ?? null : null);
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
    { label: workflowProvider.value ? `${formatLabel(workflowProvider.value)} is connected` : "Provider is configured", complete: providerReady },
    { label: "Completion path is defined", complete: hasCompletion },
    { label: "Failure and handoff path is defined", complete: hasFailurePath },
  ];
});
const readinessPercent = computed(() => Math.round((readiness.value.filter((item) => item.complete).length / readiness.value.length) * 100));
const readinessRemaining = computed(() => readiness.value.filter((item) => !item.complete));
const configurationComplete = computed(() => readinessRemaining.value.length === 0);
const configurationLabel = computed(() => configurationComplete.value ? "Configuration complete" : "Needs setup");
const providerStep = computed(() => draftSteps.value.find((step) => step.type === "lookup" || step.type === "generate_link") ?? null);
const providerFailureBehavior = computed(() => providerStep.value ? stepConfigValue(providerStep.value, "failureBehavior") : "capture_lead");

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
  selectedStepIndex.value = -1;
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
  const result = generateWorkflow(workflowDescription.value, (workflowDraft.value.fields ?? []) as WorkflowFieldDraft[], {
    actionType: workflowDraft.value.actionType,
    actionName: workflowDraft.value.name,
    actionDescription: workflowDraft.value.description,
    availableActionTypes: allActions.value.map((action) => action.actionType || action.key),
    availableProviders: props.integrations.filter((integration) => (integration as IntegrationLike).connectionStatus === "active").map((integration) => String((integration as IntegrationLike).provider ?? "")).filter(Boolean),
    knownBusinessKnowledge: props.businessContext?.knowledgeSummary?.map((item) => item.value) ?? [],
    completionGoal: String(workflowDraft.value.completion?.message ?? workflowDraft.value.completion?.linkLabel ?? ""),
    businessContext: props.businessContext ?? undefined,
  });
  workflowDraft.value.name = result.name;
  workflowDraft.value.description = result.description;
  workflowDraft.value.steps = result.steps as unknown as Array<Record<string, unknown>>;
  workflowDraft.value.fields = result.fields as unknown as WorkflowAction["fields"];
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
      body: JSON.stringify(workflowDraft.value),
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

function dismissModelBanner() {
  showModelBanner.value = false;
  try {
    window.localStorage.setItem("frontdeskwise:workflow-model-banner-dismissed", "1");
  } catch {
    // Banner dismissal is a convenience; it should never block the builder.
  }
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
  try {
    showModelBanner.value = window.localStorage.getItem("frontdeskwise:workflow-model-banner-dismissed") !== "1";
  } catch {
    // Keep the banner visible when storage is unavailable.
  }
});
</script>

<template>
  <div class="view-content workflow-workspace">
    <div class="workflow-page-header">
      <div>
        <p class="eyebrow">AI front desk</p>
        <h2>Workflows</h2>
        <p>Define how FrontDeskWise moves a visitor from intent to a reliable outcome.</p>
      </div>
      <div class="toolbar-actions workflow-page-actions">
        <button class="text-button" type="button" @click="emit('refresh')">Refresh</button>
        <button :class="['primary-button small', { 'save-clean': !draftIsDirty }]" type="button" :disabled="!workflowDraft || workflowSaveLoading || !draftIsDirty" @click="saveWorkflow"><Save :size="14" :stroke-width="1.8" aria-hidden="true" />{{ workflowSaveLoading ? 'Saving…' : draftIsDirty ? 'Save workflow' : 'Saved ✓' }}</button>
      </div>
    </div>

    <div v-if="showModelBanner" class="workflow-model-banner">
      <div class="workflow-model-icon"><GitBranch :size="21" :stroke-width="1.8" aria-hidden="true" /></div>
      <div><p class="eyebrow">Actions are what · Workflows are how</p><h3>Make complex customer goals explicit and resumable.</h3><p>Simple actions can stay direct. Use a workflow when the assistant needs questions, branches, provider lookups, or a human fallback.</p></div>
      <button class="text-button" type="button" @click="dismissModelBanner">Dismiss</button>
    </div>

    <div class="workflow-layout">
      <aside class="workflow-library panel">
        <div class="panel-heading"><div><p class="eyebrow">Your workflows</p><h3>{{ workflowActions.length }} configured</h3></div><button class="outline-button small" type="button" @click="emit('open-action', '')"><Plus :size="14" :stroke-width="1.9" aria-hidden="true" />Create workflow</button></div>
        <label class="workflow-library-select">Choose a workflow<select v-model="selectedWorkflowId"><option v-for="action in workflowActions" :key="action.id" :value="action.id">{{ action.name }}</option></select></label>
        <div v-if="!workflowActions.length" class="workflow-empty"><span class="workflow-empty-icon"><GitBranch :size="22" :stroke-width="1.8" aria-hidden="true" /></span><strong>No multi-step workflows yet.</strong><p>Create an action first, then open it here to turn the path into explicit steps.</p><button class="primary-button small" type="button" @click="emit('open-action', '')">Open Actions <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
        <button v-for="action in workflowActions" :key="action.id" type="button" :class="['workflow-library-item', { active: action.id === selectedWorkflowId }]" @click="selectedWorkflowId = action.id"><span class="workflow-library-item-icon"><GitBranch :size="16" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>{{ action.name }}</strong><small>{{ action.steps?.length ?? 0 }} steps · {{ formatLabel(action.executionMode || 'FORM_FLOW') }}</small></span><ChevronDown :size="15" :stroke-width="1.8" aria-hidden="true" /></button>
      </aside>

      <main v-if="workflowDraft" class="workflow-builder">
        <div class="workflow-builder-heading"><div><p class="eyebrow">Workflow</p><h2>{{ workflowDraft.name }}</h2><p>{{ workflowDraft.description || 'Describe the customer outcome this workflow owns.' }}</p></div><div class="workflow-builder-actions"><button class="outline-button small" type="button" @click="openAction">Action settings</button><div class="workflow-status-group"><span class="workflow-mode-label">{{ formatLabel(workflowDraft.executionMode || 'FORM_FLOW') }}</span><span class="status-pill new">Needs testing</span></div></div></div>

        <section class="workflow-assist-card" aria-labelledby="workflow-assist-heading"><div class="workflow-assist-heading"><div class="workflow-assist-icon"><Sparkles :size="18" :stroke-width="1.8" aria-hidden="true" /></div><div class="workflow-assist-copy"><p class="eyebrow">Start here</p><h3 id="workflow-assist-heading">What should this workflow accomplish?</h3><p>Describe the customer outcome in plain English. FrontDeskWise will suggest the steps for you to review.</p></div></div><textarea ref="workflowAssistInput" v-model="workflowDescription" rows="4" placeholder="Example: Ask the child’s age, swimming ability, location, and preferred days, then show available classes." @keydown.meta.enter="generateStarter" @keydown.ctrl.enter="generateStarter"></textarea><div class="workflow-assist-footer"><span>Tip: include what the customer needs and what should happen next.</span><button class="primary-button" type="button" aria-label="Generate steps" :disabled="!workflowDescription.trim()" @click="generateStarter"><Sparkles :size="15" :stroke-width="1.8" aria-hidden="true" />Generate workflow</button></div><div class="workflow-template-flow"><button class="text-button workflow-template-trigger" type="button" @click="showTemplatePicker = !showTemplatePicker">Start with a template <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></button><div v-if="showTemplatePicker" class="workflow-template-picker"><p>Choose a starting point</p><button v-for="template in workflowTemplates" :key="template.key" type="button" @click="applyTemplate(template.key)"><strong>{{ template.label }}</strong><small>{{ template.description }}</small></button></div></div></section>

        <section class="workflow-readiness-card" aria-labelledby="workflow-setup-heading"><span class="workflow-sr-only">Choose what happens if unavailable</span><div class="workflow-readiness-heading"><p class="eyebrow">Setup status</p><h3 id="workflow-setup-heading">Workflow setup</h3><span :class="['workflow-configuration-label', { complete: configurationComplete }]">{{ configurationLabel }}</span></div><div class="workflow-readiness-list"><span v-for="item in readiness" :key="item.label" :class="{ complete: item.complete, incomplete: !item.complete }"><Check v-if="item.complete" :size="14" :stroke-width="2" aria-hidden="true" /><i v-else aria-hidden="true">○</i>{{ readinessLabel(item.label) }}</span><span class="workflow-test-status"><i aria-hidden="true">○</i>Test workflow before publishing</span></div><button v-if="readinessRemaining.length" class="text-button" type="button" @click="continueSetup">Continue setup <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></section>

        <div ref="workflowStepList" class="workflow-step-list">
          <div class="workflow-section-heading"><div><p class="eyebrow">Next, review the path</p><h3>Customer journey</h3><p>These are the steps your customer will experience. Select one to edit it.</p></div><button class="outline-button small" type="button" @click="addWorkflowStep()"><Plus :size="14" :stroke-width="1.9" aria-hidden="true" />Add step</button></div>
          <article v-for="(step, index) in draftSteps" :key="step.id || index" :class="['workflow-step-card', { selected: selectedStepIndex === index }]" @click="selectedStepIndex = index">
            <div class="workflow-step-rail"><span>{{ index + 1 }}</span><i v-if="index < draftSteps.length - 1"></i></div>
            <div class="workflow-step-body">
              <div class="workflow-step-toolbar"><div class="workflow-step-title"><GripVertical :size="16" :stroke-width="1.8" aria-hidden="true" /><input v-if="selectedStepIndex === index" v-model="step.label" type="text" aria-label="Workflow step label" @input="markDirty" /><strong v-else>{{ step.label || stepTypeLabel(step.type) }}</strong><span class="status-pill qualified">{{ stepTypeLabel(step.type) }}</span></div><div class="workflow-step-actions"><button class="workflow-edit-button" type="button" @click.stop="selectedStepIndex = selectedStepIndex === index ? -1 : index">{{ selectedStepIndex === index ? 'Done' : 'Edit' }}</button></div></div>
              <div v-if="selectedStepIndex !== index" class="workflow-step-summary"><span>{{ step.question || step.fieldKey || (step.type === 'condition' ? 'Add a condition' : step.type === 'lookup' ? 'Find availability with a provider' : 'Select Edit to configure this step') }}</span><span v-if="step.condition" class="workflow-summary-tag">Condition</span><span v-if="step.type === 'lookup' || step.type === 'generate_link'" class="workflow-summary-tag">{{ formatLabel(stepConfigValue(step, 'provider') || 'Provider') }}</span><span v-if="step.config?.reviewStatus" class="workflow-summary-tag">{{ formatLabel(String(step.config.reviewStatus)) }}</span></div>
              <div v-else>
                <div class="workflow-step-grid"><label>Step type<select v-model="step.type" @change="markDirty"><option v-for="type in stepTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form'">Field<select v-model="step.fieldKey" @change="markDirty"><option value="">No stored field</option><option v-for="field in workflowDraft.fields ?? []" :key="field.key" :value="field.key">{{ field.label || field.key }}</option></select></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form' || step.type === 'recommend' || step.type === 'confirm'">Customer-facing question<input v-model="step.question" type="text" placeholder="What should the assistant ask?" @input="markDirty" /></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form'" class="toggle-row"><span>Required</span><input v-model="step.required" type="checkbox" @change="markDirty" /></label></div>
                <label v-if="step.type === 'select' || step.type === 'recommend'">Options <span class="optional">comma separated</span><input :value="stepOptionsText(step)" type="text" placeholder="Option one, Option two" @input="setStepOptions(step, $event)" /></label>
                <div v-if="step.type === 'condition'" class="workflow-condition-box"><span class="workflow-condition-icon"><GitBranch :size="15" :stroke-width="1.8" aria-hidden="true" /></span><label>Condition in plain English<textarea v-model="step.condition" rows="2" placeholder="If the visitor is ready to register, continue to the provider lookup." @input="markDirty"></textarea></label></div>
                <div v-if="step.type === 'lookup' || step.type === 'generate_link'" class="workflow-provider-box"><div class="workflow-provider-heading"><div><p class="eyebrow">Provider</p><strong>{{ step.type === 'lookup' ? 'Find availability' : 'Complete with provider' }}</strong></div><span :class="['status-pill', providerConnected ? 'booked' : 'new']">{{ providerConnected ? 'Connected' : 'Needs connection' }}</span></div><div class="workflow-step-grid"><label>Provider<select :value="stepConfigValue(step, 'provider')" @change="setStepConfigFromEvent(step, 'provider', $event)"><option value="">Select provider…</option><option value="jackrabbit">Jackrabbit</option><option value="booking">Booking provider</option><option value="crm">CRM / automation</option></select></label><label v-if="step.type === 'lookup'">Operation<select :value="stepConfigValue(step, 'operation')" @change="setStepConfigFromEvent(step, 'operation', $event)"><option value="find_locations">Find locations</option><option value="find_classes">Find classes</option><option value="get_availability">Get availability</option><option value="get_class_price">Get class price</option></select></label><label v-if="step.type === 'lookup'">Search fields<input :value="stepConfigValue(step, 'searchFields')" type="text" placeholder="location, schedule, age" @input="setStepConfigFromEvent(step, 'searchFields', $event)" /></label></div><small class="form-help">We’ll use the provider for this step and explain what happens if it is unavailable.</small></div>
                <details class="workflow-advanced-settings" :open="advancedOpen"><summary @click.prevent="advancedOpen = !advancedOpen">Advanced <span>{{ advancedOpen ? 'Hide' : 'Show' }}</span></summary><div class="workflow-step-footer"><label>If this step fails<select :value="stepConfigValue(step, 'failureBehavior')" @change="setStepConfigFromEvent(step, 'failureBehavior', $event)"><option value="handoff">Hand off to staff</option><option value="capture_lead">Save details and follow up</option><option value="retry">Retry automatically</option><option value="stop">Stop and explain</option></select></label><label>Next step<select v-model="step.nextStepId" @change="markDirty"><option value="">Continue in order</option><option v-for="nextStep in draftSteps.filter((candidate) => candidate.id !== step.id)" :key="nextStep.id" :value="nextStep.id">{{ nextStep.label || nextStep.id }}</option></select></label></div><div class="workflow-step-management"><button type="button" :disabled="index === 0" @click.stop="moveWorkflowStep(index, -1)">Move up</button><button type="button" :disabled="index === draftSteps.length - 1" @click.stop="moveWorkflowStep(index, 1)">Move down</button><button class="danger-text" type="button" @click.stop="removeWorkflowStep(index)">Delete step</button></div><details class="workflow-technical-details"><summary>Technical details <span>Show</span></summary><div><code>{{ step.id || 'generated-step' }}</code><code>type: {{ step.type }}</code><pre>{{ JSON.stringify(step.config || {}, null, 2) }}</pre></div></details></details>
              </div>
            </div>
          </article>
          <div v-if="!draftSteps.length" class="workflow-empty workflow-empty-builder"><strong>No steps yet.</strong><p>Describe the workflow above and generate steps, or add one manually.</p><div class="workflow-empty-actions"><button class="primary-button small" type="button" :disabled="!workflowDescription.trim()" @click="generateStarter"><Sparkles :size="14" :stroke-width="1.8" aria-hidden="true" />Generate workflow</button><button class="outline-button small" type="button" @click="addWorkflowStep()"><Plus :size="14" :stroke-width="1.8" aria-hidden="true" />Add step</button></div></div>
        </div>

        <div class="workflow-provider-summary"><div class="workflow-provider-summary-heading"><div><p class="eyebrow">Provider</p><h3>{{ providerStep ? formatLabel(stepConfigValue(providerStep, 'provider') || workflowProvider || 'Provider') : 'No provider connected' }}</h3></div><span :class="['status-pill', providerStep && providerConnected ? 'booked' : 'new']">{{ providerStep ? (providerConnected ? 'Connected' : 'Needs connection') : 'Optional' }}</span></div><div v-if="providerStep" class="workflow-provider-summary-detail"><span>If unavailable</span><select :value="providerFailureBehavior" @change="setStepConfigFromEvent(providerStep, 'failureBehavior', $event)"><option value="capture_lead">Capture the request and notify the team</option><option value="handoff">Hand off to staff</option><option value="retry">Retry automatically</option><option value="stop">Stop and explain</option></select></div><div v-else class="workflow-provider-summary-detail"><span>Use a provider when this workflow needs live availability, booking, or external systems.</span><button class="outline-button small" type="button" @click="configureProvider">Add provider</button></div></div>
      </main>

      <aside v-if="workflowDraft" class="workflow-preview-panel panel"><div class="workflow-preview-heading"><div><p class="eyebrow">Customer preview</p><h3>What customers will see</h3></div><span class="preview-live-dot">Live</span></div><div class="workflow-preview-window"><div class="workflow-preview-top"><span class="mini-orb"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><div><strong>AI front desk</strong><small>{{ businessName || 'Your business' }}</small></div><span class="online-dot"></span></div><div v-if="previewStep" class="workflow-preview-thread"><div class="workflow-preview-bubble">Hi! I can help you take the next step.</div><div class="workflow-preview-bubble visitor">I’m ready to get started.</div><div class="workflow-preview-bubble">{{ previewStep.question || `Next: ${previewStep.label || stepTypeLabel(previewStep.type)}` }}</div><div v-if="previewStep.options?.length" class="workflow-preview-options"><button v-for="option in previewStep.options" :key="option" type="button">{{ option }}</button></div><div v-if="previewStep.type === 'lookup'" class="workflow-preview-lookup"><GitBranch :size="15" :stroke-width="1.8" aria-hidden="true" />Searching {{ formatLabel(stepConfigValue(previewStep, 'provider') || 'provider') }} for the best matches…</div><div v-if="previewStep.type === 'redirect'" class="workflow-preview-cta"><button class="primary-button small" type="button">{{ stepConfigValue(previewStep, 'buttonLabel') || previewStep.label || 'Continue' }}</button></div></div><div v-else class="workflow-preview-empty"><Sparkles :size="20" :stroke-width="1.8" aria-hidden="true" /><strong>Add or select a step to preview</strong><p>Add or select a step to preview what visitors will experience.</p></div><div v-if="previewStep" class="workflow-preview-input">Reply to the assistant… <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></div></div><p class="form-help">{{ previewStep ? `Previewing step ${selectedStepIndex + 1} of ${draftSteps.length}.` : 'Add or select a step to preview what visitors will experience.' }}</p><div class="workflow-preview-meta"><span>{{ draftSteps.length }} steps</span><span>{{ workflowProvider ? formatLabel(workflowProvider) : 'No provider' }}</span><span>{{ configurationLabel }}</span><span>Needs testing</span></div></aside>
    </div>

    <p v-if="workflowSaveError" class="form-error">{{ workflowSaveError }}</p><p v-if="workflowSaveMessage" class="saved-message">✓ {{ workflowSaveMessage }}</p><div v-if="workflowDraft && workflowDraft.readiness?.ready === false" class="workflow-save-note"><X :size="15" :stroke-width="1.8" aria-hidden="true" /> This workflow is still in setup. Review the readiness checklist before making the action primary.</div>
  </div>
</template>

<style scoped>
.workflow-workspace { gap: 18px; }
.workflow-page-header, .workflow-builder-heading, .workflow-section-heading, .workflow-preview-heading, .workflow-provider-heading, .workflow-step-toolbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.workflow-page-header h2, .workflow-builder-heading h2, .workflow-model-banner h3, .workflow-section-heading h3, .workflow-preview-heading h3 { margin: 3px 0 5px; }
.workflow-page-header p:not(.eyebrow), .workflow-builder-heading p:not(.eyebrow), .workflow-model-banner p:not(.eyebrow), .workflow-section-heading p:not(.eyebrow) { max-width: 720px; margin: 0; color: var(--muted-text, #64748b); }
.workflow-model-banner { display: flex; align-items: center; gap: 14px; padding: 16px 18px; border: 1px solid #dbe5f0; border-radius: 14px; background: linear-gradient(120deg, #f4f8ff, #f8fbff); }
.workflow-model-icon, .workflow-assist-icon, .workflow-empty-icon, .workflow-condition-icon { display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; color: #2563eb; border-radius: 11px; background: #e7efff; }
.workflow-model-banner > div:nth-child(2) { flex: 1; }
.workflow-layout { display: grid; grid-template-columns: 235px minmax(0, 1fr) 300px; align-items: start; gap: 16px; }
.workflow-library, .workflow-preview-panel { padding: 16px; }
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
.workflow-preview-panel { position: sticky; top: 18px; }
.workflow-preview-heading { align-items: center; }
.workflow-preview-window { overflow: hidden; margin-top: 12px; border: 1px solid #dce4ef; border-radius: 12px; background: #f7faff; box-shadow: 0 8px 22px rgba(31, 60, 100, .08); }
.workflow-preview-top { display: flex; align-items: center; gap: 8px; padding: 10px; border-bottom: 1px solid #e0e8f2; background: #fff; }
.workflow-preview-top > div { display: grid; flex: 1; gap: 2px; }
.workflow-preview-top small { color: #8290a1; font-size: 10px; }
.mini-orb { display: grid; place-items: center; width: 27px; height: 27px; border-radius: 50%; background: #e9efff; }
.mini-orb img { width: 16px; height: 16px; }
.workflow-preview-thread { display: grid; gap: 8px; min-height: 290px; padding: 14px 10px; align-content: start; }
.workflow-preview-bubble { max-width: 90%; padding: 9px 10px; border-radius: 11px 11px 11px 3px; background: #fff; color: #33465d; font-size: 12px; line-height: 1.4; box-shadow: 0 2px 7px rgba(40, 67, 100, .05); }
.workflow-preview-bubble.visitor { justify-self: end; border-radius: 11px 11px 3px 11px; background: #2e61bd; color: #fff; }
.workflow-preview-options { display: grid; gap: 6px; }
.workflow-preview-options button { padding: 8px; border: 1px solid #b8ccef; border-radius: 8px; background: #fff; color: #2857a9; font-size: 11px; text-align: left; cursor: pointer; }
.workflow-preview-lookup { display: flex; align-items: center; gap: 6px; color: #58708e; font-size: 11px; }
.workflow-preview-input { display: flex; justify-content: space-between; align-items: center; padding: 10px; border-top: 1px solid #e0e8f2; background: #fff; color: #9aa7b7; font-size: 11px; }
.workflow-preview-panel > .form-help { margin: 9px 0 0; }
.workflow-preview-meta { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 12px; }
.workflow-preview-meta span { padding: 4px 6px; border-radius: 5px; background: #f0f4f8; color: #64748b; font-size: 10px; }
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
.workflow-preview-cta { display: flex; justify-content: flex-end; padding-top: 4px; }
.workflow-edit-button { width: auto !important; padding: 0 8px !important; color: #315ba9 !important; font-size: 10px; font-weight: 800; }
.workflow-advanced-settings { margin-top: 11px; padding-top: 10px; border-top: 1px solid #edf1f5; color: #65758a; font-size: 11px; }
.workflow-advanced-settings > summary { cursor: pointer; list-style: none; color: #315ba9; font-weight: 800; }
.workflow-advanced-settings > summary::-webkit-details-marker { display: none; }
.workflow-advanced-settings > summary span { float: right; color: #8290a1; font-weight: 600; }
.workflow-preview-empty { display: grid; justify-items: center; align-content: center; min-height: 290px; padding: 20px; color: #5b6d85; text-align: center; }
.workflow-preview-empty svg { margin-bottom: 8px; color: #6c54c5; }
.workflow-preview-empty strong { color: #2c405e; font-size: 13px; }
.workflow-preview-empty p { max-width: 180px; margin: 5px 0 0; color: #8290a1; font-size: 11px; line-height: 1.45; }
@media (max-width: 1260px) { .workflow-layout { grid-template-columns: 215px minmax(0, 1fr) 270px; } .workflow-assist-card { grid-template-columns: auto minmax(150px, 1fr) minmax(180px, 1.2fr) auto; } }
@media (max-width: 1180px) { .workflow-layout { grid-template-columns: 215px minmax(0, 1fr); } .workflow-preview-panel { position: static; grid-column: 2; } }
@media (max-width: 820px) { .workflow-layout { display: block; } .workflow-library, .workflow-builder, .workflow-preview-panel { margin-bottom: 15px; } .workflow-preview-panel { position: static; } .workflow-model-banner, .workflow-assist-card { align-items: flex-start; flex-wrap: wrap; } .workflow-assist-card { display: flex; } .workflow-assist-card textarea { flex-basis: 100%; } .workflow-readiness-card { display: block; } .workflow-readiness-card > .text-button { margin-top: 12px; } .workflow-provider-summary-detail { align-items: flex-start; flex-direction: column; } .workflow-provider-summary-detail select { max-width: none; width: 100%; } .workflow-page-header, .workflow-builder-heading { flex-direction: column; } }
/* Workflow preview stays aligned with the selected step. */
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
.workflow-layout { grid-template-columns: 220px minmax(480px, 1fr) 320px; gap: 26px; }
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
.workflow-assist-card textarea { min-height: 112px; padding: 13px 14px; border-color: #cec5ed; border-radius: 10px; color: #263950; font-size: 13px; line-height: 1.5; resize: vertical; }
.workflow-assist-footer { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.workflow-assist-footer > span { color: #7f8aa0; font-size: 11px; line-height: 1.4; }
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
.workflow-preview-panel { top: calc(var(--workspace-header-height, 72px) + 20px); padding: 18px; border-color: #dbe5f0; box-shadow: 0 10px 28px rgba(31, 60, 100, .06); }
.workflow-preview-heading h3 { margin-top: 3px; color: #304563; font-size: 15px; }
.workflow-preview-window { margin-top: 14px; box-shadow: none; }
.workflow-preview-thread { min-height: 225px; padding: 13px 10px; }
.workflow-preview-empty { min-height: 180px; padding: 18px; }
.workflow-preview-empty strong { font-size: 12px; }
.workflow-preview-empty p { max-width: 205px; }
.workflow-preview-meta { align-items: center; gap: 4px 12px; padding-top: 11px; margin-top: 12px; border-top: 1px solid #edf1f5; }
.workflow-preview-meta span { padding: 0; background: transparent; color: #8290a1; font-size: 10px; }
.workflow-preview-meta span + span::before { content: "·"; margin-right: 12px; color: #c0c9d4; }
.workflow-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

@media (max-width: 1260px) {
  .workflow-layout { grid-template-columns: 200px minmax(430px, 1fr) 280px; gap: 20px; }
  .workflow-assist-card { padding: 20px; }
}
@media (max-width: 1100px) {
  .workflow-layout { grid-template-columns: 210px minmax(0, 1fr); }
  .workflow-preview-panel { position: static; grid-column: 2; }
  .workflow-preview-window { max-width: 440px; }
}
@media (max-width: 820px) {
  .workflow-workspace { gap: 24px; padding-top: 24px; }
  .workflow-page-header, .workflow-builder-heading { align-items: flex-start; flex-direction: column; }
  .workflow-page-actions { width: 100%; justify-content: flex-end; }
  .workflow-model-banner { align-items: flex-start; padding: 14px; }
  .workflow-layout { display: block; }
  .workflow-library, .workflow-builder, .workflow-preview-panel { margin-bottom: 24px; }
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
  .workflow-preview-panel { padding: 16px; }
  .workflow-preview-window { max-width: none; }
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
.workflow-layout { grid-template-columns: 250px minmax(0, 1fr) minmax(300px, 320px); gap: 24px; }
.workflow-library, .workflow-builder, .workflow-preview-panel { min-width: 0; }
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
.workflow-preview-panel { width: 100%; box-sizing: border-box; }

@media (max-width: 1260px) {
  .workflow-layout { grid-template-columns: 240px minmax(0, 1fr) 300px; gap: 20px; }
}
@media (max-width: 1100px) {
  .workflow-layout { grid-template-columns: 230px minmax(0, 1fr); gap: 24px; }
  .workflow-library { padding: 0; }
  .workflow-library .panel-heading { padding-bottom: 10px; border-bottom: 0; }
  .workflow-library-select { display: grid; gap: 6px; margin: 0 0 12px; color: #708096; font-size: 11px; font-weight: 700; }
  .workflow-library-select select { width: 100%; min-height: 40px; padding: 9px 11px; border: 1px solid #d5dfeb; border-radius: 9px; background: #fff; color: #304563; font: inherit; }
  .workflow-library-item { display: none; }
  .workflow-preview-panel { grid-column: 2; }
}
</style>
