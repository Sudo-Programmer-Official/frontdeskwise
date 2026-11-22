<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  createWidgetRenderer,
  type WidgetAction,
  type WidgetConfig,
  type WidgetMessage,
  type WidgetRendererController,
  type WidgetScenario,
  type WidgetState,
} from "../widget-ui/renderer";

interface QuickAction { label: string; question: string; }

const props = withDefaults(defineProps<{
  assistantName: string;
  welcomeMessage: string;
  businessName: string;
  websiteUrl: string;
  websitePreviewEndpoint?: string;
  websitePreviewToken?: string;
  widgetColor: string;
  widgetTheme?: "light" | "dark" | "auto";
  widgetPosition?: "bottom-right" | "bottom-left";
  widgetDefaultMode?: "compact" | "expanded" | "fullscreen";
  widgetAllowExpand?: boolean;
  widgetLogoUrl?: string;
  quickActions: QuickAction[];
  proactiveEnabled?: boolean;
  proactiveMessage?: string;
  proactiveBehavior?: "teaser" | "open";
  showLeadCapture?: boolean;
  requireLeadConsent?: boolean;
  privacyNoticeUrl?: string;
  showAiDisclosure?: boolean;
  citationVisibility?: "always" | "contextual" | "hidden";
  tone?: "friendly" | "professional" | "concise" | "custom";
  fallbackBehavior?: "contact_form" | "human" | "unavailable";
  humanHandoffEnabled?: boolean;
  showScenarioSelector?: boolean;
  scenario?: WidgetScenario;
  state?: Partial<WidgetState>;
  mode?: "desktop" | "mobile";
}>(), {
  widgetTheme: "auto",
  widgetPosition: "bottom-right",
  widgetDefaultMode: "compact",
  widgetAllowExpand: true,
  widgetLogoUrl: "",
  proactiveEnabled: false,
  proactiveMessage: "Looking for the right service? I can help.",
  proactiveBehavior: "teaser",
  showLeadCapture: true,
  requireLeadConsent: false,
  privacyNoticeUrl: "",
  showAiDisclosure: true,
  citationVisibility: "always",
  tone: "friendly",
  fallbackBehavior: "contact_form",
  humanHandoffEnabled: true,
  showScenarioSelector: true,
  scenario: "conversation",
  mode: "desktop",
});

const emit = defineEmits<{
  (event: "change-mode", mode: "desktop" | "mobile"): void;
  (event: "change-scenario", scenario: WidgetScenario): void;
  (event: "ask", question: string): void;
  (event: "submit-action", payload: { action: WidgetAction; values: Record<string, string> }): void;
}>();

const previewMount = ref<HTMLElement | null>(null);
const previewMode = ref(props.mode);
const scenario = ref<WidgetScenario>(props.scenario);
const handoffNoticeDismissed = ref(false);
const proactiveDismissed = ref(false);
let renderer: WidgetRendererController | null = null;
let handoffNoticeTimer: number | null = null;

const scenarioOptions: Array<{ label: string; value: WidgetScenario }> = [
  { label: "Default", value: "default" },
  { label: "Conversation", value: "conversation" },
  { label: "Quick actions", value: "quick-actions" },
  { label: "Lead form", value: "lead-form" },
  { label: "Human handoff", value: "human-handoff" },
  { label: "Staff joined", value: "staff-joined" },
  { label: "Safe fallback", value: "safe-fallback" },
  { label: "Source citation", value: "source-citation" },
  { label: "Completion action", value: "completion-action" },
];

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
const websitePreviewErrorReason = ref<"security_policy" | "unavailable" | null>(null);
let previewTimeout: number | null = null;
let previewProbeVersion = 0;

function clearPreviewTimeout(): void {
  if (previewTimeout !== null) {
    window.clearTimeout(previewTimeout);
    previewTimeout = null;
  }
}

