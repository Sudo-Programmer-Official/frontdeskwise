<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { ChevronRight, Send } from "@lucide/vue";
import { getAccessibleTextColor, isHexColor } from "../utils/color";

interface QuickAction { label: string; question: string; }

const props = withDefaults(defineProps<{
  assistantName: string;
  welcomeMessage: string;
  businessName: string;
  websiteUrl: string;
  widgetColor: string;
  widgetTheme?: "light" | "dark" | "auto";
  widgetPosition?: "bottom-right" | "bottom-left";
  widgetLogoUrl?: string;
  quickActions: QuickAction[];
  showLeadCapture?: boolean;
  mode?: "desktop" | "mobile";
}>(), { widgetTheme: "auto", widgetPosition: "bottom-right", widgetLogoUrl: "", showLeadCapture: true, mode: "desktop" });
const emit = defineEmits<{ (event: "change-mode", mode: "desktop" | "mobile"): void }>();

const safeColor = computed(() => isHexColor(props.widgetColor) ? props.widgetColor : "#2563EB");
const textColor = computed(() => getAccessibleTextColor(safeColor.value));
const previewWebsiteUrl = computed(() => {
  const rawUrl = props.websiteUrl.trim();
  if (!rawUrl) return "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
});
const websitePreviewState = ref<"empty" | "loading" | "ready" | "error">("empty");
let previewTimeout: number | null = null;

function clearPreviewTimeout(): void {
  if (previewTimeout !== null) {
    window.clearTimeout(previewTimeout);
    previewTimeout = null;
  }
}

function resetWebsitePreview(url: string): void {
  clearPreviewTimeout();
  websitePreviewState.value = url ? "loading" : "empty";
  if (url) {
    previewTimeout = window.setTimeout(() => {
      if (websitePreviewState.value === "loading") websitePreviewState.value = "error";
    }, 8000);
  }
}

function markWebsitePreviewReady(): void {
  clearPreviewTimeout();
  websitePreviewState.value = "ready";
}

function markWebsitePreviewError(): void {
  clearPreviewTimeout();
  websitePreviewState.value = "error";
}

watch(previewWebsiteUrl, resetWebsitePreview, { immediate: true });
onBeforeUnmount(clearPreviewTimeout);
</script>

<template>
  <div class="agent-preview-shell">
    <div class="agent-preview-toolbar"><div><p class="ds-section-kicker">Customer view</p><h3>Live preview</h3></div><div class="preview-mode-toggle"><button type="button" :class="{ active: mode === 'desktop' }" @click="emit('change-mode', 'desktop')">Desktop</button><button type="button" :class="{ active: mode === 'mobile' }" @click="emit('change-mode', 'mobile')">Mobile</button></div></div>
    <div aria-label="Widget preview" :class="['customer-preview', `preview-${mode}`, `theme-${widgetTheme}`, `position-${widgetPosition}`]" :style="{ '--preview-accent': safeColor, '--preview-accent-text': textColor }">
      <div class="preview-site-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ previewWebsiteUrl || websiteUrl || 'yourbusiness.com' }}</span></div>
      <div class="preview-site-body" :class="{ 'preview-site-body-fallback': websitePreviewState === 'error' || websitePreviewState === 'empty' }">
        <iframe v-if="previewWebsiteUrl && websitePreviewState !== 'error'" :key="previewWebsiteUrl" class="preview-website-frame" :src="previewWebsiteUrl" :title="`Website preview for ${businessName || 'your business'}`" loading="eager" referrerpolicy="strict-origin-when-cross-origin" @load="markWebsitePreviewReady" @error="markWebsitePreviewError"></iframe>
        <div v-if="websitePreviewState === 'loading'" class="preview-site-state" aria-live="polite"><span class="preview-site-state-dot"></span>Loading your website…</div>
        <div v-else-if="websitePreviewState === 'error'" class="preview-site-error"><p class="ds-section-kicker">Website preview unavailable</p><strong>{{ previewWebsiteUrl || websiteUrl }}</strong><p>This website does not allow embedded previews here. Open it in a new tab to view the live page.</p><a :href="previewWebsiteUrl || websiteUrl" target="_blank" rel="noreferrer">Open website in a new tab</a></div>
        <div v-else-if="websitePreviewState === 'empty'" class="preview-site-error"><p class="ds-section-kicker">Add a website to preview</p><strong>{{ businessName || 'Your business' }}</strong><p>Once a public website is connected, the live page will appear behind the assistant.</p></div>
        <div class="preview-chat">
          <div class="preview-chat-header"><span class="preview-orb" :style="{ background: safeColor, color: textColor }"><img v-if="widgetLogoUrl" :src="widgetLogoUrl" alt="" /><img v-else src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><span>{{ assistantName || 'AI assistant' }}</span><span class="online-dot"></span></div>
          <div class="preview-chat-bubble">{{ welcomeMessage || 'Hi! How can I help?' }}</div>
          <button v-for="action in quickActions.slice(0, 3)" :key="action.label" class="preview-suggested-action" type="button">{{ action.label }} <ChevronRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button>
          <div v-if="showLeadCapture" class="preview-form-simulation"><strong>Let's get your details</strong><label>Name <span class="preview-required">*</span><input placeholder="Your name" /></label><label>Email <span class="preview-required">*</span><input placeholder="you@example.com" /></label><label>Phone <span class="preview-optional">Optional</span><input placeholder="(555) 555-0123" /></label><button type="button" :style="{ background: safeColor, color: textColor }">Continue</button></div>
          <div class="preview-chat-input">Ask a question… <Send :size="14" :stroke-width="1.8" :style="{ color: safeColor }" aria-hidden="true" /></div>
        </div>
      </div>
    </div>
    <p class="preview-note">Updates appear here as you edit. This is the same form language used by the published widget.</p>
  </div>
</template>
