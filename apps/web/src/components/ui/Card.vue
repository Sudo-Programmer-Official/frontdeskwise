<script setup lang="ts">
withDefaults(defineProps<{ as?: "article" | "section" | "div"; tone?: "default" | "subtle" }>(), { as: "article", tone: "default" });
</script>

<template>
  <component :is="as" :class="['ds-card', `ds-card-${tone}`]"><slot /></component>
</template>
