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
        ...{ class: "ds-checkbox-row" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-checkbox-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onChange: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('update:modelValue', $event.target.checked));
                // @ts-ignore
                [emit,];
            } },
        type: "checkbox",
        checked: (__VLS_ctx.modelValue),
        disabled: (__VLS_ctx.disabled),
        required: (__VLS_ctx.required),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    var __VLS_0 = {};
    (__VLS_ctx.label);
    var __VLS_1 = __VLS_0;
    // @ts-ignore
    [modelValue, disabled, required, label,];
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
