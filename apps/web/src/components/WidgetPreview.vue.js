import { computed } from "vue";
import { getAccessibleTextColor, isHexColor } from "../utils/color";
const { defineProps, defineEmits, withDefaults, } = {};
const props = withDefaults(defineProps(), { widgetTheme: "auto", widgetPosition: "bottom-right", widgetLogoUrl: "", showLeadCapture: true, mode: "desktop" });
const emit = defineEmits();
const safeColor = computed(() => isHexColor(props.widgetColor) ? props.widgetColor : "#2563EB");
const textColor = computed(() => getAccessibleTextColor(safeColor.value));
const __VLS_defaults = { widgetTheme: "auto", widgetPosition: "bottom-right", widgetLogoUrl: "", showLeadCapture: true, mode: "desktop" };
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
        ...{ class: ({ active: __VLS_ctx.mode === 'desktop' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        ...{ onClick: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('change-mode', 'mobile'));
                // @ts-ignore
                [emit, mode,];
            } },
        type: "button",
        ...{ class: ({ active: __VLS_ctx.mode === 'mobile' }) },
    });
    /** @type {__VLS_StyleScopedClasses['active']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        'aria-label': "Widget preview",
        ...{ class: (['customer-preview', `preview-${__VLS_ctx.mode}`, `theme-${__VLS_ctx.widgetTheme}`, `position-${__VLS_ctx.widgetPosition}`]) },
        ...{ style: ({ '--preview-accent': __VLS_unwrap(safeColor, {}), '--preview-accent-text': __VLS_unwrap(textColor, {}) }) },
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
    (__VLS_ctx.websiteUrl || 'yourbusiness.com');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-site-body" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-site-body']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-site-nav" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-site-nav']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.businessName || 'Your business');
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-site-copy" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-site-copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "preview-badge" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-badge']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.h4, __VLS_intrinsics.h4)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.br)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({});
    (__VLS_ctx.businessName || 'your website');
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-chat" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-chat']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-chat-header" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-chat-header']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "preview-orb" },
        ...{ style: ({ background: __VLS_unwrap(safeColor, {}), color: __VLS_unwrap(textColor, {}) }) },
    });
    /** @type {__VLS_StyleScopedClasses['preview-orb']} */ ;
    if (__VLS_ctx.widgetLogoUrl) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (__VLS_ctx.widgetLogoUrl),
            alt: "",
        });
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    (__VLS_ctx.assistantName || 'AI assistant');
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "online-dot" },
    });
    /** @type {__VLS_StyleScopedClasses['online-dot']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-chat-bubble" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-chat-bubble']} */ ;
    (__VLS_ctx.welcomeMessage || 'Hi! How can I help?');
    const __VLS_0 = __VLS_tryAsConstant((__VLS_ctx.quickActions.slice(0, 3)));
    for (const [action] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            key: (action.label),
            ...{ class: "preview-suggested-action" },
            type: "button",
        });
        /** @type {__VLS_StyleScopedClasses['preview-suggested-action']} */ ;
        (action.label);
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
        // @ts-ignore
        [mode, mode, widgetTheme, widgetPosition, safeColor, safeColor, textColor, textColor, websiteUrl, businessName, businessName, widgetLogoUrl, widgetLogoUrl, assistantName, welcomeMessage, quickActions,];
    }
    if (__VLS_ctx.showLeadCapture) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "preview-form-simulation" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-form-simulation']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "preview-required" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-required']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            placeholder: "Your name",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "preview-required" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-required']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            placeholder: "you@example.com",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({});
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "preview-optional" },
        });
        /** @type {__VLS_StyleScopedClasses['preview-optional']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
            placeholder: "(555) 555-0123",
        });
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            type: "button",
            ...{ style: ({ background: __VLS_unwrap(safeColor, {}), color: __VLS_unwrap(textColor, {}) }) },
        });
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "preview-chat-input" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-chat-input']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ style: ({ color: __VLS_unwrap(safeColor, {}) }) },
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
        ...{ class: "preview-note" },
    });
    /** @type {__VLS_StyleScopedClasses['preview-note']} */ ;
    // @ts-ignore
    [safeColor, safeColor, textColor, showLeadCapture,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
