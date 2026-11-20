const { defineProps, defineEmits, } = {};
const __VLS_props = defineProps();
const emit = defineEmits();
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
    if (__VLS_ctx.open) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(__VLS_ctx.open))
                        throw 0;
                    return (__VLS_unwrap(emit, {})('close'));
                    // @ts-ignore
                    [open, emit,];
                } },
            ...{ class: "ds-drawer-backdrop" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-drawer-backdrop']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.aside, __VLS_intrinsics.aside)({
            ...{ class: "ds-drawer" },
            role: "dialog",
            'aria-modal': "true",
            'aria-label': (__VLS_ctx.title),
        });
        /** @type {__VLS_StyleScopedClasses['ds-drawer']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
            ...{ class: "ds-drawer-heading" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-drawer-heading']} */ ;
        __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({});
        if (__VLS_ctx.eyebrow) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.p, __VLS_intrinsics.p)({
                ...{ class: "ds-section-kicker" },
            });
            /** @type {__VLS_StyleScopedClasses['ds-section-kicker']} */ ;
            (__VLS_ctx.eyebrow);
        }
        __VLS_asFunctionalElement1(__VLS_intrinsics.h3, __VLS_intrinsics.h3)({});
        (__VLS_ctx.title);
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    if (!(__VLS_ctx.open))
                        throw 0;
                    return (__VLS_unwrap(emit, {})('close'));
                    // @ts-ignore
                    [emit, title, title, eyebrow, eyebrow,];
                } },
            ...{ class: "ds-icon-button" },
            type: "button",
            'aria-label': "Close",
        });
        /** @type {__VLS_StyleScopedClasses['ds-icon-button']} */ ;
        var __VLS_0 = {};
    }
    var __VLS_1 = __VLS_0;
    // @ts-ignore
    [];
    return {
        __VLS_Slots: {},
    };
};
void [__VLS_template, {}];
const __VLS_base = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
const __VLS_export = {};
export default {};
