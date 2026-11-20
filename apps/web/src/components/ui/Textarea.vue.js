const { defineProps, defineEmits, withDefaults, } = {};
const __VLS_props = withDefaults(defineProps(), { rows: 4 });
const emit = defineEmits();
const __VLS_defaults = { rows: 4 };
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.textarea)({
        ...{ onInput: (...[$event]) => {
                void $event;
                return (__VLS_unwrap(emit, {})('update:modelValue', $event.target.value));
                // @ts-ignore
                [emit,];
            } },
        ...{ class: "ds-control ds-textarea" },
        value: (__VLS_ctx.modelValue),
        placeholder: (__VLS_ctx.placeholder),
        disabled: (__VLS_ctx.disabled),
        required: (__VLS_ctx.required),
        maxlength: (__VLS_ctx.maxlength),
        rows: (__VLS_ctx.rows),
    });
    /** @type {__VLS_StyleScopedClasses['ds-control']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-textarea']} */ ;
    // @ts-ignore
    [modelValue, placeholder, disabled, required, maxlength, rows,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
