const { defineProps, } = {};
const __VLS_props = defineProps();
const __VLS_ctx = {
    ...{},
    ...{},
    ...{},
};
let __VLS_components;
let __VLS_intrinsics;
let __VLS_directives;
void __VLS_ctx, __VLS_components, __VLS_intrinsics, __VLS_directives;
const __VLS_template = () => {
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "ds-field" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-field']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "ds-field-label" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-field-label']} */ ;
    (__VLS_ctx.label);
    if (__VLS_ctx.required) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "ds-required" },
            'aria-hidden': "true",
        });
        /** @type {__VLS_StyleScopedClasses['ds-required']} */ ;
    }
    else if (__VLS_ctx.optional) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "ds-optional" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-optional']} */ ;
    }
    var __VLS_0 = {};
    if (__VLS_ctx.error) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({
            ...{ class: "ds-field-error" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-field-error']} */ ;
        (__VLS_ctx.error);
    }
    else if (__VLS_ctx.hint) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({
            ...{ class: "ds-field-hint" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-field-hint']} */ ;
        (__VLS_ctx.hint);
    }
    var __VLS_1 = __VLS_0;
    // @ts-ignore
    [label, required, optional, error, error, hint, hint,];
    return {
        __VLS_Slots: {},
    };
};
void [__VLS_template, {}];
const __VLS_base = (await import('vue')).defineComponent({
    __typeProps: {},
});
const __VLS_export = {};
export default {};
