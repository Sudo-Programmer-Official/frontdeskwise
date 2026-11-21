<script setup lang="ts">
import { computed } from "vue";
import { markdownToSafeHtml } from "../widget-ui/markdown";

const props = defineProps<{ content: string }>();
const safeHtml = computed(() => markdownToSafeHtml(props.content));
</script>

<template>
  <div class="assistant-markdown" v-html="safeHtml"></div>
</template>

<style scoped>
.assistant-markdown { overflow-wrap: anywhere; }
.assistant-markdown :deep(p) { margin: 0 0 9px; }
.assistant-markdown :deep(p:last-child) { margin-bottom: 0; }
.assistant-markdown :deep(ol), .assistant-markdown :deep(ul) { margin: 7px 0 9px; padding-left: 21px; }
.assistant-markdown :deep(li + li) { margin-top: 4px; }
.assistant-markdown :deep(a) { color: #1769c2; text-decoration: underline; text-underline-offset: 2px; }
.assistant-markdown :deep(code) { padding: 1px 4px; border-radius: 4px; color: #244d7e; background: #edf4fc; font-size: .92em; }
</style>
