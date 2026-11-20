<script setup lang="ts">
defineProps<{ modelValue?: boolean; label?: string; disabled?: boolean; required?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <label class="ds-checkbox-row"><input type="checkbox" :checked="modelValue" :disabled="disabled" :required="required" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /><span><slot>{{ label }}</slot></span></label>
</template>
