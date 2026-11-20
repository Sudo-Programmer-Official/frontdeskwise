<script setup lang="ts">
defineProps<{ accept?: string; filename?: string; previewUrl?: string }>();
const emit = defineEmits<{ (event: "change", file: File): void }>();
</script>

<template>
  <div class="ds-file-upload">
    <div class="ds-file-preview"><img v-if="previewUrl" :src="previewUrl" alt="" /><span v-else aria-hidden="true">✦</span></div>
    <div class="ds-file-copy"><strong>{{ filename || "Add your logo" }}</strong><small>PNG, JPG, or SVG · upload for preview</small><label class="ds-button ds-button-secondary ds-button-small">Upload logo<input type="file" class="ds-visually-hidden" :accept="accept" @change="($event.target as HTMLInputElement).files?.[0] && emit('change', ($event.target as HTMLInputElement).files![0])" /></label></div>
  </div>
</template>
