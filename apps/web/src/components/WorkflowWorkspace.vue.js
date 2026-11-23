import { computed, nextTick, onMounted, ref, watch } from "vue";
import { ArrowRight, Check, ChevronDown, GitBranch, Plus, Sparkles, Trash2, X } from "@lucide/vue";
import { ENROLLMENT_WORKFLOW_GOAL, generateWorkflow, preserveWorkflowGoal, templateSteps, workflowGenerationCacheKey } from "../workflow-generator.js";
import { validateWorkflowTenantContext, WORKFLOW_CONTEXT_REFRESH_MESSAGE } from "../workflow-tenant-context.js";
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
const stepAdvancedOpen = ref(false);
const workflowAdvancedOpen = ref(false);
const setupStatusOpen = ref(false);
const showTemplatePicker = ref(false);
const workflowAssistInput = ref(null);
const workflowStepList = ref(null);
const workflowGoalExpanded = ref(false);
const openStepMenuId = ref("");
const deleteStepIndex = ref(-1);
const deleteStepDependents = ref([]);
const workflowVerificationOpen = ref(false);
const undoMessage = ref("");
const undoSnapshot = ref(null);
const workflowTested = ref(false);
const draftIsDirty = ref(false);
const workflowGenerationKey = ref("");
const createWorkflowOpen = ref(false);
const createWorkflowMode = ref("action");
const createWorkflowActionId = ref("");
const createWorkflowTemplateKey = ref("lead");
const createWorkflowName = ref("");
const createWorkflowNameSuggestion = ref("");
const createWorkflowDescription = ref("");
const createWorkflowLoading = ref(false);
const createWorkflowError = ref("");
const createNewActionOpen = ref(false);
const createNewActionName = ref("");
const createNewActionDescription = ref("");
const locallyCreatedAction = ref(null);
const customFieldOpenFor = ref("");
const customFieldLabel = ref("");
const customFieldKey = ref("");
const knowledgePreviewStepId = ref("");
const knowledgePreviewQuestion = ref("");
const knowledgePreviewResult = ref(null);
const deleteWorkflowOpen = ref(false);
const deleteWorkflowLoading = ref(false);
const deleteWorkflowError = ref("");
const hiddenWorkflowIds = ref(new Set());
let draftSourceId = "";
let undoTimer;
const selectedCreateWorkflowAction = computed(() => allActions.value.find((action) => action.id === createWorkflowActionId.value) ?? null);
const plainEnglishInference = computed(() => {
    const description = createWorkflowDescription.value.toLowerCase();
    return {
        leadCapture: /lead|contact|name|email|follow up|follow-up/.test(description),
        demoAction: /demo|trial|tour|show|guide|send/.test(description),
        contactFields: /lead|contact|name|email|follow up|follow-up/.test(description),
    };
});
function workflowIntentForDescription(value) {
    const description = value.toLowerCase();
    if (/demo|trial/.test(description))
        return "demo_request";
    if (/enroll|registration|swim lesson|class/.test(description))
        return "enrollment";
    if (/quote|estimate/.test(description))
        return "quote_request";
    if (/appointment|consultation|book|schedule|reservation|tour/.test(description))
        return "appointment_booking";
    if (/waitlist|waiting list/.test(description))
        return "waitlist_join";
    if (/call|phone/.test(description))
        return "business_call";
    if (/contact|lead|message|reach/.test(description))
        return "team_contact";
    return null;
}
const stepTypeGroups = [
    {
        label: "INPUT",
        options: [
            { value: "capture", label: "Capture details" },
            { value: "ask", label: "Ask a question" },
            { value: "form", label: "Show a form" },
        ],
    },
    {
        label: "LOGIC",
        options: [{ value: "condition", label: "Condition / branch" }],
    },
    {
        label: "KNOWLEDGE",
        options: [{ value: "knowledge", label: "Answer from knowledge" }],
    },
    {
        label: "PROVIDER",
        options: [{ value: "lookup", label: "Find classes or availability" }],
    },
    {
        label: "DECISION",
        options: [
            { value: "recommend", label: "Present recommendations" },
            { value: "select", label: "Let visitor select" },
            { value: "confirm", label: "Confirm selection" },
        ],
    },
    {
        label: "ACTION",
        options: [
            { value: "generate_link", label: "Generate registration link" },
            { value: "redirect", label: "Show a call to action" },
            { value: "create_lead", label: "Save a lead" },
            { value: "book", label: "Book" },
            { value: "notify", label: "Notify staff" },
            { value: "handoff", label: "Hand off to a human" },
        ],
    },
    {
        label: "END",
        options: [{ value: "complete", label: "Complete workflow" }],
    },
];
const stepTypes = stepTypeGroups.flatMap((group) => group.options);
const answerTypes = [
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
    if (action.enabled === false || action.lifecycleStatus === "disabled" || hiddenWorkflowIds.value.has(action.id))
        return false;
    return action.workflowSafety?.status === "blocked" || actionHasWorkflow(action);
}));
const duplicateCreateWorkflow = computed(() => {
    const candidate = normalizeWorkflowName(createWorkflowName.value.slice(0, 160));
    if (!candidate)
        return null;
    return workflowActions.value.find((action) => normalizeWorkflowName(workflowDisplayName(action)) === candidate) ?? null;
});
const currentBusinessScopeId = computed(() => props.selectedBusinessId ?? props.workspaceBusinessId ?? props.businessContext?.businessId ?? null);
const workflowCompatibleExecutionModes = new Set(["DIRECT_LINK", "FORM_FLOW", "PROVIDER_FLOW", "PHONE", "EMAIL", "HANDOFF", "API_ACTION"]);
function actionCanStartWorkflow(action) {
    const businessId = currentBusinessScopeId.value;
    if (!action.id.trim() || !action.name.trim() || (businessId && action.businessId && action.businessId !== businessId))
        return false;
    if (action.archived === true || action.deleted === true || ["archived", "deleted"].includes(String(action.lifecycleStatus)) || action.reviewReason === "source_removed")
        return false;
    if (action.workflowSafety?.status === "blocked" || hiddenWorkflowIds.value.has(action.id) || actionHasWorkflow(action))
        return false;
    if (action.executionMode && !workflowCompatibleExecutionModes.has(action.executionMode))
        return false;
    return Boolean(action.completion && typeof action.completion === "object" && !Array.isArray(action.completion));
}
function actionProvider(action) {
    const provider = action?.provider?.trim() || action?.capability?.provider?.trim();
    return provider ? provider.toLowerCase() : null;
}
function actionProviderConnected(action) {
    const provider = actionProvider(action);
    if (!provider)
        return true;
    return props.integrations.some((value) => {
        const integration = value;
        return integration.provider?.toLowerCase() === provider && integration.connectionStatus === "active";
    });
}
function actionPickerStatus(action) {
    const provider = actionProvider(action);
    if (provider && !actionProviderConnected(action))
        return `Needs setup · ${formatLabel(provider)} not connected`;
    if (action.enabled === false || action.lifecycleStatus === "disabled")
        return "Disabled";
    if (action.setupStatus === "DRAFT")
        return "Draft";
    if (action.setupStatus === "NEEDS_SETUP" || action.readiness?.ready === false)
        return "Needs setup";
    return "Ready";
}
const selectedActionSetupWarning = computed(() => {
    const action = selectedCreateWorkflowAction.value;
    if (!action)
        return null;
    const provider = actionProvider(action);
    if (provider && !actionProviderConnected(action)) {
        return {
            title: `${formatLabel(provider)} isn’t connected yet.`,
            message: `You can still create and test this workflow. Until ${formatLabel(provider)} is connected, FrontDeskWise will capture the visitor’s request and notify the team instead of showing live availability.`,
        };
    }
    if (action.enabled === false || action.lifecycleStatus === "disabled") {
        return {
            title: "This Action is disabled.",
            message: "You can still create and test this workflow. Creating it will restore the Action for this draft; publish remains gated by the workflow readiness checks.",
        };
    }
    if (action.setupStatus !== "READY" || action.readiness?.ready === false) {
        return {
            title: "This Action still needs setup.",
            message: "You can still create and test this workflow. Complete the remaining setup checks before publishing it for production visitors.",
        };
    }
    return null;
});
const eligibleActions = computed(() => allActions.value
    .filter(actionCanStartWorkflow)
    .sort((left, right) => {
    const leftDemo = /try|demo|start|book|request/i.test(left.name) ? 0 : 1;
    const rightDemo = /try|demo|start|book|request/i.test(right.name) ? 0 : 1;
    return leftDemo - rightDemo || left.name.localeCompare(right.name);
}));
const suggestedCreateWorkflowAction = computed(() => {
    const intent = workflowIntentForDescription(createWorkflowDescription.value);
    if (!intent)
        return null;
    return eligibleActions.value.find((action) => action.capability?.intent === intent)
        ?? eligibleActions.value.find((action) => workflowIntentForDescription(`${action.name} ${action.description ?? ""}`) === intent)
        ?? null;
});
const selectedWorkflow = computed(() => workflowActions.value.find((action) => action.id === selectedWorkflowId.value) ?? workflowActions.value[0] ?? null);
const selectedWorkflowIsLive = computed(() => workflowStatus(selectedWorkflow.value ?? workflowDraft.value ?? {}) === "LIVE");
const workflowPreferenceKey = computed(() => `frontdeskwise:last-workflow:${props.selectedBusinessId ?? props.workspaceBusinessId ?? props.businessContext?.businessId ?? props.demoSlug}`);
function readLastSelectedWorkflowId() {
    if (typeof window === "undefined")
        return "";
    try {
        return window.localStorage.getItem(workflowPreferenceKey.value) ?? "";
    }
    catch {
        return "";
    }
}
function workflowStatus(action) {
    if (action.workflowStatus)
        return action.workflowStatus;
    if (props.publishingStatus === "LIVE")
        return "LIVE";
    return "DRAFT";
}
function workflowStatusLabel(action) {
    const status = workflowStatus(action);
    if (status === "LIVE_WITH_UNPUBLISHED_CHANGES")
        return "Live · unpublished changes";
    if (status === "LIVE")
        return "Live";
    return "Draft";
}
function preferredWorkflowId(actions = workflowActions.value) {
    const explicit = props.initialWorkflowId?.trim();
    if (explicit && actions.some((action) => action.id === explicit))
        return explicit;
    const remembered = readLastSelectedWorkflowId();
    if (remembered && actions.some((action) => action.id === remembered))
        return remembered;
    const live = actions.find((action) => workflowStatus(action) === "LIVE" && action.isPrimary)
        ?? actions.find((action) => workflowStatus(action) === "LIVE");
    if (live)
        return live.id;
    const mostRecentlyEdited = [...actions]
        .filter((action) => action.updatedAt)
        .sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)))[0];
    return mostRecentlyEdited?.id ?? actions[0]?.id ?? "";
}
function rememberSelectedWorkflow(id) {
    if (!id || typeof window === "undefined")
        return;
    try {
        window.localStorage.setItem(workflowPreferenceKey.value, id);
    }
    catch {
        // localStorage is a UI convenience; a blocked storage API must not affect the workflow.
    }
}
const draftSteps = computed(() => (workflowDraft.value?.steps ?? []));
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
    const activeSteps = draftSteps.value.filter((step) => step.enabled !== false);
    const hasQuestions = activeSteps.some((step) => Boolean(step.question?.trim() || step.fieldKey?.trim() || step.type === "form"));
    const hasCompletion = activeSteps.some((step) => ["complete", "generate_link", "redirect", "book", "handoff"].includes(step.type ?? ""));
    const hasFailurePath = activeSteps.some((step) => ["handoff", "notify"].includes(step.type ?? "") || Boolean(stepConfigValue(step, "failureBehavior")));
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
const providerFailureBehavior = computed(() => providerStep.value ? stepConfigValue(providerStep.value, "failureBehavior") || "agent_default" : "agent_default");
const workflowFallbackCustomized = computed(() => Boolean(providerStep.value && stepConfigValue(providerStep.value, "failureBehavior")));
const agentFallbackLabel = computed(() => props.agentFallbackBehavior === "human" ? "Request human" : props.agentFallbackBehavior === "unavailable" ? "Say information unavailable" : "Offer contact form");
const agentToneLabel = computed(() => formatLabel(props.agentTone ?? "friendly"));
const agentCitationLabel = computed(() => props.agentCitationVisibility === "always" ? "Always show" : props.agentCitationVisibility === "hidden" ? "Hidden from visitors" : "Show when helpful");
const agentHandoffLabel = computed(() => props.agentHumanHandoffEnabled === false ? "Disabled" : "Enabled");
const agentProactiveLabel = computed(() => props.agentProactiveEnabled ? "Enabled" : "Off");
const providerSummary = computed(() => workflowProvider.value ? formatLabel(workflowProvider.value) : "No provider required");
const completionSummary = computed(() => {
    const completion = workflowDraft.value?.completion;
    if (!completion || typeof completion !== "object" || Array.isArray(completion))
        return "Use the linked action completion behavior";
    const value = completion;
    if (typeof value.linkLabel === "string" && value.linkLabel.trim())
        return value.linkLabel.trim();
    if (typeof value.message === "string" && value.message.trim())
        return "Show a confirmation message";
    return "Use the linked action completion behavior";
});
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
const workflowTitle = computed(() => workflowMetadata.value?.name || workflowDraft.value?.name || "Workflow");
const workflowOutcomeAction = computed(() => {
    const actionId = workflowMetadata.value?.actionId || workflowDraft.value?.id;
    return allActions.value.find((action) => action.id === actionId) ?? workflowDraft.value;
});
const workflowStatusSummary = computed(() => {
    const status = draftIsDirty.value
        ? "Unpublished changes"
        : workflowStatus(selectedWorkflow.value ?? {}) === "LIVE"
            ? "Live"
            : workflowStatus(selectedWorkflow.value ?? {}) === "LIVE_WITH_UNPUBLISHED_CHANGES"
                ? "Live · unpublished changes"
                : "Draft";
    return `${status} · ${draftSteps.value.length} step${draftSteps.value.length === 1 ? "" : "s"} · ${providerSummary.value}`;
});
const selectedWorkflowPerformance = computed(() => {
    const selected = selectedWorkflow.value;
    if (!selected)
        return null;
    return props.performanceByWorkflow?.[selected.id] ?? props.performanceByWorkflow?.[selected.key] ?? null;
});
const workflowRecommendation = computed(() => {
    const performance = selectedWorkflowPerformance.value;
    const dropOff = performance?.dropOffs?.[0];
    if (!performance || performance.started <= 0 || !dropOff || dropOff.count <= 0)
        return null;
    return {
        label: dropOff.label,
        count: dropOff.count,
        message: `“${dropOff.label}” is the largest observed drop-off in this workflow. Review it before changing the journey.`,
    };
});
const workflowVerification = computed(() => verifyWorkflowDraft());
const workflowVerificationIssues = computed(() => workflowVerification.value.issues);
const workflowVerificationReady = computed(() => workflowVerification.value.ok);
function workflowActiveSteps() {
    return draftSteps.value.filter((step) => step.enabled !== false);
}
function workflowStepTargets(step, index, steps = draftSteps.value) {
    const targets = new Set();
    if (step.nextStepId)
        targets.add(step.nextStepId);
    const branches = Array.isArray(step.branches) ? step.branches : [];
    for (const branch of branches) {
        if (branch && typeof branch === "object" && typeof branch.nextStepId === "string")
            targets.add(branch.nextStepId);
    }
    if (!targets.size) {
        const next = steps.slice(index + 1).find((candidate) => candidate.enabled !== false);
        if (next?.id)
            targets.add(next.id);
    }
    return [...targets];
}
function workflowFieldDependencies(step) {
    const dependencies = new Set();
    if (step.fieldKey)
        dependencies.add(step.fieldKey);
    const config = step.config && typeof step.config === "object" && !Array.isArray(step.config) ? step.config : {};
    for (const [key, value] of Object.entries(config)) {
        if (key.endsWith("Field") && typeof value === "string")
            dependencies.add(value);
        if (key === "searchFields" && typeof value === "string")
            value.split(",").map((item) => item.trim()).filter(Boolean).forEach((item) => dependencies.add(item));
        if ((key === "requiredFields" || key === "fieldKeys") && Array.isArray(value))
            value.filter((item) => typeof item === "string").forEach((item) => dependencies.add(item));
    }
    return dependencies;
}
function verifyWorkflowDraft() {
    const steps = draftSteps.value;
    const activeSteps = workflowActiveSteps();
    const issues = [];
    const byId = new Map();
    for (const [index, step] of steps.entries()) {
        if (!step.id) {
            issues.push({ code: "missing_step_id", message: `Step ${index + 1} needs an id.`, stepIndex: index });
            continue;
        }
        if (byId.has(step.id))
            issues.push({ code: "duplicate_step_id", message: `Step id “${step.id}” is used more than once.`, stepIndex: index });
        else
            byId.set(step.id, { step, index });
    }
    const entry = activeSteps[0];
    if (activeSteps.length) {
        const reachable = new Set();
        const visiting = new Set();
        const visit = (stepId) => {
            const entryForId = byId.get(stepId);
            if (!entryForId) {
                issues.push({ code: "unknown_step_target", message: `A step points to missing step “${stepId}”.` });
                return;
            }
            if (entryForId.step.enabled === false) {
                const nextTargets = workflowStepTargets(entryForId.step, entryForId.index);
                nextTargets.forEach(visit);
                return;
            }
            if (visiting.has(stepId)) {
                issues.push({ code: "cycle_detected", message: `The workflow loops through “${entryForId.step.label || stepId}”.`, stepIndex: entryForId.index });
                return;
            }
            if (reachable.has(stepId))
                return;
            reachable.add(stepId);
            visiting.add(stepId);
            workflowStepTargets(entryForId.step, entryForId.index).forEach(visit);
            visiting.delete(stepId);
        };
        visit(entry.id);
        for (const [index, step] of steps.entries()) {
            if (step.enabled !== false && step.id && !reachable.has(step.id))
                issues.push({ code: "unreachable_step", message: `“${step.label || step.id}” is not reachable from the start.`, stepIndex: index });
        }
        const terminalTypes = new Set(["complete", "redirect", "handoff"]);
        for (const [index, step] of activeSteps.entries()) {
            if (!terminalTypes.has(step.type) && !workflowStepTargets(step, steps.indexOf(step)).length)
                issues.push({ code: "non_terminal_step", message: `“${step.label || "This step"}” stops without a next step.`, stepIndex: steps.indexOf(step) });
            if (step.type === "redirect" && !workflowDraft.value?.destination?.url && !workflowDraft.value?.completion?.linkUrl && !stepConfigValue(step, "linkSource")) {
                issues.push({ code: "missing_destination", message: `“${step.label || "This step"}” needs a valid destination before publishing.`, stepIndex: steps.indexOf(step) });
            }
            if (["lookup", "book", "api_action"].includes(step.type) && !workflowProvider.value && !stepConfigValue(step, "provider")) {
                issues.push({ code: "provider_missing", message: `“${step.label || "This step"}” needs a connected provider.`, stepIndex: steps.indexOf(step) });
            }
        }
    }
    const capturedFields = new Set(activeSteps.flatMap((step) => {
        if (step.type === "form") {
            const configured = step.config?.fieldKeys;
            if (Array.isArray(configured))
                return configured.filter((value) => typeof value === "string");
            return (workflowDraft.value?.fields ?? []).filter((field) => field.visibility !== "hidden").map((field) => field.key);
        }
        return step.fieldKey ? [step.fieldKey] : [];
    }));
    for (const field of workflowDraft.value?.fields ?? []) {
        if (field.required && field.visibility !== "hidden" && !capturedFields.has(field.key) && !capturedFields.has(field.id ?? "")) {
            issues.push({ code: "required_field_not_captured", message: `Required field “${field.label || field.key}” is never captured.` });
        }
    }
    if (workflowDraft.value?.completion?.createLead && !activeSteps.some((step) => ["create_lead", "form"].includes(step.type))) {
        issues.push({ code: "lead_capture_missing", message: "Lead capture is enabled, but the workflow has no lead or form step." });
    }
    const hasFallback = activeSteps.some((step) => ["handoff", "notify"].includes(step.type) || Boolean(stepConfigValue(step, "failureBehavior")))
        || workflowDraft.value?.completion?.notifyStaff === true
        || workflowDraft.value?.completion?.requiresStaff === true;
    if (activeSteps.length && !hasFallback) {
        issues.push({ code: "fallback_missing", message: "Add a handoff, notification, or fallback behavior before publishing." });
    }
    return { ok: issues.length === 0, issues };
}
function isConditionalStep(step) {
    const config = step.config && typeof step.config === "object" && !Array.isArray(step.config)
        ? step.config
        : {};
    if (config.mainPath === true)
        return false;
    const searchable = `${step.label ?? ""} ${step.question ?? ""} ${stepConditionText(step)}`;
    const legacyConditionalCopy = !(step.type === "knowledge" && config.conditional === false) && /pricing|request a demo|support|handoff|human help|human handoff/i.test(searchable);
    return Boolean(step.condition || step.branches || config.trigger || (step.type === "knowledge" && config.conditional !== false) || config.conditional || step.type === "condition" || step.type === "handoff" || legacyConditionalCopy);
}
const workflowDisplaySteps = computed(() => {
    const entries = draftSteps.value.map((step, originalIndex) => ({ step, originalIndex, conditional: isConditionalStep(step) }));
    const main = entries.filter((entry) => !entry.conditional);
    const branches = entries.filter((entry) => entry.conditional);
    return [...main.map((entry) => entry.step), ...branches.map((entry) => entry.step)];
});
const workflowMainPathCount = computed(() => draftSteps.value.filter((step) => !isConditionalStep(step)).length);
function workflowStepIndex(step) {
    return draftSteps.value.indexOf(step);
}
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
    workflowTested.value = false;
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
    const businessEvidence = `${businessName} ${props.businessContext?.summary ?? ""}`;
    if (/swim/i.test(businessEvidence))
        return ENROLLMENT_WORKFLOW_GOAL;
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
function normalizeWorkflowName(value) {
    return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}
