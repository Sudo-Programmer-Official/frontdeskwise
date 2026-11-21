import { computed, reactive, ref, watch } from "vue";
import { ArrowRight, BookOpen, Check, ChevronDown, CircleAlert, CircleCheck, CircleHelp, Headset, MessageCircle, RefreshCw, Search, ShieldCheck, Sparkles, Ticket, Wrench, } from "@lucide/vue";
const { defineProps, defineEmits, withDefaults, } = {};
const props = withDefaults(defineProps(), {
    initialCategory: "general",
    initialProvider: "",
    initialConnectionId: "",
    initialPage: "Support",
    openReportRequest: 0,
});
const emit = defineEmits();
const search = ref("");
const reportOpen = ref(false);
const selectedCase = ref(null);
const assistantQuestion = ref("");
const assistantAnswer = ref("");
const form = reactive({
    subject: "",
    category: props.initialCategory,
    provider: props.initialProvider,
    connectionId: props.initialConnectionId,
    description: "",
    severity: "normal",
});
const articles = [
    { id: "knowledge", title: "How to refresh knowledge", description: "Understand crawl states, failed pages, and when to rebuild the index.", target: "knowledge", icon: BookOpen },
    { id: "integrations", title: "How to connect HubSpot", description: "Connect a CRM, test the connection, and interpret sync failures.", target: "connections", icon: Wrench },
    { id: "widget", title: "Why is my widget offline?", description: "Check verification, installation, publishing, and live widget detection.", target: "install", icon: CircleHelp },
    { id: "actions", title: "When an action delivery fails", description: "Retry a delivery and see the provider error without hunting through logs.", target: "actions", icon: Ticket },
];
const filteredCases = computed(() => {
    const needle = search.value.trim().toLowerCase();
    if (!needle)
        return props.cases;
    return props.cases.filter((item) => [item.subject, item.description, item.category, item.provider, item.correlationId].some((value) => value?.toLowerCase().includes(needle)));
});
const diagnostics = computed(() => props.context?.diagnostics ?? {});
const systemStatus = computed(() => props.context?.systemStatus ?? {});
const diagnosticsRows = computed(() => [
    { label: "Business", value: String(diagnostics.value.business ?? (props.businessName || "—")) },
    { label: "Page", value: String(diagnostics.value.page ?? props.initialPage) },
    { label: "Source", value: String(diagnostics.value.source ?? (props.websiteUrl || "—")) },
    { label: "Last refresh", value: diagnostics.value.lastRefresh ? new Date(String(diagnostics.value.lastRefresh)).toLocaleString() : "Not available" },
    { label: "Crawler status", value: formatLabel(String(diagnostics.value.crawlerStatus ?? "unknown")) },
    { label: "Browser", value: typeof navigator === "undefined" ? "Unknown" : navigator.userAgent },
    { label: "Timestamp", value: new Date().toLocaleString() },
]);
function formatLabel(value) {
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
function statusLabel(status) {
    return status === "in_progress" ? "In progress" : status === "resolved" ? "Resolved" : "Open";
}
function statusClass(status) {
    return status === "resolved" ? "booked" : status === "in_progress" ? "qualified" : "new";
}
function openReport(category = form.category) {
    form.category = category;
    if (!form.subject)
        form.subject = category === "integration" && form.provider ? `${formatLabel(form.provider)} connection needs attention` : `Help with ${formatLabel(category)}`;
    reportOpen.value = true;
}
function submitCase() {
    if (!form.subject.trim() || !form.description.trim())
        return;
    emit("submit-case", {
        subject: form.subject.trim(),
        category: form.category,
        provider: form.provider.trim(),
        connectionId: form.connectionId.trim(),
        description: form.description.trim(),
        severity: form.severity,
        sourcePage: props.initialPage,
        sourceUrl: typeof window === "undefined" ? "" : window.location.href,
        diagnostics: {
            ...diagnostics.value,
            browser: typeof navigator === "undefined" ? null : navigator.userAgent,
            timestamp: new Date().toISOString(),
        },
    });
}
function askAssistant() {
    const question = assistantQuestion.value.trim().toLowerCase();
    if (!question)
        return;
    if (question.includes("widget") || question.includes("live") || question.includes("offline")) {
        assistantAnswer.value = systemStatus.value.widget === "not_detected"
            ? "Your domain is verified, but the widget has not been detected on your website yet. Open installation to check the snippet and run a live check."
            : "Your widget has been detected. If it still looks offline, open installation and run the live check so we can attach the result to a support case.";
        return;
    }
    if (question.includes("hubspot") || question.includes("integration") || question.includes("crm")) {
        assistantAnswer.value = "Open Integrations to test the connection and inspect the last provider response. If it fails again, Report a problem will include the provider and connection context automatically.";
        return;
    }
    if (question.includes("knowledge") || question.includes("refresh") || question.includes("crawl")) {
        assistantAnswer.value = diagnostics.value.crawlerStatus === "render_failed"
            ? "A knowledge source needs attention. Open Knowledge to review the failed source, then refresh it or send us the attached diagnostics."
            : "Open Knowledge to refresh your website sources or review the latest answer gaps.";
        return;
    }
    assistantAnswer.value = "I can help with installation, knowledge, actions, integrations, billing, and verification. Try one of those terms, or report a problem with the current context attached.";
}
function startCase(caseItem) {
    selectedCase.value = selectedCase.value?.id === caseItem.id ? null : caseItem;
}
watch(() => props.openReportRequest, (next, previous) => {
    if (next && next !== previous)
        openReport();
}, { immediate: true });
const __VLS_defaults = {
    initialCategory: "general",
    initialProvider: "",
    initialConnectionId: "",
    initialPage: "Support",
    openReportRequest: 0,
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
    __VLS_withDotValue(systemStatus, {});
    __VLS_withDotValue(assistantAnswer, {});
    __VLS_withDotValue(assistantQuestion, {});
    __VLS_withDotValue(filteredCases, {});
    __VLS_withDotValue(selectedCase, {});
    __VLS_withDotValue(reportOpen, {});
    __VLS_withDotValue(form, {});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "view-content support-workspace" },
    });
    /** @type {__VLS_StyleScopedClasses['view-content']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-workspace']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-hero" },
    });
    /** @type {__VLS_StyleScopedClasses['support-hero']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-hero-actions" },
    });
    /** @type {__VLS_StyleScopedClasses['support-hero-actions']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('refresh'));
                // @ts-ignore
                [emit,];
            } },
        ...{ class: "outline-button small" },
        type: "button",
        disabled: (__VLS_ctx.loading),
    });
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    let __VLS_0;
    /** @ts-ignore @type { | typeof RefreshCw} */
    RefreshCw;
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
        // @ts-ignore
        size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_2 = __VLS_1({
        size: (15),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    (__VLS_ctx.loading ? 'Refreshing…' : 'Refresh status');
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (openReport());
                // @ts-ignore
                [loading, loading,];
            } },
        ...{ class: "primary-button small" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    let __VLS_5;
    /** @ts-ignore @type { | typeof MessageCircle} */
    MessageCircle;
    // @ts-ignore
    const __VLS_6 = __VLS_asFunctionalComponent1(__VLS_5, new __VLS_5({
        // @ts-ignore
        size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_7 = __VLS_6({
        size: (15),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_6));
    if (__VLS_ctx.publicDemoMode) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "support-demo-note" },
        });
        /** @type {__VLS_StyleScopedClasses['support-demo-note']} */ ;
        let __VLS_10;
        /** @ts-ignore @type { | typeof CircleAlert} */
        CircleAlert;
        // @ts-ignore
        const __VLS_11 = __VLS_asFunctionalComponent1(__VLS_10, new __VLS_10({
            // @ts-ignore
            size: (17), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_12 = __VLS_11({
            size: (17),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_11));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-status-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['support-status-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-status-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-status-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-status-icon green" },
    });
    /** @type {__VLS_StyleScopedClasses['support-status-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['green']} */ ;
    let __VLS_15;
    /** @ts-ignore @type { | typeof CircleCheck} */
    CircleCheck;
    // @ts-ignore
    const __VLS_16 = __VLS_asFunctionalComponent1(__VLS_15, new __VLS_15({
        // @ts-ignore
        size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_17 = __VLS_16({
        size: (18),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_16));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (formatLabel(systemStatus.value.api ?? 'checking'));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-status-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-status-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-status-icon blue" },
    });
    /** @type {__VLS_StyleScopedClasses['support-status-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['blue']} */ ;
    let __VLS_20;
    /** @ts-ignore @type { | typeof BookOpen} */
    BookOpen;
    // @ts-ignore
    const __VLS_21 = __VLS_asFunctionalComponent1(__VLS_20, new __VLS_20({
        // @ts-ignore
        size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_22 = __VLS_21({
        size: (18),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_21));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (formatLabel(systemStatus.value.knowledge ?? 'checking'));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-status-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-status-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-status-icon purple" },
    });
    /** @type {__VLS_StyleScopedClasses['support-status-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['purple']} */ ;
    let __VLS_25;
    /** @ts-ignore @type { | typeof Sparkles} */
    Sparkles;
    // @ts-ignore
    const __VLS_26 = __VLS_asFunctionalComponent1(__VLS_25, new __VLS_25({
        // @ts-ignore
        size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_27 = __VLS_26({
        size: (18),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_26));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (formatLabel(systemStatus.value.widget ?? 'checking'));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-status-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-status-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-status-icon orange" },
    });
    /** @type {__VLS_StyleScopedClasses['support-status-icon']} */ ;
    /** @type {__VLS_StyleScopedClasses['orange']} */ ;
    let __VLS_30;
    /** @ts-ignore @type { | typeof ShieldCheck} */
    ShieldCheck;
    // @ts-ignore
    const __VLS_31 = __VLS_asFunctionalComponent1(__VLS_30, new __VLS_30({
        // @ts-ignore
        size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_32 = __VLS_31({
        size: (18),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_31));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.authReady ? 'Signed in' : 'Sign in required');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-grid" },
    });
    /** @type {__VLS_StyleScopedClasses['support-grid']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
        ...{ class: "support-main-column" },
    });
    /** @type {__VLS_StyleScopedClasses['support-main-column']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-ai-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-ai-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-card-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['support-card-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-ai-mark" },
    });
    /** @type {__VLS_StyleScopedClasses['support-ai-mark']} */ ;
    let __VLS_35;
    /** @ts-ignore @type { | typeof Headset} */
    Headset;
    // @ts-ignore
    const __VLS_36 = __VLS_asFunctionalComponent1(__VLS_35, new __VLS_35({
        // @ts-ignore
        size: (20), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_37 = __VLS_36({
        size: (20),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_36));
    __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
        ...{ onSubmit: (askAssistant) },
        ...{ class: "support-ask-form" },
    });
    /** @type {__VLS_StyleScopedClasses['support-ask-form']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "search",
        placeholder: "Why isn't my widget live?",
        'aria-label': "Ask FrontDeskWise",
    });
    (assistantQuestion.value);
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ class: "primary-button small" },
        type: "submit",
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    if (assistantAnswer.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "support-ai-answer" },
        });
        /** @type {__VLS_StyleScopedClasses['support-ai-answer']} */ ;
        let __VLS_40;
        /** @ts-ignore @type { | typeof Sparkles} */
        Sparkles;
        // @ts-ignore
        const __VLS_41 = __VLS_asFunctionalComponent1(__VLS_40, new __VLS_40({
            // @ts-ignore
            size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_42 = __VLS_41({
            size: (16),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_41));
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        (assistantAnswer.value);
        if (assistantQuestion.value.toLowerCase().includes('widget') || assistantQuestion.value.toLowerCase().includes('live')) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(assistantAnswer.value))
                            throw 0;
                        if (!(assistantQuestion.value.toLowerCase().includes('widget') || assistantQuestion.value.toLowerCase().includes('live')))
                            throw 0;
                        return (__VLS_unwrap(emit, {})('navigate', 'install'));
                        // @ts-ignore
                        [emit, publicDemoMode, systemStatus, systemStatus, systemStatus, authReady, assistantQuestion, assistantQuestion, assistantQuestion, assistantAnswer, assistantAnswer,];
                    } },
                ...{ class: "text-button" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['text-button']} */ ;
            let __VLS_45;
            /** @ts-ignore @type { | typeof ArrowRight} */
            ArrowRight;
            // @ts-ignore
            const __VLS_46 = __VLS_asFunctionalComponent1(__VLS_45, new __VLS_45({
                // @ts-ignore
                size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_47 = __VLS_46({
                size: (14),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_46));
        }
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-articles-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-articles-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-card-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['support-card-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_50;
    /** @ts-ignore @type { | typeof BookOpen} */
    BookOpen;
    // @ts-ignore
    const __VLS_51 = __VLS_asFunctionalComponent1(__VLS_50, new __VLS_50({
        // @ts-ignore
        size: (21), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_52 = __VLS_51({
        size: (21),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_51));
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-article-list" },
    });
    /** @type {__VLS_StyleScopedClasses['support-article-list']} */ ;
    const __VLS_55 = __VLS_tryAsConstant((__VLS_unwrap(articles, {})));
    for (const [article] of __VLS_vFor(__VLS_nonNull(__VLS_55))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (__VLS_unwrap(emit, {})('navigate', article.target));
                    // @ts-ignore
                    [emit, articles,];
                } },
            key: (article.id),
            type: "button",
            ...{ class: "support-article" },
        });
        /** @type {__VLS_StyleScopedClasses['support-article']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "support-article-icon" },
        });
        /** @type {__VLS_StyleScopedClasses['support-article-icon']} */ ;
        const __VLS_56 = (article.icon);
        // @ts-ignore
        const __VLS_57 = __VLS_asFunctionalComponent1(__VLS_56, new __VLS_56({
            // @ts-ignore
            size: (17), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_58 = __VLS_57({
            size: (17),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_57));
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        (article.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
        (article.description);
        let __VLS_61;
        /** @ts-ignore @type { | typeof ArrowRight} */
        ArrowRight;
        // @ts-ignore
        const __VLS_62 = __VLS_asFunctionalComponent1(__VLS_61, new __VLS_61({
            // @ts-ignore
            size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
        }));
        const __VLS_63 = __VLS_62({
            size: (16),
            strokeWidth: (1.8),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_62));
        // @ts-ignore
        [];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-cases-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-cases-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-card-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['support-card-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.businessName || 'this business');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-case-toolbar" },
    });
    /** @type {__VLS_StyleScopedClasses['support-case-toolbar']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "support-search" },
    });
    /** @type {__VLS_StyleScopedClasses['support-search']} */ ;
    let __VLS_66;
    /** @ts-ignore @type { | typeof Search} */
    Search;
    // @ts-ignore
    const __VLS_67 = __VLS_asFunctionalComponent1(__VLS_66, new __VLS_66({
        // @ts-ignore
        size: (15), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_68 = __VLS_67({
        size: (15),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_67));
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        type: "search",
        placeholder: "Search cases",
        'aria-label': "Search support cases",
    });
    (__VLS_unwrap(search, {}));
    let __VLS_71;
    /** @ts-ignore @type { | typeof Ticket} */
    Ticket;
    // @ts-ignore
    const __VLS_72 = __VLS_asFunctionalComponent1(__VLS_71, new __VLS_71({
        // @ts-ignore
        size: (21), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_73 = __VLS_72({
        size: (21),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_72));
    if (!filteredCases.value.length) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "support-empty" },
        });
        /** @type {__VLS_StyleScopedClasses['support-empty']} */ ;
        let __VLS_76;
        /** @ts-ignore @type { | typeof Ticket} */
        Ticket;
        // @ts-ignore
        const __VLS_77 = __VLS_asFunctionalComponent1(__VLS_76, new __VLS_76({
            // @ts-ignore
            size: (24), strokeWidth: (1.7), 'aria-hidden': "true",
        }));
        const __VLS_78 = __VLS_77({
            size: (24),
            strokeWidth: (1.7),
            'aria-hidden': "true",
        }, ...__VLS_functionalComponentArgsRest(__VLS_77));
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(!filteredCases.value.length))
                        throw 0;
                    return (openReport());
                    // @ts-ignore
                    [businessName, search, filteredCases,];
                } },
            ...{ class: "outline-button small" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
        /** @type {__VLS_StyleScopedClasses['small']} */ ;
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "support-case-list" },
        });
        /** @type {__VLS_StyleScopedClasses['support-case-list']} */ ;
        const __VLS_81 = __VLS_tryAsConstant((filteredCases.value));
        for (const [caseItem] of __VLS_vFor(__VLS_nonNull(__VLS_81))) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                key: (caseItem.id),
                ...{ class: "support-case-row" },
            });
            /** @type {__VLS_StyleScopedClasses['support-case-row']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!!(!filteredCases.value.length))
                            throw 0;
                        return (startCase(caseItem));
                        // @ts-ignore
                        [filteredCases,];
                    } },
                ...{ class: "support-case-summary" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['support-case-summary']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: (['status-pill', statusClass(caseItem.status)]) },
            });
            /** @type {__VLS_StyleScopedClasses['status-pill']} */ ;
            (statusLabel(caseItem.status));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "support-case-copy" },
            });
            /** @type {__VLS_StyleScopedClasses['support-case-copy']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (caseItem.subject);
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (formatLabel(caseItem.category));
            if (caseItem.provider) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                (formatLabel(caseItem.provider));
            }
            (new Date(caseItem.createdAt).toLocaleString());
            let __VLS_82;
            /** @ts-ignore @type { | typeof ChevronDown} */
            ChevronDown;
            // @ts-ignore
            const __VLS_83 = __VLS_asFunctionalComponent1(__VLS_82, new __VLS_82({
                // @ts-ignore
                ...{ class: ({ rotated: selectedCase.value?.id === caseItem.id }) }, size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_84 = __VLS_83({
                ...{ class: ({ rotated: selectedCase.value?.id === caseItem.id }) },
                size: (16),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_83));
            /** @type {__VLS_StyleScopedClasses['rotated']} */ ;
            if (selectedCase.value?.id === caseItem.id) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "support-case-detail" },
                });
                /** @type {__VLS_StyleScopedClasses['support-case-detail']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
                (caseItem.description);
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "support-case-meta" },
                });
                /** @type {__VLS_StyleScopedClasses['support-case-meta']} */ ;
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                (caseItem.correlationId);
                __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                (caseItem.sourcePage || 'Support');
                if (caseItem.assignedUserName) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
                    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
                    (caseItem.assignedUserName);
                }
                __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                    ...{ class: "support-case-events" },
                });
                /** @type {__VLS_StyleScopedClasses['support-case-events']} */ ;
                const __VLS_87 = __VLS_tryAsConstant((caseItem.events));
                for (const [event] of __VLS_vFor(__VLS_nonNull(__VLS_87))) {
                    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                        key: (event.id),
                    });
                    let __VLS_88;
                    /** @ts-ignore @type { | typeof Check} */
                    Check;
                    // @ts-ignore
                    const __VLS_89 = __VLS_asFunctionalComponent1(__VLS_88, new __VLS_88({
                        // @ts-ignore
                        size: (13), strokeWidth: (2), 'aria-hidden': "true",
                    }));
                    const __VLS_90 = __VLS_89({
                        size: (13),
                        strokeWidth: (2),
                        'aria-hidden': "true",
                    }, ...__VLS_functionalComponentArgsRest(__VLS_89));
                    (event.body || formatLabel(event.eventType));
                    (new Date(event.createdAt).toLocaleString());
                    // @ts-ignore
                    [selectedCase, selectedCase,];
                }
            }
            // @ts-ignore
            [];
        }
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
        ...{ class: "support-side-column" },
    });
    /** @type {__VLS_StyleScopedClasses['support-side-column']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-context-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-context-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "support-card-heading" },
    });
    /** @type {__VLS_StyleScopedClasses['support-card-heading']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "eyebrow" },
    });
    /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    let __VLS_93;
    /** @ts-ignore @type { | typeof CircleHelp} */
    CircleHelp;
    // @ts-ignore
    const __VLS_94 = __VLS_asFunctionalComponent1(__VLS_93, new __VLS_93({
        // @ts-ignore
        size: (21), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_95 = __VLS_94({
        size: (21),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_94));
    __VLS_asFunctionalElement1(__VLS_intrinsics.dl, __VLS_intrinsics.dl)({
        ...{ class: "support-diagnostics-list" },
    });
    /** @type {__VLS_StyleScopedClasses['support-diagnostics-list']} */ ;
    const __VLS_98 = __VLS_tryAsConstant((__VLS_unwrap(diagnosticsRows, {})));
    for (const [row] of __VLS_vFor(__VLS_nonNull(__VLS_98))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            key: (row.label),
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.dt, __VLS_intrinsics.dt)({});
        (row.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.dd, __VLS_intrinsics.dd)({
            title: (row.value),
        });
        (row.value);
        // @ts-ignore
        [diagnosticsRows,];
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (openReport());
                // @ts-ignore
                [];
            } },
        ...{ class: "outline-button small support-context-button" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-context-button']} */ ;
    let __VLS_99;
    /** @ts-ignore @type { | typeof ArrowRight} */
    ArrowRight;
    // @ts-ignore
    const __VLS_100 = __VLS_asFunctionalComponent1(__VLS_99, new __VLS_99({
        // @ts-ignore
        size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_101 = __VLS_100({
        size: (14),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_100));
    __VLS_asFunctionalElement1(__VLS_intrinsics.article, __VLS_intrinsics.article)({
        ...{ class: "panel support-escape-card" },
    });
    /** @type {__VLS_StyleScopedClasses['panel']} */ ;
    /** @type {__VLS_StyleScopedClasses['support-escape-card']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "support-escape-icon" },
    });
    /** @type {__VLS_StyleScopedClasses['support-escape-icon']} */ ;
    let __VLS_104;
    /** @ts-ignore @type { | typeof Wrench} */
    Wrench;
    // @ts-ignore
    const __VLS_105 = __VLS_asFunctionalComponent1(__VLS_104, new __VLS_104({
        // @ts-ignore
        size: (19), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_106 = __VLS_105({
        size: (19),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_105));
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
                return (openReport());
                // @ts-ignore
                [];
            } },
        ...{ class: "primary-button small" },
        type: "button",
    });
    /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['small']} */ ;
    let __VLS_109;
    /** @ts-ignore @type { | typeof ArrowRight} */
    ArrowRight;
    // @ts-ignore
    const __VLS_110 = __VLS_asFunctionalComponent1(__VLS_109, new __VLS_109({
        // @ts-ignore
        size: (14), strokeWidth: (1.8), 'aria-hidden': "true",
    }));
    const __VLS_111 = __VLS_110({
        size: (14),
        strokeWidth: (1.8),
        'aria-hidden': "true",
    }, ...__VLS_functionalComponentArgsRest(__VLS_110));
    if (reportOpen.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(reportOpen.value))
                        throw 0;
                    return (reportOpen.value = false);
                    // @ts-ignore
                    [reportOpen, reportOpen,];
                } },
            ...{ class: "support-modal-backdrop" },
            role: "presentation",
        });
        /** @type {__VLS_StyleScopedClasses['support-modal-backdrop']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.section, __VLS_intrinsics.section)({
            ...{ class: "support-report-modal" },
            role: "dialog",
            'aria-modal': "true",
            'aria-labelledby': "support-report-title",
        });
        /** @type {__VLS_StyleScopedClasses['support-report-modal']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(reportOpen.value))
                        throw 0;
                    return (reportOpen.value = false);
                    // @ts-ignore
                    [reportOpen,];
                } },
            ...{ class: "support-modal-close" },
            type: "button",
            'aria-label': "Close report form",
        });
        /** @type {__VLS_StyleScopedClasses['support-modal-close']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "eyebrow" },
        });
        /** @type {__VLS_StyleScopedClasses['eyebrow']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.h2, __VLS_intrinsics.h2)({
            id: "support-report-title",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
            ...{ class: "support-modal-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['support-modal-copy']} */ ;
        (__VLS_ctx.businessName || 'your business');
        if (!__VLS_ctx.authReady) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "support-auth-gate" },
            });
            /** @type {__VLS_StyleScopedClasses['support-auth-gate']} */ ;
            let __VLS_114;
            /** @ts-ignore @type { | typeof CircleAlert} */
            CircleAlert;
            // @ts-ignore
            const __VLS_115 = __VLS_asFunctionalComponent1(__VLS_114, new __VLS_114({
                // @ts-ignore
                size: (18), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_116 = __VLS_115({
                size: (18),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_115));
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.br)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(reportOpen.value))
                            throw 0;
                        if (!(!__VLS_ctx.authReady))
                            throw 0;
                        return (__VLS_unwrap(emit, {})('require-auth'));
                        // @ts-ignore
                        [emit, authReady, businessName,];
                    } },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
        }
        else {
            __VLS_asFunctionalElement1(__VLS_intrinsics.form, __VLS_intrinsics.form)({
                ...{ onSubmit: (submitCase) },
                ...{ class: "support-report-form" },
            });
            /** @type {__VLS_StyleScopedClasses['support-report-form']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                required: true,
                maxlength: "180",
                placeholder: "e.g. Knowledge refresh failed",
            });
            (form.value.subject);
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "support-form-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['support-form-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                value: (form.value.category),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "general",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "installation",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "knowledge",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "actions",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "integration",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "billing",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "verification",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "account",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
                value: (form.value.severity),
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "normal",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
                value: "urgent",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "support-form-grid" },
            });
            /** @type {__VLS_StyleScopedClasses['support-form-grid']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "optional" },
            });
            /** @type {__VLS_StyleScopedClasses['optional']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "e.g. HubSpot",
            });
            (form.value.provider);
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
                ...{ class: "optional" },
            });
            /** @type {__VLS_StyleScopedClasses['optional']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
                placeholder: "Attached automatically when available",
            });
            (form.value.connectionId);
            __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.textarea, __VLS_intrinsics.textarea)({
                value: (form.value.description),
                rows: "6",
                required: true,
                maxlength: "8000",
                placeholder: "Describe the outcome you expected and what happened instead.",
            });
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "support-attached-note" },
            });
            /** @type {__VLS_StyleScopedClasses['support-attached-note']} */ ;
            let __VLS_119;
            /** @ts-ignore @type { | typeof ShieldCheck} */
            ShieldCheck;
            // @ts-ignore
            const __VLS_120 = __VLS_asFunctionalComponent1(__VLS_119, new __VLS_119({
                // @ts-ignore
                size: (16), strokeWidth: (1.8), 'aria-hidden': "true",
            }));
            const __VLS_121 = __VLS_120({
                size: (16),
                strokeWidth: (1.8),
                'aria-hidden': "true",
            }, ...__VLS_functionalComponentArgsRest(__VLS_120));
            __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            if (__VLS_ctx.submitError) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                    ...{ class: "form-error" },
                });
                /** @type {__VLS_StyleScopedClasses['form-error']} */ ;
                (__VLS_ctx.submitError);
            }
            if (__VLS_ctx.submitMessage) {
                __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                    ...{ class: "saved-message" },
                });
                /** @type {__VLS_StyleScopedClasses['saved-message']} */ ;
                (__VLS_ctx.submitMessage);
            }
            __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
                ...{ class: "support-modal-actions" },
            });
            /** @type {__VLS_StyleScopedClasses['support-modal-actions']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ onClick: (...[$event]) => {
                        void $event;
                        if (!(reportOpen.value))
                            throw 0;
                        if (!!(!__VLS_ctx.authReady))
                            throw 0;
                        return (reportOpen.value = false);
                        // @ts-ignore
                        [reportOpen, form, form, form, form, form, form, submitError, submitError, submitMessage, submitMessage,];
                    } },
                ...{ class: "outline-button small" },
                type: "button",
            });
            /** @type {__VLS_StyleScopedClasses['outline-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
                ...{ class: "primary-button small" },
                type: "submit",
                disabled: (__VLS_ctx.submitting),
            });
            /** @type {__VLS_StyleScopedClasses['primary-button']} */ ;
            /** @type {__VLS_StyleScopedClasses['small']} */ ;
            (__VLS_ctx.submitting ? 'Sending…' : 'Create support case');
        }
    }
    // @ts-ignore
    [submitting, submitting,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
