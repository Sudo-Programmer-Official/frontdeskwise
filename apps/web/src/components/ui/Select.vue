<script setup lang="ts">
interface SelectOption { label: string; value: string; }

withDefaults(defineProps<{
  modelValue?: string;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  ariaLabel?: string;
}>(), { placeholder: "Select…" });

const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
</script>

<template>
  <select
    class="ds-control ds-select"
    :value="modelValue"
    :disabled="disabled"
    :required="required"
    :aria-label="ariaLabel"
    @change="emit('update:modelValue', ($event.target as HTMLSelectElement).value)"
  >
    <option v-if="placeholder" value="">{{ placeholder }}</option>
    <option v-for="option in options" :key="option.value" :value="option.value">{{ option.label }}</option>
  </select>
</template>
