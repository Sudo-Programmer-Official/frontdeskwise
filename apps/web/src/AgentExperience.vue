<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, toRef, watch } from "vue";
import { Check, GripVertical, MoreHorizontal, Plus, X } from "@lucide/vue";
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
import type { WidgetAction, WidgetScenario, WidgetState } from "./widget-ui/renderer";

type AgentTab = "capabilities" | "behavior" | "knowledge" | "appearance" | "quick-actions" | "actions" | "test" | "install";
type Tone = "friendly" | "professional" | "concise" | "custom";
type FallbackBehavior = "contact_form" | "human" | "unavailable";
type WidgetTheme = "light" | "dark" | "auto";
type WidgetPosition = "bottom-right" | "bottom-left";
type ProactiveTrigger = "delay" | "scroll" | "exit" | "returning";
type ProactiveBehavior = "teaser" | "open";
type ProactiveFrequency = "session" | "24h" | "visit";
type CitationVisibility = "always" | "contextual" | "hidden";
type QuickActionKind = "KNOWLEDGE" | "WORKFLOW" | "ACTION" | "HANDOFF";
type QuickActionReadiness = "ready" | "blocked";
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
  kind?: QuickActionKind;
  targetId?: string;
  approved?: boolean;
  generated?: boolean;
}

interface AgentWorkflow {
  id: string;
  name: string;
  description?: string;
  steps?: Array<Record<string, unknown>>;
  completion?: { createLead?: boolean; notifyStaff?: boolean; requiresStaff?: boolean; workflow?: { name?: string } };
  workflowStatus?: "DRAFT" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
  readiness?: { ready?: boolean; reason?: string };
  enabled?: boolean;
  actionType?: string;
  provider?: string | null;
  executionMode?: string;
  isPrimary?: boolean;
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
  form?: {
    submitLabel: string;
    fields: TestActionField[];
    contactRequirement?: { fieldKeys: string[]; message: string };
  };
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
  suggestedQuestions: string[];
  agentTested: boolean;
  installationSupportLoading: boolean;
  installationSupportMessage: string;
  installationSupportError: string;
  openSupportRequest: number;
  test: TestModel;
  capabilities: AgentCapability[];
  workflows: AgentWorkflow[];
}>();

const emit = defineEmits<{
  (event: "select-tab", tab: AgentTab): void;
  (event: "save", payload: AgentModel): void;
  (event: "publish", payload: AgentModel): void;
  (event: "logo-preview", previewUrl: string): void;
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
  (event: "open-workflow", workflowId?: string): void;
}>();

function cloneModel(model: AgentModel): AgentModel {
  return { ...model, widgetQuickActions: model.widgetQuickActions.map((action) => ({ ...action })) };
}

const draft = ref<AgentModel>(cloneModel(props.model));
const agentDraft = computed(() => draft.value);
const previewMode = ref<"desktop" | "mobile">("desktop");
const behaviorPane = ref<"settings" | "preview">("settings");
const behaviorSettingsPanel = ref<HTMLElement | null>(null);
const behaviorPreviewScenario = ref<WidgetScenario>("conversation");
const behaviorPreviewLabel = ref("Conversation");
let behaviorScrollContainer: HTMLElement | null = null;
const quickActionEditorOpen = ref(false);
const editingActionIndex = ref<number | null>(null);
const openQuickActionMenuIndex = ref<number | null>(null);
const recommendationsApplied = ref(false);
const actionDraft = reactive<QuickAction>({ label: "", question: "" });
const actionLabel = toRef(actionDraft, "label");
const actionQuestion = toRef(actionDraft, "question");
const editingActionConnection = computed(() => {
  const index = editingActionIndex.value;
  return quickActionConnection(index === null ? actionDraft : draft.value.widgetQuickActions[index] ?? actionDraft);
});
const recommendedQuickActions = computed<QuickAction[]>(() => buildQuickActionRecommendations());
const quickActionPublishIssues = computed(() => draft.value.widgetQuickActions
  .map((action) => ({ action, readiness: quickActionReadiness(action) }))
  .filter(({ action, readiness }) => quickActionNeedsApproval(action) || readiness.readiness === "blocked"));
const maxPersistedLogoBytes = 512 * 1024;
const allowedLogoTypes = new Set(["image/png", "image/jpeg", "image/svg+xml"]);
const logoPreview = ref(props.model.widgetLogoUrl);
const logoFileName = ref("");
const logoProcessing = ref(false);
const logoError = ref("");
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
      contactRequirement: action.form.contactRequirement,
      fields: action.form.fields.map((field) => ({ id: field.id, key: field.key, label: field.label, type: field.type, required: field.required, options: field.options, value: latestAssistant.formValues[field.key] ?? "" })),
    } : undefined,
  } : null;
  return {
    // Agent Test is an owner QA surface: show the conversation immediately
    // so the workflow result is visible without requiring a launcher click.
    isOpen: true,
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
const hasDraftChanges = computed(() => JSON.stringify(draft.value) !== JSON.stringify(props.model));
const behaviorSaveStatus = computed(() => hasDraftChanges.value ? "Unsaved changes" : hasUnpublishedChanges.value ? "Unpublished changes" : isLive.value ? "Live" : "All changes saved");
const behaviorSaveStatusCopy = computed(() => hasDraftChanges.value ? "Save before publishing this configuration." : hasUnpublishedChanges.value ? "Publish when you are ready to update the live front desk." : isLive.value ? "Your live front desk matches this configuration." : "Your current configuration is saved.");
const behaviorPublishLabel = computed(() => publishStatus.value === "PUBLISHING" ? "Publishing…" : isLive.value ? "Publish updates" : "Publish AI front desk");
const behaviorPublishDisabled = computed(() => publishStatus.value === "PUBLISHING" || props.ownershipStatus !== "verified" || props.billingReadOnly);
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
  recommendationsApplied.value = false;
  logoPreview.value = model.widgetLogoUrl;
  logoFileName.value = "";
  logoProcessing.value = false;
  logoError.value = "";
}

function updateBehaviorPreviewFocus(): void {
  const panel = behaviorSettingsPanel.value;
  if (!panel || props.tab !== "behavior") return;
  const sections = [...panel.querySelectorAll<HTMLElement>("[data-preview-scenario]")];
  if (!sections.length) return;

  const pivot = Math.min(window.innerHeight * 0.34, 360);
  let activeSection = sections[0];
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= pivot) activeSection = section;
  }
  behaviorPreviewScenario.value = (activeSection.dataset.previewScenario as WidgetScenario | undefined) ?? "conversation";
  behaviorPreviewLabel.value = activeSection.dataset.previewLabel ?? "Conversation";
}

function teardownBehaviorPreviewTracking(): void {
  behaviorScrollContainer?.removeEventListener("scroll", updateBehaviorPreviewFocus);
  behaviorScrollContainer = null;
}

