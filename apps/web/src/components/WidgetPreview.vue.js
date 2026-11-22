import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { createWidgetRenderer, } from "../widget-ui/renderer";
const { defineProps, defineEmits, withDefaults, } = {};
const props = withDefaults(defineProps(), {
    widgetTheme: "auto",
    widgetPosition: "bottom-right",
    widgetDefaultMode: "compact",
    widgetAllowExpand: true,
    widgetLogoUrl: "",
    proactiveEnabled: false,
    proactiveMessage: "Looking for the right service? I can help.",
    proactiveBehavior: "teaser",
    showLeadCapture: true,
    requireLeadConsent: false,
    privacyNoticeUrl: "",
    showAiDisclosure: true,
    citationVisibility: "always",
    tone: "friendly",
    fallbackBehavior: "contact_form",
    humanHandoffEnabled: true,
    showScenarioSelector: true,
    scenario: "conversation",
    mode: "desktop",
});
const emit = defineEmits();
const previewMount = ref(null);
const previewMode = ref(props.mode);
const scenario = ref(props.scenario);
const handoffNoticeDismissed = ref(false);
const proactiveDismissed = ref(false);
let renderer = null;
let handoffNoticeTimer = null;
const scenarioOptions = [
    { label: "Default", value: "default" },
    { label: "Conversation", value: "conversation" },
    { label: "Quick actions", value: "quick-actions" },
    { label: "Lead form", value: "lead-form" },
    { label: "Human handoff", value: "human-handoff" },
    { label: "Staff joined", value: "staff-joined" },
    { label: "Safe fallback", value: "safe-fallback" },
    { label: "Source citation", value: "source-citation" },
    { label: "Completion action", value: "completion-action" },
];
const previewWebsiteUrl = computed(() => {
    const rawUrl = props.websiteUrl.trim();
    if (!rawUrl)
        return "";
    try {
        const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
        return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
    }
    catch {
        return "";
    }
});
const websitePreviewState = ref("empty");
const websitePreviewErrorReason = ref(null);
let previewTimeout = null;
let previewProbeVersion = 0;
function clearPreviewTimeout() {
    if (previewTimeout !== null) {
        window.clearTimeout(previewTimeout);
        previewTimeout = null;
    }
}
function clearHandoffNoticeTimer() {
    if (handoffNoticeTimer !== null) {
        window.clearTimeout(handoffNoticeTimer);
        handoffNoticeTimer = null;
    }
}
function armHandoffNoticeTimer() {
    clearHandoffNoticeTimer();
    if (scenario.value !== "human-handoff")
        return;
    handoffNoticeTimer = window.setTimeout(() => {
        handoffNoticeTimer = null;
        handoffNoticeDismissed.value = true;
        syncRenderer();
    }, 6000);
}
function resetWebsitePreview(url) {
    clearPreviewTimeout();
    websitePreviewErrorReason.value = null;
    websitePreviewState.value = url ? "loading" : "empty";
    if (url) {
        previewTimeout = window.setTimeout(() => {
            if (websitePreviewState.value === "loading")
                websitePreviewState.value = "error";
        }, 8000);
    }
}
async function checkWebsitePreview(url) {
    const version = ++previewProbeVersion;
    clearPreviewTimeout();
    websitePreviewErrorReason.value = null;
    websitePreviewState.value = url ? "loading" : "empty";
    if (!url)
        return;
    const endpoint = props.websitePreviewEndpoint?.trim();
    if (!endpoint) {
        resetWebsitePreview(url);
        return;
    }
    try {
        const response = await fetch(endpoint, {
            headers: props.websitePreviewToken?.trim() ? { authorization: `Bearer ${props.websitePreviewToken.trim()}` } : {},
            credentials: "same-origin",
        });
        if (version !== previewProbeVersion)
            return;
        if (response.ok) {
            const payload = await response.json();
            if (payload.embeddable === false) {
                websitePreviewErrorReason.value = payload.reason === "security_policy" ? "security_policy" : "unavailable";
                websitePreviewState.value = "error";
                return;
            }
        }
    }
    catch {
        // If the probe is unavailable, retain the direct iframe attempt. The
        // timeout/error state below still gives the owner a useful fallback.
    }
    if (version !== previewProbeVersion)
        return;
    websitePreviewState.value = "loading";
    previewTimeout = window.setTimeout(() => {
        if (websitePreviewState.value === "loading") {
            websitePreviewErrorReason.value = "unavailable";
            websitePreviewState.value = "error";
        }
    }, 8000);
}
function markWebsitePreviewReady() {
    clearPreviewTimeout();
    websitePreviewErrorReason.value = null;
    websitePreviewState.value = "ready";
}
function markWebsitePreviewError() {
    clearPreviewTimeout();
    websitePreviewErrorReason.value = "unavailable";
    websitePreviewState.value = "error";
}
function sampleMessages(nextScenario) {
    const assistantName = (props.assistantName || "AI front desk")
        .replace(/\s+AI Assistant$/i, "")
        .replace(/\s+Assistant$/i, "")
        .trim() || "AI front desk";
    const businessName = props.businessName || "Your business";
    const welcome = { id: "preview-welcome", role: "assistant", content: props.welcomeMessage || `Hi! I'm the ${assistantName} assistant. I can answer questions, help you explore features, or get you started.` };
    const question = { id: "preview-question", role: "user", content: `What services does ${businessName} offer?` };
    const answer = { id: "preview-answer", role: "assistant", content: `${businessName} can answer questions, explain its services, and help visitors take the next step.` };
    const fallback = { id: "preview-fallback", role: "assistant", content: "I don’t have enough verified information to answer that confidently. I can help you contact the team if you’d like." };
    if (nextScenario === "default" || nextScenario === "quick-actions" || nextScenario === "lead-form" || nextScenario === "completion-action")
        return [welcome];
    if (nextScenario === "safe-fallback")
        return [welcome, { id: "preview-fallback-question", role: "user", content: "Can you guarantee a result you do not have in your knowledge?" }, fallback];
    if (nextScenario === "source-citation")
        return [welcome, question, { ...answer, citations: [{ title: `${businessName} services`, url: previewWebsiteUrl.value || "https://example.com" }] }];
    return [welcome, question, answer];
}
const widgetConfig = computed(() => ({
    assistantName: props.assistantName || "AI front desk",
    welcomeMessage: props.welcomeMessage || "Hi! How can I help?",
    widgetColor: props.widgetColor,
    widgetTheme: props.widgetTheme,
    widgetPosition: props.widgetPosition,
    widgetDefaultMode: props.widgetDefaultMode,
    widgetAllowExpand: props.widgetAllowExpand,
    widgetLogoUrl: props.widgetLogoUrl,
    widgetQuickActions: props.quickActions,
    showAiDisclosure: props.showAiDisclosure,
    showPoweredBy: true,
    showSources: true,
    citationVisibility: props.citationVisibility,
    showLeadCapture: props.showLeadCapture,
    requireLeadConsent: props.requireLeadConsent,
    privacyNoticeUrl: props.privacyNoticeUrl || null,
    fallbackBehavior: props.fallbackBehavior,
    humanHandoffEnabled: props.humanHandoffEnabled,
    tone: props.tone,
}));
const widgetState = computed(() => {
    const nextScenario = scenario.value;
    const sampleState = {
        isOpen: true,
        messages: sampleMessages(nextScenario),
        quickActions: nextScenario === "default" || nextScenario === "quick-actions" ? props.quickActions : [],
        leadVisible: nextScenario === "lead-form" || (nextScenario === "safe-fallback" && props.fallbackBehavior === "contact_form"),
        action: nextScenario === "completion-action" ? {
            id: "preview-completion-action",
            status: "active",
            form: {
                submitLabel: "Get started",
                fields: [
                    { key: "name", label: "Name", type: "text", required: true },
                    { key: "email", label: "Email", type: "email", required: true },
                ],
            },
        } : null,
        handoffStatus: nextScenario === "human-handoff" ? "WAITING_FOR_STAFF" : nextScenario === "staff-joined" ? "HUMAN_ACTIVE" : "AI_ACTIVE",
        handoffNotice: nextScenario === "human-handoff" && !handoffNoticeDismissed.value ? { visible: true, message: "You still have a conversation waiting for the team.", choice: true } : { visible: false, message: "" },
        proactive: props.proactiveEnabled && props.proactiveBehavior === "teaser" && nextScenario === "default" && !proactiveDismissed.value ? { visible: true, message: props.proactiveMessage || "Looking for the right service? I can help." } : { visible: false, message: "" },
    };
    if (props.state)
        return { ...sampleState, ...props.state, messages: props.state.messages ?? sampleState.messages, quickActions: props.state.quickActions ?? sampleState.quickActions };
    return sampleState;
});
function syncRenderer() {
    if (!renderer)
        return;
    renderer.update({ config: widgetConfig.value, state: widgetState.value });
}
function selectScenario(nextScenario) {
    scenario.value = nextScenario;
    handoffNoticeDismissed.value = false;
    proactiveDismissed.value = false;
    armHandoffNoticeTimer();
    emit("change-scenario", nextScenario);
    syncRenderer();
}
function handleAsk(question) {
    emit("ask", question);
}
watch([previewWebsiteUrl, () => props.websitePreviewEndpoint, () => props.websitePreviewToken], ([url]) => { void checkWebsitePreview(url); }, { immediate: true });
watch(() => props.mode, (nextMode) => { previewMode.value = nextMode; });
watch(() => props.scenario, (nextScenario) => { if (nextScenario) {
    scenario.value = nextScenario;
    handoffNoticeDismissed.value = false;
    proactiveDismissed.value = false;
    armHandoffNoticeTimer();
} });
watch([widgetConfig, widgetState], syncRenderer, { deep: true });
onMounted(() => {
    armHandoffNoticeTimer();
    if (!previewMount.value)
        return;
    renderer = createWidgetRenderer(previewMount.value, {
        surface: "preview",
        config: widgetConfig.value,
        state: widgetState.value,
        onAsk: handleAsk,
        onActionSubmit: (values, action) => emit("submit-action", { action, values }),
        onHandoffDismiss: () => {
            handoffNoticeDismissed.value = true;
            clearHandoffNoticeTimer();
            syncRenderer();
        },
        onHandoffContinue: () => {
            handoffNoticeDismissed.value = true;
            clearHandoffNoticeTimer();
            syncRenderer();
        },
        onNewConversation: () => {
            selectScenario("conversation");
        },
        onProactiveDismiss: () => {
            proactiveDismissed.value = true;
            syncRenderer();
        },
    });
});
onBeforeUnmount(() => {
    clearPreviewTimeout();
    clearHandoffNoticeTimer();
    renderer?.destroy();
    renderer = null;
});
const __VLS_defaults = {
    widgetTheme: "auto",
    widgetPosition: "bottom-right",
    widgetDefaultMode: "compact",
    widgetAllowExpand: true,
    widgetLogoUrl: "",
    proactiveEnabled: false,
    proactiveMessage: "Looking for the right service? I can help.",
    proactiveBehavior: "teaser",
    showLeadCapture: true,
    requireLeadConsent: false,
    privacyNoticeUrl: "",
    showAiDisclosure: true,
    citationVisibility: "always",
    tone: "friendly",
    fallbackBehavior: "contact_form",
    humanHandoffEnabled: true,
    showScenarioSelector: true,
    scenario: "conversation",
    mode: "desktop",
};
void __VLS_defaults;
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
    __VLS_withDotValue(previewMode, {});
    __VLS_withDotValue(previewWebsiteUrl, {});
    __VLS_withDotValue(websitePreviewState, {});
    __VLS_withDotValue(websitePreviewErrorReason, {});
    void {};
    /** @type {__VLS_StyleScopedClasses['agent-preview-toolbar']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-scenario']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-mode-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-mode-toggle']} */ ;
    /** @type {__VLS_StyleScopedClasses['customer-preview']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-bar']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-mobile']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-error']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-error']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-error']} */ ;
    /** @type {__VLS_StyleScopedClasses['agent-preview-toolbar']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-toolbar-controls']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "agent-preview-shell" },
    });
    /** @type {__VLS_StyleScopedClasses['agent-preview-shell']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "agent-preview-toolbar" },
    });
    /** @type {__VLS_StyleScopedClasses['agent-preview-toolbar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "ds-section-kicker" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-section-kicker']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-toolbar-controls" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-toolbar-controls']} */ ;
    if (__VLS_ctx.showScenarioSelector) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
            ...{ class: "preview-scenario" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-scenario']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
            ...{ onChange: (...[$event]) => {
                    void $event;
                    if (!(__VLS_ctx.showScenarioSelector))
                        throw 0;
                    return (selectScenario($event.target.value));
                    // @ts-ignore
                    [showScenarioSelector,];
                } },
            value: (__VLS_unwrap(scenario, {})),
            'aria-label': "Preview scenario",
        });
        const __VLS_0 = __VLS_tryAsConstant((__VLS_unwrap(scenarioOptions, {})));
        for (const [option] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                key: (option.value),
                value: (option.value),
            });
            (option.label);
            // @ts-ignore
            [scenario, scenarioOptions,];
        }
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-mode-toggle" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-mode-toggle']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('change-mode', 'desktop'));
                // @ts-ignore
                [emit,];
            } },
        type: "button",
        ...{ class: ({ active: previewMode.value === 'desktop' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('change-mode', 'mobile'));
                // @ts-ignore
                [emit, previewMode,];
            } },
        type: "button",
        ...{ class: ({ active: previewMode.value === 'mobile' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        'aria-label': "Widget preview",
        ...{ class: (['customer-preview', `preview-${previewMode.value}`, `theme-${__VLS_ctx.widgetTheme}`, `position-${__VLS_ctx.widgetPosition}`]) },
    });
    /** @type {__VLS_StyleScopedClasses['customer-preview']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-site-bar" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-site-bar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "window-dot red" },
    });
    /** @type {__VLS_StyleScopedClasses['window-dot']} */ ;
    /** @type {__VLS_StyleScopedClasses['red']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "window-dot yellow" },
    });
    /** @type {__VLS_StyleScopedClasses['window-dot']} */ ;
    /** @type {__VLS_StyleScopedClasses['yellow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "window-dot green" },
    });
    /** @type {__VLS_StyleScopedClasses['window-dot']} */ ;
    /** @type {__VLS_StyleScopedClasses['green']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (previewWebsiteUrl.value || __VLS_ctx.websiteUrl || 'yourbusiness.com');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-site-body" },
        ...{ class: ({ 'preview-site-body-fallback': websitePreviewState.value === 'error' || websitePreviewState.value === 'empty' }) },
    });
    /** @type {__VLS_StyleScopedClasses['preview-site-body']} */ ;
    /** @type {__VLS_StyleScopedClasses['preview-site-body-fallback']} */ ;
    if (previewWebsiteUrl.value && websitePreviewState.value !== 'error') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.iframe, __VLS_intrinsics.iframe)({
            ...{ onLoad: (markWebsitePreviewReady) },
            ...{ onError: (markWebsitePreviewError) },
            key: (previewWebsiteUrl.value),
            ...{ class: "preview-website-frame" },
            src: (previewWebsiteUrl.value),
            title: (`Website preview for ${__VLS_ctx.businessName || 'your business'}`),
            loading: "eager",
            referrerpolicy: "strict-origin-when-cross-origin",
        });
        /** @type {__VLS_StyleScopedClasses['preview-website-frame']} */ ;
    }
    if (websitePreviewState.value === 'loading') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "preview-site-state" },
            'aria-live': "polite",
        });
        /** @type {__VLS_StyleScopedClasses['preview-site-state']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "preview-site-state-dot" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-site-state-dot']} */ ;
    }
    else if (websitePreviewState.value === 'error') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "preview-site-error" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-site-error']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "ds-section-kicker" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-section-kicker']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (previewWebsiteUrl.value || __VLS_ctx.websiteUrl);
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (websitePreviewErrorReason.value === 'security_policy' ? 'This website is connected to knowledge, but its security policy does not allow a live embedded preview here.' : 'This website could not be loaded in the live preview right now.');
        __VLS_asFunctionalElement1(__VLS_intrinsics.a, __VLS_intrinsics.a)({
            href: (previewWebsiteUrl.value || __VLS_ctx.websiteUrl),
            target: "_blank",
            rel: "noreferrer",
        });
    }
    else if (websitePreviewState.value === 'empty') {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "preview-site-error" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-site-error']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "ds-section-kicker" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-section-kicker']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (__VLS_ctx.businessName || 'Your business');
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ref: "previewMount",
        ...{ class: "widget-preview-stage" },
    });
    /** @type {__VLS_StyleScopedClasses['widget-preview-stage']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "preview-note" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-note']} */ ;
    // @ts-ignore
    [previewMode, previewMode, widgetTheme, widgetPosition, previewWebsiteUrl, previewWebsiteUrl, previewWebsiteUrl, previewWebsiteUrl, previewWebsiteUrl, previewWebsiteUrl, websiteUrl, websiteUrl, websiteUrl, websitePreviewState, websitePreviewState, websitePreviewState, websitePreviewState, websitePreviewState, websitePreviewState, businessName, businessName, websitePreviewErrorReason,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
