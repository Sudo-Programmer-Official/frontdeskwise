<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  currentAuthSnapshot,
  currentFirebaseToken,
  firebaseAuthConfigured,
  observeFirebaseUser,
  sendFrontDeskWisePasswordReset,
  signInAndBootstrap,
  signInWithGoogleAndBootstrap,
  signOutFrontDeskWise,
  signUpAndBootstrap,
  type AuthSnapshot,
} from "./auth/firebase";
import LegalPage from "./LegalPage.vue";
import AgentExperience from "./AgentExperience.vue";
import AppFeedback, { type AppToast, type AppToastKind } from "./AppFeedback.vue";
import MarketingPage from "./MarketingPage.vue";
import LandingVideo from "./components/LandingVideo.vue";
import { getMarketingPageByPath } from "./marketing";
import {
  demoRoute,
  parseRoute,
  platformRoute,
  routePath,
  routeView,
  settingsRoute,
  workspaceRoute,
  type AgentRouteTab,
  type AppRoute,
  type PlatformRouteSection,
  type SettingsRouteTab,
  type WorkspaceView,
} from "./router";

type View = "home" | "marketing" | "privacy" | "terms" | WorkspaceView | "admin";
type SettingsTab = SettingsRouteTab;
type AgentTab = AgentRouteTab;
type VerificationMethod = "email" | "meta_tag" | "file" | "dns_txt" | "manual";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string;
  intent: string;
  source: string;
  notes: string;
  status: "New" | "Qualified" | "Booked";
  time: string;
}

interface Integration {
  id: string;
  provider: string;
  displayName: string;
  connectionStatus: "pending" | "active" | "error" | "disabled";
  lastTestedAt: string | null;
  lastError: string | null;
  sync: { total: number; synced: number; pending: number; failed: number };
}

interface McpToolPermission {
  name: string;
  title?: string;
  description?: string;
  readOnly: boolean;
  destructive: boolean;
  approvalRequired: boolean;
  allowed: boolean;
}

interface McpConnection {
  id: string;
  provider: "hubspot" | "zapier" | "make" | "custom";
  displayName: string;
  serverUrl: string;
  connectionStatus: "pending" | "active" | "error" | "disabled";
  protocolVersion: string;
  lastTestedAt: string | null;
  lastSuccessfulCallAt: string | null;
  lastError: string | null;
  tools: McpToolPermission[];
}

type ActionConnectorProvider = "generic_webhook" | "email" | "hubspot" | "jackrabbit" | "square" | "mindbody" | "calendly";

interface InboxMessage {
  role: "user" | "assistant" | "human" | "system";
  kind?: string;
  authorName?: string | null;
  content: string;
  createdAt: string;
}

interface InboxConversation {
  id: string;
  status: "AI_ACTIVE" | "HANDOFF_REQUESTED" | "WAITING_FOR_STAFF" | "HUMAN_ACTIVE" | "AI_ASSISTED" | "RESOLVED";
  assignedUserId: string | null;
  handoffReason: string | null;
  unreadCount: number;
  lastActivityAt: string;
  createdAt: string;
  lead: { name?: string | null; email?: string | null; phone?: string | null; intent?: string | null } | null;
  lastMessage: InboxMessage | null;
  messages?: InboxMessage[];
}

interface TeamMember {
  id: string;
  email: string;
  name: string;
  status: string;
  role: "owner" | "admin" | "staff" | "viewer";
  businessIds: string[];
  createdAt: string | null;
  updatedAt: string | null;
  lastActiveAt: string | null;
}

interface StaffNotification {
  id: string;
  type: string;
  conversationId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

type ActionFieldType = "text" | "email" | "phone" | "select" | "date" | "number";
type ActionEditorStage = "trigger" | "qualify" | "contact" | "complete" | "deliver";

interface ActionField {
  id: string;
  key: string;
  label: string;
  type: ActionFieldType;
  required: boolean;
  visibility?: "visible" | "hidden";
  question: string;
  options?: string[];
  condition?: { field: string; equals?: string; notEquals?: string };
}

interface ActionFlow {
  id: string;
  key: string;
  name: string;
  description: string;
  triggerPhrases: string[];
  triggerIntents: string[];
  captureMode: "auto" | "conversational" | "form" | "hybrid";
  fields: ActionField[];
  completion: {
    createLead: boolean;
    leadStatus: "new" | "qualified" | "booked";
    message: string;
    submitLabel?: string;
    linkUrl?: string;
    linkLabel?: string;
    notifyStaff: boolean;
    requiresStaff?: boolean;
    notifyChannels?: Array<"in_app" | "email">;
    notifyTargets?: Array<"owner" | "business_team" | "assigned_staff">;
    connector?: {
      provider: ActionConnectorProvider;
      integrationId?: string;
      recipients?: string[];
    };
  };
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ActionDelivery {
  id: string;
  actionId: string;
  actionName: string;
  provider: string;
  status: string;
  attempts: number;
  lastError: string | null;
  updatedAt: string;
}

interface ActionTemplate extends Omit<ActionFlow, "id" | "createdAt" | "updatedAt"> {}

interface KnowledgeGap {
  question: string;
  occurrenceCount: number;
  status: "open" | "resolved";
  approvedAnswer: string | null;
  lastSeenAt: string;
}

interface OrganizationDocument {
  id: string;
  organizationId: string;
  businessId: string | null;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  etag: string | null;
  status: string;
  metadata: { error?: string; parser?: string; chunkCount?: number; characterCount?: number };
  createdAt: string | null;
  updatedAt: string | null;
}

interface RetrievalDiagnostic {
  conversationId: string;
  question: string;
  answer: string;
  grounded: boolean;
  confidenceScore: number;
  confidenceBand: "high" | "medium" | "low";
  retrieval?: { mode?: string; candidateCount?: number; topScore?: number; route?: string; model?: string | null; reason?: string; latencyMs?: number };
  createdAt: string;
}

interface ReadinessEvaluationCase {
  category: string;
  question: string;
  expectation: "grounded" | "fallback";
  passed: boolean;
  grounded: boolean;
  confidenceScore: number;
  confidenceBand: "high" | "medium" | "low";
  citationCount: number;
  answer: string;
  latencyMs: number;
  retrievalMode: string;
}

interface ReadinessEvaluation {
  generatedAt: string;
  score: number;
  passed: number;
  total: number;
  groundedQuestions: number;
  groundedWithCitations: number;
  fallbackQuestions: number;
  fallbackPassed: number;
  openGaps: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  citationCoverage: number;
  needsReview: number;
  cases: ReadinessEvaluationCase[];
}

interface WidgetInstall {
  siteKey: string;
  snippet: string;
  verification: { lastLoadedAt: string | null; loadCount: number };
}

interface WidgetQuickAction {
  label: string;
  question: string;
}

interface AgentSaveModel {
  assistantName: string;
  welcomeMessage: string;
  tone: "friendly" | "professional" | "concise" | "custom";
  primaryLanguage: string;
  fallbackBehavior: "contact_form" | "human" | "unavailable";
  humanHandoffEnabled: boolean;
  widgetColor: string;
  widgetDefaultMode: "compact" | "expanded" | "fullscreen";
  widgetAllowExpand: boolean;
  widgetLogoUrl: string;
  widgetTheme: "light" | "dark" | "auto";
  widgetPosition: "bottom-right" | "bottom-left";
  widgetQuickActions: WidgetQuickAction[];
  showLeadCapture: boolean;
  showBookingAction: boolean;
  showAiDisclosure: boolean;
  requireLeadConsent: boolean;
  privacyNoticeUrl: string;
  retentionDays: number;
}

interface WorkspaceStats {
  conversations: number;
  leads: number;
  bookingClicks: number;
  unansweredQuestions: number;
  widgetLoads: number;
  trend: Array<{ label: string; conversations: number; leads: number }>;
  topQuestions: Array<{ question: string; count: number }>;
  actions: Array<{ question: string; count: number; status: string }>;
  handoffs?: number;
  humanActive?: number;
  setup: { completed: number; total: number; percent: number };
  conversionFunnels?: Array<{
    flowId: string;
    flowKey: string;
    name: string;
    started: number;
    formDisplayed: number;
    submitted: number;
    actionSucceeded: number;
    completed: number;
    completionRate: number;
    dropOffs: Array<{ fieldId: string; label: string; count: number }>;
  }>;
}

interface WorkspaceSource {
  id: string;
  title: string;
  url: string;
  contentType?: string;
  pageType: string;
  crawlStatus: string;
  lastCrawledAt: string;
}

interface WorkspacePayload {
  slug: string;
  status: string;
  business?: { id?: string; name?: string; location?: string; websiteUrl?: string };
  agent?: { assistantName?: string; welcomeMessage?: string; tone?: "friendly" | "professional" | "concise" | "custom"; primaryLanguage?: string; fallbackBehavior?: "contact_form" | "human" | "unavailable"; humanHandoffEnabled?: boolean; widgetColor?: string; collectLeads?: boolean; showBookingAction?: boolean; widgetDefaultMode?: "compact" | "expanded" | "fullscreen"; widgetAllowExpand?: boolean; widgetQuickActions?: WidgetQuickAction[]; widgetLogoUrl?: string | null; widgetTheme?: "light" | "dark" | "auto"; widgetPosition?: "bottom-right" | "bottom-left"; proactiveEnabled?: boolean; proactiveDelaySeconds?: number; proactiveMessage?: string; proactiveTriggers?: Array<"delay" | "scroll" | "exit" | "returning">; requireLeadConsent?: boolean; privacyNoticeUrl?: string | null; retentionDays?: number; showAiDisclosure?: boolean };
  suggestedQuestions?: string[];
  ownership?: { status: "pending" | "verified" | "rejected"; method: VerificationMethod | null; verifiedAt: string | null };
  knowledge?: { sourceCount: number; chunkCount: number; openGaps: number; pendingSources?: number; failedSources?: number; status?: string; sources?: WorkspaceSource[]; readiness?: { score: number; sources: number; chunks: number; openGaps: number; pendingSources?: number; failedSources?: number } };
  stats?: WorkspaceStats;
}

interface BillingPlan {
  key: string;
  displayName: string;
  description: string;
  amountCents: number | null;
  currency: string;
  maxBusinesses: number;
  entitlements: Record<string, unknown>;
  checkoutReady: boolean;
}

interface BillingSnapshot {
  organization: { id: string; name: string; slug: string; role: string };
  billing: {
    mode: "sandbox" | "live";
    status: string;
    planKey: string;
    interval: "month" | "year" | null;
    trialEndAt: string | null;
    currentPeriodEndAt: string | null;
    graceEndAt: string | null;
    providerCustomerId: string | null;
    amountCents: number | null;
    currency: string;
    access: { allowed: boolean; reason: string };
    plan: { key: string; displayName: string; description: string; amountCents: number | null; currency: string; maxBusinesses: number };
    override: { reason: string } | null;
  };
  plans: BillingPlan[];
  usageLast30Days: { conversations: number; leads: number; bookings: number; llmRequests: number; llmInputTokens: number; llmOutputTokens: number; llmEstimatedCostUsd: number };
  stripeConfigured: boolean;
}

interface AdminOrganization {
  id: string;
  name: string;
  ownerEmail: string | null;
  businessCount: number;
  planKey: string;
  planName: string;
  status: string;
  mode: string;
  mrrAmountCents: number | null;
  currency: string;
  trialEndAt: string | null;
  conversationCount: number;
  leadCount: number;
  lastActiveAt: string | null;
}

interface AdminOrganizationDetail {
  organization: {
    id: string;
    name: string;
    slug: string;
    billing: {
      mode: string;
      status: string;
      planKey: string;
      interval: string | null;
      trialEndAt: string | null;
      currentPeriodEndAt: string | null;
      graceEndAt: string | null;
      provider: string | null;
      providerCustomerId: string | null;
      providerSubscriptionId: string | null;
      amountCents: number | null;
      currency: string;
      access: { allowed: boolean; reason: string };
      plan: { key: string; displayName: string; description: string; amountCents: number | null; currency: string; maxBusinesses: number };
      override: { reason: string } | null;
    };
  };
  owners: Array<{ email: string; name: string; role: string }>;
  businesses: Array<{
    id: string;
    name: string;
    slug: string;
    websiteUrl: string;
    ownershipStatus: string;
    billingStatus: string;
    planKey: string;
    sourceCount: number;
    conversationCount: number;
    leadCount: number;
    updatedAt: string | null;
  }>;
}

interface AdminBusinessDetail {
  organization: AdminOrganizationDetail["organization"];
  business: {
    id: string;
    name: string;
    slug: string;
    websiteUrl: string;
    location: string;
    ownershipStatus: string;
    billingStatus: string;
    planKey: string;
    sourceCount: number;
    chunkCount: number;
    conversationCount: number;
    leadCount: number;
    updatedAt: string | null;
  };
  owners: Array<{ email: string; name: string; role: string }>;
}

interface AdminUser {
  id: string;
  email: string;
  name: string;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
  organizationSummary: string;
  organizationCount: number;
  isSuperAdmin: boolean;
}

interface AdminDemoRequest {
  id: string;
  requesterName: string | null;
  requesterEmail: string | null;
  businessName: string | null;
  websiteUrl: string;
  templateKey: string;
  source: string;
  status: string;
  organizationName: string | null;
  businessId: string | null;
  businessSlug: string | null;
  requestedAt: string | null;
  lastOpenedAt: string | null;
  lastClaimedAt: string | null;
  accessCount: number;
  session: { expiresAt: string | null; openCount: number; active: boolean; accessType: string } | null;
  lastValidationPassedAt: string | null;
  lastValidationFailedAt: string | null;
}

type InstallationSupportPlatform = "wordpress" | "wix" | "shopify" | "squarespace" | "custom" | "not_sure";
type InstallationSupportStatus = "new" | "in_progress" | "resolved";

interface InstallationSupportFormPayload {
  name: string;
  platform: InstallationSupportPlatform;
  helpRequest: string;
  preferredContactMethod: "email" | "phone";
  contactValue: string;
  message: string;
  screenshotUrl: string;
}

interface InstallationSupportRequest {
  id: string;
  businessId: string;
  businessName: string;
  websiteUrl: string;
  organizationName: string | null;
  requesterName: string;
  requesterEmail: string;
  platform: InstallationSupportPlatform;
  helpRequest: string;
  preferredContactMethod: "email" | "phone";
  contactValue: string;
  message: string | null;
  screenshotUrl: string | null;
  ownershipStatus: string;
  widgetDetected: boolean;
  widgetLastLoadedAt: string | null;
  widgetLoadCount: number;
  assignedUserId: string | null;
  assignedUserName: string | null;
  assignedUserEmail: string | null;
  status: InstallationSupportStatus;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InstallationSupportAssignee {
  id: string;
  name: string;
  email: string;
}

interface MessagingTemplate {
  templateKey: string;
  name: string;
  description: string;
  category: "transactional" | "operational" | "account";
  subject: string;
  previewText: string;
  heading: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  footer: string;
  variables: string[];
  status: "draft" | "active" | "disabled";
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessagingAutomation {
  id: string;
  automationKey: string;
  templateKey: string;
  templateName: string;
  eventType: string;
  delaySeconds: number;
  recipientScope: string;
  conditions: Record<string, unknown>;
  mandatory: boolean;
  enabled: boolean;
  updatedAt: string | null;
}

interface MessagingDelivery {
  id: string;
  templateKey: string;
  templateName: string;
  eventType: string;
  businessName: string | null;
  recipientEmail: string;
  status: string;
  attempts: number;
  scheduledAt: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  providerMessageId: string | null;
}

interface MessagingSummary {
  last24Hours: { queued: number; sent: number; deferred: number; failed: number };
  templates: { active: number; total: number };
  provider: { name: string; configured: boolean };
}

type AdminSection = PlatformRouteSection;

interface AdminHealthSnapshot {
  api: "healthy" | "degraded" | "down";
  database: string;
  objectStorageConfigured: boolean;
  emailConfigured: boolean;
  stripeConfigured: boolean;
  checkedAt: string;
}

const route = ref<AppRoute>(parseRoute());
const view = computed<View>({
  get: () => routeView(route.value) as View,
  set: (nextView) => navigateToView(nextView),
});
const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
function apiUrl(path: string): string {
  return `${apiOrigin}${path}`;
}

const feedbackToasts = ref<AppToast[]>([]);
const globalLoading = ref(false);
let nextToastId = 0;
let loadingDepth = 0;
let loadingStartedAt = 0;
let loadingHideTimer: ReturnType<typeof setTimeout> | null = null;

function dismissToast(id: number) {
  feedbackToasts.value = feedbackToasts.value.filter((toast) => toast.id !== id);
}

function notify(kind: AppToastKind, message: string, title = kind === "error" ? "Something went wrong" : "FrontDeskWise") {
  const toast: AppToast = { id: ++nextToastId, kind, title, message };
  feedbackToasts.value = [...feedbackToasts.value.slice(-3), toast];
  if (typeof window !== "undefined") {
    window.setTimeout(() => dismissToast(toast.id), kind === "error" ? 6_500 : 4_200);
  }
}

function notifySuccess(message: string, title = "Done") {
  notify("success", message, title);
}

function notifyError(error: unknown, fallback = "We couldn't complete that request.") {
  const message = error instanceof Error ? error.message : String(error ?? "");
  notify("error", message || fallback);
}

function startGlobalLoading() {
  if (loadingHideTimer) {
    clearTimeout(loadingHideTimer);
    loadingHideTimer = null;
  }
  loadingDepth += 1;
  if (loadingDepth === 1) {
    loadingStartedAt = Date.now();
    globalLoading.value = true;
  }
}

function stopGlobalLoading() {
  loadingDepth = Math.max(0, loadingDepth - 1);
  if (loadingDepth || !globalLoading.value) return;
  const remaining = Math.max(0, 220 - (Date.now() - loadingStartedAt));
  const hide = () => {
    loadingHideTimer = null;
    if (!loadingDepth) globalLoading.value = false;
  };
  if (remaining) loadingHideTimer = setTimeout(hide, remaining);
  else hide();
}

async function runWithGlobalLoading<T>(task: () => Promise<T>): Promise<T> {
  startGlobalLoading();
  try {
    return await task();
  } finally {
    stopGlobalLoading();
  }
}

async function trackedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  startGlobalLoading();
  try {
    const response = await globalThis.fetch(input, init);
    if (response.status === 401) {
      notify("error", "Your session may have expired. Please sign in again.", "Session expired");
    } else if (response.status >= 500) {
      notify("error", "The service couldn't complete that request. Please try again.");
    }
    return response;
  } catch (error) {
    notifyError(error, "We couldn't reach FrontDeskWise. Check your connection and try again.");
    throw error;
  } finally {
    stopGlobalLoading();
  }
}

const websiteUrl = ref("");
const demoRequesterName = ref("");
const demoRequesterEmail = ref("");
const isGenerating = ref(false);
const generationError = ref("");
type GenerationStage = "checking" | "learning" | "organizing";
const generationStage = ref<GenerationStage>("checking");
const generationDialogOpen = ref(false);
let generationProgressTimer: ReturnType<typeof setInterval> | null = null;
const demoSlug = ref("british-swim-school-tampa-bay");
const demoAccessToken = ref(typeof window !== "undefined" ? window.localStorage.getItem("frontdeskwiseDemoAccessToken") ?? "" : "");
const publicDemoMode = ref(false);
const firebaseToken = ref("");
const authSnapshot = ref<AuthSnapshot | null>(null);
const authModalOpen = ref(false);
const authMode = ref<"signin" | "signup" | "forgot">("signin");
const authEmail = ref("");
const authPassword = ref("");
const authOrganizationName = ref("");
const authError = ref("");
const authLoading = ref(false);
const businessName = ref("");
const businessLocation = ref("");
const assistantName = ref("AI Front Desk");
const welcomeMessage = ref("Hi! I can answer questions from this business's website and help you get started.");
const agentTone = ref<"friendly" | "professional" | "concise" | "custom">("friendly");
const primaryLanguage = ref("English");
const fallbackBehavior = ref<"contact_form" | "human" | "unavailable">("contact_form");
const humanHandoffEnabled = ref(true);
const widgetColor = ref("#0d6efd");
const showLeadCapture = ref(true);
const showBookingAction = ref(true);
const widgetDefaultMode = ref<"compact" | "expanded" | "fullscreen">("compact");
const widgetAllowExpand = ref(true);
const widgetLogoUrl = ref("");
const widgetTheme = ref<"light" | "dark" | "auto">("auto");
const widgetPosition = ref<"bottom-right" | "bottom-left">("bottom-right");
const widgetQuickActions = ref<WidgetQuickAction[]>([
  { label: "Explore services", question: "What services do you offer?" },
  { label: "Pricing", question: "What does pricing look like?" },
  { label: "Get started", question: "How do I get started?" },
  { label: "Ask a question", question: "" },
]);
const proactiveEnabled = ref(false);
const proactiveDelaySeconds = ref(20);
const proactiveMessage = ref("Looking for the right service? I can help.");
const proactiveTriggers = ref<Array<"delay" | "scroll" | "exit" | "returning">>(["delay", "scroll", "exit"]);
const requireLeadConsent = ref(false);
const privacyNoticeUrl = ref("");
const retentionDays = ref(90);
const showAiDisclosure = ref(true);
const savedMessage = ref("");
const conversationId = ref("");
const testQuestion = ref("");
const routedTestQuestion = ref("");
const testAnswer = ref("");
const answerSource = ref("");
const answerGrounded = ref(false);
const answerConfidence = ref(0);
const answerConfidenceBand = ref<"high" | "medium" | "low">("low");
const answerRetrievalMode = ref("");
const answerCitations = ref<Array<{ title?: string; url?: string; pageType?: string }>>([]);
const answerAction = ref<{
  id: string;
  key: string;
  status: "active" | "completed";
  captureMode: "conversational" | "form" | "hybrid";
  nextField?: string;
  linkUrl?: string;
  linkLabel?: string;
  form?: {
    submitLabel: string;
    fields: Array<ActionField & { value?: string }>;
  };
} | null>(null);
const answerFormValues = ref<Record<string, string>>({});
const suggestedQuestions = ref<string[]>([]);
const readinessEvaluation = ref<ReadinessEvaluation | null>(null);
const evaluationLoading = ref(false);
const evaluationError = ref("");
const widgetInstall = ref<WidgetInstall | null>(null);
const widgetInstallMessage = ref("");
const widgetVerificationMessage = ref("");
const widgetVerificationLoading = ref(false);
const widgetPreviewMode = ref<"desktop" | "mobile">("desktop");
const ownershipVerification = ref<WorkspacePayload["ownership"] | null>(null);
const verificationMethod = ref<VerificationMethod>("meta_tag");
const verificationToken = ref("");
const verificationInstructions = ref("");
const verificationMessage = ref("");
const verificationError = ref("");
const verificationLoading = ref(false);
const isAsking = ref(false);
const leadName = ref("");
const leadEmail = ref("");
const leadPhone = ref("");
const leadIntent = ref("");
const leadSavedMessage = ref("");
const knowledgeGaps = ref<KnowledgeGap[]>([]);
const retrievalDiagnostics = ref<RetrievalDiagnostic[]>([]);
const sourceLibraryOpen = ref(false);
const knowledgeError = ref("");
const knowledgeLoading = ref(false);
const answerDrafts = ref<Record<string, string>>({});
const organizationDocuments = ref<OrganizationDocument[]>([]);
const documentsLoading = ref(false);
const documentsError = ref("");
const documentsMessage = ref("");
const knowledgeTestContext = ref<"updated" | "answer" | null>(null);
const resolvedKnowledgeQuestion = ref("");
const integrations = ref<Integration[]>([]);
const mcpConnections = ref<McpConnection[]>([]);
const integrationProvider = ref<"webhook" | "hubspot">("webhook");
const integrationDisplayName = ref("CRM webhook");
const integrationWebhookUrl = ref("");
const integrationSigningSecret = ref("");
const integrationAccessToken = ref("");
const integrationLoading = ref(false);
const integrationError = ref("");
const integrationMessage = ref("");
const mcpProvider = ref<McpConnection["provider"]>("hubspot");
const mcpDisplayName = ref("");
const mcpServerUrl = ref("");
const mcpBearerToken = ref("");
const mcpLoading = ref(false);
const mcpError = ref("");
const mcpMessage = ref("");
const actionFlows = ref<ActionFlow[]>([]);
const actionTemplates = ref<ActionTemplate[]>([]);
const actionDeliveries = ref<ActionDelivery[]>([]);
const actionsLoading = ref(false);
const actionsError = ref("");
const actionsMessage = ref("");
const selectedActionId = ref("");
const actionDraft = ref<ActionFlow | null>(null);
const actionConnectorProvider = computed(() => actionDraft.value?.completion.connector?.provider ?? "none");
const activeActionIntegrations = computed(() => integrations.value.filter((integration) => integration.connectionStatus === "active"
  && ((actionConnectorProvider.value === "generic_webhook" && integration.provider === "webhook")
    || (actionConnectorProvider.value === "hubspot" && integration.provider === "hubspot"))));
const actionTriggerText = ref("");
const actionTriggerPhraseInput = ref("");
const actionEditorStage = ref<ActionEditorStage>("trigger");
const actionTemplateChooserOpen = ref(false);
const actionFieldDrawerIndex = ref<number | null>(null);
const actionAdvancedOpen = ref(false);
const draggedActionFieldIndex = ref<number | null>(null);
const billingSnapshot = ref<BillingSnapshot | null>(null);
const billingLoading = ref(false);
const billingError = ref("");
const billingMessage = ref("");
const settingsTab = ref<SettingsTab>("general");
const agentTab = ref<AgentTab>("behavior");
const profileMenuOpen = ref(false);
const sidebarAccountMenuOpen = ref(false);
const setupDismissed = ref(false);
const showAllBusinesses = ref(false);
const addBusinessOpen = ref(false);
const addBusinessUrl = ref("");
const addBusinessLoading = ref(false);
const addBusinessError = ref("");
const addBusinessMessage = ref("");
const isSuperAdmin = ref(false);
const adminOrganizations = ref<AdminOrganization[]>([]);
const adminUsers = ref<AdminUser[]>([]);
const adminDemoRequests = ref<AdminDemoRequest[]>([]);
const adminDemoSummary = ref({ total: 0, ready: 0, requested: 0, converted: 0 });
const adminBusinessSlug = ref("british-swim-school-tampa-bay");
const adminRecipientName = ref("");
const adminRecipientEmail = ref("");
const adminGeneratedLink = ref("");
const adminLoading = ref(false);
const adminError = ref("");
const adminEmailTestLoading = ref(false);
const adminEmailTestMessage = ref("");
const adminSection = ref<AdminSection>("overview");
const adminHealth = ref<AdminHealthSnapshot | null>(null);
const installationSupportRequests = ref<InstallationSupportRequest[]>([]);
const installationSupportAssignees = ref<InstallationSupportAssignee[]>([]);
const installationSupportSummary = ref({ new: 0, inProgress: 0, resolved: 0 });
const installationSupportLoading = ref(false);
const installationSupportError = ref("");
const installationSupportMessage = ref("");
const installationSupportOwnerLoading = ref(false);
const installationSupportOwnerError = ref("");
const installationSupportOwnerMessage = ref("");
const openSupportRequest = ref(0);
const adminOrganizationDetail = ref<AdminOrganizationDetail | null>(null);
const adminOrganizationDetailLoading = ref(false);
const adminBusinessDetail = ref<AdminBusinessDetail | null>(null);
const adminBusinessDetailLoading = ref(false);
const adminBillingMessage = ref("");
const adminOverridePlanKey = ref("starter");
const adminOverrideInterval = ref<"month" | "year">("month");
const adminOverrideAmountCents = ref("9900");
const adminOverrideMaxBusinesses = ref("1");
const adminOverrideReason = ref("");
const messagingTemplates = ref<MessagingTemplate[]>([]);
const messagingAutomations = ref<MessagingAutomation[]>([]);
const messagingDeliveries = ref<MessagingDelivery[]>([]);
const messagingSummary = ref<MessagingSummary | null>(null);
const messagingLoading = ref(false);
const messagingError = ref("");
const messagingMessage = ref("");
const selectedMessagingTemplateKey = ref("");
const messagingTemplateDraft = ref<MessagingTemplate | null>(null);
const messagingDeliveryFilter = ref("all");
const messagingTestRecipient = ref("");
const messagingTestLoading = ref(false);
const messagingTab = ref<"templates" | "automations" | "delivery" | "settings">("templates");
const workspaceStats = ref<WorkspaceStats | null>(null);
const workspaceKnowledge = ref<WorkspacePayload["knowledge"] | null>(null);
const workspaceReadiness = ref(0);
const workspaceLoading = ref(false);
const workspaceError = ref("");
let stopFirebaseObserver: (() => void) | null = null;
let landingHeroTimer: number | null = null;

const leads = ref<Lead[]>([]);
const leadsLoading = ref(false);
const leadsError = ref("");
const leadSearch = ref("");
const leadStatusFilter = ref<"all" | "new" | "qualified" | "booked">("all");
const selectedLead = ref<Lead | null>(null);
const leadDetailOpen = ref(false);
const leadDetailStatus = ref<"New" | "Qualified" | "Booked">("New");
const leadDetailNotes = ref("");
const leadDetailLoading = ref(false);
const leadExportMessage = ref("");
const sourceActionLoading = ref("");
const sourceActionMessage = ref("");
const inboxConversations = ref<InboxConversation[]>([]);
const inboxLoading = ref(false);
const inboxError = ref("");
const inboxStatusFilter = ref<"all" | InboxConversation["status"]>("all");
const inboxAssignmentFilter = ref<"all" | "mine">("all");
const selectedInboxConversation = ref<InboxConversation | null>(null);
const inboxReply = ref("");
const inboxNote = ref("");
const inboxSuggestion = ref("");
const inboxActionLoading = ref(false);
const inboxMessage = ref("");
const teamMembers = ref<TeamMember[]>([]);
const teamBusinesses = ref<Array<{ id: string; name: string; slug: string }>>([]);
const teamLoading = ref(false);
const teamError = ref("");
const teamMessage = ref("");
const teamInviteEmail = ref("");
const teamInviteName = ref("");
const teamInviteRole = ref<"staff" | "viewer" | "admin">("staff");
const staffNotifications = ref<StaffNotification[]>([]);
const notificationUnreadCount = ref(0);
const notificationMenuOpen = ref(false);
const notificationPreferences = ref({ newLead: true, humanHandoff: true, integrationFailure: true });
const notificationPreferencesLoading = ref(false);
const notificationPreferencesMessage = ref("");
const notificationPreferencesError = ref("");
const embeddingLoading = ref(false);
const embeddingMessage = ref("");

const navSections: Array<{ label?: string; items: Array<{ id: View; label: string; icon: string }> }> = [
  { items: [{ id: "overview", label: "Overview", icon: "⌂" }] },
  { label: "Customers", items: [
    { id: "inbox", label: "Inbox", icon: "✉" },
    { id: "leads", label: "Leads", icon: "♧" },
    { id: "analytics", label: "Analytics", icon: "◒" },
  ] },
  { label: "AI front desk", items: [
    { id: "knowledge", label: "Knowledge", icon: "▤" },
    { id: "actions", label: "Actions", icon: "ϟ" },
    { id: "agent", label: "Agent", icon: "✦" },
  ] },
  { label: "Business", items: [
    { id: "businesses", label: "Businesses", icon: "▦" },
    { id: "settings", label: "Settings", icon: "⚙" },
  ] },
];

const navItems = navSections.flatMap((section) => section.items);

const settingsTabs: Array<{ id: SettingsTab; label: string }> = [
  { id: "general", label: "General" },
  { id: "team", label: "Team" },
  { id: "integrations", label: "Integrations" },
  { id: "verification", label: "Verification" },
  { id: "notifications", label: "Notifications" },
  { id: "billing", label: "Billing" },
];

const agentTabs: Array<{ id: AgentTab; label: string }> = [
  { id: "behavior", label: "Behavior" },
  { id: "appearance", label: "Appearance" },
  { id: "actions", label: "Quick actions" },
  { id: "test", label: "Test" },
  { id: "install", label: "Install" },
];

const adminNavItems: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: "overview", label: "Command center", icon: "⌂" },
  { id: "organizations", label: "Organizations", icon: "▦" },
  { id: "users", label: "Users & access", icon: "♧" },
  { id: "demos", label: "Demo operations", icon: "✦" },
  { id: "messaging", label: "Messaging", icon: "✉" },
  { id: "installation-support", label: "Installation support", icon: "⌁" },
  { id: "operations", label: "System health", icon: "◒" },
];

const messagingTabs: Array<{ id: "templates" | "automations" | "delivery" | "settings"; label: string }> = [
  { id: "templates", label: "Templates" },
  { id: "automations", label: "Automations" },
  { id: "delivery", label: "Delivery" },
  { id: "settings", label: "Settings" },
];

const pageTitle = computed(() => {
  if (view.value === "home") return "Build your AI front desk";
  if (route.value.kind === "marketing") return getMarketingPageByPath(`/${route.value.page}`)?.title ?? "FrontDeskWise";
  if (view.value === "privacy") return "Privacy Policy";
  if (view.value === "terms") return "Terms of Service";
  if (view.value === "admin") return "Admin control plane";
  if (view.value === "conversations" || view.value === "agent") return "Agent";
  if (view.value === "team" || view.value === "connections" || view.value === "billing") return "Settings";
  return navItems.find((item) => item.id === view.value)?.label ?? "Overview";
});

const adminOnlyMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && !availableBusinesses.value.length));
const adminSurfaceMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && view.value === "admin"));
const routeIsNotFound = computed(() => route.value.kind === "not-found");
const adminSectionTitle = computed(() => adminSection.value === "organization-detail"
  ? adminOrganizationDetail.value?.organization.name ?? "Organization detail"
  : adminSection.value === "business-detail"
    ? adminBusinessDetail.value?.business.name ?? "Business detail"
  : adminNavItems.find((item) => item.id === adminSection.value)?.label ?? "Command center");