function setupBehaviorPreviewTracking(): void {
  teardownBehaviorPreviewTracking();
  if (props.tab !== "behavior") return;
  nextTick(() => {
    if (props.tab !== "behavior" || !behaviorSettingsPanel.value) return;
    behaviorScrollContainer = behaviorSettingsPanel.value.closest(".content-area") as HTMLElement | null;
    behaviorScrollContainer?.addEventListener("scroll", updateBehaviorPreviewFocus, { passive: true });
    updateBehaviorPreviewFocus();
  });
}

watch(() => props.businessKey, () => syncModel(props.model));
watch(() => props.model, (model) => syncModel(model), { deep: true });
watch(() => props.tab, () => {
  behaviorPane.value = "settings";
  setupBehaviorPreviewTracking();
});
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

onMounted(setupBehaviorPreviewTracking);
onBeforeUnmount(teardownBehaviorPreviewTracking);

function saveChanges(): void {
  if (!props.authReady) {
    emit("require-auth");
    return;
  }
  if (logoProcessing.value || logoError.value) return;
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
  if (quickActionPublishIssues.value.length) {
    selectTab("quick-actions");
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

function workflowStatusLabel(workflow: AgentWorkflow): string {
  if (workflow.workflowStatus === "LIVE") return "Live";
  if (workflow.workflowStatus === "LIVE_WITH_UNPUBLISHED_CHANGES") return "Live · changes";
  return "Draft";
}

function workflowUsesCapability(workflow: AgentWorkflow, capabilityId: string): boolean {
  const stepTypes = new Set((workflow.steps ?? []).map((step) => String(step.type ?? "").toLowerCase()));
  const actionText = `${workflow.name} ${workflow.description ?? ""} ${workflow.actionType ?? ""}`.toLowerCase();
  if (capabilityId === "answer") return stepTypes.has("knowledge");
  if (capabilityId === "capture") return Boolean(workflow.completion?.createLead) || ["capture", "form", "create_lead"].some((type) => stepTypes.has(type));
  if (capabilityId === "handoff") return Boolean(workflow.completion?.notifyStaff || workflow.completion?.requiresStaff) || ["handoff", "notify"].some((type) => stepTypes.has(type));
  if (capabilityId === "booking") return /book|appointment|booking|reserve|schedule/.test(actionText) || ["book", "lookup", "generate_link"].some((type) => stepTypes.has(type));
  if (capabilityId === "lead-delivery") return Boolean(workflow.completion?.notifyStaff);
  return false;
}

function workflowsForCapability(capability: AgentCapability): AgentWorkflow[] {
  return props.workflows.filter((workflow) => workflowUsesCapability(workflow, capability.id));
}

function quickActionText(action: QuickAction): string {
  return `${action.label} ${action.question}`.toLowerCase();
}

function workflowForQuickAction(action: QuickAction): AgentWorkflow | null {
  if (action.targetId) {
    const targeted = props.workflows.find((workflow) => workflow.id === action.targetId);
    if (targeted) return targeted;
  }
  const actionText = quickActionText(action);
  if (/book|appointment|booking|reserve|schedule|availability|find a class/.test(actionText)) {
    return props.workflows.find((workflow) => workflowUsesCapability(workflow, "booking") || /book|appointment|booking|reserve|schedule/i.test(`${workflow.name} ${workflow.description ?? ""}`)) ?? null;
  }
  if (/lead|contact|demo|trial|tour|get started|start|quote|estimate|service|emergency/.test(actionText)) {
    return props.workflows.find((workflow) => /demo|trial|tour|quote|estimate/.test(actionText) && /demo|trial|tour|quote|estimate/.test(`${workflow.name} ${workflow.description ?? ""}`.toLowerCase()))
      ?? props.workflows.find((workflow) => workflowUsesCapability(workflow, "capture"))
      ?? null;
  }
  return null;
}

function inferQuickActionKind(action: QuickAction): QuickActionKind {
  const actionText = quickActionText(action);
  const inferredKind: QuickActionKind = /talk to|speak to|contact (the )?team|human|person/.test(actionText)
    ? "HANDOFF"
    : /book|appointment|booking|reserve|schedule|quote|estimate|demo|trial|tour|start free|free trial|check availability|availability|request service|service request|find a class|emergency help|contact sales|talk to sales/.test(actionText)
      ? "WORKFLOW"
      : "KNOWLEDGE";
  if (inferredKind === "HANDOFF" && action.kind && action.kind !== "HANDOFF") return inferredKind;
  if ((action.kind === "KNOWLEDGE" || action.kind === "HANDOFF") && action.kind !== inferredKind) return inferredKind;
  if (action.kind) return action.kind;
  const workflow = workflowForQuickAction(action);
  if (workflow) return workflow.steps?.length ? "WORKFLOW" : "ACTION";
  return inferredKind;
}

function quickActionReadiness(action: QuickAction): { kind: QuickActionKind; readiness: QuickActionReadiness; reason: string; target: AgentWorkflow | null } {
  const kind = inferQuickActionKind(action);
  if (action.approved === false && action.generated !== true) return { kind, readiness: "blocked", reason: "Owner approval required", target: workflowForQuickAction(action) };
  if (kind === "HANDOFF") {
    return draft.value.humanHandoffEnabled
      ? { kind, readiness: "ready", reason: "Human handoff is enabled", target: null }
      : { kind, readiness: "blocked", reason: "Human handoff is disabled in Agent Behavior", target: null };
  }
  if (kind === "KNOWLEDGE") {
    return props.knowledgeReady
      ? { kind, readiness: "ready", reason: "Verified knowledge available", target: null }
      : { kind, readiness: "blocked", reason: "Verified knowledge is not ready", target: null };
  }
  const target = workflowForQuickAction(action);
  if (!target) return { kind, readiness: "blocked", reason: "No workflow or published action is connected", target: null };
  if (target.enabled === false) return { kind, readiness: "blocked", reason: "Connected workflow is disabled", target };
  if (target.workflowStatus !== "LIVE") return { kind, readiness: "blocked", reason: "Connected workflow must be published", target };
  if (target.readiness?.ready === false) return { kind, readiness: "blocked", reason: target.readiness.reason ? `Connected workflow needs setup · ${target.readiness.reason}` : "Connected workflow needs setup", target };
  return { kind, readiness: "ready", reason: kind === "WORKFLOW" ? "Published workflow is ready" : "Published action is ready", target };
}

function quickActionNeedsApproval(action: QuickAction): boolean {
  return action.approved === false || (action.generated === true && action.approved !== true);
}

function recommendationLabel(workflow: AgentWorkflow): { label: string; question: string } {
  const text = `${workflow.name} ${workflow.description ?? ""} ${workflow.actionType ?? ""}`.toLowerCase();
  if (/book|appointment|booking|reserve|schedule/.test(text)) return { label: "Book an appointment", question: "I'd like to book an appointment." };
  if (/demo|trial|tour/.test(text)) return { label: "See the demo", question: "I'd like to see a demo." };
  if (/quote|estimate/.test(text)) return { label: "Request a quote", question: "I'd like to request a quote." };
  if (/service|feature|plan/.test(text)) return { label: "Explore services", question: "What services do you offer?" };
  return { label: workflow.name, question: `I'd like help with ${workflow.name.toLowerCase()}.` };
}

function buildQuickActionRecommendations(): QuickAction[] {
  const recommendations: QuickAction[] = [];
  const addWorkflowRecommendation = (workflow: AgentWorkflow | undefined): void => {
    if (!workflow || workflow.workflowStatus !== "LIVE" || workflow.enabled === false || workflow.readiness?.ready === false) return;
    const copy = recommendationLabel(workflow);
    const kind: QuickActionKind = workflow.steps?.length ? "WORKFLOW" : "ACTION";
    if (recommendations.some((action) => action.targetId === workflow.id || action.label === copy.label)) return;
    recommendations.push({ ...copy, kind, targetId: workflow.id, generated: true, approved: false });
  };

  addWorkflowRecommendation(props.workflows.find((workflow) => workflow.isPrimary));

  if (props.knowledgeReady && recommendations.length < 4) {
    const question = props.suggestedQuestions.find((candidate) => /pricing|price|cost|service|feature|location|hours/i.test(candidate))
      ?? props.suggestedQuestions[0]
      ?? "What services do you offer?";
    const label = /pricing|price|cost/i.test(question) ? "Pricing" : /location|hours/i.test(question) ? "Locations" : "Explore services";
    recommendations.push({ label, question, kind: "KNOWLEDGE", generated: true, approved: false });
  }

  addWorkflowRecommendation(props.workflows.find((workflow) => !workflow.isPrimary && (workflow.steps?.length ?? 0) > 0));

  if (props.knowledgeReady && recommendations.length < 4) {
    recommendations.push({ label: "Ask a question", question: "What would you like help with?", kind: "KNOWLEDGE", generated: true, approved: false });
  }
  return recommendations.slice(0, 4);
}

function quickActionConnection(action: QuickAction): { label: string; detail: string; workflow: AgentWorkflow | null; kind: QuickActionKind; readiness: QuickActionReadiness; reason: string } {
  const state = quickActionReadiness(action);
  if (state.kind === "HANDOFF") return { label: "HANDOFF", detail: "Request human support", workflow: null, ...state };
  if (state.kind === "KNOWLEDGE") return { label: "KNOWLEDGE", detail: "Answer from Business Brain", workflow: null, ...state };
  if (state.target) return { label: state.kind, detail: state.target.name, workflow: state.target, ...state };
  return { label: state.kind, detail: state.reason, workflow: null, ...state };
}

function applyQuickActionRecommendations(): void {
  draft.value.widgetQuickActions = recommendedQuickActions.value.map((action) => ({ ...action, approved: true }));
  recommendationsApplied.value = true;
  openQuickActionMenuIndex.value = null;
}

function quickActionWorkflowId(action: QuickAction): string | undefined {
  return quickActionReadiness(action).target?.id;
}

function quickActionStatusLabel(action: QuickAction): string {
  const state = quickActionReadiness(action);
  if (state.readiness === "blocked") return state.reason;
  if (quickActionNeedsApproval(action)) return "Needs owner approval";
  return "Ready to publish";
}

function handleGoLive(): void {
  if (!testCompleted.value) return;
  if (quickActionPublishIssues.value.length) {
    selectTab("quick-actions");
    return;
  }
  if (isLive.value) {
    emit("view-dashboard");
    return;
  }
  emit("publish", cloneModel(draft.value));
}

function startAddAction(): void {
  editingActionIndex.value = null;
  openQuickActionMenuIndex.value = null;
  actionDraft.label = "";
  actionDraft.question = "";
  quickActionEditorOpen.value = true;
}

function editAction(index: number): void {
  editingActionIndex.value = index;
  openQuickActionMenuIndex.value = null;
  actionDraft.label = draft.value.widgetQuickActions[index]?.label ?? "";
  actionDraft.question = draft.value.widgetQuickActions[index]?.question ?? "";
  quickActionEditorOpen.value = true;
}

function saveAction(): void {
  const existing = editingActionIndex.value === null ? undefined : draft.value.widgetQuickActions[editingActionIndex.value];
  const action: QuickAction = {
    ...(existing ?? {}),
    label: actionDraft.label.trim(),
    question: actionDraft.question.trim(),
    approved: true,
    generated: false,
  };
  if (!action.label || !action.question) return;
  const connection = quickActionConnection(action);
  if (connection.workflow && connection.kind !== "KNOWLEDGE") {
    action.kind = connection.kind;
    action.targetId = connection.workflow.id;
  }
  if (editingActionIndex.value === null) draft.value.widgetQuickActions.push(action);
  else draft.value.widgetQuickActions.splice(editingActionIndex.value, 1, action);
  quickActionEditorOpen.value = false;
}

function duplicateAction(index: number): void {
  const action = draft.value.widgetQuickActions[index];
  if (!action || draft.value.widgetQuickActions.length >= 4) return;
  draft.value.widgetQuickActions.splice(index + 1, 0, { ...action, label: `${action.label} copy`, approved: true, generated: false });
  openQuickActionMenuIndex.value = null;
}

function removeAction(index: number): void {
  draft.value.widgetQuickActions.splice(index, 1);
  openQuickActionMenuIndex.value = null;
}

function moveAction(index: number, direction: -1 | 1): void {
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= draft.value.widgetQuickActions.length) return;
  const [action] = draft.value.widgetQuickActions.splice(index, 1);
  draft.value.widgetQuickActions.splice(nextIndex, 0, action);
}

function previewLogo(file: File): void {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const fallbackType = extension === "svg" ? "image/svg+xml" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "png" ? "image/png" : "";
  const contentType = allowedLogoTypes.has(file.type.toLowerCase()) ? file.type.toLowerCase() : fallbackType;
  if (!contentType) {
    logoError.value = "Choose a PNG, JPG, or SVG image.";
    return;
  }
  if (file.size > maxPersistedLogoBytes) {
    logoError.value = "Logo files must be 512 KB or smaller.";
    return;
  }
  logoFileName.value = file.name;
  logoError.value = "";
  logoProcessing.value = true;
  const reader = new FileReader();
  reader.onload = () => {
    const result = typeof reader.result === "string" ? reader.result : "";
    if (!result) {
      logoError.value = "The logo could not be read. Try another image.";
      logoProcessing.value = false;
      return;
    }
    const dataUrl = result.replace(/^data:[^;]+;/i, `data:${contentType};`);
    draft.value.widgetLogoUrl = dataUrl;
    logoPreview.value = dataUrl;
    logoProcessing.value = false;
    emit("logo-preview", dataUrl);
  };
  reader.onerror = () => {
    logoError.value = "The logo could not be read. Try another image.";
    logoProcessing.value = false;
  };
  reader.readAsDataURL(file);
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
        <Button v-if="!['capabilities', 'behavior', 'knowledge', 'test', 'install'].includes(tab)" variant="primary" size="small" @click="saveChanges">Save changes</Button>
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
          <p class="section-kicker">Your AI front desk</p>
          <h3>What your AI front desk can do</h3>
          <p>Capabilities are the outcomes your Agent can deliver. Workflows show how it guides a visitor there.</p>
        </div>
        <span class="capability-summary-count">{{ capabilities.filter((capability) => capability.ready).length }}/{{ capabilities.length }} ready</span>
      </section>
      <section class="agent-capability-list panel" aria-label="Agent capabilities">
        <article v-for="capability in capabilities" :key="capability.id" :class="['agent-capability-row', { ready: capability.ready }]">
          <span :class="['capability-status-icon', { ready: capability.ready }]">{{ capability.ready ? '✓' : '○' }}</span>
          <div class="agent-capability-copy"><strong>{{ capability.title }}</strong><p>{{ capability.description }}</p><div v-if="workflowsForCapability(capability).length" class="capability-relationship"><span>Used by</span><button v-for="workflow in workflowsForCapability(capability).slice(0, 2)" :key="workflow.id" type="button" @click="emit('open-workflow', workflow.id)">{{ workflow.name }}</button><small v-if="workflowsForCapability(capability).length > 2">+{{ workflowsForCapability(capability).length - 2 }} more</small></div><div v-else-if="capability.ready" class="capability-relationship capability-relationship-muted"><span>Available to workflows</span></div></div>
          <span :class="['capability-status-label', { ready: capability.ready }]">{{ capability.ready ? 'Ready' : 'Set up' }}</span>
          <button class="capability-action" type="button" @click="emit('open-capability-action', capability.target)">{{ capability.actionLabel }} →</button>
        </article>
      </section>
      <section class="agent-journeys panel" aria-labelledby="agent-journeys-heading">
        <div class="agent-journeys-heading"><div><p class="section-kicker">Workflows</p><h3 id="agent-journeys-heading">Active customer journeys</h3><p>Each workflow combines Agent defaults with a specific customer goal.</p></div><button class="outline-button small" type="button" @click="emit('open-workflow')">Manage workflows →</button></div>
        <div v-if="workflows.length" class="agent-journey-list"><button v-for="workflow in workflows.slice(0, 4)" :key="workflow.id" class="agent-journey-card" type="button" @click="emit('open-workflow', workflow.id)"><span class="journey-icon">↗</span><span><strong>{{ workflow.name }}</strong><small>{{ workflow.steps?.length ?? 0 }} step{{ (workflow.steps?.length ?? 0) === 1 ? '' : 's' }} · {{ workflowStatusLabel(workflow) }}</small></span><span class="journey-arrow">→</span></button></div>
        <div v-else class="agent-journeys-empty">Create a workflow to turn a capability into a guided customer journey.</div>
      </section>
      <aside class="agent-capabilities-note panel">
        <div><p class="section-kicker">Where connections live</p><h3>Settings is the connection center</h3><p>Agent keeps the outcome visible without duplicating HubSpot, Zapier, webhook, or MCP configuration.</p></div>
        <button class="outline-button small" type="button" @click="emit('open-capability-action', 'integrations')">Open integrations →</button>
      </aside>
    </div>

    <div v-else-if="tab === 'behavior'" class="agent-behavior-view">
      <div class="agent-behavior-action-bar" role="region" aria-label="Behavior changes">
        <div class="agent-behavior-save-state">
          <span :class="['agent-behavior-save-dot', { pending: hasDraftChanges || hasUnpublishedChanges }]" aria-hidden="true"></span>
          <div><strong>{{ behaviorSaveStatus }}</strong><small>{{ behaviorSaveStatusCopy }}</small></div>
        </div>
        <div class="agent-behavior-action-buttons">
          <Button variant="secondary" size="small" @click="saveChanges">Save changes</Button>
          <Button variant="primary" size="small" :disabled="behaviorPublishDisabled" @click="publishDraft">{{ behaviorPublishLabel }}</Button>
        </div>
      </div>
      <div class="agent-defaults-context"><span class="agent-defaults-context-mark">◎</span><div><strong>Global Agent defaults</strong><small>Tone, language, trust, fallback, and handoff behavior are inherited by every workflow.</small></div><button class="text-button" type="button" @click="emit('open-workflow')">See in Workflows →</button></div>

      <div class="behavior-view-switcher" role="tablist" aria-label="Behavior workspace view">
        <button type="button" role="tab" :aria-selected="behaviorPane === 'settings'" :class="{ active: behaviorPane === 'settings' }" @click="behaviorPane = 'settings'">Configure</button>
        <button type="button" role="tab" :aria-selected="behaviorPane === 'preview'" :class="{ active: behaviorPane === 'preview' }" @click="behaviorPane = 'preview'">Preview</button>
      </div>

      <div class="agent-behavior-layout agent-config-layout">
        <div ref="behaviorSettingsPanel" :class="['agent-behavior-settings', { 'behavior-pane-active': behaviorPane === 'settings' }]">
          <Card class="agent-form-panel agent-settings-panel">
        <FormSection id="behavior-identity" data-preview-scenario="conversation" data-preview-label="Assistant identity" eyebrow="Identity" title="Assistant identity">
          <FormField label="Assistant name" required><TextInput v-model="draft.assistantName" :maxlength="120" /></FormField>
        </FormSection>
        <FormSection id="behavior-conversation" data-preview-scenario="conversation" data-preview-label="Conversation" eyebrow="Conversation" title="How your assistant speaks">
          <FormField label="Welcome message" required><Textarea v-model="draft.welcomeMessage" :rows="4" :maxlength="1000" /></FormField>
          <div class="field-grid">
            <FormField label="Tone"><SegmentedControl v-model="draft.tone" :options="toneOptions" aria-label="Assistant tone" /></FormField>
            <FormField label="Primary language"><Select v-model="draft.primaryLanguage" :options="languageOptions" placeholder="" /></FormField>
          </div>
          <FormField v-if="draft.tone === 'custom'" label="Custom tone instructions" hint="These instructions guide answer style while keeping customer answers grounded and concise."><Textarea v-model="draft.customToneInstructions" :rows="4" :maxlength="600" placeholder="Warm, direct, and reassuring. Use short paragraphs and avoid jargon." /></FormField>
        </FormSection>
        <FormSection id="behavior-sources" data-preview-scenario="source-citation" data-preview-label="Answer sources" eyebrow="Trust & transparency" title="Answer sources" description="Choose when visitors can open the page used to ground an answer. Sources remain stored for quality review either way.">
          <FormField label="Show answer sources"><SegmentedControl v-model="draft.citationVisibility" :options="citationVisibilityOptions" aria-label="Answer source visibility" /></FormField>
          <p class="form-help">When helpful shows sources for pricing, policy, privacy, service, and other detail-heavy answers.</p>
        </FormSection>
        <FormSection id="behavior-proactive" data-preview-scenario="default" data-preview-label="Proactive engagement" eyebrow="Proactive engagement" title="Invite visitors before they ask" description="Start with a small prompt above the launcher. Visitors can open the full assistant when they are ready.">
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
        <FormSection id="behavior-fallback" data-preview-scenario="safe-fallback" data-preview-label="Fallback behavior" eyebrow="When AI cannot answer" title="Make the next step clear">
          <FormField label="Fallback behavior"><Select v-model="draft.fallbackBehavior" :options="fallbackOptions" placeholder="" /></FormField>
        </FormSection>
        <FormSection id="behavior-handoff" data-preview-scenario="human-handoff" data-preview-label="Human handoff" eyebrow="Human support" title="Keep your team in the loop" description="Give visitors a clear path to a person when the assistant cannot resolve the request.">
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
        </div>
        <aside :class="['agent-preview-column', 'agent-behavior-preview', { 'behavior-pane-active': behaviorPane === 'preview' }]">
          <div class="behavior-preview-context"><span class="behavior-preview-live-dot" aria-hidden="true"></span><div><span>Preview focus</span><strong>{{ behaviorPreviewLabel }}</strong></div><small>Updates as you move through the settings.</small></div>
          <WidgetPreview :assistant-name="agentDraft.assistantName" :welcome-message="agentDraft.welcomeMessage" :business-name="businessName" :website-url="websiteUrl" :widget-color="safeWidgetColor" :widget-theme="agentDraft.widgetTheme" :widget-position="agentDraft.widgetPosition" :widget-default-mode="agentDraft.widgetDefaultMode" :widget-allow-expand="agentDraft.widgetAllowExpand" :quick-actions="agentDraft.widgetQuickActions" :show-lead-capture="agentDraft.showLeadCapture" :require-lead-consent="agentDraft.requireLeadConsent" :privacy-notice-url="agentDraft.privacyNoticeUrl" :show-ai-disclosure="agentDraft.showAiDisclosure" :citation-visibility="agentDraft.citationVisibility" :tone="agentDraft.tone" :fallback-behavior="agentDraft.fallbackBehavior" :human-handoff-enabled="agentDraft.humanHandoffEnabled" :widget-logo-url="logoPreview || agentDraft.widgetLogoUrl" :proactive-enabled="agentDraft.proactiveEnabled" :proactive-message="agentDraft.proactiveMessage" :proactive-behavior="agentDraft.proactiveBehavior" :scenario="behaviorPreviewScenario" :mode="previewMode" @change-mode="previewMode = $event" /></aside>
      </div>
    </div>

    <div v-else-if="tab === 'knowledge'" class="agent-knowledge-layout">
      <article class="agent-knowledge-summary panel">
        <div class="agent-section-heading"><div><p class="section-kicker">Agent context</p><h3>How Agent uses Business Brain</h3><p>Configure how the Agent uses verified business knowledge here. Manage sources, facts, and crawling in the full Knowledge workspace.</p></div><span :class="['knowledge-readiness-pill', knowledgeReady ? 'ready' : 'needs-review']">{{ knowledgeReady ? 'Ready' : 'Review' }}</span></div>
        <div class="agent-knowledge-metrics"><div><strong>{{ knowledge?.sourceCount ?? 0 }}</strong><small>sources available</small></div><div><strong>{{ knowledge?.chunkCount ?? 0 }}</strong><small>indexed facts</small></div><div><strong>{{ knowledge?.openGaps ?? 0 }}</strong><small>open answer gaps</small></div><div><strong>{{ knowledgeLastUpdated }}</strong><small>last indexed</small></div></div>
        <div class="agent-knowledge-behavior" aria-label="Knowledge behavior">
          <div><span class="knowledge-check">✓</span><span><strong>Answer only from verified sources</strong><small>Business Brain remains the source of truth for customer answers.</small></span></div>
          <div><span class="knowledge-check">✓</span><span><strong>Use supported retrieval</strong><small>Retrieve grounded context before answering detail-heavy questions.</small></span></div>
          <div><span :class="['knowledge-check', { muted: draft.citationVisibility === 'hidden' }]">{{ draft.citationVisibility === 'hidden' ? '—' : '✓' }}</span><span><strong>Show sources when helpful</strong><small>{{ draft.citationVisibility === 'hidden' ? 'Source links are hidden from visitors.' : 'Source links follow Agent Behavior settings.' }}</small></span></div>
        </div>
        <p class="agent-knowledge-status">{{ knowledgeStatusLabel }}</p>
        <div v-if="openKnowledgeGaps.length" class="agent-knowledge-gaps"><strong>Open answer gaps</strong><button v-for="gap in openKnowledgeGaps.slice(0, 3)" :key="gap.question" type="button" @click="emit('open-knowledge')">{{ gap.question }} <span>{{ gap.occurrenceCount }}×</span></button><small v-if="openKnowledgeGaps.length > 3">{{ openKnowledgeGaps.length - 3 }} more gaps in Knowledge</small></div>
        <div class="agent-knowledge-actions"><Button variant="primary" size="small" @click="emit('open-knowledge')">Manage business knowledge →</Button><Button v-if="openKnowledgeGaps.length" variant="secondary" size="small" @click="emit('open-knowledge')">Review gaps</Button></div>
      </article>
    </div>

    <div v-else-if="tab === 'appearance'" class="agent-config-layout">
      <Card class="agent-form-panel agent-settings-panel">
        <FormSection eyebrow="Brand" title="Appearance" description="Make the front desk feel like part of your website.">
          <FileUpload :filename="logoFileName || (draft.widgetLogoUrl ? 'Current logo' : '')" :preview-url="logoPreview" accept="image/png,image/jpeg,image/svg+xml" @change="previewLogo" />
          <p v-if="logoProcessing" class="form-help">Preparing logo… save after the preview finishes.</p>
          <p v-if="logoError" class="logo-error" role="alert">{{ logoError }}</p>
          <details class="advanced-setting"><summary>Advanced · logo URL</summary><FormField label="Logo URL" hint="Uploaded logos are saved with this configuration. Use an HTTPS URL when the logo is hosted on your website."><TextInput v-model="draft.widgetLogoUrl" type="url" placeholder="https://yourbusiness.com/logo.png" /></FormField></details>
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
        <section class="agent-section quick-actions-section">
          <div class="agent-section-heading action-heading"><div><p class="section-kicker">Capability-aware shortcuts</p><h3>Quick actions</h3><p>FrontDeskWise recommends 3–4 safe entry points from verified knowledge, published workflows, actions, and handoff.</p></div><Button variant="primary" size="small" :disabled="agentDraft.widgetQuickActions.length >= 4" @click="startAddAction"><Plus :size="14" :stroke-width="2" aria-hidden="true" /> Add approved action</Button></div>
          <div v-if="recommendedQuickActions.length" class="quick-action-recommendations"><div class="quick-action-recommendations-heading"><div><p class="section-kicker">FrontDeskWise recommends</p><strong>Use only what the system can safely fulfill</strong><small>Recommendations are not published until you approve them.</small></div><Button variant="secondary" size="small" @click="applyQuickActionRecommendations">{{ recommendationsApplied ? 'Recommendations applied' : 'Use recommendations' }}</Button></div><div class="quick-action-recommendation-list"><div v-for="recommendation in recommendedQuickActions" :key="`${recommendation.kind}-${recommendation.targetId ?? recommendation.label}`"><span class="recommendation-check">✓</span><strong>{{ recommendation.label }}</strong><span class="quick-action-kind-pill">{{ recommendation.kind }}</span><small>{{ quickActionReadiness(recommendation).reason }}</small></div></div></div>
          <div v-if="quickActionPublishIssues.length" class="quick-action-validation" role="alert"><strong>{{ quickActionPublishIssues.length }} quick action{{ quickActionPublishIssues.length === 1 ? '' : 's' }} need{{ quickActionPublishIssues.length === 1 ? 's' : '' }} review before publish.</strong><small>Approve recommendations or connect/publish the capability they promise.</small></div>
          <div v-if="!agentDraft.widgetQuickActions.length" class="empty-actions"><strong>No approved shortcuts yet.</strong><p>Use the safe recommendations above, then edit them to match your visitor language.</p><Button variant="secondary" size="small" :disabled="!recommendedQuickActions.length" @click="applyQuickActionRecommendations">Use recommendations</Button></div>
          <div v-else class="quick-action-card-list"><article v-for="(action, index) in agentDraft.widgetQuickActions" :key="`${action.label}-${index}`" class="quick-action-card"><button class="drag-handle" type="button" aria-label="Move action up" @click="moveAction(index, -1)"><GripVertical :size="16" :stroke-width="1.8" aria-hidden="true" /></button><div class="quick-action-card-copy"><div class="quick-action-card-title"><strong>{{ action.label }}</strong><span :class="['quick-action-approval', quickActionNeedsApproval(action) ? 'needs-approval' : 'approved']">{{ quickActionNeedsApproval(action) ? 'Needs approval' : 'Approved' }}</span></div><span>“{{ action.question }}”</span><div class="quick-action-meta"><span class="quick-action-kind-pill">{{ quickActionConnection(action).kind }}</span><strong>{{ quickActionConnection(action).detail }}</strong><span :class="['quick-action-readiness', quickActionConnection(action).readiness]">{{ quickActionStatusLabel(action) }}</span></div><button v-if="quickActionWorkflowId(action)" class="quick-action-workflow-link" type="button" @click.stop="emit('open-workflow', quickActionWorkflowId(action))">View workflow →</button></div><div class="quick-action-menu-wrap"><button class="quick-action-menu-button" type="button" aria-label="More quick action options" :aria-expanded="openQuickActionMenuIndex === index" @click="openQuickActionMenuIndex = openQuickActionMenuIndex === index ? null : index"><MoreHorizontal :size="17" :stroke-width="1.9" aria-hidden="true" /></button><div v-if="openQuickActionMenuIndex === index" class="quick-action-menu" role="menu"><button type="button" role="menuitem" @click="editAction(index)">Edit</button><button type="button" role="menuitem" :disabled="agentDraft.widgetQuickActions.length >= 4" @click="duplicateAction(index)">Duplicate</button><button type="button" role="menuitem" class="danger-menu-item" @click="removeAction(index)">Delete</button></div></div></article></div>
        </section>
        <section v-if="quickActionEditorOpen" class="action-drawer"><div class="agent-section-heading"><div><p class="section-kicker">{{ editingActionIndex === null ? 'New shortcut' : 'Edit shortcut' }}</p><h3>Quick action details</h3></div><button class="icon-button" type="button" aria-label="Close" @click="quickActionEditorOpen = false"><X :size="18" :stroke-width="1.8" aria-hidden="true" /></button></div><FormField label="Label" required><TextInput v-model="actionLabel" :maxlength="48" placeholder="Explore services" /></FormField><FormField label="Customer message" required><TextInput v-model="actionQuestion" :maxlength="300" placeholder="What services do you offer?" /></FormField><div class="quick-action-editor-note"><span>Connection</span><strong>{{ editingActionConnection.label }}</strong><small>{{ editingActionConnection.detail }}</small></div><div class="drawer-actions"><Button variant="secondary" size="small" @click="quickActionEditorOpen = false">Cancel</Button><Button variant="primary" size="small" :disabled="!actionLabel.trim() || !actionQuestion.trim()" @click="saveAction">Save action</Button></div></section>
        <section class="agent-section agent-section-footer"><div><strong>{{ agentDraft.widgetQuickActions.length }} of 4 approved actions</strong><p>Every shortcut must be backed by verified knowledge, a published workflow/action, or enabled handoff.</p></div><Button variant="primary" size="small" @click="saveChanges">Save changes</Button></section>
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
.agent-behavior-view { min-width: 0; }
.agent-behavior-action-bar { position: sticky; bottom: 14px; z-index: 12; display: flex; align-items: center; justify-content: space-between; gap: 18px; margin: 0 0 18px; padding: 11px 13px; border: 1px solid #cfe0f3; border-radius: 12px; background: rgba(248, 251, 255, .96); box-shadow: 0 12px 28px rgba(20,42,74,.12); backdrop-filter: blur(12px); }
.agent-behavior-save-state { display: flex; align-items: center; gap: 10px; min-width: 0; }
.agent-behavior-save-state > div { display: grid; gap: 2px; min-width: 0; }
.agent-behavior-save-state strong { overflow: hidden; color: var(--agent-ink); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.agent-behavior-save-state small { overflow: hidden; color: var(--agent-muted); font-size: 10px; line-height: 1.35; text-overflow: ellipsis; white-space: nowrap; }
.agent-behavior-save-dot { width: 8px; height: 8px; flex: 0 0 8px; border-radius: 50%; background: #19bb8a; box-shadow: 0 0 0 4px rgba(25,187,138,.12); }
.agent-behavior-save-dot.pending { background: #e3a327; box-shadow: 0 0 0 4px rgba(227,163,39,.14); }
.agent-behavior-action-buttons { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.agent-defaults-context { display: flex; align-items: center; gap: 10px; margin: 0 0 16px; padding: 11px 13px; border: 1px solid #dce7f4; border-radius: 11px; color: #536a87; background: #f8fbff; }
.agent-defaults-context-mark { display: grid; width: 23px; height: 23px; flex: 0 0 23px; place-items: center; border-radius: 50%; color: #315d93; background: #e9f2ff; font-size: 14px; font-weight: 800; }
.agent-defaults-context > div { display: grid; gap: 2px; min-width: 0; flex: 1; }
.agent-defaults-context strong { color: var(--agent-ink); font-size: 12px; }
.agent-defaults-context small { color: var(--agent-muted); font-size: 10px; line-height: 1.35; }
.agent-defaults-context .text-button { flex: 0 0 auto; padding: 0; font-size: 10px; }
.behavior-view-switcher { display: none; }
.agent-behavior-layout { grid-template-columns: minmax(360px, 400px) minmax(520px, 1fr); }
.agent-behavior-settings, .agent-behavior-preview { min-width: 0; }
.agent-behavior-preview { position: sticky; top: calc(var(--workspace-header-height, 72px) + 44px); align-self: start; }
.agent-behavior-preview :deep(.agent-preview-shell) { position: static; }
.behavior-preview-context { display: flex; align-items: center; gap: 9px; margin: 0 0 11px; padding: 10px 12px; border: 1px solid #dce7f4; border-radius: 10px; color: var(--agent-muted); background: #f8fbff; }
.behavior-preview-context > div { display: grid; gap: 2px; min-width: 0; }
.behavior-preview-context > div > span { color: #7b8ba0; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.behavior-preview-context strong { overflow: hidden; color: var(--agent-ink); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.behavior-preview-context small { margin-left: auto; color: #8795a8; font-size: 10px; white-space: nowrap; }
.behavior-preview-live-dot { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 50%; background: #2f80ed; box-shadow: 0 0 0 4px rgba(47,128,237,.12); }
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
.logo-error { margin: 8px 0 0; color: #b42318; font-size: 11px; line-height: 1.45; }
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
.quick-action-card-list { display: grid; gap: 10px; margin-top: 19px; }
.quick-action-card { position: relative; display: flex; align-items: flex-start; gap: 11px; padding: 14px 10px; border: 1px solid var(--agent-border); border-radius: 11px; background: #fff; transition: border-color .15s ease, box-shadow .15s ease; }
.quick-action-card:hover { border-color: #bfd1e7; box-shadow: 0 5px 15px rgba(31, 68, 117, .06); }
.drag-handle { width: 24px; padding: 4px; border: 0; color: #8a9ab1; background: transparent; font-size: 18px; }
.quick-action-card-copy { display: grid; gap: 4px; min-width: 0; flex: 1; }
.quick-action-card-title { display: flex; align-items: center; gap: 8px; min-width: 0; }
.quick-action-card-copy > strong { overflow: hidden; color: var(--agent-ink); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
.quick-action-card-copy > span { overflow: hidden; color: var(--agent-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.quick-action-meta { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; margin-top: 6px; color: #7f8da1; font-size: 10px; }
.quick-action-meta span { padding: 3px 6px; border-radius: 999px; color: #315d93; background: #eef5ff; font-weight: 750; }
.quick-action-meta strong { color: #556b87; font-size: 10px; font-weight: 650; }
.quick-action-approval { flex: 0 0 auto; padding: 3px 6px; border-radius: 999px; font-size: 9px; font-weight: 800; white-space: nowrap; }
.quick-action-approval.approved { color: #08785d; background: #e7f8f1; }
.quick-action-approval.needs-approval { color: #95630c; background: #fff5df; }
.quick-action-kind-pill { display: inline-flex; align-items: center; padding: 3px 6px; border-radius: 999px; color: #315d93; background: #eef5ff; font-size: 9px !important; font-weight: 800 !important; letter-spacing: .04em; }
.quick-action-readiness { color: #08785d; font-size: 10px; }
.quick-action-readiness.blocked { color: #b44343; }
.quick-action-workflow-link { justify-self: start; padding: 0; border: 0; color: #2168d8; background: transparent; font-size: 10px; font-weight: 750; }
.quick-action-menu-wrap { position: relative; flex: 0 0 auto; }
.quick-action-menu-button { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid transparent; border-radius: 7px; color: #71829a; background: transparent; }
.quick-action-menu-button:hover, .quick-action-menu-button[aria-expanded="true"] { border-color: #d5e0ee; color: #2168d8; background: #f6f9fd; }
.quick-action-menu { position: absolute; z-index: 5; top: calc(100% + 5px); right: 0; display: grid; min-width: 130px; padding: 5px; border: 1px solid #d9e3ef; border-radius: 9px; background: #fff; box-shadow: 0 12px 28px rgba(33, 56, 91, .15); }
.quick-action-menu button { padding: 8px 9px; border: 0; border-radius: 6px; color: #455b77; background: transparent; font-size: 11px; text-align: left; }
.quick-action-menu button:hover:not(:disabled) { color: #2458b2; background: #f3f7fd; }
.quick-action-menu button:disabled { color: #b8c2cf; cursor: not-allowed; }
.quick-action-menu .danger-menu-item { color: #b34135; }
.quick-action-editor-note { display: grid; gap: 4px; margin-top: 18px; padding: 11px 12px; border: 1px solid #dce7f4; border-radius: 9px; background: #f8fbff; }
.quick-action-editor-note span { color: #7b8ba0; font-size: 9px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.quick-action-editor-note strong { color: var(--agent-ink); font-size: 12px; }
.quick-action-editor-note small { color: var(--agent-muted); font-size: 10px; }
.quick-action-recommendations { margin-top: 18px; padding: 15px; border: 1px solid #cfe0f3; border-radius: 11px; background: linear-gradient(135deg, #f8fbff, #f2f7ff); }
.quick-action-recommendations-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.quick-action-recommendations-heading > div { display: grid; gap: 3px; min-width: 0; }
.quick-action-recommendations-heading .section-kicker { margin-bottom: 1px; }
.quick-action-recommendations-heading strong { color: var(--agent-ink); font-size: 12px; }
.quick-action-recommendations-heading small { color: var(--agent-muted); font-size: 10px; }
.quick-action-recommendation-list { display: grid; gap: 8px; margin-top: 13px; }
.quick-action-recommendation-list > div { display: flex; align-items: center; gap: 7px; min-width: 0; }
.quick-action-recommendation-list strong { color: var(--agent-ink); font-size: 11px; }
.quick-action-recommendation-list small { overflow: hidden; margin-left: auto; color: var(--agent-muted); font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
.recommendation-check { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; border-radius: 50%; color: #08785d; background: #e7f8f1; font-size: 10px; font-weight: 800; }
.quick-action-validation { display: grid; gap: 3px; margin-top: 12px; padding: 11px 12px; border: 1px solid #f0d5a6; border-radius: 9px; color: #7d5c20; background: #fffaf0; }
.quick-action-validation strong { color: #6e4e14; font-size: 11px; }
.quick-action-validation small { color: #8c6d36; font-size: 10px; }
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
.capability-relationship { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-top: 8px; color: #7d8da2; font-size: 10px; }
.capability-relationship span { color: #8a98aa; font-weight: 750; }
.capability-relationship button { padding: 0; border: 0; color: #315d93; background: transparent; font-size: 10px; font-weight: 750; text-align: left; }
.capability-relationship button:hover { color: #2168d8; text-decoration: underline; }
.capability-relationship button:not(:last-of-type)::after { margin-left: 6px; color: #b2bfce; content: "·"; text-decoration: none; }
.capability-relationship small { color: #8795a8; font-size: 10px; }
.capability-relationship-muted { color: #8896a8; }
.capability-status-label { padding: 5px 8px; border-radius: 999px; color: #95630c; background: #fff5df; font-size: 10px; font-weight: 800; white-space: nowrap; }
.capability-status-label.ready { color: #08785d; background: #e7f8f1; }
.capability-action { padding: 6px 0; border: 0; color: #2168d8; background: transparent; font-size: 11px; font-weight: 750; white-space: nowrap; }
.agent-capabilities-note { align-items: center; border-color: #cfe0f3; background: linear-gradient(135deg, #f8fbff, #f1f8ff); }
.agent-journeys { padding: 22px; }
.agent-journeys-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.agent-journeys-heading h3 { margin: 0; color: var(--agent-ink); font-size: 17px; letter-spacing: -.025em; }
.agent-journeys-heading p:not(.section-kicker) { margin: 7px 0 0; color: var(--agent-muted); font-size: 12px; line-height: 1.5; }
.agent-journey-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 9px; margin-top: 18px; }
.agent-journey-card { display: flex; align-items: center; gap: 9px; min-width: 0; padding: 11px; border: 1px solid var(--agent-border); border-radius: 10px; color: inherit; background: #fff; text-align: left; }
.agent-journey-card:hover { border-color: #bcd2ef; background: #f8fbff; }
.journey-icon { display: grid; width: 25px; height: 25px; flex: 0 0 25px; place-items: center; border-radius: 8px; color: #315d93; background: #edf4ff; font-size: 12px; }
.agent-journey-card > span:nth-child(2) { display: grid; gap: 3px; min-width: 0; flex: 1; }
.agent-journey-card strong { overflow: hidden; color: var(--agent-ink); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.agent-journey-card small { color: var(--agent-muted); font-size: 10px; }
.journey-arrow { color: #7890ad; font-size: 13px; }
.agent-journeys-empty { margin-top: 16px; padding: 13px; border: 1px dashed #cbd8e7; border-radius: 9px; color: var(--agent-muted); background: #fbfcfe; font-size: 11px; }
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
.agent-knowledge-behavior { display: grid; gap: 10px; margin-top: 20px; padding: 15px; border: 1px solid #dce7f4; border-radius: 10px; background: #f8fbff; }
.agent-knowledge-behavior > div { display: flex; align-items: flex-start; gap: 9px; }
.agent-knowledge-behavior > div > span:last-child { display: grid; gap: 3px; }
.knowledge-check { display: grid; width: 18px; height: 18px; flex: 0 0 18px; place-items: center; border-radius: 50%; color: #08785d; background: #e7f8f1; font-size: 10px; font-weight: 800; }
.knowledge-check.muted { color: #8a98a9; background: #eef1f5; }
.agent-knowledge-behavior strong { color: var(--agent-ink); font-size: 11px; }
.agent-knowledge-behavior small { color: var(--agent-muted); font-size: 10px; line-height: 1.35; }
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
@media (max-width: 1100px) {
  .agent-behavior-layout { display: block; }
  .behavior-view-switcher { display: flex; gap: 3px; margin: 0 0 14px; padding: 3px; border: 1px solid #d7e0eb; border-radius: 9px; background: #eef2f7; }
  .behavior-view-switcher button { flex: 1; min-height: 34px; padding: 7px 12px; border: 0; border-radius: 6px; color: var(--agent-muted); background: transparent; font-size: 11px; font-weight: 750; }
  .behavior-view-switcher button.active { color: var(--agent-ink); background: #fff; box-shadow: 0 1px 2px rgba(20,42,74,.12); }
  .agent-behavior-settings, .agent-behavior-preview { display: none; }
  .agent-behavior-settings.behavior-pane-active, .agent-behavior-preview.behavior-pane-active { display: block; }
  .agent-behavior-preview { position: static; }
  .agent-behavior-preview :deep(.agent-preview-shell) { position: static; }
}
@media (max-width: 900px) { .agent-config-layout, .agent-test-layout { grid-template-columns: 1fr; } .preview-sticky { position: static; } .agent-settings-panel, .agent-form-panel, .agent-preview-column { display: block; width: 100%; } .agent-preview-column { order: 0; } .install-step-grid { grid-template-columns: 1fr; } }
@media (max-width: 900px) { .agent-behavior-settings, .agent-behavior-preview { display: none; } .agent-behavior-settings.behavior-pane-active, .agent-behavior-preview.behavior-pane-active { display: block; } }
@media (max-width: 640px) { .install-support { display: block; } .install-support-actions { justify-content: flex-start; margin-top: 16px; } .install-support-drawer { padding: 24px 18px; } }
@media (max-width: 640px) { .agent-header-row, .install-status-card, .agent-section-footer, .agent-live-banner, .agent-capabilities-intro, .agent-capabilities-note { display: block; } .agent-header-row { display: flex; align-items: stretch; flex-direction: column; } .agent-header-actions, .agent-live-actions { margin-top: 16px; } .agent-header-actions { width: 100%; } .agent-header-actions > button { flex: 1 1 0; } .agent-behavior-action-bar { align-items: stretch; flex-direction: column; gap: 11px; } .agent-behavior-save-state small { white-space: normal; } .agent-behavior-action-buttons { width: 100%; } .agent-behavior-action-buttons .ds-button { flex: 1; } .agent-defaults-context { align-items: flex-start; flex-wrap: wrap; } .agent-defaults-context .text-button { margin-left: 33px; } .behavior-preview-context { align-items: flex-start; } .behavior-preview-context small { display: none; } .field-grid, .agent-knowledge-metrics { grid-template-columns: 1fr 1fr; } .agent-section { padding: 19px; } .quick-action-card { align-items: flex-start; } .quick-action-card-copy > span { white-space: normal; } .agent-journeys-heading { display: block; } .agent-journeys-heading .outline-button { margin-top: 14px; } .agent-journey-list { grid-template-columns: 1fr; } .test-conversation, .test-owner-panel { padding: 17px; } .install-status-list { margin-top: 15px; } .agent-capability-row { grid-template-columns: 28px minmax(0, 1fr) auto; } .agent-capability-row .capability-action { grid-column: 2 / -1; justify-self: start; padding-top: 0; } .agent-capabilities-note .outline-button { margin-top: 16px; } }
</style>
