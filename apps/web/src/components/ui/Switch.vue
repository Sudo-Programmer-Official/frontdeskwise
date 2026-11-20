<script setup lang="ts">
defineProps<{ modelValue?: boolean; label?: string; description?: string; disabled?: boolean }>();
const emit = defineEmits<{ (event: "update:modelValue", value: boolean): void }>();
</script>

<template>
  <label class="ds-switch-row">
    <span v-if="label || description" class="ds-switch-copy"><strong v-if="label">{{ label }}</strong><small v-if="description">{{ description }}</small></span>
    <span class="ds-switch"><input type="checkbox" :checked="modelValue" :disabled="disabled" @change="emit('update:modelValue', ($event.target as HTMLInputElement).checked)" /><span aria-hidden="true"></span></span>
  </label>
</template>