function workflowNameForTemplate(key) {
    return workflowTemplates.find((template) => template.key === key)?.label ?? "Workflow";
}
function workflowDisplayName(action) {
    const value = workflowCompletion(action).workflow;
    if (value && typeof value === "object" && typeof value.name === "string" && String(value.name).trim())
        return String(value.name).trim();
    return action.name;
}
function actionHasWorkflow(action) {
    // The API projection is the source of truth for the workflow library. Do
    // not fall back to raw steps when it is present: that would resurrect an
    // archived workflow here after Actions has correctly hidden the reference.
    if (typeof action.workflowCount === "number")
        return action.workflowCount > 0;
    return Boolean((action.steps?.length ?? 0) > 0 || workflowCompletion(action).workflow);
}
function suggestedCreateWorkflowName() {
    const action = allActions.value.find((candidate) => candidate.id === createWorkflowActionId.value);
    if (!action)
        return createWorkflowMode.value === "template" ? workflowNameForTemplate(createWorkflowTemplateKey.value) : "Workflow";
    return generatedWorkflowFor(action).name.trim() || "Workflow";
}
function updateCreateWorkflowNameSuggestion(force = false) {
    const suggestion = suggestedCreateWorkflowName();
    const current = createWorkflowName.value.trim();
    if (force || !current || current === createWorkflowNameSuggestion.value.trim())
        createWorkflowName.value = suggestion;
    createWorkflowNameSuggestion.value = suggestion;
}
function openCreateWorkflow(actionId) {
    createWorkflowOpen.value = true;
    createWorkflowMode.value = "action";
    createWorkflowError.value = "";
    createNewActionOpen.value = false;
    const requestedActionId = typeof actionId === "string" ? actionId : undefined;
    createWorkflowActionId.value = (requestedActionId && allActions.value.some((action) => action.id === requestedActionId && actionCanStartWorkflow(action)) ? requestedActionId : undefined)
        ?? eligibleActions.value.find((action) => /try|demo/i.test(action.name))?.id
        ?? eligibleActions.value[0]?.id
        ?? "";
    createWorkflowTemplateKey.value = "lead";
    createWorkflowDescription.value = defaultBusinessWorkflowDescription();
    if (!requestedActionId && suggestedCreateWorkflowAction.value)
        createWorkflowActionId.value = suggestedCreateWorkflowAction.value.id;
    updateCreateWorkflowNameSuggestion(true);
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
    if (mode === "describe" && suggestedCreateWorkflowAction.value)
        createWorkflowActionId.value = suggestedCreateWorkflowAction.value.id;
    updateCreateWorkflowNameSuggestion();
}
function updateCreateWorkflowTemplate() {
    createWorkflowDescription.value = workflowNameForTemplate(createWorkflowTemplateKey.value);
    updateCreateWorkflowNameSuggestion();
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
        summaryVersion: props.businessContext?.summaryVersion,
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
function workflowTenantContext(action, createWorkflowBusinessId, createWorkflowOrganizationId) {
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
function refreshWorkflowContext() {
    createWorkflowError.value = WORKFLOW_CONTEXT_REFRESH_MESSAGE;
    emit("refresh-workspace");
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
        const isDemo = /demo|trial/.test(name.toLowerCase());
        const isBooking = /book|appointment|schedule|tour/.test(name.toLowerCase());
        const inlineFields = isDemo
            ? []
            : [
                { id: "name", key: "name", label: "Name", type: "text", required: true, visibility: "visible", question: "What’s your name?" },
                { id: "email", key: "email", label: "Email", type: "email", required: true, visibility: "visible", question: "What email address should we use?" },
            ];
        const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions`), {
            method: "POST",
            headers: { "content-type": "application/json", ...props.ownerHeaders() },
            body: JSON.stringify({
                key,
                actionType: isDemo ? "request_demo" : isBooking ? "book_appointment" : "contact_team",
                name,
                description: createNewActionDescription.value.trim() || (isDemo ? "Send the visitor to the verified demo request destination." : `Help visitors with ${name.toLowerCase()}.`),
                captureMode: isDemo ? "form" : "auto",
                ...(isDemo ? { executionMode: "DIRECT_LINK", attachmentPolicy: "sales_intent", requiredFields: [] } : {}),
                fields: inlineFields,
                completion: isDemo
                    ? { createLead: false, leadStatus: "new", message: "You can continue to the demo request here.", submitLabel: "Continue to demo", linkLabel: "Continue to demo", notifyStaff: false, notifyChannels: [], notifyTargets: [] }
                    : { createLead: true, leadStatus: "new", message: "Thanks — I’ve sent your request to the team.", notifyStaff: true, notifyChannels: ["in_app", "email"], notifyTargets: ["business_team"] },
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
    const requestedWorkflowName = createWorkflowName.value.trim().slice(0, 160);
    if (!requestedWorkflowName) {
        createWorkflowError.value = "Enter a name for this workflow.";
        return;
    }
    if (duplicateCreateWorkflow.value) {
        createWorkflowError.value = `A workflow named “${requestedWorkflowName}” already exists. Choose a different name or open the existing workflow.`;
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
        // Generating from an archived/disabled action is an explicit owner action:
        // promote the new workflow to the current draft so it appears in both
        // Actions and Workflows. Provider setup still remains visible as a
        // separate readiness concern.
        if (nextAction.enabled === false || nextAction.lifecycleStatus === "disabled") {
            nextAction.enabled = true;
            nextAction.lifecycleStatus = "active";
            nextAction.reviewReason = undefined;
        }
        nextAction.steps = generated.steps;
        nextAction.description = generated.description;
        nextAction.fields = generated.fields.length ? generated.fields : nextAction.fields;
        setWorkflowMetadata(nextAction, requestedWorkflowName || generated.name);
        if (generated.executionMode)
            nextAction.executionMode = generated.executionMode;
        if (generated.provider)
            nextAction.provider = generated.provider;
        const workflowContextPayload = {
            businessId: createWorkflowBusinessId,
            organizationId: createWorkflowOrganizationId,
            contextVersion: props.businessContext?.contextVersion,
            summaryVersion: props.businessContext?.summaryVersion,
        };
        const createWorkflowPayload = {
            ...nextAction,
            workflowGeneration: true,
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
        const payload = await response.json();
        if (!response.ok && response.status === 409 && /different workflow context|organization mismatch|context changed/i.test(payload.error ?? "")) {
            refreshWorkflowContext();
            return;
        }
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
function requestDeleteWorkflow() {
    if (!workflowDraft.value || deleteWorkflowLoading.value)
        return;
    deleteWorkflowError.value = "";
    deleteWorkflowOpen.value = true;
}
function cancelDeleteWorkflow() {
    if (deleteWorkflowLoading.value)
        return;
    deleteWorkflowOpen.value = false;
    deleteWorkflowError.value = "";
}
async function confirmDeleteWorkflow() {
    const workflow = workflowDraft.value;
    if (!workflow || deleteWorkflowLoading.value)
        return;
    const deletedWorkflowTitle = workflowTitle.value;
    deleteWorkflowLoading.value = true;
    deleteWorkflowError.value = "";
    try {
        const response = await fetch(props.apiUrl(`/api/v1/demo/${encodeURIComponent(props.demoSlug)}/actions/${encodeURIComponent(workflow.id)}`), {
            method: "DELETE",
            headers: props.ownerHeaders(),
        });
        const payload = await response.json();
        if (!response.ok)
            throw new Error(payload.error ?? "Could not delete this workflow.");
        hiddenWorkflowIds.value = new Set([...hiddenWorkflowIds.value, workflow.id]);
        if (locallyCreatedAction.value?.id === workflow.id)
            locallyCreatedAction.value = null;
        selectedWorkflowId.value = "";
        workflowDraft.value = null;
        draftSourceId = "";
        draftIsDirty.value = false;
        deleteWorkflowOpen.value = false;
        workflowSaveMessage.value = `Workflow “${deletedWorkflowTitle}” deleted.`;
        emit("refresh");
    }
    catch (error) {
        deleteWorkflowError.value = error instanceof Error ? error.message : "Could not delete this workflow.";
    }
    finally {
        deleteWorkflowLoading.value = false;
    }
}
watch(workflowActions, () => {
    if (!workflowActions.value.some((action) => action.id === selectedWorkflowId.value)) {
        selectedWorkflowId.value = preferredWorkflowId();
    }
    syncDraft();
}, { immediate: true, deep: true });
watch(() => props.initialActionId, (actionId) => {
    if (!actionId || workflowActions.value.some((action) => action.id === actionId))
        return;
    void nextTick(() => openCreateWorkflow(actionId));
}, { immediate: true });
watch(selectedWorkflowId, (id) => {
    rememberSelectedWorkflow(id);
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
    if (label === "No provider required")
        return "No provider required";
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
function stepGenerationReason(step) {
    return stepConfigValue(step, "generationReason");
}
function stepGenerationStatus(step) {
    return stepConfigValue(step, "generationStatus");
}
function stepGenerationStatusLabel(step) {
    const status = stepGenerationStatus(step);
    return status === "missing" ? "Missing information" : status === "verified" ? "Grounded in context" : "Suggested";
}
function setStepConfig(step, key, value) {
    ensureStepConfig(step)[key] = value || undefined;
    markDirty();
}
function setStepConfigFromEvent(step, key, event) {
    const value = event.target.value;
    if (key === "failureBehavior" && value === "agent_default") {
        delete ensureStepConfig(step)[key];
        markDirty();
        return;
    }
    setStepConfig(step, key, value);
}
function defaultKnowledgeConfig() {
    return {
        interruptionPolicy: "answer_and_resume",
        topic: "pricing",
        knowledgeSource: "verified_business_knowledge",
        allowedFacts: "pricing",
        verifiedBehavior: "answer_naturally",
        unavailableBehavior: "say_not_verified",
        resumeBehavior: "return_to_previous_step",
        ctaBehavior: "keep_current_if_available",
        conditional: true,
        requiresVerifiedData: true,
    };
}
function handleStepTypeChange(step) {
    if (step.type === "knowledge") {
        step.question = step.question || "Answer naturally from verified business knowledge.";
        step.config = { ...defaultKnowledgeConfig(), ...(step.config ?? {}) };
    }
    markDirty();
}
function knowledgePreviewExamples(step) {
    const topic = stepConfigValue(step, "topic").toLowerCase();
    if (/price|pricing|cost|fee|rate|plan/.test(topic)) {
        return [
            "How much does it cost?",
            "What's the price for one salon?",
            "Do you have a monthly plan?",
        ];
    }
    if (/cancel|refund|warranty|policy/.test(topic))
        return ["What's your cancellation policy?", "Can I get a refund?"];
    if (/integrat|service|feature|capabilit/.test(topic))
        return ["What integrations do you support?", "What can you help with?"];
    if (/hour|location|address|where/.test(topic))
        return ["What are your hours?", "Where are you located?"];
    return [`What can you tell me about ${topic || "this topic"}?`];
}
function knowledgePreviewMatchesTopic(step, question) {
    const topic = stepConfigValue(step, "topic").toLowerCase().trim();
    const normalizedQuestion = question.toLowerCase();
    if (!topic || !question.trim())
        return false;
    const topicAliases = topic.includes("pricing") || topic.includes("price")
        ? ["price", "pricing", "cost", "fee", "rate", "monthly", "plan"]
        : topic.includes("cancel") || topic.includes("refund") || topic.includes("policy")
            ? ["cancel", "cancellation", "refund", "policy", "warranty"]
            : topic.includes("integrat") || topic.includes("service") || topic.includes("feature") || topic.includes("capabilit")
                ? ["integrat", "service", "feature", "capabilit", "offer"]
                : topic.includes("hour") || topic.includes("location") || topic.includes("address")
                    ? ["hour", "open", "location", "address", "where"]
                    : topic.split(/[^a-z0-9]+/).filter((token) => token.length > 2);
    return topicAliases.some((alias) => normalizedQuestion.includes(alias));
}
function runKnowledgePreview(step, question = knowledgePreviewQuestion.value) {
    const previewQuestion = question.trim();
    knowledgePreviewQuestion.value = previewQuestion;
    knowledgePreviewStepId.value = step.id;
    const matched = knowledgePreviewMatchesTopic(step, previewQuestion);
    const topic = stepConfigValue(step, "topic") || "Knowledge topic";
    const reviewStatus = stepConfigValue(step, "reviewStatus");
    const source = stepConfigValue(step, "knowledgeSource");
    const evidence = !matched
        ? "not evaluated"
        : reviewStatus === "needs_owner_confirmation"
            ? "not verified"
            : source === "verified_business_knowledge"
                ? "verified"
                : "unavailable";
    const verified = evidence === "verified";
    knowledgePreviewResult.value = {
        matchedTopic: matched ? formatLabel(topic) : "No matching topic",
        evidence,
        responseBehavior: !matched
            ? "step not triggered"
            : formatLabel(stepConfigValue(step, verified ? "verifiedBehavior" : "unavailableBehavior") || (verified ? "answer_naturally" : "say_not_verified")),
        resumeBehavior: matched ? formatLabel(stepConfigValue(step, "resumeBehavior") || "return_to_previous_step") : "unchanged",
        ctaRetained: matched && stepConfigValue(step, "ctaBehavior") === "keep_current_if_available" ? "yes" : "no",
    };
}
function stepOptionsText(step) {
    return (step.options ?? []).join(", ");
}
function setStepOptions(step, event) {
    step.options = event.target.value.split(",").map((value) => value.trim()).filter(Boolean);
    markDirty();
}
function workflowFieldForStep(step) {
    const fields = workflowDraft.value?.fields ?? [];
    return fields.find((field) => field.key === step.fieldKey || field.id === step.fieldKey) ?? null;
}
function captureAnswerType(step) {
    return workflowFieldForStep(step)?.type ?? step.answerType ?? "text";
}
function captureAnswerTypeLabel(step) {
    return answerTypes.find((type) => type.value === captureAnswerType(step))?.label ?? "Short text";
}
function captureAnswerUsesOptions(step) {
    return ["select", "multi_select"].includes(captureAnswerType(step));
}
function captureOptions(step) {
    const field = workflowFieldForStep(step);
    return [...(field?.options ?? step.options ?? [])];
}
function selectCaptureField(step, event) {
    const fieldKey = event.target.value;
    step.fieldKey = fieldKey || undefined;
    const field = workflowFieldForStep(step);
    if (field) {
        if (!step.label || step.label === "Capture details")
            step.label = field.label;
        step.answerType = field.type;
        step.question = field.question;
        step.required = field.required;
        step.options = field.options ? [...field.options] : undefined;
    }
    markDirty();
}
function updateCaptureQuestion(step, event) {
    step.question = event.target.value;
    const field = workflowFieldForStep(step);
    if (field)
        field.question = step.question ?? "";
    markDirty();
}
function updateCaptureRequired(step, event) {
    const required = event.target.checked;
    step.required = required;
    const field = workflowFieldForStep(step);
    if (field)
        field.required = required;
    markDirty();
}
function setCaptureAnswerType(step, event) {
    const type = event.target.value;
    step.answerType = type;
    const field = workflowFieldForStep(step);
    if (field) {
        field.type = type;
        if (!captureAnswerUsesOptions({ ...step, fieldKey: field.key })) {
            delete field.options;
            delete step.options;
        }
        else {
            step.options = field.options ? [...field.options] : [];
        }
    }
    markDirty();
}
function setCaptureOption(step, index, event) {
    const options = captureOptions(step);
    options[index] = event.target.value;
    const field = workflowFieldForStep(step);
    if (field)
        field.options = [...options];
    step.options = [...options];
    markDirty();
}
function addCaptureOption(step) {
    const options = captureOptions(step);
    options.push("New option");
    const field = workflowFieldForStep(step);
    if (field)
        field.options = [...options];
    step.options = [...options];
    markDirty();
}
function removeCaptureOption(step, index) {
    const options = captureOptions(step);
    options.splice(index, 1);
    const field = workflowFieldForStep(step);
    if (field) {
        if (options.length)
            field.options = [...options];
        else
            delete field.options;
    }
    if (options.length)
        step.options = [...options];
    else
        delete step.options;
    markDirty();
}
function fieldKeyFromLabel(label, fields) {
    const base = label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || `field_${fields.length + 1}`;
    const existing = new Set(fields.map((field) => field.key));
    let key = base;
    let suffix = 2;
    while (existing.has(key))
        key = `${base}_${suffix++}`;
    return key;
}
function openCustomFieldEditor(step) {
    const fields = workflowDraft.value?.fields ?? [];
    const suggestedLabel = step.label && step.label !== "Capture details" ? step.label : "New field";
    customFieldOpenFor.value = step.id;
    customFieldLabel.value = suggestedLabel;
    customFieldKey.value = fieldKeyFromLabel(suggestedLabel, fields);
}
function closeCustomFieldEditor() {
    customFieldOpenFor.value = "";
    customFieldLabel.value = "";
    customFieldKey.value = "";
}
function createCustomField(step) {
    if (!workflowDraft.value)
        return;
    const label = customFieldLabel.value.trim();
    if (!label)
        return;
    const fields = workflowDraft.value.fields ?? (workflowDraft.value.fields = []);
    const key = customFieldKey.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "_") || fieldKeyFromLabel(label, fields);
    const uniqueKey = fieldKeyFromLabel(key, fields);
    const type = captureAnswerType(step);
    const options = captureAnswerUsesOptions(step) ? captureOptions(step).filter((option) => option.trim()) : [];
    const question = step.question?.trim() || `What is your ${label.toLowerCase()}?`;
    const field = {
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
function stepConditionText(step) {
    if (typeof step.condition === "string")
        return step.condition;
    if (typeof step.conditionText === "string")
        return step.conditionText;
    return stepConfigValue(step, "conditionText");
}
function updateStepCondition(step, event) {
    const value = event.target.value;
    step.conditionText = value;
    const config = ensureStepConfig(step);
    if (value.trim())
        config.conditionText = value.trim();
    else
        delete config.conditionText;
    markDirty();
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
        question: type === "capture" || type === "ask" ? "What should we know?" : type === "knowledge" ? "Answer naturally from verified business knowledge." : undefined,
        required: type === "capture" || type === "ask",
        config: type === "lookup"
            ? { provider: workflowProvider.value || "jackrabbit", operation: "find_classes", failureBehavior: "handoff", searchFields: "location, schedule, age" }
            : type === "knowledge" ? defaultKnowledgeConfig() : {},
    });
    selectedStepIndex.value = draftSteps.value.length - 1;
    markDirty();
}
function captureWorkflowUndo(message) {
    if (!workflowDraft.value)
        return;
    undoSnapshot.value = {
        steps: clone(draftSteps.value),
        fields: clone(workflowDraft.value.fields ?? []),
        selectedStepIndex: selectedStepIndex.value,
    };
    undoMessage.value = message;
    if (undoTimer)
        clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
        undoMessage.value = "";
        undoSnapshot.value = null;
    }, 8_000);
}
function undoLastWorkflowChange() {
    if (!workflowDraft.value || !undoSnapshot.value)
        return;
    workflowDraft.value.steps = clone(undoSnapshot.value.steps);
    workflowDraft.value.fields = clone(undoSnapshot.value.fields);
    selectedStepIndex.value = undoSnapshot.value.selectedStepIndex;
    markDirty();
    undoMessage.value = "Change undone.";
    undoSnapshot.value = null;
    if (undoTimer)
        clearTimeout(undoTimer);
}
function closeStepMenu() {
    openStepMenuId.value = "";
}
function editWorkflowStep(index) {
    selectedStepIndex.value = index;
    closeStepMenu();
}
function duplicateWorkflowStep(index) {
    if (!workflowDraft.value?.steps?.[index])
        return;
    captureWorkflowUndo("Step duplicated.");
    const source = clone(draftSteps.value[index]);
    const baseId = source.id || `step-${Date.now()}`;
    const existingIds = new Set(draftSteps.value.map((step) => step.id));
    let id = `${baseId}-copy`;
    let suffix = 2;
    while (existingIds.has(id))
        id = `${baseId}-copy-${suffix++}`;
    source.id = id;
    source.label = `${source.label || stepTypeLabel(source.type)} (copy)`;
    delete source.nextStepId;
    source.enabled = true;
    workflowDraft.value.steps.splice(index + 1, 0, source);
    selectedStepIndex.value = index + 1;
    closeStepMenu();
    markDirty();
}
function moveWorkflowStepToMainPath(index) {
    const step = draftSteps.value[index];
    if (!step)
        return;
    const config = ensureStepConfig(step);
    config.mainPath = true;
    delete config.trigger;
    if (step.type === "knowledge")
        config.conditional = false;
    delete step.condition;
    delete step.conditionText;
    delete config.conditionText;
    closeStepMenu();
    markDirty();
}
function toggleWorkflowStep(index) {
    const step = draftSteps.value[index];
    if (!step)
        return;
    captureWorkflowUndo(step.enabled === false ? "Step enabled." : "Step disabled.");
    step.enabled = step.enabled === false;
    closeStepMenu();
    markDirty();
}
function stepDependencyReasons(target, index) {
    const dependents = [];
    const targetField = target.fieldKey?.trim();
    const targetId = target.id;
    for (const [candidateIndex, candidate] of draftSteps.value.entries()) {
        if (candidateIndex <= index)
            continue;
        const candidateDependencies = workflowFieldDependencies(candidate);
        if (targetField && candidateDependencies.has(targetField)) {
            dependents.push({ index: candidateIndex, label: candidate.label || stepTypeLabel(candidate.type), reason: `uses ${targetField}` });
            continue;
        }
        if (targetId && (candidate.nextStepId === targetId || (Array.isArray(candidate.branches) && candidate.branches.some((branch) => branch?.nextStepId === targetId)))) {
            dependents.push({ index: candidateIndex, label: candidate.label || stepTypeLabel(candidate.type), reason: "routes to this step" });
        }
    }
    return dependents;
}
function requestDeleteWorkflowStep(index) {
    const step = draftSteps.value[index];
    if (!step)
        return;
    deleteStepIndex.value = index;
    deleteStepDependents.value = stepDependencyReasons(step, index);
    closeStepMenu();
}
function removeWorkflowSteps(indices) {
    if (!workflowDraft.value?.steps)
        return;
    const removeIndexes = new Set(indices);
    const removedIds = new Set(indices.map((index) => draftSteps.value[index]?.id).filter((id) => Boolean(id)));
    captureWorkflowUndo(indices.length > 1 ? "Steps removed." : "Step removed.");
    workflowDraft.value.steps = draftSteps.value.filter((_, index) => !removeIndexes.has(index)).map((step) => {
        const next = clone(step);
        if (next.nextStepId && removedIds.has(next.nextStepId))
            delete next.nextStepId;
        if (Array.isArray(next.branches))
            next.branches = next.branches.filter((branch) => !branch.nextStepId || !removedIds.has(branch.nextStepId));
        return next;
    });
    selectedStepIndex.value = draftSteps.value.length ? Math.max(0, Math.min(selectedStepIndex.value, draftSteps.value.length - 1)) : -1;
    deleteStepIndex.value = -1;
    deleteStepDependents.value = [];
    markDirty();
}
function confirmDeleteWorkflowStep() {
    if (deleteStepIndex.value < 0)
        return;
    const indexes = [deleteStepIndex.value];
    if (deleteStepDependents.value.length) {
        for (const dependent of deleteStepDependents.value) {
            if (dependent.index > deleteStepIndex.value)
                indexes.push(dependent.index);
        }
    }
    removeWorkflowSteps([...new Set(indexes)]);
}
function cancelDeleteWorkflowStep() {
    deleteStepIndex.value = -1;
    deleteStepDependents.value = [];
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
    closeStepMenu();
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
    const ownerGoal = workflowDraft.value.key === "enroll_child"
        ? ENROLLMENT_WORKFLOW_GOAL
        : preserveWorkflowGoal(workflowDescription.value) ?? defaultBusinessWorkflowDescription();
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
        workflowSaveMessage.value = "Draft saved. Runtime will use the updated steps. Live visitors stay on the published workflow until you publish.";
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
async function testWorkflow() {
    if (!workflowDraft.value || workflowSaveLoading.value)
        return;
    if (draftIsDirty.value) {
        await saveWorkflow();
        if (workflowSaveError.value)
            return;
    }
    workflowTested.value = true;
    emit("test-workflow", workflowDraft.value.id);
}
async function publishWorkflow() {
    if (!workflowDraft.value || workflowSaveLoading.value)
        return;
    if (!workflowVerificationReady.value) {
        workflowVerificationOpen.value = true;
        workflowSaveError.value = "This workflow cannot be published yet. Review the verifier checks below.";
        return;
    }
    if (draftIsDirty.value) {
        await saveWorkflow();
        if (workflowSaveError.value)
            return;
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
    __VLS_withDotValue(selectedWorkflow, {});
    __VLS_withDotValue(draftIsDirty, {});
    __VLS_withDotValue(workflowDraft, {});
    __VLS_withDotValue(workflowSaveLoading, {});
    __VLS_withDotValue(workflowActions, {});
    __VLS_withDotValue(workflowGoalExpanded, {});
    __VLS_withDotValue(workflowDescription, {});
    __VLS_withDotValue(showTemplatePicker, {});
    __VLS_withDotValue(workflowOutcomeAction, {});
    __VLS_withDotValue(workflowMetadata, {});
    __VLS_withDotValue(selectedWorkflowPerformance, {});
    __VLS_withDotValue(workflowRecommendation, {});
    __VLS_withDotValue(workflowStepList, {});
    __VLS_withDotValue(configurationComplete, {});
    __VLS_withDotValue(setupStatusOpen, {});
    __VLS_withDotValue(readinessRemaining, {});
    __VLS_withDotValue(workflowVerificationIssues, {});
    __VLS_withDotValue(workflowVerificationOpen, {});
    __VLS_withDotValue(undoMessage, {});
    __VLS_withDotValue(workflowMainPathCount, {});
    __VLS_withDotValue(workflowDisplaySteps, {});
    __VLS_withDotValue(selectedStepIndex, {});
    __VLS_withDotValue(customFieldOpenFor, {});
    __VLS_withDotValue(customFieldLabel, {});
    __VLS_withDotValue(knowledgePreviewQuestion, {});
    __VLS_withDotValue(knowledgePreviewStepId, {});
    __VLS_withDotValue(knowledgePreviewResult, {});
    __VLS_withDotValue(providerConnected, {});
    __VLS_withDotValue(stepAdvancedOpen, {});
    __VLS_withDotValue(draftSteps, {});
    __VLS_withDotValue(workflowAdvancedOpen, {});
    __VLS_withDotValue(providerStep, {});
    __VLS_withDotValue(workflowFallbackCustomized, {});
    __VLS_withDotValue(workflowSaveError, {});
    __VLS_withDotValue(workflowSaveMessage, {});
    __VLS_withDotValue(deleteStepDependents, {});
    __VLS_withDotValue(createWorkflowOpen, {});
    __VLS_withDotValue(createWorkflowMode, {});
    __VLS_withDotValue(duplicateCreateWorkflow, {});
    __VLS_withDotValue(selectedActionSetupWarning, {});
    __VLS_withDotValue(plainEnglishInference, {});
    __VLS_withDotValue(selectedCreateWorkflowAction, {});
    __VLS_withDotValue(eligibleActions, {});
    __VLS_withDotValue(createWorkflowDescription, {});
    __VLS_withDotValue(createNewActionOpen, {});
    __VLS_withDotValue(createWorkflowLoading, {});
    __VLS_withDotValue(createNewActionName, {});
    __VLS_withDotValue(createWorkflowError, {});
    __VLS_withDotValue(createWorkflowActionId, {});
    __VLS_withDotValue(createWorkflowName, {});
    __VLS_withDotValue(deleteWorkflowOpen, {});
    __VLS_withDotValue(selectedWorkflowIsLive, {});
    __VLS_withDotValue(deleteWorkflowError, {});
    __VLS_withDotValue(deleteWorkflowLoading, {});
    void {};
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-field-picker']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-provider-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-input']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-examples']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-examples']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-examples']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-result']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-result']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-result']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-custom-field-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-custom-field-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-custom-field-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-custom-field-box']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-custom-field-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-options-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-options-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-options-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-options-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-option-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-option-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-option-row']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-inference-preview']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-inference-preview']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-model-banner']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
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
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-isolation-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library']} */ ;
    /** @type {__VLS_StyleScopedClasses['panel-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-status-dot']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-bar']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-outcome-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-outcome-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-outcome-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-outcome-meta']} */ ;
    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-context-note']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-context-note']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-context-note']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-editor']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-editor']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-editor']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-template-flow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-mark']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['complete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['incomplete']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-section-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['selected']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['conditional']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['conditional']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['verified']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
    /** @type {__VLS_StyleScopedClasses['missing']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-title']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-more-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger-menu-item']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-verifier-issues']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-undo-toast']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-confirm-modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-confirm-modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-confirm-modal']} */ ;
    /** @type {__VLS_StyleScopedClasses['danger-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-stats']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-stats']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-stats']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-delete-action']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-action-setup-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-delete-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-delete-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-delete-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-delete-warning']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-sticky-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-bar']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-copy']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-goal-summary-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-outcome-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-header-secondary-action']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-page-actions']} */ ;
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['conditional']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
    /** @type {__VLS_StyleScopedClasses['conditional']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-input']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-input']} */ ;
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-result']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-step-menu-popover']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insights-stats']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-selector-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "view-content workflow-workspace" },
        'data-workflow-generation-key': (workflowGenerationKey.value || undefined),
    });
    /** @type {__VLS_StyleScopedClasses['view-content']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-workspace']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "workflow-page-header workflow-sticky-header" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-page-header']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-sticky-header']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "workflow-page-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-page-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    (__VLS_unwrap(workflowTitle, {}));
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "workflow-header-status" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-header-status']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: (['workflow-status-dot', { published: workflowStatus(selectedWorkflow.value ?? {}) === 'LIVE' && !draftIsDirty.value }]) },
        'aria-hidden': "true",
    });
    /** @type {__VLS_StyleScopedClasses['published']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-status-dot']} */ ;
    (__VLS_unwrap(workflowStatusSummary, {}));
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "workflow-header-separator" },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-header-separator']} */ ;
    (draftIsDirty.value ? 'Unsaved changes' : 'Last saved');
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
                [workflowGenerationKey, workflowTitle, selectedWorkflow, draftIsDirty, draftIsDirty, workflowStatusSummary, emit,];
            } },
        ...{ class: "text-button workflow-header-secondary-action" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-header-secondary-action']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (testWorkflow) },
        ...{ class: "outline-button small workflow-test-button" },
        type: "button",
        disabled: (!workflowDraft.value),
    });
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-test-button']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (publishWorkflow) },
        ...{ class: "primary-button small" },
        type: "button",
        disabled: (!workflowDraft.value || workflowSaveLoading.value),
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    (workflowSaveLoading.value ? 'Saving…' : 'Publish');
    if (__VLS_ctx.publishError) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "form-error workflow-publish-error" },
            role: "alert",
        });
        /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-publish-error']} */ ;
        (__VLS_ctx.publishError);
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: (['workflow-layout', { 'workflow-layout-empty': !workflowActions.value.length }]) },
    });
    /** @type {__VLS_StyleScopedClasses['workflow-layout']} */ ;
    /** @type {__VLS_StyleScopedClasses['workflow-layout-empty']} */ ;
    if (workflowActions.value.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-selector-bar" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-selector-bar']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-selector-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-selector-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (workflowActions.value.length);
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "workflow-library-select" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-library-select']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            value: (__VLS_unwrap(selectedWorkflowId, {})),
        });
        const __VLS_0 = __VLS_tryAsConstant((workflowActions.value));
        for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                key: (action.id),
                value: (action.id),
            });
            (workflowDisplayName(action));
            (workflowStatusLabel(action));
            // @ts-ignore
            [workflowDraft, workflowDraft, workflowSaveLoading, workflowSaveLoading, publishError, publishError, workflowActions, workflowActions, workflowActions, workflowActions, selectedWorkflowId,];
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-selector-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-selector-actions']} */ ;
        if (workflowDraft.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (requestDeleteWorkflow) },
                ...{ class: "text-button workflow-delete-action" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-delete-action']} */ ;
            let __VLS_1;
            /** @ts-ignore @type { | typeof Trash2} */
            Trash2;
            // @ts-ignore
            const __VLS_2 = __VLS_asFunctionalComponent1(__VLS_1, new __VLS_1({
                // @ts-ignore
                size: (14), strokeWidth: (1.9), 'aria-hidden': "true",
            }));
            const __VLS_3 = __VLS_2({
                size: (14),
                strokeWidth: (1.9),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_2));
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (openCreateWorkflow) },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_6;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_7 = __VLS_asFunctionalComponent1(__VLS_6, new __VLS_6({
            // @ts-ignore
            size: (14), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_8 = __VLS_7({
            size: (14),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_7));
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-empty workflow-layout-empty-state" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-layout-empty-state']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-empty-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-empty-icon']} */ ;
        let __VLS_11;
        /** @ts-ignore @type { | typeof GitBranch} */
        GitBranch;
        // @ts-ignore
        const __VLS_12 = __VLS_asFunctionalComponent1(__VLS_11, new __VLS_11({
            // @ts-ignore
            size: (28), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_13 = __VLS_12({
            size: (28),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_12));
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (openCreateWorkflow) },
            ...{ class: "primary-button" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        let __VLS_16;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_17 = __VLS_asFunctionalComponent1(__VLS_16, new __VLS_16({
            // @ts-ignore
            size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_18 = __VLS_17({
            size: (16),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_17));
    }
    if (workflowDraft.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.main, __VLS_intrinsics.main)({
            ...{ class: "workflow-builder" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-builder']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-goal-summary" },
            'aria-labelledby': "workflow-goal-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-goal-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-goal-summary-row" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-goal-summary-row']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-goal-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-goal-icon']} */ ;
        let __VLS_21;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_22 = __VLS_asFunctionalComponent1(__VLS_21, new __VLS_21({
            // @ts-ignore
            size: (17), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_23 = __VLS_22({
            size: (17),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_22));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-goal-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-goal-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
            id: "workflow-goal-heading",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (workflowDraft.value.description || 'Describe the customer outcome this workflow owns.');
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (workflowGoalExpanded.value = !workflowGoalExpanded.value);
                    // @ts-ignore
                    [workflowDraft, workflowDraft, workflowDraft, workflowGoalExpanded, workflowGoalExpanded,];
                } },
            ...{ class: "text-button workflow-goal-toggle" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-goal-toggle']} */ ;
        (workflowGoalExpanded.value ? 'Done' : 'Edit goal');
        let __VLS_26;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
        // @ts-ignore
        const __VLS_27 = __VLS_asFunctionalComponent1(__VLS_26, new __VLS_26({
            // @ts-ignore
            size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_28 = __VLS_27({
            size: (14),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_27));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-context-note" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-context-note']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        if (workflowGoalExpanded.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-goal-editor" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-goal-editor']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                ...{ onInput: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(workflowGoalExpanded.value))
                            throw 0;
                        return (resizeWorkflowGoalEditor($event.target));
                        // @ts-ignore
                        [workflowGoalExpanded, workflowGoalExpanded,];
                    } },
                ...{ onKeydown: (generateStarter) },
                ...{ onKeydown: (generateStarter) },
                ref: "workflowAssistInput",
                value: (workflowDescription.value),
                rows: "4",
                placeholder: "Example: Ask what kind of salon they run, match verified capabilities, then offer the right next step.",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-assist-footer" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-assist-footer']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (workflowDescription.value.length.toLocaleString());
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (generateStarter) },
                ...{ class: "primary-button small" },
                type: "button",
                'aria-label': "Generate steps",
                disabled: (!workflowDescription.value.trim()),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            let __VLS_31;
            /** @ts-ignore @type { | typeof Sparkles} */
            Sparkles;
            // @ts-ignore
            const __VLS_32 = __VLS_asFunctionalComponent1(__VLS_31, new __VLS_31({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_33 = __VLS_32({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_32));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-template-flow" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-template-flow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(workflowGoalExpanded.value))
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
                                if (!(workflowGoalExpanded.value))
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
        if (workflowDraft.value.workflowSafety?.status === 'blocked') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-isolation-warning" },
                role: "alert",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-isolation-warning']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-outcome-card" },
            'aria-labelledby': "workflow-outcome-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-outcome-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-outcome-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-outcome-copy']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
            id: "workflow-outcome-heading",
        });
        (workflowOutcomeAction.value?.name || 'Configured Action');
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-outcome-meta" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-outcome-meta']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: (['status-pill', workflowOutcomeAction.value?.setupStatus === 'READY' ? 'booked' : 'new']) },
        });
        /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
        (workflowOutcomeAction.value?.setupStatus === 'READY' ? 'Ready' : workflowOutcomeAction.value?.setupStatus === 'DRAFT' ? 'Draft' : 'Needs setup');
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        (workflowOutcomeAction.value?.capability?.completionType === 'link' ? 'Send visitors to a page' : workflowOutcomeAction.value?.capability?.completionType === 'provider' ? 'Use a connected provider' : 'Action completion');
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (__VLS_unwrap(emit, {})('open-action', workflowMetadata.value?.actionId || workflowDraft.value?.id || ''));
                    // @ts-ignore
                    [emit, workflowDraft, workflowDraft, workflowOutcomeAction, workflowOutcomeAction, workflowOutcomeAction, workflowOutcomeAction, workflowOutcomeAction, workflowOutcomeAction, workflowMetadata,];
                } },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        if (selectedWorkflowPerformance.value && selectedWorkflowPerformance.value.started > 0) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
                ...{ class: "workflow-insights-card" },
                'aria-labelledby': "workflow-insights-heading",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-insights-card']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-insights-heading" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-insights-heading']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "eyebrow" },
            });
            /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({
                id: "workflow-insights-heading",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "status-pill qualified" },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            /** @type {__VLS_StyleScopedClasses['qualified']} */ ;
            (selectedWorkflowPerformance.value.completionRate);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-insights-stats" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-insights-stats']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedWorkflowPerformance.value.started);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedWorkflowPerformance.value.formDisplayed);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedWorkflowPerformance.value.completed);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedWorkflowPerformance.value.completionRate);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            if (workflowRecommendation.value) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-insight-recommendation" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-insight-recommendation']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                    ...{ class: "workflow-recommendation-mark" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-recommendation-mark']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
                (workflowRecommendation.value.message);
                __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                (workflowRecommendation.value.count);
                (workflowRecommendation.value.count === 1 ? '' : 's');
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!(selectedWorkflowPerformance.value && selectedWorkflowPerformance.value.started > 0))
                                throw 0;
                            if (!(workflowRecommendation.value))
                                throw 0;
                            return (workflowStepList.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
                            // @ts-ignore
                            [selectedWorkflowPerformance, selectedWorkflowPerformance, selectedWorkflowPerformance, selectedWorkflowPerformance, selectedWorkflowPerformance, selectedWorkflowPerformance, selectedWorkflowPerformance, workflowRecommendation, workflowRecommendation, workflowRecommendation, workflowRecommendation, workflowStepList,];
                        } },
                    ...{ class: "text-button" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            }
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-readiness-card" },
            'aria-labelledby': "workflow-setup-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-summary" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-summary']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-readiness-mark" },
            ...{ class: ({ complete: configurationComplete.value }) },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-mark']} */ ;
        /** @type {__VLS_StyleScopedClasses['complete']} */ ;
        if (configurationComplete.value) {
            let __VLS_42;
            /** @ts-ignore @type { | typeof Check} */
            Check;
            // @ts-ignore
            const __VLS_43 = __VLS_asFunctionalComponent1(__VLS_42, new __VLS_42({
                // @ts-ignore
                size: (15), strokeWidth: (2.4), 'aria-hidden': "true",
            }));
            const __VLS_44 = __VLS_43({
                size: (15),
                strokeWidth: (2.4),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_43));
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                'aria-hidden': "true",
            });
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
            id: "workflow-setup-heading",
        });
        (__VLS_unwrap(configurationLabel, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_unwrap(setupProgressLabel, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (setupStatusOpen.value = !setupStatusOpen.value);
                    // @ts-ignore
                    [configurationComplete, configurationComplete, configurationLabel, setupProgressLabel, setupStatusOpen, setupStatusOpen,];
                } },
            ...{ class: "text-button workflow-readiness-toggle" },
            type: "button",
            'aria-expanded': (setupStatusOpen.value),
        });
        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-readiness-toggle']} */ ;
        (setupStatusOpen.value ? 'Hide details' : 'View details');
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
        if (setupStatusOpen.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-readiness-details" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-readiness-details']} */ ;
            const __VLS_52 = __VLS_tryAsConstant((__VLS_unwrap(setupChecklist, {})));
            for (const [item] of __VLS_vFor(__VLS_nonNull(__VLS_52))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                    key: (item.label),
                    ...{ class: ({ complete: item.complete, incomplete: !item.complete }) },
                });
                /** @type {__VLS_StyleScopedClasses['complete']} */ ;
                /** @type {__VLS_StyleScopedClasses['incomplete']} */ ;
                if (item.complete) {
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
                }
                else {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({
                        'aria-hidden': "true",
                    });
                }
                (readinessLabel(item.label));
                // @ts-ignore
                [setupStatusOpen, setupStatusOpen, setupStatusOpen, setupChecklist,];
            }
            if (readinessRemaining.value.length) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (continueSetup) },
                    ...{ class: "text-button" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
                let __VLS_58;
                /** @ts-ignore @type { | typeof ArrowRight} */
                ArrowRight;
                // @ts-ignore
                const __VLS_59 = __VLS_asFunctionalComponent1(__VLS_58, new __VLS_58({
                    // @ts-ignore
                    size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
                }));
                const __VLS_60 = __VLS_59({
                    size: (14),
                    strokeWidth: (1.8),
                    'aria-hidden': "true",
                }, ...__VLS_functionalComponentArgsRest(__VLS_59));
            }
        }
        if (workflowVerificationIssues.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
                ...{ class: "workflow-verifier-card" },
                ...{ class: ({ expanded: workflowVerificationOpen.value }) },
                'aria-labelledby': "workflow-verifier-heading",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-verifier-card']} */ ;
            /** @type {__VLS_StyleScopedClasses['expanded']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-verifier-summary" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-verifier-summary']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-verifier-icon" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-verifier-icon']} */ ;
            let __VLS_63;
            /** @ts-ignore @type { | typeof X} */
            X;
            // @ts-ignore
            const __VLS_64 = __VLS_asFunctionalComponent1(__VLS_63, new __VLS_63({
                // @ts-ignore
                size: (15), strokeWidth: (2.2), 'aria-hidden': "true",
            }));
            const __VLS_65 = __VLS_64({
                size: (15),
                strokeWidth: (2.2),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_64));
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "eyebrow" },
            });
            /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
                id: "workflow-verifier-heading",
            });
            (workflowVerificationIssues.value.length);
            (workflowVerificationIssues.value.length === 1 ? '' : 's');
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(workflowVerificationIssues.value.length))
                            throw 0;
                        return (workflowVerificationOpen.value = !workflowVerificationOpen.value);
                        // @ts-ignore
                        [readinessRemaining, workflowVerificationIssues, workflowVerificationIssues, workflowVerificationIssues, workflowVerificationOpen, workflowVerificationOpen, workflowVerificationOpen,];
                    } },
                ...{ class: "text-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            (workflowVerificationOpen.value ? 'Hide checks' : 'Review checks');
            let __VLS_68;
            /** @ts-ignore @type { | typeof ChevronDown} */
            ChevronDown;
            // @ts-ignore
            const __VLS_69 = __VLS_asFunctionalComponent1(__VLS_68, new __VLS_68({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_70 = __VLS_69({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_69));
            if (workflowVerificationOpen.value) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-verifier-issues" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-verifier-issues']} */ ;
                const __VLS_73 = __VLS_tryAsConstant((workflowVerificationIssues.value));
                for (const [issue] of __VLS_vFor(__VLS_nonNull(__VLS_73))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        key: (`${issue.code}-${issue.message}`),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-verifier-bullet" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-verifier-bullet']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                    (issue.message);
                    // @ts-ignore
                    [workflowVerificationIssues, workflowVerificationOpen, workflowVerificationOpen,];
                }
            }
        }
        if (undoMessage.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-undo-toast" },
                role: "status",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-undo-toast']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (undoMessage.value);
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (undoLastWorkflowChange) },
                type: "button",
            });
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
                    [undoMessage, undoMessage,];
                } },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        let __VLS_74;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_75 = __VLS_asFunctionalComponent1(__VLS_74, new __VLS_74({
            // @ts-ignore
            size: (14), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_76 = __VLS_75({
            size: (14),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_75));
        const __VLS_79 = __VLS_tryAsConstant((workflowDisplaySteps.value));
        for (const [step, index] of __VLS_vFor(__VLS_nonNull(__VLS_79))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.template)({
                key: (step.id || index),
            });
            if (index === workflowMainPathCount.value && workflowMainPathCount.value < workflowDisplaySteps.value.length) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-conditional-heading" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-conditional-heading']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                    ...{ class: "eyebrow" },
                });
                /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        return (selectedStepIndex.value = workflowStepIndex(step));
                        // @ts-ignore
                        [workflowDisplaySteps, workflowDisplaySteps, workflowMainPathCount, workflowMainPathCount, selectedStepIndex,];
                    } },
                ...{ class: (['workflow-step-card', { selected: selectedStepIndex.value === workflowStepIndex(step), conditional: isConditionalStep(step), disabled: step.enabled === false }]) },
            });
            /** @type {__VLS_StyleScopedClasses['selected']} */ ;
            /** @type {__VLS_StyleScopedClasses['conditional']} */ ;
            /** @type {__VLS_StyleScopedClasses['disabled']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-step-card']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-rail" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-rail']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (workflowStepIndex(step) + 1);
            if (index < workflowDisplaySteps.value.length - 1) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.i, __VLS_intrinsics.i)({});
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-step-body" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-step-body']} */ ;
            if (stepGenerationReason(step)) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: (['workflow-step-reason', { missing: stepGenerationStatus(step) === 'missing', verified: stepGenerationStatus(step) === 'verified' }]) },
                    role: "note",
                });
                /** @type {__VLS_StyleScopedClasses['missing']} */ ;
                /** @type {__VLS_StyleScopedClasses['verified']} */ ;
                /** @type {__VLS_StyleScopedClasses['workflow-step-reason']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (stepGenerationReason(step));
                if (stepGenerationStatus(step) === 'missing') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                    (stepGenerationStatusLabel(step));
                }
            }
            if (selectedStepIndex.value !== workflowStepIndex(step)) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "workflow-step-summary" },
                });
                /** @type {__VLS_StyleScopedClasses['workflow-step-summary']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (step.type === 'knowledge' ? `${formatLabel(stepConfigValue(step, 'topic') || 'Knowledge topic')} · ${formatLabel(stepConfigValue(step, 'allowedFacts') || 'Verified business knowledge')}` : step.question || step.fieldKey || (step.type === 'condition' ? 'Add a condition' : step.type === 'lookup' ? 'Find availability with a provider' : 'Select step actions to configure this step'));
                if (stepConditionText(step)) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-summary-tag" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-summary-tag']} */ ;
                }
                if (isConditionalStep(step)) {
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
                if (step.type === 'capture') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-capture-config" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-capture-config']} */ ;
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
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (handleStepTypeChange(step));
                                // @ts-ignore
                                [workflowDisplaySteps, selectedStepIndex, selectedStepIndex,];
                            } },
                        value: (step.type),
                    });
                    const __VLS_80 = __VLS_tryAsConstant((__VLS_unwrap(stepTypeGroups, {})));
                    for (const [group] of __VLS_vFor(__VLS_nonNull(__VLS_80))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.optgroup, __VLS_intrinsics.optgroup)({
                            key: (group.label),
                            label: (group.label),
                        });
                        const __VLS_81 = __VLS_tryAsConstant((group.options));
                        for (const [type] of __VLS_vFor(__VLS_nonNull(__VLS_81))) {
                            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                                key: (type.value),
                                value: (type.value),
                            });
                            (type.label);
                            // @ts-ignore
                            [stepTypeGroups,];
                        }
                        // @ts-ignore
                        [];
                    }
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-field-picker" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-field-picker']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (selectCaptureField(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (step.fieldKey ?? ''),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "",
                    });
                    const __VLS_82 = __VLS_tryAsConstant((workflowDraft.value.fields ?? []));
                    for (const [field] of __VLS_vFor(__VLS_nonNull(__VLS_82))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            key: (field.key),
                            value: (field.key),
                        });
                        (field.label || field.key);
                        // @ts-ignore
                        [workflowDraft,];
                    }
                    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                        ...{ onClick: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (openCustomFieldEditor(step));
                                // @ts-ignore
                                [];
                            } },
                        ...{ class: "text-button workflow-create-field-button" },
                        type: "button",
                    });
                    /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
                    /** @type {__VLS_StyleScopedClasses['workflow-create-field-button']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onInput: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (updateCaptureQuestion(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (step.question ?? ''),
                        type: "text",
                        placeholder: "What should the visitor answer?",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (setCaptureAnswerType(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (captureAnswerType(step)),
                    });
                    const __VLS_83 = __VLS_tryAsConstant((__VLS_unwrap(answerTypes, {})));
                    for (const [type] of __VLS_vFor(__VLS_nonNull(__VLS_83))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            key: (type.value),
                            value: (type.value),
                        });
                        (type.label);
                        // @ts-ignore
                        [answerTypes,];
                    }
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
                        ...{ class: "toggle-row" },
                    });
                    /** @type {__VLS_StyleScopedClasses['toggle-row']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'capture'))
                                    throw 0;
                                return (updateCaptureRequired(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        checked: (step.required !== false),
                        type: "checkbox",
                    });
                    if (customFieldOpenFor.value === step.id) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                            ...{ class: "workflow-custom-field-box" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-custom-field-box']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                            ...{ class: "eyebrow" },
                        });
                        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                            ...{ class: "workflow-step-grid" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                            value: (customFieldLabel.value),
                            type: "text",
                            placeholder: "Usage type",
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                            value: (__VLS_unwrap(customFieldKey, {})),
                            type: "text",
                            placeholder: "usage_type",
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                            ...{ class: "workflow-custom-field-actions" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-custom-field-actions']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                            ...{ onClick: (closeCustomFieldEditor) },
                            ...{ class: "text-button" },
                            type: "button",
                        });
                        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                            ...{ onClick: (...[$event]) => {
                                    void $event;
                                    if (!(workflowDraft.value))
                                        throw 0;
                                    if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                        throw 0;
                                    if (!(step.type === 'capture'))
                                        throw 0;
                                    if (!(customFieldOpenFor.value === step.id))
                                        throw 0;
                                    return (createCustomField(step));
                                    // @ts-ignore
                                    [customFieldOpenFor, customFieldLabel, customFieldKey,];
                                } },
                            ...{ class: "primary-button small" },
                            type: "button",
                            disabled: (!customFieldLabel.value.trim()),
                        });
                        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
                        /** @type {__VLS_StyleScopedClasses['small']} */ ;
                    }
                    if (captureAnswerUsesOptions(step)) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                            ...{ class: "workflow-options-editor" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-options-editor']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                            ...{ class: "workflow-options-heading" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-options-heading']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                        (captureAnswerTypeLabel(step) === 'Multi-select' ? 'Visitors can choose more than one.' : 'Visitors choose one.');
                        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                            ...{ onClick: (...[$event]) => {
                                    void $event;
                                    if (!(workflowDraft.value))
                                        throw 0;
                                    if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                        throw 0;
                                    if (!(step.type === 'capture'))
                                        throw 0;
                                    if (!(captureAnswerUsesOptions(step)))
                                        throw 0;
                                    return (addCaptureOption(step));
                                    // @ts-ignore
                                    [customFieldLabel,];
                                } },
                            ...{ class: "text-button" },
                            type: "button",
                        });
                        /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
                        if (captureOptions(step).length) {
                            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                                ...{ class: "workflow-option-list" },
                            });
                            /** @type {__VLS_StyleScopedClasses['workflow-option-list']} */ ;
                            const __VLS_84 = __VLS_tryAsConstant((captureOptions(step)));
                            for (const [option, optionIndex] of __VLS_vFor(__VLS_nonNull(__VLS_84))) {
                                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                                    key: (`${step.id}-option-${optionIndex}`),
                                    ...{ class: "workflow-option-row" },
                                });
                                /** @type {__VLS_StyleScopedClasses['workflow-option-row']} */ ;
                                __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                                    ...{ onInput: (...[$event]) => {
                                            void $event;
                                            if (!(workflowDraft.value))
                                                throw 0;
                                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                                throw 0;
                                            if (!(step.type === 'capture'))
                                                throw 0;
                                            if (!(captureAnswerUsesOptions(step)))
                                                throw 0;
                                            if (!(captureOptions(step).length))
                                                throw 0;
                                            return (setCaptureOption(step, optionIndex, $event));
                                            // @ts-ignore
                                            [];
                                        } },
                                    value: (option),
                                    type: "text",
                                    placeholder: "Option",
                                });
                                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                                    ...{ onClick: (...[$event]) => {
                                            void $event;
                                            if (!(workflowDraft.value))
                                                throw 0;
                                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                                throw 0;
                                            if (!(step.type === 'capture'))
                                                throw 0;
                                            if (!(captureAnswerUsesOptions(step)))
                                                throw 0;
                                            if (!(captureOptions(step).length))
                                                throw 0;
                                            return (removeCaptureOption(step, optionIndex));
                                            // @ts-ignore
                                            [];
                                        } },
                                    type: "button",
                                    'aria-label': "Remove option",
                                });
                                let __VLS_85;
                                /** @ts-ignore @type { | typeof X} */
                                X;
                                // @ts-ignore
                                const __VLS_86 = __VLS_asFunctionalComponent1(__VLS_85, new __VLS_85({
                                    // @ts-ignore
                                    size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
                                }));
                                const __VLS_87 = __VLS_86({
                                    size: (14),
                                    strokeWidth: (1.8),
                                    'aria-hidden': "true",
                                }, ...__VLS_functionalComponentArgsRest(__VLS_86));
                                // @ts-ignore
                                [];
                            }
                        }
                        else {
                            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                                ...{ class: "form-help" },
                            });
                            /** @type {__VLS_StyleScopedClasses['form-help']} */ ;
                        }
                    }
                }
                else {
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
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!!(step.type === 'capture'))
                                    throw 0;
                                return (handleStepTypeChange(step));
                                // @ts-ignore
                                [];
                            } },
                        value: (step.type),
                    });
                    const __VLS_90 = __VLS_tryAsConstant((__VLS_unwrap(stepTypeGroups, {})));
                    for (const [group] of __VLS_vFor(__VLS_nonNull(__VLS_90))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.optgroup, __VLS_intrinsics.optgroup)({
                            key: (group.label),
                            label: (group.label),
                        });
                        const __VLS_91 = __VLS_tryAsConstant((group.options));
                        for (const [type] of __VLS_vFor(__VLS_nonNull(__VLS_91))) {
                            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                                key: (type.value),
                                value: (type.value),
                            });
                            (type.label);
                            // @ts-ignore
                            [stepTypeGroups,];
                        }
                        // @ts-ignore
                        [];
                    }
                    if (step.type === 'ask' || step.type === 'form') {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                            ...{ onChange: (markDirty) },
                            value: (step.fieldKey),
                        });
                        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                            value: "",
                        });
                        const __VLS_92 = __VLS_tryAsConstant((workflowDraft.value.fields ?? []));
                        for (const [field] of __VLS_vFor(__VLS_nonNull(__VLS_92))) {
                            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                                key: (field.key),
                                value: (field.key),
                            });
                            (field.label || field.key);
                            // @ts-ignore
                            [workflowDraft,];
                        }
                    }
                    if (step.type === 'ask' || step.type === 'form' || step.type === 'recommend' || step.type === 'confirm') {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                            ...{ onInput: (markDirty) },
                            value: (step.question),
                            type: "text",
                            placeholder: "What should the assistant ask?",
                        });
                    }
                    if (step.type === 'ask' || step.type === 'form') {
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
                }
                if (step.type === 'knowledge') {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-knowledge-box" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-box']} */ ;
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
                    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "status-pill booked" },
                    });
                    /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
                    /** @type {__VLS_StyleScopedClasses['booked']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-step-grid" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-step-grid']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onInput: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'topic', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'topic')),
                        type: "text",
                        placeholder: "Pricing",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'knowledgeSource', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'knowledgeSource')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "verified_business_knowledge",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'allowedFacts', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'allowedFacts')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "pricing",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "policies",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "services",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "locations",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "all",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'verifiedBehavior', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'verifiedBehavior')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "answer_naturally",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'unavailableBehavior', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'unavailableBehavior')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "say_not_verified",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'resumeBehavior', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'resumeBehavior')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "return_to_previous_step",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                        ...{ onChange: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (setStepConfigFromEvent(step, 'ctaBehavior', $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConfigValue(step, 'ctaBehavior')),
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                        value: "keep_current_if_available",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-knowledge-preview" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-knowledge-preview-heading" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-heading']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                        ...{ class: "eyebrow" },
                    });
                    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        ...{ class: "workflow-preview-badge" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-preview-badge']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-knowledge-preview-input" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-input']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                        ...{ onKeydown: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (runKnowledgePreview(step));
                                // @ts-ignore
                                [];
                            } },
                        value: (knowledgePreviewQuestion.value),
                        type: "text",
                        placeholder: "How much does it cost?",
                    });
                    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                        ...{ onClick: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'knowledge'))
                                    throw 0;
                                return (runKnowledgePreview(step));
                                // @ts-ignore
                                [knowledgePreviewQuestion,];
                            } },
                        ...{ class: "outline-button small" },
                        type: "button",
                        disabled: (!knowledgePreviewQuestion.value.trim()),
                    });
                    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
                    /** @type {__VLS_StyleScopedClasses['small']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                        ...{ class: "workflow-knowledge-examples" },
                    });
                    /** @type {__VLS_StyleScopedClasses['workflow-knowledge-examples']} */ ;
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                    const __VLS_93 = __VLS_tryAsConstant((knowledgePreviewExamples(step)));
                    for (const [example] of __VLS_vFor(__VLS_nonNull(__VLS_93))) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                            ...{ onClick: (...[$event]) => {
                                    void $event;
                                    if (!(workflowDraft.value))
                                        throw 0;
                                    if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                        throw 0;
                                    if (!(step.type === 'knowledge'))
                                        throw 0;
                                    return (runKnowledgePreview(step, example));
                                    // @ts-ignore
                                    [knowledgePreviewQuestion,];
                                } },
                            key: (example),
                            type: "button",
                        });
                        (example);
                        // @ts-ignore
                        [];
                    }
                    if (knowledgePreviewStepId.value === step.id && knowledgePreviewResult.value) {
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dl, __VLS_intrinsics.dl)({
                            ...{ class: "workflow-knowledge-preview-result" },
                        });
                        /** @type {__VLS_StyleScopedClasses['workflow-knowledge-preview-result']} */ ;
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
                        (knowledgePreviewResult.value.matchedTopic);
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
                        (knowledgePreviewResult.value.evidence);
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
                        (knowledgePreviewResult.value.responseBehavior);
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
                        (knowledgePreviewResult.value.resumeBehavior);
                        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
                        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({});
                        (knowledgePreviewResult.value.ctaRetained);
                    }
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
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'select' || step.type === 'recommend'))
                                    throw 0;
                                return (setStepOptions(step, $event));
                                // @ts-ignore
                                [knowledgePreviewStepId, knowledgePreviewResult, knowledgePreviewResult, knowledgePreviewResult, knowledgePreviewResult, knowledgePreviewResult, knowledgePreviewResult,];
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
                    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                        ...{ onInput: (...[$event]) => {
                                void $event;
                                if (!(workflowDraft.value))
                                    throw 0;
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                    throw 0;
                                if (!(step.type === 'condition'))
                                    throw 0;
                                return (updateStepCondition(step, $event));
                                // @ts-ignore
                                [];
                            } },
                        value: (stepConditionText(step)),
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
                                if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
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
                                    if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
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
                                    if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
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
                    open: (stepAdvancedOpen.value),
                });
                /** @type {__VLS_StyleScopedClasses['workflow-advanced-settings']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.summary, __VLS_intrinsics.summary)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                throw 0;
                            return (stepAdvancedOpen.value = !stepAdvancedOpen.value);
                            // @ts-ignore
                            [stepAdvancedOpen, stepAdvancedOpen, stepAdvancedOpen,];
                        } },
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (stepAdvancedOpen.value ? 'Hide' : 'Show');
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
                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                throw 0;
                            return (setStepConfigFromEvent(step, 'failureBehavior', $event));
                            // @ts-ignore
                            [stepAdvancedOpen,];
                        } },
                    value: (stepConfigValue(step, 'failureBehavior') || 'agent_default'),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "agent_default",
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
                const __VLS_99 = __VLS_tryAsConstant((draftSteps.value.filter((candidate) => candidate.id !== step.id)));
                for (const [nextStep] of __VLS_vFor(__VLS_nonNull(__VLS_99))) {
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
                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                throw 0;
                            return (moveWorkflowStep(workflowStepIndex(step), -1));
                            // @ts-ignore
                            [];
                        } },
                    type: "button",
                    disabled: (workflowStepIndex(step) === 0),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                throw 0;
                            return (moveWorkflowStep(workflowStepIndex(step), 1));
                            // @ts-ignore
                            [];
                        } },
                    type: "button",
                    disabled: (workflowStepIndex(step) === draftSteps.value.length - 1),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!!(selectedStepIndex.value !== workflowStepIndex(step)))
                                throw 0;
                            return (requestDeleteWorkflowStep(workflowStepIndex(step)));
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
            let __VLS_100;
            /** @ts-ignore @type { | typeof Sparkles} */
            Sparkles;
            // @ts-ignore
            const __VLS_101 = __VLS_asFunctionalComponent1(__VLS_100, new __VLS_100({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_102 = __VLS_101({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_101));
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
            let __VLS_105;
            /** @ts-ignore @type { | typeof Plus} */
            Plus;
            // @ts-ignore
            const __VLS_106 = __VLS_asFunctionalComponent1(__VLS_105, new __VLS_105({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_107 = __VLS_106({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_106));
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-advanced-card" },
            'aria-labelledby': "workflow-advanced-heading",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-advanced-card']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(workflowDraft.value))
                        throw 0;
                    return (workflowAdvancedOpen.value = !workflowAdvancedOpen.value);
                    // @ts-ignore
                    [workflowAdvancedOpen, workflowAdvancedOpen,];
                } },
            ...{ class: "workflow-advanced-toggle" },
            type: "button",
            'aria-expanded': (workflowAdvancedOpen.value),
        });
        /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({
            id: "workflow-advanced-heading",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (__VLS_unwrap(providerSummary, {}));
        (__VLS_unwrap(completionSummary, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "workflow-advanced-toggle-action" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-advanced-toggle-action']} */ ;
        (workflowAdvancedOpen.value ? 'Hide' : 'Show');
        let __VLS_110;
        /** @ts-ignore @type { | typeof ChevronDown} */
        ChevronDown;
        // @ts-ignore
        const __VLS_111 = __VLS_asFunctionalComponent1(__VLS_110, new __VLS_110({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_112 = __VLS_111({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_111));
        if (workflowAdvancedOpen.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-content" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-content']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(providerSummary, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (providerStep.value ? 'Used for live availability or external actions.' : 'Optional for a workflow that only asks questions and routes visitors.');
            if (!providerStep.value) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (configureProvider) },
                    ...{ class: "outline-button small" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
                /** @type {__VLS_StyleScopedClasses['small']} */ ;
            }
            else {
                __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                    ...{ onClick: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!(workflowAdvancedOpen.value))
                                throw 0;
                            if (!!(!providerStep.value))
                                throw 0;
                            return (selectedStepIndex.value = draftSteps.value.findIndex((step) => step.id === providerStep.value?.id));
                            // @ts-ignore
                            [selectedStepIndex, draftSteps, workflowAdvancedOpen, workflowAdvancedOpen, workflowAdvancedOpen, providerSummary, providerSummary, completionSummary, providerStep, providerStep, providerStep,];
                        } },
                    ...{ class: "text-button" },
                    type: "button",
                });
                /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(workflowDraft.value))
                            throw 0;
                        if (!(workflowAdvancedOpen.value))
                            throw 0;
                        return (__VLS_unwrap(emit, {})('open-agent-behavior'));
                        // @ts-ignore
                        [emit,];
                    } },
                ...{ class: "text-button workflow-fallback-link" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-fallback-link']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (workflowFallbackCustomized.value ? formatLabel(__VLS_unwrap(providerFailureBehavior, {})) : __VLS_unwrap(agentFallbackLabel, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (workflowFallbackCustomized.value ? 'Workflow-specific override' : 'Inherited from Agent Behavior');
            if (providerStep.value) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                    ...{ onChange: (...[$event]) => {
                            void $event;
                            if (!(workflowDraft.value))
                                throw 0;
                            if (!(workflowAdvancedOpen.value))
                                throw 0;
                            if (!(providerStep.value))
                                throw 0;
                            return (setStepConfigFromEvent(providerStep.value, 'failureBehavior', $event));
                            // @ts-ignore
                            [providerStep, providerStep, workflowFallbackCustomized, workflowFallbackCustomized, providerFailureBehavior, agentFallbackLabel,];
                        } },
                    value: (__VLS_unwrap(providerFailureBehavior, {})),
                    'aria-label': "Workflow fallback behavior",
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    value: "agent_default",
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
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(agentToneLabel, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (props.agentPrimaryLanguage || 'English');
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(agentCitationLabel, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(agentHandoffLabel, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row workflow-defaults-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            /** @type {__VLS_StyleScopedClasses['workflow-defaults-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(agentProactiveLabel, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-inherited-badge" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inherited-badge']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-advanced-row" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "workflow-advanced-label" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-advanced-label']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_unwrap(completionSummary, {}));
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (openAction) },
                ...{ class: "text-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
        }
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
        let __VLS_115;
        /** @ts-ignore @type { | typeof X} */
        X;
        // @ts-ignore
        const __VLS_116 = __VLS_asFunctionalComponent1(__VLS_115, new __VLS_115({
            // @ts-ignore
            size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_117 = __VLS_116({
            size: (15),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_116));
    }
    if (__VLS_unwrap(deleteStepIndex, {}) >= 0 && draftSteps.value[__VLS_unwrap(deleteStepIndex, {})]) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (cancelDeleteWorkflowStep) },
            ...{ class: "workflow-modal-backdrop" },
            role: "presentation",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-backdrop']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-confirm-modal" },
            role: "dialog",
            'aria-modal': "true",
            'aria-labelledby': "delete-step-title",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-confirm-modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (cancelDeleteWorkflowStep) },
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
            id: "delete-step-title",
        });
        (draftSteps.value[__VLS_unwrap(deleteStepIndex, {})].label || stepTypeLabel(draftSteps.value[__VLS_unwrap(deleteStepIndex, {})].type));
        if (deleteStepDependents.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "workflow-confirm-warning" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-confirm-warning']} */ ;
            (deleteStepDependents.value.length === 1 ? 'A later step depends on this answer.' : 'Later steps depend on this answer.');
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "workflow-confirm-warning" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-confirm-warning']} */ ;
        }
        if (deleteStepDependents.value.length) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-dependent-list" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-dependent-list']} */ ;
            const __VLS_120 = __VLS_tryAsConstant((deleteStepDependents.value));
            for (const [dependent] of __VLS_vFor(__VLS_nonNull(__VLS_120))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    key: (`${dependent.label}-${dependent.reason}`),
                });
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                (dependent.label);
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (dependent.reason);
                // @ts-ignore
                [workflowDraft, workflowDraft, draftSteps, draftSteps, draftSteps, completionSummary, providerFailureBehavior, agentToneLabel, agentCitationLabel, agentHandoffLabel, agentProactiveLabel, workflowSaveError, workflowSaveError, workflowSaveMessage, workflowSaveMessage, deleteStepIndex, deleteStepIndex, deleteStepIndex, deleteStepIndex, deleteStepDependents, deleteStepDependents, deleteStepDependents, deleteStepDependents,];
            }
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "workflow-confirm-note" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-confirm-note']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-modal-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (cancelDeleteWorkflowStep) },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (confirmDeleteWorkflowStep) },
            ...{ class: "primary-button small danger-button" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        /** @type {__VLS_StyleScopedClasses['danger-button']} */ ;
        (deleteStepDependents.value.length ? 'Remove both' : 'Remove step');
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
                    [deleteStepDependents, createWorkflowOpen,];
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
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "optional" },
        });
        /** @type {__VLS_StyleScopedClasses['optional']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            value: (createWorkflowName.value),
            type: "text",
            maxlength: "160",
            placeholder: "Lead qualification",
        });
        if (duplicateCreateWorkflow.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "workflow-name-warning" },
                role: "alert",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-name-warning']} */ ;
        }
        if (createWorkflowMode.value === 'action' || createWorkflowMode.value === 'template') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "optional" },
            });
            /** @type {__VLS_StyleScopedClasses['optional']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                ...{ onChange: (...[$event]) => {
                        void $event;
                        if (!(createWorkflowOpen.value))
                            throw 0;
                        if (!(createWorkflowMode.value === 'action' || createWorkflowMode.value === 'template'))
                            throw 0;
                        return (updateCreateWorkflowNameSuggestion());
                        // @ts-ignore
                        [createWorkflowMode, createWorkflowMode, createWorkflowMode, createWorkflowName, duplicateCreateWorkflow,];
                    } },
                value: (createWorkflowActionId.value),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "",
                disabled: true,
            });
            const __VLS_121 = __VLS_tryAsConstant((eligibleActions.value));
            for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_121))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    key: (action.id),
                    value: (action.id),
                });
                (action.name);
                (actionPickerStatus(action));
                // @ts-ignore
                [createWorkflowActionId, eligibleActions,];
            }
        }
        if (selectedActionSetupWarning.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-action-setup-warning" },
                role: "alert",
            });
            /** @type {__VLS_StyleScopedClasses['workflow-action-setup-warning']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedActionSetupWarning.value.title);
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            (selectedActionSetupWarning.value.message);
        }
        if (createWorkflowMode.value === 'describe') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-inference-preview" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inference-preview']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "eyebrow" },
            });
            /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "workflow-inference-list" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-inference-list']} */ ;
            if (plainEnglishInference.value.contactFields) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            }
            if (plainEnglishInference.value.leadCapture) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            }
            if (plainEnglishInference.value.demoAction) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            }
            if (plainEnglishInference.value.demoAction) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (selectedCreateWorkflowAction.value?.name || 'Choose a conversion action');
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
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
        let __VLS_122;
        /** @ts-ignore @type { | typeof Plus} */
        Plus;
        // @ts-ignore
        const __VLS_123 = __VLS_asFunctionalComponent1(__VLS_122, new __VLS_122({
            // @ts-ignore
            size: (15), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_124 = __VLS_123({
            size: (15),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_123));
        if (createWorkflowMode.value === 'template') {
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                ...{ onChange: (updateCreateWorkflowTemplate) },
                value: (__VLS_unwrap(createWorkflowTemplateKey, {})),
            });
            const __VLS_127 = __VLS_tryAsConstant((__VLS_unwrap(workflowTemplates, {})));
            for (const [template] of __VLS_vFor(__VLS_nonNull(__VLS_127))) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                    key: (template.key),
                    value: (template.key),
                });
                (template.label);
                // @ts-ignore
                [workflowTemplates, createWorkflowMode, createWorkflowMode, eligibleActions, selectedActionSetupWarning, selectedActionSetupWarning, selectedActionSetupWarning, plainEnglishInference, plainEnglishInference, plainEnglishInference, plainEnglishInference, selectedCreateWorkflowAction, createWorkflowTemplateKey,];
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
                placeholder: "Describe the customer journey this workflow should complete…",
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
                disabled: (createWorkflowLoading.value || !createWorkflowActionId.value || !createWorkflowName.value.trim() || Boolean(duplicateCreateWorkflow.value)),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            (createWorkflowLoading.value ? 'Creating…' : 'Create workflow');
        }
    }
    if (deleteWorkflowOpen.value && workflowDraft.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (cancelDeleteWorkflow) },
            ...{ class: "workflow-modal-backdrop" },
            role: "presentation",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-backdrop']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "workflow-confirm-modal workflow-delete-modal" },
            role: "dialog",
            'aria-modal': "true",
            'aria-labelledby': "delete-workflow-title",
        });
        /** @type {__VLS_StyleScopedClasses['workflow-confirm-modal']} */ ;
        /** @type {__VLS_StyleScopedClasses['workflow-delete-modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (cancelDeleteWorkflow) },
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
            id: "delete-workflow-title",
        });
        (__VLS_unwrap(workflowTitle, {}));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-delete-warning" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-delete-warning']} */ ;
        let __VLS_128;
        /** @ts-ignore @type { | typeof Trash2} */
        Trash2;
        // @ts-ignore
        const __VLS_129 = __VLS_asFunctionalComponent1(__VLS_128, new __VLS_128({
            // @ts-ignore
            size: (18), strokeWidth: (1.9), 'aria-hidden': "true",
        }));
        const __VLS_130 = __VLS_129({
            size: (18),
            strokeWidth: (1.9),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_129));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        if (selectedWorkflowIsLive.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "workflow-confirm-warning" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-confirm-warning']} */ ;
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "workflow-confirm-warning" },
            });
            /** @type {__VLS_StyleScopedClasses['workflow-confirm-warning']} */ ;
            (draftIsDirty.value ? 'You have unsaved changes that will be discarded.' : 'This action cannot be undone from Workflows.');
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "workflow-confirm-note" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-confirm-note']} */ ;
        if (deleteWorkflowError.value) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "form-error" },
                role: "alert",
            });
            /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
            (deleteWorkflowError.value);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "workflow-modal-actions" },
        });
        /** @type {__VLS_StyleScopedClasses['workflow-modal-actions']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (cancelDeleteWorkflow) },
            ...{ class: "outline-button small" },
            type: "button",
            disabled: (deleteWorkflowLoading.value),
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (confirmDeleteWorkflow) },
            ...{ class: "primary-button small danger-button" },
            type: "button",
            disabled: (deleteWorkflowLoading.value),
        });
        /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
        /** @type {__VLS_StyleScopedClasses['danger-button']} */ ;
        (deleteWorkflowLoading.value ? 'Deleting…' : 'Delete workflow');
    }
    // @ts-ignore
    [workflowTitle, draftIsDirty, workflowDraft, createWorkflowName, duplicateCreateWorkflow, createWorkflowActionId, createWorkflowDescription, createWorkflowDescription, createNewActionOpen, createNewActionOpen, createNewActionName, createNewActionName, createNewActionDescription, createWorkflowLoading, createWorkflowLoading, createWorkflowLoading, createWorkflowLoading, createWorkflowError, createWorkflowError, deleteWorkflowOpen, selectedWorkflowIsLive, deleteWorkflowError, deleteWorkflowError, deleteWorkflowLoading, deleteWorkflowLoading, deleteWorkflowLoading,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
