const { defineProps, defineEmits, withDefaults, } = {};
const __VLS_props = withDefaults(defineProps(), { placeholder: "Select…" });
const emit = defineEmits();
const __VLS_defaults = { placeholder: "Select…" };
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.select, __VLS_intrinsics.select)({
        ...{ onChange: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('update:modelValue', $event.target.value));
                // @ts-ignore
                [emit,];
            } },
        ...{ class: "ds-control ds-select" },
        value: (__VLS_ctx.modelValue),
        disabled: (__VLS_ctx.disabled),
        required: (__VLS_ctx.required),
        'aria-label': (__VLS_ctx.ariaLabel),
    });
    /** @type {__VLS_StyleScopedClasses['ds-control']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-select']} */ ;
    if (__VLS_ctx.placeholder) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            value: "",
        });
        (__VLS_ctx.placeholder);
    }
    const __VLS_0 = __VLS_tryAsConstant((__VLS_ctx.options));
    for (const [option] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.option, __VLS_intrinsics.option)({
            key: (option.value),
            value: (option.value),
        });
        (option.label);
        // @ts-ignore
        [modelValue, disabled, required, ariaLabel, placeholder, placeholder, options,];
    }
    // @ts-ignore
    [];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
