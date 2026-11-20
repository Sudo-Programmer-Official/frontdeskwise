import { FileImage } from "@lucide/vue";
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
        ...{ class: "ds-file-upload" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-file-upload']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-file-preview" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-file-preview']} */ ;
    if (__VLS_ctx.previewUrl) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.img)({
            src: (__VLS_ctx.previewUrl),
            alt: "",
        });
    }
    else {
        __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
            'aria-hidden': "true",
        });
        let __VLS_0;
        /** @ts-ignore @type { | typeof FileImage} */
        FileImage;
        // @ts-ignore
        const __VLS_1 = __VLS_asFunctionalComponent1(__VLS_0, new __VLS_0({
            // @ts-ignore
            size: (24), strokeWidth: (1.8),
        }));
        const __VLS_2 = __VLS_1({
            size: (24),
            strokeWidth: (1.8),
        }, ...__VLS_functionalComponentArgsRest(__VLS_1));
    }
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-file-copy" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-file-copy']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.strong, __VLS_intrinsics.strong)({});
    (__VLS_ctx.filename || "Add your logo");
    __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.label, __VLS_intrinsics.label)({
        ...{ class: "ds-button ds-button-secondary ds-button-small" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-button']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-button-secondary']} */ ;
    /** @type {__VLS_StyleScopedClasses['ds-button-small']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onChange: (...[$event]) => {
                void $event;
                return ($event.target.files?.[0] && __VLS_unwrap(emit, {})('change', $event.target.files[0]));
                // @ts-ignore
                [previewUrl, previewUrl, filename, emit,];
            } },
        type: "file",
        ...{ class: "ds-visually-hidden" },
        accept: (__VLS_ctx.accept),
    });
    /** @type {__VLS_StyleScopedClasses['ds-visually-hidden']} */ ;
    // @ts-ignore
    [accept,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
});
export default {};
