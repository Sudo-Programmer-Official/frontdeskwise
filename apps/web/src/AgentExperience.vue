<script setup lang="ts">
import { computed, reactive, ref, toRef, watch } from "vue";
import { Check, GripVertical, Plus, X } from "@lucide/vue";
import Button from "./components/ui/Button.vue";
import Card from "./components/ui/Card.vue";
import ColorPicker from "./components/ui/ColorPicker.vue";
import FileUpload from "./components/ui/FileUpload.vue";
import FormField from "./components/ui/FormField.vue";
import FormSection from "./components/ui/FormSection.vue";
import Select from "./components/ui/Select.vue";
import SegmentedControl from "./components/ui/SegmentedControl.vue";
import Switch from "./components/ui/Switch.vue";
import TextInput from "./components/ui/TextInput.vue";
import Textarea from "./components/ui/Textarea.vue";
import WidgetPreview from "./components/WidgetPreview.vue";
import { getAccessibleTextColor, isHexColor } from "./utils/color";
import type { WidgetAction, WidgetState } from "./widget-ui/renderer";

type AgentTab = "capabilities" | "behavior" | "knowledge" | "appearance" | "quick-actions" | "actions" | "test" | "install";
type Tone = "friendly" | "professional" | "concise" | "custom";
type FallbackBehavior = "contact_form" | "human" | "unavailable";
type WidgetTheme = "light" | "dark" | "auto";
type WidgetPosition = "bottom-right" | "bottom-left";
type ProactiveTrigger = "delay" | "scroll" | "exit" | "returning";
type ProactiveBehavior = "teaser" | "open";
type ProactiveFrequency = "session" | "24h" | "visit";
type CitationVisibility = "always" | "contextual" | "hidden";
type VerificationMethod = "email" | "meta_tag" | "file" | "dns_txt" | "manual";
type InstallPlatform = "wordpress" | "wix" | "shopify" | "squarespace" | "custom" | "not_sure";
type SupportContactMethod = "email" | "phone";
type AgentPublishStatus = "NOT_PUBLISHED" | "PUBLISHING" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
type CapabilityAction = "integrations" | "actions" | "knowledge" | "agent" | "test" | "overview";

interface AgentPublishing {
  status: Exclude<AgentPublishStatus, "PUBLISHING">;
  domain: string | null;
  publishedAt: string | null;
  configVersion: number | null;
}

interface InstallationSupportPayload {
  name: string;
  platform: InstallPlatform;
  helpRequest: string;
  preferredContactMethod: SupportContactMethod;
  contactValue: string;
  message: string;
  screenshotUrl: string;
}

interface QuickAction {
  label: string;
  question: string;
}

interface AgentModel {
  assistantName: string;
  welcomeMessage: string;
  tone: Tone;
  customToneInstructions: string;
  primaryLanguage: string;
  fallbackBehavior: FallbackBehavior;
  humanHandoffEnabled: boolean;
  widgetColor: string;
  widgetDefaultMode: "compact" | "expanded" | "fullscreen";
  widgetAllowExpand: boolean;
  widgetLogoUrl: string;
  widgetTheme: WidgetTheme;
  widgetPosition: WidgetPosition;
  widgetQuickActions: QuickAction[];
  proactiveEnabled: boolean;
  proactiveDelaySeconds: number;
  proactiveMessage: string;
  proactiveTriggers: ProactiveTrigger[];
  proactiveBehavior: ProactiveBehavior;
  proactiveFrequency: ProactiveFrequency;
  showLeadCapture: boolean;
  showBookingAction: boolean;
  showAiDisclosure: boolean;
  citationVisibility: CitationVisibility;
  requireLeadConsent: boolean;
  privacyNoticeUrl: string;
  retentionDays: number;
  fallbackPhone?: string;
  fallbackEmail?: string;
  fallbackContactUrl?: string;
}

interface TestActionField {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  value?: string;
}

interface TestAction {
  id: string;
  key: string;
  status: "active" | "completed";
  captureMode: "conversational" | "form" | "hybrid";
  nextField?: string;
  linkUrl?: string;
  linkLabel?: string;
  form?: { submitLabel: string; fields: TestActionField[] };
}

interface TestMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  grounded: boolean;
  citations: Array<{ title?: string; url?: string; pageType?: string }>;
  quickActions: Array<{ label: string; question: string }>;
  primaryCta?: { actionId: string; key: string; label: string; executionMode: "DIRECT_LINK" | "FORM_FLOW" | "PROVIDER_FLOW" | "PHONE" | "EMAIL" | "HANDOFF" | "API_ACTION"; trackingKey: string; url?: string; question?: string } | null;
  action: TestAction | null;
  formValues: Record<string, string>;
}

interface TestModel {
  conversationId: string;
  messages: TestMessage[];
  suggestedQuestions: string[];
  isAsking: boolean;
}

interface InstallModel {
  snippet: string;
  siteKey: string;
  verification: { lastLoadedAt: string | null; loadCount: number };
}

interface KnowledgeGap {
  question: string;
  occurrenceCount: number;
  status: "open" | "resolved" | "ignored";
  lastSeenAt: string;
}

interface KnowledgeModel {
  sourceCount: number;
  chunkCount: number;
  openGaps: number;
  pendingSources?: number;
  failedSources?: number;
  status?: string;
  indexed?: boolean;
  sources?: Array<{ lastCrawledAt: string }>;
}

interface AgentCapability {
  id: string;
  title: string;
  description: string;
  ready: boolean;
  target: CapabilityAction;
  actionLabel: string;
}

const props = defineProps<{
  tab: AgentTab;
  businessKey: string;
  businessName: string;
  websiteUrl: string;
  websitePreviewEndpoint: string;
  websitePreviewToken: string;
  websiteBrandColors: string[];
  model: AgentModel;
  savedMessage: string;
  authReady: boolean;
  authUserName: string;
  authUserEmail: string;
  publicDemoMode: boolean;
  billingReadOnly: boolean;
  ownershipStatus: "pending" | "verified" | "rejected" | null;
  publishing: AgentPublishing;
  publishingLoading: boolean;
  install: InstallModel | null;
  installMessage: string;
  verificationMessage: string;
  verificationLoading: boolean;
  verificationMethod: VerificationMethod;
  verificationInstructions: string;
  verificationToken: string;
  ownershipMessage: string;
  ownershipError: string;
  knowledge: KnowledgeModel | null;
  knowledgeGaps: KnowledgeGap[];
  knowledgeReady: boolean;
  agentTested: boolean;
  installationSupportLoading: boolean;
  installationSupportMessage: string;
  installationSupportError: string;
  openSupportRequest: number;
  test: TestModel;
  capabilities: AgentCapability[];
}>();

const emit = defineEmits<{
  (event: "select-tab", tab: AgentTab): void;
  (event: "save", payload: AgentModel): void;
  (event: "publish", payload: AgentModel): void;
  (event: "open-knowledge"): void;
  (event: "view-dashboard"): void;
  (event: "require-auth"): void;
  (event: "copy-snippet"): void;
  (event: "verify-install"): void;
  (event: "refresh-install"): void;
  (event: "start-verification", method: VerificationMethod): void;
  (event: "check-verification"): void;
  (event: "ask-question", question: string): void;
  (event: "submit-action", payload: { messageId: string; actionId: string; values: Record<string, string> }): void;
  (event: "reset-conversation"): void;
  (event: "view-leads"): void;
  (event: "request-install-help", payload: InstallationSupportPayload): void;
  (event: "clear-install-help-message"): void;
  (event: "open-capability-action", target: CapabilityAction): void;
}>();

function cloneModel(model: AgentModel): AgentModel {
  return { ...model, widgetQuickActions: model.widgetQuickActions.map((action) => ({ ...action })) };
}

