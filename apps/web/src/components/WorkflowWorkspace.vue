<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, GripVertical, Plus, Save, Sparkles, Trash2, X } from "@lucide/vue";

interface WorkflowStep {
  id?: string;
  type?: string;
  label?: string;
  fieldKey?: string;
  question?: string;
  required?: boolean;
  options?: string[];
  condition?: string;
  nextStepId?: string;
  branches?: Record<string, string>;
  config?: Record<string, unknown>;
}

interface WorkflowAction {
  id: string;
  key: string;
  name: string;
  description?: string;
  executionMode?: string;
  provider?: string | null;
  fields?: Array<{ key?: string; label?: string; type?: string; question?: string }>;
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
}>();

const emit = defineEmits<{
  (event: "refresh"): void;
  (event: "open-action", actionId: string): void;
}>();

const selectedWorkflowId = ref("");
const workflowDraft = ref<WorkflowAction | null>(null);
const selectedStepIndex = ref(0);
const workflowDescription = ref("");
const workflowSaveLoading = ref(false);
const workflowSaveError = ref("");
const workflowSaveMessage = ref("");
const advancedOpen = ref(false);
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
const previewStep = computed(() => draftSteps.value[selectedStepIndex.value] ?? draftSteps.value[0] ?? null);
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
  const hasCompletion = draftSteps.value.some((step) => ["complete", "generate_link", "book", "handoff"].includes(step.type ?? ""));
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
  selectedStepIndex.value = Math.min(selectedStepIndex.value, Math.max(0, draftSteps.value.length - 1));
}

watch(workflowActions, () => {
  if (!workflowActions.value.some((action) => action.id === selectedWorkflowId.value)) {
    selectedWorkflowId.value = workflowActions.value[0]?.id ?? "";
  }
  syncDraft();
}, { immediate: true, deep: true });

watch(selectedWorkflowId, () => {
  selectedStepIndex.value = 0;
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
  } as Record<string, unknown>);
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

function templateSteps(key: string): WorkflowStep[] {
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
  markDirty();
}

