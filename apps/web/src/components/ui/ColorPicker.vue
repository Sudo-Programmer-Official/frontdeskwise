<script setup lang="ts">
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{ modelValue: string; swatches?: string[]; label?: string }>(), {
  swatches: () => ["#2563EB", "#0F766E", "#7C3AED", "#EA580C", "#1E3A8A"],
  label: "Brand color",
});
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
const inputValue = ref(props.modelValue);
watch(() => props.modelValue, (value) => { inputValue.value = value; });
const isValid = computed(() => /^#[0-9a-f]{6}$/i.test(inputValue.value));
const nativeColor = computed(() => isValid.value ? inputValue.value : "#2563EB");

function updateText(value: string) {
  inputValue.value = value;
  emit("update:modelValue", value);
}

function updateNative(event: Event) {
  updateText((event.target as HTMLInputElement).value.toUpperCase());
}
</script>

<template>
  <div class="ds-color-picker">
    <div class="ds-color-picker-row">
      <div class="ds-hex-input"><span>#</span><input :value="inputValue.replace(/^#/, '')" maxlength="6" :aria-label="label + ' hex value'" @input="updateText('#' + ($event.target as HTMLInputElement).value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase())" /></div>
      <input class="ds-native-color" type="color" :value="nativeColor" :aria-label="label + ' picker'" @input="updateNative" />
      <span class="ds-color-preview" :style="{ background: isValid ? inputValue : '#e7edf5' }" aria-hidden="true"></span>
    </div>
    <div class="ds-color-swatches" aria-label="Brand color presets">
      <button v-for="swatch in swatches" :key="swatch" type="button" :class="{ selected: inputValue.toUpperCase() === swatch.toUpperCase() }" :style="{ background: swatch }" :aria-label="`Use ${swatch}`" @click="updateText(swatch)"></button>
    </div>
    <small v-if="!isValid" class="ds-field-error">Use a 6-digit hex color, such as #2563EB.</small>
  </div>
</template>
