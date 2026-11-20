<script setup lang="ts">
defineProps<{ eyebrow?: string; title: string; description?: string }>();
</script>

<template>
  <section class="ds-form-section"><div class="ds-form-section-heading"><p v-if="eyebrow" class="ds-section-kicker">{{ eyebrow }}</p><h3>{{ title }}</h3><p v-if="description">{{ description }}</p></div><slot /></section>
</template>
