<script setup lang="ts">
interface Segment { label: string; value: string; }
defineProps<{ modelValue?: string; options: Segment[]; ariaLabel?: string }>();
const emit = defineEmits<{ (event: "update:modelValue", value: string): void }>();
</script>

<template>
  <div class="ds-segmented" role="group" :aria-label="ariaLabel">
    <button v-for="option in options" :key="option.value" type="button" :class="{ active: modelValue === option.value }" @click="emit('update:modelValue', option.value)">{{ option.label }}</button>
  </div>
</template>