function clearHandoffNoticeTimer(): void {
  if (handoffNoticeTimer !== null) {
    window.clearTimeout(handoffNoticeTimer);
    handoffNoticeTimer = null;
  }
}

function armHandoffNoticeTimer(): void {
  clearHandoffNoticeTimer();
  if (scenario.value !== "human-handoff") return;
  handoffNoticeTimer = window.setTimeout(() => {
    handoffNoticeTimer = null;
    handoffNoticeDismissed.value = true;
    syncRenderer();
  }, 6000);
}

function resetWebsitePreview(url: string): void {
  clearPreviewTimeout();
  websitePreviewErrorReason.value = null;
  websitePreviewState.value = url ? "loading" : "empty";
  if (url) {
    previewTimeout = window.setTimeout(() => {
      if (websitePreviewState.value === "loading") websitePreviewState.value = "error";
    }, 8000);
  }
}

async function checkWebsitePreview(url: string): Promise<void> {
  const version = ++previewProbeVersion;
  clearPreviewTimeout();
  websitePreviewErrorReason.value = null;
  websitePreviewState.value = url ? "loading" : "empty";
  if (!url) return;

  const endpoint = props.websitePreviewEndpoint?.trim();
  if (!endpoint) {
    resetWebsitePreview(url);
    return;
  }

  try {
    const response = await fetch(endpoint, {
      headers: props.websitePreviewToken?.trim() ? { authorization: `Bearer ${props.websitePreviewToken.trim()}` } : {},
      credentials: "same-origin",
    });
    if (version !== previewProbeVersion) return;
    if (response.ok) {
      const payload = await response.json() as { embeddable?: boolean; reason?: "security_policy" | "unavailable" | null };
      if (payload.embeddable === false) {
        websitePreviewErrorReason.value = payload.reason === "security_policy" ? "security_policy" : "unavailable";
        websitePreviewState.value = "error";
        return;
      }
    }
  } catch {
    // If the probe is unavailable, retain the direct iframe attempt. The
    // timeout/error state below still gives the owner a useful fallback.
  }
  if (version !== previewProbeVersion) return;
  websitePreviewState.value = "loading";
  previewTimeout = window.setTimeout(() => {
    if (websitePreviewState.value === "loading") {
      websitePreviewErrorReason.value = "unavailable";
      websitePreviewState.value = "error";
    }
  }, 8000);
}

function markWebsitePreviewReady(): void {
  clearPreviewTimeout();
  websitePreviewErrorReason.value = null;
  websitePreviewState.value = "ready";
}

function markWebsitePreviewError(): void {
  clearPreviewTimeout();
  websitePreviewErrorReason.value = "unavailable";
  websitePreviewState.value = "error";
}

function sampleMessages(nextScenario: WidgetScenario): WidgetMessage[] {
  const assistantName = (props.assistantName || "PlanCraftAI assistant")
    .replace(/\s+AI Assistant$/i, "")
    .replace(/\s+Assistant$/i, "")
    .trim() || "PlanCraftAI";
  const businessName = props.businessName || "PlanCraftAI";
  const welcome: WidgetMessage = { id: "preview-welcome", role: "assistant", content: props.welcomeMessage || `Hi! I'm the ${assistantName} assistant. I can answer questions, help you explore features, or get you started.` };
  const question: WidgetMessage = { id: "preview-question", role: "user", content: "What services does PlanCraftAI offer?" };
  const answer: WidgetMessage = { id: "preview-answer", role: "assistant", content: `${businessName} helps with voice planning, scheduling, reminders, and task intelligence.` };
  const fallback: WidgetMessage = { id: "preview-fallback", role: "assistant", content: "I don’t have enough verified information to answer that confidently. I can help you contact the team if you’d like." };
  if (nextScenario === "default" || nextScenario === "quick-actions" || nextScenario === "lead-form" || nextScenario === "completion-action") return [welcome];
  if (nextScenario === "safe-fallback") return [welcome, { id: "preview-fallback-question", role: "user", content: "Can you guarantee a result you do not have in your knowledge?" }, fallback];
  if (nextScenario === "source-citation") return [welcome, question, { ...answer, citations: [{ title: `${businessName} services`, url: previewWebsiteUrl.value || "https://example.com" }] }];
  return [welcome, question, answer];
}

