<script setup lang="ts">
defineProps<{
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  optional?: boolean;
}>();
</script>

<template>
  <label class="ds-field">
    <span class="ds-field-label">{{ label }} <span v-if="required" class="ds-required" aria-hidden="true">*</span><span v-else-if="optional" class="ds-optional">Optional</span></span>
    <slot />
    <small v-if="error" class="ds-field-error">{{ error }}</small>
    <small v-else-if="hint" class="ds-field-hint">{{ hint }}</small>
  </label>
</template>