const adminLeadTotal = computed(() => adminOrganizations.value.reduce((total, organization) => total + organization.leadCount, 0));
const adminConversationTotal = computed(() => adminOrganizations.value.reduce((total, organization) => total + organization.conversationCount, 0));
const adminTrialCount = computed(() => adminOrganizations.value.filter((organization) => organization.status === "trial").length);
const adminPausedCount = computed(() => adminOrganizations.value.filter((organization) => organization.status === "paused" || organization.status === "cancelled").length);
const adminFailedDemoCount = computed(() => adminDemoRequests.value.filter((item) => item.status === "failed" || item.status === "expired").length);
const adminDisabledUserCount = computed(() => adminUsers.value.filter((user) => user.status !== "active").length);

const activeLeads = computed(() => leads.value.filter((lead) => lead.status !== "Booked").length);
const activeOrganization = computed(() => authSnapshot.value?.organizations.find((organization) => organization.id === authSnapshot.value?.activeOrganizationId) ?? authSnapshot.value?.organizations[0] ?? null);
const availableBusinesses = computed(() => activeOrganization.value?.businesses ?? []);
const businessInitial = computed(() => (businessName.value.trim().charAt(0) || "?").toUpperCase());
const conversationCount = computed(() => workspaceStats.value?.conversations ?? 0);
const inboxUnreadCount = computed(() => inboxConversations.value.reduce((total, conversation) => total + (conversation.unreadCount ?? 0), 0));
const readinessScore = computed(() => workspaceReadiness.value);
const knowledgeSourcesNeedAttention = computed(() => Boolean((workspaceKnowledge.value?.pendingSources ?? 0) + (workspaceKnowledge.value?.failedSources ?? 0)));
const knowledgeTestAction = computed(() => {
  if (knowledgeSourcesNeedAttention.value) return { label: "Fix sources first", disabled: true };
  if (knowledgeTestContext.value === "answer") return { label: "Test this answer", disabled: false };
  if (knowledgeTestContext.value === "updated" || workspaceKnowledge.value?.status === "indexing") return { label: "Test updated knowledge", disabled: false };
  return { label: "Test agent", disabled: false };
});
const chartMax = computed(() => Math.max(1, ...(workspaceStats.value?.trend ?? []).flatMap((point) => [point.conversations, point.leads])));
const trialDaysRemaining = computed(() => {
  const end = billingSnapshot.value?.billing.trialEndAt;
  if (!end || billingSnapshot.value?.billing.status !== "trial") return 0;
  return Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / (24 * 60 * 60 * 1_000)));
});
const billingReadOnly = computed(() => Boolean(billingSnapshot.value && !billingSnapshot.value.billing.access.allowed && billingSnapshot.value.billing.mode !== "sandbox"));
const settingsSurface = computed(() => ["settings", "team", "connections", "billing"].includes(view.value));
const currentSettingsTab = computed<SettingsTab>(() => {
  if (view.value === "team") return "team";
  if (view.value === "connections") return "integrations";
  if (view.value === "billing") return "billing";
  return settingsTab.value;
});
const setupPercent = computed(() => workspaceStats.value?.setup.percent ?? 0);
const setupComplete = computed(() => setupPercent.value >= 100);
const setupDismissalKey = computed(() => `frontdeskwise:setup-dismissed:${authSnapshot.value?.activeOrganizationId ?? "public"}:${demoSlug.value || "workspace"}`);
const showSetupCard = computed(() => !adminSurfaceMode.value && !setupDismissed.value && Boolean(workspaceStats.value || (authSnapshot.value && !availableBusinesses.value.length)));
const setupNextAction = computed(() => {
  if (!availableBusinesses.value.length) return "Add your first business";
  if ((workspaceStats.value?.setup.completed ?? 0) < 2) return "Review your knowledge";
  return "Test and publish your agent";
});
const workspaceAttention = computed(() => {
  if (!setupDismissed.value) return null;
  if (billingReadOnly.value) return { label: "Billing needs attention", action: "billing" as const };
  if (ownershipVerification.value && ownershipVerification.value.status !== "verified") return { label: "Verify website ownership", action: "verification" as const };
  if ((workspaceKnowledge.value?.failedSources ?? 0) > 0) return { label: "Review failed knowledge sources", action: "knowledge" as const };
  if ((workspaceKnowledge.value?.pendingSources ?? 0) > 0) return { label: "Knowledge is still processing", action: "knowledge" as const };
  return null;
});
const workspaceSelection = computed({
  get: () => showAllBusinesses.value ? "__all__" : demoSlug.value,
  set: (value: string) => {
    if (value === "__all__") {
      showAllBusinesses.value = true;
      view.value = "businesses";
      return;
    }
    showAllBusinesses.value = false;
    void selectBusiness(value);
  },
});

const agentModel = computed<AgentSaveModel>(() => ({
  assistantName: assistantName.value,
  welcomeMessage: welcomeMessage.value,
  tone: agentTone.value,
  primaryLanguage: primaryLanguage.value,
  fallbackBehavior: fallbackBehavior.value,
  humanHandoffEnabled: humanHandoffEnabled.value,
  widgetColor: widgetColor.value,
  widgetDefaultMode: widgetDefaultMode.value,
  widgetAllowExpand: widgetAllowExpand.value,
  widgetLogoUrl: widgetLogoUrl.value,
  widgetTheme: widgetTheme.value,
  widgetPosition: widgetPosition.value,
  widgetQuickActions: widgetQuickActions.value,
  showLeadCapture: showLeadCapture.value,
  showBookingAction: showBookingAction.value,
  showAiDisclosure: showAiDisclosure.value,
  requireLeadConsent: requireLeadConsent.value,
  privacyNoticeUrl: privacyNoticeUrl.value,
  retentionDays: retentionDays.value,
}));

const agentTestModel = computed(() => ({
  conversationId: conversationId.value,
  question: testQuestion.value,
  answer: testAnswer.value,
  grounded: answerGrounded.value,
  citations: answerCitations.value,
  action: answerAction.value ? {
    status: answerAction.value.status,
    form: answerAction.value.form ? {
      submitLabel: answerAction.value.form.submitLabel,
      fields: answerAction.value.form.fields,
    } : undefined,
  } : null,
  formValues: answerFormValues.value,
  suggestedQuestions: suggestedQuestions.value,
  isAsking: isAsking.value,
}));

function ownerHeaders(): Record<string, string> {
  const token = firebaseToken.value || demoAccessToken.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function workspaceSlugForRoute(): string {
  return demoSlug.value || activeOrganization.value?.businesses[0]?.slug || "workspace";
}

function routeForView(nextView: View): AppRoute {
  if (nextView === "home") return { kind: "landing" };
  if (nextView === "privacy" || nextView === "terms") return { kind: "legal", page: nextView };
  if (nextView === "admin") return platformRoute(
    adminSection.value,
    adminSection.value === "organization-detail"
      ? { organizationId: adminOrganizationDetail.value?.organization.id }
      : adminSection.value === "business-detail"
        ? { businessId: adminBusinessDetail.value?.business.id }
        : {},
  );
  if (nextView === "team") return settingsRoute("team");
  if (nextView === "connections") return settingsRoute("integrations");
  if (nextView === "billing") return settingsRoute("billing");
  if (nextView === "settings") return settingsRoute(settingsTab.value);
  const isAgentSurface = nextView === "agent";
  const nextAgentTab = nextView === "conversations" ? "test" : isAgentSurface ? agentTab.value : undefined;
  const canonicalView: WorkspaceView = nextView === "conversations" || isAgentSurface ? "agent" : nextView as WorkspaceView;
  if (route.value.kind === "demo") return demoRoute(workspaceSlugForRoute(), canonicalView, nextAgentTab ? { agentTab: nextAgentTab } : {});
  return workspaceRoute(workspaceSlugForRoute(), canonicalView, nextAgentTab ? { agentTab: nextAgentTab } : {});
}

function commitRoute(nextRoute: AppRoute, replace = false, apply = true) {
  const nextPath = routePath(nextRoute);
  if (typeof window !== "undefined") {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    if (currentPath !== nextPath) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
    }
  }
  route.value = nextRoute;
  if (apply) void runWithGlobalLoading(() => applyRouteState(nextRoute));
}

function navigateToView(nextView: View) {
  commitRoute(routeForView(nextView));
}

function navigateToAdminSection(section: AdminSection, ids: { organizationId?: string; businessId?: string } = {}) {
  adminSection.value = section;
  commitRoute(platformRoute(section, ids));
}

async function applyRouteState(nextRoute: AppRoute) {
  if (nextRoute.kind === "auth") {
    publicDemoMode.value = false;
    openAuth(nextRoute.mode, false);
    return;
  }
  if (nextRoute.kind === "auth-callback") {
    publicDemoMode.value = false;
    if (!authSnapshot.value) openAuth("signin", false);
    return;
  }
  if (nextRoute.kind === "legal" || nextRoute.kind === "landing" || nextRoute.kind === "marketing") {
    publicDemoMode.value = false;
    return;
  }
  if (nextRoute.kind === "demo-access") return;
  if (nextRoute.kind === "not-found") {
    publicDemoMode.value = false;
    return;
  }
  if (nextRoute.kind === "onboarding") {
    if (!authSnapshot.value) {
      openAuth("signin", false);
      return;
    }
    publicDemoMode.value = false;
    if (nextRoute.step === "business" && !availableBusinesses.value.length) openAddBusiness();
    if (availableBusinesses.value.length && nextRoute.step !== "business" && demoSlug.value !== availableBusinesses.value[0].slug) {
      demoSlug.value = availableBusinesses.value[0].slug;
      await loadBusinessWorkspace(demoSlug.value);
    }
    return;
  }
  if (nextRoute.kind === "platform") {
    publicDemoMode.value = false;
    adminSection.value = nextRoute.section;
    if (!authSnapshot.value) {
      openAuth("signin", false);
      return;
    }
    if (!isSuperAdmin.value) {
      commitRoute(routeForView("overview"), true);
      return;
    }
    if (nextRoute.section === "organization-detail" && nextRoute.organizationId) await loadAdminOrganizationDetail(nextRoute.organizationId, false);
    else if (nextRoute.section === "business-detail" && nextRoute.businessId) await loadAdminBusinessDetail(nextRoute.businessId, false);
    else {
      void loadAdminOrganizations();
      void loadAdminUsers();
      void loadAdminDemoRequests();
      void loadAdminInstallationSupport();
      void loadAdminMessaging();
      void loadAdminHealth();
    }
    return;
  }
  if (nextRoute.kind === "workspace-settings") {
    publicDemoMode.value = false;
    settingsTab.value = nextRoute.tab;
    return;
  }
  if (nextRoute.kind === "agent-shortcut") {
    agentTab.value = nextRoute.agentTab;
    if (!authSnapshot.value && !demoAccessToken.value) {
      openAuth("signin", false);
      return;
    }
    publicDemoMode.value = false;
    const nextSlug = workspaceSlugForRoute();
    demoSlug.value = nextSlug;
    if (!workspaceStats.value) await loadBusinessWorkspace(nextSlug);
    if (nextRoute.agentTab === "test" && nextRoute.testQuestion) void runRoutedTestQuestion(nextRoute.testQuestion);
    return;
  }
  if (nextRoute.kind === "demo" || nextRoute.kind === "workspace") {
    const isPublic = nextRoute.kind === "demo";
    const nextSlug = nextRoute.kind === "demo" ? nextRoute.demoId : nextRoute.businessSlug;
    if (nextRoute.agentTab) agentTab.value = nextRoute.agentTab;
    if (!isPublic && !authSnapshot.value && !demoAccessToken.value) {
      openAuth("signin", false);
      return;
    }
    const needsReload = demoSlug.value !== nextSlug || publicDemoMode.value !== isPublic || !workspaceStats.value;
    publicDemoMode.value = isPublic;
    showAllBusinesses.value = false;
    demoSlug.value = nextSlug;
    if (nextRoute.agentTab) agentTab.value = nextRoute.agentTab;
    if (needsReload) await loadBusinessWorkspace(nextSlug, isPublic);
    if (nextRoute.agentTab) void loadWidgetInstall();
    if (nextRoute.agentTab === "test" && nextRoute.testQuestion) void runRoutedTestQuestion(nextRoute.testQuestion);
    else if (nextRoute.agentTab !== "test") routedTestQuestion.value = "";
  }
}

function hydrateSetupDismissal() {
  if (typeof window === "undefined") return;
  setupDismissed.value = window.localStorage.getItem(setupDismissalKey.value) === "1";
}

function dismissSetup() {
  setupDismissed.value = true;
  if (typeof window !== "undefined") window.localStorage.setItem(setupDismissalKey.value, "1");
}

function continueSetup() {
  if (!availableBusinesses.value.length) {
    openAddBusiness();
    return;
  }
  view.value = (workspaceStats.value?.setup.completed ?? 0) < 2 ? "knowledge" : "agent";
}

function openWorkspaceAttention() {
  const action = workspaceAttention.value?.action;
  if (!action) return;
  if (action === "knowledge") view.value = "knowledge";
  else openSettingsTab(action);
}

function selectAgentTab(tab: AgentTab) {
  agentTab.value = tab;
  commitRoute(routeForView("agent"));
  if (tab === "install") void loadWidgetInstall();
}

function openAgentTest(question?: string) {
  const normalizedQuestion = question?.trim() || undefined;
  knowledgeTestContext.value = null;
  resolvedKnowledgeQuestion.value = "";
  routedTestQuestion.value = "";
  const options = { agentTab: "test" as const, ...(normalizedQuestion ? { testQuestion: normalizedQuestion } : {}) };
  const nextRoute = route.value.kind === "demo"
    ? demoRoute(workspaceSlugForRoute(), "agent", options)
    : workspaceRoute(workspaceSlugForRoute(), "agent", options);
  commitRoute(nextRoute);
}

function clearTestResponse() {
  testAnswer.value = "";
  answerSource.value = "";
  answerGrounded.value = false;
  answerConfidence.value = 0;
  answerConfidenceBand.value = "low";
  answerRetrievalMode.value = "";
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
}

function runRoutedTestQuestion(question: string) {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || routedTestQuestion.value === normalizedQuestion && testAnswer.value) return;
  routedTestQuestion.value = normalizedQuestion;
  testQuestion.value = normalizedQuestion;
  clearTestResponse();
  testQuestion.value = normalizedQuestion;
  void askQuestion();
}

function openHelpAndSupport() {
  sidebarAccountMenuOpen.value = false;
  profileMenuOpen.value = false;
  notificationMenuOpen.value = false;
  selectAgentTab("install");
  openSupportRequest.value += 1;
}

function openAuth(mode: "signin" | "signup" | "forgot" = "signin", syncRoute = true) {
  authMode.value = mode;
  authError.value = "";
  authPassword.value = "";
  authModalOpen.value = true;
  if (syncRoute && (route.value.kind !== "auth" || route.value.mode !== mode)) commitRoute({ kind: "auth", mode });
}

function openSettingsTab(tab: SettingsTab) {
  settingsTab.value = tab;
  profileMenuOpen.value = false;
  sidebarAccountMenuOpen.value = false;
  notificationMenuOpen.value = false;
  if (tab === "team") view.value = "team";
  else if (tab === "integrations") view.value = "connections";
  else if (tab === "billing") view.value = "billing";
  else view.value = "settings";
}

function navigateToWorkspaceView(nextView: View) {
  profileMenuOpen.value = false;
  sidebarAccountMenuOpen.value = false;
  notificationMenuOpen.value = false;
  if (nextView === "settings") openSettingsTab("general");
  else view.value = nextView;
}

function isExpiredDemoSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /demo (?:access )?session|demo access token/i.test(message) && /invalid|expired/i.test(message);
}

function friendlyAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (/Firebase web settings|Vercel environment|auth domain|SSL certificate/i.test(message)) {
    return "Sign-in is temporarily unavailable. Please try again later.";
  }
  return message || fallback;
}

function forgetDemoAccessToken() {
  demoAccessToken.value = "";
  if (typeof window !== "undefined") window.localStorage.removeItem("frontdeskwiseDemoAccessToken");
}

async function bootstrapAccountWithDemoRecovery(start: (demoToken?: string) => Promise<AuthSnapshot>): Promise<AuthSnapshot> {
  const demoToken = demoAccessToken.value.trim() || undefined;
  try {
    return await start(demoToken);
  } catch (error) {
    if (!demoToken || !isExpiredDemoSessionError(error)) throw error;
    forgetDemoAccessToken();
    const snapshot = await currentAuthSnapshot(authOrganizationName.value);
    if (!snapshot) throw error;
    firebaseToken.value = await currentFirebaseToken();
    return snapshot;
  }
}

async function submitAuth() {
  if (!authEmail.value.trim() || authPassword.value.length < 6 || authLoading.value) return;
  if (authMode.value === "forgot") {
    await resetPassword();
    return;
  }
  authLoading.value = true;
  authError.value = "";
  startGlobalLoading();
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    const mode = authMode.value;
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => mode === "signup"
      ? signUpAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value)
      : signInAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value));
    firebaseToken.value = await currentFirebaseToken();
    await settleAuthenticatedSession();
    authModalOpen.value = false;
    authPassword.value = "";
    notifySuccess(mode === "signup" ? "Your workspace is ready." : "You're signed in.", mode === "signup" ? "Account created" : "Welcome back");
  } catch (error) {
    const message = friendlyAuthError(error, "Could not finish sign-in.");
    authError.value = message;
    notify("error", message, "Sign-in failed");
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

async function submitGoogleAuth() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  startGlobalLoading();
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => signInWithGoogleAndBootstrap(demoToken, authOrganizationName.value));
    firebaseToken.value = await currentFirebaseToken();
    await settleAuthenticatedSession();
    authModalOpen.value = false;
    notifySuccess("You're signed in with Google.", "Welcome back");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const friendlyMessage = message.includes("auth/popup-closed-by-user")
      ? "Google sign-in was cancelled. Try again or use email and password."
      : friendlyAuthError(error, "Could not finish Google sign-in.");
    authError.value = friendlyMessage;
    notify("error", friendlyMessage, "Google sign-in failed");
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

async function signOut() {
  startGlobalLoading();
  try {
    await signOutFrontDeskWise();
    forgetDemoAccessToken();
    authSnapshot.value = null;
    firebaseToken.value = "";
    profileMenuOpen.value = false;
    sidebarAccountMenuOpen.value = false;
    notificationMenuOpen.value = false;
    openHome();
    notifySuccess("You have been signed out.", "Signed out");
  } catch (error) {
    notify("error", error instanceof Error ? error.message : "Could not sign you out. Please try again.", "Sign-out failed");
  } finally {
    stopGlobalLoading();
  }
}

async function resetPassword() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  startGlobalLoading();
  try {
    await sendFrontDeskWisePasswordReset(authEmail.value);
    authError.value = "Password reset instructions sent. Check your inbox.";
    notifySuccess("Check your inbox for password recovery instructions.", "Email sent");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not send password reset instructions.";
    authError.value = message;
    notify("error", message, "Password reset failed");
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

function requireAccountForPublish() {
  if (authSnapshot.value) return true;
  openAuth("signup");
  return false;
}

function clearWorkspaceState() {
  businessName.value = "";
  businessLocation.value = "";
  websiteUrl.value = "";
  assistantName.value = "AI Front Desk";
  welcomeMessage.value = "Hi! I can answer questions from this business's website and help you get started.";
  agentTone.value = "friendly";
  primaryLanguage.value = "English";
  fallbackBehavior.value = "contact_form";
  humanHandoffEnabled.value = true;
  widgetDefaultMode.value = "compact";
  widgetAllowExpand.value = true;
  widgetLogoUrl.value = "";
  widgetTheme.value = "auto";
  widgetPosition.value = "bottom-right";
  widgetQuickActions.value = [
    { label: "Explore services", question: "What services do you offer?" },
    { label: "Pricing", question: "What does pricing look like?" },
    { label: "Get started", question: "How do I get started?" },
    { label: "Ask a question", question: "" },
  ];
  proactiveEnabled.value = false;
  proactiveDelaySeconds.value = 20;
  proactiveMessage.value = "Looking for the right service? I can help.";
  proactiveTriggers.value = ["delay", "scroll", "exit"];
  requireLeadConsent.value = false;
  privacyNoticeUrl.value = "";
  retentionDays.value = 90;
  showAiDisclosure.value = true;
  workspaceStats.value = null;
  workspaceKnowledge.value = null;
  workspaceReadiness.value = 0;
  leads.value = [];
  inboxConversations.value = [];
  selectedInboxConversation.value = null;
  inboxReply.value = "";
  inboxNote.value = "";
  inboxSuggestion.value = "";
  inboxError.value = "";
  inboxAssignmentFilter.value = "all";
  teamMembers.value = [];
  teamBusinesses.value = [];
  teamError.value = "";
  teamMessage.value = "";
  staffNotifications.value = [];
  notificationUnreadCount.value = 0;
  notificationMenuOpen.value = false;
  selectedLead.value = null;
  leadDetailOpen.value = false;
  leadSearch.value = "";
  leadStatusFilter.value = "all";
  leadExportMessage.value = "";
  knowledgeGaps.value = [];
  retrievalDiagnostics.value = [];
  organizationDocuments.value = [];
  integrations.value = [];
  mcpConnections.value = [];
  actionFlows.value = [];
  actionTemplates.value = [];
  actionDeliveries.value = [];
  selectedActionId.value = "";
  actionDraft.value = null as unknown as ActionFlow;
  actionTriggerText.value = "";
  actionTriggerPhraseInput.value = "";
  actionEditorStage.value = "trigger";
  actionTemplateChooserOpen.value = false;
  actionFieldDrawerIndex.value = null;
  actionAdvancedOpen.value = false;
  draggedActionFieldIndex.value = null;
  actionsError.value = "";
  actionsMessage.value = "";
  widgetInstall.value = null;
  widgetVerificationMessage.value = "";
  ownershipVerification.value = null;
  verificationToken.value = "";
  verificationInstructions.value = "";
  verificationMessage.value = "";
  verificationError.value = "";
  conversationId.value = "";
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
  suggestedQuestions.value = [];
  sourceLibraryOpen.value = false;
  readinessEvaluation.value = null;
  evaluationError.value = "";
}

function applyWorkspacePayload(payload: WorkspacePayload) {
  businessName.value = payload.business?.name ?? "";
  businessLocation.value = payload.business?.location ?? "";
  websiteUrl.value = payload.business?.websiteUrl ?? "";
  assistantName.value = payload.agent?.assistantName ?? (businessName.value ? `${businessName.value} Assistant` : "AI Front Desk");
  welcomeMessage.value = payload.agent?.welcomeMessage ?? "Hi! I can answer questions from this business's website and help you get started.";
  agentTone.value = payload.agent?.tone ?? "friendly";
  primaryLanguage.value = payload.agent?.primaryLanguage ?? "English";
  fallbackBehavior.value = payload.agent?.fallbackBehavior ?? "contact_form";
  humanHandoffEnabled.value = payload.agent?.humanHandoffEnabled ?? true;
  widgetColor.value = payload.agent?.widgetColor ?? "#0d6efd";
  showLeadCapture.value = payload.agent?.collectLeads ?? true;
  showBookingAction.value = payload.agent?.showBookingAction ?? true;
  widgetDefaultMode.value = payload.agent?.widgetDefaultMode ?? "compact";
  widgetAllowExpand.value = payload.agent?.widgetAllowExpand ?? true;
  widgetLogoUrl.value = payload.agent?.widgetLogoUrl ?? "";
  widgetTheme.value = payload.agent?.widgetTheme ?? "auto";
  widgetPosition.value = payload.agent?.widgetPosition ?? "bottom-right";
  widgetQuickActions.value = payload.agent?.widgetQuickActions?.length
    ? payload.agent.widgetQuickActions.map((action) => ({ label: action.label, question: action.question }))
    : (payload.suggestedQuestions ?? []).slice(0, 4).map((question) => ({ label: question.slice(0, 48), question }));
  if (!widgetQuickActions.value.length) widgetQuickActions.value = [{ label: "Ask a question", question: "" }];
  proactiveEnabled.value = payload.agent?.proactiveEnabled ?? false;
  proactiveDelaySeconds.value = payload.agent?.proactiveDelaySeconds ?? 20;
  proactiveMessage.value = payload.agent?.proactiveMessage ?? "Looking for the right service? I can help.";
  proactiveTriggers.value = payload.agent?.proactiveTriggers?.length ? payload.agent.proactiveTriggers : ["delay", "scroll", "exit"];
  requireLeadConsent.value = payload.agent?.requireLeadConsent ?? false;
  privacyNoticeUrl.value = payload.agent?.privacyNoticeUrl ?? "";
  retentionDays.value = payload.agent?.retentionDays ?? 90;
  showAiDisclosure.value = payload.agent?.showAiDisclosure ?? true;
  suggestedQuestions.value = payload.suggestedQuestions ?? [];
  ownershipVerification.value = payload.ownership ?? null;
  workspaceStats.value = payload.stats ?? null;
  workspaceKnowledge.value = payload.knowledge ?? null;
  workspaceReadiness.value = payload.knowledge?.readiness?.score ?? 0;
  conversationId.value = "";
}

async function loadBusinessWorkspace(slug: string, publicOnly = false) {
  workspaceLoading.value = true;
  publicDemoMode.value = publicOnly;
  workspaceError.value = "";
  clearWorkspaceState();
  try {
    const endpoint = publicOnly ? `/api/v1/demo/${slug}/public` : `/api/v1/demo/${slug}`;
    const response = await trackedFetch(apiUrl(endpoint), { headers: ownerHeaders() });
    const payload = await response.json() as WorkspacePayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load this workspace.");
    applyWorkspacePayload(payload);
    if (!publicOnly) {
      await Promise.allSettled([loadLeads(), loadKnowledge(), loadWidgetInstall(), loadIntegrations(), loadMcpConnections(), loadDocuments(), loadOwnershipVerification(), loadNotifications()]);
    }
  } catch (error) {
    workspaceError.value = error instanceof Error ? error.message : "Could not load this workspace.";
  } finally {
    workspaceLoading.value = false;
  }
}

async function refreshWorkspaceSummary() {
  if (!demoSlug.value || (!firebaseToken.value && !demoAccessToken.value)) return;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}`), { headers: ownerHeaders() });
    const payload = await response.json() as WorkspacePayload;
    if (!response.ok) return;
    workspaceStats.value = payload.stats ?? null;
    workspaceKnowledge.value = payload.knowledge ?? null;
    workspaceReadiness.value = payload.knowledge?.readiness?.score ?? 0;
  } catch {
    // The mutation already succeeded; the next view load will reconcile the summary.
  }
}

async function refreshAuthenticatedSnapshot() {
  if (!firebaseToken.value) return;
  try {
    const snapshot = await currentAuthSnapshot();
    if (snapshot) authSnapshot.value = snapshot;
  } catch {
    // Summary refresh must not turn a successful question/lead mutation into an error.
  }
}

async function selectBusiness(slug: string) {
  if (!slug) return;
  const nextView = view.value;
  publicDemoMode.value = false;
  showAllBusinesses.value = false;
  demoSlug.value = slug;
  // Keep control-plane and onboarding deep links stable while the session
  // hydrates. Workspace selection should only rewrite a workspace route.
  if (!["workspace-settings", "platform", "onboarding"].includes(route.value.kind)) {
    const nextWorkspaceView: WorkspaceView = nextView === "conversations"
      ? "agent"
      : nextView === "admin" || nextView === "home" || nextView === "privacy" || nextView === "terms"
        ? "overview"
        : nextView as WorkspaceView;
    const options = nextWorkspaceView === "agent"
      ? {
        agentTab: agentTab.value,
        ...(agentTab.value === "test" && route.value.kind === "workspace" && route.value.testQuestion
          ? { testQuestion: route.value.testQuestion }
          : {}),
      }
      : {};
    commitRoute(workspaceRoute(slug, nextWorkspaceView, options), false, false);
  }
  await loadBusinessWorkspace(slug);
  if (route.value.kind === "workspace" && route.value.agentTab === "test" && route.value.testQuestion) {
    void runRoutedTestQuestion(route.value.testQuestion);
  }
}

async function syncAuthenticatedBusiness(snapshot: AuthSnapshot): Promise<boolean> {
  const organization = snapshot.organizations.find((item) => item.id === snapshot.activeOrganizationId) ?? snapshot.organizations[0];
  const requestedSlug = route.value.kind === "workspace" ? route.value.businessSlug : demoSlug.value;
  const preferred = organization?.businesses.find((business) => business.slug === requestedSlug)
    ?? snapshot.organizations.flatMap((item) => item.businesses).find((business) => business.slug === demoSlug.value)
    ?? organization?.businesses[0]
    ?? snapshot.organizations[0]?.businesses[0];
  if (preferred) {
    await selectBusiness(preferred.slug);
    return true;
  } else {
    showAllBusinesses.value = false;
    clearWorkspaceState();
    return false;
  }
}

async function settleAuthenticatedSession(): Promise<void> {
  if (!authSnapshot.value) return;
  isSuperAdmin.value = authSnapshot.value.user.isSuperAdmin;
  const hasBusiness = await syncAuthenticatedBusiness(authSnapshot.value);
  if (hasBusiness) await loadBilling();
  if (isSuperAdmin.value && (isPlatformRoute() || !hasBusiness)) await loadAdminOrganizations();
  if (isSuperAdmin.value && !hasBusiness) {
    navigateToAdminSection("overview");
    return;
  }
  if (!hasBusiness) {
    commitRoute({ kind: "onboarding", step: "business" }, true);
    return;
  }
  if (isPlatformRoute()) {
    if (isSuperAdmin.value) {
      navigateToAdminSection("overview");
    } else {
      openHome();
    }
  } else if (!publicDemoMode.value && view.value === "home") {
    view.value = "overview";
  }
}

function openAddBusiness() {
  if (!authSnapshot.value) {
    openAuth("signup");
    return;
  }
  addBusinessUrl.value = "";
  addBusinessError.value = "";
  addBusinessMessage.value = "";
  addBusinessOpen.value = true;
}

async function createBusiness() {
  if (!authSnapshot.value || !addBusinessUrl.value.trim() || addBusinessLoading.value) return;
  addBusinessLoading.value = true;
  addBusinessError.value = "";
  addBusinessMessage.value = "";
  try {
    const normalizedWebsiteUrl = normalizeWebsiteUrl(addBusinessUrl.value);
    const response = await trackedFetch(apiUrl("/api/v1/auth/businesses"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ websiteUrl: normalizedWebsiteUrl, organizationId: authSnapshot.value.activeOrganizationId }),
    });
    const payload = await response.json() as { error?: string; auth?: AuthSnapshot; business?: WorkspacePayload };
    if (!response.ok || !payload.auth) throw new Error(payload.error ?? "Could not add this business.");
    authSnapshot.value = payload.auth;
    addBusinessOpen.value = false;
    const createdSlug = payload.business?.slug ?? "";
    const nextBusiness = createdSlug
      ? payload.auth.organizations.flatMap((organization) => organization.businesses).find((business) => business.slug === createdSlug)
      : undefined;
    if (nextBusiness) await selectBusiness(nextBusiness.slug);
    notifySuccess(`${payload.business?.business?.name ?? "Your business"} was added and is ready to review.`, "Business added");
  } catch (error) {
    addBusinessError.value = error instanceof Error ? error.message : "Could not add this business.";
  } finally {
    addBusinessLoading.value = false;
  }
}

function scrollToPricing() {
  if (view.value !== "home") openHome();
  requestAnimationFrame(() => document.getElementById("pricing")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function scrollLandingTo(id: string) {
  if (view.value !== "home") openHome();
  requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

const heroDemoStep = ref(0);
const landingDemoSteps = [
  { label: "Visitor asks", title: "Do you have a Saturday appointment?", body: "A real question gets a clear, grounded answer from the business knowledge you approve." },
  { label: "AI qualifies", title: "Yes — which service do you need?", body: "FrontDeskWise asks the next useful question instead of ending the conversation." },
  { label: "Next step complete", title: "Lead and intent sent to the team", body: "Contact details, context, and the requested next step stay together." },
];

const landingIndustries = [
  { icon: "🏊", name: "Swim school", question: "What class is right for my 5-year-old?", steps: ["Answers from program details", "Asks for location", "Starts enrollment"] },
  { icon: "✂️", name: "Salon", question: "Can I book a haircut Saturday?", steps: ["Understands service", "Guides to booking", "Captures preference"] },
  { icon: "❄️", name: "HVAC", question: "My AC stopped working.", steps: ["Qualifies urgency", "Captures ZIP + contact", "Sends service lead"] },
  { icon: "🦷", name: "Dental", question: "Do you take new patients?", steps: ["Shares accepted services", "Finds a location", "Requests an appointment"] },
  { icon: "⚖️", name: "Law firm", question: "Can someone review my situation?", steps: ["Sets expectations", "Collects case context", "Routes a qualified inquiry"] },
  { icon: "🏠", name: "Home services", question: "How soon can someone come out?", steps: ["Checks service area", "Qualifies urgency", "Creates a dispatch-ready lead"] },
];

const landingFlowSteps = [
  { label: "Question", title: "A visitor asks", body: "The conversation starts with the question already on their mind." },
  { label: "Answer", title: "Your knowledge responds", body: "The agent gives a grounded answer with a clear source and next step." },
  { label: "Qualify", title: "Intent becomes useful", body: "A short follow-up captures the details your team actually needs." },
  { label: "Convert", title: "The next action happens", body: "Book, request a quote, enroll, or send the lead to your team." },
  { label: "Handoff", title: "A human can step in", body: "When judgment matters, the full context moves with the conversation." },
];

const landingSampleMetrics = [
  { value: "248", label: "conversations", trend: "+18% this week" },
  { value: "61", label: "leads captured", trend: "with intent attached" },
  { value: "24", label: "actions completed", trend: "bookings + requests" },
  { value: "91%", label: "answered from knowledge", trend: "illustrative rate" },
];

const landingFaqs = [
  { question: "Does FrontDeskWise use my website?", answer: "Yes. Start with a website URL, then review the services, pricing, policies, locations, and documents the agent can use before publishing." },
  { question: "What happens when the answer is not in my knowledge?", answer: "The agent should say when it cannot verify an answer, collect useful context, and offer a human handoff instead of guessing." },
  { question: "Can it capture leads and bookings?", answer: "Yes. Configure forms, booking actions, and follow-up steps so the next action stays connected to the conversation that created it." },
  { question: "Can I customize the widget?", answer: "You can set the assistant name, greeting, brand colors, logo, quick actions, lead fields, position, and responsive display mode." },
  { question: "Does it work for more than one business?", answer: "Yes. Multi-business workspaces keep each business's knowledge, agent, widget, and analytics organized under one owner login." },
];

const landingCapabilities = [
  { icon: "◎", tone: "blue", title: "Answers customers can trust", body: "Uses your website, documents, pricing, policies, and approved business knowledge — and knows when to hand off." },
  { icon: "↗", tone: "orange", title: "Turns conversations into customers", body: "Captures leads, starts bookings, registrations, quotes, and appointments while visitors are ready to act." },
  { icon: "◌", tone: "green", title: "Your team stays in control", body: "AI handles routine conversations. Staff can join whenever a customer needs a human." },
  { icon: "ϟ", tone: "purple", title: "Works with your existing systems", body: "Connect your CRM, booking tools, calendar, email, webhooks, or MCP-powered tools." },
];

const landingIntegrations = [
  { name: "HubSpot", kind: "CRM", icon: "◈", tone: "orange", outcome: "Qualified lead created" },
  { name: "Zapier", kind: "Automation", icon: "✱", tone: "orange", outcome: "Workflow triggered" },
  { name: "Make", kind: "Automation", icon: "M", tone: "purple", outcome: "Data delivered" },
  { name: "Booking tools", kind: "Appointments", icon: "▣", tone: "blue", outcome: "Request sent" },
  { name: "Email", kind: "Notifications", icon: "✉", tone: "blue", outcome: "Team notified" },
  { name: "API / MCP", kind: "Custom workflows", icon: "</>", tone: "blue", outcome: "Tool executed" },
];

const landingPlans = [
  { key: "starter", name: "Starter", price: "$99", description: "A grounded AI front desk for one business.", businesses: "1 business", featured: false, badge: "", bullets: ["AI answers from your website", "Lead capture", "Basic analytics", "Website widget", "Free setup help included"] },
  { key: "growth", name: "Growth", price: "$199", description: "More volume, routing, and operating visibility.", businesses: "1 business", featured: false, badge: "", bullets: ["Everything in Starter", "Higher conversation volume", "Advanced actions", "Integrations + team handoff", "Guided setup assistance"] },
  { key: "multi_business", name: "Multi-Business", price: "$349", description: "One organization for up to two businesses.", businesses: "Up to 2 businesses", featured: true, badge: "Built for multi-business owners", bullets: ["Everything in Growth", "Shared team workspace", "Cross-business analytics", "Shared integrations and actions"] },
  { key: "portfolio", name: "Portfolio", price: "$499", description: "A higher-capacity operating layer for your portfolio.", businesses: "Up to 5 businesses", featured: false, badge: "", bullets: ["Everything in Multi-Business", "Higher usage limits", "Priority support", "Advanced integrations"] },
];

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function stopGenerationProgress() {
  if (generationProgressTimer !== null) {
    window.clearInterval(generationProgressTimer);
    generationProgressTimer = null;
  }
}

function startGenerationProgress() {
  stopGenerationProgress();
  generationStage.value = "checking";
  generationProgressTimer = window.setInterval(() => {
    generationStage.value = generationStage.value === "checking"
      ? "learning"
      : generationStage.value === "learning"
        ? "organizing"
        : "organizing";
  }, 1_800);
}

function closeGenerationDialog() {
  if (isGenerating.value) return;
  generationDialogOpen.value = false;
  generationError.value = "";
}

async function generateDemo() {
  const normalizedWebsiteUrl = normalizeWebsiteUrl(websiteUrl.value);
  if (!normalizedWebsiteUrl) return;
  websiteUrl.value = normalizedWebsiteUrl;
  isGenerating.value = true;
  generationError.value = "";
  generationDialogOpen.value = true;
  startGenerationProgress();
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        websiteUrl: normalizedWebsiteUrl,
        requesterName: demoRequesterName.value || undefined,
        requesterEmail: demoRequesterEmail.value || undefined,
      }),
    });
    const payload = await response.json() as { error?: string; slug?: string; access?: { accessToken?: string }; business?: { name?: string; websiteUrl?: string }; agent?: { assistantName?: string; welcomeMessage?: string } };
    if (!response.ok) throw new Error(payload.error ?? "We could not crawl that website yet.");
    if (payload.access?.accessToken) {
      demoAccessToken.value = payload.access.accessToken;
      window.localStorage.setItem("frontdeskwiseDemoAccessToken", payload.access.accessToken);
    }
    generationStage.value = "organizing";
    demoSlug.value = payload.slug ?? demoSlug.value;
    const generatedSlug = demoSlug.value;
    await loadBusinessWorkspace(generatedSlug, true);
    if (workspaceError.value) throw new Error(workspaceError.value);
    commitRoute(demoRoute(generatedSlug), false, false);
    generationDialogOpen.value = false;
  } catch (error) {
    publicDemoMode.value = false;
    websiteUrl.value = normalizedWebsiteUrl;
    generationError.value = error instanceof Error ? error.message : "We could not create that demo yet.";
  } finally {
    isGenerating.value = false;
    stopGenerationProgress();
  }
}

async function consumeDemoLink() {
  if (typeof window === "undefined") return;
  const token = new URLSearchParams(window.location.search).get("demo");
  if (!token) return;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo-access/exchange"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: token }),
    });
    const payload = await response.json() as { error?: string; accessToken?: string; workspace?: WorkspacePayload };
    if (!response.ok || !payload.accessToken || !payload.workspace) throw new Error(payload.error ?? "This demo link is invalid or expired.");
    demoAccessToken.value = payload.accessToken;
    window.localStorage.setItem("frontdeskwiseDemoAccessToken", payload.accessToken);
    demoSlug.value = payload.workspace.slug ?? demoSlug.value;
    const exchangedSlug = demoSlug.value;
    commitRoute(demoRoute(exchangedSlug), true, false);
    await loadBusinessWorkspace(exchangedSlug, true);
  } catch (error) {
    if (token === demoAccessToken.value) forgetDemoAccessToken();
    generationError.value = error instanceof Error ? error.message : "This demo link is invalid or expired.";
  }
}

async function loadKnowledge() {
  if ((!firebaseToken.value && !demoAccessToken.value) || knowledgeLoading.value) return;
  if (authSnapshot.value && !selectedBusinessId()) {
    knowledgeGaps.value = [];
    retrievalDiagnostics.value = [];
    return;
  }
  knowledgeLoading.value = true;
  knowledgeError.value = "";
  try {
    const [gapsResponse, diagnosticsResponse] = await Promise.all([
      trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps`), { headers: ownerHeaders() }),
      trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/retrieval-diagnostics`), { headers: ownerHeaders() }),
    ]);
    if (!gapsResponse.ok || !diagnosticsResponse.ok) throw new Error("We could not load the knowledge review. Refresh the page and try again.");
    const gapsPayload = await gapsResponse.json() as { gaps?: KnowledgeGap[] };
    const diagnosticsPayload = await diagnosticsResponse.json() as { diagnostics?: RetrievalDiagnostic[] };
    knowledgeGaps.value = gapsPayload.gaps ?? [];
    retrievalDiagnostics.value = diagnosticsPayload.diagnostics ?? [];
    for (const gap of knowledgeGaps.value) {
      if (answerDrafts.value[gap.question] === undefined) answerDrafts.value[gap.question] = gap.approvedAnswer ?? "";
    }
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not load knowledge review.";
  } finally {
    knowledgeLoading.value = false;
  }
}

function selectedBusinessId(): string | null {
  return activeOrganization.value?.businesses.find((business) => business.slug === demoSlug.value)?.id ?? null;
}

function formatDocumentSize(sizeBytes: number): string {
  if (sizeBytes < 1024) return `${sizeBytes} B`;
  if (sizeBytes < 1024 * 1024) return `${Math.round(sizeBytes / 1024)} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