const widgetConfig = computed<WidgetConfig>(() => ({
  assistantName: props.assistantName || "AI front desk",
  welcomeMessage: props.welcomeMessage || "Hi! How can I help?",
  widgetColor: props.widgetColor,
  widgetTheme: props.widgetTheme,
  widgetPosition: props.widgetPosition,
  widgetDefaultMode: props.widgetDefaultMode,
  widgetAllowExpand: props.widgetAllowExpand,
  widgetLogoUrl: props.widgetLogoUrl,
  widgetQuickActions: props.quickActions,
  showAiDisclosure: props.showAiDisclosure,
  showPoweredBy: true,
  showSources: true,
  citationVisibility: props.citationVisibility,
  showLeadCapture: props.showLeadCapture,
  requireLeadConsent: props.requireLeadConsent,
  privacyNoticeUrl: props.privacyNoticeUrl || null,
  fallbackBehavior: props.fallbackBehavior,
  humanHandoffEnabled: props.humanHandoffEnabled,
  tone: props.tone,
}));

const widgetState = computed<WidgetState>(() => {
  const nextScenario = scenario.value;
  const sampleState: WidgetState = {
    isOpen: true,
    messages: sampleMessages(nextScenario),
    quickActions: nextScenario === "default" || nextScenario === "quick-actions" ? props.quickActions : [],
    leadVisible: nextScenario === "lead-form" || (nextScenario === "safe-fallback" && props.fallbackBehavior === "contact_form"),
    action: nextScenario === "completion-action" ? {
      id: "preview-completion-action",
      status: "active",
      form: {
        submitLabel: "Get started",
        fields: [
          { key: "name", label: "Name", type: "text", required: true },
          { key: "email", label: "Email", type: "email", required: true },
        ],
      },
    } : null,
    handoffStatus: nextScenario === "human-handoff" ? "WAITING_FOR_STAFF" : nextScenario === "staff-joined" ? "HUMAN_ACTIVE" : "AI_ACTIVE",
    handoffNotice: nextScenario === "human-handoff" && !handoffNoticeDismissed.value ? { visible: true, message: "You still have a conversation waiting for the team.", choice: true } : { visible: false, message: "" },
    proactive: props.proactiveEnabled && props.proactiveBehavior === "teaser" && nextScenario === "default" && !proactiveDismissed.value ? { visible: true, message: props.proactiveMessage || "Looking for the right service? I can help." } : { visible: false, message: "" },
  };
  if (props.state) return { ...sampleState, ...props.state, messages: props.state.messages ?? sampleState.messages, quickActions: props.state.quickActions ?? sampleState.quickActions };
  return sampleState;
});

function syncRenderer(): void {
  if (!renderer) return;
  renderer.update({ config: widgetConfig.value, state: widgetState.value });
}

function selectScenario(nextScenario: WidgetScenario): void {
  scenario.value = nextScenario;
  handoffNoticeDismissed.value = false;
  proactiveDismissed.value = false;
  armHandoffNoticeTimer();
  emit("change-scenario", nextScenario);
  syncRenderer();
}

function handleAsk(question: string): void {
  emit("ask", question);
}

watch([previewWebsiteUrl, () => props.websitePreviewEndpoint, () => props.websitePreviewToken], ([url]) => { void checkWebsitePreview(url); }, { immediate: true });
watch(() => props.mode, (nextMode) => { previewMode.value = nextMode; });
watch(() => props.scenario, (nextScenario) => { if (nextScenario) { scenario.value = nextScenario; handoffNoticeDismissed.value = false; proactiveDismissed.value = false; armHandoffNoticeTimer(); } });
watch([widgetConfig, widgetState], syncRenderer, { deep: true });

