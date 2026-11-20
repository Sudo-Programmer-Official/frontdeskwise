const { defineProps, withDefaults, } = {};
const __VLS_props = withDefaults(defineProps(), { as: "article", tone: "default" });
const __VLS_defaults = { as: "article", tone: "default" };
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
    const __VLS_0 = (__VLS_ctx.as);
    // @ts-ignore
    const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
        // @ts-ignore
        ...{ class: (['ds-card', `ds-card-${__VLS_ctx.tone}`]) },
    }));
    const __VLS_2 = __VLS_1({
        ...{ class: (['ds-card', `ds-card-${__VLS_ctx.tone}`]) },
    }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    /** @type {__VLS_StyleScopedClasses['ds-card']} */ ;
    var __VLS_3;
    const { default: __VLS_5 } = __VLS_nonNull(__VLS_3.slots);
    var __VLS_6 = {};
    // @ts-ignore
    [as, tone,];
    var __VLS_7 = __VLS_6;
    // @ts-ignore
    [];
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
