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

function sampleMessages(nextScenario: WidgetScenario): WidgetMessage[] {
  const assistantName = (props.assistantName || "AI front desk")
    .replace(/\s+AI Assistant$/i, "")
    .replace(/\s+Assistant$/i, "")
    .trim() || "AI front desk";
  const businessName = props.businessName || "Your business";
  const welcome: WidgetMessage = { id: "preview-welcome", role: "assistant", content: props.welcomeMessage || `Hi! I'm the ${assistantName} assistant. I can answer questions, help you explore features, or get you started.` };
  const question: WidgetMessage = { id: "preview-question", role: "user", content: `What services does ${businessName} offer?` };
  const answer: WidgetMessage = { id: "preview-answer", role: "assistant", content: `${businessName} can answer questions, explain its services, and help visitors take the next step.` };
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
      <div class="preview-site-body">
        <div class="preview-site-simulation" aria-label="Simulated website frame">
          <div class="preview-site-nav"><strong>{{ businessName || 'Your business' }}</strong><span>Services</span><span>About</span><span>Contact</span></div>
          <div class="preview-site-copy"><span class="preview-badge">WELCOME TO {{ (businessName || 'YOUR BUSINESS').toUpperCase() }}</span><h4>Helpful answers, right away.</h4><p>Your visitors can explore services, get grounded answers, and take the next step with your AI front desk.</p><div class="preview-site-pills"><span></span><span></span><span></span></div></div>
        </div>
        <div class="preview-site-state"><span class="preview-site-state-dot"></span>Simulated website frame</div>
        <div ref="previewMount" class="widget-preview-stage"></div>
      </div>
    </div>
    <p class="preview-note">The chatbot above uses the production widget renderer. This website frame is simulated, so external sites and their framing policies never affect the preview.</p>
  </div>
</template>

<style scoped>
.agent-preview-shell { width: 100%; max-width: 100%; min-width: 0; overflow: hidden; }
.agent-preview-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 10px; }
.agent-preview-toolbar h3 { margin: 0; color: #14233d; font-size: 17px; letter-spacing: -.025em; }
.preview-toolbar-controls { display: flex; align-items: center; gap: 8px; }
.preview-scenario { display: inline-flex; align-items: center; gap: 6px; color: #687892; font-size: 10px; font-weight: 750; }
.preview-scenario select { min-height: 30px; padding: 5px 24px 5px 8px; border: 1px solid #d7e0eb; border-radius: 7px; color: #14233d; background: #fff; font-size: 10px; font-weight: 700; }
.preview-mode-toggle { display: flex; align-items: center; gap: 3px; padding: 3px; border: 1px solid #d7e0eb; border-radius: 7px; background: #eef2f7; }
.preview-mode-toggle button { padding: 6px 9px; border: 0; border-radius: 5px; color: #687892; background: transparent; font-size: 11px; font-weight: 700; }
.preview-mode-toggle button.active { color: #14233d; background: #fff; box-shadow: 0 1px 2px rgba(20,42,74,.12); }
.customer-preview { position: relative; width: 100%; max-width: 100%; min-height: 620px; overflow: hidden; border: 1px solid #dfe6ef; border-radius: 14px; background: #eaf7fc; box-shadow: 0 18px 45px rgba(20,42,74,.08); }
.customer-preview.preview-mobile { width: min(100%, 390px); min-height: 680px; margin: 0 auto; }
.preview-site-bar { position: relative; z-index: 5; display: flex; align-items: center; gap: 6px; padding: 12px 15px; color: #8795a8; background: #f8fafc; font-size: 10px; }
.preview-site-bar > span:last-child { flex: 1; margin-left: 5px; padding: 6px 9px; overflow: hidden; border-radius: 6px; background: #fff; text-overflow: ellipsis; white-space: nowrap; }
.preview-site-body { position: relative; min-height: 574px; overflow: hidden; background: linear-gradient(135deg, #dff5fb, #effafe 50%, #d6edf8); }
.preview-mobile .preview-site-body { min-height: 640px; }
.preview-site-simulation { position: absolute; z-index: 0; inset: 0; overflow: hidden; background: linear-gradient(135deg, #dff5fb, #effafe 50%, #d6edf8); }
.preview-site-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 17px 22px; color: #2b6489; background: rgba(255,255,255,.85); font-size: 10px; }
.preview-site-nav strong { color: #164c86; font-size: 12px; }
.preview-site-copy { padding: 60px 28px; color: #155277; }
.preview-badge { color: #2f80ed; font-size: 9px; font-weight: 800; letter-spacing: .12em; }
.preview-site-copy h4 { max-width: 320px; margin: 12px 0 8px; color: #125687; font-size: 34px; line-height: 1; letter-spacing: -.06em; }
.preview-site-copy p { max-width: 250px; color: #4a7e9c; font-size: 12px; line-height: 1.5; }
.preview-site-pills { display: flex; gap: 7px; margin-top: 22px; }
.preview-site-pills span { width: 44px; height: 7px; border-radius: 99px; background: rgba(47,128,237,.28); }
.preview-site-pills span:first-child { width: 78px; background: rgba(47,128,237,.68); }
.preview-site-state { position: absolute; z-index: 1; top: 20px; left: 20px; display: inline-flex; align-items: center; gap: 7px; padding: 7px 9px; border-radius: 7px; color: #58728f; background: rgba(255,255,255,.84); font-size: 10px; transform: none; }
.preview-site-state-dot { width: 7px; height: 7px; border-radius: 50%; background: #2f80ed; animation: preview-pulse 1s infinite ease-in-out; }
.widget-preview-stage { position: absolute; z-index: 4; inset: 0; container-name: fdw-preview; container-type: inline-size; }
.preview-note { margin: 10px 0 0; color: #687892; font-size: 11px; line-height: 1.5; }
@keyframes preview-pulse { 0%, 100% { opacity: .35; } 50% { opacity: 1; } }
@media (max-width: 760px) { .agent-preview-toolbar { align-items: flex-start; flex-direction: column; } .preview-toolbar-controls { width: 100%; justify-content: space-between; } }
</style>