async function loadDocuments() {
  if (!authSnapshot.value || !activeOrganization.value || documentsLoading.value) return;
  const businessId = selectedBusinessId();
  if (!businessId) {
    organizationDocuments.value = [];
    return;
  }
  documentsLoading.value = true;
  documentsError.value = "";
  try {
    const params = new URLSearchParams({ organizationId: activeOrganization.value.id });
    params.set("businessId", businessId);
    const response = await trackedFetch(apiUrl(`/api/v1/storage/documents?${params.toString()}`), { headers: ownerHeaders() });
    const payload = await response.json() as { documents?: OrganizationDocument[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load organization documents.");
    organizationDocuments.value = payload.documents ?? [];
  } catch (error) {
    documentsError.value = error instanceof Error ? error.message : "Could not load organization documents.";
  } finally {
    documentsLoading.value = false;
  }
}

async function watchDocumentProcessing(documentId: string): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_500));
    await loadDocuments();
    const current = organizationDocuments.value.find((item) => item.id === documentId);
    if (current?.status === "ready") {
      documentsMessage.value = `${current.fileName} is searchable in the private knowledge base.`;
      knowledgeTestContext.value = "updated";
      await refreshWorkspaceSummary();
      await loadKnowledge();
      return;
    }
    if (current?.status === "failed") {
      documentsError.value = current.metadata.error ?? `${current.fileName} could not be processed.`;
      return;
    }
  }
  documentsMessage.value = "Upload complete. Processing is still running; refresh Knowledge in a moment.";
}

async function uploadDocument(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !authSnapshot.value || !activeOrganization.value || documentsLoading.value) return;
  documentsLoading.value = true;
  documentsError.value = "";
  documentsMessage.value = "";
  try {
    const businessId = selectedBusinessId();
    const presignResponse = await trackedFetch(apiUrl("/api/v1/storage/documents/presign"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        organizationId: activeOrganization.value.id,
        businessId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      }),
    });
    const presignPayload = await presignResponse.json() as { error?: string; document?: OrganizationDocument; upload?: { url: string; headers: Record<string, string> } };
    if (!presignResponse.ok || !presignPayload.document || !presignPayload.upload) throw new Error(presignPayload.error ?? "Could not prepare this upload.");
    const uploadResponse = await trackedFetch(presignPayload.upload.url, {
      method: "PUT",
      headers: presignPayload.upload.headers,
      body: file,
    });
    if (!uploadResponse.ok) throw new Error("The file could not be uploaded to secure storage.");
    const completeResponse = await trackedFetch(apiUrl(`/api/v1/storage/documents/${presignPayload.document.id}/complete`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const completePayload = await completeResponse.json() as { error?: string; document?: OrganizationDocument };
    if (!completeResponse.ok) throw new Error(completePayload.error ?? "The upload could not be finalized.");
    documentsMessage.value = `${file.name} uploaded securely.`;
    knowledgeTestContext.value = "updated";
    documentsLoading.value = false;
    await loadDocuments();
    if (completePayload.document?.id) void watchDocumentProcessing(completePayload.document.id);
  } catch (error) {
    documentsError.value = error instanceof Error ? error.message : "Could not upload this document.";
  } finally {
    documentsLoading.value = false;
  }
}

async function downloadDocument(documentItem: OrganizationDocument) {
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/storage/documents/${documentItem.id}/download`), { headers: ownerHeaders() });
    const payload = await response.json() as { url?: string; error?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error ?? "Could not prepare the download.");
    window.open(payload.url, "_blank", "noopener,noreferrer");
  } catch (error) {
    documentsError.value = error instanceof Error ? error.message : "Could not download this document.";
  }
}

async function deleteDocument(documentItem: OrganizationDocument) {
  if (!window.confirm(`Remove ${documentItem.fileName} from this business?`)) return;
  documentsLoading.value = true;
  documentsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/storage/documents/${documentItem.id}`), { method: "DELETE", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not remove this document.");
    documentsMessage.value = `${documentItem.fileName} removed.`;
    documentsLoading.value = false;
    await loadDocuments();
  } catch (error) {
    documentsError.value = error instanceof Error ? error.message : "Could not remove this document.";
  } finally {
    documentsLoading.value = false;
  }
}

async function resolveKnowledgeGap(gap: KnowledgeGap) {
  const approvedAnswer = answerDrafts.value[gap.question]?.trim();
  if (!approvedAnswer) return;
  const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps/resolve`), {
    method: "POST",
    headers: { "content-type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({ question: gap.question, approvedAnswer }),
  });
  if (!response.ok) {
    knowledgeError.value = "Could not approve that answer.";
    return;
  }
  gap.status = "resolved";
  gap.approvedAnswer = approvedAnswer;
  resolvedKnowledgeQuestion.value = gap.question;
  knowledgeTestContext.value = "answer";
  await refreshWorkspaceSummary();
}

async function loadWidgetInstall() {
  if (!firebaseToken.value || !authSnapshot.value) return;
  if (ownershipVerification.value?.status !== "verified") {
    widgetInstall.value = null;
    return;
  }
  const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/install`), { headers: ownerHeaders() });
  if (!response.ok) return;
  widgetInstall.value = await response.json() as WidgetInstall;
}

async function requestInstallationHelp(payload: InstallationSupportFormPayload) {
  if (!firebaseToken.value || !authSnapshot.value) {
    openAuth("signup");
    return;
  }
  installationSupportOwnerLoading.value = true;
  installationSupportOwnerError.value = "";
  installationSupportOwnerMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/installation-support`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { request?: InstallationSupportRequest; error?: string };
    if (!response.ok) throw new Error(result.error ?? "Could not send your installation help request.");
    installationSupportOwnerMessage.value = "Your request is with our team. We’ll be in touch soon.";
    notifySuccess("Installation help requested. Our team will be in touch soon.");
  } catch (error) {
    installationSupportOwnerError.value = error instanceof Error ? error.message : "Could not send your installation help request.";
  } finally {
    installationSupportOwnerLoading.value = false;
  }
}

function clearInstallationSupportOwnerState() {
  installationSupportOwnerMessage.value = "";
  installationSupportOwnerError.value = "";
}

async function loadOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value) return;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification`), { headers: ownerHeaders() });
    const payload = await response.json() as { verification?: WorkspacePayload["ownership"] };
    if (response.ok && payload.verification) {
      ownershipVerification.value = payload.verification;
      if (payload.verification.status === "verified") await loadWidgetInstall();
    }
  } catch {
    // The install gate remains closed until the next successful verification read.
  }
}

async function requestOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value || verificationLoading.value) return;
  verificationLoading.value = true;
  verificationError.value = "";
  verificationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification/request`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ method: verificationMethod.value }),
    });
    const payload = await response.json() as { error?: string; verification?: WorkspacePayload["ownership"]; token?: string | null; instructions?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not start ownership verification.");
    ownershipVerification.value = payload.verification ?? ownershipVerification.value;
    verificationToken.value = payload.token ?? "";
    verificationInstructions.value = payload.instructions ?? "";
    verificationMessage.value = verificationMethod.value === "email" ? "Ownership verified · live publishing is enabled" : "Verification request created · complete the instructions, then check again";
  } catch (error) {
    verificationError.value = error instanceof Error ? error.message : "Could not start ownership verification.";
  } finally {
    verificationLoading.value = false;
  }
}

function startAgentVerification(method: VerificationMethod) {
  verificationMethod.value = method;
  void requestOwnershipVerification();
}

async function checkOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value || !verificationToken.value.trim() || verificationLoading.value) return;
  verificationLoading.value = true;
  verificationError.value = "";
  verificationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification/check`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ token: verificationToken.value.trim() }),
    });
    const payload = await response.json() as { error?: string; message?: string; verified?: boolean; verification?: WorkspacePayload["ownership"] };
    if (!response.ok) throw new Error(payload.error ?? "Could not check ownership verification.");
    ownershipVerification.value = payload.verification ?? ownershipVerification.value;
    if (payload.verified) {
      verificationMessage.value = payload.message ?? "Ownership verified · live publishing is enabled";
      verificationToken.value = "";
      await loadWidgetInstall();
    } else {
      verificationError.value = payload.message ?? "The verification proof was not found yet.";
    }
  } catch (error) {
    verificationError.value = error instanceof Error ? error.message : "Could not check ownership verification.";
  } finally {
    verificationLoading.value = false;
  }
}

async function loadLeads() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  leadsLoading.value = true;
  leadsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads?limit=500`), { headers: ownerHeaders() });
    const payload = await response.json() as { leads?: Array<{ id: string; name?: string | null; email?: string | null; phone?: string | null; intent?: string | null; source?: string | null; notes?: string | null; metadata?: Record<string, unknown>; status?: string; createdAt?: string }>; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load leads.");
    leads.value = (payload.leads ?? []).map((lead) => ({
      id: lead.id,
      name: lead.name ?? "Unknown contact",
      email: lead.email ?? "",
      phone: lead.phone ?? "",
      intent: lead.intent ?? "General inquiry",
      source: lead.source ?? "widget",
      notes: lead.notes ?? (typeof lead.metadata?.notes === "string" ? lead.metadata.notes : ""),
      status: lead.status === "qualified" ? "Qualified" : lead.status === "booked" ? "Booked" : "New",
      time: lead.createdAt ? new Date(lead.createdAt).toLocaleString() : "Just now",
    }));
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not load leads.";
  } finally {
    leadsLoading.value = false;
  }
}

async function loadInbox() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  inboxLoading.value = true;
  inboxError.value = "";
  try {
    const params = new URLSearchParams();
    if (inboxStatusFilter.value !== "all") params.set("status", inboxStatusFilter.value);
    if (inboxAssignmentFilter.value === "mine" && authSnapshot.value?.user.id) params.set("assignedTo", authSnapshot.value.user.id);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/inbox${query}`), { headers: ownerHeaders() });
    const payload = await response.json() as { error?: string; conversations?: InboxConversation[] };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the inbox.");
    inboxConversations.value = payload.conversations ?? [];
    if (selectedInboxConversation.value) {
      const current = inboxConversations.value.find((conversation) => conversation.id === selectedInboxConversation.value?.id);
      if (current) await openInboxConversation(current);
    }
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not load the inbox.";
  } finally {
    inboxLoading.value = false;
  }
}

async function loadNotifications() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications?limit=30`), { headers: ownerHeaders() });
    const payload = await response.json() as { notifications?: StaffNotification[]; unreadCount?: number };
    if (response.ok) {
      staffNotifications.value = payload.notifications ?? [];
      notificationUnreadCount.value = payload.unreadCount ?? 0;
    }
  } catch {
    // Notification badges are best-effort and should not block the workspace.
  }
}

function activeBusinessIdForPreferences(): string | null {
  return availableBusinesses.value.find((business) => business.slug === demoSlug.value)?.id ?? availableBusinesses.value[0]?.id ?? null;
}

async function loadNotificationPreferences() {
  if (!authSnapshot.value) return;
  const businessId = activeBusinessIdForPreferences();
  if (!businessId) return;
  notificationPreferencesError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/messaging/preferences?businessId=${encodeURIComponent(businessId)}`), { headers: ownerHeaders() });
    const payload = await response.json() as { preferences?: typeof notificationPreferences.value; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load notification preferences.");
    if (payload.preferences) notificationPreferences.value = payload.preferences;
  } catch (error) {
    notificationPreferencesError.value = error instanceof Error ? error.message : "Could not load notification preferences.";
  }
}

async function saveNotificationPreferences() {
  if (!authSnapshot.value || notificationPreferencesLoading.value) return;
  const businessId = activeBusinessIdForPreferences();
  if (!businessId) return;
  notificationPreferencesLoading.value = true;
  notificationPreferencesMessage.value = "";
  notificationPreferencesError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/messaging/preferences"), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ businessId, ...notificationPreferences.value }),
    });
    const payload = await response.json() as { preferences?: typeof notificationPreferences.value; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save notification preferences.");
    if (payload.preferences) notificationPreferences.value = payload.preferences;
    notificationPreferencesMessage.value = "Notification preferences saved.";
  } catch (error) {
    notificationPreferencesError.value = error instanceof Error ? error.message : "Could not save notification preferences.";
  } finally {
    notificationPreferencesLoading.value = false;
  }
}

function toggleNotifications() {
  if (!authSnapshot.value) return;
  notificationMenuOpen.value = !notificationMenuOpen.value;
  profileMenuOpen.value = false;
  if (notificationMenuOpen.value && !staffNotifications.value.length) void loadNotifications();
}

async function markNotificationRead(notification: StaffNotification) {
  if (notification.readAt) return;
  await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications/${notification.id}/read`), { method: "POST", headers: ownerHeaders() });
  notification.readAt = new Date().toISOString();
  notificationUnreadCount.value = Math.max(0, notificationUnreadCount.value - 1);
}

async function openInboxConversation(conversation: InboxConversation) {
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversation.id}`), { headers: ownerHeaders() });
    const payload = await response.json() as { error?: string; conversation?: InboxConversation };
    if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "Could not open this conversation.");
    selectedInboxConversation.value = payload.conversation;
    const index = inboxConversations.value.findIndex((item) => item.id === conversation.id);
    if (index >= 0) inboxConversations.value[index] = { ...inboxConversations.value[index], ...payload.conversation };
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not open this conversation.";
  }
}

async function inboxMutation(path: string, body?: Record<string, unknown>) {
  if (inboxActionLoading.value) return;
  inboxActionLoading.value = true;
  inboxError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}${path}`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update this conversation.");
    inboxMessage.value = "Inbox updated";
    await loadInbox();
    if (selectedInboxConversation.value) await openInboxConversation(selectedInboxConversation.value);
    window.setTimeout(() => (inboxMessage.value = ""), 2400);
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not update this conversation.";
  } finally {
    inboxActionLoading.value = false;
  }
}

async function takeOverConversation() {
  if (!selectedInboxConversation.value) return;
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/takeover`);
}

async function returnConversationToAi() {
  if (!selectedInboxConversation.value) return;
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/return-to-ai`);
}

async function resolveConversation() {
  if (!selectedInboxConversation.value) return;
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/resolve`);
}

async function sendInboxReply() {
  if (!selectedInboxConversation.value || !inboxReply.value.trim()) return;
  const content = inboxReply.value.trim();
  inboxReply.value = "";
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/messages/human`, { content });
}

async function addInboxNote() {
  if (!selectedInboxConversation.value || !inboxNote.value.trim()) return;
  const content = inboxNote.value.trim();
  inboxNote.value = "";
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/notes`, { content });
}

async function suggestInboxReply() {
  if (!selectedInboxConversation.value || inboxActionLoading.value) return;
  inboxActionLoading.value = true;
  inboxError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${selectedInboxConversation.value.id}/ai-assist`), { method: "POST", headers: { "content-type": "application/json", ...ownerHeaders() } });
    const payload = await response.json() as { error?: string; suggestion?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not prepare an AI suggestion.");
    inboxSuggestion.value = payload.suggestion ?? "";
    await openInboxConversation(selectedInboxConversation.value);
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not prepare an AI suggestion.";
  } finally {
    inboxActionLoading.value = false;
  }
}

async function loadTeam() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  teamLoading.value = true;
  teamError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team`), { headers: ownerHeaders() });
    const payload = await response.json() as { error?: string; members?: TeamMember[]; businesses?: Array<{ id: string; name: string; slug: string }> };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the team.");
    teamMembers.value = payload.members ?? [];
    teamBusinesses.value = payload.businesses ?? [];
  } catch (error) {
    teamError.value = error instanceof Error ? error.message : "Could not load the team.";
  } finally {
    teamLoading.value = false;
  }
}

async function inviteTeamMember() {
  if (!teamInviteEmail.value.trim() || teamLoading.value) return;
  teamLoading.value = true;
  teamError.value = "";
  teamMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team/invite`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ email: teamInviteEmail.value.trim(), name: teamInviteName.value.trim() || undefined, role: teamInviteRole.value, businessIds: [selectedBusinessId()] }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not invite this team member.");
    teamInviteEmail.value = "";
    teamInviteName.value = "";
    teamMessage.value = "Invitation created";
    await loadTeam();
  } catch (error) {
    teamError.value = error instanceof Error ? error.message : "Could not invite this team member.";
  } finally {
    teamLoading.value = false;
  }
}

async function updateTeamMember(member: TeamMember, role: TeamMember["role"]) {
  if (member.role === "owner" || teamLoading.value) return;
  teamLoading.value = true;
  teamError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team/${member.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ role, businessIds: member.businessIds.length ? member.businessIds : [selectedBusinessId()] }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update team access.");
    await loadTeam();
  } catch (error) {
    teamError.value = error instanceof Error ? error.message : "Could not update team access.";
  } finally {
    teamLoading.value = false;
  }
}

const visibleLeads = computed(() => {
  const search = leadSearch.value.trim().toLowerCase();
  return leads.value.filter((lead) => {
    const statusMatch = leadStatusFilter.value === "all" || lead.status.toLowerCase() === leadStatusFilter.value;
    const searchMatch = !search || [lead.name, lead.email, lead.phone, lead.intent, lead.source].some((value) => value.toLowerCase().includes(search));
    return statusMatch && searchMatch;
  });
});

function openLeadDetail(lead: Lead) {
  selectedLead.value = lead;
  leadDetailStatus.value = lead.status;
  leadDetailNotes.value = lead.notes;
  leadDetailOpen.value = true;
}

async function saveLeadDetail() {
  if (!selectedLead.value || leadDetailLoading.value) return;
  leadDetailLoading.value = true;
  leadsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads/${selectedLead.value.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ status: leadDetailStatus.value.toLowerCase(), notes: leadDetailNotes.value }),
    });
    const payload = await response.json() as { lead?: { status?: string; notes?: string; metadata?: Record<string, unknown> }; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update this lead.");
    selectedLead.value.status = leadDetailStatus.value;
    selectedLead.value.notes = leadDetailNotes.value;
    leadDetailOpen.value = false;
    leadExportMessage.value = "Lead updated";
    window.setTimeout(() => (leadExportMessage.value = ""), 2400);
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not update this lead.";
  } finally {
    leadDetailLoading.value = false;
  }
}

async function deleteLead() {
  if (!selectedLead.value || leadDetailLoading.value) return;
  if (typeof window !== "undefined" && !window.confirm("Delete this lead record? This cannot be undone.")) return;
  leadDetailLoading.value = true;
  leadsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads/${selectedLead.value.id}`), { method: "DELETE", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not delete this lead.");
    leads.value = leads.value.filter((lead) => lead.id !== selectedLead.value?.id);
    selectedLead.value = null;
    leadDetailOpen.value = false;
    leadExportMessage.value = "Lead deleted";
    window.setTimeout(() => (leadExportMessage.value = ""), 2400);
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not delete this lead.";
  } finally {
    leadDetailLoading.value = false;
  }
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function exportLeadsCsv() {
  const rows = [
    ["Name", "Email", "Phone", "Intent", "Status", "Source", "Captured", "Notes"],
    ...visibleLeads.value.map((lead) => [lead.name, lead.email, lead.phone, lead.intent, lead.status, lead.source, lead.time, lead.notes]),
  ];
  const blob = new Blob([rows.map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${demoSlug.value}-leads.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  leadExportMessage.value = `${visibleLeads.value.length} lead${visibleLeads.value.length === 1 ? "" : "s"} exported`;
  window.setTimeout(() => (leadExportMessage.value = ""), 2400);
}

async function recrawlSource(source: WorkspaceSource) {
  if (!authSnapshot.value) {
    openAuth("signup");
    return;
  }
  if (sourceActionLoading.value) return;
  sourceActionLoading.value = source.id;
  sourceActionMessage.value = "";
  knowledgeError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/sources/${source.id}/recrawl`), { method: "POST", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string; sourceCount?: number };
    if (!response.ok) throw new Error(payload.error ?? "Could not refresh website knowledge.");
    sourceActionMessage.value = `Website refreshed · ${payload.sourceCount ?? 0} pages available`;
    await refreshWorkspaceSummary();
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not refresh website knowledge.";
    await refreshWorkspaceSummary();
  } finally {
    sourceActionLoading.value = "";
  }
}

async function deleteSource(source: WorkspaceSource) {
  if (!authSnapshot.value) {
    openAuth("signup");
    return;
  }
  if (sourceActionLoading.value || !window.confirm(`Remove ${source.title} from the assistant's knowledge?`)) return;
  sourceActionLoading.value = source.id;
  sourceActionMessage.value = "";
  knowledgeError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/sources/${source.id}`), { method: "DELETE", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not remove this source.");
    sourceActionMessage.value = `${source.title} removed`;
    await refreshWorkspaceSummary();
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not remove this source.";
  } finally {
    sourceActionLoading.value = "";
  }
}

async function reindexKnowledge() {
  if (!authSnapshot.value || !firebaseToken.value || !selectedBusinessId() || embeddingLoading.value) return;
  embeddingLoading.value = true;
  embeddingMessage.value = "";
  knowledgeError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/reindex`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { status?: string; message?: string; error?: string };
    if (!response.ok) throw new Error(response.status === 503 ? "Knowledge re-indexing is not available yet." : payload.error ?? "Could not re-index knowledge.");
    embeddingMessage.value = payload.status === "queued" ? "Knowledge re-indexing started." : payload.message ?? "Knowledge is already up to date.";
    knowledgeTestContext.value = "updated";
    await refreshWorkspaceSummary();
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not re-index knowledge.";
  } finally {
    embeddingLoading.value = false;
  }
}

async function loadIntegrations() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  integrationLoading.value = true;
  integrationError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations`), { headers: ownerHeaders() });
    const payload = await response.json() as { integrations?: Integration[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load integrations.");
    integrations.value = payload.integrations ?? [];
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "Could not load integrations.";
  } finally {
    integrationLoading.value = false;
  }
}

async function loadMcpConnections() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  mcpLoading.value = true;
  mcpError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections`), { headers: ownerHeaders() });
    const payload = await response.json() as { connections?: McpConnection[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load MCP connections.");
    mcpConnections.value = payload.connections ?? [];
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : "Could not load MCP connections.";
  } finally {
    mcpLoading.value = false;
  }
}

function cloneAction(action: ActionFlow): ActionFlow {
  return JSON.parse(JSON.stringify(action)) as ActionFlow;
}

function selectAction(action: ActionFlow | null) {
  if (!action) {
    selectedActionId.value = "";
    actionDraft.value = null;
    actionTriggerText.value = "";
    actionTriggerPhraseInput.value = "";
    actionEditorStage.value = "trigger";
    actionFieldDrawerIndex.value = null;
    actionAdvancedOpen.value = false;
    return;
  }
  selectedActionId.value = action.id;
  actionDraft.value = cloneAction(action);
  actionDraft.value.captureMode ??= "auto";
  actionDraft.value.completion.notifyTargets ??= ["business_team"];
  actionDraft.value.completion.notifyChannels ??= ["in_app", "email"];
  actionDraft.value.fields.forEach((field) => {
    field.visibility ??= "visible";
  });
  actionTriggerText.value = action.triggerPhrases.join("\n");
  actionTriggerPhraseInput.value = "";
  actionEditorStage.value = "trigger";
  actionFieldDrawerIndex.value = null;
  actionAdvancedOpen.value = false;
}

const actionTriggerPhrases = computed(() => actionTriggerText.value.split("\n").map((item) => item.trim()).filter(Boolean));
const selectedActionField = computed(() => {
  if (!actionDraft.value || actionFieldDrawerIndex.value === null) return null;
  return actionDraft.value.fields[actionFieldDrawerIndex.value] ?? null;
});
const actionEditorStageLabels: Array<{ id: ActionEditorStage; label: string; helper: string }> = [
  { id: "trigger", label: "Trigger", helper: "When it starts" },
  { id: "qualify", label: "Qualify", helper: "Questions" },
  { id: "contact", label: "Contact", helper: "Capture style" },
  { id: "complete", label: "Complete", helper: "Success" },
  { id: "deliver", label: "Deliver", helper: "Team & systems" },
];

function actionFunnelFor(action: ActionFlow) {
  return workspaceStats.value?.conversionFunnels?.find((funnel) => funnel.flowId === action.id || funnel.flowKey === action.key) ?? null;
}

function actionCompletionRate(action: ActionFlow): number {
  return actionFunnelFor(action)?.completionRate ?? 0;
}

function actionDeliveriesFor(action: ActionFlow): ActionDelivery[] {
  return actionDeliveries.value.filter((delivery) => delivery.actionId === action.id);
}

function actionStatusLabel(action: ActionFlow): "Active" | "Draft" | "Paused" | "Needs setup" | "Integration error" {
  const delivery = actionDeliveries.value.find((item) => item.actionId === action.id && item.status === "failed");
  if (delivery) return "Integration error";
  if (!action.enabled) return "Paused";
  if (!action.fields.length || !action.completion.createLead) return "Needs setup";
  return action.updatedAt === action.createdAt ? "Draft" : "Active";
}

function actionStatusTone(status: ReturnType<typeof actionStatusLabel>): "active" | "draft" | "paused" | "attention" {
  if (status === "Active") return "active";
  if (status === "Paused") return "paused";
  if (status === "Integration error" || status === "Needs setup") return "attention";
  return "draft";
}

function setActionStage(stage: ActionEditorStage) {
  actionEditorStage.value = stage;
  actionFieldDrawerIndex.value = null;
  actionAdvancedOpen.value = false;
}

function addActionTriggerPhrase() {
  const phrase = actionTriggerPhraseInput.value.trim();
  if (!phrase) return;
  if (!actionTriggerPhrases.value.includes(phrase)) actionTriggerText.value = [...actionTriggerPhrases.value, phrase].join("\n");
  actionTriggerPhraseInput.value = "";
}

function removeActionTriggerPhrase(phrase: string) {
  actionTriggerText.value = actionTriggerPhrases.value.filter((item) => item !== phrase).join("\n");
}

function setActionIntentDetection(event: Event) {
  if (!actionDraft.value) return;
  const enabled = (event.target as HTMLInputElement).checked;
  if (enabled && !actionDraft.value.triggerIntents.length) actionDraft.value.triggerIntents = ["general"];
  if (!enabled) actionDraft.value.triggerIntents = [];
}

