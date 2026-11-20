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
        ...{ class: "ds-tabs" },
        role: "tablist",
        'aria-label': (__VLS_ctx.ariaLabel),
    });
    /** @type {__VLS_StyleScopedClasses['ds-tabs']} */ ;
    const __VLS_0 = __VLS_tryAsConstant((__VLS_ctx.tabs));
    for (const [tab] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (__VLS_unwrap(emit, {})('update:modelValue', tab.value));
                    // @ts-ignore
                    [ariaLabel, tabs, emit,];
                } },
            key: (tab.value),
            type: "button",
            role: "tab",
            'aria-selected': (__VLS_ctx.modelValue === tab.value),
            ...{ class: ({ active: __VLS_ctx.modelValue === tab.value }) },
        });
        /** @type {__VLS_StyleScopedClasses['active']} */ ;
        (tab.label);
        // @ts-ignore
        [modelValue, modelValue,];
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
