<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";

type AgentTab = "behavior" | "appearance" | "quick-actions" | "test" | "install";
type Tone = "friendly" | "professional" | "concise" | "custom";
type FallbackBehavior = "contact_form" | "human" | "unavailable";
type WidgetTheme = "light" | "dark" | "auto";
type WidgetPosition = "bottom-right" | "bottom-left";
type VerificationMethod = "email" | "meta_tag" | "file" | "dns_txt" | "manual";
type InstallPlatform = "wordpress" | "wix" | "shopify" | "squarespace" | "custom" | "not_sure";
type SupportContactMethod = "email" | "phone";

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
  showLeadCapture: boolean;
  showBookingAction: boolean;
  showAiDisclosure: boolean;
  requireLeadConsent: boolean;
  privacyNoticeUrl: string;
  retentionDays: number;
}

interface TestActionField {
  id: string;
  key: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

interface TestAction {
  status: "active" | "completed";
  form?: { submitLabel: string; fields: TestActionField[] };
}

interface TestModel {
  conversationId: string;
  question: string;
  answer: string;
  grounded: boolean;
  citations: Array<{ title?: string; url?: string; pageType?: string }>;
  action: TestAction | null;
  formValues: Record<string, string>;
  suggestedQuestions: string[];
  isAsking: boolean;
}

interface InstallModel {
  snippet: string;
  siteKey: string;
  verification: { lastLoadedAt: string | null; loadCount: number };
}

const props = defineProps<{
  tab: AgentTab;
  businessKey: string;
  businessName: string;
  websiteUrl: string;
  model: AgentModel;
  savedMessage: string;
  authReady: boolean;
  authUserName: string;
  authUserEmail: string;
  publicDemoMode: boolean;
  billingReadOnly: boolean;
  ownershipStatus: "pending" | "verified" | "rejected" | null;
  install: InstallModel | null;
  installMessage: string;
  verificationMessage: string;
  verificationLoading: boolean;
  verificationMethod: VerificationMethod;
  verificationInstructions: string;
  verificationToken: string;
  ownershipMessage: string;
  ownershipError: string;
  installationSupportLoading: boolean;
  installationSupportMessage: string;
  installationSupportError: string;
  openSupportRequest: number;
  test: TestModel;
}>();

const emit = defineEmits<{
  (event: "select-tab", tab: AgentTab): void;
  (event: "save", payload: AgentModel): void;
  (event: "require-auth"): void;
  (event: "copy-snippet"): void;
  (event: "verify-install"): void;
  (event: "refresh-install"): void;
  (event: "start-verification", method: VerificationMethod): void;
  (event: "check-verification"): void;
  (event: "ask-question", question: string): void;
  (event: "submit-action", values: Record<string, string>): void;
  (event: "reset-conversation"): void;
  (event: "view-leads"): void;
  (event: "request-install-help", payload: InstallationSupportPayload): void;
  (event: "clear-install-help-message"): void;
}>();

function cloneModel(model: AgentModel): AgentModel {
  return { ...model, widgetQuickActions: model.widgetQuickActions.map((action) => ({ ...action })) };
}

const draft = reactive<AgentModel>(cloneModel(props.model));
const previewMode = ref<"desktop" | "mobile">("desktop");
const quickActionEditorOpen = ref(false);
const editingActionIndex = ref<number | null>(null);
const actionDraft = reactive<QuickAction>({ label: "", question: "" });
const logoPreview = ref(props.model.widgetLogoUrl);
const logoFileName = ref("");
const testPrompt = ref(props.test.question);
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

function syncModel(model: AgentModel): void {
  Object.assign(draft, cloneModel(model));
  logoPreview.value = model.widgetLogoUrl;
  logoFileName.value = "";
}

watch(() => props.businessKey, () => syncModel(props.model));
watch(() => props.model, (model) => syncModel(model), { deep: true });
watch(() => props.verificationMethod, (method) => {
  verificationMethodDraft.value = method;
});
watch(() => props.test.question, (question) => {
  if (!testPrompt.value.trim()) testPrompt.value = question;
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
  localSaved.value = true;
  window.setTimeout(() => (localSaved.value = false), 2600);
  emit("save", cloneModel(draft));
}

function selectTab(tab: AgentTab): void {
  emit("select-tab", tab);
}

function startAddAction(): void {
  editingActionIndex.value = null;
  actionDraft.label = "";
  actionDraft.question = "";
  quickActionEditorOpen.value = true;
}

function editAction(index: number): void {
  editingActionIndex.value = index;
  actionDraft.label = draft.widgetQuickActions[index]?.label ?? "";
  actionDraft.question = draft.widgetQuickActions[index]?.question ?? "";
  quickActionEditorOpen.value = true;
}

function saveAction(): void {
  const action = { label: actionDraft.label.trim(), question: actionDraft.question.trim() };
  if (!action.label || !action.question) return;
  if (editingActionIndex.value === null) draft.widgetQuickActions.push(action);
  else draft.widgetQuickActions.splice(editingActionIndex.value, 1, action);
  quickActionEditorOpen.value = false;
}

function removeAction(index: number): void {
  draft.widgetQuickActions.splice(index, 1);
}

function moveAction(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= draft.widgetQuickActions.length) return;
  const [action] = draft.widgetQuickActions.splice(index, 1);
  draft.widgetQuickActions.splice(nextIndex, 0, action);
}

function previewLogo(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  logoFileName.value = file.name;
  logoPreview.value = URL.createObjectURL(file);
}

function ask(question = testPrompt.value): void {
  const trimmed = question.trim();
  if (!trimmed || props.test.isAsking) return;
  testPrompt.value = trimmed;
  emit("ask-question", trimmed);
}

function submitAction(): void {
  emit("submit-action", { ...props.test.formValues });
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
</script>

<template>
  <div class="agent-experience">
    <div class="agent-header-row">
      <div>
        <p class="eyebrow">AI front desk</p>
        <h2>Agent</h2>
        <p>Configure how your AI front desk behaves, looks, and converts visitors.</p>
      </div>
      <div class="agent-header-actions">
        <span v-if="savedMessage || localSaved" class="saved-message">✓ {{ savedMessage || "Saved" }}</span>
        <button v-if="tab !== 'test' && tab !== 'install'" class="primary-button small" type="button" @click="saveChanges">Save changes</button>
        <button v-if="tab === 'test'" class="outline-button small" type="button" @click="emit('reset-conversation')">Reset conversation</button>
        <button v-if="tab === 'install'" class="primary-button small" type="button" @click="saveChanges">Publish AI front desk</button>
      </div>
    </div>

    <div v-if="tab === 'behavior'" class="agent-config-layout">
      <article class="agent-form-panel panel">
        <section class="agent-section">
          <div class="agent-section-heading"><div><p class="section-kicker">Identity</p><h3>Assistant identity</h3></div></div>
          <label>Assistant name<input v-model="draft.assistantName" type="text" maxlength="120" /></label>
        </section>
        <section class="agent-section">
          <div class="agent-section-heading"><div><p class="section-kicker">Conversation</p><h3>How your assistant speaks</h3></div></div>
          <label>Welcome message<textarea v-model="draft.welcomeMessage" rows="4" maxlength="1000"></textarea></label>
          <div class="field-grid">
            <label>Tone<div class="segmented-control"><button v-for="tone in (['friendly', 'professional', 'concise', 'custom'] as Tone[])" :key="tone" type="button" :class="{ active: draft.tone === tone }" @click="draft.tone = tone">{{ tone[0].toUpperCase() + tone.slice(1) }}</button></div></label>
            <label>Primary language<select v-model="draft.primaryLanguage"><option>English</option><option>Spanish</option><option>French</option><option>Portuguese</option></select></label>
          </div>
        </section>
        <section class="agent-section">
          <div class="agent-section-heading"><div><p class="section-kicker">When AI cannot answer</p><h3>Make the next step clear</h3></div></div>
          <label>Fallback behavior<select v-model="draft.fallbackBehavior"><option value="contact_form">Offer contact form</option><option value="human">Request human</option><option value="unavailable">Say information is unavailable</option></select></label>
          <label class="switch-row"><span><strong>Human handoff</strong><small>Let visitors ask for your team when they need help.</small></span><input v-model="draft.humanHandoffEnabled" type="checkbox" /></label>
        </section>
        <section class="agent-section agent-section-footer">
          <div><strong>Conversation behavior is ready to review.</strong><p>Save changes to use this configuration in the live widget.</p></div>
          <button class="primary-button small" type="button" @click="saveChanges">Save changes</button>
        </section>
      </article>
      <aside class="agent-preview-column"><div class="preview-sticky"><div class="preview-label-row"><div><p class="section-kicker">Customer view</p><h3>Live preview</h3></div><div class="preview-mode-toggle"><button type="button" :class="{ active: previewMode === 'desktop' }" @click="previewMode = 'desktop'">Desktop</button><button type="button" :class="{ active: previewMode === 'mobile' }" @click="previewMode = 'mobile'">Mobile</button></div></div><div aria-label="Widget preview" :class="['customer-preview', `preview-${previewMode}`]" :style="{ '--preview-accent': draft.widgetColor }"><div class="preview-site-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ websiteUrl || 'yourbusiness.com' }}</span></div><div class="preview-site-body"><div class="preview-site-nav"><strong>{{ businessName || 'Your business' }}</strong><span>Services　About　Contact</span></div><div class="preview-site-copy"><span class="preview-badge">AI FRONT DESK · ONLINE</span><h4>More answers.<br />More confidence.</h4><p>Grounded answers from {{ businessName || 'your website' }}.</p></div><div class="preview-chat"><div class="preview-chat-header"><span class="preview-orb">✦</span><span>{{ draft.assistantName || 'AI assistant' }}</span><span class="online-dot"></span></div><div class="preview-chat-bubble">{{ draft.welcomeMessage }}</div><div v-for="action in draft.widgetQuickActions.slice(0, 2)" :key="action.label" class="preview-suggested-action">{{ action.label }} <span>›</span></div><div class="preview-chat-input">Ask a question… <span>➤</span></div></div></div></div><p class="preview-note">Updates appear here as you edit. This is what visitors will see.</p></div></aside>
    </div>

    <div v-else-if="tab === 'appearance'" class="agent-config-layout">
      <article class="agent-form-panel panel">
        <section class="agent-section">
          <div class="agent-section-heading"><div><p class="section-kicker">Brand</p><h3>Appearance</h3><p>Make the front desk feel like part of your website.</p></div></div>
          <div class="logo-upload-row"><div class="logo-preview"><img v-if="logoPreview" :src="logoPreview" alt="Current logo" /><span v-else>✦</span></div><div><strong>{{ logoFileName || (draft.widgetLogoUrl ? 'Current logo' : 'Add your logo') }}</strong><small>PNG, JPG, or SVG · upload for preview</small><label class="upload-button outline-button small">Upload logo<input type="file" accept="image/png,image/jpeg,image/svg+xml" @change="previewLogo" /></label></div></div>
            <details class="advanced-setting"><summary>Advanced · logo URL</summary><label>Logo URL<input v-model="draft.widgetLogoUrl" type="url" placeholder="https://yourbusiness.com/logo.png" /></label><small>Use an HTTPS URL when the logo should persist to the published widget.</small></details>
          <label>Brand color<div class="color-control"><button v-for="color in ['#1769e8', '#18a999', '#7447d9', '#f27b35', '#112c64']" :key="color" type="button" :class="['color-swatch', { selected: draft.widgetColor === color }]" :style="{ background: color }" @click="draft.widgetColor = color"></button><input v-model="draft.widgetColor" type="color" aria-label="Custom brand color" /></div></label>
        </section>
        <section class="agent-section">
          <div class="agent-section-heading"><div><p class="section-kicker">Widget</p><h3>Visitor controls</h3></div></div>
          <label>Theme<div class="segmented-control"><button v-for="theme in (['light', 'dark', 'auto'] as WidgetTheme[])" :key="theme" type="button" :class="{ active: draft.widgetTheme === theme }" @click="draft.widgetTheme = theme">{{ theme[0].toUpperCase() + theme.slice(1) }}</button></div></label>
          <label>Widget position<div class="segmented-control two-up"><button type="button" :class="{ active: draft.widgetPosition === 'bottom-right' }" @click="draft.widgetPosition = 'bottom-right'">Bottom right</button><button type="button" :class="{ active: draft.widgetPosition === 'bottom-left' }" @click="draft.widgetPosition = 'bottom-left'">Bottom left</button></div></label>
          <label>Opening size<div class="segmented-control"><button v-for="size in (['compact', 'expanded', 'fullscreen'] as AgentModel['widgetDefaultMode'][])" :key="size" type="button" :class="{ active: draft.widgetDefaultMode === size }" @click="draft.widgetDefaultMode = size">{{ size === 'fullscreen' ? 'Full screen' : size[0].toUpperCase() + size.slice(1) }}</button></div></label>
          <label class="switch-row"><span><strong>Allow expand</strong><small>Visitors can make the assistant larger when they need more room.</small></span><input v-model="draft.widgetAllowExpand" type="checkbox" /></label>
        </section>
        <section class="agent-section agent-section-footer"><div><strong>Visual changes are ready to review.</strong><p>Save changes when the preview feels right.</p></div><button class="primary-button small" type="button" @click="saveChanges">Save changes</button></section>
      </article>
      <aside class="agent-preview-column"><div class="preview-sticky"><div class="preview-label-row"><div><p class="section-kicker">Customer view</p><h3>Live preview</h3></div><div class="preview-mode-toggle"><button type="button" :class="{ active: previewMode === 'desktop' }" @click="previewMode = 'desktop'">Desktop</button><button type="button" :class="{ active: previewMode === 'mobile' }" @click="previewMode = 'mobile'">Mobile</button></div></div><div aria-label="Widget preview" :class="['customer-preview', `preview-${previewMode}`, `theme-${draft.widgetTheme}`, `position-${draft.widgetPosition}`]" :style="{ '--preview-accent': draft.widgetColor }"><div class="preview-site-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ websiteUrl || 'yourbusiness.com' }}</span></div><div class="preview-site-body"><div class="preview-site-nav"><strong>{{ businessName || 'Your business' }}</strong><span>Services　About　Contact</span></div><div class="preview-site-copy"><span class="preview-badge">AI FRONT DESK · ONLINE</span><h4>More answers.<br />More confidence.</h4><p>Grounded answers from {{ businessName || 'your website' }}.</p></div><div class="preview-chat"><div class="preview-chat-header"><span class="preview-orb">✦</span><span>{{ draft.assistantName || 'AI assistant' }}</span><span class="online-dot"></span></div><div class="preview-chat-bubble">{{ draft.welcomeMessage }}</div><div v-for="action in draft.widgetQuickActions.slice(0, 2)" :key="action.label" class="preview-suggested-action">{{ action.label }} <span>›</span></div><div v-if="draft.showLeadCapture" class="preview-form-simulation"><strong>Let's get your details</strong><label>Name <span>Required ✓</span><input /></label><label>Email <span>Required ✓</span><input /></label><label>Phone <span>Optional</span><input /></label><button>Continue</button></div><div class="preview-chat-input">Ask a question… <span>➤</span></div></div></div></div><p class="preview-note">Updates appear here as you edit. This is what visitors will see.</p></div></aside>
    </div>

    <div v-else-if="tab === 'quick-actions'" class="agent-config-layout">
      <article class="agent-form-panel panel">
        <section class="agent-section quick-actions-section"><div class="agent-section-heading action-heading"><div><p class="section-kicker">Guide visitors</p><h3>Quick actions</h3><p>Keep this list short. The same buttons appear in the visitor preview.</p></div><button class="primary-button small" type="button" :disabled="draft.widgetQuickActions.length >= 5" @click="startAddAction">+ Add quick action</button></div><div v-if="!draft.widgetQuickActions.length" class="empty-actions"><strong>Start with a helpful question.</strong><p>Add one action to give visitors an easy first step.</p><button class="outline-button small" type="button" @click="startAddAction">Add quick action</button></div><div v-else class="compact-action-list"><article v-for="(action, index) in draft.widgetQuickActions" :key="`${action.label}-${index}`" class="compact-action-row"><button class="drag-handle" type="button" aria-label="Move action up" @click="moveAction(index, -1)">≡</button><div class="compact-action-copy"><strong>{{ action.label }}</strong><span>“{{ action.question }}”</span></div><div class="compact-action-controls"><button type="button" @click="editAction(index)">Edit</button><button type="button" @click="removeAction(index)">Delete</button></div></article></div></section>
        <section v-if="quickActionEditorOpen" class="action-drawer"><div class="agent-section-heading"><div><p class="section-kicker">{{ editingActionIndex === null ? 'New action' : 'Edit action' }}</p><h3>Quick action details</h3></div><button class="icon-button" type="button" aria-label="Close" @click="quickActionEditorOpen = false">×</button></div><label>Label<input v-model="actionDraft.label" maxlength="48" placeholder="Explore services" /></label><label>Customer message<input v-model="actionDraft.question" maxlength="300" placeholder="What services do you offer?" /></label><label>Action type<select><option>Ask AI</option><option>Open lead form</option><option>Request human</option></select></label><div class="drawer-actions"><button class="outline-button small" type="button" @click="quickActionEditorOpen = false">Cancel</button><button class="primary-button small" type="button" :disabled="!actionDraft.label.trim() || !actionDraft.question.trim()" @click="saveAction">Save action</button></div></section>
        <section class="agent-section agent-section-footer"><div><strong>{{ draft.widgetQuickActions.length }} of 5 recommended actions</strong><p>Use specific questions that help visitors choose what to do next.</p></div><button class="primary-button small" type="button" @click="saveChanges">Save changes</button></section>
      </article>
      <aside class="agent-preview-column"><div class="preview-sticky"><div class="preview-label-row"><div><p class="section-kicker">Customer view</p><h3>Live preview</h3></div></div><div class="action-preview-card"><div class="preview-chat-header"><span class="preview-orb" :style="{ background: draft.widgetColor }">✦</span><span>{{ draft.assistantName || 'AI assistant' }}</span><span class="online-dot"></span></div><div class="preview-chat-bubble">{{ draft.welcomeMessage }}</div><button v-for="action in draft.widgetQuickActions" :key="action.label" class="preview-action-button" type="button">{{ action.label }} <span>›</span></button><div v-if="draft.showLeadCapture" class="preview-chat-input">Ask a question… <span>➤</span></div></div><p class="preview-note">Every action is immediately reflected in the customer preview.</p></div></aside>
    </div>

    <div v-else-if="tab === 'test'" class="agent-test-layout">
      <article class="test-conversation panel"><div class="test-conversation-header"><div><p class="section-kicker">Production conversation</p><h3>Test what customers will experience</h3><p>Use the real conversation path to check answers, actions, forms, and handoff.</p></div><span v-if="test.conversationId" class="conversation-status">Conversation active</span></div><div class="test-thread"><div class="test-welcome"><span class="preview-orb" :style="{ background: draft.widgetColor }">✦</span><div><strong>{{ draft.assistantName || 'AI assistant' }}</strong><small>Answers from {{ businessName || 'your business' }} knowledge</small></div></div><div v-if="test.question" class="test-user-message">{{ test.question }}</div><div v-if="test.answer" class="test-answer-message"><div class="answer-meta"><span v-if="test.action" class="answer-badge grounded">✓ {{ test.action.status === 'completed' ? 'Flow completed' : 'Conversation flow' }}</span><span v-else :class="['answer-badge', test.grounded ? 'grounded' : 'fallback']">{{ test.grounded ? '✓ Grounded answer' : '! Safe fallback' }}</span></div><p>{{ test.answer }}</p><form v-if="test.action?.form" class="test-action-form" @submit.prevent="submitAction"><label v-for="field in test.action.form.fields" :key="field.id">{{ field.label }} <span v-if="!field.required">optional</span><select v-if="field.type === 'select'" v-model="test.formValues[field.key]" :required="field.required"><option value="">Select…</option><option v-for="option in field.options ?? []" :key="option" :value="option">{{ option }}</option></select><input v-else v-model="test.formValues[field.key]" :type="field.type === 'phone' ? 'tel' : field.type" :required="field.required" /></label><button class="primary-button small" type="submit" :disabled="test.isAsking">{{ test.isAsking ? 'Submitting…' : test.action.form.submitLabel }}</button></form><div v-if="test.citations.length" class="test-citations"><span>Sources ({{ test.citations.length }})</span><a v-for="citation in test.citations" :key="citation.url" :href="citation.url" target="_blank" rel="noreferrer">{{ citation.title || citation.url }} ↗</a></div></div><div v-else class="test-empty">Ask a question to see the live answer and its sources.</div></div><div v-if="test.suggestedQuestions.length" class="test-suggestions"><span>Try a common question</span><button v-for="suggestion in test.suggestedQuestions.slice(0, 4)" :key="suggestion" type="button" @click="ask(suggestion)">{{ suggestion }} <b>›</b></button></div><form class="test-composer" @submit.prevent="ask()"><input v-model="testPrompt" type="text" placeholder="e.g. What services do you offer?" aria-label="Test customer question" /><button class="primary-button small" type="submit" :disabled="test.isAsking || !testPrompt.trim()">{{ test.isAsking ? 'Checking…' : 'Send as visitor' }}</button></form></article>
      <aside class="test-owner-panel panel"><div class="agent-section-heading"><div><p class="section-kicker">Owner checks</p><h3>What to verify</h3></div></div><div class="owner-check-list"><div><span :class="statusClass(Boolean(test.answer && test.grounded))">✓</span><span><strong>Grounded answers</strong><small>{{ test.answer && test.grounded ? 'Grounded in business knowledge' : 'Ask a knowledge question' }}</small></span></div><div><span :class="statusClass(test.citations.length > 0)">✓</span><span><strong>Sources</strong><small>{{ test.citations.length ? `${test.citations.length} source${test.citations.length === 1 ? '' : 's'}` : 'Sources appear with grounded answers' }}</small></span></div><div><span :class="statusClass(Boolean(test.action))">✓</span><span><strong>Action flows</strong><small>{{ test.action ? 'Action flow is running in the conversation' : 'Try a quick action or ask for help' }}</small></span></div><div><span :class="statusClass(Boolean(test.action?.status === 'completed'))">✓</span><span><strong>Completion</strong><small>{{ test.action?.status === 'completed' ? 'Test lead captured' : 'Submit the conversational form to verify' }}</small></span></div></div><div v-if="test.action?.status === 'completed'" class="test-success"><strong>✓ Test lead captured</strong><button class="text-button" type="button" @click="emit('view-leads')">View in Leads →</button></div><p class="test-owner-note">Internal details stay summarized here. Visitors only see the conversation.</p></aside>
    </div>

    <div v-else class="install-experience">
      <div class="install-status-card panel"><div><p class="section-kicker">Website status</p><h3>Know what is live</h3></div><div class="install-status-list"><span :class="statusClass(ownershipStatus === 'verified')">✓ <strong>Domain verified</strong></span><span :class="statusClass(Boolean(install?.verification.loadCount))">✓ <strong>Widget installed</strong></span><span :class="statusClass(authReady && !billingReadOnly)">✓ <strong>Agent published</strong></span></div></div>
      <div class="install-step-grid">
        <article class="install-step panel"><span class="step-number">1</span><div><p class="section-kicker">Verify website</p><h3>{{ ownershipStatus === 'verified' ? 'Website verified' : 'Protect your website' }}</h3><p>{{ ownershipStatus === 'verified' ? 'Ownership is verified for this business.' : 'Complete ownership verification before publishing the live widget.' }}</p><span v-if="ownershipStatus === 'verified'" class="status-text success">✓ Ready to publish</span><template v-else><div class="install-verification-controls"><label>Method<select v-model="verificationMethodDraft"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><div class="drawer-actions"><button class="outline-button small" type="button" :disabled="verificationLoading" @click="emit('start-verification', verificationMethodDraft)">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethodDraft !== 'email' && verificationMethodDraft !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="emit('check-verification')">Check now</button></div></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="ownershipMessage" class="status-text success">✓ {{ ownershipMessage }}</p><p v-if="ownershipError" class="form-error">{{ ownershipError }}</p></template></div></article>
        <article class="install-step panel"><span class="step-number">2</span><div><p class="section-kicker">Install widget</p><h3>Choose your platform</h3><div class="install-platform-tabs"><button v-for="platform in ([['wordpress', 'WordPress'], ['wix', 'Wix'], ['shopify', 'Shopify'], ['squarespace', 'Squarespace'], ['custom', 'Custom'], ['not_sure', 'Not sure']] as Array<[InstallPlatform, string]>)" :key="platform[0]" :class="{ active: installPlatform === platform[0] }" type="button" @click="installPlatform = platform[0]">{{ platform[1] }}</button></div><p v-if="install" class="install-help">{{ installInstructions }} {{ businessName || 'your website' }}.</p><div v-if="install" class="snippet-box"><code>{{ install.snippet }}</code><button class="primary-button small" type="button" @click="emit('copy-snippet')">Copy code</button></div><div v-else class="install-gate"><p>{{ authReady ? 'Your private install snippet is loading.' : 'Sign in to generate a private install snippet.' }}</p><button class="outline-button small" type="button" @click="authReady ? emit('refresh-install') : emit('require-auth')">{{ authReady ? 'Refresh install details' : 'Create account to install' }}</button></div></div></article>
        <article class="install-step panel"><span class="step-number">3</span><div><p class="section-kicker">Test installation</p><h3>Check the live widget</h3><p>Confirm the widget is on the right business and the agent is online.</p><button class="outline-button small" type="button" :disabled="verificationLoading || !install" @click="emit('verify-install')">{{ verificationLoading ? 'Checking…' : 'Check installation' }}</button><p v-if="verificationMessage" :class="['status-text', install?.verification.loadCount ? 'success' : 'error']">{{ install?.verification.loadCount ? '✓' : '!' }} {{ verificationMessage }}</p><div v-if="verificationMessage && install && !install.verification.loadCount" class="install-detection-help"><strong>We couldn't detect FrontDeskWise yet.</strong><span>Check the instructions, try again, or let us help you get live.</span><div class="drawer-actions"><button class="text-button" type="button" @click="openSupportDrawer">Check instructions</button><button class="primary-button small" type="button" @click="openSupportDrawer">Get help installing</button></div></div><div v-if="install" class="install-check-results"><span :class="statusClass(Boolean(install.verification.loadCount))">✓ Widget detected</span><span :class="statusClass(Boolean(install.siteKey))">✓ Correct business ID</span><span :class="statusClass(authReady && !billingReadOnly)">✓ Agent online</span></div></div></article>
        <article class="install-step publish-step panel"><span class="step-number">4</span><div><p class="section-kicker">Publish</p><h3>Make the front desk live</h3><p>Save the current Agent configuration and publish it to this business.</p><button class="primary-button small" type="button" :disabled="!authReady || billingReadOnly || ownershipStatus !== 'verified'" @click="saveChanges">{{ billingReadOnly ? 'Billing needs attention' : ownershipStatus !== 'verified' ? 'Verify website first' : 'Publish AI front desk' }}</button><p v-if="installMessage" class="status-text success">✓ {{ installMessage }}</p></div></article>
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
        <label>Name<input v-model="supportForm.name" type="text" autocomplete="name" required /></label>
        <label>Business<input :value="businessName" type="text" readonly /></label>
        <label>Website<input :value="websiteUrl" type="url" readonly /></label>
        <label>Platform<select v-model="supportForm.platform"><option value="wordpress">WordPress</option><option value="wix">Wix</option><option value="shopify">Shopify</option><option value="squarespace">Squarespace</option><option value="custom">Custom</option><option value="not_sure">Not sure</option></select></label>
        <label>What do you need help with?<input v-model="supportForm.helpRequest" type="text" maxlength="240" required placeholder="e.g. I’m not sure where to paste the code" /></label>
        <label>Preferred contact method<select v-model="supportForm.preferredContactMethod"><option value="email">Email</option><option value="phone">Phone</option></select></label>
        <label>{{ supportForm.preferredContactMethod === 'email' ? 'Email address' : 'Phone number' }}<input v-model="supportForm.contactValue" :type="supportForm.preferredContactMethod === 'email' ? 'email' : 'tel'" required /></label>
        <label>Message <span class="optional">optional</span><textarea v-model="supportForm.message" rows="4" maxlength="4000" placeholder="Add any details that would help us understand where you’re stuck."></textarea></label>
        <label>Screenshot link <span class="optional">optional</span><input v-model="supportForm.screenshotUrl" type="url" placeholder="https://…" /></label>
        <p v-if="installationSupportError" class="form-error">{{ installationSupportError }}</p>
        <div class="drawer-actions"><button class="outline-button small" type="button" @click="supportDrawerOpen = false">Cancel</button><button class="primary-button small" type="submit" :disabled="installationSupportLoading">{{ installationSupportLoading ? 'Sending…' : 'Request installation help' }}</button></div>
      </form>
    </aside>
  </div>
</template>

<style scoped>
.agent-experience { --agent-border: #dfe6ef; --agent-muted: #687892; --agent-ink: #14233d; }
.agent-header-row, .preview-label-row, .test-conversation-header, .agent-section-heading, .action-heading, .install-status-card { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.agent-header-row { margin-bottom: 22px; }
.agent-header-row h2 { margin: 0; color: var(--agent-ink); font-size: 30px; letter-spacing: -.05em; }
.agent-header-row p:not(.eyebrow), .agent-section-heading p:not(.section-kicker), .test-conversation-header p:not(.section-kicker), .install-step p:not(.section-kicker) { margin: 7px 0 0; color: var(--agent-muted); font-size: 13px; line-height: 1.5; }
.agent-header-actions, .drawer-actions, .compact-action-controls, .install-platform-tabs, .preview-mode-toggle { display: flex; align-items: center; gap: 8px; }
.agent-config-layout { display: grid; grid-template-columns: minmax(0, .82fr) minmax(360px, 1.18fr); gap: 22px; align-items: start; }
.agent-form-panel { padding: 0; overflow: hidden; }
.agent-section { padding: 24px; border-bottom: 1px solid var(--agent-border); }
.agent-section:last-child { border-bottom: 0; }
.agent-section h3, .preview-label-row h3, .test-conversation-header h3, .install-step h3, .install-status-card h3 { margin: 0; color: var(--agent-ink); font-size: 17px; letter-spacing: -.025em; }
.section-kicker { margin: 0 0 7px; color: #2f80ed; font-size: 10px; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.agent-section label, .action-drawer label, .test-action-form label { display: grid; gap: 7px; margin-top: 18px; color: #586b86; font-size: 12px; font-weight: 700; }
.agent-section label:first-of-type { margin-top: 18px; }
.agent-section input:not([type="checkbox"]):not([type="color"]), .agent-section textarea, .agent-section select, .action-drawer input, .action-drawer select, .test-composer input, .test-action-form input, .test-action-form select { width: 100%; min-height: 40px; padding: 10px 11px; border: 1px solid #cfd9e7; border-radius: 8px; color: var(--agent-ink); background: #fff; font-size: 13px; }
.agent-section textarea { resize: vertical; }
.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
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
.preview-sticky { position: sticky; top: calc(var(--workspace-header-height, 72px) + 22px); }
.preview-label-row { align-items: center; margin-bottom: 10px; }
.preview-mode-toggle { padding: 3px; border: 1px solid #d7e0eb; border-radius: 7px; background: #eef2f7; }
.preview-mode-toggle button { padding: 6px 9px; border: 0; border-radius: 5px; color: var(--agent-muted); background: transparent; font-size: 11px; font-weight: 700; }
.preview-mode-toggle button.active { color: var(--agent-ink); background: #fff; box-shadow: 0 1px 2px rgba(20,42,74,.12); }
.customer-preview { position: relative; min-height: 570px; overflow: hidden; border: 1px solid var(--agent-border); border-radius: 14px; background: #eaf7fc; box-shadow: 0 18px 45px rgba(20,42,74,.08); }
.customer-preview.preview-mobile { width: min(100%, 390px); min-height: 640px; margin: 0 auto; }
.preview-site-bar { display: flex; align-items: center; gap: 6px; padding: 12px 15px; color: #8795a8; background: #f8fafc; font-size: 10px; }
.preview-site-bar > span:last-child { flex: 1; margin-left: 5px; padding: 6px 9px; border-radius: 6px; background: #fff; }
.preview-site-body { position: relative; min-height: 526px; overflow: hidden; background: linear-gradient(135deg, #dff5fb, #effafe 50%, #d6edf8); }
.preview-site-nav { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 17px 22px; color: #2b6489; background: rgba(255,255,255,.85); font-size: 10px; }
.preview-site-nav strong { color: #164c86; font-size: 12px; }
.preview-site-copy { padding: 60px 28px; color: #155277; }
.preview-badge { color: #2f80ed; font-size: 9px; font-weight: 800; letter-spacing: .12em; }
.preview-site-copy h4 { margin: 12px 0 8px; color: #125687; font-size: 34px; line-height: 1; letter-spacing: -.06em; }
.preview-site-copy p { max-width: 220px; color: #4a7e9c; font-size: 12px; line-height: 1.5; }
.preview-chat, .action-preview-card { border: 1px solid #dbe4ef; border-radius: 15px; background: #fff; box-shadow: 0 18px 45px rgba(20,42,74,.17); }
.preview-chat { position: absolute; right: 22px; bottom: 22px; width: 270px; padding: 14px; }
.preview-mobile .preview-chat { right: 12px; left: 12px; width: auto; }
.preview-chat-header, .test-welcome { display: flex; align-items: center; gap: 8px; color: #17386e; font-size: 12px; font-weight: 750; }
.preview-orb { display: grid; width: 28px; height: 28px; flex: 0 0 28px; place-items: center; border-radius: 8px; color: #fff; background: var(--preview-accent, #1769e8); }
.online-dot { width: 7px; height: 7px; margin-left: auto; border-radius: 50%; background: #19b486; }
.preview-chat-bubble { margin-top: 13px; padding: 10px; border-radius: 8px 12px 12px 12px; color: #52657e; background: #f5f8fc; font-size: 11px; line-height: 1.45; }
.preview-suggested-action, .preview-action-button { display: flex; justify-content: space-between; width: 100%; margin-top: 8px; padding: 9px 10px; border: 1px solid #d5e3f2; border-radius: 8px; color: #21568f; background: #fff; font-size: 10px; font-weight: 700; text-align: left; }
.preview-suggested-action span, .preview-action-button span { color: var(--preview-accent, #1769e8); font-size: 15px; line-height: 10px; }
.preview-chat-input { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 10px 4px 0; border-top: 1px solid #edf0f5; color: #9aa7b7; font-size: 10px; }
.preview-chat-input span { color: var(--preview-accent, #1769e8); font-size: 14px; }
.preview-note, .test-owner-note, .install-note { margin: 10px 0 0; color: var(--agent-muted); font-size: 11px; line-height: 1.5; }
.theme-dark .preview-site-body { background: #192941; }
.theme-dark .preview-site-nav { color: #d4e1f1; background: #243a58; }
.theme-dark .preview-site-nav strong, .theme-dark .preview-site-copy, .theme-dark .preview-site-copy h4 { color: #fff; }
.theme-dark .preview-site-copy p { color: #bfd0e5; }
.position-bottom-left .preview-chat { right: auto; left: 22px; }
.position-bottom-left.preview-mobile .preview-chat { left: 12px; }
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
.test-conversation, .test-owner-panel { padding: 22px; }
.test-thread { display: grid; gap: 12px; min-height: 330px; margin-top: 20px; padding: 18px; border: 1px solid var(--agent-border); border-radius: 12px; background: #f8fafd; }
.test-welcome { padding-bottom: 14px; border-bottom: 1px solid var(--agent-border); }
.test-welcome strong, .test-welcome small { display: block; }
.test-welcome small { margin-top: 3px; color: var(--agent-muted); font-size: 11px; font-weight: 500; }
.test-user-message, .test-answer-message { max-width: 86%; padding: 11px 13px; border-radius: 8px 14px 14px 14px; font-size: 13px; line-height: 1.5; }
.test-user-message { justify-self: end; border-radius: 14px 8px 14px 14px; color: #fff; background: #1769e8; }
.test-answer-message { color: #40516d; background: #fff; }
.test-answer-message p { margin: 10px 0 0; white-space: pre-wrap; }
.answer-meta { display: flex; gap: 7px; align-items: center; }
.answer-badge { display: inline-flex; padding: 4px 7px; border-radius: 999px; font-size: 10px; font-weight: 800; }
.answer-badge.grounded { color: #08785d; background: #e7f8f1; }
.answer-badge.fallback { color: #95630c; background: #fff5df; }
.test-action-form { display: grid; gap: 8px; margin-top: 14px; padding-top: 13px; border-top: 1px solid var(--agent-border); }
.test-action-form label { margin-top: 0; font-size: 11px; }
.test-action-form label > span { color: #8a9ab1; font-size: 10px; font-weight: 500; }
.test-citations { display: grid; gap: 5px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--agent-border); font-size: 11px; }
.test-citations span { color: var(--agent-muted); font-weight: 750; }
.test-citations a { overflow: hidden; color: #2168d8; text-overflow: ellipsis; white-space: nowrap; }
.test-empty { display: grid; min-height: 210px; place-items: center; color: var(--agent-muted); font-size: 12px; text-align: center; }
.test-suggestions { display: flex; gap: 7px; align-items: center; flex-wrap: wrap; margin-top: 16px; }
.test-suggestions > span { width: 100%; color: var(--agent-muted); font-size: 11px; font-weight: 700; }
.test-suggestions button { padding: 8px 10px; border: 1px solid #cfe0f3; border-radius: 999px; color: #20558e; background: #fff; font-size: 11px; font-weight: 700; }
.test-suggestions button b { color: #1769e8; font-size: 15px; }
.test-composer { display: flex; gap: 8px; margin-top: 16px; }
.test-composer input { min-width: 0; flex: 1; }
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
.install-step { display: flex; gap: 14px; align-items: flex-start; padding: 20px; }
.step-number { display: grid; width: 27px; height: 27px; flex: 0 0 27px; place-items: center; border-radius: 50%; color: #fff; background: #1769e8; font-size: 12px; font-weight: 800; }
.install-step > div { min-width: 0; flex: 1; }
.install-platform-tabs { margin: 15px 0 12px; overflow-x: auto; border-bottom: 1px solid var(--agent-border); }
.install-platform-tabs button { flex: 0 0 auto; padding: 7px 3px 9px; border: 0; color: var(--agent-muted); background: transparent; font-size: 11px; font-weight: 700; }
.install-platform-tabs button.active { color: #1769e8; border-bottom: 2px solid #1769e8; }
.install-verification-controls { display: grid; gap: 10px; margin-top: 15px; }
.install-verification-controls .drawer-actions { justify-content: flex-start; margin-top: 0; }
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
.support-form input, .support-form select, .support-form textarea { width: 100%; min-height: 40px; padding: 10px 11px; border: 1px solid #cfd9e7; border-radius: 8px; color: var(--agent-ink); background: #fff; font: inherit; font-size: 13px; }
.support-form textarea { resize: vertical; }
.support-form input[readonly] { color: #687892; background: #f7f9fc; }
.support-form .optional { color: #8795a8; font-size: 10px; font-weight: 500; }
.support-success { margin-top: 22px; padding: 16px; border: 1px solid #b9e8d9; border-radius: 10px; color: #08785d; background: #edfaf5; }
.support-success strong { font-size: 13px; }
.support-success p { margin: 6px 0 13px; color: #386e60; font-size: 12px; line-height: 1.5; }
.install-support-drawer > .auth-close { position: absolute; top: 17px; right: 20px; border: 0; color: var(--agent-muted); background: transparent; font-size: 25px; }
.publish-step { background: #f8fbff; }
@media (max-width: 980px) { .agent-config-layout, .agent-test-layout { grid-template-columns: 1fr; } .preview-sticky { position: static; } .agent-preview-column { order: -1; } .install-step-grid { grid-template-columns: 1fr; } }
@media (max-width: 640px) { .install-support { display: block; } .install-support-actions { justify-content: flex-start; margin-top: 16px; } .install-support-drawer { padding: 24px 18px; } }
@media (max-width: 640px) { .agent-header-row, .install-status-card, .agent-section-footer { display: block; } .agent-header-actions { margin-top: 16px; } .field-grid { grid-template-columns: 1fr; } .agent-section { padding: 19px; } .compact-action-row { align-items: flex-start; } .compact-action-controls { flex-direction: column; gap: 0; } .test-conversation, .test-owner-panel { padding: 17px; } .test-composer { display: grid; } .test-composer .primary-button { width: 100%; } .install-status-list { margin-top: 15px; } }
</style>
