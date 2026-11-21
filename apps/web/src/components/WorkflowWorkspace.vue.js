import { computed, onMounted, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, GripVertical, Plus, Save, Sparkles, Trash2, X } from "@lucide/vue";
const { defineProps, defineEmits, } = {};
const props = defineProps();
const emit = defineEmits();
const selectedWorkflowId = ref("");
const workflowDraft = ref(null);
const selectedStepIndex = ref(-1);
const workflowDescription = ref("");
const workflowSaveLoading = ref(false);
const workflowSaveError = ref("");
const workflowSaveMessage = ref("");
const advancedOpen = ref(false);
const showModelBanner = ref(true);
const showTemplatePicker = ref(false);
const workflowAssistInput = ref(null);
const workflowStepList = ref(null);
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
function asWorkflowAction(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string")
        return null;
    return candidate;
}
const allActions = computed(() => props.actions.map(asWorkflowAction).filter((action) => Boolean(action)));
const workflowActions = computed(() => allActions.value.filter((action) => {
    const stepCount = Array.isArray(action.steps) ? action.steps.length : 0;
    return stepCount > 1 || action.executionMode === "PROVIDER_FLOW" || (action.fields?.length ?? 0) > 2;
}));
const selectedWorkflow = computed(() => workflowActions.value.find((action) => action.id === selectedWorkflowId.value) ?? workflowActions.value[0] ?? null);
const draftSteps = computed(() => (workflowDraft.value?.steps ?? []));
const previewStep = computed(() => selectedStepIndex.value >= 0 ? draftSteps.value[selectedStepIndex.value] ?? null : null);
const workflowProvider = computed(() => {
    const direct = workflowDraft.value?.provider?.trim();
    if (direct)
        return direct.toLowerCase();
    const lookup = draftSteps.value.find((step) => step.type === "lookup");
    const provider = lookup ? stepConfigValue(lookup, "provider") : "";
    return provider.toLowerCase();
});
const providerConnected = computed(() => {
    if (!workflowProvider.value)
        return true;
    return props.integrations.some((value) => {
        const integration = value;
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
const readinessComplete = computed(() => readiness.value.filter((item) => item.complete));
const readinessRemaining = computed(() => readiness.value.filter((item) => !item.complete).slice(0, 3));
const providerStep = computed(() => draftSteps.value.find((step) => step.type === "lookup" || step.type === "generate_link") ?? null);
const providerFailureBehavior = computed(() => providerStep.value ? stepConfigValue(providerStep.value, "failureBehavior") : "capture_lead");
function clone(value) {
    return JSON.parse(JSON.stringify(value));
}
function syncDraft(force = false) {
    const selected = selectedWorkflow.value;
    if (!selected) {
        workflowDraft.value = null;
        draftSourceId = "";
        return;
    }
    if (!force && draftIsDirty.value && draftSourceId === selected.id)
        return;
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
function formatLabel(value) {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function stepTypeLabel(type) {
    return stepTypes.find((item) => item.value === type)?.label ?? formatLabel(type || "Step");
}
function ensureStepConfig(step) {
    if (!step.config || Array.isArray(step.config))
        step.config = {};
    return step.config;
}
function stepConfigValue(step, key) {
    const value = ensureStepConfig(step)[key];
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function setStepConfig(step, key, value) {
    ensureStepConfig(step)[key] = value || undefined;
    markDirty();
}
function setStepConfigFromEvent(step, key, event) {
    setStepConfig(step, key, event.target.value);
}
function stepOptionsText(step) {
    return (step.options ?? []).join(", ");
}
function setStepOptions(step, event) {
    step.options = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
    markDirty();
}
function stepConditionText(step) {
    return typeof step.condition === "string" ? step.condition : "";
}
function addWorkflowStep(type = "capture") {
    if (!workflowDraft.value)
        return;
    workflowDraft.value.steps ??= [];
    const nextIndex = workflowDraft.value.steps.length + 1;
    workflowDraft.value.steps.push({
        id: `step-${Date.now()}-${nextIndex}`,
        type,
        label: stepTypeLabel(type),
        question: type === "capture" || type === "ask" ? "What should we know?" : undefined,
        required: type === "capture" || type === "ask",
        config: type === "lookup" ? { provider: workflowProvider.value || "jackrabbit", operation: "find_classes", failureBehavior: "handoff", searchFields: "location, schedule, age" } : {},
    });
    selectedStepIndex.value = draftSteps.value.length - 1;
    markDirty();
}
function removeWorkflowStep(index) {
    if (!workflowDraft.value?.steps)
        return;
    workflowDraft.value.steps.splice(index, 1);
    selectedStepIndex.value = Math.max(0, Math.min(selectedStepIndex.value, draftSteps.value.length - 1));
    markDirty();
}
function moveWorkflowStep(index, direction) {
    if (!workflowDraft.value?.steps)
        return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= workflowDraft.value.steps.length)
        return;
    const steps = workflowDraft.value.steps;
    [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
    selectedStepIndex.value = nextIndex;
    markDirty();
}
function templateSteps(key) {
    const field = (id, label, fieldKey, question) => ({ id, type: "capture", label, fieldKey, question, required: true, config: {} });
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
        return [field("service", "Service", "service", "What would you like to book?"), field("schedule", "Schedule", "schedule", "What day or time works best?"), { id: "availability", type: "lookup", label: "Check availability", config: { provider: "booking", operation: "get_availability", searchFields: "service, schedule", failureBehavior: "handoff" } }, { id: "select", type: "select", label: "Select a time", options: ["First available", "Morning", "Afternoon"], config: {} }, { id: "confirm", type: "confirm", label: "Confirm booking", question: "Should I reserve this time for you?", config: {} }, { id: "book", type: "book", label: "Book", config: { failureBehavior: "handoff" } }];
    }
    if (key === "service") {
        return [field("contact", "Contact", "name", "Who should we follow up with?"), field("request", "Request", "request", "What do you need help with?"), { id: "route", type: "condition", label: "Route request", condition: "If the request needs a specialist, send it to the service team.", config: {} }, { id: "save", type: "create_lead", label: "Save service request", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify staff", config: { failureBehavior: "handoff" } }, { id: "complete", type: "complete", label: "Confirm next step", config: {} }];
    }
    if (key === "quote")
        return [field("contact", "Contact", "name", "What is your name?"), field("requirements", "Requirements", "requirements", "What would you like a quote for?"), { id: "quote-review", type: "condition", label: "Review requirements", condition: "If requirements are complete, create a quote request.", config: {} }, { id: "save", type: "create_lead", label: "Save quote request", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify sales", config: {} }, { id: "complete", type: "complete", label: "Confirm quote follow-up", config: {} }];
    return [field("contact", "Contact", "name", "What is your name?"), field("email", "Email", "email", "What email should we use?"), field("context", "Context", "context", "What are you hoping to accomplish?"), { id: "qualify", type: "condition", label: "Qualify request", condition: "If the visitor is ready, mark the lead qualified.", config: {} }, { id: "save", type: "create_lead", label: "Save qualified lead", config: { failureBehavior: "handoff" } }, { id: "notify", type: "notify", label: "Notify the team", config: {} }, { id: "complete", type: "complete", label: "Confirm follow-up", config: {} }];
}
function applyTemplate(key) {
    if (!workflowDraft.value)
        return;
    workflowDraft.value.steps = templateSteps(key);
    if (key === "enrollment") {
        workflowDraft.value.executionMode = "PROVIDER_FLOW";
        workflowDraft.value.provider = "jackrabbit";
    }
    selectedStepIndex.value = 0;
    showTemplatePicker.value = false;
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
    if (!workflowDraft.value || workflowSaveLoading.value)
        return;
    workflowSaveLoading.value = true;
    workflowSaveError.value = "";
    workflowSaveMessage.value = "";
    try {
        const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions/${encodeURIComponent(workflowDraft.value.id)}`), {
            method: "PUT",
            headers: { "content-type": "application/json", ...props.ownerHeaders() },
            body: JSON.stringify(workflowDraft.value),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error ?? "Could not save this workflow.");
        if (payload.action)
            workflowDraft.value = clone(payload.action);
        draftIsDirty.value = false;
        workflowSaveMessage.value = "Workflow saved. Runtime will use the updated steps.";
        emit("refresh");
    }
    catch (error) {
        workflowSaveError.value = error instanceof Error ? error.message : "Could not save this workflow.";
    }
    finally {
        workflowSaveLoading.value = false;
    }
}
function openAction() {
    if (workflowDraft.value)
        emit("open-action", workflowDraft.value.id);
}
function dismissModelBanner() {
    showModelBanner.value = false;
    try {
        window.localStorage.setItem("frontdeskwise:workflow-model-banner-dismissed", "1");
    }
    catch {
        // Banner dismissal is a convenience; it should never block the builder.
    }
}
function continueSetup() {
    if (!workflowDraft.value)
        return;
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
    }
    catch {
        // Keep the banner visible when storage is unavailable.
    }
});
const __VLS_ctx = {
    ...{},
    ...{},
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
void __VLS_ctx, __VLS_components, __VLS_intrinsics, __VLS_directives;
const __VLS_template = () => {
    __VLS_withDotValue(workflowDraft, {});
    __VLS_withDotValue(workflowSaveLoading, {});
    __VLS_withDotValue(draftIsDirty, {});
    __VLS_withDotValue(showModelBanner, {});
    __VLS_withDotValue(workflowActions, {});
    __VLS_withDotValue(selectedWorkflowId, {});
    __VLS_withDotValue(showTemplatePicker, {});
    __VLS_withDotValue(readinessPercent, {});
    __VLS_withDotValue(workflowDescription, {});
    __VLS_withDotValue(readinessRemaining, {});
    __VLS_withDotValue(readinessComplete, {});
    __VLS_withDotValue(providerStep, {});
    __VLS_withDotValue(workflowProvider, {});
    __VLS_withDotValue(providerConnected, {});
    __VLS_withDotValue(selectedStepIndex, {});
    __VLS_withDotValue(draftSteps, {});
    __VLS_withDotValue(advancedOpen, {});
    __VLS_withDotValue(previewStep, {});
    __VLS_withDotValue(workflowSaveError, {});
    __VLS_withDotValue(workflowSaveMessage, {});
    void {};
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-chips']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-chips']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-condition-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-condition-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
    /** @type {__VLS_StyleScopedClasses['mini-orb']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-bubble']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-options']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "view-content workflow-workspace" },
    });
    /** @type {__VLS_StyleScopedClasses['view-content']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "workflow-page-header" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "toolbar-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['toolbar-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('refresh'));
                // @ts-ignore
                [emit,];
            } },
        ...{ class: "outline-button small" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (saveWorkflow) },
        ...{ class: "primary-button small" },
        type: "button",
        disabled: (!workflowDraft.value || workflowSaveLoading.value || !draftIsDirty.value),
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    let __VLS_0;
    /** @ts-ignore @type { | typeof Save} */
    Save;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
        // @ts-ignore
        size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_2 = __VLS_1({
        size: (14),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    (workflowSaveLoading.value ? 'Saving…' : 'Save workflow');
    if (showModelBanner.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-model-banner" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-model-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-model-icon']} */ ;
        let __VLS_5;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
            // @ts-ignore
            size: (21), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_7 = __VLS_6({
            size: (21),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_6));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (dismissModelBanner) },
            ...{ class: "text-button" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "workflow-layout" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
        ...{ class: "workflow-library panel" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "panel-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    (workflowActions.value.length);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('open-action', ''));
                // @ts-ignore
                [emit, workflowDraft, workflowSaveLoading, workflowSaveLoading, draftIsDirty, showModelBanner, workflowActions,];
            } },
        ...{ class: "outline-button small" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    let __VLS_10;
    /** @ts-ignore @type { | typeof Plus} */
    Plus;
    // @ts-ignore
    const __VLS_11 = __VLS_asFunctionalComponent1(__VLS_10, new __VLS_10({
        // @ts-ignore
        size: (14), strokeWidth: (1.9), 'aria-hidden': "true",
    }));
    const __VLS_12 = __VLS_11({
        size: (14),
        strokeWidth: (1.9),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_11));
    if (!workflowActions.value.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-empty-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty-icon']} */ ;
        let __VLS_15;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_16 = __VLS_asFunctionalComponent1(__VLS_15, new __VLS_15({
            // @ts-ignore
            size: (22), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_17 = __VLS_16({
            size: (22),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_16));
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(!workflowActions.value.length))
                        throw 0;
                    return (__VLS_unwrap(emit, {})('open-action', ''));
                    // @ts-ignore
                    [emit, workflowActions,];
                } },
            ...{ class: "primary-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_20;
        /** @ts-ignore @type { | typeof ArrowRight} */
        ArrowRight;
        // @ts-ignore
        const __VLS_21 = __VLS_asFunctionalComponent1(__VLS_20, new __VLS_20({
            // @ts-ignore
            size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_22 = __VLS_21({
            size: (14),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_21));
    }
    const __VLS_25 = __VLS_tryAsConstant((workflowActions.value));
    for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_25))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (selectedWorkflowId.value = action.id);
                    // @ts-ignore
                    [workflowActions, selectedWorkflowId,];
                } },
            key: (action.id),
            type: "button",
            ...{ class: (['workflow-library-item', { active: action.id === selectedWorkflowId.value }]) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-library-item-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-library-item-icon']} */ ;
        let __VLS_26;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26({
            // @ts-ignore
            size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_28 = __VLS_27({
            size: (16),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_27));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (action.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (action.steps?.length ?? 0);
        (formatLabel(action.executionMode || 'FORM_FLOW'));
        let __VLS_31;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
        // @ts-ignore
        const __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_33 = __VLS_32({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_32));
        // @ts-ignore
        [selectedWorkflowId,];
    }
    if (workflowDraft.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-template-section" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-template-section']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (showTemplatePicker.value = !showTemplatePicker.value);
                    // @ts-ignore
                    [workflowDraft, showTemplatePicker, showTemplatePicker,];
                } },
            ...{ class: "text-button workflow-template-trigger" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-template-trigger']} */ ;
        let __VLS_36;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
        // @ts-ignore
        const __VLS_37 = __VLS_asFunctionalComponent1(__VLS_36, new __VLS_36({
            // @ts-ignore
            size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_38 = __VLS_37({
            size: (14),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_37));
        if (showTemplatePicker.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-template-picker" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            const __VLS_41 = __VLS_tryAsConstant((__VLS_unwrap(workflowTemplates, {})));
            for (const [template] of __VLS_vFor(__VLS_nonNull(__VLS_41))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!(showTemplatePicker.value))
                                throw 0;
                            return (applyTemplate(template.key));
                            // @ts-ignore
                            [showTemplatePicker, workflowTemplates,];
                        } },
                    key: (template.key),
                    type: "button",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                (template.label);
                __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                (template.description);
                // @ts-ignore
                [];
            }
        }
    }
    if (workflowDraft.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({
            ...{ class: "workflow-builder" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-builder-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        (workflowDraft.value.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        (workflowDraft.value.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (workflowDraft.value.description || 'Describe the customer outcome this workflow owns.');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-builder-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-builder-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (openAction) },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (['status-pill', readinessPercent.value === 100 ? 'booked' : 'qualified']) },
        });
        /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
        (readinessPercent.value);
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-card" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-icon']} */ ;
        let __VLS_42;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_43 = __VLS_asFunctionalComponent1(__VLS_42, new __VLS_42({
            // @ts-ignore
            size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_44 = __VLS_43({
            size: (18),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_43));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
            ...{ onKeydown: (generateStarter) },
            ...{ onKeydown: (generateStarter) },
            ref: "workflowAssistInput",
            value: (workflowDescription.value),
            rows: "2",
            placeholder: "Example: We ask the child’s age, swimming ability, location, and preferred days, then show available classes.",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (generateStarter) },
            ...{ class: "primary-button small" },
            type: "button",
            disabled: (!workflowDescription.value.trim()),
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_47;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_48 = __VLS_asFunctionalComponent1(__VLS_47, new __VLS_47({
            // @ts-ignore
            size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_49 = __VLS_48({
            size: (14),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_48));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-card" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (readinessRemaining.value.length ? 'Finish these next' : 'Ready to publish');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-list" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
        const __VLS_52 = __VLS_tryAsConstant((readinessComplete.value.slice(0, 1)));
        for (const [item] of __VLS_vFor(__VLS_nonNull(__VLS_52))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (item.label),
                ...{ class: "complete" },
            });
            /** @type {__VLS_StyleScopedClasses['complete']} */ ;
            let __VLS_53;
            /** @ts-ignore @type { | typeof Check} */
            Check;
            // @ts-ignore
            const __VLS_54 = __VLS_asFunctionalComponent1(__VLS_53, new __VLS_53({
                // @ts-ignore
                size: (14), strokeWidth: (2), 'aria-hidden': "true",
            }));
            const __VLS_55 = __VLS_54({
                size: (14),
                strokeWidth: (2),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_54));
            (item.label.replace('Workflow ', ''));
            // @ts-ignore
            [workflowDraft, workflowDraft, workflowDraft, workflowDraft, readinessPercent, readinessPercent, workflowDescription, workflowDescription, readinessRemaining, readinessComplete,];
        }
        const __VLS_58 = __VLS_tryAsConstant((readinessRemaining.value));
        for (const [item] of __VLS_vFor(__VLS_nonNull(__VLS_58))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (item.label),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                'aria-hidden': "true",
            });
            (item.label.replace('Questions and capture fields are defined', 'Add at least one step').replace('Completion path is defined', 'Add completion behavior').replace('Failure and handoff path is defined', 'Choose what happens if unavailable'));
            // @ts-ignore
            [readinessRemaining,];
        }
        if (readinessRemaining.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (continueSetup) },
                ...{ class: "text-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            let __VLS_59;
            /** @ts-ignore @type { | typeof ArrowRight} */
            ArrowRight;
            // @ts-ignore
            const __VLS_60 = __VLS_asFunctionalComponent1(__VLS_59, new __VLS_59({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_61 = __VLS_60({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_60));
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-provider-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-provider-summary-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (providerStep.value ? formatLabel(stepConfigValue(providerStep.value, 'provider') || workflowProvider.value || 'Provider') : 'No provider configured');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (['status-pill', providerStep.value && providerConnected.value ? 'booked' : 'new']) },
        });
        /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
        (providerStep.value ? (providerConnected.value ? 'Connected' : 'Needs connection') : 'Optional');
        if (providerStep.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-provider-summary-detail" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                ...{ onChange: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(providerStep.value))
                            throw 0;
                        return (setStepConfigFromEvent(providerStep.value, 'failureBehavior', $event));
                        // @ts-ignore
                        [readinessRemaining, providerStep, providerStep, providerStep, providerStep, providerStep, providerStep, workflowProvider, providerConnected, providerConnected,];
                    } },
                value: (__VLS_unwrap(providerFailureBehavior, {})),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "capture_lead",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "handoff",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "retry",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "stop",
            });
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-provider-summary-detail" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (configureProvider) },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ref: "workflowStepList",
            ...{ class: "workflow-step-list" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-section-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (addWorkflowStep());
                    // @ts-ignore
                    [providerFailureBehavior,];
                } },
            ...{ class: "primary-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_64;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_65 = __VLS_asFunctionalComponent1(__VLS_64, new __VLS_64({
            // @ts-ignore
            size: (14), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_66 = __VLS_65({
            size: (14),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_65));
        const __VLS_69 = __VLS_tryAsConstant((draftSteps.value));
        for (const [step, index] of __VLS_vFor(__VLS_nonNull(__VLS_69))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (selectedStepIndex.value = index);
                        // @ts-ignore
                        [draftSteps, selectedStepIndex,];
                    } },
                key: (step.id || index),
                ...{ class: (['workflow-step-card', { selected: selectedStepIndex.value === index }]) },
            });
            /** @type {__VLS_StyleScopedClasses['selected']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-rail" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (index + 1);
            if (index < draftSteps.value.length - 1) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-body" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-toolbar" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-toolbar']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-title" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
            let __VLS_70;
            /** @ts-ignore @type { | typeof GripVertical} */
            GripVertical;
            // @ts-ignore
            const __VLS_71 = __VLS_asFunctionalComponent1(__VLS_70, new __VLS_70({
                // @ts-ignore
                size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_72 = __VLS_71({
                size: (16),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_71));
            if (selectedStepIndex.value === index) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                    ...{ onInput: (markDirty) },
                    value: (step.label),
                    type: "text",
                    'aria-label': "Workflow step label",
                });
            }
            else {
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                (step.label || stepTypeLabel(step.type));
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "status-pill qualified" },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            /** @type {__VLS_StyleScopedClasses['qualified']} */ ;
            (stepTypeLabel(step.type));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (selectedStepIndex.value = selectedStepIndex.value === index ? -1 : index);
                        // @ts-ignore
                        [draftSteps, selectedStepIndex, selectedStepIndex, selectedStepIndex, selectedStepIndex,];
                    } },
                ...{ class: "workflow-edit-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-edit-button']} */ ;
            (selectedStepIndex.value === index ? 'Done' : 'Edit');
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (moveWorkflowStep(index, -1));
                        // @ts-ignore
                        [selectedStepIndex,];
                    } },
                type: "button",
                'aria-label': "Move step up",
                disabled: (index === 0),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (moveWorkflowStep(index, 1));
                        // @ts-ignore
                        [];
                    } },
                type: "button",
                'aria-label': "Move step down",
                disabled: (index === draftSteps.value.length - 1),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (removeWorkflowStep(index));
                        // @ts-ignore
                        [draftSteps,];
                    } },
                type: "button",
                'aria-label': "Delete step",
            });
            let __VLS_75;
            /** @ts-ignore @type { | typeof Trash2} */
            Trash2;
            // @ts-ignore
            const __VLS_76 = __VLS_asFunctionalComponent1(__VLS_75, new __VLS_75({
                // @ts-ignore
                size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_77 = __VLS_76({
                size: (15),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_76));
            if (selectedStepIndex.value !== index) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-step-summary" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (step.question || step.fieldKey || (step.type === 'condition' ? 'Add a condition' : step.type === 'lookup' ? 'Find availability with a provider' : 'Select Edit to configure this step'));
                if (step.condition) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-summary-tag" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-summary-tag']} */ ;
                }
                if (step.type === 'lookup' || step.type === 'generate_link') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-summary-tag" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-summary-tag']} */ ;
                    (formatLabel(stepConfigValue(step, 'provider') || 'Provider'));
                }
            }
            else {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-step-grid" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                    ...{ onChange: (markDirty) },
                    value: (step.type),
                });
                const __VLS_80 = __VLS_tryAsConstant((__VLS_unwrap(stepTypes, {})));
                for (const [type] of __VLS_vFor(__VLS_nonNull(__VLS_80))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        key: (type.value),
                        value: (type.value),
                    });
                    (type.label);
                    // @ts-ignore
                    [selectedStepIndex, stepTypes,];
                }
                if (step.type === 'capture' || step.type === 'ask' || step.type === 'form') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (markDirty) },
                        value: (step.fieldKey),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "",
                    });
                    const __VLS_81 = __VLS_tryAsConstant((workflowDraft.value.fields ?? []));
                    for (const [field] of __VLS_vFor(__VLS_nonNull(__VLS_81))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            key: (field.key),
                            value: (field.key),
                        });
                        (field.label || field.key);
                        // @ts-ignore
                        [workflowDraft,];
                    }
                }
                if (step.type === 'capture' || step.type === 'ask' || step.type === 'form' || step.type === 'recommend' || step.type === 'confirm') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onInput: (markDirty) },
                        value: (step.question),
                        type: "text",
                        placeholder: "What should the assistant ask?",
                    });
                }
                if (step.type === 'capture' || step.type === 'ask' || step.type === 'form') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                        ...{ class: "toggle-row" },
                    });
                    /** @type {__VLS_StyleScopedClasses['toggle-row']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onChange: (markDirty) },
                        type: "checkbox",
                    });
                    (step.required);
                }
                if (step.type === 'select' || step.type === 'recommend') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "optional" },
                    });
                    /** @type {__VLS_StyleScopedClasses['optional']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onInput: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== index))
                                    throw 0;
                                if (!(step.type === 'select' || step.type === 'recommend'))
                                    throw 0;
                                return (setStepOptions(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepOptionsText(step)),
                        type: "text",
                        placeholder: "Option one, Option two",
                    });
                }
                if (step.type === 'condition') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-condition-box" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-condition-box']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-condition-icon" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-condition-icon']} */ ;
                    let __VLS_82;
                    /** @ts-ignore @type { | typeof GitBranch} */
                    GitBranch;
                    // @ts-ignore
                    const __VLS_83 = __VLS_asFunctionalComponent1(__VLS_82, new __VLS_82({
                        // @ts-ignore
                        size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
                    }));
                    const __VLS_84 = __VLS_83({
                        size: (15),
                        strokeWidth: (1.8),
                        'aria-hidden': "true",
                    }, ...__VLS_functionalComponentArgsRest(__VLS_83));
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                        ...{ onInput: (markDirty) },
                        value: (step.condition),
                        rows: "2",
                        placeholder: "If the visitor is ready to register, continue to the provider lookup.",
                    });
                }
                if (step.type === 'lookup' || step.type === 'generate_link') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-provider-box" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-provider-box']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-provider-heading" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                        ...{ class: "eyebrow" },
                    });
                    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                    (step.type === 'lookup' ? 'Find availability' : 'Complete with provider');
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: (['status-pill', providerConnected.value ? 'booked' : 'new']) },
                    });
                    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
                    (providerConnected.value ? 'Connected' : 'Needs connection');
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-step-grid" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== index))
                                    throw 0;
                                if (!(step.type === 'lookup' || step.type === 'generate_link'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'provider', $event));
                                // @ts-ignore
                                [providerConnected, providerConnected,];
                            } },
                        value: (stepConfigValue(step, 'provider')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "jackrabbit",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "booking",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "crm",
                    });
                    if (step.type === 'lookup') {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                            ...{ onChange: (...[$event]) => {
                                    void $event;
                                    if (!(workflowDraft.value))
                                        throw 0;
                                    if (!!(selectedStepIndex.value !== index))
                                        throw 0;
                                    if (!(step.type === 'lookup' || step.type === 'generate_link'))
                                        throw 0;
                                    if (!(step.type === 'lookup'))
                                        throw 0;
                                    return (setStepConfigFromEvent(step, 'operation', $event));
                                    // @ts-ignore
                                    [];
                                } },
                            value: (stepConfigValue(step, 'operation')),
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            value: "find_locations",
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            value: "find_classes",
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            value: "get_availability",
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            value: "get_class_price",
                        });
                    }
                    if (step.type === 'lookup') {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                            ...{ onInput: (...[$event]) => {
                                    void $event;
                                    if (!(workflowDraft.value))
                                        throw 0;
                                    if (!!(selectedStepIndex.value !== index))
                                        throw 0;
                                    if (!(step.type === 'lookup' || step.type === 'generate_link'))
                                        throw 0;
                                    if (!(step.type === 'lookup'))
                                        throw 0;
                                    return (setStepConfigFromEvent(step, 'searchFields', $event));
                                    // @ts-ignore
                                    [];
                                } },
                            value: (stepConfigValue(step, 'searchFields')),
                            type: "text",
                            placeholder: "location, schedule, age",
                        });
                    }
                    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({
                        ...{ class: "form-help" },
                    });
                    /** @type {__VLS_StyleScopedClasses['form-help']} */ ;
                }
                __VLS_asFunctionalElement1(__VLS_intrinsics.details, __VLS_intrinsics.details)({
                    ...{ class: "workflow-advanced-settings" },
                    open: (advancedOpen.value),
                });
                /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.summary, __VLS_intrinsics.summary)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== index))
                                throw 0;
                            return (advancedOpen.value = !advancedOpen.value);
                            // @ts-ignore
                            [advancedOpen, advancedOpen, advancedOpen,];
                        } },
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (advancedOpen.value ? 'Hide' : 'Show');
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-step-footer" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-step-footer']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                    ...{ onChange: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== index))
                                throw 0;
                            return (setStepConfigFromEvent(step, 'failureBehavior', $event));
                            // @ts-ignore
                            [advancedOpen,];
                        } },
                    value: (stepConfigValue(step, 'failureBehavior')),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "handoff",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "capture_lead",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "retry",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "stop",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                    ...{ onChange: (markDirty) },
                    value: (step.nextStepId),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "",
                });
                const __VLS_87 = __VLS_tryAsConstant((draftSteps.value.filter((candidate) => candidate.id !== step.id)));
                for (const [nextStep] of __VLS_vFor(__VLS_nonNull(__VLS_87))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        key: (nextStep.id),
                        value: (nextStep.id),
                    });
                    (nextStep.label || nextStep.id);
                    // @ts-ignore
                    [draftSteps,];
                }
                __VLS_asFunctionalElement1(__VLS_intrinsics.details, __VLS_intrinsics.details)({
                    ...{ class: "workflow-technical-details" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-technical-details']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.summary, __VLS_intrinsics.summary)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
                (step.id || 'generated-step');
                __VLS_asFunctionalElement1(__VLS_intrinsics.code, __VLS_intrinsics.code)({});
                (step.type);
                __VLS_asFunctionalElement1(__VLS_intrinsics.pre, __VLS_intrinsics.pre)({});
                (JSON.stringify(step.config || {}, null, 2));
            }
            // @ts-ignore
            [];
        }
        if (!draftSteps.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-empty workflow-empty-builder" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-empty-builder']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(!draftSteps.value.length))
                            throw 0;
                        return (addWorkflowStep());
                        // @ts-ignore
                        [draftSteps,];
                    } },
                ...{ class: "primary-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            let __VLS_88;
            /** @ts-ignore @type { | typeof ArrowRight} */
            ArrowRight;
            // @ts-ignore
            const __VLS_89 = __VLS_asFunctionalComponent1(__VLS_88, new __VLS_88({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_90 = __VLS_89({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_89));
        }
    }
    if (workflowDraft.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
            ...{ class: "workflow-preview-panel panel" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
        /** @type {__VLS_StyleScopedClasses['panel']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-preview-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (previewStep.value ? 'What customers will see' : 'Preview the experience');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "preview-live-dot" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-live-dot']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-preview-window" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-window']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-preview-top" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "mini-orb" },
        });
        /** @type {__VLS_StyleScopedClasses['mini-orb']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: "/frontdeskwise-logo-mark.png",
            alt: "",
            'aria-hidden': "true",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_ctx.businessName || 'Your business');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "online-dot" },
        });
        /** @type {__VLS_StyleScopedClasses['online-dot']} */ ;
        if (previewStep.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-thread" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-thread']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-bubble" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-bubble']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-bubble visitor" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-bubble']} */ ;
            /** @type {__VLS_StyleScopedClasses['visitor']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-bubble" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-bubble']} */ ;
            (previewStep.value.question || `Next: ${previewStep.value.label || stepTypeLabel(previewStep.value.type)}`);
            if (previewStep.value.options?.length) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-preview-options" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-preview-options']} */ ;
                const __VLS_93 = __VLS_tryAsConstant((previewStep.value.options));
                for (const [option] of __VLS_vFor(__VLS_nonNull(__VLS_93))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                        key: (option),
                        type: "button",
                    });
                    (option);
                    // @ts-ignore
                    [workflowDraft, previewStep, previewStep, previewStep, previewStep, previewStep, previewStep, previewStep, businessName,];
                }
            }
            if (previewStep.value.type === 'lookup') {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-preview-lookup" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-preview-lookup']} */ ;
                let __VLS_94;
                /** @ts-ignore @type { | typeof GitBranch} */
                GitBranch;
                // @ts-ignore
                const __VLS_95 = __VLS_asFunctionalComponent1(__VLS_94, new __VLS_94({
                    // @ts-ignore
                    size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
                }));
                const __VLS_96 = __VLS_95({
                    size: (15),
                    strokeWidth: (1.8),
                    'aria-hidden': "true",
                }, ...__VLS_functionalComponentArgsRest(__VLS_95));
                (formatLabel(stepConfigValue(previewStep.value, 'provider') || 'provider'));
            }
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
            let __VLS_99;
            /** @ts-ignore @type { | typeof Sparkles} */
            Sparkles;
            // @ts-ignore
            const __VLS_100 = __VLS_asFunctionalComponent1(__VLS_99, new __VLS_99({
                // @ts-ignore
                size: (20), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_101 = __VLS_100({
                size: (20),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_100));
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        }
        if (previewStep.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-preview-input" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-preview-input']} */ ;
            let __VLS_104;
            /** @ts-ignore @type { | typeof ArrowRight} */
            ArrowRight;
            // @ts-ignore
            const __VLS_105 = __VLS_asFunctionalComponent1(__VLS_104, new __VLS_104({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_106 = __VLS_105({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_105));
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "form-help" },
        });
        /** @type {__VLS_StyleScopedClasses['form-help']} */ ;
        (previewStep.value ? `Previewing step ${selectedStepIndex.value + 1} of ${draftSteps.value.length}.` : 'Add or select a step to see the customer experience.');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-preview-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (draftSteps.value.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (workflowProvider.value ? formatLabel(workflowProvider.value) : 'No provider');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (readinessPercent.value);
    }
    if (workflowSaveError.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "form-error" },
        });
        /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
        (workflowSaveError.value);
    }
    if (workflowSaveMessage.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "saved-message" },
        });
        /** @type {__VLS_StyleScopedClasses['saved-message']} */ ;
        (workflowSaveMessage.value);
    }
    if (workflowDraft.value && workflowDraft.value.readiness?.ready === false) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-save-note" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-save-note']} */ ;
        let __VLS_109;
        /** @ts-ignore @type { | typeof X} */
        X;
        // @ts-ignore
        const __VLS_110 = __VLS_asFunctionalComponent1(__VLS_109, new __VLS_109({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_111 = __VLS_110({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_110));
    }
    // @ts-ignore
    [workflowDraft, workflowDraft, readinessPercent, workflowProvider, workflowProvider, draftSteps, draftSteps, selectedStepIndex, previewStep, previewStep, previewStep, previewStep, workflowSaveError, workflowSaveError, workflowSaveMessage, workflowSaveMessage,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