function setActionTriggerIntents(event: Event) {
  if (!actionDraft.value) return;
  actionDraft.value.triggerIntents = (event.target as HTMLInputElement).value.split(",").map((item) => item.trim()).filter(Boolean);
}

function selectActionCaptureMode(mode: ActionFlow["captureMode"]) {
  if (actionDraft.value) actionDraft.value.captureMode = mode;
}

function openActionField(index: number) {
  actionFieldDrawerIndex.value = index;
  actionAdvancedOpen.value = false;
}

function closeActionField() {
  actionFieldDrawerIndex.value = null;
}

function moveSelectedActionField(direction: -1 | 1) {
  if (actionFieldDrawerIndex.value === null) return;
  const nextIndex = actionFieldDrawerIndex.value + direction;
  if (!actionDraft.value || nextIndex < 0 || nextIndex >= actionDraft.value.fields.length) return;
  moveActionField(actionFieldDrawerIndex.value, direction);
  actionFieldDrawerIndex.value = nextIndex;
}

function dragActionField(index: number) {
  draggedActionFieldIndex.value = index;
}

function dropActionField(index: number) {
  const from = draggedActionFieldIndex.value;
  if (!actionDraft.value || from === null || from === index) return;
  const [field] = actionDraft.value.fields.splice(from, 1);
  actionDraft.value.fields.splice(index, 0, field);
  draggedActionFieldIndex.value = null;
  actionFieldDrawerIndex.value = null;
}

function toggleActionNotificationTarget(target: "owner" | "business_team" | "assigned_staff", event: Event) {
  if (!actionDraft.value) return;
  const checked = (event.target as HTMLInputElement).checked;
  const current = actionDraft.value.completion.notifyTargets ?? [];
  actionDraft.value.completion.notifyTargets = checked
    ? [...new Set([...current, target])]
    : current.filter((item) => item !== target);
}

function hasActionNotificationTarget(target: "owner" | "business_team" | "assigned_staff"): boolean {
  return Boolean(actionDraft.value?.completion.notifyTargets?.includes(target));
}

function setActionConnectorProvider(value: string) {
  if (!actionDraft.value) return;
  if (value === "none") {
    delete actionDraft.value.completion.connector;
    return;
  }
  const provider = value as ActionConnectorProvider;
  const existing = actionDraft.value.completion.connector;
  const matchingIntegration = integrations.value.find((integration) =>
    (provider === "generic_webhook" && integration.provider === "webhook")
    || (provider === "hubspot" && integration.provider === "hubspot"),
  );
  actionDraft.value.completion.connector = {
    ...(existing ?? {}),
    provider,
    ...(existing?.integrationId || !matchingIntegration ? {} : { integrationId: matchingIntegration.id }),
  };
}

function setActionConnectorIntegration(value: string) {
  if (!actionDraft.value?.completion.connector) return;
  actionDraft.value.completion.connector.integrationId = value || undefined;
}

function setActionConnectorProviderFromEvent(event: Event) {
  setActionConnectorProvider((event.target as HTMLSelectElement).value);
}

function setActionConnectorIntegrationFromEvent(event: Event) {
  setActionConnectorIntegration((event.target as HTMLSelectElement).value);
}

async function loadActions() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions"), { headers: ownerHeaders() });
    const payload = await response.json() as { actions?: ActionFlow[]; templates?: ActionTemplate[]; deliveries?: ActionDelivery[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load conversation flows.");
    actionFlows.value = payload.actions ?? [];
    actionTemplates.value = payload.templates ?? [];
    actionDeliveries.value = payload.deliveries ?? [];
    const selected = actionFlows.value.find((action) => action.id === selectedActionId.value) ?? null;
    selectAction(selected);
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not load conversation flows.";
  } finally {
    actionsLoading.value = false;
  }
}

async function retryActionDelivery(delivery: ActionDelivery) {
  if (actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/action-deliveries/${delivery.id}/retry`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not retry this action delivery.");
    actionsMessage.value = "Action retry queued";
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not retry this action delivery.";
  } finally {
    actionsLoading.value = false;
  }
}

async function addActionTemplate(template: ActionTemplate) {
  if (actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ templateKey: template.key }),
    });
    const payload = await response.json() as { error?: string; action?: ActionFlow };
    if (!response.ok) throw new Error(payload.error ?? "Could not add this flow.");
    actionsMessage.value = "Flow added · review the questions before publishing";
    selectedActionId.value = payload.action?.id ?? "";
    actionTemplateChooserOpen.value = false;
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not add this flow.";
  } finally {
    actionsLoading.value = false;
  }
}

async function addCustomAction() {
  const now = Date.now();
  await addActionTemplate({
    key: `custom_action_${now}`,
    name: "Custom action",
    description: "Build a focused customer action from your own questions.",
    triggerPhrases: ["I need help", "contact me"],
    triggerIntents: ["general"],
    captureMode: "auto",
    fields: [
      { id: "name", key: "name", label: "Name", type: "text", required: true, visibility: "visible", question: "What’s your name?" },
      { id: "email", key: "email", label: "Email", type: "email", required: true, visibility: "visible", question: "What email address should we use?" },
    ],
    completion: { createLead: true, leadStatus: "new", message: "Thanks — I’ve sent your request to the team.", notifyStaff: true, notifyChannels: ["in_app", "email"], notifyTargets: ["business_team"] },
    enabled: false,
  });
}

async function saveAction() {
  if (!actionDraft.value || actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions/" + actionDraft.value.id), {
      method: "PUT",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        ...actionDraft.value,
        triggerPhrases: actionTriggerText.value.split("\n").map((item) => item.trim()).filter(Boolean),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this flow.");
    actionsMessage.value = "Saved · the assistant will use the updated flow";
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not save this flow.";
  } finally {
    actionsLoading.value = false;
  }
}

async function removeAction() {
  if (!actionDraft.value || actionsLoading.value || !window.confirm("Remove this conversation flow?")) return;
  actionsLoading.value = true;
  actionsError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions/" + actionDraft.value.id), {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not remove this flow.");
    actionsMessage.value = "Flow removed";
    selectedActionId.value = "";
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not remove this flow.";
  } finally {
    actionsLoading.value = false;
  }
}

function addActionField() {
  if (!actionDraft.value) return;
  const index = actionDraft.value.fields.length + 1;
  actionDraft.value.fields.push({
    id: "field-" + Date.now(),
    key: "field_" + index,
    label: "New question",
    type: "text",
    required: true,
    visibility: "visible",
    question: "What would you like us to know?",
  });
}

function removeActionField(index: number) {
  actionDraft.value?.fields.splice(index, 1);
}

function moveActionField(index: number, direction: -1 | 1) {
  if (!actionDraft.value) return;
  const nextIndex = index + direction;
  if (nextIndex < 0 || nextIndex >= actionDraft.value.fields.length) return;
  const fields = actionDraft.value.fields;
  [fields[index], fields[nextIndex]] = [fields[nextIndex], fields[index]];
}

function setFieldOptions(field: ActionField, event: Event) {
  const value = (event.target as HTMLInputElement).value;
  field.options = value.split(",").map((item) => item.trim()).filter(Boolean);
}

function setFieldCondition(field: ActionField, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  if (!value) {
    delete field.condition;
    return;
  }
  field.condition = { ...(field.condition ?? {}), field: value };
}

function setFieldConditionEquals(field: ActionField, event: Event) {
  const value = (event.target as HTMLInputElement).value.trim();
  if (!field.condition) field.condition = { field: "" };
  if (value) field.condition.equals = value;
  else delete field.condition.equals;
}

async function loadBilling() {
  if (!authSnapshot.value || billingLoading.value) return;
  billingLoading.value = true;
  billingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/billing?organizationId=${encodeURIComponent(authSnapshot.value.activeOrganizationId ?? "")}`), { headers: ownerHeaders() });
    const payload = await response.json() as BillingSnapshot & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load billing.");
    billingSnapshot.value = payload;
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not load billing.";
  } finally {
    billingLoading.value = false;
  }
}

function formatPlanPrice(plan: BillingPlan): string {
  if (plan.amountCents === null) return "Contact us";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 }).format(plan.amountCents / 100);
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatTemplateVariable(value: string): string {
  return `{{${value}}}`;
}

function formatPlanLabel(value: string): string {
  const labels: Record<string, string> = {
    starter: "Starter",
    growth: "Growth",
    multi_business: "Multi-Business",
    portfolio: "Portfolio",
  };
  return labels[value] ?? formatLabel(value);
}

function formatBillingDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : "No date set";
}

async function loadAdminInstallationSupport() {
  if (!authSnapshot.value || installationSupportLoading.value) return;
  installationSupportLoading.value = true;
  installationSupportError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/installation-support?limit=200"), { headers: ownerHeaders() });
    const payload = await response.json() as { requests?: InstallationSupportRequest[]; assignees?: InstallationSupportAssignee[]; summary?: { new?: number; inProgress?: number; resolved?: number }; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load installation support requests.");
    installationSupportRequests.value = payload.requests ?? [];
    installationSupportAssignees.value = payload.assignees ?? [];
    installationSupportSummary.value = {
      new: payload.summary?.new ?? 0,
      inProgress: payload.summary?.inProgress ?? 0,
      resolved: payload.summary?.resolved ?? 0,
    };
  } catch (error) {
    installationSupportError.value = error instanceof Error ? error.message : "Could not load installation support requests.";
  } finally {
    installationSupportLoading.value = false;
  }
}

async function updateAdminInstallationSupport(item: InstallationSupportRequest) {
  if (installationSupportLoading.value) return;
  installationSupportLoading.value = true;
  installationSupportError.value = "";
  installationSupportMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/installation-support/${encodeURIComponent(item.id)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ status: item.status, assignedUserId: item.assignedUserId }),
    });
    const payload = await response.json() as { request?: InstallationSupportRequest; error?: string };
    if (!response.ok || !payload.request) throw new Error(payload.error ?? "Could not update the installation support request.");
    const index = installationSupportRequests.value.findIndex((request) => request.id === item.id);
    if (index >= 0) installationSupportRequests.value.splice(index, 1, payload.request);
    installationSupportMessage.value = "Installation support request updated.";
  } catch (error) {
    installationSupportError.value = error instanceof Error ? error.message : "Could not update the installation support request.";
    installationSupportLoading.value = false;
    await loadAdminInstallationSupport();
  } finally {
    installationSupportLoading.value = false;
  }
}

async function loadAdminOrganizations() {
  if (!authSnapshot.value || adminLoading.value) return;
  adminLoading.value = true;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/organizations"), { headers: ownerHeaders() });
    if (!response.ok) {
      isSuperAdmin.value = false;
      adminError.value = "This account is not authorized for the super-admin control plane.";
      return;
    }
    const payload = await response.json() as { organizations?: AdminOrganization[] };
    adminOrganizations.value = payload.organizations ?? [];
    isSuperAdmin.value = true;
  } catch {
    isSuperAdmin.value = false;
    adminError.value = "The super-admin control plane could not be reached.";
  } finally {
    adminLoading.value = false;
  }
}

async function loadAdminOrganizationDetail(organizationId: string, activate = true) {
  if (!authSnapshot.value || adminOrganizationDetailLoading.value) return;
  adminOrganizationDetailLoading.value = true;
  adminError.value = "";
  adminBillingMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}`), { headers: ownerHeaders() });
    const payload = await response.json() as AdminOrganizationDetail & { error?: string };
    if (!response.ok || !payload.organization) throw new Error(payload.error ?? "Could not load organization detail.");
    adminOrganizationDetail.value = payload;
    const billing = payload.organization.billing;
    adminOverridePlanKey.value = billing.planKey;
    adminOverrideInterval.value = billing.interval === "year" ? "year" : "month";
    adminOverrideAmountCents.value = String(billing.amountCents ?? billing.plan.amountCents ?? 0);
    adminOverrideMaxBusinesses.value = String(billing.plan.maxBusinesses ?? 1);
    adminOverrideReason.value = billing.override?.reason ?? "";
    if (activate) {
      navigateToAdminSection("organization-detail", { organizationId });
    }
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not load organization detail.";
  } finally {
    adminOrganizationDetailLoading.value = false;
  }
}

async function loadAdminBusinessDetail(businessId: string, activate = true) {
  if (!authSnapshot.value || adminBusinessDetailLoading.value) return;
  adminBusinessDetailLoading.value = true;
  adminError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/businesses/${encodeURIComponent(businessId)}`), { headers: ownerHeaders() });
    const payload = await response.json() as AdminBusinessDetail & { error?: string };
    if (!response.ok || !payload.business) throw new Error(payload.error ?? "Could not load business detail.");
    adminBusinessDetail.value = payload;
    if (activate) navigateToAdminSection("business-detail", { businessId });
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not load business detail.";
  } finally {
    adminBusinessDetailLoading.value = false;
  }
}

async function refreshAdminOrganizationDetail() {
  const organizationId = adminOrganizationDetail.value?.organization.id;
  if (organizationId) await loadAdminOrganizationDetail(organizationId, false);
}

async function loadAdminHealth() {
  if (!authSnapshot.value) return;
  try {
    const [healthResponse, readyResponse] = await Promise.all([
      trackedFetch(apiUrl("/health")),
      trackedFetch(apiUrl("/ready")),
    ]);
    const health = await healthResponse.json() as { objectStorageConfigured?: boolean; emailConfigured?: boolean; stripeConfigured?: boolean; storage?: string };
    const ready = await readyResponse.json() as { ok?: boolean; database?: string; objectStorageConfigured?: boolean; emailConfigured?: boolean; stripeConfigured?: boolean };
    adminHealth.value = {
      api: healthResponse.ok && readyResponse.ok ? "healthy" : "degraded",
      database: ready.database ?? (readyResponse.ok ? health.storage ?? "ready" : "unavailable"),
      objectStorageConfigured: Boolean(ready.objectStorageConfigured ?? health.objectStorageConfigured),
      emailConfigured: Boolean(ready.emailConfigured ?? health.emailConfigured),
      stripeConfigured: Boolean(ready.stripeConfigured ?? health.stripeConfigured),
      checkedAt: new Date().toISOString(),
    };
  } catch {
    adminHealth.value = {
      api: "down",
      database: "unavailable",
      objectStorageConfigured: false,
      emailConfigured: false,
      stripeConfigured: false,
      checkedAt: new Date().toISOString(),
    };
  }
}

async function loadAdminUsers() {
  if (!authSnapshot.value) return;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/users?limit=200"), { headers: ownerHeaders() });
    if (!response.ok) return;
    const payload = await response.json() as { users?: AdminUser[] };
    adminUsers.value = payload.users ?? [];
  } catch {
    adminUsers.value = [];
  }
}

async function loadAdminMessaging(force = false) {
  if (!authSnapshot.value || (messagingLoading.value && !force)) return;
  messagingLoading.value = true;
  messagingError.value = "";
  try {
    const filter = messagingDeliveryFilter.value === "all" ? "" : `?status=${encodeURIComponent(messagingDeliveryFilter.value)}`;
    const [summaryResponse, templatesResponse, automationsResponse, deliveriesResponse] = await Promise.all([
      trackedFetch(apiUrl("/api/v1/admin/messaging/summary"), { headers: ownerHeaders() }),
      trackedFetch(apiUrl("/api/v1/admin/messaging/templates"), { headers: ownerHeaders() }),
      trackedFetch(apiUrl("/api/v1/admin/messaging/automations"), { headers: ownerHeaders() }),
      trackedFetch(apiUrl(`/api/v1/admin/messaging/deliveries${filter}`), { headers: ownerHeaders() }),
    ]);
    const [summary, templates, automations, deliveries] = await Promise.all([
      summaryResponse.json() as Promise<MessagingSummary & { error?: string }>,
      templatesResponse.json() as Promise<{ templates?: MessagingTemplate[]; error?: string }>,
      automationsResponse.json() as Promise<{ automations?: MessagingAutomation[]; error?: string }>,
      deliveriesResponse.json() as Promise<{ deliveries?: MessagingDelivery[]; error?: string }>,
    ]);
    if (!summaryResponse.ok || !templatesResponse.ok || !automationsResponse.ok || !deliveriesResponse.ok) {
      throw new Error(summary.error ?? templates.error ?? automations.error ?? deliveries.error ?? "Could not load messaging controls.");
    }
    messagingSummary.value = summary;
    messagingTemplates.value = templates.templates ?? [];
    messagingAutomations.value = automations.automations ?? [];
    messagingDeliveries.value = deliveries.deliveries ?? [];
    if (!messagingTemplateDraft.value && messagingTemplates.value.length) selectMessagingTemplate(messagingTemplates.value[0]);
  } catch (error) {
    messagingError.value = error instanceof Error ? error.message : "Could not load messaging controls.";
  } finally {
    messagingLoading.value = false;
  }
}

function selectMessagingTemplate(template: MessagingTemplate) {
  selectedMessagingTemplateKey.value = template.templateKey;
  messagingTemplateDraft.value = JSON.parse(JSON.stringify(template)) as MessagingTemplate;
  messagingMessage.value = "";
}

async function saveMessagingTemplate() {
  const template = messagingTemplateDraft.value;
  if (!template || messagingLoading.value) return;
  messagingLoading.value = true;
  messagingError.value = "";
  messagingMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/messaging/templates/${encodeURIComponent(template.templateKey)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(template),
    });
    const payload = await response.json() as { template?: MessagingTemplate; error?: string };
    if (!response.ok || !payload.template) throw new Error(payload.error ?? "Could not save the message template.");
    messagingMessage.value = "Template saved · a new version is now active";
    await loadAdminMessaging(true);
    if (payload.template) selectMessagingTemplate(payload.template);
  } catch (error) {
    messagingError.value = error instanceof Error ? error.message : "Could not save the message template.";
  } finally {
    messagingLoading.value = false;
  }
}

async function updateMessagingAutomation(automation: MessagingAutomation) {
  if (messagingLoading.value) return;
  messagingLoading.value = true;
  messagingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/messaging/automations/${encodeURIComponent(automation.automationKey)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ enabled: automation.enabled, delaySeconds: automation.delaySeconds }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save the automation.");
    await loadAdminMessaging(true);
  } catch (error) {
    messagingError.value = error instanceof Error ? error.message : "Could not save the automation.";
  } finally {
    messagingLoading.value = false;
  }
}

async function testMessagingTemplate() {
  const template = messagingTemplateDraft.value;
  if (!template || messagingTestLoading.value) return;
  messagingTestLoading.value = true;
  messagingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/messaging/templates/${encodeURIComponent(template.templateKey)}/test`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ recipient: messagingTestRecipient.value.trim() || undefined }),
    });
    const payload = await response.json() as { recipient?: string; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not send the test message.");
    messagingMessage.value = `Test message sent to ${payload.recipient ?? "the authenticated admin"}.`;
  } catch (error) {
    messagingError.value = error instanceof Error ? error.message : "Could not send the test message.";
  } finally {
    messagingTestLoading.value = false;
  }
}

async function retryMessagingDelivery(delivery: MessagingDelivery) {
  if (messagingLoading.value) return;
  messagingLoading.value = true;
  messagingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/messaging/deliveries/${encodeURIComponent(delivery.id)}/retry`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not retry the delivery.");
    await loadAdminMessaging(true);
  } catch (error) {
    messagingError.value = error instanceof Error ? error.message : "Could not retry the delivery.";
  } finally {
    messagingLoading.value = false;
  }
}

function isPlatformRoute(): boolean {
  return route.value.kind === "platform";
}

function legalRoute(): "privacy" | "terms" | null {
  return route.value.kind === "legal" ? route.value.page : null;
}

function navigateToAdmin() {
  if (isSuperAdmin.value) {
    navigateToAdminSection("overview");
  }
  else openAuth("signin");
}

function handleRouteChange() {
  const nextRoute = parseRoute();
  route.value = nextRoute;
  void runWithGlobalLoading(() => applyRouteState(nextRoute));
}

async function restoreAuthenticatedSession(user: { getIdToken(): Promise<string> } | null) {
  if (!user) {
    firebaseToken.value = "";
    authSnapshot.value = null;
    isSuperAdmin.value = false;
    if (isPlatformRoute()) openAuth("signin");
    return;
  }

  try {
    firebaseToken.value = await user.getIdToken();
    const snapshot = await currentAuthSnapshot();
    if (!snapshot) throw new Error("Could not restore the FrontDeskWise account.");
    authSnapshot.value = snapshot;
    await settleAuthenticatedSession();
    authModalOpen.value = false;
  } catch (error) {
    // Keep Firebase's session intact. A temporary API/CORS/network failure
    // must not sign the user out or erase their local identity.
    authError.value = friendlyAuthError(error, "Could not restore the FrontDeskWise session.");
    if (isPlatformRoute()) openAuth("signin");
  }
}

async function loadAdminDemoRequests() {
  if (!authSnapshot.value) return;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/demo-requests?limit=100"), { headers: ownerHeaders() });
    if (!response.ok) return;
    const payload = await response.json() as { requests?: AdminDemoRequest[]; summary?: typeof adminDemoSummary.value };
    adminDemoRequests.value = payload.requests ?? [];
    adminDemoSummary.value = payload.summary ?? adminDemoSummary.value;
  } catch {
    // The organizations call remains the capability probe; demo operations are optional during rollout.
  }
}

async function adminDemoAction(item: AdminDemoRequest, action: "extend" | "reset" | "revoke" | "validate") {
  if (adminLoading.value) return;
  adminLoading.value = true;
  adminError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/demo-requests/${item.id}/${action}`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(action === "extend" ? { days: 7 } : {}),
    });
    const payload = await response.json() as { error?: string; url?: string; ok?: boolean; checks?: Record<string, unknown> };
    if (!response.ok) throw new Error(payload.error ?? "Demo operation failed.");
    if (payload.url) {
      adminGeneratedLink.value = payload.url;
      await navigator.clipboard?.writeText(payload.url).catch(() => undefined);
    }
    if (action === "validate" && payload.ok === false) throw new Error("Validation found gaps. Open the request to inspect its checks.");
    await loadAdminDemoRequests();
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Demo operation failed.";
  } finally {
    adminLoading.value = false;
  }
}

async function generateAdminDemoLink() {
  if (adminLoading.value || !adminBusinessSlug.value.trim()) return;
  adminLoading.value = true;
  adminError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/demo-requests"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        businessSlug: adminBusinessSlug.value.trim(),
        requesterName: adminRecipientName.value || undefined,
        requesterEmail: adminRecipientEmail.value || undefined,
        accessLabel: "Super-admin test user",
      }),
    });
    const payload = await response.json() as { error?: string; url?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error ?? "Could not generate a demo link.");
    adminGeneratedLink.value = payload.url;
    await navigator.clipboard?.writeText(payload.url).catch(() => undefined);
    await loadAdminDemoRequests();
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not generate a demo link.";
  } finally {
    adminLoading.value = false;
  }
}

async function copyAdminLink() {
  if (adminGeneratedLink.value) await navigator.clipboard?.writeText(adminGeneratedLink.value).catch(() => undefined);
}

async function testAdminEmail() {
  if (adminEmailTestLoading.value) return;
  adminEmailTestLoading.value = true;
  adminEmailTestMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/email/test"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({}),
    });
    const payload = await response.json() as { error?: string; recipient?: string };
    if (!response.ok) throw new Error(payload.error ?? "SES test failed.");
    adminEmailTestMessage.value = `Test email sent to ${payload.recipient ?? "the configured admin address"}.`;
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "SES test failed.";
  } finally {
    adminEmailTestLoading.value = false;
  }
}

async function adminOrganizationAction(organization: AdminOrganization, action: "trial" | "suspend") {
  if (adminLoading.value) return;
  adminLoading.value = true;
  adminError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/organizations/${organization.id}/${action}`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(action === "trial" ? { days: 30 } : {}),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Admin action failed.");
    adminLoading.value = false;
    await loadAdminOrganizations();
    if (adminOrganizationDetail.value?.organization.id === organization.id) await refreshAdminOrganizationDetail();
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Admin action failed.";
  } finally {
    adminLoading.value = false;
  }
}

async function adminDetailBillingAction(action: "trial" | "suspend") {
  const organizationId = adminOrganizationDetail.value?.organization.id;
  const organization = adminOrganizations.value.find((item) => item.id === organizationId);
  if (organization) await adminOrganizationAction(organization, action);
}

async function saveAdminPlanOverride() {
  const organizationId = adminOrganizationDetail.value?.organization.id;
  if (!organizationId || adminLoading.value) return;
  const amountCents = Number(adminOverrideAmountCents.value);
  const maxBusinesses = adminOverrideMaxBusinesses.value.trim() ? Number(adminOverrideMaxBusinesses.value) : null;
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    adminError.value = "Enter a non-negative whole-number amount in cents.";
    return;
  }
  if (maxBusinesses !== null && (!Number.isInteger(maxBusinesses) || maxBusinesses < 1)) {
    adminError.value = "Maximum businesses must be a positive whole number.";
    return;
  }
  if (!adminOverrideReason.value.trim()) {
    adminError.value = "Add a reason so the billing intervention is auditable.";
    return;
  }
  adminLoading.value = true;
  adminError.value = "";
  adminBillingMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/plan-override`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        planKey: adminOverridePlanKey.value,
        interval: adminOverrideInterval.value,
        amountCents,
        maxBusinesses,
        reason: adminOverrideReason.value.trim(),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save the billing intervention.");
    adminBillingMessage.value = "Billing intervention saved and business billing projections refreshed.";
    adminLoading.value = false;
    await loadAdminOrganizations();
    await refreshAdminOrganizationDetail();
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not save the billing intervention.";
  } finally {
    adminLoading.value = false;
  }
}

async function approveAdminBusiness(business: AdminOrganizationDetail["businesses"][number]) {
  if (adminLoading.value || business.ownershipStatus === "verified") return;
  adminLoading.value = true;
  adminError.value = "";
  adminBillingMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/businesses/${encodeURIComponent(business.id)}/verification/approve`), {
      method: "POST",
      headers: { ...ownerHeaders() },
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not approve business ownership.");
    adminBillingMessage.value = `${business.name} is now marked verified.`;
    adminLoading.value = false;
    if (adminOrganizationDetail.value?.organization.id) await refreshAdminOrganizationDetail();
    if (adminBusinessDetail.value?.business.id === business.id) await loadAdminBusinessDetail(business.id, false);
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not approve business ownership.";
  } finally {
    adminLoading.value = false;
  }
}

async function adminUserAction(user: AdminUser, status: "active" | "disabled") {
  if (adminLoading.value || user.status === status) return;
  adminLoading.value = true;
  adminError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/users/${user.id}/status`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "User status update failed.");
    await loadAdminUsers();
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "User status update failed.";
  } finally {
    adminLoading.value = false;
  }
}

async function startCheckout(plan: BillingPlan) {
  if (!authSnapshot.value || billingLoading.value) return;
  billingLoading.value = true;
  billingError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/billing/checkout-session"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ organizationId: authSnapshot.value.activeOrganizationId, planKey: plan.key, interval: "month" }),
    });
    const payload = await response.json() as { url?: string; error?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error ?? "This plan is not ready for checkout yet.");
    window.location.assign(payload.url);
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not start checkout.";
  } finally {
    billingLoading.value = false;
  }
}

async function openBillingPortal() {
  if (!authSnapshot.value || billingLoading.value) return;
  billingLoading.value = true;
  billingError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/billing/portal-session"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ organizationId: authSnapshot.value.activeOrganizationId }),
    });
    const payload = await response.json() as { url?: string; error?: string };
    if (!response.ok || !payload.url) throw new Error(payload.error ?? "Billing management is not available yet.");
    window.location.assign(payload.url);
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not open billing management.";
  } finally {
    billingLoading.value = false;
  }
}

async function connectIntegration() {
  if ((integrationProvider.value === "webhook" ? !integrationWebhookUrl.value.trim() : !integrationAccessToken.value.trim()) || integrationLoading.value) return;
  integrationLoading.value = true;
  integrationError.value = "";
  integrationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        provider: integrationProvider.value,
        displayName: integrationDisplayName.value,
        ...(integrationProvider.value === "webhook"
          ? { webhookUrl: integrationWebhookUrl.value, signingSecret: integrationSigningSecret.value || undefined }
          : { accessToken: integrationAccessToken.value }),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this integration.");
    integrationSigningSecret.value = "";
    integrationAccessToken.value = "";
    integrationMessage.value = "Saved securely · test the connection to activate delivery";
    await loadIntegrations();
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "Could not save this integration.";
  } finally {
    integrationLoading.value = false;
  }
}

function mcpProviderName(provider: McpConnection["provider"]): string {
  return provider === "hubspot" ? "HubSpot" : provider === "zapier" ? "Zapier" : provider === "make" ? "Make" : "Custom MCP server";
}

function mcpProviderHelp(provider: McpConnection["provider"]): string {
  if (provider === "hubspot") return "Use the MCP server URL and token from your HubSpot connection setup.";
  if (provider === "zapier") return "Use the remote MCP URL and token from Zapier MCP.";
  if (provider === "make") return "Use the remote MCP URL and token from Make MCP.";
  return "Use an HTTPS MCP server URL and bearer token provided by your software vendor.";
}

async function connectMcpConnection() {
  if (!mcpServerUrl.value.trim() || !mcpBearerToken.value.trim() || mcpLoading.value) return;
  mcpLoading.value = true;
  mcpError.value = "";
  mcpMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        provider: mcpProvider.value,
        displayName: mcpDisplayName.value.trim() || undefined,
        serverUrl: mcpServerUrl.value.trim(),
        bearerToken: mcpBearerToken.value,
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not connect this MCP server.");
    mcpBearerToken.value = "";
    mcpMessage.value = "Connected securely · read-only tools are enabled by default";
    await loadMcpConnections();
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : "Could not connect this MCP server.";
  } finally {
    mcpLoading.value = false;
  }
}

async function testMcpConnection(connection: McpConnection) {
  if (mcpLoading.value) return;
  mcpLoading.value = true;
  mcpError.value = "";
  mcpMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}/test`), { method: "POST", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The MCP connection test failed.");
    mcpMessage.value = `${connection.displayName} is healthy · tool list refreshed`;
    await loadMcpConnections();
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : "The MCP connection test failed.";
    await loadMcpConnections();
  } finally {
    mcpLoading.value = false;
  }
}

async function saveMcpPermissions(connection: McpConnection) {
  if (mcpLoading.value) return;
  mcpLoading.value = true;
  mcpError.value = "";
  mcpMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}/tools`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ allowedTools: connection.tools.filter((tool) => tool.allowed).map((tool) => tool.name) }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save MCP tool permissions.");
    mcpMessage.value = "Tool permissions saved";
    await loadMcpConnections();
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : "Could not save MCP tool permissions.";
  } finally {
    mcpLoading.value = false;
  }
}

async function disconnectMcpConnection(connection: McpConnection) {
  if (mcpLoading.value || !window.confirm(`Disconnect ${connection.displayName}? The assistant will stop using its tools.`)) return;
  mcpLoading.value = true;
  mcpError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}`), { method: "DELETE", headers: ownerHeaders() });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not disconnect the MCP server.");
    mcpMessage.value = `${connection.displayName} disconnected`;
    await loadMcpConnections();
  } catch (error) {
    mcpError.value = error instanceof Error ? error.message : "Could not disconnect the MCP server.";
  } finally {
    mcpLoading.value = false;
  }
}

async function testIntegration(integration: Integration) {
  integrationLoading.value = true;
  integrationError.value = "";
  integrationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}/test`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The CRM connection test failed.");
    integrationMessage.value = "Connection verified · queued leads will sync automatically";
    await loadIntegrations();
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "The CRM connection test failed.";
    await loadIntegrations();
  } finally {
    integrationLoading.value = false;
  }
}

async function retryIntegration(integration: Integration) {
  integrationLoading.value = true;
  integrationError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}/retry`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not retry CRM delivery.");
    integrationMessage.value = "Retry queued";
    await loadIntegrations();
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "Could not retry CRM delivery.";
  } finally {
    integrationLoading.value = false;
  }
}

async function disconnectIntegration(integration: Integration) {
  if (integrationLoading.value || !window.confirm(`Disconnect ${integration.displayName}? Pending delivery records for this connection will be removed.`)) return;
  integrationLoading.value = true;
  integrationError.value = "";
  integrationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}`), {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not disconnect this integration.");
    integrationMessage.value = `${integration.displayName} disconnected`;
    await loadIntegrations();
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "Could not disconnect this integration.";
  } finally {
    integrationLoading.value = false;
  }
}

async function copyWidgetSnippet() {
  if (!widgetInstall.value) return;
  await navigator.clipboard.writeText(widgetInstall.value.snippet);
  widgetInstallMessage.value = "Copied install snippet";
  window.setTimeout(() => (widgetInstallMessage.value = ""), 2600);
}

async function verifyWidgetInstall() {
  if (!widgetInstall.value || widgetVerificationLoading.value) return;
  widgetVerificationLoading.value = true;
  widgetVerificationMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/verify`), { method: "POST", headers: ownerHeaders() });
    const payload = await response.json() as { verified?: boolean; message?: string; verification?: WidgetInstall["verification"]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not verify the widget installation.");
    if (payload.verification) widgetInstall.value.verification = payload.verification;
    widgetVerificationMessage.value = payload.message ?? (payload.verified ? "Widget detected on the website." : "No widget load detected yet.");
  } catch (error) {
    widgetVerificationMessage.value = error instanceof Error ? error.message : "Could not verify the widget installation.";
  } finally {
    widgetVerificationLoading.value = false;
  }
}

