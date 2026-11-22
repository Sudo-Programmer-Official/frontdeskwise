import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, GripVertical, Plus, Save, Sparkles, X } from "@lucide/vue";
import { generateWorkflow, preserveWorkflowGoal, templateSteps, workflowGenerationCacheKey } from "../workflow-generator.js";
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
const workflowGoalExpanded = ref(false);
const draftIsDirty = ref(false);
const workflowGenerationKey = ref("");
const createWorkflowOpen = ref(false);
const createWorkflowMode = ref("action");
const createWorkflowActionId = ref("");
const createWorkflowTemplateKey = ref("lead");
const createWorkflowDescription = ref("");
const createWorkflowLoading = ref(false);
const createWorkflowError = ref("");
const createNewActionOpen = ref(false);
const createNewActionName = ref("");
const createNewActionDescription = ref("");
const locallyCreatedAction = ref(null);
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
function asWorkflowAction(value) {
    if (!value || typeof value !== "object")
        return null;
    const candidate = value;
    if (typeof candidate.id !== "string" || typeof candidate.name !== "string")
        return null;
    return candidate;
}
const allActions = computed(() => {
    const actions = props.actions.map(asWorkflowAction).filter((action) => Boolean(action));
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
const workflowMetadata = computed(() => {
    const value = workflowDraft.value?.completion && typeof workflowDraft.value.completion === "object"
        ? workflowDraft.value.completion.workflow
        : null;
    if (!value || typeof value !== "object")
        return null;
    const metadata = value;
    return typeof metadata.name === "string" && typeof metadata.actionId === "string"
        ? { name: metadata.name, actionId: metadata.actionId }
        : null;
});
const linkedAction = computed(() => allActions.value.find((action) => action.id === (workflowMetadata.value?.actionId ?? workflowDraft.value?.id)) ?? workflowDraft.value);
const workflowTitle = computed(() => workflowMetadata.value?.name || workflowDraft.value?.name || "Workflow");
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
    workflowGoalExpanded.value = false;
    selectedStepIndex.value = -1;
    if (selected.workflowSafety?.status === "blocked") {
        const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "Business";
        workflowDraft.value.name = `${businessName} workflow`;
        workflowDraft.value.description = defaultBusinessWorkflowDescription();
        workflowDescription.value = workflowDraft.value.description;
    }
    else {
        workflowDescription.value = selected.description ?? "";
    }
}
function resizeWorkflowGoalEditor(target = workflowAssistInput.value) {
    if (!target)
        return;
    const maxHeight = 280;
    target.style.height = "auto";
    const height = Math.min(target.scrollHeight, maxHeight);
    target.style.height = `${height}px`;
    target.style.overflowY = target.scrollHeight > maxHeight ? "auto" : "hidden";
}
function syncWorkflowGoalEditor() {
    void nextTick(() => resizeWorkflowGoalEditor());
}
function defaultBusinessWorkflowDescription() {
    const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "this business";
    const businessType = props.businessContext?.businessType?.trim() && props.businessContext.businessType !== "Unknown"
        ? props.businessContext.businessType.trim().toLowerCase()
        : "business";
    return `Help visitors understand whether ${businessName} is a good fit. First ask what kind of ${businessType} they run and what they are mainly trying to improve. Match verified capabilities, explain the fit briefly, show verified pricing when relevant, and use the approved primary conversion action. Offer a demo request only when explicitly requested and hand off account or human-help questions.`;
}
function workflowCompletion(action) {
    return action.completion && typeof action.completion === "object" && !Array.isArray(action.completion) ? action.completion : {};
}
function ensureWorkflowCompletion(action) {
    if (!action.completion || typeof action.completion !== "object" || Array.isArray(action.completion))
        action.completion = {};
    return action.completion;
}
function setWorkflowMetadata(action, name) {
    ensureWorkflowCompletion(action).workflow = { name: name.trim().slice(0, 160), actionId: action.id };
}
function workflowNameForTemplate(key) {
    return workflowTemplates.find((template) => template.key === key)?.label ?? "Workflow";
}
function workflowDisplayName(action) {
    const value = workflowCompletion(action).workflow;
    if (value && typeof value === "object" && typeof value.name === "string")
        return String(value.name);
    return action.name;
}
function actionHasWorkflow(action) {
    return Boolean((action.steps?.length ?? 0) > 0 || workflowCompletion(action).workflow);
}
function openCreateWorkflow() {
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
function closeCreateWorkflow() {
    if (createWorkflowLoading.value)
        return;
    createWorkflowOpen.value = false;
    createNewActionOpen.value = false;
    createWorkflowError.value = "";
}
function selectCreateWorkflowMode(mode) {
    createWorkflowMode.value = mode;
    createWorkflowError.value = "";
    if (mode === "template")
        createWorkflowDescription.value = workflowNameForTemplate(createWorkflowTemplateKey.value);
    if (mode === "describe" && !createWorkflowDescription.value.trim())
        createWorkflowDescription.value = defaultBusinessWorkflowDescription();
}
function openNewActionFlow() {
    createNewActionOpen.value = true;
    createWorkflowError.value = "";
    createNewActionName.value = "";
    createNewActionDescription.value = "";
}
function closeNewActionFlow() {
    if (createWorkflowLoading.value)
        return;
    createNewActionOpen.value = false;
    createWorkflowError.value = "";
}
function workflowGenerationContext(action) {
    const businessName = props.businessContext?.businessName?.trim() || props.businessName?.trim() || "";
    return {
        organizationId: props.organizationId ?? props.businessContext?.organizationId,
        businessId: props.businessContext?.businessId,
        workflowId: action.id,
        actionId: action.id,
        contextVersion: props.businessContext?.contextVersion,
        actionType: action.actionType,
        actionName: action.name,
        actionDescription: action.description,
        availableActionTypes: allActions.value.map((candidate) => candidate.actionType || candidate.key),
        availableProviders: props.integrations.filter((integration) => integration.connectionStatus === "active").map((integration) => String(integration.provider ?? "")).filter(Boolean),
        knownBusinessKnowledge: props.businessContext?.knowledgeSummary?.map((item) => item.value) ?? [],
        completionGoal: String(action.completion && (action.completion.message ?? action.completion.linkLabel ?? "")),
        businessContext: props.businessContext ?? undefined,
        businessName,
    };
}
function generatedWorkflowFor(action) {
    if (createWorkflowMode.value === "template") {
        const template = workflowTemplates.find((candidate) => candidate.key === createWorkflowTemplateKey.value) ?? workflowTemplates[0];
        const generated = generateWorkflow(template.description, [], workflowGenerationContext(action));
        return {
            name: template.label,
            description: template.description,
            steps: templateSteps(template.key),
            fields: generated.fields,
            executionMode: generated.executionMode,
            provider: generated.provider,
        };
    }
    const description = preserveWorkflowGoal(createWorkflowDescription.value) ?? defaultBusinessWorkflowDescription();
    const generated = generateWorkflow(description, [], workflowGenerationContext(action));
    return {
        name: generated.name || "Workflow",
        description: generated.description,
        steps: generated.steps,
        fields: generated.fields,
        executionMode: generated.executionMode,
        provider: generated.provider,
    };
}
async function createInlineAction() {
    const name = createNewActionName.value.trim();
    if (!name || createWorkflowLoading.value)
        return;
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
        const payload = await response.json();
        if (!response.ok || !payload.action)
            throw new Error(payload.error ?? "Could not create the action.");
        locallyCreatedAction.value = payload.action;
        createWorkflowActionId.value = payload.action.id;
        createWorkflowMode.value = "describe";
        createWorkflowDescription.value = defaultBusinessWorkflowDescription();
        createNewActionOpen.value = false;
        emit("refresh");
    }
    catch (error) {
        createWorkflowError.value = error instanceof Error ? error.message : "Could not create the action.";
    }
    finally {
        createWorkflowLoading.value = false;
    }
}
async function createWorkflow() {
    if (createWorkflowLoading.value)
        return;
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
    createWorkflowLoading.value = true;
    createWorkflowError.value = "";
    try {
        const generated = generatedWorkflowFor(action);
        const nextAction = clone(action);
        nextAction.steps = generated.steps;
        nextAction.description = generated.description;
        nextAction.fields = generated.fields.length ? generated.fields : nextAction.fields;
        setWorkflowMetadata(nextAction, generated.name);
        if (generated.executionMode)
            nextAction.executionMode = generated.executionMode;
        if (generated.provider)
            nextAction.provider = generated.provider;
        const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions/${encodeURIComponent(action.id)}`), {
            method: "PUT",
            headers: { "content-type": "application/json", ...props.ownerHeaders() },
            body: JSON.stringify({
                ...nextAction,
                ...(props.businessContext?.businessId ? { businessId: props.businessContext.businessId, workflowContextBusinessId: props.businessContext.businessId } : {}),
                ...(props.businessContext?.contextVersion !== undefined ? { workflowContextVersion: props.businessContext.contextVersion } : {}),
            }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.action)
            throw new Error(payload.error ?? "Could not create this workflow.");
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
    }
    catch (error) {
        createWorkflowError.value = error instanceof Error ? error.message : "Could not create this workflow.";
    }
    finally {
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
    if (isOpen)
        void nextTick(() => resizeWorkflowGoalEditor());
});
function markDirty() {
    draftIsDirty.value = true;
    workflowSaveMessage.value = "";
}
function formatLabel(value) {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}
function readinessLabel(label) {
    if (label === "Workflow goal is defined")
        return "Goal defined";
    if (label === "Questions and capture fields are defined")
        return "Add at least one step";
    if (label === "Completion path is defined")
        return "Add completion behavior";
    if (label === "Failure and handoff path is defined")
        return "Decide what happens if unavailable";
    if (label.endsWith(" is connected"))
        return label;
    return label;
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
function legacyTemplateSteps(key) {
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
    if (!workflowDraft.value)
        return;
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
        availableProviders: props.integrations.filter((integration) => integration.connectionStatus === "active").map((integration) => String(integration.provider ?? "")).filter(Boolean),
        knownBusinessKnowledge: props.businessContext?.knowledgeSummary?.map((item) => item.value) ?? [],
        completionGoal: String(workflowDraft.value.completion?.message ?? workflowDraft.value.completion?.linkLabel ?? ""),
        businessContext: props.businessContext ?? undefined,
    };
    workflowGenerationKey.value = workflowGenerationCacheKey(generationContext);
    const ownerGoal = preserveWorkflowGoal(workflowDescription.value) ?? defaultBusinessWorkflowDescription();
    const result = generateWorkflow(ownerGoal, [], generationContext);
    workflowDraft.value.description = result.description;
    workflowDraft.value.steps = result.steps;
    workflowDraft.value.fields = result.fields;
    setWorkflowMetadata(workflowDraft.value, result.name);
    if (result.executionMode)
        workflowDraft.value.executionMode = result.executionMode;
    if (result.provider)
        workflowDraft.value.provider = result.provider;
    selectedStepIndex.value = 0;
    markDirty();
    workflowSaveMessage.value = `${formatLabel(result.intent)} workflow generated from the owner goal. Review suggested steps and provenance before saving.`;
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
            body: JSON.stringify({
                ...workflowDraft.value,
                ...(props.businessContext?.businessId ? { businessId: props.businessContext.businessId, workflowContextBusinessId: props.businessContext.businessId } : {}),
                ...(props.businessContext?.contextVersion !== undefined ? { workflowContextVersion: props.businessContext.contextVersion } : {}),
            }),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error ?? "Could not save this workflow.");
        if (payload.action)
            workflowDraft.value = clone(payload.action);
        draftIsDirty.value = false;
        workflowSaveMessage.value = "Saved. Runtime will use the updated steps.";
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
    void nextTick(() => resizeWorkflowGoalEditor());
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
    __VLS_withDotValue(workflowGenerationKey, {});
    __VLS_withDotValue(draftIsDirty, {});
    __VLS_withDotValue(workflowDraft, {});
    __VLS_withDotValue(workflowSaveLoading, {});
    __VLS_withDotValue(showModelBanner, {});
    __VLS_withDotValue(workflowActions, {});
    __VLS_withDotValue(selectedWorkflowId, {});
    __VLS_withDotValue(workflowGoalExpanded, {});
    __VLS_withDotValue(linkedAction, {});
    __VLS_withDotValue(workflowDescription, {});
    __VLS_withDotValue(showTemplatePicker, {});
    __VLS_withDotValue(readinessRemaining, {});
    __VLS_withDotValue(selectedStepIndex, {});
    __VLS_withDotValue(draftSteps, {});
    __VLS_withDotValue(providerConnected, {});
    __VLS_withDotValue(advancedOpen, {});
    __VLS_withDotValue(providerStep, {});
    __VLS_withDotValue(workflowProvider, {});
    __VLS_withDotValue(previewStep, {});
    __VLS_withDotValue(workflowSaveError, {});
    __VLS_withDotValue(workflowSaveMessage, {});
    __VLS_withDotValue(createWorkflowOpen, {});
    __VLS_withDotValue(createWorkflowMode, {});
    __VLS_withDotValue(eligibleActions, {});
    __VLS_withDotValue(createWorkflowDescription, {});
    __VLS_withDotValue(createNewActionOpen, {});
    __VLS_withDotValue(createWorkflowLoading, {});
    __VLS_withDotValue(createNewActionName, {});
    __VLS_withDotValue(createWorkflowError, {});
    __VLS_withDotValue(createWorkflowActionId, {});
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
    /** @type {__VLS_StyleScopedClasses['workflow-goal-preview']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-preview']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-preview']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-link-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-link-summary']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-modal-close']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['selected']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['selected']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-choice-radio']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-fields']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-fields']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-fields']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-fields']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-inline-action-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-modal-backdrop']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-create-modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['save-clean']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-trigger']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-configuration-label']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-test-status']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['selected']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-edit-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-condition-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary-detail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-window']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-thread']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-window']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-window']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-toolbar']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger-text']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-bubble']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-lookup']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-top']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-isolation-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-preview-panel']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "view-content workflow-workspace" },
        'data-workflow-generation-key': (workflowGenerationKey.value || undefined),
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
        ...{ class: "toolbar-actions workflow-page-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['toolbar-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('refresh'));
                // @ts-ignore
                [workflowGenerationKey, emit,];
            } },
        ...{ class: "text-button" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (saveWorkflow) },
        ...{ class: (['primary-button small', { 'save-clean': !draftIsDirty.value }]) },
        type: "button",
        disabled: (!workflowDraft.value || workflowSaveLoading.value || !draftIsDirty.value),
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    /** @type {__VLS_StyleScopedClasses['save-clean']} */ ;
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
    (workflowSaveLoading.value ? 'Saving…' : draftIsDirty.value ? 'Save workflow' : 'Saved ✓');
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
        ...{ onClick: (openCreateWorkflow) },
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "workflow-library-select" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        value: (selectedWorkflowId.value),
    });
    const __VLS_15 = __VLS_tryAsConstant((workflowActions.value));
    for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_15))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            key: (action.id),
            value: (action.id),
        });
        (workflowDisplayName(action));
        // @ts-ignore
        [draftIsDirty, draftIsDirty, draftIsDirty, workflowDraft, workflowSaveLoading, workflowSaveLoading, showModelBanner, workflowActions, workflowActions, selectedWorkflowId,];
    }
    if (!workflowActions.value.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-empty-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty-icon']} */ ;
        let __VLS_16;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent1(__VLS_16, new __VLS_16({
            // @ts-ignore
            size: (22), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_18 = __VLS_17({
            size: (22),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (openCreateWorkflow) },
            ...{ class: "primary-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_21;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_22 = __VLS_asFunctionalComponent1(__VLS_21, new __VLS_21({
            // @ts-ignore
            size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_23 = __VLS_22({
            size: (14),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_22));
    }
    const __VLS_26 = __VLS_tryAsConstant((workflowActions.value));
    for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_26))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (selectedWorkflowId.value = action.id);
                    // @ts-ignore
                    [workflowActions, workflowActions, selectedWorkflowId,];
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
        let __VLS_27;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_28 = __VLS_asFunctionalComponent1(__VLS_27, new __VLS_27({
            // @ts-ignore
            size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_29 = __VLS_28({
            size: (16),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_28));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (workflowDisplayName(action));
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (action.steps?.length ?? 0);
        (formatLabel(action.executionMode || 'FORM_FLOW'));
        let __VLS_32;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
        // @ts-ignore
        const __VLS_33 = __VLS_asFunctionalComponent1(__VLS_32, new __VLS_32({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_34 = __VLS_33({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_33));
        // @ts-ignore
        [selectedWorkflowId,];
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
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
        (__VLS_unwrap(workflowTitle, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-goal-preview" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-goal-preview']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: ({ expanded: workflowGoalExpanded.value }) },
        });
        /** @type {__VLS_StyleScopedClasses['expanded']} */ ;
        (workflowDraft.value.description || 'Describe the customer outcome this workflow owns.');
        if (workflowDraft.value.description && (workflowDraft.value.description.length > 320 || workflowDraft.value.description.includes('\n'))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(workflowDraft.value.description && (workflowDraft.value.description.length > 320 || workflowDraft.value.description.includes('\n'))))
                            throw 0;
                        return (workflowGoalExpanded.value = !workflowGoalExpanded.value);
                        // @ts-ignore
                        [workflowDraft, workflowDraft, workflowDraft, workflowDraft, workflowDraft, workflowTitle, workflowGoalExpanded, workflowGoalExpanded, workflowGoalExpanded,];
                    } },
                ...{ class: "text-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            (workflowGoalExpanded.value ? 'Show compact goal' : 'View full goal');
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-link-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-link-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (linkedAction.value?.name || workflowDraft.value.name);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_unwrap(workflowTitle, {}));
        if (workflowDraft.value.workflowSafety?.status === 'blocked') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-isolation-warning" },
                role: "alert",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-isolation-warning']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        }
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
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-status-group" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-status-group']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-mode-label" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-mode-label']} */ ;
        (formatLabel(workflowDraft.value.executionMode || 'FORM_FLOW'));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "status-pill new" },
        });
        /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
        /** @type {__VLS_StyleScopedClasses['new']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-assist-card" },
            'aria-labelledby': "workflow-assist-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-icon']} */ ;
        let __VLS_37;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_38 = __VLS_asFunctionalComponent1(__VLS_37, new __VLS_37({
            // @ts-ignore
            size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_39 = __VLS_38({
            size: (18),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_38));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
            id: "workflow-assist-heading",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
            ...{ onInput: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (resizeWorkflowGoalEditor($event.target));
                    // @ts-ignore
                    [workflowDraft, workflowDraft, workflowDraft, workflowTitle, workflowGoalExpanded, linkedAction,];
                } },
            ...{ onKeydown: (generateStarter) },
            ...{ onKeydown: (generateStarter) },
            ref: "workflowAssistInput",
            value: (workflowDescription.value),
            rows: "4",
            placeholder: "Example: Ask the child’s age, swimming ability, location, and preferred days, then show available classes.",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-assist-footer" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (workflowDescription.value.length.toLocaleString());
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (generateStarter) },
            ...{ class: "primary-button" },
            type: "button",
            'aria-label': "Generate steps",
            disabled: (!workflowDescription.value.trim()),
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        let __VLS_42;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_43 = __VLS_asFunctionalComponent1(__VLS_42, new __VLS_42({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_44 = __VLS_43({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_43));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-template-flow" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-template-flow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (showTemplatePicker.value = !showTemplatePicker.value);
                    // @ts-ignore
                    [workflowDescription, workflowDescription, workflowDescription, showTemplatePicker, showTemplatePicker,];
                } },
            ...{ class: "text-button workflow-template-trigger" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-template-trigger']} */ ;
        let __VLS_47;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
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
        if (showTemplatePicker.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-template-picker" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-template-picker']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            const __VLS_52 = __VLS_tryAsConstant((__VLS_unwrap(workflowTemplates, {})));
            for (const [template] of __VLS_vFor(__VLS_nonNull(__VLS_52))) {
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
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-readiness-card" },
            'aria-labelledby': "workflow-setup-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-sr-only" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-sr-only']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
            id: "workflow-setup-heading",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (['workflow-configuration-label', { complete: __VLS_unwrap(configurationComplete, {}) }]) },
        });
        /** @type {__VLS_StyleScopedClasses['complete']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-configuration-label']} */ ;
        (__VLS_unwrap(configurationLabel, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-list" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-list']} */ ;
        const __VLS_53 = __VLS_tryAsConstant((__VLS_unwrap(readiness, {})));
        for (const [item] of __VLS_vFor(__VLS_nonNull(__VLS_53))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                key: (item.label),
                ...{ class: ({ complete: item.complete, incomplete: !item.complete }) },
            });
            /** @type {__VLS_StyleScopedClasses['complete']} */ ;
            /** @type {__VLS_StyleScopedClasses['incomplete']} */ ;
            if (item.complete) {
                let __VLS_54;
                /** @ts-ignore @type { | typeof Check} */
                Check;
                // @ts-ignore
                const __VLS_55 = __VLS_asFunctionalComponent1(__VLS_54, new __VLS_54({
                    // @ts-ignore
                    size: (14), strokeWidth: (2), 'aria-hidden': "true",
                }));
                const __VLS_56 = __VLS_55({
                    size: (14),
                    strokeWidth: (2),
                    'aria-hidden': "true",
                }, ...__VLS_functionalComponentArgsRest(__VLS_55));
            }
            else {
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                    'aria-hidden': "true",
                });
            }
            (readinessLabel(item.label));
            // @ts-ignore
            [configurationComplete, configurationLabel, readiness,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-test-status" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-test-status']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
            'aria-hidden': "true",
        });
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
                    [readinessRemaining,];
                } },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
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
                if (step.config?.trigger) {
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
                if (step.config?.reviewStatus) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-summary-tag" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-summary-tag']} */ ;
                    (formatLabel(String(step.config.reviewStatus)));
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
                const __VLS_75 = __VLS_tryAsConstant((__VLS_unwrap(stepTypes, {})));
                for (const [type] of __VLS_vFor(__VLS_nonNull(__VLS_75))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        key: (type.value),
                        value: (type.value),
                    });
                    (type.label);
                    // @ts-ignore
                    [selectedStepIndex, selectedStepIndex, stepTypes,];
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
                    const __VLS_76 = __VLS_tryAsConstant((workflowDraft.value.fields ?? []));
                    for (const [field] of __VLS_vFor(__VLS_nonNull(__VLS_76))) {
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
                    let __VLS_77;
                    /** @ts-ignore @type { | typeof GitBranch} */
                    GitBranch;
                    // @ts-ignore
                    const __VLS_78 = __VLS_asFunctionalComponent1(__VLS_77, new __VLS_77({
                        // @ts-ignore
                        size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
                    }));
                    const __VLS_79 = __VLS_78({
                        size: (15),
                        strokeWidth: (1.8),
                        'aria-hidden': "true",
                    }, ...__VLS_functionalComponentArgsRest(__VLS_78));
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
                const __VLS_82 = __VLS_tryAsConstant((draftSteps.value.filter((candidate) => candidate.id !== step.id)));
                for (const [nextStep] of __VLS_vFor(__VLS_nonNull(__VLS_82))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        key: (nextStep.id),
                        value: (nextStep.id),
                    });
                    (nextStep.label || nextStep.id);
                    // @ts-ignore
                    [draftSteps,];
                }
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-step-management" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-step-management']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== index))
                                throw 0;
                            return (moveWorkflowStep(index, -1));
                            // @ts-ignore
                            [];
                        } },
                    type: "button",
                    disabled: (index === 0),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== index))
                                throw 0;
                            return (moveWorkflowStep(index, 1));
                            // @ts-ignore
                            [];
                        } },
                    type: "button",
                    disabled: (index === draftSteps.value.length - 1),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== index))
                                throw 0;
                            return (removeWorkflowStep(index));
                            // @ts-ignore
                            [draftSteps,];
                        } },
                    ...{ class: "danger-text" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['danger-text']} */ ;
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
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-empty-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-empty-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (generateStarter) },
                ...{ class: "primary-button small" },
                type: "button",
                disabled: (!workflowDescription.value.trim()),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            let __VLS_83;
            /** @ts-ignore @type { | typeof Sparkles} */
            Sparkles;
            // @ts-ignore
            const __VLS_84 = __VLS_asFunctionalComponent1(__VLS_83, new __VLS_83({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_85 = __VLS_84({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_84));
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(!draftSteps.value.length))
                            throw 0;
                        return (addWorkflowStep());
                        // @ts-ignore
                        [workflowDescription, draftSteps,];
                    } },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            let __VLS_88;
            /** @ts-ignore @type { | typeof Plus} */
            Plus;
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
        (providerStep.value ? formatLabel(stepConfigValue(providerStep.value, 'provider') || workflowProvider.value || 'Provider') : 'No provider connected');
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
                        [providerConnected, providerConnected, providerStep, providerStep, providerStep, providerStep, providerStep, providerStep, workflowProvider,];
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
                    [workflowDraft, providerFailureBehavior, businessName, previewStep, previewStep, previewStep, previewStep, previewStep, previewStep,];
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
            if (previewStep.value.type === 'redirect') {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-preview-cta" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-preview-cta']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ class: "primary-button small" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
                /** @type {__VLS_StyleScopedClasses['small']} */ ;
                (stepConfigValue(previewStep.value, 'buttonLabel') || previewStep.value.label || 'Continue');
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
        (previewStep.value ? `Previewing step ${selectedStepIndex.value + 1} of ${draftSteps.value.length}.` : 'Add or select a step to preview what visitors will experience.');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-preview-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-preview-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (draftSteps.value.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (workflowProvider.value ? formatLabel(workflowProvider.value) : 'No provider');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (__VLS_unwrap(configurationLabel, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
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
    if (createWorkflowOpen.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (closeCreateWorkflow) },
            ...{ class: "workflow-modal-backdrop" },
            role: "presentation",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-backdrop']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-create-modal" },
            role: "dialog",
            'aria-modal': "true",
            'aria-labelledby': "create-workflow-title",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-create-modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (closeCreateWorkflow) },
            ...{ class: "workflow-modal-close" },
            type: "button",
            'aria-label': "Close",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-close']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
            id: "create-workflow-title",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
            ...{ class: "workflow-modal-question" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-question']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "workflow-modal-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-create-choice-list" },
            role: "tablist",
            'aria-label': "Workflow starting point",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-create-choice-list']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(createWorkflowOpen.value))
                        throw 0;
                    return (selectCreateWorkflowMode('action'));
                    // @ts-ignore
                    [workflowDraft, workflowDraft, configurationLabel, draftSteps, draftSteps, selectedStepIndex, workflowProvider, workflowProvider, previewStep, previewStep, previewStep, previewStep, previewStep, previewStep, previewStep, workflowSaveError, workflowSaveError, workflowSaveMessage, workflowSaveMessage, createWorkflowOpen,];
                } },
            type: "button",
            ...{ class: (['workflow-create-choice', { selected: createWorkflowMode.value === 'action' }]) },
        });
        /** @type {__VLS_StyleScopedClasses['selected']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-choice-radio" },
            'aria-hidden': "true",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-choice-radio']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(createWorkflowOpen.value))
                        throw 0;
                    return (selectCreateWorkflowMode('template'));
                    // @ts-ignore
                    [createWorkflowMode,];
                } },
            type: "button",
            ...{ class: (['workflow-create-choice', { selected: createWorkflowMode.value === 'template' }]) },
        });
        /** @type {__VLS_StyleScopedClasses['selected']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-choice-radio" },
            'aria-hidden': "true",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-choice-radio']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(createWorkflowOpen.value))
                        throw 0;
                    return (selectCreateWorkflowMode('describe'));
                    // @ts-ignore
                    [createWorkflowMode,];
                } },
            type: "button",
            ...{ class: (['workflow-create-choice', { selected: createWorkflowMode.value === 'describe' }]) },
        });
        /** @type {__VLS_StyleScopedClasses['selected']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-create-choice']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-choice-radio" },
            'aria-hidden': "true",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-choice-radio']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-create-fields" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-create-fields']} */ ;
        if (createWorkflowMode.value === 'action' || createWorkflowMode.value === 'template' || createWorkflowMode.value === 'describe') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "optional" },
            });
            /** @type {__VLS_StyleScopedClasses['optional']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                value: (createWorkflowActionId.value),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "",
                disabled: true,
            });
            const __VLS_114 = __VLS_tryAsConstant((eligibleActions.value));
            for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_114))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    key: (action.id),
                    value: (action.id),
                });
                (action.name);
                // @ts-ignore
                [createWorkflowMode, createWorkflowMode, createWorkflowMode, createWorkflowMode, createWorkflowActionId, eligibleActions,];
            }
        }
        if (!eligibleActions.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-create-empty" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-create-empty']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (openNewActionFlow) },
            ...{ class: "workflow-inline-action-button" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-inline-action-button']} */ ;
        let __VLS_115;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_116 = __VLS_asFunctionalComponent1(__VLS_115, new __VLS_115({
            // @ts-ignore
            size: (15), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_117 = __VLS_116({
            size: (15),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_116));
        if (createWorkflowMode.value === 'template') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                ...{ onChange: (...[$event]) => {
                        void $event;
                        if (!(createWorkflowOpen.value))
                            throw 0;
                        if (!(createWorkflowMode.value === 'template'))
                            throw 0;
                        return (createWorkflowDescription.value = workflowNameForTemplate(__VLS_unwrap(createWorkflowTemplateKey, {})));
                        // @ts-ignore
                        [createWorkflowMode, eligibleActions, createWorkflowDescription, createWorkflowTemplateKey,];
                    } },
                value: (__VLS_unwrap(createWorkflowTemplateKey, {})),
            });
            const __VLS_120 = __VLS_tryAsConstant((__VLS_unwrap(workflowTemplates, {})));
            for (const [template] of __VLS_vFor(__VLS_nonNull(__VLS_120))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    key: (template.key),
                    value: (template.key),
                });
                (template.label);
                // @ts-ignore
                [workflowTemplates, createWorkflowTemplateKey,];
            }
        }
        if (createWorkflowMode.value === 'describe' || createWorkflowMode.value === 'action') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                ...{ onInput: (...[$event]) => {
                        void $event;
                        if (!(createWorkflowOpen.value))
                            throw 0;
                        if (!(createWorkflowMode.value === 'describe' || createWorkflowMode.value === 'action'))
                            throw 0;
                        return (resizeWorkflowGoalEditor($event.target));
                        // @ts-ignore
                        [createWorkflowMode, createWorkflowMode,];
                    } },
                value: (createWorkflowDescription.value),
                rows: "4",
                placeholder: "Help salon owners decide if SalonFlow is right for them…",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({
                ...{ class: "workflow-goal-count" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-goal-count']} */ ;
            (createWorkflowDescription.value.length.toLocaleString());
        }
        if (createNewActionOpen.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-new-action-panel" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-new-action-panel']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "eyebrow" },
            });
            /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                value: (createNewActionName.value),
                type: "text",
                maxlength: "120",
                placeholder: "Request a quote",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "optional" },
            });
            /** @type {__VLS_StyleScopedClasses['optional']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                value: (__VLS_unwrap(createNewActionDescription, {})),
                rows: "2",
                placeholder: "What should the assistant do when the visitor is ready?",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-modal-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-modal-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (closeNewActionFlow) },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (createInlineAction) },
                ...{ class: "primary-button small" },
                type: "button",
                disabled: (createWorkflowLoading.value || !createNewActionName.value.trim()),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            (createWorkflowLoading.value ? 'Creating…' : 'Create action');
        }
        if (createWorkflowError.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "form-error" },
            });
            /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
            (createWorkflowError.value);
        }
        if (!createNewActionOpen.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-modal-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-modal-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (closeCreateWorkflow) },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (createWorkflow) },
                ...{ class: "primary-button small" },
                type: "button",
                disabled: (createWorkflowLoading.value || !createWorkflowActionId.value),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            (createWorkflowLoading.value ? 'Creating…' : 'Create workflow');
        }
    }
    // @ts-ignore
    [createWorkflowActionId, createWorkflowDescription, createWorkflowDescription, createNewActionOpen, createNewActionOpen, createNewActionName, createNewActionName, createNewActionDescription, createWorkflowLoading, createWorkflowLoading, createWorkflowLoading, createWorkflowLoading, createWorkflowError, createWorkflowError,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
