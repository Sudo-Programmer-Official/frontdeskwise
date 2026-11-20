<script setup lang="ts">
withDefaults(defineProps<{
  modelValue?: string | number;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  maxlength?: number;
  autocomplete?: string;
  ariaLabel?: string;
}>(), { type: "text" });

const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
</script>

<template>
  <input
    class="ds-control ds-text-input"
    :type="type"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :required="required"
    :maxlength="maxlength"
    :autocomplete="autocomplete"
    :aria-label="ariaLabel"
    @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
  />
</template>