function generateStarter() {
  const text = workflowDescription.value.toLowerCase();
  const key = text.includes("enroll") || text.includes("class") || text.includes("student") ? "enrollment"
    : text.includes("tour") ? "tour"
      : text.includes("book") || text.includes("schedule") ? "booking"
        : text.includes("quote") || text.includes("estimate") ? "quote"
          : text.includes("support") || text.includes("service") ? "service"
            : text.includes("demo") ? "demo" : "lead";
  applyTemplate(key);
  workflowSaveMessage.value = `Starter ${formatLabel(key)} workflow generated. Review the steps before saving.`;
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
    workflowSaveMessage.value = "Workflow saved. Runtime will use the updated steps.";
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
</script>

<template>
  <div class="view-content workflow-workspace">
    <div class="workflow-page-header">
      <div>
        <p class="eyebrow">AI front desk</p>
        <h2>Workflows</h2>
        <p>Define how FrontDeskWise moves a visitor from intent to a reliable outcome.</p>
      </div>
      <div class="toolbar-actions">
        <button class="outline-button small" type="button" @click="emit('refresh')">Refresh</button>
        <button class="primary-button small" type="button" :disabled="!workflowDraft || workflowSaveLoading || !draftIsDirty" @click="saveWorkflow"><Save :size="14" :stroke-width="1.8" aria-hidden="true" />{{ workflowSaveLoading ? 'Saving…' : 'Save workflow' }}</button>
      </div>
    </div>

    <div class="workflow-model-banner">
      <div class="workflow-model-icon"><GitBranch :size="21" :stroke-width="1.8" aria-hidden="true" /></div>
      <div><p class="eyebrow">Actions are what · Workflows are how</p><h3>Make complex customer goals explicit and resumable.</h3><p>Simple actions can stay direct. Use a workflow when the assistant needs questions, branches, provider lookups, or a human fallback.</p></div>
      <button class="text-button" type="button" @click="emit('open-action', workflowDraft?.id ?? '')">Open Actions <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button>
    </div>

    <div class="workflow-layout">
      <aside class="workflow-library panel">
        <div class="panel-heading"><div><p class="eyebrow">Workflow library</p><h3>{{ workflowActions.length }} configured</h3></div><span class="status-pill qualified">Owner view</span></div>
        <div v-if="!workflowActions.length" class="workflow-empty"><span class="workflow-empty-icon"><GitBranch :size="22" :stroke-width="1.8" aria-hidden="true" /></span><strong>No multi-step workflows yet.</strong><p>Create an action first, then open it here to turn the path into explicit steps.</p><button class="primary-button small" type="button" @click="emit('open-action', '')">Open Actions <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
        <button v-for="action in workflowActions" :key="action.id" type="button" :class="['workflow-library-item', { active: action.id === selectedWorkflowId }]" @click="selectedWorkflowId = action.id"><span class="workflow-library-item-icon"><GitBranch :size="16" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>{{ action.name }}</strong><small>{{ action.steps?.length ?? 0 }} steps · {{ formatLabel(action.executionMode || 'FORM_FLOW') }}</small></span><ChevronDown :size="15" :stroke-width="1.8" aria-hidden="true" /></button>
        <div class="workflow-template-section"><p class="eyebrow">Templates</p><div class="workflow-template-chips"><button v-for="template in workflowTemplates" :key="template.key" type="button" @click="applyTemplate(template.key)">{{ template.label }}</button></div></div>
      </aside>

      <main v-if="workflowDraft" class="workflow-builder">
        <div class="workflow-builder-heading"><div><p class="eyebrow">Workflow builder</p><h2>{{ workflowDraft.name }}</h2><p>{{ workflowDraft.description || 'Describe the customer outcome this workflow owns.' }}</p></div><div class="workflow-builder-actions"><button class="outline-button small" type="button" @click="openAction">Edit action</button><span :class="['status-pill', readinessPercent === 100 ? 'booked' : 'qualified']">{{ readinessPercent }}% ready</span></div></div>

        <div class="workflow-assist-card"><div class="workflow-assist-icon"><Sparkles :size="18" :stroke-width="1.8" aria-hidden="true" /></div><div><strong>Generate a starter workflow</strong><p>Describe the goal in plain language. You’ll review every step before it can run.</p></div><input v-model="workflowDescription" type="text" placeholder="e.g. Enroll a child in the right class and send registration options" @keyup.enter="generateStarter" /><button class="outline-button small" type="button" @click="generateStarter">Generate starter</button></div>

        <div class="workflow-readiness-card"><div><p class="eyebrow">Readiness</p><h3>Safe to publish when the path is complete</h3></div><div class="workflow-readiness-list"><span v-for="item in readiness" :key="item.label" :class="{ complete: item.complete }"><Check :size="14" :stroke-width="2" aria-hidden="true" />{{ item.label }}</span></div></div>

        <div class="workflow-step-list">
          <div class="workflow-section-heading"><div><p class="eyebrow">Customer journey</p><h3>Steps and branches</h3><p>Keep each step focused. Conditions and provider calls make the next best action explicit.</p></div><button class="primary-button small" type="button" @click="addWorkflowStep()"><Plus :size="14" :stroke-width="1.9" aria-hidden="true" />Add step</button></div>
          <article v-for="(step, index) in draftSteps" :key="step.id || index" :class="['workflow-step-card', { selected: selectedStepIndex === index }]" @click="selectedStepIndex = index">
            <div class="workflow-step-rail"><span>{{ index + 1 }}</span><i v-if="index < draftSteps.length - 1"></i></div>
            <div class="workflow-step-body">
              <div class="workflow-step-toolbar"><div class="workflow-step-title"><GripVertical :size="16" :stroke-width="1.8" aria-hidden="true" /><input v-model="step.label" type="text" aria-label="Workflow step label" @input="markDirty" /><span class="status-pill qualified">{{ stepTypeLabel(step.type) }}</span></div><div class="workflow-step-actions"><button type="button" aria-label="Move step up" :disabled="index === 0" @click.stop="moveWorkflowStep(index, -1)">↑</button><button type="button" aria-label="Move step down" :disabled="index === draftSteps.length - 1" @click.stop="moveWorkflowStep(index, 1)">↓</button><button type="button" aria-label="Delete step" @click.stop="removeWorkflowStep(index)"><Trash2 :size="15" :stroke-width="1.8" aria-hidden="true" /></button></div></div>
              <div class="workflow-step-grid"><label>Step type<select v-model="step.type" @change="markDirty"><option v-for="type in stepTypes" :key="type.value" :value="type.value">{{ type.label }}</option></select></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form'">Field<select v-model="step.fieldKey" @change="markDirty"><option value="">No stored field</option><option v-for="field in workflowDraft.fields ?? []" :key="field.key" :value="field.key">{{ field.label || field.key }}</option></select></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form' || step.type === 'recommend' || step.type === 'confirm'">Customer-facing question<input v-model="step.question" type="text" placeholder="What should the assistant ask?" @input="markDirty" /></label><label v-if="step.type === 'capture' || step.type === 'ask' || step.type === 'form'" class="toggle-row"><span>Required</span><input v-model="step.required" type="checkbox" @change="markDirty" /></label></div>
              <label v-if="step.type === 'select' || step.type === 'recommend'">Options <span class="optional">comma separated</span><input :value="stepOptionsText(step)" type="text" placeholder="Option one, Option two" @input="setStepOptions(step, $event)" /></label>
              <div v-if="step.type === 'condition'" class="workflow-condition-box"><span class="workflow-condition-icon"><GitBranch :size="15" :stroke-width="1.8" aria-hidden="true" /></span><label>Plain-English condition<textarea v-model="step.condition" rows="2" placeholder="If the visitor is ready to register, continue to the provider lookup." @input="markDirty"></textarea></label></div>
              <div v-if="step.type === 'lookup' || step.type === 'generate_link'" class="workflow-provider-box"><div class="workflow-provider-heading"><div><p class="eyebrow">Deterministic provider step</p><strong>{{ step.type === 'lookup' ? 'Provider lookup' : 'Provider completion' }}</strong></div><span :class="['status-pill', providerConnected ? 'booked' : 'new']">{{ providerConnected ? 'Connected' : 'Needs connection' }}</span></div><div class="workflow-step-grid"><label>Provider<select :value="stepConfigValue(step, 'provider')" @change="setStepConfigFromEvent(step, 'provider', $event)"><option value="">Select provider…</option><option value="jackrabbit">Jackrabbit</option><option value="booking">Booking provider</option><option value="crm">CRM / automation</option></select></label><label v-if="step.type === 'lookup'">Operation<select :value="stepConfigValue(step, 'operation')" @change="setStepConfigFromEvent(step, 'operation', $event)"><option value="find_locations">Find locations</option><option value="find_classes">Find classes</option><option value="get_availability">Get availability</option><option value="get_class_price">Get class price</option></select></label><label v-if="step.type === 'lookup'">Search fields<input :value="stepConfigValue(step, 'searchFields')" type="text" placeholder="location, schedule, age" @input="setStepConfigFromEvent(step, 'searchFields', $event)" /></label></div><small class="form-help">Provider fields are passed explicitly. The assistant can explain a failure, retry safely, or hand off without inventing availability.</small></div>
              <div class="workflow-step-footer"><label>When this step fails<select :value="stepConfigValue(step, 'failureBehavior')" @change="setStepConfigFromEvent(step, 'failureBehavior', $event)"><option value="handoff">Hand off to staff</option><option value="capture_lead">Save details and follow up</option><option value="retry">Retry automatically</option><option value="stop">Stop and explain</option></select></label><label>Next step<select v-model="step.nextStepId" @change="markDirty"><option value="">Continue in order</option><option v-for="nextStep in draftSteps.filter((candidate) => candidate.id !== step.id)" :key="nextStep.id" :value="nextStep.id">{{ nextStep.label || nextStep.id }}</option></select></label></div>
              <details class="workflow-technical-details" :open="advancedOpen"><summary @click.prevent="advancedOpen = !advancedOpen">Technical details <span>{{ advancedOpen ? 'Hide' : 'Show' }}</span></summary><div v-if="advancedOpen"><code>{{ step.id || 'generated-step' }}</code><code>type: {{ step.type }}</code><pre>{{ JSON.stringify(step.config || {}, null, 2) }}</pre></div></details>
            </div>
          </article>
          <div v-if="!draftSteps.length" class="workflow-empty workflow-empty-builder"><strong>This workflow has no steps yet.</strong><p>Add the first question or choose a template to scaffold it.</p><button class="primary-button small" type="button" @click="addWorkflowStep()">Add first step <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
        </div>
      </main>

      <aside v-if="workflowDraft" class="workflow-preview-panel panel"><div class="workflow-preview-heading"><div><p class="eyebrow">Live customer preview</p><h3>What visitors will see</h3></div><span class="preview-live-dot">Live</span></div><div class="workflow-preview-window"><div class="workflow-preview-top"><span class="mini-orb"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><div><strong>AI front desk</strong><small>{{ businessName || 'Your business' }}</small></div><span class="online-dot"></span></div><div class="workflow-preview-thread"><div class="workflow-preview-bubble">Hi! I can help you take the next step.</div><div class="workflow-preview-bubble visitor">I’m ready to get started.</div><div class="workflow-preview-bubble">{{ previewStep?.question || (previewStep ? `Next: ${previewStep.label || stepTypeLabel(previewStep.type)}` : 'Add a step to preview the conversation.') }}</div><div v-if="previewStep?.options?.length" class="workflow-preview-options"><button v-for="option in previewStep.options" :key="option" type="button">{{ option }}</button></div><div v-if="previewStep?.type === 'lookup'" class="workflow-preview-lookup"><GitBranch :size="15" :stroke-width="1.8" aria-hidden="true" />Searching {{ formatLabel(stepConfigValue(previewStep, 'provider') || 'provider') }} for the best matches…</div></div><div class="workflow-preview-input">Reply to the assistant… <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></div></div><p class="form-help">Previewing step {{ draftSteps.length ? selectedStepIndex + 1 : 0 }} of {{ draftSteps.length }}. Select a step to inspect its customer-facing behavior.</p><div class="workflow-preview-meta"><span>{{ draftSteps.length }} steps</span><span>{{ workflowProvider ? formatLabel(workflowProvider) : 'No provider' }}</span><span>{{ readinessPercent }}% ready</span></div></aside>
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
@media (max-width: 1180px) { .workflow-layout { grid-template-columns: 215px minmax(0, 1fr); } .workflow-preview-panel { position: static; grid-column: 2; } }
@media (max-width: 820px) { .workflow-layout { display: block; } .workflow-library, .workflow-builder, .workflow-preview-panel { margin-bottom: 15px; } .workflow-preview-panel { position: static; } .workflow-model-banner, .workflow-assist-card { align-items: flex-start; flex-wrap: wrap; } .workflow-assist-card input { flex-basis: 100%; } .workflow-page-header, .workflow-builder-heading { flex-direction: column; } }
</style>