const draft = ref<AgentModel>(cloneModel(props.model));
const agentDraft = computed(() => draft.value);
const previewMode = ref<"desktop" | "mobile">("desktop");
const quickActionEditorOpen = ref(false);
const editingActionIndex = ref<number | null>(null);
const actionDraft = reactive<QuickAction>({ label: "", question: "" });
const actionLabel = toRef(actionDraft, "label");
const actionQuestion = toRef(actionDraft, "question");
const logoPreview = ref(props.model.widgetLogoUrl);
const logoFileName = ref("");
const testPrompt = ref("");
const sessionHasGroundedAnswer = computed(() => props.test.messages.some((message) => message.role === "assistant" && message.grounded));
const sessionSourceCount = computed(() => new Set(props.test.messages.flatMap((message) => message.citations.map((citation) => citation.url || citation.title || ""))).size);
const sessionHasAction = computed(() => props.test.messages.some((message) => Boolean(message.action)));
const sessionHasCompletedAction = computed(() => props.test.messages.some((message) => message.action?.status === "completed"));
const testCompleted = computed(() => props.agentTested || props.test.messages.some((message) => message.role === "user" && message.content.trim()));
const openKnowledgeGaps = computed(() => props.knowledgeGaps.filter((gap) => gap.status === "open"));
const knowledgeLastUpdated = computed(() => {
  const dates = (props.knowledge?.sources ?? []).map((source) => Date.parse(source.lastCrawledAt)).filter((value) => Number.isFinite(value));
  return dates.length ? new Date(Math.max(...dates)).toLocaleDateString() : "Not indexed yet";
});
const knowledgeStatusLabel = computed(() => props.knowledgeReady ? "Knowledge looks ready." : props.knowledge?.status === "indexing" ? "Knowledge is still indexing." : "Knowledge needs a little more review.");
const testWidgetState = computed<Partial<WidgetState>>(() => {
  const latestAssistant = [...props.test.messages].reverse().find((message) => message.role === "assistant");
  const action = latestAssistant?.action;
  const widgetAction: WidgetAction | null = action ? {
    id: action.id,
    status: action.status,
    linkUrl: action.linkUrl,
    linkLabel: action.linkLabel,
    form: action.form ? {
      submitLabel: action.form.submitLabel,
      fields: action.form.fields.map((field) => ({ id: field.id, key: field.key, label: field.label, type: field.type, required: field.required, options: field.options, value: latestAssistant.formValues[field.key] ?? "" })),
    } : undefined,
  } : null;
  return {
    // Start QA previews collapsed so the website state is visible first.
    // Visitors can still open the production renderer through the launcher.
    isOpen: false,
    messages: [{ id: "test-welcome", role: "assistant", content: agentDraft.value.welcomeMessage || "Hi! How can I help?" }, ...props.test.messages.map((message) => ({ id: message.id, role: message.role, content: message.content, citations: message.citations }))],
    quickActions: latestAssistant?.quickActions ?? [],
    primaryCta: latestAssistant?.primaryCta ?? null,
    action: widgetAction,
    typing: props.test.isAsking,
    handoffStatus: "AI_ACTIVE",
    handoffNotice: { visible: false, message: "" },
  };
});
const localSaved = ref(false);
const installPlatform = ref<InstallPlatform>("custom");
const verificationMethodDraft = ref<VerificationMethod>(props.verificationMethod);
const installInstructions = computed(() => ({
  wordpress: "Add this snippet to a Custom HTML block or your theme footer.",
  wix: "Add an Embed Code element and paste this snippet into the page body.",
  squarespace: "Add a Code Block or paste this snippet in Footer Code Injection.",
  shopify: "Add this snippet to your theme.liquid file before </body>.",
  custom: "Paste this snippet before </body> on your website.",
  not_sure: "We can identify the right place to add this snippet with you.",
}[installPlatform.value]));
const safeWidgetColor = computed(() => isHexColor(draft.value.widgetColor) ? draft.value.widgetColor : "#2563EB");
const accessibleWidgetText = computed(() => getAccessibleTextColor(safeWidgetColor.value));
const publishStatus = computed<AgentPublishStatus>(() => props.publishingLoading ? "PUBLISHING" : props.publishing.status);
const isLive = computed(() => publishStatus.value === "LIVE" || publishStatus.value === "LIVE_WITH_UNPUBLISHED_CHANGES");
const hasUnpublishedChanges = computed(() => publishStatus.value === "LIVE_WITH_UNPUBLISHED_CHANGES");
const toneOptions = ["friendly", "professional", "concise", "custom"].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }));
const themeOptions = ["light", "dark", "auto"].map((value) => ({ label: value[0].toUpperCase() + value.slice(1), value }));
const positionOptions = [{ label: "Bottom right", value: "bottom-right" }, { label: "Bottom left", value: "bottom-left" }];
const openingSizeOptions = [{ label: "Compact", value: "compact" }, { label: "Expanded", value: "expanded" }, { label: "Full screen", value: "fullscreen" }];
const languageOptions = ["English", "Spanish", "French", "Portuguese"].map((value) => ({ label: value, value }));
const fallbackOptions = [{ label: "Offer contact form", value: "contact_form" }, { label: "Request human", value: "human" }, { label: "Say information is unavailable", value: "unavailable" }];
const proactiveBehaviorOptions = [{ label: "Show small prompt", value: "teaser" }, { label: "Open chat automatically", value: "open" }];
const proactiveFrequencyOptions = [{ label: "Once per session", value: "session" }, { label: "Every 24 hours", value: "24h" }, { label: "Every visit", value: "visit" }];
const citationVisibilityOptions: Array<{ label: string; value: CitationVisibility }> = [
  { label: "Always show", value: "always" },
  { label: "When helpful", value: "contextual" },
  { label: "Hide from visitors", value: "hidden" },
];
const supportDrawerOpen = ref(false);
const supportSubmitted = ref(false);
const supportForm = reactive<InstallationSupportPayload>({
  name: props.authUserName,
  platform: "custom",
  helpRequest: "Help me install FrontDeskWise",
  preferredContactMethod: "email",
  contactValue: props.authUserEmail,
  message: "",
  screenshotUrl: "",
});
const supportName = toRef(supportForm, "name");
const supportPlatform = toRef(supportForm, "platform");
const supportHelpRequest = toRef(supportForm, "helpRequest");
const supportPreferredContactMethod = toRef(supportForm, "preferredContactMethod");
const supportContactValue = toRef(supportForm, "contactValue");
const supportMessage = toRef(supportForm, "message");
const supportScreenshotUrl = toRef(supportForm, "screenshotUrl");

function syncModel(model: AgentModel): void {
  draft.value = cloneModel(model);
  logoPreview.value = model.widgetLogoUrl;
  logoFileName.value = "";
}

watch(() => props.businessKey, () => syncModel(props.model));
watch(() => props.model, (model) => syncModel(model), { deep: true });
watch(() => props.verificationMethod, (method) => {
  verificationMethodDraft.value = method;
});
watch(() => props.openSupportRequest, (signal) => {
  if (signal > 0) openSupportDrawer();
}, { immediate: true });
watch(() => props.authUserName, (name) => {
  if (!supportForm.name) supportForm.name = name;
});
watch(() => props.authUserEmail, (email) => {
  if (supportForm.preferredContactMethod === "email") supportForm.contactValue = email;
});

function saveChanges(): void {
  if (!props.authReady) {
    emit("require-auth");
    return;
  }
  if (!isHexColor(draft.value.widgetColor)) return;
  localSaved.value = true;
  window.setTimeout(() => (localSaved.value = false), 2600);
  emit("save", cloneModel(draft.value));
}

function publishDraft(): void {
  if (!testCompleted.value) {
    selectTab("test");
    return;
  }
  emit("publish", cloneModel(draft.value));
}

function hasProactiveTrigger(trigger: ProactiveTrigger): boolean {
  return draft.value.proactiveTriggers.includes(trigger);
}

function toggleProactiveTrigger(trigger: ProactiveTrigger, enabled: boolean): void {
  const next = new Set(draft.value.proactiveTriggers);
  if (enabled) next.add(trigger);
  else next.delete(trigger);
  draft.value.proactiveTriggers = [...next];
}

function selectTab(tab: AgentTab): void {
  emit("select-tab", tab);
}

function handleGoLive(): void {
  if (!testCompleted.value) return;
  if (isLive.value) {
    emit("view-dashboard");
    return;
  }
  emit("publish", cloneModel(draft.value));
}

function startAddAction(): void {
  editingActionIndex.value = null;
  actionDraft.label = "";
  actionDraft.question = "";
  quickActionEditorOpen.value = true;
}

function editAction(index: number): void {
  editingActionIndex.value = index;
  actionDraft.label = draft.value.widgetQuickActions[index]?.label ?? "";
  actionDraft.question = draft.value.widgetQuickActions[index]?.question ?? "";
  quickActionEditorOpen.value = true;
}

function saveAction(): void {
  const action = { label: actionDraft.label.trim(), question: actionDraft.question.trim() };
  if (!action.label || !action.question) return;
  if (editingActionIndex.value === null) draft.value.widgetQuickActions.push(action);
  else draft.value.widgetQuickActions.splice(editingActionIndex.value, 1, action);
  quickActionEditorOpen.value = false;
}

function removeAction(index: number): void {
  draft.value.widgetQuickActions.splice(index, 1);
}

function moveAction(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= draft.value.widgetQuickActions.length) return;
  const [action] = draft.value.widgetQuickActions.splice(index, 1);
  draft.value.widgetQuickActions.splice(nextIndex, 0, action);
}

function previewLogo(file: File): void {
  logoFileName.value = file.name;
  logoPreview.value = URL.createObjectURL(file);
}

function ask(question = testPrompt.value): void {
  const trimmed = question.trim();
  if (!trimmed || props.test.isAsking) return;
  testPrompt.value = trimmed;
  emit("ask-question", trimmed);
  testPrompt.value = "";
}

function submitPreviewAction(payload: { action: WidgetAction; values: Record<string, string> }): void {
  const message = props.test.messages.find((candidate) => candidate.action?.id === payload.action.id);
  if (!message?.action) return;
  emit("submit-action", { messageId: message.id, actionId: message.action.id, values: payload.values });
}

function statusClass(ready: boolean): string {
  return ready ? "status-ready" : "status-pending";
}

function openSupportDrawer(): void {
  supportDrawerOpen.value = true;
  supportSubmitted.value = false;
  emit("clear-install-help-message");
  supportForm.name = props.authUserName;
  supportForm.platform = installPlatform.value;
  supportForm.contactValue = supportForm.preferredContactMethod === "email" ? props.authUserEmail : supportForm.contactValue;
}