onMounted(() => {
  armHandoffNoticeTimer();
  if (!previewMount.value) return;
  renderer = createWidgetRenderer(previewMount.value, {
    surface: "preview",
    config: widgetConfig.value,
    state: widgetState.value,
    onAsk: handleAsk,
    onActionSubmit: (values, action) => emit("submit-action", { action, values }),
    onHandoffDismiss: () => {
      handoffNoticeDismissed.value = true;
      clearHandoffNoticeTimer();
      syncRenderer();
    },
    onHandoffContinue: () => {
      handoffNoticeDismissed.value = true;
      clearHandoffNoticeTimer();
      syncRenderer();
    },
    onNewConversation: () => {
      selectScenario("conversation");
    },
    onProactiveDismiss: () => {
      proactiveDismissed.value = true;
      syncRenderer();
    },
  });
});

onBeforeUnmount(() => {
  clearPreviewTimeout();
  clearHandoffNoticeTimer();
  renderer?.destroy();
  renderer = null;
});
</script>

<template>
  <div class="agent-preview-shell">
    <div class="agent-preview-toolbar">
      <div><p class="ds-section-kicker">Customer view</p><h3>Live preview</h3></div>
      <div class="preview-toolbar-controls">
        <label v-if="showScenarioSelector" class="preview-scenario">Owner QA <select :value="scenario" aria-label="Preview scenario" @change="selectScenario(($event.target as HTMLSelectElement).value as WidgetScenario)"><option v-for="option in scenarioOptions" :key="option.value" :value="option.value">{{ option.label }}</option></select></label>
        <div class="preview-mode-toggle"><button type="button" :class="{ active: previewMode === 'desktop' }" @click="emit('change-mode', 'desktop')">Desktop</button><button type="button" :class="{ active: previewMode === 'mobile' }" @click="emit('change-mode', 'mobile')">Mobile</button></div>
      </div>
    </div>
    <div aria-label="Widget preview" :class="['customer-preview', `preview-${previewMode}`, `theme-${widgetTheme}`, `position-${widgetPosition}`]">
      <div class="preview-site-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ previewWebsiteUrl || websiteUrl || 'yourbusiness.com' }}</span></div>
      <div class="preview-site-body" :class="{ 'preview-site-body-fallback': websitePreviewState === 'error' || websitePreviewState === 'empty' }">
        <iframe v-if="previewWebsiteUrl && websitePreviewState !== 'error'" :key="previewWebsiteUrl" class="preview-website-frame" :src="previewWebsiteUrl" :title="`Website preview for ${businessName || 'your business'}`" loading="eager" referrerpolicy="strict-origin-when-cross-origin" @load="markWebsitePreviewReady" @error="markWebsitePreviewError"></iframe>
        <div v-if="websitePreviewState === 'loading'" class="preview-site-state" aria-live="polite"><span class="preview-site-state-dot"></span>Loading your website…</div>
        <div v-else-if="websitePreviewState === 'error'" class="preview-site-error"><p class="ds-section-kicker">Website preview unavailable</p><strong>{{ previewWebsiteUrl || websiteUrl }}</strong><p>{{ websitePreviewErrorReason === 'security_policy' ? 'This website is connected to knowledge, but its security policy does not allow a live embedded preview here.' : 'This website could not be loaded in the live preview right now.' }} Open it in a new tab to view the live page.</p><a :href="previewWebsiteUrl || websiteUrl" target="_blank" rel="noreferrer">Open website in a new tab</a></div>
        <div v-else-if="websitePreviewState === 'empty'" class="preview-site-error"><p class="ds-section-kicker">Add a website to preview</p><strong>{{ businessName || 'Your business' }}</strong><p>Once a public website is connected, the live page will appear behind the assistant.</p></div>
        <div ref="previewMount" class="widget-preview-stage"></div>
      </div>
    </div>
    <p class="preview-note">The chatbot above uses the production widget renderer. The website frame and sample data are preview-only.</p>
  </div>
