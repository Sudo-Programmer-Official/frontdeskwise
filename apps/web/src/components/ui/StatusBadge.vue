<script setup lang="ts">
withDefaults(defineProps<{ tone?: "success" | "warning" | "danger" | "neutral" | "info" }>(), { tone: "neutral" });
</script>

<template><span :class="['ds-status-badge', `ds-status-${tone}`]"><slot /></span></template>
