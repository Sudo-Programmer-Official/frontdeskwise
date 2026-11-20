const { defineProps, defineEmits, withDefaults, } = {};
const __VLS_props = withDefaults(defineProps(), { type: "text" });
const emit = defineEmits();
const __VLS_defaults = { type: "text" };
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onInput: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('update:modelValue', $event.target.value));
                // @ts-ignore
                [emit,];
            } },
        ...{ class: "ds-control ds-text-input" },
        type: (__VLS_ctx.type),
        value: (__VLS_ctx.modelValue),
        placeholder: (__VLS_ctx.placeholder),
        disabled: (__VLS_ctx.disabled),
        required: (__VLS_ctx.required),
        maxlength: (__VLS_ctx.maxlength),
        autocomplete: (__VLS_ctx.autocomplete),
        'aria-label': (__VLS_ctx.ariaLabel),
    });
    /** @type {__VLS_StyleScopedClasses['ds-control']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-text-input']} */ ;
    // @ts-ignore
    [type, modelValue, placeholder, disabled, required, maxlength, autocomplete, ariaLabel,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
