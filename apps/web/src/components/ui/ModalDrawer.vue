<script setup lang="ts">
defineProps<{ open: boolean; title: string; eyebrow?: string }>();
const emit = defineEmits<{ (event: "close"): void }>();
</script>

<template>
  <div v-if="open" class="ds-drawer-backdrop" @click.self="emit('close')"><aside class="ds-drawer" role="dialog" aria-modal="true" :aria-label="title"><div class="ds-drawer-heading"><div><p v-if="eyebrow" class="ds-section-kicker">{{ eyebrow }}</p><h3>{{ title }}</h3></div><button class="ds-icon-button" type="button" aria-label="Close" @click="emit('close')">×</button></div><slot /></aside></div>
</template>
