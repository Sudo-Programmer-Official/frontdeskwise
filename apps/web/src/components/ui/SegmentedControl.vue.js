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
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-segmented" },
        role: "group",
        'aria-label': (__VLS_ctx.ariaLabel),
    });
    /** @type {__VLS_StyleScopedClasses['ds-segmented']} */ ;
    const __VLS_0 = __VLS_tryAsConstant((__VLS_ctx.options));
    for (const [option] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (__VLS_unwrap(emit, {})('update:modelValue', option.value));
                    // @ts-ignore
                    [ariaLabel, options, emit,];
                } },
            key: (option.value),
            type: "button",
            ...{ class: ({ active: __VLS_ctx.modelValue === option.value }) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        (option.label);
        // @ts-ignore
        [modelValue,];
    }
    // @ts-ignore
    [];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
