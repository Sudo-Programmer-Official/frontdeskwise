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
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "ds-switch-row" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-switch-row']} */ ;
    if (__VLS_ctx.label || __VLS_ctx.description) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            ...{ class: "ds-switch-copy" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-switch-copy']} */ ;
        if (__VLS_ctx.label) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
            (__VLS_ctx.label);
        }
        if (__VLS_ctx.description) {
            __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
            (__VLS_ctx.description);
        }
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "ds-switch" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-switch']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onChange: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('update:modelValue', $event.target.checked));
                // @ts-ignore
                [label, label, label, description, description, description, emit,];
            } },
        type: "checkbox",
        checked: (__VLS_ctx.modelValue),
        disabled: (__VLS_ctx.disabled),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        'aria-hidden': "true",
    });
    // @ts-ignore
    [modelValue, disabled,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
