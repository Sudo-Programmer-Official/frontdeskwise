import { computed, ref, watch } from "vue";
const { defineProps, defineEmits, withDefaults, } = {};
const props = withDefaults(defineProps(), {
    swatches: () => ["#2563EB", "#0F766E", "#7C3AED", "#EA580C", "#1E3A8A"],
    label: "Brand color",
});
const emit = defineEmits();
const inputValue = ref(props.modelValue);
watch(() => props.modelValue, (value) => { inputValue.value = value; });
const isValid = computed(() => /^#[0-9a-f]{6}$/i.test(inputValue.value));
const nativeColor = computed(() => isValid.value ? inputValue.value : "#2563EB");
function updateText(value) {
    inputValue.value = value;
    emit("update:modelValue", value);
}
function updateNative(event) {
    updateText(event.target.value.toUpperCase());
}
const __VLS_defaults = {
    swatches: () => ["#2563EB", "#0F766E", "#7C3AED", "#EA580C", "#1E3A8A"],
    label: "Brand color",
};
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
    __VLS_withDotValue(inputValue, {});
    __VLS_withDotValue(isValid, {});
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-color-picker" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-color-picker']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-color-picker-row" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-color-picker-row']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-hex-input" },
    });
    /** @type {__VLS_StyleScopedClasses['ds-hex-input']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({});
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onInput: (...[$event]) => {
                void $event;
                return (updateText('#' + $event.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase()));
            } },
        value: (inputValue.value.replace(/^#/, '')),
        maxlength: "6",
        'aria-label': (__VLS_ctx.label + ' hex value'),
    });
    __VLS_asFunctionalElement1(__VLS_intrinsics.input)({
        ...{ onInput: (updateNative) },
        ...{ class: "ds-native-color" },
        type: "color",
        value: (__VLS_unwrap(nativeColor, {})),
        'aria-label': (__VLS_ctx.label + ' picker'),
    });
    /** @type {__VLS_StyleScopedClasses['ds-native-color']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.span, __VLS_intrinsics.span)({
        ...{ class: "ds-color-preview" },
        ...{ style: ({ background: isValid.value ? inputValue.value : '#e7edf5' }) },
        'aria-hidden': "true",
    });
    /** @type {__VLS_StyleScopedClasses['ds-color-preview']} */ ;
    __VLS_asFunctionalElement1(__VLS_intrinsics.div, __VLS_intrinsics.div)({
        ...{ class: "ds-color-swatches" },
        'aria-label': "Brand color presets",
    });
    /** @type {__VLS_StyleScopedClasses['ds-color-swatches']} */ ;
    const __VLS_0 = __VLS_tryAsConstant((__VLS_ctx.swatches));
    for (const [swatch] of __VLS_vFor(__VLS_nonNull(__VLS_0))) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.button, __VLS_intrinsics.button)({
            ...{ onClick: (...[$event]) => {
                    void $event;
                    return (updateText(swatch));
                    // @ts-ignore
                    [inputValue, inputValue, label, label, nativeColor, isValid, swatches,];
                } },
            key: (swatch),
            type: "button",
            ...{ class: ({ selected: inputValue.value.toUpperCase() === swatch.toUpperCase() }) },
            ...{ style: ({ background: swatch }) },
            'aria-label': (`Use ${swatch}`),
        });
        /** @type {__VLS_StyleScopedClasses['selected']} */ ;
        // @ts-ignore
        [inputValue,];
    }
    if (!isValid.value) {
        __VLS_asFunctionalElement1(__VLS_intrinsics.small, __VLS_intrinsics.small)({
            ...{ class: "ds-field-error" },
        });
        /** @type {__VLS_StyleScopedClasses['ds-field-error']} */ ;
    }
    // @ts-ignore
    [isValid,];
    return {};
};
void [__VLS_template];
const __VLS_export = (await import('vue')).defineComponent({
    __typeEmits: {},
    __typeProps: {},
    props: {},
});
export default {};
