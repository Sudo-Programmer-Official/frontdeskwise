import { computed } from "vue";
import { markdownToSafeHtml } from "../widget-ui/markdown";
const { defineProps, } = {};
const props = defineProps();
const safeHtml = computed(() => markdownToSafeHtml(props.content));
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
    void {};
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "assistant-markdown" },
    });
    const __VLS_0 = __VLS_asFunctionalDirective(__VLS_directives.vHtml, {});
    __VLS_0(__VLS_nonNull(null), { ...__VLS_directiveBindingRestFields, value: (__VLS_unwrap(safeHtml, {})), }, ...__VLS_directiveHookArgsRest(__VLS_0));
    /** @type {__VLS_StyleScopedClasses['assistant-markdown']} */ ;
    // @ts-ignore
    [safeHtml,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeProps: {},
});
export default {};