async function askQuestion() {
  if (!testQuestion.value.trim() || isAsking.value) return;
  isAsking.value = true;
  testAnswer.value = "";
  answerSource.value = "";
  answerConfidence.value = 0;
  answerConfidenceBand.value = "low";
  answerRetrievalMode.value = "";
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
  try {
    if (!publicDemoMode.value && !conversationId.value) {
      const conversationResponse = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations`), {
        method: "POST",
        headers: { "content-type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ sessionId: `dashboard-${Date.now()}` }),
      });
      const conversationPayload = await conversationResponse.json() as { conversationId?: string };
      if (!conversationResponse.ok || !conversationPayload.conversationId) throw new Error("Could not start a test conversation.");
      conversationId.value = conversationPayload.conversationId;
    }
    const endpoint = publicDemoMode.value
      ? `/api/v1/demo/${demoSlug.value}/public/test`
      : `/api/v1/demo/${demoSlug.value}/conversations/${conversationId.value}/messages`;
    const response = await trackedFetch(apiUrl(endpoint), {
      method: "POST",
      headers: { "content-type": "application/json", ...(publicDemoMode.value ? {} : ownerHeaders()) },
      body: JSON.stringify({ question: testQuestion.value }),
    });
    const payload = await response.json() as { error?: string; answer?: string; grounded?: boolean; confidenceScore?: number; confidenceBand?: "high" | "medium" | "low"; retrieval?: { mode?: string }; citations?: Array<{ title?: string; url?: string; pageType?: string }>; action?: { id: string; key: string; status: "active" | "completed"; captureMode: "conversational" | "form" | "hybrid"; nextField?: string; form?: { submitLabel: string; fields: Array<ActionField & { value?: string }> } } };
    if (!response.ok) throw new Error(payload.error ?? "Could not answer that question.");
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
    answerConfidence.value = payload.confidenceScore ?? 0;
    answerConfidenceBand.value = payload.confidenceBand ?? "low";
    answerRetrievalMode.value = payload.retrieval?.mode ?? "";
    answerCitations.value = payload.citations ?? [];
    answerAction.value = payload.action ?? null;
    answerFormValues.value = Object.fromEntries((payload.action?.form?.fields ?? []).map((field) => [field.key, field.value ?? ""]));
    answerSource.value = payload.citations?.[0]?.url ?? "";
    if (!publicDemoMode.value) await Promise.all([refreshWorkspaceSummary(), refreshAuthenticatedSnapshot()]);
  } catch (error) {
    testAnswer.value = error instanceof Error ? error.message : "Could not answer that question.";
    answerGrounded.value = false;
  } finally {
    isAsking.value = false;
  }
}

async function submitActionForm() {
  if (!answerAction.value?.form || !answerAction.value.id || !conversationId.value || isAsking.value) return;
  isAsking.value = true;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/conversations/" + conversationId.value + "/actions/" + answerAction.value.id + "/submit"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ values: answerFormValues.value }),
    });
    const payload = await response.json() as { error?: string; answer?: string; grounded?: boolean; citations?: Array<{ title?: string; url?: string; pageType?: string }>; action?: NonNullable<typeof answerAction.value> };
    if (!response.ok) throw new Error(payload.error ?? "Could not submit this request.");
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
    answerCitations.value = payload.citations ?? [];
    answerAction.value = payload.action ?? null;
    answerFormValues.value = Object.fromEntries((payload.action?.form?.fields ?? []).map((field) => [field.key, field.value ?? ""]));
    await Promise.all([refreshWorkspaceSummary(), refreshAuthenticatedSnapshot(), loadLeads()]);
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not submit this request.";
  } finally {
    isAsking.value = false;
  }
}

async function runReadinessEvaluation() {
  if (evaluationLoading.value) return;
  evaluationLoading.value = true;
  evaluationError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/evaluation`), {
      method: "POST",
      headers: { "content-type": "application/json", ...(publicDemoMode.value ? {} : ownerHeaders()) },
      body: JSON.stringify({ limit: 10 }),
    });
    const payload = await response.json() as ReadinessEvaluation & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not run the readiness check.");
    readinessEvaluation.value = payload;
  } catch (error) {
    evaluationError.value = error instanceof Error ? error.message : "Could not run the readiness check.";
  } finally {
    evaluationLoading.value = false;
  }
}

async function captureLead() {
  if (!leadEmail.value.trim() && !leadPhone.value.trim()) return;
  leadsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        conversationId: conversationId.value || undefined,
        name: leadName.value,
        email: leadEmail.value,
        phone: leadPhone.value,
        intent: leadIntent.value,
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not capture that lead.");
    leadName.value = "";
    leadEmail.value = "";
    leadPhone.value = "";
    leadIntent.value = "";
    leadSavedMessage.value = "Lead captured · visible in Leads";
    await Promise.all([loadLeads(), refreshWorkspaceSummary(), refreshAuthenticatedSnapshot()]);
    window.setTimeout(() => (leadSavedMessage.value = ""), 2600);
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not capture that lead.";
  }
}

