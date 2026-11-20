<script setup lang="ts">
interface Tab { label: string; value: string; }
defineProps<{ modelValue?: string; tabs: Tab[]; ariaLabel?: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
</script>

<template><div class="ds-tabs" role="tablist" :aria-label="ariaLabel"><button v-for="tab in tabs" :key="tab.value" type="button" role="tab" :aria-selected="modelValue === tab.value" :class="{ active: modelValue === tab.value }" @click="emit('update:modelValue', tab.value)">{{ tab.label }}</button></div></template>
