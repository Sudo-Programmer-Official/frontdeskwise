<script setup lang="ts">
withDefaults(defineProps<{
  modelValue?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  maxlength?: number;
  rows?: number;
}>(), { rows: 4 });

const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
</script>

<template>
  <textarea
    class="ds-control ds-textarea"
    :value="modelValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :required="required"
    :maxlength="maxlength"
    :rows="rows"
    @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)"
  />
</template>
