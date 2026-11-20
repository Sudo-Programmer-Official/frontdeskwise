const { defineProps, withDefaults, } = {};
const __VLS_props = withDefaults(defineProps(), {
    variant: "secondary",
    size: "default",
    type: "button",
});
const __VLS_defaults = {
    variant: "secondary",
    size: "default",
    type: "button",
};
void __VLS_defaults;
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
    __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
        type: (__VLS_ctx.type),
        ...{ class: (['ds-button', `ds-button-${__VLS_ctx.variant}`, { 'ds-button-small': __VLS_ctx.size === 'small' }]) },
        disabled: (__VLS_ctx.disabled),
    });
    /** @type {__VLS_StyleScopedClasses['ds-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-button-small']} */ ;
    var __VLS_0 = {};
    var __VLS_1 = __VLS_0;
    // @ts-ignore
    [type, variant, size, disabled,];
    return {
        __VLS_Slots: {},
    };
};
void [__VLS_template, {}];
const __VLS_base = (await import('vue')).defineComponent({
    __typeProps: {},
    props: {},
});
const __VLS_export = {};
export default {};
