<script setup lang="ts">
import { computed } from "vue";
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
</script>

<template>
  <div class="agent-preview-shell">
    <div class="agent-preview-toolbar"><div><p class="ds-section-kicker">Customer view</p><h3>Live preview</h3></div><div class="preview-mode-toggle"><button type="button" :class="{ active: mode === 'desktop' }" @click="emit('change-mode', 'desktop')">Desktop</button><button type="button" :class="{ active: mode === 'mobile' }" @click="emit('change-mode', 'mobile')">Mobile</button></div></div>
    <div aria-label="Widget preview" :class="['customer-preview', `preview-${mode}`, `theme-${widgetTheme}`, `position-${widgetPosition}`]" :style="{ '--preview-accent': safeColor, '--preview-accent-text': textColor }">
      <div class="preview-site-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ websiteUrl || 'yourbusiness.com' }}</span></div>
      <div class="preview-site-body">
        <div class="preview-site-nav"><strong>{{ businessName || 'Your business' }}</strong><span>Services　About　Contact</span></div>
        <div class="preview-site-copy"><span class="preview-badge">AI FRONT DESK · ONLINE</span><h4>More answers.<br />More confidence.</h4><p>Grounded answers from {{ businessName || 'your website' }}.</p></div>
        <div class="preview-chat">
          <div class="preview-chat-header"><span class="preview-orb" :style="{ background: safeColor, color: textColor }"><img v-if="widgetLogoUrl" :src="widgetLogoUrl" alt="" /><span v-else>✦</span></span><span>{{ assistantName || 'AI assistant' }}</span><span class="online-dot"></span></div>
          <div class="preview-chat-bubble">{{ welcomeMessage || 'Hi! How can I help?' }}</div>
          <button v-for="action in quickActions.slice(0, 3)" :key="action.label" class="preview-suggested-action" type="button">{{ action.label }} <span>›</span></button>
          <div v-if="showLeadCapture" class="preview-form-simulation"><strong>Let's get your details</strong><label>Name <span class="preview-required">*</span><input placeholder="Your name" /></label><label>Email <span class="preview-required">*</span><input placeholder="you@example.com" /></label><label>Phone <span class="preview-optional">Optional</span><input placeholder="(555) 555-0123" /></label><button type="button" :style="{ background: safeColor, color: textColor }">Continue</button></div>
          <div class="preview-chat-input">Ask a question… <span :style="{ color: safeColor }">➤</span></div>
        </div>
      </div>
    </div>
    <p class="preview-note">Updates appear here as you edit. This is the same form language used by the published widget.</p>
  </div>
</template>