function scrollToInstallInstructions(): void {
  document.getElementById("install-code-step")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function submitInstallationSupport(): void {
  if (!supportForm.name.trim() || !supportForm.helpRequest.trim() || !supportForm.contactValue.trim()) return;
  supportSubmitted.value = false;
  emit("request-install-help", { ...supportForm, name: supportForm.name.trim(), helpRequest: supportForm.helpRequest.trim(), contactValue: supportForm.contactValue.trim(), message: supportForm.message.trim(), screenshotUrl: supportForm.screenshotUrl.trim() });
}

function sendDeveloperInstructions(): void {
  const snippet = props.install?.snippet ?? "Complete website verification in FrontDeskWise first to generate the private install snippet.";
  const body = [
    `Hi,`,
    `Please add the FrontDeskWise widget to ${props.websiteUrl || "our website"}.`,
    `Platform: ${installPlatform.value === "not_sure" ? "Not sure" : installPlatform.value}`,
    installInstructions.value,
    "",
    snippet,
    "",
    "Please let me know when it is live so I can check the installation.",
  ].join("\n");
  window.location.href = `mailto:?subject=${encodeURIComponent(`FrontDeskWise installation for ${props.businessName || "our website"}`)}&body=${encodeURIComponent(body)}`;
}

function openLiveWebsite(): void {
  if (props.websiteUrl) window.open(props.websiteUrl, "_blank", "noopener,noreferrer");
}
</script>

<template>
  <!-- WidgetPreview renders the customer surface with aria-label="Widget preview". -->
  <div class="agent-experience">
    <div class="agent-header-row">
      <div>
        <p class="eyebrow">AI front desk</p>
        <div class="agent-title-line"><h2>Agent</h2><span v-if="isLive" class="agent-live-pill">● Live</span></div>
        <p>Configure how your AI front desk behaves, looks, and converts visitors.</p>
      </div>
      <div class="agent-header-actions">
        <span v-if="savedMessage || localSaved" class="saved-message"><Check :size="14" :stroke-width="2" aria-hidden="true" /> {{ savedMessage || "Saved" }}</span>
        <Button v-if="!['capabilities', 'test', 'install'].includes(tab)" variant="primary" size="small" @click="saveChanges">Save changes</Button>
        <Button v-if="tab === 'test'" variant="secondary" size="small" @click="emit('reset-conversation')">Reset conversation</Button>
        <Button v-if="tab === 'install' && publishStatus === 'NOT_PUBLISHED'" variant="primary" size="small" :disabled="ownershipStatus !== 'verified' || billingReadOnly" @click="publishDraft">Publish AI front desk</Button>
        <Button v-if="tab === 'install' && publishStatus === 'PUBLISHING'" variant="primary" size="small" disabled>Publishing…</Button>
        <Button v-if="hasUnpublishedChanges" variant="primary" size="small" :disabled="ownershipStatus !== 'verified' || billingReadOnly" @click="publishDraft">Publish updates</Button>
      </div>
    </div>

    <div v-if="publishStatus === 'LIVE'" class="agent-live-banner" role="status">
      <div><strong>✓ AI front desk is live</strong><span v-if="publishing.domain">Live on {{ publishing.domain }}</span></div>
      <div class="agent-live-actions"><button class="text-button" type="button" @click="openLiveWebsite">View live widget</button><button class="outline-button small" type="button" @click="openLiveWebsite">Open website</button></div>
    </div>
    <div v-else-if="publishStatus === 'LIVE_WITH_UNPUBLISHED_CHANGES'" class="agent-live-banner agent-live-banner-warning" role="status">
      <div><strong>● Live</strong><span>You have unpublished changes. Publish updates from the header when you are ready.</span></div>
    </div>
    <div v-else-if="publishStatus === 'PUBLISHING'" class="agent-live-banner agent-live-banner-publishing" role="status"><strong>Publishing…</strong></div>

    <div v-if="tab === 'capabilities'" class="agent-capabilities-layout">
      <section class="agent-capabilities-intro panel">
        <div>
          <p class="section-kicker">Guidance layer</p>
          <h3>What your AI front desk can do</h3>
          <p>Keep connections in Settings. This view shows which business outcomes are ready and what to set up next.</p>
        </div>
        <span class="capability-summary-count">{{ capabilities.filter((capability) => capability.ready).length }}/{{ capabilities.length }} ready</span>
      </section>
      <section class="agent-capability-list panel" aria-label="Agent capabilities">
        <article v-for="capability in capabilities" :key="capability.id" :class="['agent-capability-row', { ready: capability.ready }]">
          <span :class="['capability-status-icon', { ready: capability.ready }]">{{ capability.ready ? '✓' : '○' }}</span>
          <div class="agent-capability-copy"><strong>{{ capability.title }}</strong><p>{{ capability.description }}</p></div>
          <span :class="['capability-status-label', { ready: capability.ready }]">{{ capability.ready ? 'Ready' : 'Set up' }}</span>
          <button class="capability-action" type="button" @click="emit('open-capability-action', capability.target)">{{ capability.actionLabel }} →</button>
        </article>
      </section>
      <aside class="agent-capabilities-note panel">
        <div><p class="section-kicker">Where connections live</p><h3>Settings is the connection center</h3><p>Agent keeps the outcome visible without duplicating HubSpot, Zapier, webhook, or MCP configuration.</p></div>
        <button class="outline-button small" type="button" @click="emit('open-capability-action', 'integrations')">Open integrations →</button>
      </aside>
    </div>

    <div v-else-if="tab === 'behavior'" class="agent-behavior-layout agent-config-layout">
      <Card class="agent-form-panel agent-settings-panel">
        <FormSection eyebrow="Identity" title="Assistant identity">
          <FormField label="Assistant name" required><TextInput v-model="draft.assistantName" :maxlength="120" /></FormField>
        </FormSection>
        <FormSection eyebrow="Conversation" title="How your assistant speaks">
          <FormField label="Welcome message" required><Textarea v-model="draft.welcomeMessage" :rows="4" :maxlength="1000" /></FormField>
          <div class="field-grid">
            <FormField label="Tone"><SegmentedControl v-model="draft.tone" :options="toneOptions" aria-label="Assistant tone" /></FormField>
            <FormField label="Primary language"><Select v-model="draft.primaryLanguage" :options="languageOptions" placeholder="" /></FormField>
          </div>
          <FormField v-if="draft.tone === 'custom'" label="Custom tone instructions" hint="These instructions guide answer style while keeping customer answers grounded and concise."><Textarea v-model="draft.customToneInstructions" :rows="4" :maxlength="600" placeholder="Warm, direct, and reassuring. Use short paragraphs and avoid jargon." /></FormField>
        </FormSection>
        <FormSection eyebrow="Trust & transparency" title="Answer sources" description="Choose when visitors can open the page used to ground an answer. Sources remain stored for quality review either way.">
          <FormField label="Show answer sources"><SegmentedControl v-model="draft.citationVisibility" :options="citationVisibilityOptions" aria-label="Answer source visibility" /></FormField>
          <p class="form-help">When helpful shows sources for pricing, policy, privacy, service, and other detail-heavy answers.</p>
        </FormSection>
        <FormSection eyebrow="Proactive engagement" title="Invite visitors before they ask" description="Start with a small prompt above the launcher. Visitors can open the full assistant when they are ready.">
          <Switch v-model="draft.proactiveEnabled" label="Engage visitors automatically" description="Show a proactive message when a visitor reaches one of your selected triggers." />
          <template v-if="draft.proactiveEnabled">
            <div class="proactive-trigger-grid">
              <label class="proactive-check"><input type="checkbox" :checked="hasProactiveTrigger('delay')" @change="toggleProactiveTrigger('delay', ($event.target as HTMLInputElement).checked)" /><span><strong>After a few seconds</strong><small>Useful for visitors who pause on a page.</small></span></label>
              <label class="proactive-check"><input type="checkbox" :checked="hasProactiveTrigger('scroll')" @change="toggleProactiveTrigger('scroll', ($event.target as HTMLInputElement).checked)" /><span><strong>After 70% scroll</strong><small>Reach visitors after they engage with the page.</small></span></label>
              <label class="proactive-check"><input type="checkbox" :checked="hasProactiveTrigger('returning')" @change="toggleProactiveTrigger('returning', ($event.target as HTMLInputElement).checked)" /><span><strong>Returning visit</strong><small>Welcome visitors who have been here before.</small></span></label>
              <label class="proactive-check"><input type="checkbox" :checked="hasProactiveTrigger('exit')" @change="toggleProactiveTrigger('exit', ($event.target as HTMLInputElement).checked)" /><span><strong>Exit intent</strong><small>Desktop only; use sparingly for high-intent pages.</small></span></label>
            </div>
            <div v-if="hasProactiveTrigger('delay')" class="proactive-delay-control"><label for="proactive-delay">Delay in seconds</label><input id="proactive-delay" v-model.number="draft.proactiveDelaySeconds" type="number" min="10" max="120" step="5" /><span>10–120 seconds</span></div>
            <FormField label="Message"><Textarea v-model="draft.proactiveMessage" :rows="3" :maxlength="240" placeholder="Want help finding the right solution?" /></FormField>
            <FormField label="Behavior"><SegmentedControl v-model="draft.proactiveBehavior" :options="proactiveBehaviorOptions" aria-label="Proactive engagement behavior" /></FormField>
            <FormField label="Frequency"><SegmentedControl v-model="draft.proactiveFrequency" :options="proactiveFrequencyOptions" aria-label="Proactive engagement frequency" /></FormField>
            <p class="form-help">After a visitor dismisses or opens the prompt, FrontDeskWise respects this frequency and will not keep interrupting them.</p>
          </template>
        </FormSection>
        <FormSection eyebrow="When AI cannot answer" title="Make the next step clear">
          <FormField label="Fallback behavior"><Select v-model="draft.fallbackBehavior" :options="fallbackOptions" placeholder="" /></FormField>
          <Switch v-model="draft.humanHandoffEnabled" label="Human handoff" description="Let visitors ask for your team when they need help." />
          <div class="field-grid">
            <FormField label="Fallback phone" hint="Shown to visitors during an outage."><TextInput v-model="draft.fallbackPhone" type="tel" placeholder="(555) 555-0123" /></FormField>
            <FormField label="Fallback email"><TextInput v-model="draft.fallbackEmail" type="email" placeholder="help@business.com" /></FormField>
          </div>
          <FormField label="Fallback contact page" hint="Optional HTTPS link for support or contact details."><TextInput v-model="draft.fallbackContactUrl" type="url" placeholder="https://business.com/contact" /></FormField>
        </FormSection>
        <section class="agent-section agent-section-footer">
          <div><strong>Conversation behavior is ready to review.</strong><p>Save changes to use this configuration in the live widget.</p></div>
          <Button variant="primary" size="small" @click="saveChanges">Save changes</Button>
        </section>
      </Card>
      <aside class="agent-preview-column"><WidgetPreview :assistant-name="agentDraft.assistantName" :welcome-message="agentDraft.welcomeMessage" :business-name="businessName" :website-url="websiteUrl" :widget-color="safeWidgetColor" :widget-theme="agentDraft.widgetTheme" :widget-position="agentDraft.widgetPosition" :widget-default-mode="agentDraft.widgetDefaultMode" :widget-allow-expand="agentDraft.widgetAllowExpand" :quick-actions="agentDraft.widgetQuickActions" :show-lead-capture="agentDraft.showLeadCapture" :require-lead-consent="agentDraft.requireLeadConsent" :privacy-notice-url="agentDraft.privacyNoticeUrl" :show-ai-disclosure="agentDraft.showAiDisclosure" :citation-visibility="agentDraft.citationVisibility" :tone="agentDraft.tone" :fallback-behavior="agentDraft.fallbackBehavior" :human-handoff-enabled="agentDraft.humanHandoffEnabled" :widget-logo-url="logoPreview || agentDraft.widgetLogoUrl" :proactive-enabled="agentDraft.proactiveEnabled" :proactive-message="agentDraft.proactiveMessage" :proactive-behavior="agentDraft.proactiveBehavior" :mode="previewMode" @change-mode="previewMode = $event" /></aside>
    </div>

    <div v-else-if="tab === 'knowledge'" class="agent-knowledge-layout">
      <article class="agent-knowledge-summary panel">
        <div class="agent-section-heading"><div><p class="section-kicker">Agent context</p><h3>Knowledge readiness</h3><p>Keep this view focused on what the agent can answer. Manage sources and documents in the full Knowledge workspace.</p></div><span :class="['knowledge-readiness-pill', knowledgeReady ? 'ready' : 'needs-review']">{{ knowledgeReady ? 'Ready' : 'Review' }}</span></div>
        <div class="agent-knowledge-metrics"><div><strong>{{ knowledge?.sourceCount ?? 0 }}</strong><small>ready sources</small></div><div><strong>{{ knowledge?.openGaps ?? 0 }}</strong><small>open answer gaps</small></div><div><strong>{{ knowledge?.chunkCount ?? 0 }}</strong><small>indexed chunks</small></div><div><strong>{{ knowledgeLastUpdated }}</strong><small>last indexed</small></div></div>
        <p class="agent-knowledge-status">{{ knowledgeStatusLabel }}</p>
        <div v-if="openKnowledgeGaps.length" class="agent-knowledge-gaps"><strong>Open answer gaps</strong><button v-for="gap in openKnowledgeGaps.slice(0, 3)" :key="gap.question" type="button" @click="emit('open-knowledge')">{{ gap.question }} <span>{{ gap.occurrenceCount }}×</span></button><small v-if="openKnowledgeGaps.length > 3">{{ openKnowledgeGaps.length - 3 }} more gaps in Knowledge</small></div>
        <div class="agent-knowledge-actions"><Button variant="primary" size="small" @click="emit('open-knowledge')">Add knowledge</Button><Button variant="secondary" size="small" @click="emit('open-knowledge')">Review knowledge</Button><Button v-if="openKnowledgeGaps.length" variant="secondary" size="small" @click="emit('open-knowledge')">Review gaps</Button></div>
      </article>
    </div>

    <div v-else-if="tab === 'appearance'" class="agent-config-layout">
      <Card class="agent-form-panel agent-settings-panel">
        <FormSection eyebrow="Brand" title="Appearance" description="Make the front desk feel like part of your website.">
          <FileUpload :filename="logoFileName || (draft.widgetLogoUrl ? 'Current logo' : '')" :preview-url="logoPreview" accept="image/png,image/jpeg,image/svg+xml" @change="previewLogo" />
          <details class="advanced-setting"><summary>Advanced · logo URL</summary><FormField label="Logo URL" hint="Use an HTTPS URL when the logo should persist to the published widget."><TextInput v-model="draft.widgetLogoUrl" type="url" placeholder="https://yourbusiness.com/logo.png" /></FormField></details>
          <FormField label="Brand color" hint="Used for CTAs, accents, focus rings, and quick actions. Text contrast adjusts automatically."><ColorPicker v-model="draft.widgetColor" :website-colors="websiteBrandColors" :website-label="businessName || websiteUrl || 'your website'" /></FormField>
          <p class="accessible-color-note"><span :style="{ background: safeWidgetColor, color: accessibleWidgetText }">Aa</span> Accessible text preview</p>
        </FormSection>
        <FormSection eyebrow="Widget" title="Visitor controls">
          <FormField label="Theme"><SegmentedControl v-model="draft.widgetTheme" :options="themeOptions" aria-label="Widget theme" /></FormField>
          <FormField label="Widget position"><SegmentedControl v-model="draft.widgetPosition" :options="positionOptions" aria-label="Widget position" /></FormField>
          <FormField label="Opening size"><SegmentedControl v-model="draft.widgetDefaultMode" :options="openingSizeOptions" aria-label="Opening size" /></FormField>
          <Switch v-model="draft.widgetAllowExpand" label="Allow expand" description="Visitors can make the assistant larger when they need more room." />
        </FormSection>
        <section class="agent-section agent-section-footer"><div><strong>Visual changes are ready to review.</strong><p>Save changes when the preview feels right.</p></div><Button variant="primary" size="small" @click="saveChanges">Save changes</Button></section>
      </Card>
      <aside class="agent-preview-column"><WidgetPreview :assistant-name="agentDraft.assistantName" :welcome-message="agentDraft.welcomeMessage" :business-name="businessName" :website-url="websiteUrl" :widget-color="safeWidgetColor" :widget-theme="agentDraft.widgetTheme" :widget-position="agentDraft.widgetPosition" :widget-default-mode="agentDraft.widgetDefaultMode" :widget-allow-expand="agentDraft.widgetAllowExpand" :quick-actions="agentDraft.widgetQuickActions" :show-lead-capture="agentDraft.showLeadCapture" :require-lead-consent="agentDraft.requireLeadConsent" :privacy-notice-url="agentDraft.privacyNoticeUrl" :show-ai-disclosure="agentDraft.showAiDisclosure" :citation-visibility="agentDraft.citationVisibility" :tone="agentDraft.tone" :fallback-behavior="agentDraft.fallbackBehavior" :human-handoff-enabled="agentDraft.humanHandoffEnabled" :widget-logo-url="logoPreview || agentDraft.widgetLogoUrl" :proactive-enabled="agentDraft.proactiveEnabled" :proactive-message="agentDraft.proactiveMessage" :proactive-behavior="agentDraft.proactiveBehavior" :mode="previewMode" @change-mode="previewMode = $event" /></aside>
    </div>

    <div v-else-if="tab === 'quick-actions' || tab === 'actions'" class="agent-config-layout">
      <article class="agent-form-panel agent-settings-panel panel">
        <section class="agent-section quick-actions-section"><div class="agent-section-heading action-heading"><div><p class="section-kicker">Guide visitors</p><h3>Quick actions</h3><p>Keep this list short. The same buttons appear in the visitor preview.</p></div><Button variant="primary" size="small" :disabled="agentDraft.widgetQuickActions.length >= 5" @click="startAddAction"><Plus :size="14" :stroke-width="2" aria-hidden="true" /> Add quick action</Button></div><div v-if="!agentDraft.widgetQuickActions.length" class="empty-actions"><strong>Start with a helpful question.</strong><p>Add one action to give visitors an easy first step.</p><Button variant="secondary" size="small" @click="startAddAction"><Plus :size="14" :stroke-width="2" aria-hidden="true" /> Add quick action</Button></div><div v-else class="compact-action-list"><article v-for="(action, index) in agentDraft.widgetQuickActions" :key="`${action.label}-${index}`" class="compact-action-row"><button class="drag-handle" type="button" aria-label="Move action up" @click="moveAction(index, -1)"><GripVertical :size="16" :stroke-width="1.8" aria-hidden="true" /></button><div class="compact-action-copy"><strong>{{ action.label }}</strong><span>“{{ action.question }}”</span></div><div class="compact-action-controls"><button type="button" @click="editAction(index)">Edit</button><button type="button" @click="removeAction(index)">Delete</button></div></article></div></section>
        <section v-if="quickActionEditorOpen" class="action-drawer"><div class="agent-section-heading"><div><p class="section-kicker">{{ editingActionIndex === null ? 'New action' : 'Edit action' }}</p><h3>Quick action details</h3></div><button class="icon-button" type="button" aria-label="Close" @click="quickActionEditorOpen = false"><X :size="18" :stroke-width="1.8" aria-hidden="true" /></button></div><FormField label="Label" required><TextInput v-model="actionLabel" :maxlength="48" placeholder="Explore services" /></FormField><FormField label="Customer message" required><TextInput v-model="actionQuestion" :maxlength="300" placeholder="What services do you offer?" /></FormField><FormField label="Action type"><Select :options="[{ label: 'Ask AI', value: 'ask' }, { label: 'Open lead form', value: 'lead' }, { label: 'Request human', value: 'human' }]" placeholder="" /></FormField><div class="drawer-actions"><Button variant="secondary" size="small" @click="quickActionEditorOpen = false">Cancel</Button><Button variant="primary" size="small" :disabled="!actionLabel.trim() || !actionQuestion.trim()" @click="saveAction">Save action</Button></div></section>
        <section class="agent-section agent-section-footer"><div><strong>{{ agentDraft.widgetQuickActions.length }} of 5 recommended actions</strong><p>Use specific questions that help visitors choose what to do next.</p></div><Button variant="primary" size="small" @click="saveChanges">Save changes</Button></section>
      </article>
      <aside class="agent-preview-column"><WidgetPreview :assistant-name="agentDraft.assistantName" :welcome-message="agentDraft.welcomeMessage" :business-name="businessName" :website-url="websiteUrl" :widget-color="safeWidgetColor" :widget-theme="agentDraft.widgetTheme" :widget-position="agentDraft.widgetPosition" :widget-default-mode="agentDraft.widgetDefaultMode" :widget-allow-expand="agentDraft.widgetAllowExpand" :quick-actions="agentDraft.widgetQuickActions" :show-lead-capture="agentDraft.showLeadCapture" :require-lead-consent="agentDraft.requireLeadConsent" :privacy-notice-url="agentDraft.privacyNoticeUrl" :show-ai-disclosure="agentDraft.showAiDisclosure" :citation-visibility="agentDraft.citationVisibility" :tone="agentDraft.tone" :fallback-behavior="agentDraft.fallbackBehavior" :human-handoff-enabled="agentDraft.humanHandoffEnabled" :widget-logo-url="logoPreview || agentDraft.widgetLogoUrl" :proactive-enabled="agentDraft.proactiveEnabled" :proactive-message="agentDraft.proactiveMessage" :proactive-behavior="agentDraft.proactiveBehavior" :mode="previewMode" @change-mode="previewMode = $event" /></aside>
    </div>

    <div v-else-if="tab === 'test'" class="agent-test-layout">
      <article class="test-conversation panel">
        <div class="test-conversation-header"><div><p class="section-kicker">Production conversation</p><h3>Test what customers will experience</h3><p>Use the same widget shell to check answers, actions, forms, and handoff.</p></div><span v-if="test.conversationId" class="conversation-status">Conversation active</span></div>
        <WidgetPreview :assistant-name="agentDraft.assistantName" :welcome-message="agentDraft.welcomeMessage" :business-name="businessName" :website-url="websiteUrl" :widget-color="safeWidgetColor" :widget-theme="agentDraft.widgetTheme" :widget-position="agentDraft.widgetPosition" :widget-default-mode="agentDraft.widgetDefaultMode" :widget-allow-expand="agentDraft.widgetAllowExpand" :quick-actions="agentDraft.widgetQuickActions" :show-lead-capture="agentDraft.showLeadCapture" :require-lead-consent="agentDraft.requireLeadConsent" :privacy-notice-url="agentDraft.privacyNoticeUrl" :show-ai-disclosure="agentDraft.showAiDisclosure" :citation-visibility="agentDraft.citationVisibility" :tone="agentDraft.tone" :fallback-behavior="agentDraft.fallbackBehavior" :human-handoff-enabled="agentDraft.humanHandoffEnabled" :widget-logo-url="logoPreview || agentDraft.widgetLogoUrl" :state="testWidgetState" :show-scenario-selector="false" :mode="previewMode" @change-mode="previewMode = $event" @ask="ask" @submit-action="submitPreviewAction" />
      </article>
      <aside class="test-owner-panel panel"><div class="agent-section-heading"><div><p class="section-kicker">Owner checks</p><h3>What to verify</h3></div></div><div class="owner-check-list"><div><span :class="statusClass(sessionHasGroundedAnswer)">✓</span><span><strong>Grounded answers</strong><small>{{ sessionHasGroundedAnswer ? 'Grounded in business knowledge' : 'Ask a knowledge question' }}</small></span></div><div><span :class="statusClass(sessionSourceCount > 0)">✓</span><span><strong>Sources</strong><small>{{ sessionSourceCount ? `${sessionSourceCount} source${sessionSourceCount === 1 ? '' : 's'}` : 'Sources appear with grounded answers' }}</small></span></div><div><span :class="statusClass(sessionHasAction)">✓</span><span><strong>Action flows</strong><small>{{ sessionHasAction ? 'Action flow is running in the conversation' : 'Try a quick action or ask for help' }}</small></span></div><div><span :class="statusClass(sessionHasCompletedAction)">✓</span><span><strong>Completion</strong><small>{{ sessionHasCompletedAction ? 'Test lead captured' : 'Submit the conversational form to verify' }}</small></span></div></div><div v-if="sessionHasCompletedAction" class="test-success"><strong>✓ Test lead captured</strong><button class="text-button" type="button" @click="emit('view-leads')">View in Leads →</button></div><div class="test-decision"><strong>{{ testCompleted ? 'Ready for the next step.' : 'Test a representative customer question.' }}</strong><p v-if="!testCompleted">Ask at least one question to unlock the go-live path.</p><p v-else-if="!isLive">Publish when the experience looks right.</p><p v-else>Your AI front desk is live.</p><div class="test-decision-actions"><Button variant="primary" size="small" :disabled="!testCompleted" @click="handleGoLive">{{ isLive ? 'View dashboard' : 'Go live' }} →</Button><Button variant="secondary" size="small" @click="emit('open-knowledge')">{{ openKnowledgeGaps.length ? 'Review answer gaps' : 'Improve knowledge' }}</Button><Button v-if="openKnowledgeGaps.length" variant="secondary" size="small" @click="emit('open-knowledge')">Add knowledge</Button></div></div><p class="test-owner-note">Internal details stay summarized here. Visitors only see the conversation.</p></aside>
    </div>

    <div v-else class="install-experience">
      <div class="install-status-card panel"><div><p class="section-kicker">Website status</p><h3>Know what is live</h3></div><div class="install-status-list"><span :class="statusClass(ownershipStatus === 'verified')">✓ <strong>Domain verified</strong></span><span :class="statusClass(Boolean(install?.verification.loadCount))">✓ <strong>Widget installed</strong></span><span :class="statusClass(isLive)">{{ isLive ? '✓' : '○' }} <strong>{{ isLive ? 'AI front desk live' : 'Not published' }}</strong></span></div></div>
      <div class="install-step-grid">
        <article class="install-step panel"><span class="step-number">1</span><div><p class="section-kicker">Verify website</p><h3>{{ ownershipStatus === 'verified' ? 'Website verified' : 'Protect your website' }}</h3><p>{{ ownershipStatus === 'verified' ? 'Ownership is verified for this business.' : 'Complete ownership verification before publishing the live widget.' }}</p><span v-if="ownershipStatus === 'verified'" class="status-text success">✓ Ready to publish</span><template v-else><div class="install-verification-controls"><label>Method<select v-model="verificationMethodDraft"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><div class="drawer-actions"><button class="outline-button small" type="button" :disabled="verificationLoading" @click="emit('start-verification', verificationMethodDraft)">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethodDraft !== 'email' && verificationMethodDraft !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="emit('check-verification')">Check now</button></div></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="ownershipMessage" class="status-text success">✓ {{ ownershipMessage }}</p><p v-if="ownershipError" class="form-error">{{ ownershipError }}</p></template></div></article>
        <article class="install-step panel"><span class="step-number">2</span><div><p class="section-kicker">Install widget</p><h3>Choose your platform</h3><div class="install-platform-tabs"><button v-for="platform in ([['wordpress', 'WordPress'], ['wix', 'Wix'], ['shopify', 'Shopify'], ['squarespace', 'Squarespace'], ['custom', 'Custom'], ['not_sure', 'Not sure']] as Array<[InstallPlatform, string]>)" :key="platform[0]" :class="{ active: installPlatform === platform[0] }" type="button" @click="installPlatform = platform[0]">{{ platform[1] }}</button></div><p v-if="install" class="install-help">{{ installInstructions }} {{ businessName || 'your website' }}.</p><div v-if="install" class="snippet-box"><code>{{ install.snippet }}</code><button class="primary-button small" type="button" @click="emit('copy-snippet')">Copy code</button></div><div v-else class="install-gate"><p>{{ authReady ? 'Your private install snippet is loading.' : 'Sign in to generate a private install snippet.' }}</p><button class="outline-button small" type="button" @click="authReady ? emit('refresh-install') : emit('require-auth')">{{ authReady ? 'Refresh install details' : 'Create account to install' }}</button></div></div></article>
        <article class="install-step panel"><span class="step-number">3</span><div><p class="section-kicker">Test installation</p><h3>Check the live widget</h3><p>Confirm the widget is on the right business and the agent is online.</p><button class="outline-button small" type="button" :disabled="verificationLoading || !install" @click="emit('verify-install')">{{ verificationLoading ? 'Checking…' : 'Check installation' }}</button><p v-if="verificationMessage" :class="['status-text', install?.verification.loadCount ? 'success' : 'error']">{{ install?.verification.loadCount ? '✓' : '!' }} {{ verificationMessage }}</p><div v-if="verificationMessage && install && !install.verification.loadCount" class="install-detection-help"><strong>We couldn't detect FrontDeskWise yet.</strong><span>Check the instructions, try again, or let us help you get live.</span><div class="drawer-actions"><button class="text-button" type="button" @click="openSupportDrawer">Check instructions</button><button class="primary-button small" type="button" @click="openSupportDrawer">Get help installing</button></div></div><div v-if="install" class="install-check-results"><span :class="statusClass(Boolean(install.verification.loadCount))">✓ Widget detected</span><span :class="statusClass(Boolean(install.siteKey))">✓ Correct business ID</span><span :class="statusClass(authReady && !billingReadOnly)">✓ Agent online</span></div></div></article>
        <article class="install-step publish-step panel"><span class="step-number">4</span><div><p class="section-kicker">Publish</p><template v-if="publishStatus === 'NOT_PUBLISHED'"><h3>Make the front desk live</h3><p>Publish the current Agent configuration to this business.</p><button class="primary-button small" type="button" :disabled="!authReady || billingReadOnly || ownershipStatus !== 'verified'" @click="publishDraft">{{ billingReadOnly ? 'Billing needs attention' : ownershipStatus !== 'verified' ? 'Verify website first' : 'Publish AI front desk' }}</button></template><template v-else-if="publishStatus === 'PUBLISHING'"><h3>Publishing your front desk</h3><p>Applying the current Agent configuration to the live widget.</p><button class="primary-button small" type="button" disabled>Publishing…</button></template><template v-else-if="publishStatus === 'LIVE'"><h3 class="live-heading">✓ AI front desk is live</h3><p v-if="publishing.domain">Live on {{ publishing.domain }}</p><div class="agent-live-actions"><button class="text-button" type="button" @click="openLiveWebsite">View live widget</button><button class="outline-button small" type="button" @click="openLiveWebsite">Open website</button></div></template><template v-else><h3>● Live</h3><p class="unpublished-warning">You have unpublished changes</p><button class="primary-button small" type="button" :disabled="!authReady || billingReadOnly || ownershipStatus !== 'verified'" @click="publishDraft">{{ billingReadOnly ? 'Billing needs attention' : ownershipStatus !== 'verified' ? 'Verify website first' : 'Publish updates' }}</button></template><p v-if="installMessage" class="status-text success">✓ {{ installMessage }}</p></div></article>
      </div>
      <section class="install-support panel"><div class="install-support-copy"><p class="section-kicker">Free setup help included</p><h3>Need help installing?</h3><p>You can do this yourself in minutes, or we can help you get FrontDeskWise live on your website.</p></div><div class="install-support-actions"><button class="primary-button small" type="button" @click="openSupportDrawer">Contact support</button><button class="outline-button small" type="button" @click="sendDeveloperInstructions">Send instructions to my developer</button></div></section>
      <p v-if="publicDemoMode" class="install-note">This is a public sample workspace. Create an account to verify, install, and publish your own Agent.</p>
    </div>
  </div>

  <div v-if="supportDrawerOpen" class="install-support-overlay" role="dialog" aria-modal="true" aria-labelledby="installation-support-title" @click.self="supportDrawerOpen = false">
    <aside class="install-support-drawer">
      <button class="auth-close" type="button" aria-label="Close" @click="supportDrawerOpen = false">×</button>
      <p class="eyebrow">Installation help</p>
      <h2 id="installation-support-title">We’ll help you get live</h2>
      <p class="support-drawer-copy">Tell us where you’re stuck and our team will reply with the next step.</p>
      <div v-if="supportSubmitted || installationSupportMessage" class="support-success"><strong>Request sent ✓</strong><p>{{ installationSupportMessage || 'We’ll be in touch soon with installation help.' }}</p><button class="primary-button small" type="button" @click="supportDrawerOpen = false">Done</button></div>
      <form v-else class="support-form" @submit.prevent="submitInstallationSupport">
        <label>Name<input v-model="supportName" type="text" autocomplete="name" required /></label>
        <label>Business<input :value="businessName" type="text" readonly /></label>
        <label>Website<input :value="websiteUrl" type="url" readonly /></label>
        <label>Platform<select v-model="supportPlatform"><option value="wordpress">WordPress</option><option value="wix">Wix</option><option value="shopify">Shopify</option><option value="squarespace">Squarespace</option><option value="custom">Custom</option><option value="not_sure">Not sure</option></select></label>
        <label>What do you need help with?<input v-model="supportHelpRequest" type="text" maxlength="240" required placeholder="e.g. I’m not sure where to paste the code" /></label>
        <label>Preferred contact method<select v-model="supportPreferredContactMethod"><option value="email">Email</option><option value="phone">Phone</option></select></label>
        <label>{{ supportPreferredContactMethod === 'email' ? 'Email address' : 'Phone number' }}<input v-model="supportContactValue" :type="supportPreferredContactMethod === 'email' ? 'email' : 'tel'" required /></label>
        <label><span class="field-label">Message <span class="optional">Optional</span></span><textarea v-model="supportMessage" rows="4" maxlength="4000" placeholder="Add any details that would help us understand where you’re stuck."></textarea></label>
        <label><span class="field-label">Screenshot link <span class="optional">Optional</span></span><input v-model="supportScreenshotUrl" type="url" placeholder="https://…" /></label>
        <p v-if="installationSupportError" class="form-error">{{ installationSupportError }}</p>
        <div class="drawer-actions"><button class="outline-button small" type="button" @click="supportDrawerOpen = false">Cancel</button><button class="primary-button small" type="submit" :disabled="installationSupportLoading">{{ installationSupportLoading ? 'Sending…' : 'Request installation help' }}</button></div>
      </form>
    </aside>
  </div>
</template>

<style scoped>
.agent-experience { min-width: 0; --agent-border: #dfe6ef; --agent-muted: #687892; --agent-ink: #14233d; }
.agent-header-row, .preview-label-row, .test-conversation-header, .agent-section-heading, .action-heading, .install-status-card { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.agent-header-row { align-items: center; margin-bottom: 22px; }
.agent-header-row h2 { margin: 0; color: var(--agent-ink); font-size: 30px; letter-spacing: -.05em; }
.agent-title-line { display: flex; align-items: center; gap: 10px; }
.agent-live-pill { display: inline-flex; align-items: center; min-height: 25px; padding: 4px 9px; border: 1px solid #b9e8d9; border-radius: 999px; color: #08785d; background: #edfaf5; font-size: 11px; font-weight: 800; }
.agent-live-banner { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin: -7px 0 20px; padding: 15px 17px; border: 1px solid #b9e8d9; border-radius: 12px; color: #08785d; background: linear-gradient(135deg, #effbf6, #f8fffc); }
.agent-live-banner > div:first-child { display: grid; gap: 4px; }
.agent-live-banner strong { font-size: 15px; }
.agent-live-banner span { color: #47796e; font-size: 11px; }
.agent-live-banner-warning { border-color: #f1d5a1; color: #805d1e; background: #fffaf0; }
.agent-live-banner-warning span { color: #8c6d36; }
.agent-live-banner-publishing { border-color: #c8daf2; color: #315d93; background: #f5f9ff; }
.agent-live-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.live-heading { color: #08785d !important; }
.unpublished-warning { color: #8c6d36 !important; font-weight: 750; }
.agent-header-row p:not(.eyebrow), .agent-section-heading p:not(.section-kicker), .test-conversation-header p:not(.section-kicker), .install-step p:not(.section-kicker) { margin: 7px 0 0; color: var(--agent-muted); font-size: 13px; line-height: 1.5; }
.agent-header-actions, .drawer-actions, .compact-action-controls, .install-platform-tabs, .preview-mode-toggle { display: flex; align-items: center; gap: 10px; }
.agent-header-actions { flex-wrap: wrap; }
.agent-config-layout { display: grid; grid-template-columns: minmax(300px, 340px) minmax(0, 1fr); gap: 20px; align-items: start; min-width: 0; }
.agent-settings-panel, .agent-form-panel, .agent-preview-column { min-width: 0; width: 100%; }
.agent-form-panel { padding: 0; overflow: hidden; }
.agent-section { padding: 24px; border-bottom: 1px solid var(--agent-border); }
.agent-section:last-child { border-bottom: 0; }
.agent-section h3, .preview-label-row h3, .test-conversation-header h3, .install-step h3, .install-status-card h3 { margin: 0; color: var(--agent-ink); font-size: 17px; letter-spacing: -.025em; }
.section-kicker { margin: 0 0 7px; color: #2f80ed; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.agent-section label, .action-drawer label { display: grid; gap: 7px; margin-top: 18px; color: #586b86; font-size: 12px; font-weight: 700; }
.agent-section label:first-of-type { margin-top: 18px; }
.agent-section input:not([type="checkbox"]):not([type="color"]), .agent-section textarea, .agent-section select, .action-drawer input, .action-drawer select { width: 100%; min-height: 42px; padding: 10px 12px; border: 1px solid #c5d5e6; border-radius: 9px; color: var(--agent-ink); background: #fff; font-size: 13px; font-weight: 500; line-height: 1.35; }
.agent-section textarea { resize: vertical; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
.proactive-trigger-grid { display: grid; gap: 8px; margin-top: 18px; }
.proactive-check { display: flex !important; grid-template-columns: none !important; align-items: flex-start; gap: 10px; margin-top: 0 !important; padding: 11px 12px; border: 1px solid var(--agent-border); border-radius: 10px; background: #fbfcfe; cursor: pointer; }
.proactive-check input { width: 16px; height: 16px; flex: 0 0 auto; margin: 1px 0 0; accent-color: #1769e8; }
.proactive-check span { display: grid; gap: 3px; }
.proactive-check strong { color: var(--agent-ink); font-size: 12px; }
.proactive-check small { color: var(--agent-muted); font-size: 11px; font-weight: 500; line-height: 1.35; }
.proactive-delay-control { display: grid; grid-template-columns: auto 92px auto; align-items: center; gap: 9px; margin-top: 17px; color: #586b86; font-size: 12px; font-weight: 700; }
.proactive-delay-control input { width: 100%; min-height: 38px; padding: 8px 10px; border: 1px solid #c5d5e6; border-radius: 8px; color: var(--agent-ink); background: #fff; font-size: 13px; }
.proactive-delay-control span { color: var(--agent-muted); font-size: 10px; font-weight: 500; }
.form-help { margin: 10px 0 0; color: var(--agent-muted); font-size: 11px; line-height: 1.45; }
.segmented-control { display: flex; gap: 4px; flex-wrap: wrap; padding: 3px; border: 1px solid #d7e0eb; border-radius: 9px; background: #f3f6fa; }
.segmented-control button { flex: 1; min-width: 72px; padding: 8px 9px; border: 0; border-radius: 6px; color: var(--agent-muted); background: transparent; font-size: 11px; font-weight: 700; }
.segmented-control button.active { color: #163e81; background: #fff; box-shadow: 0 1px 2px rgba(20,42,74,.12); }
.segmented-control.two-up button { min-width: 110px; }
.switch-row { display: flex !important; grid-template-columns: 1fr auto; align-items: center; justify-content: space-between; gap: 14px; }
.switch-row strong, .switch-row small { display: block; }
.switch-row small { margin-top: 4px; color: var(--agent-muted); font-size: 11px; font-weight: 500; line-height: 1.45; }
.switch-row input { width: 36px; height: 20px; accent-color: #1769e8; }
.agent-section-footer { display: flex; justify-content: space-between; align-items: center; gap: 14px; background: #fbfcfe; }
.agent-section-footer strong { color: var(--agent-ink); font-size: 12px; }
.agent-section-footer p { margin: 4px 0 0; color: var(--agent-muted); font-size: 11px; }
.logo-upload-row { display: flex; align-items: center; gap: 14px; }
.logo-preview { display: grid; width: 54px; height: 54px; place-items: center; overflow: hidden; border: 1px solid var(--agent-border); border-radius: 12px; color: #1769e8; background: #f4f7fb; font-size: 24px; }
.logo-preview img { width: 100%; height: 100%; object-fit: contain; }
.logo-upload-row strong, .logo-upload-row small { display: block; }
.logo-upload-row strong { color: var(--agent-ink); font-size: 12px; }
.logo-upload-row small { margin: 3px 0 8px; color: var(--agent-muted); font-size: 11px; }
.upload-button { display: inline-flex !important; width: max-content; margin: 0 !important; cursor: pointer; }
.upload-button input { display: none; }
.advanced-setting { margin-top: 18px; color: var(--agent-muted); font-size: 11px; }
.advanced-setting summary { cursor: pointer; font-weight: 700; }
.advanced-setting label { margin-top: 12px; }
.advanced-setting small { display: block; margin-top: 7px; line-height: 1.4; }
.color-control { display: flex; align-items: center; gap: 10px; }
.color-control input[type="color"] { width: 34px; height: 34px; padding: 2px; border: 1px solid #d7e0eb; border-radius: 8px; }
.color-swatch { width: 25px; height: 25px; border: 3px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px #d2dce9; }
.color-swatch.selected { box-shadow: 0 0 0 2px #1769e8; }
.quick-actions-section { min-height: 280px; }
.compact-action-list { display: grid; gap: 8px; margin-top: 19px; }
.compact-action-row { display: flex; align-items: center; gap: 11px; padding: 11px 10px; border: 1px solid var(--agent-border); border-radius: 10px; background: #fff; }
.drag-handle { width: 24px; padding: 4px; border: 0; color: #8a9ab1; background: transparent; font-size: 18px; }
.compact-action-copy { display: grid; gap: 3px; min-width: 0; flex: 1; }
.compact-action-copy strong { overflow: hidden; color: var(--agent-ink); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.compact-action-copy span { overflow: hidden; color: var(--agent-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.compact-action-controls button { padding: 5px 6px; border: 0; color: #2168d8; background: transparent; font-size: 11px; font-weight: 700; }
.compact-action-controls button:last-child { color: #b44343; }
.action-drawer { margin: 0 24px 22px; padding: 18px; border: 1px solid #bcd2ef; border-radius: 11px; background: #f7faff; }
.icon-button { border: 0; color: var(--agent-muted); background: transparent; font-size: 20px; }
.drawer-actions { justify-content: flex-end; margin-top: 20px; }
.empty-actions { display: grid; place-items: start; gap: 5px; margin-top: 25px; padding: 25px; border: 1px dashed #cbd8e7; border-radius: 10px; background: #fbfcfe; }
.empty-actions strong { color: var(--agent-ink); font-size: 13px; }
.empty-actions p { margin: 0 0 6px; color: var(--agent-muted); font-size: 12px; }
.action-preview-card { width: min(100%, 360px); margin: 50px auto 0; padding: 18px; }
.action-preview-card .preview-action-button { margin-top: 10px; cursor: default; }
.agent-test-layout { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(280px, .75fr); gap: 22px; align-items: start; }
.agent-capabilities-layout { display: grid; max-width: 980px; gap: 16px; }
.agent-capabilities-intro, .agent-capabilities-note { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; padding: 22px; }
.agent-capabilities-intro h3, .agent-capabilities-note h3 { margin: 0; color: var(--agent-ink); font-size: 18px; letter-spacing: -.025em; }
.agent-capabilities-intro p:not(.section-kicker), .agent-capabilities-note p:not(.section-kicker) { max-width: 650px; margin: 7px 0 0; color: var(--agent-muted); font-size: 12px; line-height: 1.5; }
.capability-summary-count { flex: 0 0 auto; padding: 6px 10px; border-radius: 999px; color: #08785d; background: #e7f8f1; font-size: 11px; font-weight: 800; }
.agent-capability-list { overflow: hidden; }
.agent-capability-row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: 12px; align-items: center; padding: 17px 20px; border-bottom: 1px solid var(--agent-border); }
.agent-capability-row:last-child { border-bottom: 0; }
.capability-status-icon { display: grid; width: 24px; height: 24px; place-items: center; border: 1px solid #d7e0eb; border-radius: 50%; color: #8a9ab1; background: #f8fafd; font-size: 12px; font-weight: 800; }
.capability-status-icon.ready { border-color: #b9e8d9; color: #08785d; background: #edfaf5; }
.agent-capability-copy { min-width: 0; }
.agent-capability-copy strong { color: var(--agent-ink); font-size: 13px; }
.agent-capability-copy p { margin: 4px 0 0; color: var(--agent-muted); font-size: 11px; line-height: 1.45; }
.capability-status-label { padding: 5px 8px; border-radius: 999px; color: #95630c; background: #fff5df; font-size: 10px; font-weight: 800; white-space: nowrap; }
.capability-status-label.ready { color: #08785d; background: #e7f8f1; }
.capability-action { padding: 6px 0; border: 0; color: #2168d8; background: transparent; font-size: 11px; font-weight: 750; white-space: nowrap; }
.agent-capabilities-note { align-items: center; border-color: #cfe0f3; background: linear-gradient(135deg, #f8fbff, #f1f8ff); }
.agent-knowledge-layout { display: grid; max-width: 900px; gap: 18px; }
.agent-knowledge-summary { padding: 24px; }
.knowledge-readiness-pill { padding: 5px 9px; border-radius: 999px; font-size: 10px; font-weight: 800; }
.knowledge-readiness-pill.ready { color: #08785d; background: #e7f8f1; }
.knowledge-readiness-pill.needs-review { color: #95630c; background: #fff5df; }
.agent-knowledge-metrics { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-top: 22px; }
.agent-knowledge-metrics > div { padding: 14px; border: 1px solid var(--agent-border); border-radius: 10px; background: #fbfcfe; }
.agent-knowledge-metrics strong, .agent-knowledge-metrics small { display: block; }
.agent-knowledge-metrics strong { overflow: hidden; color: var(--agent-ink); font-size: 18px; text-overflow: ellipsis; white-space: nowrap; }
.agent-knowledge-metrics small { margin-top: 4px; color: var(--agent-muted); font-size: 10px; }
.agent-knowledge-status { margin: 18px 0 0; color: #08785d; font-size: 13px; font-weight: 750; }
.agent-knowledge-gaps { display: grid; gap: 8px; margin-top: 22px; padding-top: 18px; border-top: 1px solid var(--agent-border); }
.agent-knowledge-gaps > strong { color: var(--agent-ink); font-size: 13px; }
.agent-knowledge-gaps button { display: flex; justify-content: space-between; gap: 10px; padding: 9px 0; border: 0; color: #2168d8; background: transparent; font-size: 12px; text-align: left; }
.agent-knowledge-gaps button span { color: var(--agent-muted); }
.agent-knowledge-gaps small { color: var(--agent-muted); font-size: 10px; }
.agent-knowledge-actions, .test-decision-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 22px; }
.test-decision { margin-top: 23px; padding: 15px; border: 1px solid #cfe0f3; border-radius: 10px; background: #f8fbff; }
.test-decision > strong { color: var(--agent-ink); font-size: 13px; }
.test-decision > p { margin: 5px 0 0; color: var(--agent-muted); font-size: 11px; line-height: 1.45; }
.test-decision-actions { margin-top: 14px; }
.test-conversation, .test-owner-panel { padding: 22px; }
.owner-check-list { display: grid; gap: 14px; margin-top: 18px; }
.owner-check-list > div, .install-check-results { display: flex; gap: 10px; align-items: flex-start; }
.owner-check-list > div > span:first-child { display: grid; width: 20px; height: 20px; flex: 0 0 20px; place-items: center; border-radius: 50%; font-size: 11px; font-weight: 800; }
.status-ready { color: #08785d; background: #e7f8f1; }
.status-pending { color: #95630c; background: #fff5df; }
.owner-check-list strong, .owner-check-list small { display: block; }
.owner-check-list strong { color: var(--agent-ink); font-size: 12px; }
.owner-check-list small { margin-top: 3px; color: var(--agent-muted); font-size: 11px; line-height: 1.4; }
.test-success { display: grid; gap: 6px; margin-top: 23px; padding: 13px; border: 1px solid #b9e8d9; border-radius: 9px; color: #08785d; background: #edfaf5; font-size: 12px; }
.test-success .text-button { justify-self: start; padding: 0; color: #08785d; }
.install-experience { display: grid; gap: 16px; }
.install-status-card { align-items: center; padding: 20px 22px; }
.install-status-list { display: flex; gap: 15px; flex-wrap: wrap; }
.install-status-list span, .install-check-results span { font-size: 11px; }
.install-step-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.install-step { display: flex; gap: 18px; align-items: flex-start; padding: 24px; }
.step-number { display: grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border-radius: 50%; color: #fff; background: #1769e8; font-size: 12px; font-weight: 800; }
.install-step > div { display: grid; min-width: 0; flex: 1; align-content: start; }
.install-step > div > .outline-button, .install-step > div > .primary-button { margin-top: 16px; }
.install-platform-tabs { gap: 14px; margin: 20px 0 16px; overflow-x: auto; border-bottom: 1px solid var(--agent-border); }
.install-platform-tabs button { flex: 0 0 auto; padding: 7px 3px 9px; border: 0; color: var(--agent-muted); background: transparent; font-size: 11px; font-weight: 700; }
.install-platform-tabs button.active { color: #1769e8; border-bottom: 2px solid #1769e8; }
.install-verification-controls { display: grid; gap: 14px; margin-top: 20px; }
.install-verification-controls label { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: center; column-gap: 14px; row-gap: 9px; min-width: 0; margin: 0; }
.install-verification-controls label select { width: 100%; min-width: 0; }
.install-verification-controls .drawer-actions { justify-content: flex-start; gap: 12px; margin-top: 4px; }
.install-help { font-size: 11px !important; }
.snippet-box { display: grid; gap: 10px; margin-top: 12px; padding: 12px; border: 1px solid var(--agent-border); border-radius: 9px; background: #f8fafd; }
.snippet-box code { display: block; max-height: 90px; overflow: auto; color: #40516d; font-size: 10px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; }
.snippet-box .primary-button { justify-self: start; }
.install-gate { margin-top: 15px; padding: 12px; border: 1px dashed #cbd8e7; border-radius: 8px; background: #fbfcfe; }
.install-gate p { margin: 0 0 10px !important; }
.verification-instructions { margin: 12px 0 0 !important; padding: 10px; border: 1px solid var(--agent-border); border-radius: 8px; color: var(--agent-muted); background: #f8fafd; font-size: 11px !important; line-height: 1.45; }
.verification-token { display: block; margin-top: 8px; padding: 9px; color: var(--agent-ink); background: #f3f6fa; font-size: 10px; word-break: break-all; }
.status-text { display: block; margin-top: 12px; font-size: 11px; font-weight: 700; }
.status-text.success { color: #08785d; }
.status-text.error { color: #b44343; }
.install-check-results { display: grid; gap: 7px; margin-top: 14px; }
.install-detection-help { display: grid; gap: 5px; margin-top: 14px; padding: 13px; border: 1px solid #f1d5a1; border-radius: 10px; color: #7d5c20; background: #fffaf0; font-size: 11px; line-height: 1.45; }
.install-detection-help strong { color: #5f4518; font-size: 12px; }
.install-detection-help .drawer-actions { justify-content: flex-start; margin-top: 8px; }
.install-support { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 22px; border-color: #cfe0f3; background: linear-gradient(135deg, #f8fbff, #f1f8ff); }
.install-support h3 { margin: 0; color: var(--agent-ink); font-size: 17px; }
.install-support p:not(.section-kicker) { margin: 6px 0 0; color: var(--agent-muted); font-size: 12px; line-height: 1.5; }
.install-support-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
.install-support-overlay { position: fixed; z-index: 30; inset: 0; display: flex; justify-content: flex-end; background: rgba(20, 35, 61, .28); }
.install-support-drawer { position: relative; width: min(470px, 100%); height: 100%; overflow: auto; padding: 30px; background: #fff; box-shadow: -18px 0 50px rgba(20, 42, 74, .18); }
.install-support-drawer h2 { margin: 0; color: var(--agent-ink); font-size: 25px; letter-spacing: -.04em; }
.support-drawer-copy { margin: 8px 0 22px; color: var(--agent-muted); font-size: 12px; line-height: 1.5; }
.support-form { display: grid; gap: 14px; }
.support-form label { display: grid; gap: 6px; color: #586b86; font-size: 11px; font-weight: 750; }
.support-form input, .support-form select, .support-form textarea { width: 100%; min-height: 42px; padding: 10px 12px; border: 1px solid #c5d5e6; border-radius: 9px; color: var(--agent-ink); background: #fff; font: inherit; font-size: 13px; font-weight: 500; line-height: 1.35; }
.support-form textarea { resize: vertical; }
.support-form input[readonly] { color: #687892; background: #f7f9fc; }
.support-form .optional { color: #8795a8; font-size: 10px; font-weight: 500; }
.support-success { margin-top: 22px; padding: 16px; border: 1px solid #b9e8d9; border-radius: 10px; color: #08785d; background: #edfaf5; }
.support-success strong { font-size: 13px; }
.support-success p { margin: 6px 0 13px; color: #386e60; font-size: 12px; line-height: 1.5; }
.install-support-drawer > .auth-close { position: absolute; top: 17px; right: 20px; border: 0; color: var(--agent-muted); background: transparent; font-size: 25px; }
.publish-step { background: #f8fbff; }
@media (max-width: 900px) { .agent-config-layout, .agent-test-layout { grid-template-columns: 1fr; } .preview-sticky { position: static; } .agent-settings-panel, .agent-form-panel, .agent-preview-column { display: block; width: 100%; } .agent-preview-column { order: 0; } .install-step-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .install-support { display: block; } .install-support-actions { justify-content: flex-start; margin-top: 16px; } .install-support-drawer { padding: 24px 18px; } }
@media (max-width: 640px) { .agent-header-row, .install-status-card, .agent-section-footer, .agent-live-banner, .agent-capabilities-intro, .agent-capabilities-note { display: block; } .agent-header-row { display: flex; align-items: stretch; flex-direction: column; } .agent-header-actions, .agent-live-actions { margin-top: 16px; } .agent-header-actions { width: 100%; } .agent-header-actions > button { flex: 1 1 0; } .field-grid, .agent-knowledge-metrics { grid-template-columns: 1fr 1fr; } .agent-section { padding: 19px; } .compact-action-row { align-items: flex-start; } .compact-action-controls { flex-direction: column; gap: 0; } .test-conversation, .test-owner-panel { padding: 17px; } .install-status-list { margin-top: 15px; } .agent-capability-row { grid-template-columns: 28px minmax(0, 1fr) auto; } .agent-capability-row .capability-action { grid-column: 2 / -1; justify-self: start; padding-top: 0; } .agent-capabilities-note .outline-button { margin-top: 16px; } }
</style>