async function saveAgent(...args: Array<AgentSaveModel | Event>) {
  if (!requireAccountForPublish()) return;
  const model = args[0];
  const nextModel = model && !(model instanceof Event) ? model : agentModel.value;
  const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/agent-config`), {
    method: "POST",
    headers: { "content-type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({
      assistantName: nextModel.assistantName,
      welcomeMessage: nextModel.welcomeMessage,
      tone: nextModel.tone,
      primaryLanguage: nextModel.primaryLanguage,
      fallbackBehavior: nextModel.fallbackBehavior,
      humanHandoffEnabled: nextModel.humanHandoffEnabled,
      widgetColor: nextModel.widgetColor,
      collectLeads: nextModel.showLeadCapture,
      showBookingAction: nextModel.showBookingAction,
      widgetDefaultMode: nextModel.widgetDefaultMode,
      widgetAllowExpand: nextModel.widgetAllowExpand,
      widgetLogoUrl: nextModel.widgetLogoUrl || null,
      widgetTheme: nextModel.widgetTheme,
      widgetPosition: nextModel.widgetPosition,
      widgetQuickActions: nextModel.widgetQuickActions,
      proactiveEnabled: proactiveEnabled.value,
      proactiveDelaySeconds: proactiveDelaySeconds.value,
      proactiveMessage: proactiveMessage.value,
      proactiveTriggers: proactiveTriggers.value,
      requireLeadConsent: nextModel.requireLeadConsent,
      privacyNoticeUrl: nextModel.privacyNoticeUrl || null,
      retentionDays: nextModel.retentionDays,
      showAiDisclosure: nextModel.showAiDisclosure,
    }),
  });
  savedMessage.value = response.ok ? "Saved · assistant settings updated" : "Could not save the assistant settings";
  window.setTimeout(() => (savedMessage.value = ""), 2600);
}

function askAgentQuestion(question: string) {
  testQuestion.value = question;
  void askQuestion();
}

function submitAgentAction(values: Record<string, string>) {
  answerFormValues.value = values;
  void submitActionForm();
}

function resetAgentConversation() {
  conversationId.value = "";
  testQuestion.value = "";
  testAnswer.value = "";
  answerGrounded.value = false;
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
}

watch(() => setupDismissalKey.value, hydrateSetupDismissal, { immediate: true });

watch(adminSection, (nextSection, previousSection) => {
  if (nextSection === previousSection || route.value.kind !== "platform" || route.value.section === nextSection) return;
  commitRoute(platformRoute(nextSection));
});

watch(view, (nextView, previousView) => {
  if (nextView === "inbox") { void loadInbox(); void loadNotifications(); }
  if (nextView === "team") { settingsTab.value = "team"; void loadTeam(); }
  if (nextView === "knowledge") {
    void loadKnowledge();
    void loadDocuments();
  }
  if (nextView === "agent") { void loadWidgetInstall(); }
  if (nextView === "leads") void loadLeads();
  if (nextView === "actions") {
    if (previousView !== "actions") selectAction(null);
    void loadActions();
    void loadIntegrations();
  }
  if (nextView === "connections") { settingsTab.value = "integrations"; void loadMcpConnections(); }
  if (nextView === "billing") { settingsTab.value = "billing"; void loadBilling(); }
  if (nextView === "settings" && settingsTab.value === "notifications") { void loadNotifications(); void loadNotificationPreferences(); }
  if (nextView === "settings" && !["general", "verification", "notifications"].includes(settingsTab.value)) settingsTab.value = "general";
  if (nextView === "admin") {
    void loadAdminOrganizations();
    void loadAdminUsers();
    void loadAdminDemoRequests();
    void loadAdminInstallationSupport();
    void loadAdminMessaging();
    void loadAdminHealth();
  }
});

watch(settingsTab, (nextTab) => {
  if (nextTab === "notifications") {
    void loadNotifications();
    void loadNotificationPreferences();
  }
});

function updateDocumentMetadata() {
  if (typeof document === "undefined") return;
  const landing = view.value === "home";
  const legal = view.value === "privacy" || view.value === "terms";
  const marketingPage = route.value.kind === "marketing" ? getMarketingPageByPath(`/${route.value.page}`) : undefined;
  const description = marketingPage?.description ?? "FrontDeskWise turns a local business website into an AI front desk that answers questions, captures leads, and moves visitors toward booking.";
  document.title = landing ? "FrontDeskWise — AI front desk for local businesses" : marketingPage ? `${marketingPage.title} · FrontDeskWise` : `${pageTitle.value} · FrontDeskWise`;
  const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (robots) robots.content = landing || legal || Boolean(marketingPage) ? "index,follow" : "noindex,nofollow";
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical && typeof window !== "undefined") {
    const siteOrigin = String(import.meta.env.VITE_SITE_ORIGIN ?? window.location.origin).replace(/\/$/, "");
    canonical.href = `${siteOrigin}${landing || legal || marketingPage ? window.location.pathname : "/"}`;
  }
  const descriptionMeta = document.head.querySelector<HTMLMetaElement>('meta[name="description"]');
  if (descriptionMeta) descriptionMeta.content = description;
  for (const selector of ['meta[property="og:title"]', 'meta[name="twitter:title"]']) {
    const meta = document.head.querySelector<HTMLMetaElement>(selector);
    if (meta) meta.content = document.title;
  }
  for (const selector of ['meta[property="og:description"]', 'meta[name="twitter:description"]']) {
    const meta = document.head.querySelector<HTMLMetaElement>(selector);
    if (meta) meta.content = description;
  }
  const ogUrl = document.head.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  if (ogUrl && typeof window !== "undefined") ogUrl.content = `${String(import.meta.env.VITE_SITE_ORIGIN ?? window.location.origin).replace(/\/$/, "")}${window.location.pathname}`;
}

watch(view, updateDocumentMetadata);
onMounted(() => {
  void runWithGlobalLoading(() => applyRouteState(route.value));
  updateDocumentMetadata();
  void consumeDemoLink();
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", handleRouteChange);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      landingHeroTimer = window.setInterval(() => {
        if (view.value === "home") heroDemoStep.value = (heroDemoStep.value + 1) % landingDemoSteps.length;
      }, 4200);
    }
    if (!firebaseAuthConfigured()) {
      if (isPlatformRoute()) openAuth("signin");
    } else {
      stopFirebaseObserver = observeFirebaseUser((user) => {
        void runWithGlobalLoading(() => restoreAuthenticatedSession(user));
      });
    }
  }
});

onBeforeUnmount(() => {
  stopFirebaseObserver?.();
  stopGenerationProgress();
  if (landingHeroTimer !== null) window.clearInterval(landingHeroTimer);
  if (typeof window !== "undefined") window.removeEventListener("popstate", handleRouteChange);
});

function openHome() {
  commitRoute({ kind: "landing" });
}

function startMarketingDemo() {
  commitRoute({ kind: "landing" });
  window.setTimeout(() => document.getElementById("final-cta")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
}
</script>

<template>
  <main class="app-shell" :aria-busy="globalLoading || authLoading">
    <section v-if="routeIsNotFound" class="not-found-shell">
      <div class="not-found-card"><p class="eyebrow">404</p><h1>That page is not available.</h1><p>Check the address or return to FrontDeskWise.</p><button class="primary-button" type="button" @click="openHome">Back to home</button></div>
    </section>
    <MarketingPage v-else-if="route.kind === 'marketing'" :page-path="`/${route.page}`" @start-demo="startMarketingDemo" />
    <section v-else-if="view === 'home'" class="marketing-shell landing-page">
      <header class="marketing-nav landing-nav">
        <button class="brand-mark" type="button" @click="openHome">
          <img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" />
          <span>FrontDesk<span>Wise</span></span>
        </button>
        <nav class="landing-nav-links" aria-label="Main navigation">
          <button class="text-button" type="button" @click="scrollLandingTo('how-it-works')">How it works</button>
          <a class="text-button" href="/features">Features</a>
          <a class="text-button" href="/industries">Industries</a>
          <a class="text-button" href="/resources">Resources</a>
          <a class="text-button" href="/pricing">Pricing</a>
        </nav>
        <div class="nav-actions">
          <button class="dark-button small" type="button" @click="openAuth('signin')">Sign in</button>
        </div>
      </header>

      <div class="landing-hero">
        <div class="landing-hero-copy">
          <div class="eyebrow"><span class="pulse-dot"></span> AI front desk for local businesses</div>
          <h1>Turn your website into your best front desk.</h1>
          <p class="landing-hero-subtitle"><strong>Answer every visitor. Capture every opportunity. Move more people toward booking — 24/7.</strong></p>
          <p class="landing-hero-body">Paste your website. FrontDeskWise learns your services, pricing, policies, and locations and builds an AI front desk in minutes.</p>
          <div class="url-form landing-url-form">
            <input v-model="websiteUrl" type="url" placeholder="https://yourbusiness.com" aria-label="Business website URL" @keyup.enter="generateDemo" />
            <button class="primary-button" type="button" :disabled="isGenerating" @click="generateDemo">
              {{ isGenerating ? "Building demo…" : "Generate my AI front desk" }} <span aria-hidden="true">→</span>
            </button>
          </div>
          <div class="demo-requester-fields landing-requester-fields">
            <input v-model="demoRequesterName" type="text" placeholder="Your name (optional)" aria-label="Your name" />
            <input v-model="demoRequesterEmail" type="email" placeholder="Work email (optional)" aria-label="Work email" />
            <span>We’ll log the request and can send a fresh demo link later.</span>
          </div>
          <p v-if="generationError && !generationDialogOpen" class="form-error">{{ generationError }}</p>
          <div class="trust-row landing-trust-row"><span>✓ No credit card</span><span>✓ Built from your website</span><span>✓ Ready in minutes</span></div>
        </div>

        <div class="landing-hero-visual" aria-label="FrontDeskWise customer conversation flow">
          <div class="landing-hero-signal landing-hero-signal-top"><span class="landing-signal-dot"></span><strong>Agent is working</strong><small>Answering, qualifying, and routing</small></div>
          <div class="landing-hero-signal landing-hero-signal-bottom"><strong>61</strong><span>illustrative leads captured</span></div>
          <div class="landing-browser">
            <div class="landing-browser-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span class="landing-browser-url">yourbusiness.com · sample workspace</span></div>
            <LandingVideo
              src="/video/frameflow-1795188921494.mp4"
              poster="/video/hero-poster.jpg"
              ariaLabel="FrontDeskWise answers a website visitor, qualifies the request, and captures the next step"
              description="A product demonstration showing a visitor question becoming an AI answer, qualification, and captured lead."
            />
          </div>
        </div>
      </div>

      <div class="landing-hero-note"><span>Illustrative sample flow</span><span>Answer grounded in approved knowledge</span><span>Use your own website to build a real workspace</span><button class="landing-text-link" type="button" @click="scrollLandingTo('how-it-works')">See the flow</button></div>

      <section class="landing-section landing-capabilities-section">
        <div class="landing-section-heading"><p class="eyebrow">What FrontDeskWise does</p><h2>Built for answers, actions, and human judgment.</h2><p>One AI front desk helps visitors get useful answers, take the next step, and reach your team when the moment calls for it.</p></div>
        <div class="landing-capability-grid"><article v-for="capability in landingCapabilities" :key="capability.title" class="landing-capability-card"><span :class="['landing-capability-icon', capability.tone]">{{ capability.icon }}</span><h3>{{ capability.title }}</h3><p>{{ capability.body }}</p></article></div>
      </section>

      <section id="how-it-works" class="landing-section landing-conversion-section">
        <div class="landing-section-heading landing-section-heading-centered"><p class="eyebrow">The commercial story</p><h2>See the conversation turn into a next step.</h2><p>FrontDeskWise connects the moment a visitor asks a question to the outcome your business needs.</p></div>
        <div class="landing-flow-shell" aria-label="Illustrative customer conversion flow">
          <div class="landing-flow-rail"><span class="landing-flow-progress"></span><article v-for="(step, index) in landingFlowSteps" :key="step.label" class="landing-flow-step"><span class="landing-flow-index">0{{ index + 1 }}</span><strong>{{ step.label }}</strong><small>{{ step.title }}</small><p>{{ step.body }}</p></article></div>
          <div class="landing-flow-live-card"><span class="landing-flow-live-label"><i></i> Live illustrative flow</span><strong>Visitor intent stays attached to the conversation.</strong><div class="landing-flow-live-path"><span>Question</span><b>→</b><span>Answer</span><b>→</b><span>Action</span><b>→</b><span>Outcome</span></div><small>Every step can be reviewed, tested, and improved before it reaches customers.</small></div>
        </div>
      </section>

      <section id="industries" class="landing-section landing-industries-section">
        <div class="landing-section-heading landing-section-heading-row"><div><p class="eyebrow">Works where you work</p><h2>Show customers what happens next.</h2></div></div>
        <div class="landing-industry-grid">
          <article v-for="industry in landingIndustries" :key="industry.name" class="landing-industry-card">
            <div class="landing-industry-top"><span class="landing-industry-icon">{{ industry.icon }}</span><span class="landing-industry-tag">{{ industry.name }}</span></div>
            <p class="landing-industry-question">“{{ industry.question }}”</p>
            <div class="landing-industry-flow"><span v-for="(step, index) in industry.steps" :key="step"><b>{{ index + 1 }}</b>{{ step }}</span></div>
            <button class="landing-text-link" type="button" @click="websiteUrl = ''; scrollLandingTo('final-cta')">Build this workflow</button>
          </article>
        </div>
      </section>

      <section class="landing-section landing-setup-section">
        <div class="landing-section-heading landing-section-heading-row"><div><p class="eyebrow">From website to working agent</p><h2>Built from your website. Ready for your review.</h2></div></div>
        <div class="landing-setup-grid"><div class="landing-setup-steps"><article><span>01</span><div><h3>Paste your URL</h3><p><code>yourbusiness.com</code></p></div></article><article><span>02</span><div><h3>FrontDeskWise learns your business</h3><p>Services, pricing, locations, and policies are organized for review.</p></div></article><article><span>03</span><div><h3>Review and test</h3><p>Ask real questions before anything goes live.</p></div></article><article><span>04</span><div><h3>Add it to your website</h3><p>Install the widget and start capturing the next opportunity.</p></div></article></div><LandingVideo src="/video/frameflow-1795189292121.mp4" poster="/video/onboarding-poster.jpg" lazy ariaLabel="FrontDeskWise turns a website URL into a reviewed, ready-to-install AI front desk" description="A product demonstration showing website learning, business knowledge readiness, testing, and installation." /></div>
      </section>

      <section class="landing-section landing-handoff-section"><div class="landing-handoff-card"><LandingVideo src="/video/frameflow-1795189415791.mp4" poster="/video/handoff-poster.jpg" lazy ariaLabel="FrontDeskWise hands a customer conversation to a staff member with context preserved" description="A product demonstration showing AI recognizing a human need, bringing in staff, and preserving the conversation context." /><div class="landing-handoff-copy"><p class="eyebrow">AI + your team</p><h2>AI when it can help. Your team when it matters.</h2><p>FrontDeskWise handles routine questions automatically and brings your team into the conversation when a human touch is needed — with the full context already attached.</p><button class="landing-text-link" type="button" @click="openAuth('signup')">Start with a safer front desk</button></div></div></section>

      <section class="landing-section landing-integrations-section">
        <div class="landing-integrations-layout">
          <div class="landing-integrations-copy">
            <p class="eyebrow">Fits your existing workflow</p>
            <h2>Your AI front desk connects the conversation to the tools that run your business.</h2>
            <p>FrontDeskWise captures the customer context first, then sends the right information to your CRM, booking tools, automations, email, or custom systems.</p>
            <a class="primary-button landing-integrations-cta" href="/integrations">Explore integrations</a>
          </div>
          <div class="landing-integration-map" aria-label="FrontDeskWise routes customer context into business tools">
            <div class="landing-integration-visitor"><span class="landing-integration-visitor-icon" aria-hidden="true">○</span><span><strong>Website visitor</strong><b>“I’d like to book a consultation.”</b></span></div>
            <span class="landing-integration-arrow" aria-hidden="true">↓</span>
            <div class="landing-integration-core"><div class="landing-integration-brand"><span aria-hidden="true">✦</span> FrontDesk<span>Wise</span></div><strong>Answer <i>→</i> Qualify <i>→</i> Act</strong><span class="landing-integration-context">✓ Customer context ready</span></div>
            <div class="landing-integration-branch" aria-hidden="true"></div>
            <div class="landing-integration-card-grid">
              <article v-for="integration in landingIntegrations" :key="integration.name" class="landing-integration-card">
                <span :class="['landing-integration-icon', integration.tone]" aria-hidden="true">{{ integration.icon }}</span>
                <strong>{{ integration.name }}</strong>
                <small>{{ integration.kind }}</small>
                <span class="landing-integration-outcome">✓ {{ integration.outcome }}</span>
              </article>
            </div>
            <div class="landing-integration-trust"><span>◉ <b>Lead saved first</b></span><span>↻ <b>Retries on delivery failure</b></span><span>♢ <b>Your systems stay in control</b></span></div>
          </div>
        </div>
      </section>

      <section class="landing-section landing-dashboard-section">
        <div class="landing-dashboard-copy"><p class="eyebrow">A clearer owner view</p><h2>Know what your AI front desk is doing for the business.</h2><p>See conversations, leads, booking actions, handoffs, and the questions worth adding to your knowledge base.</p><span class="landing-illustrative-note">Illustrative sample workspace · not customer data</span><button class="outline-button" type="button" @click="openAuth('signup')">Create your workspace</button></div>
        <div class="landing-dashboard-card">
          <div class="landing-dashboard-header"><div><span class="landing-dashboard-kicker">OWNER DASHBOARD · ILLUSTRATIVE SAMPLE</span><h3>Today</h3></div><span class="landing-live-pill"><i></i> Live view</span></div>
          <div class="landing-dashboard-metrics"><div v-for="metric in landingSampleMetrics.slice(0, 4)" :key="metric.label"><strong>{{ metric.value }}</strong><span>{{ metric.label }}</span><small>{{ metric.trend }}</small></div></div>
          <div class="landing-dashboard-bottom"><div class="landing-mini-chart"><div class="landing-mini-chart-head"><strong>Conversation activity</strong><span>Illustrative last 7 days</span></div><div class="landing-bars"><i v-for="(height, index) in [32, 48, 41, 67, 54, 79, 88]" :key="index" :style="{ height: `${height}%` }"></i></div><div class="landing-chart-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div><div class="landing-opportunity"><span class="landing-opportunity-label">TOP OPPORTUNITY</span><strong>17 visitors asked about weekend availability.</strong><p>Add weekend hours to your knowledge and turn a repeated question into a better answer.</p><span class="landing-opportunity-action">Knowledge gap</span></div></div>
        </div>
      </section>

      <section class="landing-multi-business"><div><p class="eyebrow">One login. Multiple businesses.</p><h2>Grow your portfolio without adding another tool to manage.</h2><p>Keep businesses, teams, actions, and analytics organized in one shared operating layer.</p></div><div class="landing-portfolio-card"><div><span class="landing-portfolio-avatar blue">H</span><strong>Harbor &amp; Home</strong><small>Connected workspace · shared team</small></div><div><span class="landing-portfolio-avatar orange">N</span><strong>Northstar Studio</strong><small>Connected workspace · shared team</small></div><div><span class="landing-portfolio-avatar green">C</span><strong>ClearAir Services</strong><small>Connected workspace · shared team</small></div></div></section>

      <section class="landing-section landing-proof-section"><div class="landing-proof-card"><div><p class="eyebrow">Proof that compounds</p><h2>Make the numbers that matter visible.</h2><p>FrontDeskWise is built to show the conversations handled, leads captured, actions completed, and questions your team should improve next.</p><span class="landing-illustrative-note">The figures below show the kind of operating view owners get once their own workspace is live.</span></div><div class="landing-proof-stats"><span v-for="metric in landingSampleMetrics.slice(0, 3)" :key="metric.label"><strong>{{ metric.value }}</strong><small>{{ metric.label }}</small></span></div></div></section>

      <section id="pricing" class="marketing-pricing landing-pricing"><div class="pricing-heading"><div><p class="eyebrow">Simple organization pricing</p><h2>Start with one business. Grow without another login.</h2></div><p>Every plan includes grounded answers, lead capture, and a shared path to booking. Start with a trial — no card required.</p></div><div class="pricing-grid"><article v-for="plan in landingPlans" :key="plan.key" :class="['pricing-card landing-pricing-card', { featured: plan.featured }]" tabindex="0"><span v-if="plan.badge" class="pricing-badge">{{ plan.badge }}</span><h3>{{ plan.name }}</h3><p>{{ plan.description }}</p><strong class="pricing-price">{{ plan.price }}<small>/month</small></strong><span class="pricing-businesses">{{ plan.businesses }}</span><ul class="landing-plan-bullets"><li v-for="bullet in plan.bullets" :key="bullet">✓ {{ bullet }}</li></ul><button class="primary-button small" type="button" @click="openAuth('signup')">Start free trial →</button></article></div></section>

      <section class="landing-section landing-faq-section"><div class="landing-section-heading landing-section-heading-centered"><p class="eyebrow">Questions owners ask</p><h2>A front desk that is easy to understand.</h2><p>Clear answers before you hand over your website, your customers, or your team’s time.</p></div><div class="landing-faq-list"> <details v-for="(faq, index) in landingFaqs" :key="faq.question" :open="index === 0"><summary>{{ faq.question }}</summary><p>{{ faq.answer }}</p></details></div></section>

      <section id="final-cta" class="landing-final-cta"><div><p class="eyebrow">See your own version</p><h2>See what FrontDeskWise can build from your website.</h2><p>Your next customer may already be on the page. Give them a useful next step.</p></div><div class="url-form landing-final-form"><input v-model="websiteUrl" type="url" placeholder="https://yourbusiness.com" aria-label="Business website URL" @keyup.enter="generateDemo" /><button class="primary-button" type="button" :disabled="isGenerating" @click="generateDemo">{{ isGenerating ? "Building…" : "Generate my AI front desk" }} <span aria-hidden="true">→</span></button></div></section>

      <footer class="marketing-footer landing-footer"><div><strong>FrontDeskWise</strong><span>FrontDeskWise is a product of Sudo Programmer, Inc.</span></div><nav aria-label="Footer navigation"><a href="/features">Features</a><a href="/industries">Industries</a><a href="/use-cases">Use cases</a><a href="/integrations">Integrations</a><a href="/resources">Resources</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:hello@frontdeskwise.com">Contact</a></nav><small>© 2026 Sudo Programmer, Inc. · FrontDeskWise. Built for clearer customer conversations.</small></footer>
    </section>

    <section v-else-if="view === 'privacy' || view === 'terms'" class="legal-shell">
      <LegalPage :kind="view === 'privacy' ? 'privacy' : 'terms'" />
    </section>

    <section v-else :class="['product-shell', { 'admin-only-mode': adminSurfaceMode }]">
      <aside class="sidebar">
        <button class="sidebar-brand" type="button" @click="openHome"><img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></button>
        <div v-if="adminSurfaceMode" class="admin-identity-card"><span class="admin-identity-mark">SP</span><span><strong>Operations</strong><small>Super-admin access</small></span><span class="admin-identity-check">✓</span></div>
        <div v-else class="workspace-switcher"><span class="workspace-avatar">{{ businessInitial }}</span><span v-if="availableBusinesses.length" class="workspace-select-wrap"><select v-model="workspaceSelection" aria-label="Switch business"><option v-if="availableBusinesses.length > 1" value="__all__">All businesses</option><option v-for="business in availableBusinesses" :key="business.id" :value="business.slug">{{ business.name }}</option></select><small>{{ activeOrganization?.name ?? 'Organization' }}</small></span><span v-else><strong>{{ businessName || (authSnapshot ? 'No business yet' : 'Demo workspace') }}</strong><small>{{ businessLocation || (authSnapshot ? 'Add your first business' : 'Preview data from the API') }}</small></span><button v-if="authSnapshot" class="workspace-add" type="button" aria-label="Add business" @click="openAddBusiness">+</button><span class="chevron">⌄</span></div>
        <nav v-if="adminSurfaceMode" class="sidebar-nav admin-sidebar-nav" aria-label="Super-admin navigation">
          <button v-for="item in adminNavItems" :key="item.id" type="button" :class="['nav-item', { active: view === 'admin' && adminSection === item.id }]" @click="adminSection = item.id; view = 'admin'"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span></button>
        </nav>
        <nav v-else class="sidebar-nav" aria-label="Workspace navigation">
          <div v-for="section in navSections" :key="section.label || 'overview'" class="nav-section">
            <p v-if="section.label" class="nav-section-label">{{ section.label }}</p>
            <button v-for="item in section.items" :key="item.id" type="button" :disabled="publicDemoMode && item.id !== 'overview'" :class="['nav-item', { active: view === item.id }]" @click="navigateToWorkspaceView(item.id)"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><b v-if="item.id === 'inbox' && inboxUnreadCount">{{ inboxUnreadCount }}</b></button>
          </div>
          <button v-if="isSuperAdmin" type="button" :class="['nav-item', { active: view === 'admin' }]" @click="navigateToAdmin"><span class="nav-icon">⚙</span><span>Admin control plane</span></button>
        </nav>
        <div v-if="adminSurfaceMode" class="sidebar-bottom"><div class="admin-sidebar-note"><strong>Operations access</strong><small>Manage platform health, organizations, users, and demos from one place.</small></div><button v-if="!adminOnlyMode" class="sidebar-link" type="button" @click="view = 'overview'">← Back to workspace</button><button class="sidebar-link" type="button" @click="signOut">Sign out</button></div>
        <div v-else class="sidebar-bottom"><div v-if="showSetupCard" class="setup-card"><template v-if="setupComplete"><div class="setup-row"><strong>Your AI front desk is ready ✓</strong><button class="sidebar-setup-dismiss" type="button" @click="dismissSetup">Dismiss</button></div><small>Everything is ready to test, publish, and install.</small></template><template v-else><div class="setup-row"><span>Setup progress</span><strong>{{ setupPercent }}%</strong></div><div class="progress-bar"><span :style="{ width: String(setupPercent) + '%' }"></span></div><small>{{ workspaceStats?.setup.completed ?? 0 }} of {{ workspaceStats?.setup.total ?? 4 }} steps complete · {{ setupNextAction }}</small><button class="sidebar-setup-action" type="button" @click="continueSetup">Continue setup</button></template></div><button v-if="workspaceAttention" class="sidebar-attention" type="button" @click="openWorkspaceAttention"><span>!</span><span><strong>Needs attention</strong><small>{{ workspaceAttention.label }}</small></span></button><div class="sidebar-account"><button class="sidebar-account-trigger" type="button" :aria-expanded="sidebarAccountMenuOpen" @click="sidebarAccountMenuOpen = !sidebarAccountMenuOpen; profileMenuOpen = false; notificationMenuOpen = false"><span class="sidebar-account-avatar">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : businessInitial }}</span><span class="sidebar-account-copy"><strong>{{ authSnapshot?.user.name ?? (businessName || 'Demo workspace') }}</strong><small>{{ activeOrganization?.billing.plan.displayName ?? 'Workspace' }} plan</small></span><span class="sidebar-account-chevron">⌄</span></button><div v-if="sidebarAccountMenuOpen" class="sidebar-account-menu"><button type="button" @click="openSettingsTab('general')">Account & settings</button><button type="button" @click="openSettingsTab('billing')">Billing</button><button type="button" @click="openHelpAndSupport">Help &amp; Support</button><button v-if="authSnapshot" type="button" @click="notificationMenuOpen = true; sidebarAccountMenuOpen = false">Notifications</button><button v-if="authSnapshot" type="button" class="danger-text" @click="sidebarAccountMenuOpen = false; signOut()">Sign out</button><button v-else type="button" @click="sidebarAccountMenuOpen = false; openAuth('signin')">Sign in</button></div></div></div>
      </aside>

      <section class="content-area">
        <header class="content-header"><div><p class="breadcrumb">{{ view === 'admin' ? 'Operations / FrontDeskWise' : `${showAllBusinesses ? 'All businesses' : (businessName || 'Workspace')} / FrontDeskWise` }}</p><h1>{{ view === 'admin' ? adminSectionTitle : pageTitle }}</h1></div><div class="header-actions"><button v-if="authSnapshot" class="notification-trigger" type="button" aria-label="Open notifications" :aria-expanded="notificationMenuOpen" @click="toggleNotifications"><svg class="notification-bell" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" /></svg><span v-if="notificationUnreadCount" class="notification-badge">{{ notificationUnreadCount > 9 ? '9+' : notificationUnreadCount }}</span></button><button v-if="authSnapshot" class="profile-avatar profile-menu-trigger" type="button" aria-label="Open account menu" :aria-expanded="profileMenuOpen" @click="profileMenuOpen = !profileMenuOpen; notificationMenuOpen = false">{{ authSnapshot.user.name.charAt(0).toUpperCase() }}</button><span v-else class="profile-avatar">SP</span></div><div v-if="notificationMenuOpen && authSnapshot" class="notification-menu"><div class="panel-heading"><strong>Notifications</strong><button class="text-button" type="button" @click="loadNotifications">Refresh</button></div><div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div><button v-for="notification in staffNotifications" :key="notification.id" class="notification-row" type="button" @click="markNotificationRead(notification); view = 'inbox'; notificationMenuOpen = false"><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></button></div><div v-if="profileMenuOpen && authSnapshot" class="profile-menu"><strong>{{ authSnapshot.user.name }}</strong><small>{{ authSnapshot.user.email }}</small><button type="button" @click="openSettingsTab('general')">Account settings</button><button type="button" @click="openSettingsTab('billing')">Billing</button><button type="button" @click="toggleNotifications">Notifications</button><button type="button" class="danger-text" @click="profileMenuOpen = false; signOut()">Sign out</button></div></header>
        <div v-if="!adminSurfaceMode && publicDemoMode" class="trial-banner info"><span><strong>Public sample workspace</strong><small>This view is live demo data in read-only mode. Generate your own demo or create an account to customize, install, and capture leads.</small></span><button class="primary-button small" type="button" @click="openAuth('signup')">Create your workspace →</button></div>
        <div v-else-if="!adminSurfaceMode && billingSnapshot?.billing.status === 'trial' && billingSnapshot.billing.mode !== 'sandbox'" class="trial-banner compact"><span><strong>{{ trialDaysRemaining }} {{ trialDaysRemaining === 1 ? 'day' : 'days' }} left in your trial</strong><small>· Upgrade to keep your workspace active</small></span><button class="primary-button small" type="button" @click="openSettingsTab('billing')">Upgrade →</button></div>
        <div v-else-if="!adminSurfaceMode && billingReadOnly" class="trial-banner danger compact"><span><strong>Your workspace is read-only</strong><small>· Restore billing to resume publishing</small></span><button class="primary-button small" type="button" @click="openSettingsTab('billing')">Restore billing →</button></div>

        <div v-if="!adminSurfaceMode && settingsSurface" class="settings-tabs" role="tablist" aria-label="Settings sections">
          <button v-for="tab in settingsTabs" :key="tab.id" type="button" role="tab" :aria-selected="currentSettingsTab === tab.id" :class="['settings-tab', { active: currentSettingsTab === tab.id }]" @click="openSettingsTab(tab.id)">{{ tab.label }}</button>
        </div>

        <div v-if="!adminSurfaceMode && view === 'agent'" class="agent-tabs" role="tablist" aria-label="Agent sections">
          <button v-for="tab in agentTabs" :key="tab.id" type="button" role="tab" :aria-selected="agentTab === tab.id" :class="['agent-tab', { active: agentTab === tab.id }]" @click="selectAgentTab(tab.id)">{{ tab.label }}</button>
        </div>

        <div v-if="view === 'agent'" class="view-content agent-view-content">
          <AgentExperience
            :tab="agentTab"
            :business-key="demoSlug"
            :business-name="businessName"
            :website-url="websiteUrl"
            :model="agentModel"
            :saved-message="savedMessage"
            :auth-ready="Boolean(authSnapshot)"
            :auth-user-name="authSnapshot?.user.name ?? ''"
            :auth-user-email="authSnapshot?.user.email ?? ''"
            :public-demo-mode="publicDemoMode"
            :billing-read-only="billingReadOnly"
            :ownership-status="ownershipVerification?.status ?? null"
            :install="widgetInstall"
            :install-message="widgetInstallMessage"
            :verification-message="widgetVerificationMessage"
            :verification-loading="widgetVerificationLoading"
            :verification-method="verificationMethod"
            :verification-instructions="verificationInstructions"
            :verification-token="verificationToken"
            :ownership-message="verificationMessage"
            :ownership-error="verificationError"
            :installation-support-loading="installationSupportOwnerLoading"
            :installation-support-message="installationSupportOwnerMessage"
            :installation-support-error="installationSupportOwnerError"
            :open-support-request="openSupportRequest"
            :test="agentTestModel"
            @select-tab="selectAgentTab"
            @save="saveAgent"
            @require-auth="openAuth('signup')"
            @copy-snippet="copyWidgetSnippet"
            @verify-install="verifyWidgetInstall"
            @refresh-install="loadWidgetInstall"
            @start-verification="startAgentVerification"
            @check-verification="checkOwnershipVerification"
            @ask-question="askAgentQuestion"
            @submit-action="submitAgentAction"
            @reset-conversation="resetAgentConversation"
            @view-leads="view = 'leads'"
            @request-install-help="requestInstallationHelp"
            @clear-install-help-message="clearInstallationSupportOwnerState"
          />
        </div>

        <div v-if="view === 'overview'" class="view-content">
          <div v-if="workspaceError" class="panel workspace-message"><strong>Workspace data unavailable</strong><p>{{ workspaceError }}</p><button class="outline-button small" type="button" @click="loadBusinessWorkspace(demoSlug)">Retry</button></div>
          <div v-else-if="authSnapshot && !availableBusinesses.length" class="panel workspace-message"><strong>Your organization is ready</strong><p>Add your first business to crawl its website, create the agent, and start collecting real conversations and leads.</p><button class="primary-button small" type="button" @click="openAddBusiness">+ Add your first business</button></div>
          <template v-else>
            <div class="metric-grid">
              <article class="metric-card blue-tint"><span class="metric-icon blue">♧</span><strong>{{ workspaceStats?.leads ?? 0 }}</strong><span>Leads captured</span><em>{{ workspaceStats?.leads ? 'Live records' : 'No leads yet' }}</em></article>
              <article class="metric-card green-tint"><span class="metric-icon green">▣</span><strong>{{ workspaceStats?.bookingClicks ?? 0 }}</strong><span>Booking clicks</span><em>{{ workspaceStats?.conversations ?? 0 }} conversations</em></article>
              <article class="metric-card orange-tint"><span class="metric-icon orange">?</span><strong>{{ workspaceStats?.unansweredQuestions ?? 0 }}</strong><span>Open answer gaps</span><em class="negative">From live questions</em></article>
              <article class="metric-card purple-tint"><span class="metric-icon purple">▱</span><strong>{{ readinessScore }}%</strong><span>Knowledge readiness</span><div class="metric-progress"><span :style="{ width: `${readinessScore}%` }"></span></div></article>
            </div>
            <div class="dashboard-grid">
              <article class="panel chart-panel"><div class="panel-heading"><div><h2>Conversations & leads</h2><p>Last 30 days · live records</p></div><div class="legend"><span><i class="blue-dot"></i> Conversations</span><span><i class="orange-dot"></i> Leads</span></div></div><div v-if="workspaceStats?.trend?.length" class="live-chart" aria-label="Conversations and leads trend"><div v-for="point in workspaceStats.trend" :key="point.label" class="live-chart-column"><div class="live-chart-bars"><span class="live-bar blue" :style="{ height: `${point.conversations / chartMax * 100}%` }"></span><span class="live-bar orange" :style="{ height: `${point.leads / chartMax * 100}%` }"></span></div><small>{{ point.label }}</small></div></div><div v-else class="diagnostics-empty">No activity recorded yet.</div></article>
              <article class="panel readiness-panel"><div class="panel-heading"><div><h2>Knowledge readiness</h2><p>Calculated from indexed sources and open gaps</p></div><strong class="readiness-score">{{ readinessScore }}%</strong></div><div class="readiness-ring" :style="{ background: `conic-gradient(#7256c9 0deg ${readinessScore * 3.6}deg, #edf0f6 ${readinessScore * 3.6}deg 360deg)` }"><div><strong>{{ readinessScore }}</strong><span>/100</span></div></div><div class="readiness-list"><div><span class="check">✓</span> Sources indexed <strong>{{ workspaceKnowledge?.sourceCount ?? 0 }}</strong></div><div><span class="check">✓</span> Knowledge chunks <strong>{{ workspaceKnowledge?.chunkCount ?? 0 }}</strong></div><div><span :class="workspaceStats?.unansweredQuestions ? 'warning' : 'check'">{{ workspaceStats?.unansweredQuestions ? '!' : '✓' }}</span> Open answer gaps <strong>{{ workspaceStats?.unansweredQuestions ?? 0 }}</strong></div><div><span class="check">✓</span> Widget loads <strong>{{ workspaceStats?.widgetLoads ?? 0 }}</strong></div></div></article>
            </div>
            <article class="panel evaluation-panel">
              <div class="panel-heading">
                <div><p class="eyebrow">Proof, not vibes</p><h2>AI readiness check</h2><p>Run ten representative questions before you share this workspace. Grounded answers need citations; unsupported questions must safely fall back.</p></div>
                <div class="evaluation-actions"><button class="outline-button small" type="button" @click="view = 'conversations'">Test assistant</button><button class="primary-button small" type="button" :disabled="evaluationLoading" @click="runReadinessEvaluation">{{ evaluationLoading ? 'Testing…' : readinessEvaluation ? 'Run again' : 'Run 10-question check' }}</button></div>
              </div>
              <p v-if="evaluationError" class="form-error">{{ evaluationError }}</p>
              <div v-if="readinessEvaluation" class="evaluation-summary">
                <div class="evaluation-score"><strong>{{ readinessEvaluation.score }}%</strong><span>{{ readinessEvaluation.passed }}/{{ readinessEvaluation.total }} passed</span></div>
                <div class="evaluation-metrics"><span><strong>{{ readinessEvaluation.groundedWithCitations }}/{{ readinessEvaluation.groundedQuestions }}</strong><small>grounded with citations</small></span><span><strong>{{ readinessEvaluation.fallbackPassed }}/{{ readinessEvaluation.fallbackQuestions }}</strong><small>safe fallbacks</small></span><span><strong>{{ readinessEvaluation.openGaps }}</strong><small>open knowledge gaps</small></span><span><strong>{{ readinessEvaluation.averageLatencyMs }}ms</strong><small>average response</small></span></div>
              </div>
              <div v-if="readinessEvaluation" class="evaluation-cases"><div v-for="evaluationCase in readinessEvaluation.cases" :key="evaluationCase.question" class="evaluation-case"><span :class="['answer-badge', evaluationCase.passed ? 'grounded' : 'fallback']">{{ evaluationCase.passed ? '✓ Pass' : '! Review' }}</span><div><strong>{{ evaluationCase.question }}</strong><small>{{ evaluationCase.expectation === 'grounded' ? `${evaluationCase.citationCount} citation${evaluationCase.citationCount === 1 ? '' : 's'} · ${Math.round(evaluationCase.confidenceScore * 100)}% confidence` : 'Expected safe fallback' }}</small></div><span class="evaluation-latency">{{ evaluationCase.latencyMs }}ms</span></div></div>
              <div v-else class="evaluation-empty"><span class="empty-icon">✓</span><div><strong>Know whether the assistant is ready to sell.</strong><p>This check uses the business’s indexed content, measures citations and fallback behavior, and shows what needs review.</p></div></div>
            </article>
            <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>What visitors are asking</p></div><button class="text-button" type="button" @click="view = 'conversations'">See all →</button></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Recommended actions</h2><p>Open gaps from live conversations</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Add answer</button></div></div><div v-else class="diagnostics-empty">No open actions. New low-confidence questions will appear here.</div></article></div>
          </template>
        </div>

        <div v-else-if="view === 'inbox'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Customer conversations</p><h2>Inbox</h2><p>Review conversations that need your team and keep the AI in the loop.</p></div><div class="toolbar-actions"><span v-if="inboxMessage" class="saved-message">✓ {{ inboxMessage }}</span><button class="outline-button small" type="button" :disabled="inboxLoading" @click="loadInbox">{{ inboxLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
          <p v-if="inboxError" class="form-error">{{ inboxError }}</p>
          <div class="panel lead-filters"><label>Status<select v-model="inboxStatusFilter" @change="loadInbox"><option value="all">All conversations</option><option value="WAITING_FOR_STAFF">Waiting for staff</option><option value="HUMAN_ACTIVE">Human active</option><option value="AI_ASSISTED">AI assisted</option><option value="AI_ACTIVE">AI active</option><option value="RESOLVED">Resolved</option></select></label><label>Assignment<select v-model="inboxAssignmentFilter" @change="loadInbox"><option value="all">All assignments</option><option value="mine">Assigned to me</option></select></label><span>{{ inboxConversations.length }} conversation{{ inboxConversations.length === 1 ? '' : 's' }} · {{ inboxUnreadCount }} unread visitor message{{ inboxUnreadCount === 1 ? '' : 's' }}</span></div>
          <div class="dashboard-grid conversation-inbox-grid"><article class="panel table-panel"><div class="table-heading"><span>Conversation</span><span>Status</span><span>Activity</span></div><div v-if="!inboxConversations.length" class="diagnostics-empty">No conversations match this view.</div><button v-for="conversation in inboxConversations" :key="conversation.id" :class="['table-row', 'table-row-button', { selected: selectedInboxConversation?.id === conversation.id }]" type="button" @click="openInboxConversation(conversation)"><div class="lead-name"><span class="lead-avatar">{{ (conversation.lead?.name || 'V').charAt(0).toUpperCase() }}</span><span><strong>{{ conversation.lead?.name || 'Visitor conversation' }}</strong><small>{{ conversation.lastMessage?.content || 'No messages yet' }}</small></span></div><span :class="['status-pill', conversation.status === 'RESOLVED' ? 'booked' : conversation.status === 'AI_ACTIVE' ? 'new' : 'qualified']">{{ formatLabel(conversation.status) }}<b v-if="conversation.unreadCount"> · {{ conversation.unreadCount }}</b></span><small>{{ new Date(conversation.lastActivityAt).toLocaleString() }}</small></button></article><article v-if="selectedInboxConversation" class="panel inbox-detail-panel"><div class="panel-heading"><div><p class="eyebrow">Conversation detail</p><h2>{{ selectedInboxConversation.lead?.name || 'Visitor' }}</h2><p>{{ selectedInboxConversation.lead?.intent || 'General inquiry' }} · {{ formatLabel(selectedInboxConversation.status) }}</p></div><div class="toolbar-actions"><button v-if="selectedInboxConversation.status !== 'HUMAN_ACTIVE' && selectedInboxConversation.status !== 'RESOLVED'" class="primary-button small" type="button" :disabled="inboxActionLoading" @click="takeOverConversation">Take over</button><button v-if="selectedInboxConversation.status === 'HUMAN_ACTIVE'" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="returnConversationToAi">Return to AI</button><button v-if="selectedInboxConversation.status !== 'RESOLVED'" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="resolveConversation">Resolve</button></div></div><div class="inbox-message-thread"><div v-for="(message, index) in selectedInboxConversation.messages ?? []" :key="`${message.createdAt}-${index}`" :class="['message-thread-item', message.role]"><small>{{ message.authorName || formatLabel(message.role) }} · {{ new Date(message.createdAt).toLocaleString() }}</small><p>{{ message.content }}</p></div><div v-if="!(selectedInboxConversation.messages?.length)" class="diagnostics-empty">No messages to display.</div></div><form class="question-form" @submit.prevent="sendInboxReply"><input v-model="inboxReply" type="text" placeholder="Reply as your team…" :disabled="selectedInboxConversation.status !== 'HUMAN_ACTIVE'" /><button class="primary-button small" type="submit" :disabled="!inboxReply.trim() || inboxActionLoading">Send</button></form><form class="question-form" @submit.prevent="addInboxNote"><input v-model="inboxNote" type="text" placeholder="Add a private internal note…" /><button class="outline-button small" type="submit" :disabled="!inboxNote.trim() || inboxActionLoading">Add note</button></form></article><article v-else class="panel workspace-message"><strong>Select a conversation</strong><p>Choose a visitor conversation to review the thread, take over, or return it to AI.</p></article></div>
        </div>

        <div v-else-if="view === 'team'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">People and permissions</p><h2>Team access</h2><p>Invite staff, keep access business-scoped, and see who is active in the inbox.</p></div><span v-if="teamMessage" class="saved-message">✓ {{ teamMessage }}</span></div>
          <p v-if="teamError" class="form-error">{{ teamError }}</p>
          <article class="panel form-panel team-invite-panel"><div class="panel-heading"><div><p class="eyebrow">Invite people you trust</p><h2>Invite a team member</h2><p>They can sign in with this email to accept access.</p></div></div><form class="team-invite-form" @submit.prevent="inviteTeamMember"><div class="team-invite-grid"><label>Name <span class="optional">optional</span><input v-model="teamInviteName" type="text" autocomplete="name" placeholder="Alex Morgan" /></label><label>Email<input v-model="teamInviteEmail" type="email" autocomplete="email" required placeholder="alex@business.com" /></label><label>Role<select v-model="teamInviteRole"><option value="staff">Staff</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><div class="toolbar-actions"><button class="primary-button small" type="submit" :disabled="teamLoading || !teamInviteEmail.trim()">{{ teamLoading ? 'Inviting…' : 'Send invitation' }}</button><button class="outline-button small" type="button" :disabled="teamLoading" @click="loadTeam">Refresh</button></div></div></form></article>
          <article class="panel table-panel team-table-panel"><div class="table-heading team-row"><span>Team member</span><span>Role</span><span>Status</span><span>Last active</span></div><div v-if="!teamMembers.length" class="diagnostics-empty">No team members found.</div><div v-for="member in teamMembers" :key="member.id" class="table-row team-row"><div class="lead-name"><span class="lead-avatar">{{ member.name.charAt(0).toUpperCase() }}</span><span><strong>{{ member.name }}</strong><small>{{ member.email }}</small></span></div><select v-if="member.role !== 'owner'" :value="member.role" :disabled="teamLoading" @change="updateTeamMember(member, String(($event.target as HTMLSelectElement).value) as TeamMember['role'])"><option value="admin">Admin</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select><span v-else class="status-pill booked">Owner</span><span :class="['status-pill', member.status === 'active' ? 'booked' : 'qualified']">{{ member.status }}</span><small>{{ member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString() : 'Not active yet' }}</small></div></article>
        </div>


        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>Review, qualify, and export the contacts FrontDeskWise captured.</p></div><div class="toolbar-actions"><span v-if="leadExportMessage" class="saved-message">✓ {{ leadExportMessage }}</span><button class="outline-button small" type="button" :disabled="leadsLoading" @click="loadLeads">{{ leadsLoading ? 'Refreshing…' : 'Refresh' }}</button><button class="outline-button small" type="button" :disabled="!visibleLeads.length" @click="exportLeadsCsv">Export CSV</button><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div></div><p v-if="leadsError" class="form-error">{{ leadsError }}</p><div class="panel lead-filters"><label>Search<input v-model="leadSearch" type="search" placeholder="Name, email, intent…" /></label><label>Status<select v-model="leadStatusFilter"><option value="all">All statuses</option><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label><span>{{ visibleLeads.length }} of {{ leads.length }} lead{{ leads.length === 1 ? '' : 's' }}</span></div><div class="panel table-panel"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-if="!visibleLeads.length && !leadsError" class="diagnostics-empty">{{ leads.length ? 'No leads match these filters.' : 'No leads captured yet.' }}</div><button v-for="lead in visibleLeads" :key="lead.id" class="table-row table-row-button" type="button" @click="openLeadDetail(lead)"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0).toUpperCase() }}</span><span><strong>{{ lead.name }}</strong><small>{{ lead.email || lead.phone || 'Contact details not provided' }}</small></span></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></button></div></div>


        <div v-else-if="view === 'knowledge'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Knowledge review</p><h2>Close the answer gaps</h2><p>Approve safe answers for questions the front desk could not ground confidently.</p></div><div class="toolbar-actions knowledge-toolbar-actions"><span v-if="embeddingMessage" class="saved-message">✓ {{ embeddingMessage }}</span><button class="primary-button small" type="button" :disabled="knowledgeTestAction.disabled" :title="knowledgeTestAction.disabled ? 'Review sources that need attention before testing.' : undefined" @click="openAgentTest(knowledgeTestContext === 'answer' ? resolvedKnowledgeQuestion : undefined)">{{ knowledgeTestAction.label }}<span v-if="!knowledgeTestAction.disabled"> →</span></button><button v-if="authSnapshot && availableBusinesses.length" class="outline-button small" type="button" :disabled="embeddingLoading" @click="reindexKnowledge">{{ embeddingLoading ? 'Re-indexing…' : 'Re-index' }}</button><button class="outline-button small knowledge-toolbar-more" type="button" aria-label="Refresh knowledge" title="Refresh knowledge" @click="loadKnowledge">⋯</button></div></div>
          <p v-if="knowledgeError" class="form-error">{{ knowledgeError }}</p>
          <article v-if="authSnapshot && !availableBusinesses.length" class="panel workspace-message knowledge-start-panel"><strong>Start your knowledge base</strong><p>Sign-in is complete. Add your first business website and FrontDeskWise will crawl it, index the readable content, and make it available for questions.</p><button class="primary-button small" type="button" @click="openAddBusiness">Add website / domain →</button></article>
          <article v-if="!authSnapshot || availableBusinesses.length" class="panel document-library">
            <div class="panel-heading"><div><p class="eyebrow">Organization knowledge</p><h2>Private documents</h2><p>Upload policies, menus, service guides, and other business material. Files are private and scoped to {{ businessName || 'the selected business' }}.</p></div><label class="primary-button small document-upload-button">{{ documentsLoading ? 'Working…' : 'Upload document' }}<input type="file" accept=".pdf,.txt,.md,.csv,.json,.rtf,.doc,.docx,.xls,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/json" :disabled="documentsLoading || !authSnapshot || !selectedBusinessId()" @change="uploadDocument" /></label></div>
            <p v-if="documentsError" class="form-error">{{ documentsError }}</p>
            <p v-if="documentsMessage" class="saved-message">✓ {{ documentsMessage }}</p>
            <div v-if="!authSnapshot" class="install-gate"><p>Sign in to upload organization knowledge. The public demo still uses the crawled website.</p><button class="outline-button small" type="button" @click="openAuth('signup')">Create account to upload →</button></div>
            <div v-else-if="!organizationDocuments.length && !documentsError" class="diagnostics-empty">No private documents uploaded for this business yet.</div>
            <div v-else class="document-list"><div v-for="documentItem in organizationDocuments" :key="documentItem.id" class="document-row"><div><strong>{{ documentItem.fileName }}</strong><small>{{ documentItem.contentType }} · {{ formatDocumentSize(documentItem.sizeBytes) }} · {{ documentItem.status }}</small></div><div class="admin-actions"><button class="outline-button small" type="button" @click="downloadDocument(documentItem)">Download</button><button class="text-button" type="button" :disabled="documentsLoading" @click="deleteDocument(documentItem)">Remove</button></div></div></div>
          </article>
          <article v-if="workspaceKnowledge" class="panel knowledge-health-panel"><div class="panel-heading"><div><p class="eyebrow">Knowledge health</p><h2>{{ workspaceKnowledge.status === 'ready' ? 'Ready for grounded questions' : workspaceKnowledge.status === 'indexing' ? 'Indexing in progress' : workspaceKnowledge.status === 'review_recommended' ? 'Review recommended' : 'Add a website source' }}</h2><p>Readiness is based on ready sources, indexed chunks, and unresolved answer gaps.</p></div><strong class="readiness-score">{{ readinessScore }}%</strong></div><div class="knowledge-health-grid"><div><strong>{{ workspaceKnowledge.sourceCount }}</strong><small>ready sources</small></div><div><strong>{{ workspaceKnowledge.chunkCount }}</strong><small>indexed chunks</small></div><div><strong>{{ workspaceKnowledge.openGaps }}</strong><small>open answer gaps</small></div><div><strong>{{ (workspaceKnowledge.pendingSources ?? 0) + (workspaceKnowledge.failedSources ?? 0) }}</strong><small>sources needing attention</small></div></div><p v-if="workspaceKnowledge.pendingSources" class="conversation-status">{{ workspaceKnowledge.pendingSources }} source{{ workspaceKnowledge.pendingSources === 1 ? '' : 's' }} still processing. Refresh after crawling finishes.</p><p v-if="workspaceKnowledge.failedSources" class="form-error">{{ workspaceKnowledge.failedSources }} source{{ workspaceKnowledge.failedSources === 1 ? '' : 's' }} failed to crawl. Review the source or add the information as a private document.</p></article>
          <article v-if="workspaceKnowledge?.sources?.length" class="panel source-library"><div class="panel-heading"><div><p class="eyebrow">Captured website knowledge</p><h2>Website sources</h2><p>{{ workspaceKnowledge.sources.length }} source{{ workspaceKnowledge.sources.length === 1 ? '' : 's' }} currently available to the assistant. The list stays collapsed so the health summary remains easy to scan.</p></div><div class="toolbar-actions"><span v-if="sourceActionMessage" class="saved-message">✓ {{ sourceActionMessage }}</span><button class="outline-button small" type="button" @click="sourceLibraryOpen = !sourceLibraryOpen">{{ sourceLibraryOpen ? 'Hide sources' : `Show ${workspaceKnowledge.sources.length} source${workspaceKnowledge.sources.length === 1 ? '' : 's'}` }}</button><button class="outline-button small" type="button" @click="refreshWorkspaceSummary">Refresh</button></div></div><div v-if="sourceLibraryOpen" class="source-list"><div v-for="source in workspaceKnowledge.sources" :key="source.id" class="source-row"><div><strong>{{ source.title }}</strong><small>{{ source.contentType === 'web_page' ? source.pageType : 'Private document' }} · {{ source.url }}</small></div><div class="source-row-actions"><span :class="['status-pill', source.crawlStatus === 'ready' ? 'booked' : source.crawlStatus === 'failed' ? 'new' : 'qualified']">{{ source.crawlStatus }}</span><template v-if="source.contentType === 'web_page'"><button class="text-button" type="button" :disabled="Boolean(sourceActionLoading)" @click="recrawlSource(source)">{{ sourceActionLoading === source.id ? 'Refreshing…' : 'Refresh' }}</button><button class="text-button danger-text" type="button" :disabled="Boolean(sourceActionLoading)" @click="deleteSource(source)">Remove</button></template></div></div></div></article>
          <article v-if="!knowledgeGaps.length && !knowledgeError" class="panel empty-knowledge"><div class="empty-icon">✓</div><h2>{{ knowledgeSourcesNeedAttention ? 'Sources need attention.' : 'Your knowledge looks healthy.' }}</h2><p>{{ knowledgeSourcesNeedAttention ? 'Review the source status above before testing the agent.' : 'Test a few customer questions to make sure the assistant responds the way you expect.' }}</p><button v-if="!knowledgeSourcesNeedAttention" class="primary-button small" type="button" @click="openAgentTest()">Test agent →</button></article>
          <div v-else class="knowledge-review-grid"><article v-for="gap in knowledgeGaps" :key="gap.question" class="panel gap-card"><div class="gap-card-heading"><div><span :class="['answer-badge', gap.status === 'resolved' ? 'grounded' : 'fallback']">{{ gap.status === 'resolved' ? '✓ Approved' : '! Open gap' }}</span><h3>{{ gap.question }}</h3></div><strong>{{ gap.occurrenceCount }}×</strong></div><textarea v-model="answerDrafts[gap.question]" rows="4" :disabled="gap.status === 'resolved'" placeholder="Write the answer the assistant may use…"></textarea><div class="gap-card-actions"><small>Last seen {{ new Date(gap.lastSeenAt).toLocaleString() }}</small><template v-if="gap.status === 'resolved'"><span class="gap-answer-saved">✓ Answer saved</span><button class="text-button" type="button" @click="openAgentTest(gap.question)">Test this question →</button></template><button v-else class="primary-button small" type="button" :disabled="!answerDrafts[gap.question]?.trim()" @click="resolveKnowledgeGap(gap)">Approve answer</button></div></article></div>
          <div class="section-toolbar diagnostics-heading"><div><p class="eyebrow">Answer quality</p><h2>Recent answer checks</h2><p>Review confidence and whether each answer was grounded in your knowledge.</p></div></div>
          <article class="panel table-panel diagnostics-panel"><div class="table-heading diagnostics-row"><span>Question</span><span>Confidence</span><span>Outcome</span></div><div v-for="diagnostic in retrievalDiagnostics" :key="`${diagnostic.conversationId}-${diagnostic.createdAt}`" class="table-row diagnostics-row"><div><strong>{{ diagnostic.question }}</strong><small>{{ diagnostic.answer }}</small></div><span :class="['status-pill', diagnostic.confidenceBand === 'high' ? 'booked' : diagnostic.confidenceBand === 'medium' ? 'qualified' : 'new']">{{ Math.round(diagnostic.confidenceScore * 100) }}% · {{ diagnostic.confidenceBand }}</span><span :class="['status-pill', diagnostic.grounded ? 'booked' : 'new']">{{ diagnostic.grounded ? 'Grounded' : 'Needs review' }}<small>{{ diagnostic.retrieval?.candidateCount ?? 0 }} knowledge matches</small></span></div><div v-if="!retrievalDiagnostics.length" class="diagnostics-empty">No answer checks yet.</div></article>
        </div>

        <div v-else-if="view === 'actions'" class="view-content action-page">
          <div class="actions-page-header">
            <div><p class="eyebrow">AI front desk</p><h2>Actions</h2><p>Define what your AI front desk can help visitors do.</p></div>
            <button v-if="!actionDraft" class="primary-button" type="button" @click="actionTemplateChooserOpen = true">+ Create action</button>
            <div v-else class="toolbar-actions"><button class="outline-button small" type="button" @click="selectAction(null)">← All actions</button><button class="primary-button small" type="button" :disabled="actionsLoading" @click="saveAction">{{ actionsLoading ? 'Saving…' : 'Save changes' }}</button></div>
          </div>
          <p v-if="integrationError" class="form-error">{{ integrationError }}</p>
          <p v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</p>
          <p v-if="actionsError" class="form-error">{{ actionsError }}</p>
          <p v-if="actionsMessage" class="saved-message">✓ {{ actionsMessage }}</p>

          <template v-if="!actionDraft">
            <section v-if="actionFlows.length" class="action-dashboard-list">
              <div class="action-section-heading"><div><p class="eyebrow">Your actions</p><h3>Conversion flows</h3><p>Give visitors a clear next step and keep the outcome visible to your team.</p></div><span v-if="actionsLoading" class="conversation-status">Refreshing…</span></div>
              <article v-for="action in actionFlows" :key="action.id" class="action-summary-card">
                <div class="action-summary-main"><span class="action-summary-icon">ϟ</span><div><h3>{{ action.name }}</h3><p>{{ action.description }}</p><div class="action-summary-meta"><span :class="['action-status-badge', `action-status-${actionStatusTone(actionStatusLabel(action))}`]">{{ actionStatusLabel(action) }}</span><span>{{ actionFunnelFor(action)?.started ?? 0 }} started</span><span>{{ actionFunnelFor(action)?.completed ?? 0 }} completed</span><span>{{ actionCompletionRate(action) }}% completion</span></div></div></div>
                <div class="action-summary-actions"><div class="action-summary-progress"><strong>{{ actionCompletionRate(action) }}%</strong><span>completion</span><div class="progress-bar"><span :style="{ width: `${Math.min(100, actionCompletionRate(action))}%` }"></span></div></div><button class="outline-button small" type="button" @click="selectAction(action)">Edit</button></div>
              </article>
            </section>
            <section v-else class="panel action-empty-state"><span class="action-empty-icon">✦</span><div><p class="eyebrow">Start with an outcome</p><h2>Your AI can do more than answer questions.</h2><p>Set up an action so visitors can book, request a quote, leave their details, or contact your team.</p><button class="primary-button small" type="button" @click="actionTemplateChooserOpen = true">Create your first action</button></div></section>
            <section class="action-template-strip"><div><p class="eyebrow">Quick-start templates</p><h3>Start with a proven flow</h3></div><div class="action-template-chips"><button v-for="template in actionTemplates.slice(0, 5)" :key="template.key" type="button" @click="actionTemplateChooserOpen = true">{{ template.name }}</button><button type="button" @click="actionTemplateChooserOpen = true">Custom action</button></div></section>
          </template>

          <div v-else-if="actionDraft">
            <div class="action-editor-titlebar"><div><p class="eyebrow">Action editor</p><h2>{{ actionDraft.name }}</h2><p>{{ actionDraft.description }}</p></div><div class="action-editor-title-actions"><span :class="['action-status-badge', `action-status-${actionStatusTone(actionStatusLabel(actionDraft))}`]">{{ actionStatusLabel(actionDraft) }}</span><label class="toggle-row"><span>Active</span><input v-model="actionDraft.enabled" type="checkbox" /></label><button class="outline-button small" type="button" @click="actionAdvancedOpen = !actionAdvancedOpen">{{ actionAdvancedOpen ? 'Hide advanced' : 'Advanced' }}</button></div></div>
            <section class="action-funnel-summary"><div><p class="eyebrow">Last 30 days</p><h3>Conversion flow</h3></div><div class="action-funnel-steps"><div><strong>{{ actionFunnelFor(actionDraft)?.started ?? 0 }}</strong><span>Started</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.formDisplayed ?? 0 }}</strong><span>Reached form</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.submitted ?? 0 }}</strong><span>Submitted</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.completed ?? 0 }}</strong><span>Completed</span></div><div class="action-funnel-rate"><strong>{{ actionCompletionRate(actionDraft) }}%</strong><span>Completion rate</span></div></div><small v-if="actionFunnelFor(actionDraft)?.dropOffs?.length">Biggest drop-off: {{ actionFunnelFor(actionDraft)?.dropOffs[0].label }} · {{ actionFunnelFor(actionDraft)?.dropOffs[0].count }} visitors</small></section>
            <section class="action-editor-layout">
              <article class="panel action-config-panel">
                <nav class="action-flow-stepper" aria-label="Action stages"><button v-for="(stage, index) in actionEditorStageLabels" :key="stage.id" type="button" :class="{ active: actionEditorStage === stage.id }" @click="setActionStage(stage.id)"><span>{{ index + 1 }}</span><strong>{{ stage.label }}</strong><small>{{ stage.helper }}</small></button></nav>
                <div class="action-stage-content">
                  <template v-if="actionEditorStage === 'trigger'">
                    <div class="action-stage-heading"><span class="action-stage-number">1</span><div><p class="eyebrow">Trigger</p><h3>When should this action start?</h3><p>Use a few examples and let the AI recognize similar wording automatically.</p></div></div>
                    <div class="action-chip-list"><button v-for="phrase in actionTriggerPhrases" :key="phrase" type="button" class="action-chip" @click="removeActionTriggerPhrase(phrase)">{{ phrase }} <span>×</span></button><span v-if="!actionTriggerPhrases.length" class="action-inline-empty">Add the phrases visitors might use.</span></div>
                    <div class="action-add-row"><input v-model="actionTriggerPhraseInput" type="text" placeholder="e.g. contact me" @keyup.enter="addActionTriggerPhrase" /><button class="outline-button small" type="button" @click="addActionTriggerPhrase">+ Add phrase</button></div>
                    <label class="action-option-card"><span><strong>AI intent detection</strong><small>The assistant can recognize similar wording automatically.</small></span><input type="checkbox" :checked="Boolean(actionDraft.triggerIntents.length)" @change="setActionIntentDetection" /></label>
                  </template>

                  <template v-else-if="actionEditorStage === 'qualify'">
                    <div class="action-stage-heading"><span class="action-stage-number">2</span><div><p class="eyebrow">Qualify</p><h3>What should the assistant ask?</h3><p>Keep the list short. Click a question to edit its wording and rules.</p></div><button class="outline-button small" type="button" @click="addActionField">+ Add question</button></div>
                    <div class="action-question-list"><div v-for="(field, index) in actionDraft.fields" :key="field.id" class="action-question-row" draggable="true" @dragstart="dragActionField(index)" @dragover.prevent @drop="dropActionField(index)"><button class="action-drag-handle" type="button" aria-label="Drag question">≡</button><button class="action-question-button" type="button" @click="openActionField(index)"><strong>{{ index + 1 }}. {{ field.label }}</strong><span>{{ formatLabel(field.type) }} · {{ field.required ? 'Required' : 'Optional' }}</span></button><button class="action-question-remove" type="button" aria-label="Remove question" @click="removeActionField(index)">×</button></div><div v-if="!actionDraft.fields.length" class="action-inline-empty">Add a question to collect the details your team needs.</div></div>
                    <p class="form-help">Drag the ≡ handle to reorder. The arrow controls remain available inside each question’s editor.</p>
                  </template>

                  <template v-else-if="actionEditorStage === 'contact'">
                    <div class="action-stage-heading"><span class="action-stage-number">3</span><div><p class="eyebrow">Contact</p><h3>How should FrontDeskWise collect the information?</h3><p>Choose the experience that feels natural for this action. Auto is recommended.</p></div></div>
                    <div class="capture-mode-grid"><button v-for="mode in [{ id: 'auto', label: 'Auto', description: 'FrontDeskWise chooses the best experience.', badge: 'Recommended' }, { id: 'conversational', label: 'Conversation', description: 'Ask questions one at a time.', badge: '' }, { id: 'form', label: 'Form', description: 'Show all fields together.', badge: '' }, { id: 'hybrid', label: 'Hybrid', description: 'Ask key questions, then show a short form.', badge: '' }]" :key="mode.id" type="button" :class="['capture-mode-card', { selected: actionDraft.captureMode === mode.id }]" @click="selectActionCaptureMode(mode.id as ActionFlow['captureMode'])"><span class="capture-mode-radio"></span><strong>{{ mode.label }}</strong><small>{{ mode.description }}</small><em v-if="mode.badge">{{ mode.badge }}</em></button></div>
                    <div class="capture-mini-preview"><p class="eyebrow">Visitor experience</p><strong>{{ actionDraft.captureMode === 'form' ? 'A short form appears at once.' : actionDraft.captureMode === 'conversational' ? 'The assistant asks one question at a time.' : actionDraft.captureMode === 'hybrid' ? 'The assistant qualifies first, then shows the contact form.' : 'The assistant chooses based on the action and visitor.' }}</strong><span>{{ actionDraft.fields.filter((field) => field.visibility !== 'hidden').length }} visible questions · {{ actionDraft.fields.filter((field) => field.required).length }} required</span></div>
                  </template>

                  <template v-else-if="actionEditorStage === 'complete'">
                    <div class="action-stage-heading"><span class="action-stage-number">4</span><div><p class="eyebrow">Complete</p><h3>What happens when the action is completed?</h3><p>Keep the success moment clear, then decide what should be saved or sent.</p></div></div>
                    <div class="completion-checklist"><label class="action-option-card"><span><strong>Save lead in FrontDeskWise</strong><small>Keep the captured contact and outcome in your Leads workspace.</small></span><input v-model="actionDraft.completion.createLead" type="checkbox" /></label><label class="action-option-card"><span><strong>Notify staff</strong><small>Send the completed request to the selected team channels.</small></span><input v-model="actionDraft.completion.notifyStaff" type="checkbox" /></label><label class="action-option-card"><span><strong>Send an email notification</strong><small>Use email alongside the in-app notification.</small></span><input v-model="actionDraft.completion.notifyChannels" type="checkbox" value="email" /></label></div>
                    <div class="action-two-column"><label>Success message<textarea v-model="actionDraft.completion.message" rows="3"></textarea></label><label>Lead status<select v-model="actionDraft.completion.leadStatus"><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label></div>
                  </template>

                  <template v-else>
                    <div class="action-stage-heading"><span class="action-stage-number">5</span><div><p class="eyebrow">Deliver</p><h3>Where should the completed action go?</h3><p>Leads are saved first. Select an existing connection for an additional delivery.</p></div></div>
                    <div class="action-delivery-choice"><label>Deliver to<select :value="actionDraft.completion.connector?.provider ?? 'none'" @change="setActionConnectorProviderFromEvent"><option value="none">FrontDeskWise only</option><option value="email">Email the team</option><option v-if="integrations.some((integration) => integration.provider === 'webhook' && integration.connectionStatus === 'active')" value="generic_webhook">Webhook / automation</option><option v-if="integrations.some((integration) => integration.provider === 'hubspot' && integration.connectionStatus === 'active')" value="hubspot">HubSpot CRM</option></select></label><label v-if="actionConnectorProvider !== 'email' && actionConnectorProvider !== 'none'">Connected system<select :value="actionDraft.completion.connector?.integrationId ?? ''" @change="setActionConnectorIntegrationFromEvent"><option value="">Select a connected system…</option><option v-for="integration in activeActionIntegrations" :key="integration.id" :value="integration.id">{{ integration.displayName }}</option></select></label></div>
                    <div v-if="!integrations.length" class="action-connection-empty"><strong>No integration connected</strong><span>Connect one in Settings when you need delivery outside FrontDeskWise.</span><button class="outline-button small" type="button" @click="openSettingsTab('integrations')">Connect an integration</button></div>
                    <div v-else class="action-delivery-queue"><div class="panel-heading"><div><p class="eyebrow">Delivery history</p><h3>{{ actionDeliveriesFor(actionDraft).length ? 'Recent deliveries' : 'No deliveries yet' }}</h3></div><button class="text-button" type="button" :disabled="actionsLoading" @click="loadActions">Refresh</button></div><div v-for="delivery in actionDeliveriesFor(actionDraft)" :key="delivery.id" class="action-delivery-row"><span><strong>{{ delivery.provider }}</strong><small>{{ delivery.attempts }} attempt{{ delivery.attempts === 1 ? '' : 's' }} · {{ new Date(delivery.updatedAt).toLocaleString() }}</small></span><span :class="['status-pill', delivery.status === 'succeeded' ? 'booked' : delivery.status === 'failed' ? 'new' : 'qualified']">{{ delivery.status }}</span><button v-if="delivery.status === 'failed'" class="text-button" type="button" :disabled="actionsLoading" @click="retryActionDelivery(delivery)">Retry</button></div></div>
                  </template>

                  <details class="action-advanced" :open="actionAdvancedOpen"><summary @click.prevent="actionAdvancedOpen = !actionAdvancedOpen">Advanced settings <span>{{ actionAdvancedOpen ? 'Hide' : 'Show' }}</span></summary><div v-if="actionAdvancedOpen" class="action-advanced-body"><label>Internal action key<input v-model="actionDraft.key" type="text" /></label><label>Trigger intents <input :value="actionDraft.triggerIntents.join(', ')" type="text" placeholder="contact, lead" @input="setActionTriggerIntents" /></label><label>Continue link <span class="optional">optional</span><input v-model="actionDraft.completion.linkUrl" type="url" placeholder="https://…" /></label><p class="form-help">Technical identifiers and connector details are kept here so the main setup stays focused on the customer journey.</p></div></details>
                </div>
                <div class="action-editor-footer"><button class="text-button danger-text" type="button" :disabled="actionsLoading" @click="removeAction">Delete action</button><span v-if="actionsMessage" class="saved-message">✓ {{ actionsMessage }}</span><button class="primary-button small" type="button" :disabled="actionsLoading" @click="saveAction">{{ actionsLoading ? 'Saving…' : 'Save changes' }}</button></div>
              </article>
              <aside class="panel action-live-preview"><div class="action-preview-heading"><div><p class="eyebrow">Live customer preview</p><h3>What visitors will see</h3></div><span class="preview-live-dot">Live</span></div><div class="action-preview-window"><div class="action-preview-top"><span class="mini-orb">✦</span><div><strong>{{ assistantName }}</strong><small>{{ businessName || 'Your business' }}</small></div><span class="online-dot"></span></div><div class="action-preview-thread"><div class="action-preview-bubble">{{ actionDraft.completion.message || 'Absolutely. I just need a few details.' }}</div><div class="action-preview-bubble visitor">I’d like to {{ actionDraft.name.toLowerCase() }}.</div><div class="action-preview-bubble">Absolutely. I just need a few details.</div><div class="action-preview-form"><label v-for="field in actionDraft.fields.filter((item) => item.visibility !== 'hidden').slice(0, 4)" :key="field.id">{{ field.label }} <span v-if="!field.required">optional</span><input :type="field.type === 'phone' ? 'tel' : field.type" disabled :placeholder="field.label" /></label><span v-if="!actionDraft.fields.length" class="action-inline-empty">Add questions to see the form preview.</span><button class="primary-button small" type="button">{{ actionDraft.completion.submitLabel || 'Send request' }}</button></div></div><div class="action-preview-input">Ask a question… <span>➤</span></div></div><p class="form-help">Updates appear here as you change questions, capture style, or completion behavior.</p></aside>
            </section>
          </div>

          <div v-if="actionTemplateChooserOpen" class="action-modal-backdrop" role="presentation" @click.self="actionTemplateChooserOpen = false"><section class="action-template-modal" role="dialog" aria-modal="true" aria-labelledby="create-action-title"><button class="auth-close" type="button" aria-label="Close" @click="actionTemplateChooserOpen = false">×</button><p class="eyebrow">Quick start</p><h2 id="create-action-title">Create an action</h2><p>What should visitors be able to do?</p><div class="action-template-modal-grid"><button v-for="template in actionTemplates" :key="template.key" type="button" :disabled="actionsLoading || actionFlows.some((action) => action.key === template.key)" @click="addActionTemplate(template)"><strong>{{ template.name }}</strong><small>{{ actionFlows.some((action) => action.key === template.key) ? 'Already configured' : template.description }}</small></button><button type="button" :disabled="actionsLoading" @click="addCustomAction"><strong>Custom action</strong><small>Start with a blank conversion flow.</small></button></div></section></div>
          <div v-if="actionFieldDrawerIndex !== null && selectedActionField" class="action-modal-backdrop" role="presentation" @click.self="closeActionField"><aside class="action-field-drawer" role="dialog" aria-modal="true" aria-labelledby="question-editor-title"><div class="action-drawer-header"><div><p class="eyebrow">Question {{ actionFieldDrawerIndex + 1 }}</p><h2 id="question-editor-title">Edit question</h2></div><button class="auth-close" type="button" aria-label="Close" @click="closeActionField">×</button></div><label>Label<input v-model="selectedActionField.label" type="text" /></label><label>How the AI asks<input v-model="selectedActionField.question" type="text" /></label><label>Type<select v-model="selectedActionField.type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="select">Select</option><option value="date">Date</option><option value="number">Number</option></select></label><label class="toggle-row"><span>Required</span><input v-model="selectedActionField.required" type="checkbox" /></label><label>Show when<select :value="selectedActionField.condition?.field ?? ''" @change="setFieldCondition(selectedActionField, $event)"><option value="">Always</option><option v-for="conditionField in actionDraft?.fields.slice(0, actionFieldDrawerIndex)" :key="conditionField.key" :value="conditionField.key">{{ conditionField.label }}</option></select></label><div v-if="selectedActionField.type === 'select'"><label>Choices <span class="optional">comma separated</span><input :value="(selectedActionField.options ?? []).join(', ')" type="text" @input="setFieldOptions(selectedActionField, $event)" /></label></div><details class="action-advanced" :open="actionAdvancedOpen"><summary @click.prevent="actionAdvancedOpen = !actionAdvancedOpen">Advanced <span>{{ actionAdvancedOpen ? 'Hide' : 'Show' }}</span></summary><div v-if="actionAdvancedOpen" class="action-advanced-body"><label>Field key<input v-model="selectedActionField.key" type="text" /></label><label>Visibility<select v-model="selectedActionField.visibility"><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><label v-if="selectedActionField.condition?.field">Equals<input :value="selectedActionField.condition?.equals ?? ''" type="text" @input="setFieldConditionEquals(selectedActionField, $event)" /></label></div></details><div class="action-drawer-footer"><div class="action-drawer-reorder"><button class="outline-button small" type="button" :disabled="actionFieldDrawerIndex === 0" @click="moveSelectedActionField(-1)">↑ Move up</button><button class="outline-button small" type="button" :disabled="actionDraft ? actionFieldDrawerIndex === actionDraft.fields.length - 1 : true" @click="moveSelectedActionField(1)">Move down ↓</button></div><button class="text-button danger-text" type="button" @click="removeActionField(actionFieldDrawerIndex); closeActionField()">Remove question</button><button class="primary-button small" type="button" @click="closeActionField">Done</button></div></aside></div>
        </div>

        <div v-else-if="view === 'connections'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Settings · integrations</p><h2>Integrations</h2><p>Connect business systems for lookups and assistant tools. Completion actions stay in Actions.</p></div><div class="toolbar-actions"><span v-if="mcpMessage" class="saved-message">✓ {{ mcpMessage }}</span><button class="outline-button small" type="button" :disabled="mcpLoading" @click="loadMcpConnections">{{ mcpLoading ? 'Working…' : 'Refresh' }}</button></div></div>
          <p v-if="mcpError" class="form-error">{{ mcpError }}</p>
          <div class="dashboard-grid connection-setup-grid">
            <article class="panel form-panel">
              <div class="panel-heading"><div><p class="eyebrow">Three simple steps</p><h2>Connect an MCP server</h2><p>FrontDeskWise tests the connection and discovers available tools before saving anything.</p></div></div>
              <div class="connection-steps"><div><span>1</span><p><strong>Choose your provider</strong><small>Use the provider where your customer data or workflows live.</small></p></div><div><span>2</span><p><strong>Paste the connection details</strong><small>The token is encrypted and never shown again.</small></p></div><div><span>3</span><p><strong>Review permissions</strong><small>Read-only tools start enabled. Other tools require your approval.</small></p></div></div>
              <label>Provider<select v-model="mcpProvider"><option value="hubspot">HubSpot MCP</option><option value="zapier">Zapier MCP</option><option value="make">Make MCP</option><option value="custom">Custom MCP server</option></select></label>
              <p class="form-help">{{ mcpProviderHelp(mcpProvider) }}</p>
              <label>Connection name <span class="optional">optional</span><input v-model="mcpDisplayName" type="text" maxlength="120" :placeholder="`${mcpProviderName(mcpProvider)} workspace`" /></label>
              <label>Server URL<input v-model="mcpServerUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://…" /></label>
              <label>Access token <span class="optional">encrypted · never shown again</span><input v-model="mcpBearerToken" type="password" autocomplete="new-password" placeholder="Paste the token from your provider" /></label>
              <p class="form-help">For this first connection flow, use the MCP URL and token supplied by the provider. OAuth buttons can be added provider-by-provider later without changing permissions or tool safety.</p>
              <button class="primary-button" type="button" :disabled="mcpLoading || !mcpServerUrl.trim() || !mcpBearerToken.trim()" @click="connectMcpConnection">{{ mcpLoading ? 'Testing connection…' : 'Test & connect securely →' }}</button>
            </article>
            <article class="panel form-panel connection-explainer"><div class="panel-heading"><div><p class="eyebrow">What MCP is for</p><h2>Useful context for the assistant</h2><p>MCP is best for questions and follow-up work, not high-stakes completion steps.</p></div></div><div class="connection-use-list"><div><span class="check">✓</span><p><strong>Good fit</strong><small>Find an existing customer, check availability, search a CRM, or create a follow-up task.</small></p></div><div><span class="check">✓</span><p><strong>Still deterministic</strong><small>Bookings, enrollments, payments, and lead delivery stay in your configured action connectors.</small></p></div><div><span class="check">!</span><p><strong>Always controlled</strong><small>FrontDeskWise never runs every discovered tool automatically. Only allowed tools can be used.</small></p></div></div></article>
          </div>
          <article class="panel form-panel"><div class="panel-heading"><div><p class="eyebrow">Connected systems</p><h2>Review tool access</h2><p>Keep only the tools your assistant needs. Changing a permission takes effect after you save.</p></div></div><div v-if="!mcpConnections.length" class="diagnostics-empty">No MCP connections yet. Start with the guided connection above.</div><div v-for="connection in mcpConnections" :key="connection.id" class="mcp-connection-card"><div class="setup-row"><div><strong>{{ connection.displayName }}</strong><small>{{ mcpProviderName(connection.provider) }} · {{ connection.serverUrl }}</small></div><span :class="['status-pill', connection.connectionStatus === 'active' ? 'booked' : connection.connectionStatus === 'error' ? 'new' : 'qualified']">{{ connection.connectionStatus }}</span></div><p v-if="connection.lastError" class="form-error">{{ connection.lastError }}</p><div class="mcp-policy-note"><strong>{{ connection.tools.filter((tool) => tool.allowed).length }} of {{ connection.tools.length }} tools enabled</strong><span>Read-only tools are the safest default. Write or destructive tools should be enabled only when you understand the effect.</span></div><div v-if="connection.tools.length" class="mcp-tool-list"><label v-for="tool in connection.tools" :key="tool.name" class="mcp-tool-row"><input v-model="tool.allowed" type="checkbox" :disabled="mcpLoading" /><span><strong>{{ tool.title || tool.name }}</strong><small>{{ tool.description || tool.name }}</small><em :class="tool.destructive ? 'tool-risk-danger' : tool.approvalRequired ? 'tool-risk-review' : 'tool-risk-safe'">{{ tool.destructive ? 'Destructive · review carefully' : tool.approvalRequired ? 'Write action · explicit permission' : 'Read-only · safe default' }}</em></span></label></div><div v-else class="diagnostics-empty">No tools were advertised by this server.</div><div class="toolbar-actions"><button class="primary-button small" type="button" :disabled="mcpLoading" @click="saveMcpPermissions(connection)">Save permissions</button><button class="outline-button small" type="button" :disabled="mcpLoading" @click="testMcpConnection(connection)">Refresh tools</button><button class="text-button danger-text" type="button" :disabled="mcpLoading" @click="disconnectMcpConnection(connection)">Disconnect</button></div></div></article>
        </div>

        <div v-else-if="view === 'analytics'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Live operating signals</p><h2>Analytics</h2><p>Real conversations, leads, bookings, and knowledge activity for {{ showAllBusinesses ? 'all businesses' : (businessName || 'this business') }}.</p></div><button class="outline-button small" type="button" @click="refreshWorkspaceSummary">Refresh data</button></div>
          <div class="metric-grid"><article class="metric-card blue-tint"><strong>{{ workspaceStats?.conversations ?? 0 }}</strong><span>Conversations</span><em>Recorded conversations</em></article><article class="metric-card green-tint"><strong>{{ workspaceStats?.leads ?? 0 }}</strong><span>Leads captured</span><em>Durable FrontDeskWise records</em></article><article class="metric-card orange-tint"><strong>{{ workspaceStats?.handoffs ?? 0 }}</strong><span>Human handoffs</span><em>{{ workspaceStats?.humanActive ?? 0 }} active with staff</em></article><article class="metric-card purple-tint"><strong>{{ workspaceStats?.widgetLoads ?? 0 }}</strong><span>Widget loads</span><em>Verified public installs</em></article></div>
          <article class="panel chart-panel analytics-chart"><div class="panel-heading"><div><h2>Activity by day</h2><p>Last 30 days · live records</p></div></div><div v-if="workspaceStats?.trend?.length" class="live-chart" aria-label="Analytics activity by day"><div v-for="point in workspaceStats.trend" :key="point.label" class="live-chart-column"><div class="live-chart-bars"><span class="live-bar blue" :style="{ height: `${point.conversations / chartMax * 100}%` }"></span><span class="live-bar orange" :style="{ height: `${point.leads / chartMax * 100}%` }"></span></div><small>{{ point.label }}</small></div></div><div v-else class="diagnostics-empty">No activity recorded yet.</div></article>
          <article class="panel funnel-panel"><div class="panel-heading"><div><h2>Conversion funnels</h2><p>Flow starts, form progress, connector outcomes, and completion.</p></div></div><div v-if="workspaceStats?.conversionFunnels?.length" class="funnel-list"><div v-for="funnel in workspaceStats.conversionFunnels" :key="funnel.flowId" class="funnel-card"><div class="setup-row"><strong>{{ funnel.name }}</strong><span class="status-pill" :class="funnel.completionRate >= 60 ? 'booked' : funnel.completionRate >= 30 ? 'qualified' : 'new'">{{ funnel.completionRate }}% complete</span></div><div class="funnel-steps"><span>{{ funnel.started }} started</span><span>{{ funnel.formDisplayed }} reached form</span><span>{{ funnel.submitted }} submitted</span><span>{{ funnel.actionSucceeded }} action succeeded</span><span>{{ funnel.completed }} completed</span></div><small v-if="funnel.dropOffs.length">Biggest drop-off: {{ funnel.dropOffs[0].label }} · {{ funnel.dropOffs[0].count }}</small></div></div><div v-else class="diagnostics-empty">No action flow telemetry yet. Run a flow through the widget to see conversion data.</div></article>
          <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>Most common visitor questions</p></div></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Knowledge gaps</h2><p>Questions that need a stronger answer</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Review</button></div></div><div v-else class="diagnostics-empty">No open knowledge gaps.</div></article></div>
        </div>

        <div v-else-if="view === 'businesses'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One account · multiple businesses</p><h2>Businesses</h2><p>Manage every business under {{ activeOrganization?.name ?? 'your organization' }}.</p></div><button class="primary-button small" type="button" @click="openAddBusiness">+ Add business</button></div>
          <article class="panel table-panel"><div class="table-heading business-row"><span>Business</span><span>Website</span><span>Billing</span><span>Actions</span></div><div v-if="!availableBusinesses.length" class="diagnostics-empty">No businesses yet. Add your first public website to begin.</div><div v-for="business in availableBusinesses" :key="business.id" class="table-row business-row"><div><strong>{{ business.name }}</strong><small>{{ formatLabel(business.role) }} · {{ formatPlanLabel(business.planKey) }}</small></div><span>{{ business.websiteUrl || 'Website pending' }}</span><span><span :class="['status-pill', business.billingStatus === 'active' || business.billingStatus === 'trial' ? 'booked' : 'new']">{{ formatLabel(business.billingStatus) }}</span></span><button class="outline-button small" type="button" @click="workspaceSelection = business.slug">Open →</button></div></article>
          <article class="panel aggregate-billing-note"><p class="eyebrow">Shared organization billing</p><h2>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h2><p>{{ availableBusinesses.length }} of {{ activeOrganization?.billing.plan.maxBusinesses ?? 1 }} business slots used. Add capacity from Billing when you are ready to grow.</p><button class="text-button" type="button" @click="openSettingsTab('billing')">View plan →</button></article>
        </div>

        <div v-else-if="view === 'settings'" class="view-content">
          <template v-if="currentSettingsTab === 'general'">
            <div class="section-toolbar"><div><p class="eyebrow">Workspace settings</p><h2>General</h2><p>Identity and access details for this FrontDeskWise workspace.</p></div></div>
            <div class="settings-grid"><article class="panel settings-card"><p class="eyebrow">Signed-in account</p><h3>{{ authSnapshot?.user.name ?? 'FrontDeskWise user' }}</h3><p>{{ authSnapshot?.user.email ?? 'Not signed in' }}</p><small>Use your email or Google account to sign in. Password recovery is available from the sign-in screen.</small><button v-if="authSnapshot" class="outline-button small" type="button" @click="signOut">Sign out</button></article><article class="panel settings-card"><p class="eyebrow">Organization</p><h3>{{ activeOrganization?.name ?? 'Your organization' }}</h3><p>{{ formatLabel(activeOrganization?.role ?? 'owner') }} · {{ availableBusinesses.length }} businesses</p><small>One organization owns the businesses, assistant settings, knowledge, and billing relationship.</small><button class="outline-button small" type="button" @click="view = 'businesses'">Manage businesses →</button></article><article class="panel settings-card"><p class="eyebrow">Billing access</p><h3>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h3><p>{{ formatLabel(activeOrganization?.billing.status ?? 'trial') }} · {{ activeOrganization?.billing.access.allowed ? 'Write access enabled' : 'Read-only access' }}</p><small>Billing controls access to publishing, new businesses, and other write actions.</small><button class="outline-button small" type="button" @click="openSettingsTab('billing')">Open billing →</button></article></div>
          </template>
          <template v-else-if="currentSettingsTab === 'verification'">
            <div class="section-toolbar"><div><p class="eyebrow">Website verification</p><h2>Verification</h2><p>Verify the website connected to this business before installing the live widget.</p></div></div>
          </template>
          <template v-else-if="currentSettingsTab === 'notifications'">
            <div class="section-toolbar"><div><p class="eyebrow">Workspace updates</p><h2>Notifications</h2><p>Review operational updates for conversations, delivery, and account activity.</p></div><button class="outline-button small" type="button" @click="loadNotifications">Refresh</button></div>
            <article v-if="authSnapshot" class="panel notification-preferences-card"><div class="panel-heading"><div><p class="eyebrow">Owner preferences</p><h3>Operational email</h3><p>Choose which non-mandatory team updates reach you by email. Billing and security notices always stay on.</p></div><button class="primary-button small" type="button" :disabled="notificationPreferencesLoading" @click="saveNotificationPreferences">{{ notificationPreferencesLoading ? 'Saving…' : 'Save preferences' }}</button></div><div class="notification-preference-list"><label><span><strong>New qualified leads</strong><small>Get an email when a qualified inquiry is captured.</small></span><input v-model="notificationPreferences.newLead" type="checkbox" /></label><label><span><strong>Human handoffs</strong><small>Know when a visitor is waiting for a team member.</small></span><input v-model="notificationPreferences.humanHandoff" type="checkbox" /></label><label><span><strong>Integration failures</strong><small>Get notified when a connected CRM needs attention.</small></span><input v-model="notificationPreferences.integrationFailure" type="checkbox" /></label></div><p v-if="notificationPreferencesMessage" class="saved-message">✓ {{ notificationPreferencesMessage }}</p><p v-if="notificationPreferencesError" class="form-error">{{ notificationPreferencesError }}</p></article><article class="panel notification-settings-panel"><div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div><button v-for="notification in staffNotifications" :key="notification.id" class="notification-row" type="button" @click="markNotificationRead(notification); view = 'inbox'"><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></button></article>
          </template>
          <article v-if="authSnapshot && ownershipVerification && currentSettingsTab === 'verification'" class="panel verification-panel"><div class="panel-heading"><div><p class="eyebrow">Website ownership</p><h2>{{ ownershipVerification.status === 'verified' ? 'Ownership verified' : 'Verify before publishing' }}</h2><p>{{ ownershipVerification.status === 'verified' ? 'This business can publish its widget and receive production leads.' : 'Complete one verification method to protect production publishing.' }}</p></div><span :class="['status-pill', ownershipVerification.status === 'verified' ? 'booked' : ownershipVerification.status === 'rejected' ? 'new' : 'qualified']">{{ formatLabel(ownershipVerification.status) }}</span></div><div v-if="ownershipVerification.status !== 'verified'" class="verification-controls"><label>Method<select v-model="verificationMethod"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><button class="outline-button small" type="button" :disabled="verificationLoading" @click="requestOwnershipVerification">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethod !== 'email' && verificationMethod !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="checkOwnershipVerification">Check now</button></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="verificationMessage" class="saved-message">✓ {{ verificationMessage }}</p><p v-if="verificationError" class="form-error">{{ verificationError }}</p></article>
          <article v-if="currentSettingsTab === 'verification' && !ownershipVerification" class="panel empty-view"><div class="empty-icon">✓</div><h2>Verification is loading</h2><p>We’re checking the website ownership state for this business.</p></article>
        </div>

        <div v-else-if="view === 'billing'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One organization · every business</p><h2>Billing & plan</h2><p>Keep one subscription relationship as you add businesses to {{ activeOrganization?.name ?? 'your organization' }}.</p></div><div class="toolbar-actions"><span v-if="billingLoading" class="conversation-status">Working…</span><button v-if="billingSnapshot?.billing.providerCustomerId" class="outline-button small" type="button" @click="openBillingPortal">Manage billing ↗</button></div></div>
          <p v-if="billingError" class="form-error">{{ billingError }}</p>
          <p v-if="billingMessage" class="saved-message">✓ {{ billingMessage }}</p>
          <template v-if="billingSnapshot">
            <div v-if="billingSnapshot.billing.status === 'grace'" class="billing-alert warning">Payment needs attention. Your organization remains available until {{ formatBillingDate(billingSnapshot.billing.graceEndAt) }}.</div>
            <div v-else-if="billingSnapshot.billing.status === 'cancelled' || billingSnapshot.billing.status === 'paused'" class="billing-alert danger">Billing is {{ billingSnapshot.billing.status }}. Existing data remains visible, but new paid actions and businesses are paused until billing is restored.</div>
            <div class="billing-summary-grid">
              <article class="panel billing-status-card"><p class="eyebrow">Current status</p><div class="billing-status-line"><strong>{{ billingSnapshot.billing.plan.displayName }}</strong><span :class="['status-pill', billingSnapshot.billing.status === 'active' ? 'booked' : billingSnapshot.billing.status === 'trial' ? 'qualified' : 'new']">{{ formatLabel(billingSnapshot.billing.status) }}</span></div><p v-if="billingSnapshot.billing.status === 'trial'">Trial ends {{ formatBillingDate(billingSnapshot.billing.trialEndAt) }}</p><p v-else-if="billingSnapshot.billing.currentPeriodEndAt">Current period ends {{ formatBillingDate(billingSnapshot.billing.currentPeriodEndAt) }}</p><p v-else>{{ billingSnapshot.billing.mode === 'sandbox' ? 'Sandbox billing · no charge' : 'Choose a plan to activate billing.' }}</p><small v-if="billingSnapshot.billing.override">{{ billingSnapshot.billing.override.reason }}</small></article>
              <article class="panel billing-status-card"><p class="eyebrow">Business capacity</p><strong class="billing-big-number">{{ activeOrganization?.businesses.length ?? 0 }} <span>/ {{ billingSnapshot.billing.plan.maxBusinesses }}</span></strong><p>Businesses in this organization</p><div class="metric-progress"><span :style="{ width: `${Math.min(100, ((activeOrganization?.businesses.length ?? 0) / billingSnapshot.billing.plan.maxBusinesses) * 100)}%` }"></span></div></article>
              <article class="panel billing-status-card"><p class="eyebrow">Last 30 days</p><div class="billing-usage-stats"><span><strong>{{ billingSnapshot.usageLast30Days.conversations }}</strong> conversations</span><span><strong>{{ billingSnapshot.usageLast30Days.leads }}</strong> leads</span><span><strong>{{ billingSnapshot.usageLast30Days.bookings }}</strong> bookings</span></div></article>
            </div>
            <div class="section-toolbar billing-plans-heading"><div><p class="eyebrow">Flexible plans</p><h2>Choose the right operating level</h2><p>Pricing is organization-level. Client-specific founding terms are represented as a plan override, not a special code path.</p></div></div>
            <div class="billing-plan-grid"><article v-for="plan in billingSnapshot.plans" :key="plan.key" :class="['panel', 'billing-plan-card', { selected: plan.key === billingSnapshot.billing.planKey }]" ><div class="billing-plan-top"><h3>{{ plan.displayName }}</h3><span v-if="plan.key === billingSnapshot.billing.planKey" class="status-pill booked">Current</span></div><strong class="billing-price">{{ formatPlanPrice(plan) }}<small v-if="plan.amountCents !== null">/mo</small></strong><p>{{ plan.description }}</p><div class="billing-plan-meta">Up to {{ plan.maxBusinesses }} {{ plan.maxBusinesses === 1 ? 'business' : 'businesses' }}</div><button v-if="plan.key !== billingSnapshot.billing.planKey" class="primary-button small" type="button" :disabled="billingLoading || !billingSnapshot.stripeConfigured || !plan.checkoutReady" @click="startCheckout(plan)">{{ !billingSnapshot.stripeConfigured ? 'Contact support' : plan.checkoutReady ? 'Start subscription →' : 'Unavailable' }}</button><span v-else class="saved-message">✓ Active plan</span></article></div>
            <p v-if="!billingSnapshot.stripeConfigured" class="billing-note">Online subscription checkout is not available for this workspace yet. <a href="mailto:hello@frontdeskwise.com">Contact support</a> to activate a plan.</p>
          </template>
          <article v-else class="panel empty-view"><div class="empty-icon">$</div><h2>{{ billingError ? 'Billing unavailable' : 'Billing is loading' }}</h2><p>{{ billingError || 'Loading your organization plan and usage.' }}</p><button class="outline-button small" type="button" @click="loadBilling">{{ billingError ? 'Retry' : 'Refresh' }}</button></article>
        </div>

        <div v-else-if="view === 'admin' && isSuperAdmin" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Internal operations</p><h2>{{ adminSectionTitle }}</h2><p>Run the platform with a consistent view of organizations, access, demos, and system health.</p></div><div class="toolbar-actions"><span v-if="adminEmailTestMessage" class="saved-message">✓ {{ adminEmailTestMessage }}</span><button class="outline-button small" type="button" :disabled="adminEmailTestLoading" @click="testAdminEmail">{{ adminEmailTestLoading ? 'Sending…' : 'Test SES email' }}</button><span v-if="adminLoading" class="conversation-status">Working…</span></div></div>
          <nav class="admin-section-tabs" aria-label="Admin sections"><button v-for="item in adminNavItems" :key="item.id" type="button" :class="{ active: adminSection === item.id }" @click="adminSection = item.id">{{ item.label }}</button></nav>
          <p v-if="adminError" class="form-error">{{ adminError }}</p>
          <template v-if="adminSection === 'overview'">
            <div class="ds-stat-grid admin-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue">▦</span><strong>{{ adminOrganizations.length }}</strong><small>Organizations</small><em>{{ adminTrialCount }} on trial</em></article><article class="ds-stat-card"><span class="ds-stat-icon green">♧</span><strong>{{ adminLeadTotal }}</strong><small>Leads captured</small><em>Across all tenants</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange">◌</span><strong>{{ adminConversationTotal }}</strong><small>Conversations</small><em>Persisted outcomes</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple">⚡</span><strong>{{ adminPausedCount + adminFailedDemoCount }}</strong><small>Needs attention</small><em>{{ adminDisabledUserCount }} disabled users</em></article></div>
            <div class="admin-overview-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Platform health</p><h2>Know what is breaking</h2><p>Live checks for the API, database, storage, and email delivery.</p></div><span :class="['status-pill', adminHealth?.api === 'healthy' ? 'booked' : adminHealth?.api === 'degraded' ? 'qualified' : 'new']">{{ adminHealth?.api ?? 'checking' }}</span></div><div class="health-list"><div><span>API and database</span><strong>{{ adminHealth?.database ?? 'Checking…' }}</strong></div><div><span>Private storage</span><strong>{{ adminHealth?.objectStorageConfigured ? 'Configured' : 'Needs setup' }}</strong></div><div><span>Email delivery</span><strong>{{ adminHealth?.emailConfigured ? 'Configured' : 'Needs setup' }}</strong></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Attention queue</p><h2>Operator follow-up</h2><p>Small, explicit queues keep the control plane useful.</p></div></div><div class="admin-attention-list"><button type="button" @click="adminSection = 'organizations'"><span>Paused organizations</span><strong>{{ adminPausedCount }}</strong></button><button type="button" @click="adminSection = 'demos'"><span>Failed or expired demos</span><strong>{{ adminFailedDemoCount }}</strong></button><button type="button" @click="adminSection = 'installation-support'"><span>New installation requests</span><strong>{{ installationSupportSummary.new }}</strong></button><button type="button" @click="adminSection = 'users'"><span>Disabled users</span><strong>{{ adminDisabledUserCount }}</strong></button></div></article></div>
          </template>
          <article v-if="adminSection === 'overview' || adminSection === 'organizations'" class="panel table-panel admin-table-panel"><div class="table-heading admin-row"><span>Organization</span><span>Plan / status</span><span>Businesses</span><span>Outcomes</span><span>Actions</span></div><div v-if="!adminOrganizations.length" class="diagnostics-empty">No organizations found.</div><div v-for="organization in adminOrganizations" :key="organization.id" class="table-row admin-row"><div><strong>{{ organization.name }}</strong><small>{{ organization.ownerEmail ?? 'No owner email' }}</small></div><div><strong>{{ organization.planName }}</strong><small>{{ organization.status }} · {{ organization.mode }}</small></div><span>{{ organization.businessCount }}</span><span><strong>{{ organization.leadCount }}</strong> leads · {{ organization.conversationCount }} conversations</span><div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading || adminOrganizationDetailLoading" @click="loadAdminOrganizationDetail(organization.id)">Inspect</button><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'trial')">30-day trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'suspend')">Suspend</button></div></div></article>
          <template v-if="adminSection === 'business-detail'">
            <div v-if="adminBusinessDetailLoading" class="ds-card admin-detail-loading">Loading business detail…</div>
            <template v-else-if="adminBusinessDetail">
              <div class="section-toolbar admin-detail-toolbar"><div><p class="eyebrow">Business detail</p><h2>{{ adminBusinessDetail.business.name }}</h2><p>{{ adminBusinessDetail.business.websiteUrl }} · {{ adminBusinessDetail.business.slug }}</p></div><div class="toolbar-actions"><button v-if="adminBusinessDetail.business.ownershipStatus !== 'verified'" class="outline-button small" type="button" :disabled="adminLoading" @click="approveAdminBusiness(adminBusinessDetail.business)">Approve ownership</button><button class="outline-button small" type="button" @click="navigateToAdminSection('organizations')">← Back</button></div></div>
              <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue">▤</span><strong>{{ adminBusinessDetail.business.sourceCount }}</strong><small>Knowledge sources</small><em>{{ adminBusinessDetail.business.chunkCount }} indexed chunks</em></article><article class="ds-stat-card"><span class="ds-stat-icon green">♧</span><strong>{{ adminBusinessDetail.business.leadCount }}</strong><small>Leads captured</small><em>Persisted outcomes</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange">◌</span><strong>{{ adminBusinessDetail.business.conversationCount }}</strong><small>Conversations</small><em>Customer activity</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple">$</span><strong>{{ adminBusinessDetail.business.billingStatus }}</strong><small>Billing status</small><em>{{ adminBusinessDetail.business.ownershipStatus }} ownership</em></article></div>
              <div class="admin-detail-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Business context</p><h2>{{ adminBusinessDetail.organization.name }}</h2><p>{{ adminBusinessDetail.business.location || 'Location not provided' }} · Updated {{ adminBusinessDetail.business.updatedAt ? new Date(adminBusinessDetail.business.updatedAt).toLocaleDateString() : 'not yet' }}</p></div></div><div class="health-list"><div><span>Plan</span><strong>{{ adminBusinessDetail.business.planKey }}</strong></div><div><span>Ownership</span><strong>{{ adminBusinessDetail.business.ownershipStatus }}</strong></div><div><span>Organization access</span><strong>{{ adminBusinessDetail.organization.billing.access.allowed ? 'Write access' : 'Read-only' }}</strong></div></div><div class="detail-subsection"><p class="eyebrow">Organization members</p><div v-for="owner in adminBusinessDetail.owners" :key="`${owner.email}-${owner.role}`" class="detail-list-row"><span><strong>{{ owner.name || 'Unnamed user' }}</strong><small>{{ owner.email }}</small></span><span class="status-pill qualified">{{ owner.role }}</span></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Billing relationship</p><h2>{{ adminBusinessDetail.organization.billing.plan.displayName }}</h2><p>Business access follows the organization billing relationship.</p></div></div><div class="billing-intervention-note"><strong>Current organization billing</strong><span>{{ adminBusinessDetail.organization.billing.status }} · {{ adminBusinessDetail.organization.billing.amountCents === null ? 'No amount' : `$${(adminBusinessDetail.organization.billing.amountCents / 100).toFixed(2)}` }}</span><small>{{ adminBusinessDetail.organization.billing.access.reason }}</small></div><button class="outline-button small" type="button" @click="navigateToAdminSection('organization-detail', { organizationId: adminBusinessDetail.organization.id })">Open organization billing →</button></article></div>
            </template>
          </template>
          <template v-if="adminSection === 'organization-detail'">
            <div v-if="adminOrganizationDetailLoading" class="ds-card admin-detail-loading">Loading organization detail…</div>
            <template v-else-if="adminOrganizationDetail">
              <div class="section-toolbar admin-detail-toolbar"><div><p class="eyebrow">Organization detail</p><h2>{{ adminOrganizationDetail.organization.name }}</h2><p>{{ adminOrganizationDetail.organization.slug }} · inspect business health and apply audited billing interventions.</p></div><div class="toolbar-actions"><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminDetailBillingAction('trial')">Extend trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminDetailBillingAction('suspend')">Suspend</button><button class="outline-button small" type="button" @click="adminSection = 'organizations'">← Back</button></div></div>
              <p v-if="adminBillingMessage" class="saved-message">✓ {{ adminBillingMessage }}</p>
              <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue">$</span><strong>{{ adminOrganizationDetail.organization.billing.plan.displayName }}</strong><small>Current plan</small><em>{{ adminOrganizationDetail.organization.billing.status }}</em></article><article class="ds-stat-card"><span class="ds-stat-icon green">▦</span><strong>{{ adminOrganizationDetail.businesses.length }} / {{ adminOrganizationDetail.organization.billing.plan.maxBusinesses }}</strong><small>Business capacity</small><em>{{ adminOrganizationDetail.organization.billing.access.allowed ? 'Write access' : 'Read-only' }}</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange">♧</span><strong>{{ adminOrganizationDetail.businesses.reduce((total, business) => total + business.leadCount, 0) }}</strong><small>Leads captured</small><em>Across businesses</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple">◌</span><strong>{{ adminOrganizationDetail.businesses.reduce((total, business) => total + business.conversationCount, 0) }}</strong><small>Conversations</small><em>{{ adminOrganizationDetail.owners.length }} members</em></article></div>
              <div class="admin-detail-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Businesses & access</p><h2>Business health</h2><p>Review ownership, billing projection, source coverage, and activity before taking action.</p></div></div><div v-if="!adminOrganizationDetail.businesses.length" class="diagnostics-empty">No businesses are attached to this organization.</div><div v-for="business in adminOrganizationDetail.businesses" :key="business.id" class="admin-business-detail-row"><div><strong>{{ business.name }}</strong><small>{{ business.websiteUrl }} · {{ business.slug }}</small></div><div class="admin-business-metrics"><span>{{ business.sourceCount }} sources</span><span>{{ business.leadCount }} leads</span><span>{{ business.conversationCount }} conversations</span></div><div class="admin-business-status"><span :class="['status-pill', business.ownershipStatus === 'verified' ? 'booked' : 'qualified']">{{ business.ownershipStatus }}</span><span :class="['status-pill', business.billingStatus === 'active' || business.billingStatus === 'trial' ? 'booked' : 'new']">{{ business.billingStatus }}</span></div><button v-if="business.ownershipStatus !== 'verified'" class="outline-button small" type="button" :disabled="adminLoading" @click="approveAdminBusiness(business)">Approve ownership</button><span v-else class="saved-message">✓ Verified</span></div><div class="detail-subsection"><p class="eyebrow">Organization members</p><div v-for="owner in adminOrganizationDetail.owners" :key="`${owner.email}-${owner.role}`" class="detail-list-row"><span><strong>{{ owner.name || 'Unnamed user' }}</strong><small>{{ owner.email }}</small></span><span class="status-pill qualified">{{ owner.role }}</span></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Billing intervention</p><h2>Apply a controlled override</h2><p>Use a documented reason. This updates the organization and projected business billing state.</p></div></div><form class="admin-detail-form" @submit.prevent="saveAdminPlanOverride"><label>Plan<select v-model="adminOverridePlanKey"><option value="starter">Starter</option><option value="growth">Growth</option><option value="multi_business">Multi-Business</option><option value="portfolio">Portfolio</option></select></label><div class="admin-detail-form-grid"><label>Interval<select v-model="adminOverrideInterval"><option value="month">Monthly</option><option value="year">Yearly</option></select></label><label>Amount (cents)<input v-model="adminOverrideAmountCents" type="number" min="0" step="1" inputmode="numeric" /></label><label>Max businesses<input v-model="adminOverrideMaxBusinesses" type="number" min="1" step="1" inputmode="numeric" /></label></div><label>Reason<textarea v-model="adminOverrideReason" rows="3" placeholder="Founding customer pricing, service recovery, or approved exception"></textarea></label><button class="primary-button small" type="submit" :disabled="adminLoading">{{ adminLoading ? 'Saving…' : 'Save intervention →' }}</button></form><div class="billing-intervention-note"><strong>Current billing</strong><span>{{ adminOrganizationDetail.organization.billing.status }} · {{ adminOrganizationDetail.organization.billing.plan.displayName }} · {{ adminOrganizationDetail.organization.billing.amountCents === null ? 'No amount' : `$${(adminOrganizationDetail.organization.billing.amountCents / 100).toFixed(2)}` }}</span><small v-if="adminOrganizationDetail.organization.billing.override">Existing override: {{ adminOrganizationDetail.organization.billing.override.reason }}</small></div></article></div>
            </template>
          </template>
          <article v-if="adminSection === 'users'" class="panel table-panel admin-table-panel admin-users-panel"><div class="panel-heading"><div><p class="eyebrow">Account control</p><h2>Users & access</h2><p>Review who has access to each organization and disable accounts without touching their stored data.</p></div><button class="outline-button small" type="button" :disabled="adminLoading" @click="loadAdminUsers">Refresh users</button></div><div class="table-heading admin-user-row"><span>User</span><span>Organizations</span><span>Status</span><span>Action</span></div><div v-if="!adminUsers.length" class="diagnostics-empty">No application users found.</div><div v-for="user in adminUsers" :key="user.id" class="table-row admin-user-row"><div><strong>{{ user.name || 'Unnamed user' }}</strong><small>{{ user.email }}<span v-if="user.isSuperAdmin"> · super-admin</span></small></div><span>{{ user.organizationSummary }}</span><span :class="['status-pill', user.status === 'active' ? 'booked' : 'new']">{{ user.status }}</span><div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading || user.isSuperAdmin" @click="adminUserAction(user, user.status === 'active' ? 'disabled' : 'active')">{{ user.status === 'active' ? 'Disable' : 'Enable' }}</button></div></div></article>
          <article v-if="adminSection === 'demos'" class="panel admin-demo-operations">
            <div class="panel-heading"><div><p class="eyebrow">Demo operations</p><h2>Requests, test users & access links</h2><p>Every visitor request and operator action is audited. Generated links are copied once and can be reset, extended, revoked, or validated.</p></div><div class="admin-demo-summary"><span>{{ adminDemoSummary.total }} total</span><span>{{ adminDemoSummary.ready }} ready</span><span>{{ adminDemoSummary.converted }} converted</span></div></div>
            <div class="admin-demo-create">
              <input v-model="adminBusinessSlug" type="text" placeholder="Business slug" aria-label="Business slug for test link" />
              <input v-model="adminRecipientName" type="text" placeholder="Test user name" aria-label="Test user name" />
              <input v-model="adminRecipientEmail" type="email" placeholder="Test user email" aria-label="Test user email" />
              <button class="primary-button small" type="button" :disabled="adminLoading" @click="generateAdminDemoLink">Generate test link →</button>
            </div>
            <div v-if="adminGeneratedLink" class="admin-generated-link"><strong>Latest link</strong><code>{{ adminGeneratedLink }}</code><button class="outline-button small" type="button" @click="copyAdminLink">Copy</button></div>
            <div v-if="!adminDemoRequests.length" class="diagnostics-empty">No demo requests yet. Generate a test link or submit the landing form.</div>
            <div v-for="item in adminDemoRequests" :key="item.id" class="admin-demo-row">
              <div class="admin-demo-identity"><strong>{{ item.requesterName || 'Anonymous visitor' }}</strong><small>{{ item.requesterEmail || item.websiteUrl }}</small><small>{{ item.businessName || item.businessSlug || 'Crawl pending' }}</small></div>
              <div><span :class="['status-pill', item.status === 'converted' || item.status === 'claimed' ? 'booked' : item.status === 'expired' || item.status === 'revoked' || item.status === 'failed' ? 'new' : 'qualified']">{{ item.status }}</span><small>{{ item.accessCount }} access{{ item.accessCount === 1 ? '' : 'es' }} · {{ item.session?.openCount ?? 0 }} opens</small></div>
              <div><small>Requested {{ item.requestedAt ? new Date(item.requestedAt).toLocaleString() : '—' }}</small><small>Expires {{ item.session?.expiresAt ? new Date(item.session.expiresAt).toLocaleString() : '—' }}</small></div>
              <div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading || !item.businessSlug" @click="adminDemoAction(item, 'validate')">Validate</button><button class="outline-button small" type="button" :disabled="adminLoading || !item.session" @click="adminDemoAction(item, 'extend')">Extend 7d</button><button class="outline-button small" type="button" :disabled="adminLoading || !item.businessSlug" @click="adminDemoAction(item, 'reset')">New link</button><button class="text-button" type="button" :disabled="adminLoading || !item.session" @click="adminDemoAction(item, 'revoke')">Revoke</button></div>
            </div>
          </article>
          <article v-if="adminSection === 'installation-support'" class="panel installation-support-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Customer onboarding</p><h2>Installation support requests</h2><p>Self-service first, human help one click away. Every request includes the website and widget context your team needs.</p></div><div class="toolbar-actions"><span v-if="installationSupportMessage" class="saved-message">✓ {{ installationSupportMessage }}</span><button class="outline-button small" type="button" :disabled="installationSupportLoading" @click="loadAdminInstallationSupport">{{ installationSupportLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon orange">!</span><strong>{{ installationSupportSummary.new }}</strong><small>New</small><em>Needs first response</em></article><article class="ds-stat-card"><span class="ds-stat-icon blue">↗</span><strong>{{ installationSupportSummary.inProgress }}</strong><small>In progress</small><em>Assigned or being handled</em></article><article class="ds-stat-card"><span class="ds-stat-icon green">✓</span><strong>{{ installationSupportSummary.resolved }}</strong><small>Resolved</small><em>Closed requests</em></article></div>
            <p v-if="installationSupportError" class="form-error">{{ installationSupportError }}</p>
            <div class="table-heading installation-support-row"><span>Business / owner</span><span>Platform / request</span><span>Install context</span><span>Owner</span><span>Status</span></div>
            <div v-if="!installationSupportRequests.length" class="diagnostics-empty">No installation support requests yet.</div>
            <div v-for="item in installationSupportRequests" :key="item.id" class="table-row installation-support-row">
              <div><strong>{{ item.businessName }}</strong><small>{{ item.websiteUrl }}</small><small>{{ item.requesterName }} · {{ item.requesterEmail }}</small></div>
              <div><span class="status-pill qualified">{{ formatLabel(item.platform) }}</span><small>{{ item.helpRequest }}</small><small v-if="item.message">{{ item.message }}</small><a v-if="item.screenshotUrl" :href="item.screenshotUrl" target="_blank" rel="noreferrer">View screenshot ↗</a></div>
              <div><small>Verification: {{ item.ownershipStatus }}</small><small>Widget: {{ item.widgetDetected ? `Detected · ${item.widgetLoadCount} load${item.widgetLoadCount === 1 ? '' : 's'}` : 'Not detected' }}</small><small v-if="item.widgetLastLoadedAt">Last seen {{ new Date(item.widgetLastLoadedAt).toLocaleString() }}</small></div>
              <select v-model="item.assignedUserId" aria-label="Assign installation support request" :disabled="installationSupportLoading" @change="updateAdminInstallationSupport(item)"><option :value="null">Unassigned</option><option v-for="assignee in installationSupportAssignees" :key="assignee.id" :value="assignee.id">{{ assignee.name || assignee.email }}</option></select>
              <select v-model="item.status" aria-label="Update installation support status" :disabled="installationSupportLoading" @change="updateAdminInstallationSupport(item)"><option value="new">New</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
            </div>
          </article>
          <article v-if="adminSection === 'messaging'" class="panel messaging-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Lifecycle messaging</p><h2>Centralized communication control</h2><p>Manage transactional templates, activation automations, and delivery health without putting email logic in product requests.</p></div><div class="toolbar-actions"><span v-if="messagingSummary" class="status-pill" :class="messagingSummary.provider.configured ? 'booked' : 'new'">{{ messagingSummary.provider.configured ? 'Provider ready' : 'Provider setup needed' }}</span><button class="outline-button small" type="button" :disabled="messagingLoading" @click="loadAdminMessaging(true)">Refresh</button></div></div>
            <div v-if="messagingSummary" class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue">↗</span><strong>{{ messagingSummary.last24Hours.queued }}</strong><small>Queued · last 24h</small><em>Async delivery</em></article><article class="ds-stat-card"><span class="ds-stat-icon green">✓</span><strong>{{ messagingSummary.last24Hours.sent }}</strong><small>Sent · last 24h</small><em>SES accepted</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange">!</span><strong>{{ messagingSummary.last24Hours.deferred }}</strong><small>Deferred</small><em>Retrying automatically</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple">▤</span><strong>{{ messagingSummary.last24Hours.failed }}</strong><small>Failed</small><em>Needs review</em></article></div>
            <nav class="admin-section-tabs messaging-tabs" aria-label="Messaging sections"><button v-for="tab in messagingTabs" :key="tab.id" type="button" :class="{ active: messagingTab === tab.id }" @click="messagingTab = tab.id">{{ tab.label }}</button></nav>
            <p v-if="messagingError" class="form-error">{{ messagingError }}</p><p v-if="messagingMessage" class="saved-message">✓ {{ messagingMessage }}</p>
            <template v-if="messagingTab === 'templates'">
              <div class="messaging-template-layout">
                <aside class="messaging-template-list"><button v-for="template in messagingTemplates" :key="template.templateKey" type="button" :class="['messaging-template-item', { active: selectedMessagingTemplateKey === template.templateKey }]" @click="selectMessagingTemplate(template)"><span><strong>{{ template.name }}</strong><small>{{ template.description }}</small></span><em :class="['status-pill', template.status === 'active' ? 'booked' : 'new']">{{ template.status }}</em></button></aside>
                <form v-if="messagingTemplateDraft" class="messaging-template-editor" @submit.prevent="saveMessagingTemplate"><div class="panel-heading"><div><p class="eyebrow">Version {{ messagingTemplateDraft.version }}</p><h3>{{ messagingTemplateDraft.name }}</h3><p>{{ messagingTemplateDraft.description }}</p></div><span class="status-pill qualified">{{ formatLabel(messagingTemplateDraft.category) }}</span></div><div class="admin-detail-form-grid"><label>Subject<input v-model="messagingTemplateDraft.subject" required maxlength="240" /></label><label>Status<select v-model="messagingTemplateDraft.status"><option value="active">Active</option><option value="draft">Draft</option><option value="disabled">Disabled</option></select></label></div><label>Preview text<input v-model="messagingTemplateDraft.previewText" maxlength="240" /></label><label>Heading<input v-model="messagingTemplateDraft.heading" required maxlength="240" /></label><label>Body<textarea v-model="messagingTemplateDraft.body" rows="9" required></textarea></label><div class="admin-detail-form-grid"><label>CTA label<input v-model="messagingTemplateDraft.ctaLabel" maxlength="120" /></label><label>CTA URL<input v-model="messagingTemplateDraft.ctaUrl" maxlength="1000" /></label></div><label>Footer<input v-model="messagingTemplateDraft.footer" maxlength="1000" /></label><div class="messaging-variable-row"><span>Available variables</span><code v-for="variable in messagingTemplateDraft.variables" :key="variable">{{ formatTemplateVariable(variable) }}</code></div><div class="messaging-test-row"><input v-model="messagingTestRecipient" type="email" placeholder="Test recipient (optional)" /><button class="outline-button small" type="button" :disabled="messagingTestLoading" @click="testMessagingTemplate">{{ messagingTestLoading ? 'Sending…' : 'Send test' }}</button><button class="primary-button small" type="submit" :disabled="messagingLoading">{{ messagingLoading ? 'Saving…' : 'Save template →' }}</button></div></form>
              </div>
            </template>
            <template v-else-if="messagingTab === 'automations'"><div class="messaging-automation-list"><div v-for="automation in messagingAutomations" :key="automation.automationKey" class="messaging-automation-row"><div><strong>{{ automation.templateName }}</strong><small>{{ formatLabel(automation.eventType) }} · {{ formatLabel(automation.recipientScope) }}<span v-if="automation.mandatory"> · mandatory</span></small></div><label class="messaging-toggle"><input v-model="automation.enabled" type="checkbox" :disabled="automation.mandatory" @change="updateMessagingAutomation(automation)" /><span>{{ automation.enabled ? 'Active' : 'Off' }}</span></label><label class="messaging-delay">Delay<input v-model.number="automation.delaySeconds" type="number" min="0" max="2592000" step="1" @change="updateMessagingAutomation(automation)" /><small>seconds</small></label></div></div></template>
            <template v-else-if="messagingTab === 'delivery'"><div class="section-toolbar compact"><div><p class="eyebrow">Provider delivery log</p><h3>Recent messages</h3></div><select v-model="messagingDeliveryFilter" @change="loadAdminMessaging(true)"><option value="all">All statuses</option><option value="queued">Queued</option><option value="sent">Sent</option><option value="deferred">Deferred</option><option value="failed">Failed</option></select></div><div class="table-heading messaging-delivery-row"><span>Message</span><span>Recipient</span><span>Status</span><span>Time</span><span></span></div><div v-if="!messagingDeliveries.length" class="diagnostics-empty">No lifecycle deliveries found.</div><div v-for="delivery in messagingDeliveries" :key="delivery.id" class="table-row messaging-delivery-row"><div><strong>{{ delivery.templateName }}</strong><small>{{ delivery.businessName || 'Account' }} · {{ formatLabel(delivery.eventType) }}</small></div><span>{{ delivery.recipientEmail }}</span><span :class="['status-pill', delivery.status === 'sent' || delivery.status === 'delivered' ? 'booked' : delivery.status === 'failed' ? 'new' : 'qualified']">{{ delivery.status }}</span><span>{{ delivery.sentAt ? new Date(delivery.sentAt).toLocaleString() : delivery.scheduledAt ? new Date(delivery.scheduledAt).toLocaleString() : '—' }}</span><button v-if="delivery.status === 'failed' || delivery.status === 'deferred'" class="outline-button small" type="button" :disabled="messagingLoading" @click="retryMessagingDelivery(delivery)">Retry</button><span v-else></span></div></template>
            <template v-else><div class="messaging-settings-grid"><article class="ds-card"><p class="eyebrow">Provider</p><h3>{{ messagingSummary?.provider.name.toUpperCase() ?? 'SES' }}</h3><p>{{ messagingSummary?.provider.configured ? 'Configured for transactional delivery.' : 'Set AWS_REGION and FRONTDESKWISE_SES_FROM_EMAIL to enable delivery.' }}</p><small>Provider delivery IDs are stored on each message. Provider dashboards are not the canonical template source.</small></article><article class="ds-card"><p class="eyebrow">Guardrails</p><h3>Operational control stays explicit</h3><p>Super Admins manage lifecycle templates and automations. Business owners manage noisy operational notifications.</p><small>Billing, payment, and security notices remain mandatory.</small></article></div></template>
          </article>
          <div v-if="adminSection === 'operations'" class="admin-overview-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">System health</p><h2>Infrastructure readiness</h2><p>Refresh this page after changing Render, storage, email, or model configuration.</p></div><button class="outline-button small" type="button" @click="loadAdminHealth">Refresh checks</button></div><div class="health-list health-list-large"><div><span>API</span><strong :class="`health-${adminHealth?.api ?? 'degraded'}`">{{ adminHealth?.api ?? 'Checking…' }}</strong></div><div><span>Database</span><strong>{{ adminHealth?.database ?? 'Checking…' }}</strong></div><div><span>Object storage</span><strong>{{ adminHealth?.objectStorageConfigured ? 'Ready' : 'Not configured' }}</strong></div><div><span>Transactional email</span><strong>{{ adminHealth?.emailConfigured ? 'Ready' : 'Not configured' }}</strong></div><div><span>Stripe billing</span><strong>{{ adminHealth?.stripeConfigured ? 'Ready' : 'Not configured' }}</strong></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Delivery test</p><h2>Email operations</h2><p>Send a controlled SES test to the authenticated super-admin address.</p></div></div><button class="primary-button small" type="button" :disabled="adminEmailTestLoading" @click="testAdminEmail">{{ adminEmailTestLoading ? 'Sending…' : 'Send test email →' }}</button><p v-if="adminEmailTestMessage" class="saved-message">✓ {{ adminEmailTestMessage }}</p></article></div>
        </div>

        <div v-else class="view-content empty-view"><div class="empty-icon">ϟ</div><p class="eyebrow">{{ pageTitle }}</p><h2>This page is unavailable</h2><p>Return to the overview and choose a workspace section.</p><button class="primary-button small" type="button" @click="view = 'overview'">Back to overview</button></div>
      </section>
    </section>

    <div v-if="addBusinessOpen" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="add-business-title" @click.self="addBusinessOpen = false">
      <form class="auth-card" @submit.prevent="createBusiness">
        <button class="auth-close" type="button" aria-label="Close" @click="addBusinessOpen = false">×</button>
        <p class="eyebrow">{{ activeOrganization?.name ?? 'Your organization' }}</p>
        <h2 id="add-business-title">Add another business</h2>
        <p class="auth-copy">Paste a public website URL. FrontDeskWise will crawl it and add the new business to this organization, subject to your plan capacity.</p>
        <label>Business website<input v-model="addBusinessUrl" type="text" inputmode="url" required placeholder="yourbusiness.com" /></label>
        <p v-if="addBusinessError" class="form-error">{{ addBusinessError }}</p>
        <p v-if="addBusinessMessage" class="saved-message">✓ {{ addBusinessMessage }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="addBusinessLoading">{{ addBusinessLoading ? 'Crawling website…' : 'Add business →' }}</button>
      </form>
    </div>

    <div v-if="generationDialogOpen" class="generation-overlay" role="dialog" aria-modal="true" aria-labelledby="generation-title">
      <section class="generation-dialog">
        <div class="generation-orbit" aria-hidden="true"><span></span><i></i></div>
        <p class="eyebrow">Your workspace is taking shape</p>
        <h2 id="generation-title">Building your AI front desk</h2>
        <p class="generation-copy">We’re checking the public website, learning the important business details, and organizing them into a workspace you can review.</p>
        <div class="generation-steps" aria-live="polite">
          <div :class="['generation-step', { active: generationStage === 'checking', complete: generationStage !== 'checking' }]"><span>{{ generationStage === 'checking' ? '·' : '✓' }}</span><div><strong>Checking your website</strong><small>Making sure the URL is reachable</small></div></div>
          <div :class="['generation-step', { active: generationStage === 'learning', complete: generationStage === 'organizing' }]"><span>{{ generationStage === 'organizing' ? '✓' : generationStage === 'learning' ? '·' : '2' }}</span><div><strong>Learning your business</strong><small>Finding services, locations, and helpful answers</small></div></div>
          <div :class="['generation-step', { active: generationStage === 'organizing' }]"><span>{{ generationStage === 'organizing' ? '·' : '3' }}</span><div><strong>Preparing your workspace</strong><small>Turning the crawl into a reviewable front desk</small></div></div>
        </div>
        <div v-if="generationError" class="generation-error"><strong>We couldn’t finish that website yet.</strong><p>{{ generationError }}</p><small>Try the URL again, or use a public homepage that does not require a login.</small></div>
        <div v-if="generationError" class="generation-actions"><button class="outline-button small" type="button" @click="closeGenerationDialog">Back to landing page</button><button class="primary-button small" type="button" @click="generateDemo">Try again →</button></div>
      </section>
    </div>

    <div v-if="leadDetailOpen && selectedLead" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="lead-detail-title" @click.self="leadDetailOpen = false">
      <form class="auth-card lead-detail-card" @submit.prevent="saveLeadDetail">
        <button class="auth-close" type="button" aria-label="Close" @click="leadDetailOpen = false">×</button>
        <p class="eyebrow">Lead record</p>
        <h2 id="lead-detail-title">{{ selectedLead.name }}</h2>
        <p class="auth-copy">{{ selectedLead.email || selectedLead.phone || 'No direct contact details provided' }} · captured {{ selectedLead.time }}</p>
        <label>Status<select v-model="leadDetailStatus"><option value="New">New</option><option value="Qualified">Qualified</option><option value="Booked">Booked</option></select></label>
        <label>Internal notes<textarea v-model="leadDetailNotes" rows="5" placeholder="Add context for the team…"></textarea></label>
        <p class="lead-detail-meta"><span>Intent: {{ selectedLead.intent }}</span><span>Source: {{ selectedLead.source }}</span></p>
        <div class="lead-detail-actions"><button class="outline-button small danger-text" type="button" :disabled="leadDetailLoading" @click="deleteLead">Delete record</button><button class="primary-button auth-submit" type="submit" :disabled="leadDetailLoading">{{ leadDetailLoading ? 'Saving…' : 'Save lead →' }}</button></div>
      </form>
    </div>

    <div v-if="authModalOpen" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title" @click.self="authModalOpen = false">
      <form class="auth-card" @submit.prevent="authMode === 'forgot' ? resetPassword() : submitAuth()">
        <button class="auth-close" type="button" aria-label="Close" @click="authModalOpen = false">×</button>
        <p class="eyebrow">{{ authMode === 'signup' ? 'Save your AI front desk' : authMode === 'forgot' ? 'Account recovery' : 'Welcome back' }}</p>
        <h2 id="auth-title">{{ authMode === 'signup' ? 'Create your FrontDeskWise account' : authMode === 'forgot' ? 'Reset your password' : 'Sign in to FrontDeskWise' }}</h2>
        <p class="auth-copy">{{ authMode === 'signup' ? (publicDemoMode ? 'Your workspace stays attached to your new organization.' : 'Create your organization and add your first business.') : authMode === 'forgot' ? 'Enter your email and we will send password recovery instructions.' : 'Pick up where you left off across all your businesses.' }}</p>
        <label>Email<input v-model="authEmail" type="email" autocomplete="email" required placeholder="name@company.com" /></label>
        <label v-if="authMode !== 'forgot'">Password<input v-model="authPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters" /></label>
        <label v-if="authMode === 'signup'">Organization name <span class="optional">optional</span><input v-model="authOrganizationName" type="text" placeholder="Your company" /></label>
        <p v-if="authError" class="form-error">{{ authError }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="authLoading">{{ authLoading ? 'Working…' : authMode === 'signup' ? 'Create account →' : authMode === 'forgot' ? 'Send reset instructions' : 'Sign in →' }}</button>
        <template v-if="authMode !== 'forgot'"><div class="auth-divider"><span>or</span></div><button class="google-button" type="button" :disabled="authLoading" @click="submitGoogleAuth"><span class="google-mark">G</span> Continue with Google</button></template>
        <button v-if="authMode === 'signin'" class="text-button auth-switch" type="button" @click="openAuth('forgot')">Forgot password?</button>
        <button class="text-button auth-switch" type="button" @click="openAuth(authMode === 'signup' ? 'signin' : 'signup')">{{ authMode === 'signup' ? 'Already have an account? Sign in' : authMode === 'forgot' ? 'Back to sign in' : 'New to FrontDeskWise? Create an account' }}</button>
      </form>
    </div>

    <AppFeedback :loading="globalLoading || authLoading" :toasts="feedbackToasts" @dismiss="dismissToast" />
  </main>
</template>