</template>

<style scoped>
.agent-preview-shell { min-width: 0; }
.agent-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 10px; }
.agent-preview-toolbar h3 { margin: 0; color: #14233d; font-size: 17px; letter-spacing: -.025em; }
.preview-toolbar-controls { display: flex; align-items: center; gap: 8px; }
.preview-scenario { display: inline-flex; align-items: center; gap: 6px; color: #687892; font-size: 10px; font-weight: 750; }
.preview-scenario select { min-height: 30px; padding: 5px 24px 5px 8px; border: 1px solid #d7e0eb; border-radius: 7px; color: #14233d; background: #fff; font-size: 10px; font-weight: 700; }
.preview-mode-toggle { display: flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid #d7e0eb; border-radius: 7px; background: #eef2f7; }
.preview-mode-toggle button { padding: 6px 9px; border: 0; border-radius: 5px; color: #687892; background: transparent; font-size: 11px; font-weight: 700; }
.preview-mode-toggle button.active { color: #14233d; background: #fff; box-shadow: 0 1px 2px rgba(20,42,74,.12); }
.customer-preview { position: relative; min-height: 570px; overflow: hidden; border: 1px solid #dfe6ef; border-radius: 14px; background: #eaf7fc; box-shadow: 0 18px 45px rgba(20,42,74,.08); }
.customer-preview.preview-mobile { width: min(100%, 390px); min-height: 680px; margin: 0 auto; }
.preview-site-bar { position: relative; z-index: 5; display: flex; align-items: center; gap: 6px; padding: 12px 15px; color: #8795a8; background: #f8fafc; font-size: 10px; }
.preview-site-bar > span:last-child { flex: 1; margin-left: 5px; padding: 6px 9px; overflow: hidden; border-radius: 6px; background: #fff; text-overflow: ellipsis; white-space: nowrap; }
.preview-site-body { position: relative; min-height: 526px; overflow: hidden; background: linear-gradient(135deg, #dff5fb, #effafe 50%, #d6edf8); }
.preview-mobile .preview-site-body { min-height: 640px; }
.preview-site-body-fallback { display: grid; place-items: center; }
.preview-website-frame { position: absolute; z-index: 0; inset: 0; width: 100%; height: 100%; border: 0; background: #fff; }
.preview-site-state { position: absolute; z-index: 1; top: 20px; left: 20px; display: inline-flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 7px; color: #58728f; background: rgba(255,255,255,.84); font-size: 10px; }
.preview-site-state-dot { width: 7px; height: 7px; border-radius: 50%; background: #2f80ed; animation: preview-pulse 1s infinite ease-in-out; }
.preview-site-error { position: relative; z-index: 1; width: min(270px, calc(100% - 44px)); padding: 18px; border: 1px solid rgba(205,225,239,.95); border-radius: 12px; color: #4d7897; background: rgba(255,255,255,.82); box-shadow: 0 12px 30px rgba(20,42,74,.08); font-size: 11px; line-height: 1.45; }
.preview-site-error strong { display: block; overflow: hidden; color: #164c86; text-overflow: ellipsis; white-space: nowrap; }
.preview-site-error p:not(.ds-section-kicker) { margin: 8px 0 0; }
.preview-site-error a { display: inline-block; margin-top: 10px; color: #1769e8; font-weight: 750; }
.widget-preview-stage { position: absolute; z-index: 4; inset: 0; container-name: fdw-preview; container-type: inline-size; }
.preview-note { margin: 10px 0 0; color: #687892; font-size: 11px; line-height: 1.5; }
@keyframes preview-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (max-width: 760px) { .agent-preview-toolbar { align-items: flex-start; flex-direction: column; } .preview-toolbar-controls { width: 100%; justify-content: space-between; } }
</style>
