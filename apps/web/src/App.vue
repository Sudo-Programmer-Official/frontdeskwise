<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  Activity,
  ArrowLeft,
  ArrowDown,
  ArrowRight,
  BadgeCheck,
  Bell,
  BookOpen,
  Building2,
  Cable,
  CalendarCheck,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  ContactRound,
  Code2,
  Database,
  DollarSign,
  FileText,
  Gauge,
  Headset,
  House,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Package,
  RefreshCw,
  RotateCcw,
  Scale,
  Scissors,
  Send,
  Settings,
  ShieldCheck,
  Smile,
  Snowflake,
  Sparkles,
  TriangleAlert,
  UserCheck,
  UserRoundPlus,
  UsersRound,
  Waves,
  Workflow,
  X,
  Zap,
  type LucideIcon,
} from "@lucide/vue";
import { siHubspot, siMake, siZapier, type SimpleIcon } from "simple-icons";
import {
  currentAuthSnapshot,
  currentFirebaseToken,
  firebaseAuthConfigured,
  observeFirebaseUser,
  resendFrontDeskWiseVerificationEmail,
  sendFrontDeskWisePasswordReset,
  confirmFrontDeskWisePasswordReset,
  verifyFrontDeskWisePasswordResetCode,
  signInAndBootstrap,
  signInWithGoogleAndBootstrap,
  signOutFrontDeskWise,
  signUpAndBootstrap,
  AuthSessionExpiredError,
  type AuthSnapshot,
} from "./auth/firebase";
import AppFeedback, { type AppToast, type AppToastKind } from "./AppFeedback.vue";
import LandingVideo from "./components/LandingVideo.vue";
import type { SupportCase as SupportCaseRecord, SupportCaseCategory, SupportContext } from "./components/SupportCenter.vue";
import type { WorkflowBusinessContext } from "./workflow-generator.js";
import {
  identifyMixpanelUser,
  initializeMixpanel,
  MIXPANEL_EVENTS,
  resetMixpanelUser,
  setMixpanelContext,
  trackMixpanel,
  trackMixpanelOnce,
} from "./analytics/mixpanel";
import { safeUrlHost } from "./analytics/mixpanel-schema";
import type { MixpanelContext } from "./analytics/mixpanel-schema";
import { getMarketingPageByPath } from "./marketing";
import {
  existingPushSubscription,
  initializePwa,
  installPwa,
  isStandalonePwa,
  notificationPermission,
  pushSupported,
  subscribeToPush,
  unsubscribeFromPush,
} from "./pwa";
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

// Keep route-only surfaces out of the initial shell. These components carry the
// largest editor, analytics, and support bundles and are only needed after the
// owner navigates to the corresponding route.
const AgentExperience = defineAsyncComponent(() => import("./AgentExperience.vue"));
const MarketingPage = defineAsyncComponent(() => import("./MarketingPage.vue"));
const LegalPage = defineAsyncComponent(() => import("./LegalPage.vue"));
const PartnerPortal = defineAsyncComponent(() => import("./PartnerPortal.vue"));
const SupportCenter = defineAsyncComponent(() => import("./components/SupportCenter.vue"));
const WorkflowWorkspace = defineAsyncComponent(() => import("./components/WorkflowWorkspace.vue"));

type View = "home" | "marketing" | "privacy" | "terms" | "partner" | WorkspaceView | "admin";
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
  metadata: Record<string, unknown>;
  status: "New" | "Qualified" | "Booked";
  time: string;
}

interface Integration {
  id: string;
  provider: string;
  displayName: string;
  authType?: "oauth" | "pat";
  accountId?: string | null;
  accountName?: string | null;
  credentialHint?: string | null;
  connectionStatus: "pending" | "active" | "error" | "disabled";
  lastTestedAt: string | null;
  lastError: string | null;
  sync: { total: number; synced: number; pending: number; failed: number };
}

interface ProviderCapability {
  id: string;
  connectionId: string;
  key: string;
  name: string;
  description: string | null;
  type: "READ" | "WRITE";
  method: string;
  path: string;
  authScope: string | null;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  piiClassification: string;
  requiresVerifiedCustomer: boolean;
  requiresConfirmation?: boolean;
  confirmationRequired: boolean;
  fallbackBehavior?: "retry_identity" | "capture_request" | "handoff" | "stop";
  lifecycleStatus: "discovered" | "approved" | "disabled";
  enabled: boolean;
}

interface ProviderConnection {
  id: string;
  providerKey: string;
  displayName: string;
  baseUrl: string;
  sourceType: "native" | "openapi" | "custom_rest";
  specUrl: string | null;
  authType: string;
  credentialHint: string | null;
  connectionStatus: "pending" | "active" | "error" | "disabled";
  lastTestedAt: string | null;
  lastError: string | null;
  capabilities: ProviderCapability[];
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
  id?: string;
  role: "user" | "assistant" | "human" | "system";
  kind?: string;
  authorName?: string | null;
  content: string;
  createdAt: string;
  clientMessageId?: string;
  sendStatus?: "pending" | "sent" | "failed";
}

interface WorkflowSummary {
  key: string;
  name: string;
  status: "active" | "completed";
  currentStepId: string | null;
  currentState: string | null;
  nextBestAction: string;
  completedSteps: number;
  totalSteps: number;
  progressPercent: number;
  provider: string | null;
  missing: string[];
  collected: Record<string, string>;
  interruptions: number;
  steps: Array<{ id: string; label: string; fieldKey: string | null; status: "completed" | "current" | "pending" | "skipped" }>;
}

interface InboxConversation {
  id: string;
  status: "AI_ACTIVE" | "HANDOFF_REQUESTED" | "WAITING_FOR_STAFF" | "FOLLOW_UP_PENDING" | "HUMAN_ACTIVE" | "AI_ASSISTED" | "RESOLVED" | "EXPIRED";
  assignedUserId: string | null;
  assignedUserName?: string | null;
  assignedUserEmail?: string | null;
  handoffReason: string | null;
  unreadCount: number;
  lastActivityAt: string;
  createdAt: string;
  lead: { name?: string | null; email?: string | null; phone?: string | null; intent?: string | null; metadata?: Record<string, unknown> } | null;
  action?: { id: string; type: string; key: string; name: string; status: "active" | "completed"; values: Record<string, string>; handoffRequired: boolean; handoffState: string | null; workflow?: WorkflowSummary } | null;
  lastMessage: InboxMessage | null;
  messages?: InboxMessage[];
  notes?: InboxNote[];
  events?: InboxEvent[];
}

interface InboxPageSummary {
  needsResponse: number;
  unread: number;
  ai: number;
  resolved: number;
}

interface InboxNote {
  id: string;
  authorUserId: string;
  authorName?: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface InboxEvent {
  id: string;
  eventType: string;
  actorUserId?: string | null;
  actorType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

type WorkspaceRole = "owner" | "admin" | "staff" | "viewer";

interface HandoffNotificationSettings {
  enabled: boolean;
  defaultRecipientEmail: string | null;
  additionalRecipientEmails: string[];
  handoffDelaySeconds: 0 | 120 | 300;
  handoffTimeoutSeconds: 120 | 300 | 600 | 900 | 1800;
  repeatEnabled: boolean;
  repeatAfterSeconds: number;
  notifyExplicitHumanRequest: boolean;
  notifyKnowledgeGap: boolean;
  notifyHighValueLead: boolean;
  notifyEveryLead: boolean;
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

type ActionFieldType = "text" | "email" | "phone" | "select" | "multi_select" | "date" | "number";
type ActionEditorStage = "trigger" | "qualify" | "contact" | "complete" | "deliver";
type CompletionMode = "external_provider" | "native_form" | "booking_connector" | "payment_link" | "api_webhook" | "human_follow_up";

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

interface TestConversationAction {
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
}

interface TestConversationMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  grounded: boolean;
  citations: Array<{ title?: string; url?: string; pageType?: string }>;
  quickActions: Array<{ label: string; question: string }>;
  primaryCta?: { actionId: string; key: string; label: string; executionMode: "DIRECT_LINK" | "FORM_FLOW" | "PROVIDER_FLOW" | "PHONE" | "EMAIL" | "HANDOFF" | "API_ACTION"; trackingKey: string; url?: string; question?: string } | null;
  action: TestConversationAction | null;
  formValues: Record<string, string>;
}

type TestAnswerPayload = {
  error?: string;
  answer?: string;
  grounded?: boolean;
  confidenceScore?: number;
  confidenceBand?: "high" | "medium" | "low";
  retrieval?: { mode?: string };
  citations?: Array<{ title?: string; url?: string; pageType?: string }>;
  quickActions?: Array<{ label: string; question: string }>;
  primaryCta?: TestConversationMessage["primaryCta"];
  action?: TestConversationAction;
};

interface ActionFlow {
  id: string;
  key: string;
  actionType?: string;
  name: string;
  businessId?: string;
  organizationId?: string;
  description: string;
  triggerPhrases: string[];
  triggerIntents: string[];
  captureMode: "auto" | "conversational" | "form" | "hybrid";
  executionMode?: "DIRECT_LINK" | "FORM_FLOW" | "PROVIDER_FLOW" | "PHONE" | "EMAIL" | "HANDOFF" | "API_ACTION";
  attachmentPolicy?: "always" | "sales_intent" | "high_intent_only" | "explicit_request_only" | "never_auto";
  trackingKey?: string;
  provider?: string | null;
  destination?: { url?: string; label?: string } | null;
  fields: ActionField[];
  optionalFields?: string[];
  steps?: Array<Record<string, unknown>>;
  completion: {
    createLead: boolean;
    leadStatus: "new" | "qualified" | "booked";
    message: string;
    workflow?: { name: string; actionId: string };
    completionMode?: CompletionMode;
    linkTemplate?: { baseUrl: string; fieldMappings: Record<string, string>; staticParams?: Record<string, string> };
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
  readiness?: { ready: boolean; reason: "ready" | "disabled" | "needs_review" | "missing_tracking_key" | "missing_destination" | "invalid_destination" | "missing_configuration" | "missing_provider_connection" };
  origin?: "discovered" | "configured";
  confidence?: number;
  safetyPolicy?: string;
  sourceLabel?: string | null;
  lifecycleStatus?: string;
  reviewReason?: string | null;
  archived?: boolean;
  version?: number;
  createdAt: string;
  updatedAt: string;
  isPrimary?: boolean;
  workflowStatus?: "DRAFT" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
  workflowId?: string;
  actionId?: string;
  goal?: string;
  providerDependency?: string | null;
  publicationState?: "DRAFT" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
  status?: "DRAFT" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";
  setupStatus?: "DRAFT" | "NEEDS_SETUP" | "READY";
  workflowCount?: number;
  workflowIds?: string[];
  workflowNames?: string[];
  capability?: {
    intent: string;
    completionType: "link" | "provider" | "phone" | "email" | "handoff" | "webhook" | "collect_details";
    destination: string | null;
    provider: string | null;
    requiredInputs: string[];
    recommendedInputs: string[];
  };
}

type ActionEditorEntry = "actions" | "primary" | "test";

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
  status: "open" | "resolved" | "ignored";
  approvedAnswer: string | null;
  answerMode: "knowledge" | "fixed_response";
  lastSeenAt: string;
  intent?: string | null;
  reason?: string | null;
  variants?: string[];
  resolvedQnaId?: string | null;
}

interface KnowledgeQna {
  id: string;
  canonicalQuestion: string;
  canonicalAnswer: string;
  variants: string[];
  status: "VERIFIED" | "NEEDS_REVIEW" | "CONFLICTED" | "STALE" | "ARCHIVED";
  sourceType: "OWNER" | "OWNER_CONFIRMED" | "WEBSITE_DERIVED";
  sourceReferences: Array<{ type: string; id?: string | null; label?: string | null; url?: string | null }>;
  answerGapId: string | null;
  createdAt: string;
  updatedAt: string;
  lastReviewedAt: string | null;
  validUntil: string | null;
  timesUsed: number;
  lastUsedAt: string | null;
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
  citations?: Array<{ title?: string; url?: string; pageType?: string }>;
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
  intent?: string;
  retrievedPages?: string[];
  citations?: Array<{ title: string; url: string; pageType: string }>;
  topRetrievalScore?: number;
  scores?: {
    correctness: number;
    relevance: number;
    grounding: number;
    citationQuality: number;
    conciseness: number;
    fallbackCorrectness: number;
    hallucination: "pass" | "fail";
  };
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
  kind?: "KNOWLEDGE" | "WORKFLOW" | "ACTION" | "HANDOFF";
  targetId?: string;
  approved?: boolean;
  generated?: boolean;
}

interface AgentSaveModel {
  assistantName: string;
  welcomeMessage: string;
  tone: "friendly" | "professional" | "concise" | "custom";
  customToneInstructions: string;
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
  citationVisibility: "always" | "contextual" | "hidden";
  proactiveEnabled: boolean;
  proactiveDelaySeconds: number;
  proactiveMessage: string;
  proactiveTriggers: Array<"delay" | "scroll" | "exit" | "returning">;
  proactiveBehavior: "teaser" | "open";
  proactiveFrequency: "session" | "24h" | "visit";
  requireLeadConsent: boolean;
  privacyNoticeUrl: string;
  retentionDays: number;
  fallbackPhone?: string;
  fallbackEmail?: string;
  fallbackContactUrl?: string;
}

interface ExecutiveAnalyticsStep {
  key: string;
  label: string;
  value: number;
  rate: number | null;
  rateLabel: string;
  detail: string;
  status: "complete" | "attention" | "pending";
}

interface ExecutiveQualityMetric {
  key: string;
  label: string;
  value: number | null;
  unit: "percent" | "currency";
  detail: string;
  status: "healthy" | "watch" | "no_data";
}

interface ExecutiveAnalytics {
  windowDays: number;
  windowLabel: string;
  funnel: {
    steps: ExecutiveAnalyticsStep[];
    qualifiedLeads: number;
    conversions: number;
    activityConversations: number;
  };
  quality: {
    metrics: ExecutiveQualityMetric[];
    totalConversations: number;
    assistantResponses: number;
    fallbackResponses: number;
    totalLlmCostUsd: number | null;
    costDataAvailable: boolean;
  };
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
  experienceInsights?: {
    totalSignals: number;
    affectedSessions: number;
    topFriction: Array<{ type: string; count: number; sessions: number }>;
    topSteps: Array<{ step: string; count: number }>;
    headline: string | null;
    suggestedImprovement: string | null;
  };
  executive?: ExecutiveAnalytics;
  setup: {
    completed: number;
    total: number;
    percent: number;
    steps: Array<{ id: SetupStepId; label: string; complete: boolean }>;
    nextRequiredStep: SetupStepId | null;
  };
  conversionFunnels?: Array<{
    flowId: string;
    flowKey: string;
    name: string;
    started: number;
    formDisplayed: number;
    submitted: number;
    exitRescueOffered?: number;
    exitRescueSaved?: number;
    exitRescueReturned?: number;
    exitRescueConverted?: number;
    exitRescueDeclined?: number;
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

type KnowledgeTab = "overview" | "sources" | "qna" | "gaps" | "quality";
type KnowledgeGapFilter = "open" | "resolved" | "ignored" | "all";
type KnowledgeGapSort = "mostAsked" | "newest" | "highestImpact";
type KnowledgeQualityFilter = "all" | "grounded" | "fallback" | "needsReview";
type KnowledgeQualityRange = "7" | "30" | "all";
type KnowledgeSourceTypeFilter = "all" | "website" | "document";
type KnowledgeSourceStatusFilter = "all" | "ready" | "attention" | "processing";
type KnowledgeSourceGroupKey = "website" | "documents" | "manual" | "connected";

interface KnowledgeSourceRow {
  id: string;
  title: string;
  type: "Website" | "Document";
  status: "ready" | "attention" | "processing";
  statusLabel: string;
  detail: string;
  lastRefreshed: string | null;
  websiteSource?: WorkspaceSource;
  document?: OrganizationDocument;
}

interface KnowledgeSourceGroup {
  key: KnowledgeSourceGroupKey;
  label: string;
  detail: string;
  count: number;
  status: "ready" | "attention" | "processing";
  statusLabel: string;
  expandable: boolean;
}

type AgentPublishStatus = "NOT_PUBLISHED" | "PUBLISHING" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";

interface AgentPublishing {
  status: Exclude<AgentPublishStatus, "PUBLISHING">;
  domain: string | null;
  publishedAt: string | null;
  configVersion: number | null;
}

interface OnboardingValidation {
  status: "valid" | "needs_attention";
  code: string | null;
  reachable: boolean;
  knowledgeReady: boolean;
  readinessScore: number;
  expectedBusinessName: string | null;
  detectedBusinessName: string | null;
  message: string;
  suggestedAction: string;
  signals: string[];
  crawlCoverage?: {
    discoveredUrls: number;
    eligibleUrls: number;
    attemptedUrls: number;
    successfulPages: number;
    skippedUrls: number;
    failedUrls: number;
    unprocessedUrls: number;
    coveragePercent: number;
    additionalPagesDetected: boolean;
    rejectionReasons: Record<string, number>;
  };
  crawlRun?: {
    crawlRunId: string;
    seedUrl: string;
    startedAt: string;
    completedAt: string | null;
    discoveredUrls: number;
    eligibleUrls: number;
    attemptedUrls: number;
    successfulPages: number;
    failedUrls: number;
    skippedUrls: number;
    unprocessedUrls: number;
    coveragePercent: number;
    rejectionReasons: Record<string, number>;
    routes: Array<{ url: string; finalUrl: string | null; status: number | null; fetchStrategy: string; accepted: boolean; failureReason: string | null }>;
    legacyCodePathUsed: boolean;
    backgroundWorkerUsed: boolean;
    workerJobId: string | null;
    maxPages: number;
    maxDepth: number;
    finalReadiness?: { status: string; knowledgeReady: boolean; readinessScore: number; code: string | null } | null;
  };
  checkedAt: string;
}

interface WorkspacePayload {
  slug: string;
  status: string;
  business?: { id?: string; organizationId?: string | null; name?: string; location?: string; websiteUrl?: string };
  agent?: { assistantName?: string; welcomeMessage?: string; tone?: "friendly" | "professional" | "concise" | "custom"; customToneInstructions?: string; primaryLanguage?: string; fallbackBehavior?: "contact_form" | "human" | "unavailable"; humanHandoffEnabled?: boolean; widgetColor?: string; collectLeads?: boolean; showBookingAction?: boolean; widgetDefaultMode?: "compact" | "expanded" | "fullscreen"; widgetAllowExpand?: boolean; widgetQuickActions?: WidgetQuickAction[]; widgetLogoUrl?: string | null; widgetTheme?: "light" | "dark" | "auto"; widgetPosition?: "bottom-right" | "bottom-left"; proactiveEnabled?: boolean; proactiveDelaySeconds?: number; proactiveMessage?: string; proactiveTriggers?: Array<"delay" | "scroll" | "exit" | "returning">; proactiveBehavior?: "teaser" | "open"; proactiveFrequency?: "session" | "24h" | "visit"; requireLeadConsent?: boolean; privacyNoticeUrl?: string | null; retentionDays?: number; showAiDisclosure?: boolean; citationVisibility?: "always" | "contextual" | "hidden"; fallbackContacts?: { phone?: string | null; email?: string | null; url?: string | null } };
  branding?: { colors?: string[]; source?: string };
  suggestedQuestions?: string[];
  ownership?: { status: "pending" | "verified" | "rejected"; method: VerificationMethod | null; verifiedAt: string | null };
  onboarding?: OnboardingValidation;
  publishing?: AgentPublishing;
  publishedAt?: string | null;
  knowledge?: { sourceCount: number; chunkCount: number; meaningfulChunkCount?: number; openGaps: number; qnaCount?: number; verifiedQnaCount?: number; conflictedQnaCount?: number; pendingSources?: number; failedSources?: number; status?: string; indexed?: boolean; semantic?: { status: string; retrievalMode: string; model: string; dimensions: number; totalChunks: number; embeddedChunks: number; pendingChunks: number; coveragePercent: number; providerStatus: string; providerReason: string | null }; sources?: WorkspaceSource[]; readiness?: { score: number; sources: number; chunks: number; meaningfulChunks?: number; embeddedChunks?: number; embeddingCoveragePercent?: number; semanticSearchStatus?: string; openGaps: number; pendingSources?: number; failedSources?: number } };
  workflowContext?: WorkflowBusinessContext;
  stats?: WorkspaceStats;
}

type SetupStepId = "domain_verified" | "knowledge_ready" | "agent_tested" | "widget_installed" | "agent_published";
type GuidanceTarget = "integrations" | "actions" | "knowledge" | "agent" | "test" | "overview";

interface AgentCapability {
  id: string;
  title: string;
  description: string;
  ready: boolean;
  target: GuidanceTarget;
  actionLabel: string;
}

interface GuidanceRecommendation {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  target: GuidanceTarget;
  actionLabel: string;
  ready: boolean;
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
    currentPeriodStartAt: string | null;
    trialEndAt: string | null;
    currentPeriodEndAt: string | null;
    graceEndAt: string | null;
    providerCustomerId: string | null;
    providerSubscriptionId: string | null;
    stripeStatus: string | null;
    checkoutStatus: string | null;
    checkoutSessionId: string | null;
    pendingPlanKey: string | null;
    pendingBillingInterval: string | null;
    pendingPlanChangeType: "upgrade" | "downgrade" | null;
    pendingPlanChangeAt: string | null;
    stripeSubscriptionScheduleId: string | null;
    cancelAtPeriodEnd: boolean;
    lastPaymentStatus: string | null;
    activationEmailQueuedAt: string | null;
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
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeSubscriptionStatus: string | null;
  lastPaymentStatus: string | null;
  cancelAtPeriodEnd: boolean;
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
      providerPriceId?: string | null;
      stripeStatus?: string | null;
      checkoutStatus?: string | null;
      checkoutSessionId?: string | null;
      pendingPlanKey?: string | null;
      pendingBillingInterval?: string | null;
      pendingPlanChangeType?: "upgrade" | "downgrade" | null;
      pendingPlanChangeAt?: string | null;
      cancelAtPeriodEnd?: boolean;
      lastPaymentStatus?: string | null;
      amountCents: number | null;
      currency: string;
      access: { allowed: boolean; reason: string };
      plan: { key: string; displayName: string; description: string; amountCents: number | null; currency: string; maxBusinesses: number };
      override: { reason: string } | null;
    };
  };
  owners: Array<{ email: string; name: string; role: string }>;
  billingTimeline: Array<{ eventKey: string; eventName: string; providerEventId: string | null; status: string; metadata: Record<string, unknown>; occurredAt: string | null }>;
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
    onboardingStatus?: string;
    onboardingFailureCode?: string | null;
    onboardingValidation?: OnboardingValidation;
    onboardingValidatedAt?: string | null;
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

interface AdminActionRegistryItem {
  id: string;
  businessId: string;
  businessName: string;
  businessSlug: string;
  websiteUrl: string;
  actionKey: string;
  actionType: string;
  name: string;
  description: string;
  mode: string;
  destination: { url?: string; label?: string } | null;
  provider: string | null;
  priority: number;
  requiredFields: string[];
  conditions: Array<Record<string, unknown>>;
  safetyPolicy: string;
  sourceUrl: string | null;
  sourceType: string | null;
  sourceLabel: string | null;
  classificationReason: string | null;
  discoveredAt: string | null;
  origin: "discovered" | "configured";
  lifecycleStatus: "discovered" | "needs_review" | "approved" | "active" | "disabled";
  reviewReason: string | null;
  evidence: Array<{ sourceUrl?: string; quote?: string; confidence?: number }>;
  confidence: number | null;
  enabled: boolean;
  readiness?: { ready: boolean; reason: string };
  steps?: Array<{ id?: string; type?: string; nextStepId?: string; branches?: unknown[]; config?: Record<string, unknown> }>;
  workflowVersion?: number;
  isPrimary: boolean;
  updatedAt: string;
}

interface AdminWorkflowAuditItem {
  id: string;
  eventType: string;
  actorType: string;
  actorName: string | null;
  reason: string | null;
  createdAt: string;
}

interface AdminCertificationRun {
  fileName: string;
  generatedAt: string;
  commit: string | null;
  pass: boolean;
  layers: {
    retrieval: { pass: boolean; metrics: Record<string, number>; forbiddenEvidenceRate: number };
    routing: { pass: boolean; summary: Record<string, number> };
    workflow: { pass: boolean; businesses: Array<{ key: string; name: string; pass: boolean; processPassRate: number; outcomePassRate: number; workflowVerification: { ok: boolean; issues: Array<{ code: string; message: string }> } }> };
  };
  baseline: { fileName: string; generatedAt: string | null; commit: string | null } | null;
  scores: Record<string, number>;
  scoreDeltas: Record<string, number> | null;
}

interface AdminCertificationPayload {
  latest: AdminCertificationRun | null;
  history: Array<Pick<AdminCertificationRun, "fileName" | "generatedAt" | "commit" | "pass" | "scores" | "scoreDeltas">>;
  improvementSignals: {
    counts: Array<{ type: string; count: number; lastSeenAt: string | null }>;
    recent: Array<{ id: string; type: string; normalizedQuestion: string | null; reason: string | null; businessName: string; businessSlug: string; occurredAt: string }>;
  };
}

type WorkflowPerformance = NonNullable<WorkspaceStats["conversionFunnels"]>[number];

interface AdminExperienceSignal {
  id: string;
  business: { id: string; name: string; slug: string };
  conversationId: string | null;
  type: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  likelyLayer: string;
  messageExcerptRedacted: string | null;
  workflowStep: string | null;
  publicationVersion: number | null;
  modelRole: string | null;
  providerState: Record<string, unknown>;
  validationResult: Record<string, unknown>;
  status: "open" | "reviewed" | "resolved" | "ignored";
  clusterKey: string;
  reason: string | null;
  occurredAt: string;
  trace: Record<string, unknown>;
}

interface AdminExperienceSignalsPayload {
  generatedAt: string;
  filters: { businessId: string | null; severity: string | null; type: string | null; status: string; days: number };
  summary: { total: number; bySeverity: Array<{ severity: string; count: number }>; byType: Array<{ type: string; count: number }> };
  clusters: Array<{ clusterKey: string; type: string; likelyLayer: string; workflowStep: string | null; count: number; sessions: number; businessName: string; lastSeenAt: string }>;
  signals: AdminExperienceSignal[];
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

interface AdminFeatureFlag {
  id: string;
  key: string;
  description: string;
  stage: "off" | "internal" | "reference_tenants" | "percentage" | "all";
  rolloutPercentage: number;
  referenceOrganizationIds: string[];
  overrides: Array<{ organizationId: string; state: "on" | "off"; reason: string }>;
  createdAt: string;
  updatedAt: string;
}

interface AdminFeatureFlagOrganization {
  id: string;
  name: string;
  slug: string;
  isInternal: boolean;
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
  conversationId?: string | null;
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

interface AdminRecoveryRecord {
  businessId: string;
  businessName: string;
  businessSlug: string;
  ownerName: string;
  ownerEmail: string;
  onboardingStage: string;
  completionPercent: number;
  lastActivityAt: string | null;
  lastSuccessfulStep: string | null;
  currentBlocker: string | null;
  lastError: string | null;
  reminderCount: number;
  lastReminderAt: string | null;
  lastReminderType: string | null;
  emailOpened: boolean;
  returnedAfterEmail: boolean;
  unsubscribed: boolean;
  dormant: boolean;
  published: boolean;
}

interface AdminRecoveryPayload {
  generatedAt: string;
  funnel: {
    incompleteSignups: number;
    reminded: number;
    returned: number;
    finishedSetup: number;
    published: number;
  };
  records: AdminRecoveryRecord[];
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

interface AdminRequestMetricRow {
  route?: string;
  method?: string;
  trafficClass?: string;
  requests: number;
  errors: number;
  errorRate: number;
  averageDurationMs: number;
  p50ApproxMs?: number | null;
  p95ApproxMs?: number | null;
  p99ApproxMs?: number | null;
  statusBreakdown?: Array<{ statusCode: number; requests: number; failureClass: string }>;
  lastSeenAt?: string | null;
}

interface AdminRequestErrorClass {
  failureClass: string;
  requests: number;
  errorRate: number;
}

interface AdminResponseStage {
  stage: string;
  samples: number;
  averageDurationMs: number | null;
  p50DurationMs: number | null;
  p95DurationMs: number | null;
}

interface AdminRequestMetrics {
  generatedAt: string;
  windowHours: number;
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
    averageDurationMs: number;
    averageRequestsPerMinute: number;
    p50ApproxMs?: number | null;
    p95ApproxMs?: number | null;
    p99ApproxMs?: number | null;
    statusBreakdown?: Array<{ statusCode: number; requests: number; failureClass: string }>;
  };
  routes: AdminRequestMetricRow[];
  trafficClasses: AdminRequestMetricRow[];
  live: AdminRequestMetricRow[];
  errorClasses: AdminRequestErrorClass[];
  responseStages: AdminResponseStage[];
  unavailable?: boolean;
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

function isFirebaseSessionInvalid(error: unknown): boolean {
  if (error instanceof AuthSessionExpiredError) return true;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code ?? "") : "";
  return ["auth/invalid-user-token", "auth/user-token-expired", "auth/user-disabled", "auth/user-not-found"].includes(code);
}

function withAuthorization(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}

async function trackedFetch(input: RequestInfo | URL, init?: RequestInit, options: { globalLoading?: boolean } = {}): Promise<Response> {
  const showGlobalLoading = options.globalLoading !== false;
  if (showGlobalLoading) startGlobalLoading();
  try {
    let response = await globalThis.fetch(input, init);
    const hasFirebaseAuthorization = Boolean(firebaseToken.value && new Headers(init?.headers).has("authorization"));
    if (response.status === 401 && hasFirebaseAuthorization) {
      let refreshRetryCompleted = false;
      try {
        const refreshedToken = await currentFirebaseToken(true);
        if (!refreshedToken) throw new AuthSessionExpiredError();
        firebaseToken.value = refreshedToken;
        response = await globalThis.fetch(input, withAuthorization(init, refreshedToken));
        refreshRetryCompleted = true;
      } catch (error) {
        if (isFirebaseSessionInvalid(error)) redirectToSignIn();
        else notifyError(error, "We couldn't refresh your session. Check your connection and try again.");
      }
      if (refreshRetryCompleted && response.status === 401) redirectToSignIn();
    }
    if (response.status >= 500) {
      notify("error", "The service couldn't complete that request. Please try again.");
    }
    return response;
  } catch (error) {
    notifyError(error, "We couldn't reach FrontDeskWise. Check your connection and try again.");
    throw error;
  } finally {
    if (showGlobalLoading) stopGlobalLoading();
  }
}

function conversationFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return trackedFetch(input, init, { globalLoading: false });
}

const websiteUrl = ref("");
const demoRequesterName = ref("");
const demoRequesterEmail = ref("");
const isGenerating = ref(false);
const generationError = ref("");
type LandingAuditFinding = { label: string; detail: string; status: "attention" | "healthy" };
interface LandingAuditResult {
  businessName: string;
  websiteUrl: string;
  score: number;
  findings: LandingAuditFinding[];
  summary: string;
}
const landingAuditUrl = ref("");
const landingAudit = ref<LandingAuditResult | null>(null);
const landingAuditLoading = ref(false);
const landingAuditError = ref("");
const landingDemoQuestion = ref("");
const landingDemoLoading = ref(false);
const landingDemoTurns = ref<Array<{ role: "visitor" | "assistant"; content: string }>>([
  { role: "assistant", content: "Hi! I’m the AI front desk for Harbor & Home. Ask me about services, pricing, or getting started." },
]);
const landingDemoInsight = ref<{ label: string; score: string; detail: string } | null>(null);
let landingDemoTimer: number | null = null;
type GenerationStage = "checking" | "learning" | "organizing";
const generationStage = ref<GenerationStage>("checking");
const generationDialogOpen = ref(false);
let generationProgressTimer: ReturnType<typeof setInterval> | null = null;
const demoSlug = ref("british-swim-school-tampa-bay");
const demoAccessToken = ref(typeof window !== "undefined" ? window.localStorage.getItem("frontdeskwiseDemoAccessToken") ?? "" : "");
const publicDemoMode = ref(false);
const supportViewMode = ref(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("support_view") === "1" : false);
const supportViewCaseId = ref(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("support_case") ?? "" : "");
const firebaseToken = ref("");
const authSnapshot = ref<AuthSnapshot | null>(null);
const authModalOpen = ref(false);
const authMode = ref<"signin" | "signup" | "forgot">("signin");
const authEmail = ref("");
const authPassword = ref("");
const authOrganizationName = ref("");
const authError = ref("");
const authSuccess = ref("");
const authLoading = ref(false);
const verificationEmailLoading = ref(false);
const verificationEmailMessage = ref("");
const authInitializing = ref(firebaseAuthConfigured());
const resetActionCode = ref("");
const resetEmail = ref("");
const resetPasswordValue = ref("");
const resetPasswordConfirmation = ref("");
const resetReady = ref(false);
const resetComplete = ref(false);
const resetError = ref("");
const resetLoading = ref(false);
const mobileNavOpen = ref(false);
const mobileMenuButton = ref<HTMLButtonElement | null>(null);
const mobileDrawer = ref<HTMLElement | null>(null);
let previousBodyOverflow = "";
let sessionRedirecting = false;
let restoredFirebaseUserId = "";
let restoringFirebaseUserId = "";
let verificationRefreshInFlight = false;
const businessName = ref("");
const businessLocation = ref("");
const websiteBrandColors = ref<string[]>([]);
const assistantName = ref("AI Front Desk");
const welcomeMessage = ref("Hi! I can answer questions from this business's website and help you get started.");
const agentTone = ref<"friendly" | "professional" | "concise" | "custom">("friendly");
const customToneInstructions = ref("");
const primaryLanguage = ref("English");
const fallbackBehavior = ref<"contact_form" | "human" | "unavailable">("contact_form");
const humanHandoffEnabled = ref(true);
const widgetColor = ref("#0d6efd");
const showLeadCapture = ref(true);
const showBookingAction = ref(true);
const widgetDefaultMode = ref<"compact" | "expanded" | "fullscreen">("compact");
const widgetAllowExpand = ref(true);
const widgetLogoUrl = ref("");
const workspaceLogoPreviewUrl = ref("");
const workspaceLogoLoadFailed = ref(false);
const widgetTheme = ref<"light" | "dark" | "auto">("auto");
const widgetPosition = ref<"bottom-right" | "bottom-left">("bottom-right");
const widgetQuickActions = ref<WidgetQuickAction[]>([
  { label: "Ask a question", question: "What would you like help with?", kind: "KNOWLEDGE", approved: true, generated: true },
]);
const proactiveEnabled = ref(false);
const proactiveDelaySeconds = ref(20);
const proactiveMessage = ref("Looking for the right service? I can help.");
const proactiveTriggers = ref<Array<"delay" | "scroll" | "exit" | "returning">>(["delay", "scroll", "returning"]);
const proactiveBehavior = ref<"teaser" | "open">("teaser");
const proactiveFrequency = ref<"session" | "24h" | "visit">("session");
const requireLeadConsent = ref(false);
const privacyNoticeUrl = ref("");
const retentionDays = ref(90);
const showAiDisclosure = ref(true);
const citationVisibility = ref<"always" | "contextual" | "hidden">("always");
const fallbackPhone = ref("");
const fallbackEmail = ref("");
const fallbackContactUrl = ref("");
const savedMessage = ref("");
const conversationId = ref("");
const testQuestion = ref("");
const routedTestQuestion = ref("");
const testMessages = ref<TestConversationMessage[]>([]);
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
const agentPublishing = ref<AgentPublishing>({ status: "NOT_PUBLISHED", domain: null, publishedAt: null, configVersion: null });
const agentPublishingLoading = ref(false);
const agentPublishingError = ref("");
const widgetPreviewMode = ref<"desktop" | "mobile">("desktop");
const ownershipVerification = ref<WorkspacePayload["ownership"] | null>(null);
const verificationMethod = ref<VerificationMethod>("meta_tag");
const verificationToken = ref("");
const verificationInstructions = ref("");
const verificationMessage = ref("");
const verificationError = ref("");
const verificationLoading = ref(false);
const isAsking = ref(false);
let testRequestGeneration = 0;
const leadName = ref("");
const leadEmail = ref("");
const leadPhone = ref("");
const leadIntent = ref("");
const leadSavedMessage = ref("");
const knowledgeGaps = ref<KnowledgeGap[]>([]);
const knowledgeQnas = ref<KnowledgeQna[]>([]);
const retrievalDiagnostics = ref<RetrievalDiagnostic[]>([]);
const knowledgeTab = ref<KnowledgeTab>("overview");
const knowledgeQnaSearch = ref("");
const knowledgeQnaStatusFilter = ref<KnowledgeQna["status"] | "ALL">("ALL");
const knowledgeQnaDrawerOpen = ref(false);
const selectedKnowledgeQna = ref<KnowledgeQna | null>(null);
const knowledgeQnaDraft = ref({ question: "", answer: "", variants: "", validUntil: "" });
const knowledgeQnaSaving = ref(false);
const knowledgeQnaError = ref("");
const knowledgeQnaMessage = ref("");
const knowledgeGapFilter = ref<KnowledgeGapFilter>("open");
const knowledgeGapSort = ref<KnowledgeGapSort>("highestImpact");
const knowledgeGapSearch = ref("");
const knowledgeGapIntentFilter = ref("all");
const knowledgeGapFrequencyFilter = ref("all");
const knowledgeGapRange = ref<KnowledgeQualityRange>("30");
const knowledgeGapPage = ref(1);
const knowledgeSourceSearch = ref("");
const knowledgeSourceTypeFilter = ref<KnowledgeSourceTypeFilter>("all");
const knowledgeSourceStatusFilter = ref<KnowledgeSourceStatusFilter>("all");
const knowledgeSourcePage = ref(1);
const knowledgeSourceGroupOpen = ref<KnowledgeSourceGroupKey | null>(null);
const knowledgeQualityFilter = ref<KnowledgeQualityFilter>("all");
const knowledgeQualityRange = ref<KnowledgeQualityRange>("30");
const knowledgeQualitySearch = ref("");
const knowledgeQualityPage = ref(1);
const knowledgeQualityTotal = ref(0);
const knowledgeQualityHasNext = ref(false);
const knowledgeQualityHasPrevious = ref(false);
const knowledgeQualityLoading = ref(false);
let knowledgeQualitySearchTimer: number | null = null;
const answerGapDrawerOpen = ref(false);
const selectedKnowledgeGap = ref<KnowledgeGap | null>(null);
const knowledgeGapMenuOpen = ref<string | null>(null);
const knowledgeError = ref("");
const knowledgeLoading = ref(false);
const answerDrafts = ref<Record<string, string>>({});
const knowledgeAnswerSaving = ref(false);
const knowledgeAnswerStatus = ref("");
const knowledgeAnswerError = ref("");
const knowledgeAnswerFailedGap = ref<KnowledgeGap | null>(null);
const organizationDocuments = ref<OrganizationDocument[]>([]);
const documentsLoading = ref(false);
const documentsError = ref("");
const documentsMessage = ref("");
const knowledgeTestContext = ref<"updated" | "answer" | null>(null);
const resolvedKnowledgeQuestion = ref("");
const integrations = ref<Integration[]>([]);
const providerConnections = ref<ProviderConnection[]>([]);
const providerConnectionDrawerOpen = ref(false);
const providerConnectionMode = ref<"openapi" | "manual">("openapi");
const providerConnectionName = ref("");
const providerConnectionBaseUrl = ref("");
const providerConnectionSpecUrl = ref("");
const providerConnectionSpecJson = ref<Record<string, unknown> | null>(null);
const providerConnectionAuthType = ref<"none" | "bearer_token" | "api_key" | "basic">("bearer_token");
const providerConnectionSecret = ref("");
const providerConnectionBasicUsername = ref("");
const providerConnectionBasicPassword = ref("");
const providerConnectionApiKeyHeader = ref("x-api-key");
const providerManualCapabilityKey = ref("");
const providerManualCapabilityName = ref("");
const providerManualCapabilityMethod = ref("GET");
const providerManualCapabilityPath = ref("");
const providerConnectionLoading = ref(false);
const providerConnectionError = ref("");
const providerConnectionMessage = ref("");
const mcpConnections = ref<McpConnection[]>([]);
const integrationProvider = ref<"webhook" | "hubspot" | "jackrabbit">("webhook");
const integrationDisplayName = ref("CRM webhook");
const integrationWebhookUrl = ref("");
const integrationSigningSecret = ref("");
const integrationAccessToken = ref("");
const integrationManualMode = ref(false);
const integrationLoading = ref(false);
const integrationError = ref("");
const integrationMessage = ref("");
const nativeIntegrationFormOpen = ref(false);
const integrationHowItWorksOpen = ref(false);
const advancedAiConnectionsOpen = ref(false);
const mcpDrawerOpen = ref(false);
const mcpPermissionsOpen = ref<string | null>(null);
const mcpProvider = ref<McpConnection["provider"]>("hubspot");
const mcpDisplayName = ref("");
const mcpServerUrl = ref("");
const mcpBearerToken = ref("");
const mcpLoading = ref(false);
const mcpError = ref("");
const mcpMessage = ref("");
const actionFlows = ref<ActionFlow[]>([]);
const workflowRecords = ref<ActionFlow[]>([]);
const actionTemplates = ref<ActionTemplate[]>([]);
const actionDeliveries = ref<ActionDelivery[]>([]);
const actionsLoading = ref(false);
const actionsError = ref("");
const actionsMessage = ref("");
const workflowsLoading = ref(false);
const workflowsError = ref("");
let workflowsLoadGeneration = 0;
const selectedActionId = ref("");
const actionDraft = ref<ActionFlow | null>(null);
const actionEditorEntry = ref<ActionEditorEntry>("actions");
const savedActionId = ref("");
let savedActionHighlightTimer: number | null = null;
const visibleActionFlows = computed(() => actionFlows.value.filter((action) => action.archived !== true));
const primaryActionFlow = computed(() => visibleActionFlows.value.find((action) => action.isPrimary) ?? null);
const savedAction = computed(() => visibleActionFlows.value.find((action) => action.id === savedActionId.value) ?? null);
const recommendedPrimaryAction = computed(() => visibleActionFlows.value.find((action) => action.key === "request_demo" || /\b(try|start|see|view|explore)\b.*\b(demo|trial)\b/i.test(action.name)) ?? null);
const daycareWorkspace = computed(() => /daycare|childcare|preschool|nursery|daycarespots/i.test(`${businessName.value} ${websiteUrl.value} ${actionFlows.value.map((action) => `${action.name} ${action.description}`).join(" ")}`));
const actionRecommendationOrder = computed(() => daycareWorkspace.value
  ? ["find_daycare", "claim_daycare", "contact_team", "capture_lead"]
  : ["enroll_child", "book_tour", "book_appointment", "request_quote", "schedule_consultation", "capture_lead", "contact_team"]);

function actionHasOwnerApproval(action: ActionFlow): boolean {
  return Boolean(
    action.isPrimary
      || action.reviewReason === "owner_override"
      || (action.workflowCount ?? 0) > 0
      || action.completion.workflow?.name,
  );
}

const recommendedActionFlows = computed(() => {
  const pending = visibleActionFlows.value.filter((action) => !actionHasOwnerApproval(action));
  const order = actionRecommendationOrder.value;
  const score = (action: ActionFlow) => {
    const preferredIndex = order.indexOf(action.key);
    const preferredScore = preferredIndex >= 0 ? 1_000 - preferredIndex * 20 : 0;
    const evidenceScore = action.origin === "discovered" ? 120 : 0;
    const confidenceScore = Math.round((action.confidence ?? 0) * 20);
    return preferredScore + evidenceScore + confidenceScore;
  };
  return [...pending].sort((left, right) => score(right) - score(left)).slice(0, daycareWorkspace.value ? 4 : 5);
});
const configuredActionFlows = computed(() => visibleActionFlows.value.filter(actionHasOwnerApproval));
const actionTemplateKeysInUse = computed(() => new Set(visibleActionFlows.value.map((action) => action.key)));
const availableActionTemplates = computed(() => {
  const daycareLaterKeys = new Set(["book_tour", "join_waitlist", "external_booking", "open_link"]);
  const templates = actionTemplates.value.filter((template) => {
    if (actionTemplateKeysInUse.value.has(template.key)) return false;
    if (daycareWorkspace.value) return daycareLaterKeys.has(template.key);
    return true;
  });
  return templates.slice(0, daycareWorkspace.value ? 4 : 6);
});
const actionConnectorProvider = computed(() => actionDraft.value?.completion.connector?.provider ?? "none");
const activeActionIntegrations = computed(() => integrations.value.filter((integration) => integration.connectionStatus === "active"
  && ((actionConnectorProvider.value === "generic_webhook" && integration.provider === "webhook")
    || (actionConnectorProvider.value === "hubspot" && integration.provider === "hubspot"))));
const hubspotIntegration = computed(() => integrations.value.find((integration) => integration.provider === "hubspot") ?? null);
const webhookIntegration = computed(() => integrations.value.find((integration) => integration.provider === "webhook") ?? null);
const jackrabbitIntegration = computed(() => integrations.value.find((integration) => integration.provider === "jackrabbit") ?? null);
const hubspotMcpConnection = computed(() => mcpConnections.value.find((connection) => connection.provider === "hubspot") ?? null);
const bookingIntegrationConfigured = computed(() => visibleActionFlows.value.some((action) => {
  const actionText = `${action.name} ${action.description} ${action.destination?.url ?? ""} ${action.completion.linkUrl ?? ""}`;
  return actionProvider(action) === "booking"
    || action.completion.completionMode === "booking_connector"
    || /calendly|booking|schedule|appointment/i.test(actionText);
}));
const actionTriggerText = ref("");
const actionTriggerPhraseInput = ref("");
const actionEditorStage = ref<ActionEditorStage>("trigger");
const actionTemplateChooserOpen = ref(false);
const primaryGoalChooserOpen = ref(false);
const actionFieldDrawerIndex = ref<number | null>(null);
const actionAdvancedOpen = ref(false);
const completionLinkMappingsText = ref("");
const draggedActionFieldIndex = ref<number | null>(null);
const billingSnapshot = ref<BillingSnapshot | null>(null);
const billingLoading = ref(false);
const billingError = ref("");
const billingMessage = ref("");
const billingFlow = ref<"idle" | "processing" | "complete" | "pending" | "cancelled">("idle");
type BillingSuccessState = "activating" | "pending" | "active" | "failed";
const billingSuccessState = ref<BillingSuccessState>("activating");
const billingSuccessExpectedPlanKey = ref("");
let billingSuccessRunKey = "";
const settingsTab = ref<SettingsTab>("general");
const agentTab = ref<AgentTab>("capabilities");
const profileMenuOpen = ref(false);
const sidebarAccountMenuOpen = ref(false);
const setupDismissed = ref(false);
const setupProgressOpen = ref(false);
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
const adminRequestMetrics = ref<AdminRequestMetrics | null>(null);
const adminRequestMetricsLoading = ref(false);
const adminRequestMetricsError = ref("");

function requestMetricPercent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`;
}

function requestMetricDuration(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return value >= 5_001 ? ">5s" : `${value}ms`;
}

function requestMetricStatusSummary(item: AdminRequestMetricRow): string {
  const statuses = (item.statusBreakdown ?? []).filter((status) => status.statusCode >= 400);
  if (!statuses.length) return "No non-2xx responses recorded";
  return statuses.slice(0, 3).map((status) => `${status.statusCode} · ${status.requests.toLocaleString()}`).join(" · ");
}

function requestMetricErrorClassLabel(value: string): string {
  const labels: Record<string, string> = {
    expected_lifecycle: "Expected lifecycle",
    client_misuse: "Client misuse",
    auth: "Auth",
    rate_limit: "Rate limit",
    not_found: "Not found",
    conflict: "Conflict",
    timeout: "Timeout",
    dependency: "Dependency",
    internal_server: "Internal server",
    client_error: "Client error",
  };
  return labels[value] ?? formatLabel(value);
}

function requestMetricErrorClassTone(value: string): string {
  return value === "expected_lifecycle" || value === "client_misuse" ? "muted" : value === "internal_server" || value === "dependency" || value === "timeout" ? "danger" : "warning";
}
const installationSupportRequests = ref<InstallationSupportRequest[]>([]);
const installationSupportAssignees = ref<InstallationSupportAssignee[]>([]);
const installationSupportSummary = ref({ new: 0, inProgress: 0, resolved: 0 });
const installationSupportLoading = ref(false);
const installationSupportError = ref("");
const installationSupportMessage = ref("");
const adminSupportCases = ref<SupportCaseRecord[]>([]);
const adminSupportAssignees = ref<InstallationSupportAssignee[]>([]);
const adminSupportSummary = ref({ open: 0, inProgress: 0, resolved: 0 });
const adminSupportLoading = ref(false);
const adminSupportError = ref("");
const adminSupportMessage = ref("");
const installationSupportOwnerLoading = ref(false);
const installationSupportOwnerError = ref("");
const installationSupportOwnerMessage = ref("");
const openSupportRequest = ref(0);
const supportCases = ref<SupportCaseRecord[]>([]);
const supportContext = ref<SupportContext | null>(null);
const supportLoading = ref(false);
const supportError = ref("");
const supportSubmitting = ref(false);
const supportSubmitError = ref("");
const supportSubmitMessage = ref("");
const supportOpenReportRequest = ref(0);
const supportSourcePage = ref("Support");
const supportCategory = ref<SupportCaseCategory>("general");
const supportProvider = ref("");
const supportConnectionId = ref("");
const adminOrganizationDetail = ref<AdminOrganizationDetail | null>(null);
const adminOrganizationDetailLoading = ref(false);
const adminBusinessDetail = ref<AdminBusinessDetail | null>(null);
const adminBusinessDetailLoading = ref(false);
const adminActionRegistry = ref<AdminActionRegistryItem[]>([]);
const adminActionRegistryLoading = ref(false);
const adminActionRegistryError = ref("");
const adminActionRegistryMessage = ref("");
const adminWorkflowDetailsActionId = ref("");
const adminWorkflowAudit = ref<AdminWorkflowAuditItem[]>([]);
const adminWorkflowAuditLoading = ref(false);
const adminWorkflowAuditError = ref("");
const adminWorkflowReplayConversationId = ref("");
const adminWorkflowReplayQuestion = ref("");
const adminWorkflowReplayLoading = ref(false);
const adminWorkflowReplayError = ref("");
const adminWorkflowReplayResult = ref<Record<string, unknown> | null>(null);
const adminCertification = ref<AdminCertificationPayload | null>(null);
const adminCertificationLoading = ref(false);
const adminCertificationError = ref("");
const adminExperienceSignals = ref<AdminExperienceSignalsPayload | null>(null);
const adminExperienceSignalsLoading = ref(false);
const adminExperienceSignalsError = ref("");
const adminExperienceSignalStatusFilter = ref<"open" | "reviewed" | "resolved" | "ignored" | "all">("open");
const adminExperienceSignalSeverityFilter = ref<"all" | "low" | "medium" | "high" | "critical">("all");
const adminExperienceSignalTypeFilter = ref("all");
const adminExperienceSignalTraceId = ref("");
const adminFeatureFlags = ref<AdminFeatureFlag[]>([]);
const adminFeatureFlagOrganizations = ref<AdminFeatureFlagOrganization[]>([]);
const adminFeatureFlagsLoading = ref(false);
const adminFeatureFlagsError = ref("");
const adminFeatureFlagsMessage = ref("");
const adminFeatureFlagDraft = ref({
  key: "",
  description: "",
  stage: "off" as AdminFeatureFlag["stage"],
  rolloutPercentage: 0,
  referenceOrganizationIds: [] as string[],
});
const adminFeatureFlagOverride = ref({
  key: "",
  organizationId: "",
  state: "on" as "on" | "off",
  reason: "",
});
const selectedAdminWorkflowAction = computed(() => adminActionRegistry.value.find((action) => action.id === adminWorkflowDetailsActionId.value) ?? null);
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
const adminRecovery = ref<AdminRecoveryPayload | null>(null);
const adminRecoveryLoading = ref(false);
const adminRecoveryError = ref("");
const workspaceStats = ref<WorkspaceStats | null>(null);
const workspaceKnowledge = ref<WorkspacePayload["knowledge"] | null>(null);
const workspaceOnboarding = ref<OnboardingValidation | null>(null);
const workflowContext = ref<WorkflowBusinessContext | null>(null);
const workspaceBusinessId = ref<string | null>(null);
const workspaceOrganizationId = ref<string | null>(null);
const workflowContextRefreshMessage = ref("");
const workspaceReadiness = ref(0);
const workspaceLoading = ref(false);
const workspaceError = ref("");
let workspaceLoadGeneration = 0;
let actionsLoadGeneration = 0;
let integrationsLoadGeneration = 0;
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
const knowledgeMoreOpen = ref(false);
const inboxConversations = ref<InboxConversation[]>([]);
const inboxLoading = ref(false);
const inboxError = ref("");
const inboxStatusFilter = ref<"all" | InboxConversation["status"]>("all");
const inboxAssignmentFilter = ref<"all" | "unassigned" | "mine" | string>("all");
const inboxPageSize = 50;
const inboxPage = ref(1);
const inboxTotal = ref(0);
const inboxHasNext = ref(false);
const inboxHasPrevious = ref(false);
const inboxSummary = ref<InboxPageSummary>({ needsResponse: 0, unread: 0, ai: 0, resolved: 0 });
const selectedInboxConversation = ref<InboxConversation | null>(null);
const inboxReply = ref("");
const inboxNote = ref("");
const inboxSuggestion = ref("");
const inboxActionLoading = ref(false);
const inboxMessage = ref("");
const inboxThread = ref<HTMLElement | null>(null);
const inboxComposer = ref<HTMLTextAreaElement | null>(null);
const inboxNearBottom = ref(true);
const inboxNewMessageCount = ref(0);
const inboxLocalMessages = ref<Record<string, InboxMessage[]>>({});
let inboxRefreshTimer: ReturnType<typeof setTimeout> | null = null;
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
const notificationActionLoading = ref(false);
const notificationActionError = ref("");
const pwaInstallAvailable = ref(false);
const pwaInstalled = ref(false);
const browserNotificationPermission = ref<NotificationPermission | "unsupported">("unsupported");
const pushConfigured = ref(false);
const pushPublicKey = ref("");
const pushEnabled = ref(false);
const pushLoading = ref(false);
const pushMessage = ref("");
const pushError = ref("");
let stopPwa: (() => void) | null = null;
const notificationPreferences = ref({ newLead: true, humanHandoff: true, integrationFailure: true });
const notificationPreferencesLoading = ref(false);
const notificationPreferencesMessage = ref("");
const notificationPreferencesError = ref("");
const handoffNotificationSettings = ref<HandoffNotificationSettings>({
  enabled: true,
  defaultRecipientEmail: "",
  additionalRecipientEmails: [],
  handoffDelaySeconds: 0,
  handoffTimeoutSeconds: 900,
  repeatEnabled: false,
  repeatAfterSeconds: 10,
  notifyExplicitHumanRequest: true,
  notifyKnowledgeGap: false,
  notifyHighValueLead: true,
  notifyEveryLead: false,
});
const handoffAdditionalRecipients = ref("");
const handoffSettingsLoading = ref(false);
const handoffSettingsMessage = ref("");
const handoffSettingsError = ref("");
const embeddingLoading = ref(false);
const embeddingMessage = ref("");

interface WorkspaceNavItem {
  id: View;
  label: string;
  icon: LucideIcon;
  settingsTab?: SettingsTab;
}

const navSections: Array<{ label: string; items: WorkspaceNavItem[] }> = [
  { label: "Launch", items: [
    { id: "overview", label: "Get started", icon: House },
    { id: "businesses", label: "Businesses", icon: Building2 },
    { id: "agent", label: "Website & agent", icon: Sparkles },
    { id: "knowledge", label: "Knowledge", icon: BookOpen },
    { id: "workflows", label: "Workflows", icon: Workflow },
    { id: "connections", label: "Integrations", icon: Cable },
  ] },
  { label: "Operate", items: [
    { id: "inbox", label: "Inbox", icon: Inbox },
    { id: "team", label: "Team", icon: UsersRound },
    { id: "settings", label: "Handoff & alerts", icon: CircleAlert, settingsTab: "notifications" },
  ] },
  { label: "Convert", items: [
    { id: "leads", label: "Leads", icon: ContactRound },
    { id: "actions", label: "Actions", icon: CalendarCheck },
  ] },
  { label: "Improve", items: [
    { id: "analytics", label: "Reports & recommendations", icon: ChartNoAxesCombined },
    { id: "support", label: "Help & support", icon: Headset },
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
  { id: "capabilities", label: "Capabilities" },
  { id: "behavior", label: "Behavior" },
  { id: "knowledge", label: "Knowledge" },
  { id: "appearance", label: "Appearance" },
  { id: "actions", label: "Quick actions" },
  { id: "test", label: "Test" },
  { id: "install", label: "Install" },
];

const adminNavItems: Array<{ id: AdminSection; label: string; icon: LucideIcon }> = [
  { id: "overview", label: "Command center", icon: LayoutDashboard },
  { id: "organizations", label: "Organizations", icon: Building2 },
  { id: "action-registry", label: "Action registry", icon: Zap },
  { id: "certification", label: "Certification", icon: ShieldCheck },
  { id: "experience-signals", label: "Experience signals", icon: TriangleAlert },
  { id: "feature-flags", label: "Feature flags", icon: Snowflake },
  { id: "users", label: "Users & access", icon: UsersRound },
  { id: "demos", label: "Demo operations", icon: Sparkles },
  { id: "messaging", label: "Messaging", icon: Mail },
  { id: "recovery", label: "Onboarding recovery", icon: RotateCcw },
  { id: "support", label: "Support cases", icon: Headset },
  { id: "installation-support", label: "Installation support", icon: Headset },
  { id: "operations", label: "System health", icon: Activity },
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
  if (view.value === "partner") return "Partner workspace";
  if (route.value.kind === "auth-reset") return "Reset your password";
  if (route.value.kind === "billing-success") return "Subscription active";
  if (view.value === "admin") return "Admin control plane";
  if (view.value === "conversations" || view.value === "agent") return "Agent";
  if (view.value === "team" || view.value === "connections" || view.value === "billing") return "Settings";
  return navItems.find((item) => item.id === view.value)?.label ?? "Overview";
});

const adminOnlyMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && !availableBusinesses.value.length));
const adminSurfaceMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && view.value === "admin"));
const routeIsNotFound = computed(() => route.value.kind === "not-found");
const authRequiresSignIn = computed(() => route.value.kind === "auth" && Boolean(route.value.returnTo));
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
const adminActionRegistryEnabledCount = computed(() => adminActionRegistry.value.filter((action) => action.enabled).length);
const adminActionRegistryReviewCount = computed(() => adminActionRegistry.value.filter((action) => !action.enabled || (action.confidence ?? 0) < 0.88).length);
const adminActionRegistryPrimaryCount = computed(() => adminActionRegistry.value.filter((action) => action.isPrimary).length);

const activeLeads = computed(() => leads.value.filter((lead) => lead.status !== "Booked").length);
const activeOrganization = computed(() => authSnapshot.value?.organizations.find((organization) => organization.id === authSnapshot.value?.activeOrganizationId) ?? authSnapshot.value?.organizations[0] ?? null);

function currentMixpanelContext(): MixpanelContext {
  return {
    organization_id: activeOrganization.value?.id ?? workspaceOrganizationId.value ?? undefined,
    business_id: workspaceBusinessId.value ?? undefined,
    user_role: activeOrganization.value?.role ?? undefined,
    plan: activeOrganization.value?.billing.planKey ?? undefined,
    publication_version: agentPublishing.value.configVersion ?? undefined,
    source: publicDemoMode.value ? "public_demo" : authSnapshot.value ? "owner_app" : "marketing_site",
    surface: publicDemoMode.value ? "public_demo" : view.value,
    is_public_demo: publicDemoMode.value,
  };
}

function trackProductEvent(event: typeof MIXPANEL_EVENTS[keyof typeof MIXPANEL_EVENTS], properties: Record<string, unknown> = {}): void {
  setMixpanelContext(currentMixpanelContext());
  trackMixpanel(event, properties);
}

function trackProductEventOnce(key: string, event: typeof MIXPANEL_EVENTS[keyof typeof MIXPANEL_EVENTS], properties: Record<string, unknown> = {}): void {
  setMixpanelContext(currentMixpanelContext());
  trackMixpanelOnce(key, event, properties);
}

const availableBusinesses = computed(() => {
  const seen = new Set<string>();
  return (activeOrganization.value?.businesses ?? []).filter((business) => {
    const website = business.websiteUrl?.trim().toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/+$/, "");
    const key = website || business.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
});
function roleForBusinessSlug(slug: string): WorkspaceRole {
  const business = activeOrganization.value?.businesses.find((item) => item.slug === slug);
  const organizationRole = activeOrganization.value?.role;
  if (organizationRole === "owner") return "owner";
  if (organizationRole === "admin") return "admin";
  if (business?.role === "admin") return "admin";
  if (business?.role === "staff") return "staff";
  return "viewer";
}
const workspaceRole = computed<WorkspaceRole>(() => roleForBusinessSlug(demoSlug.value));
const focusedTeamMode = computed(() => Boolean(authSnapshot.value && (workspaceRole.value === "staff" || workspaceRole.value === "viewer")));
const canManageTeam = computed(() => workspaceRole.value === "owner" || workspaceRole.value === "admin");
const canAccessBilling = computed(() => workspaceRole.value === "owner");
const workspaceRoleLabel = computed(() => workspaceRole.value === "viewer" ? "View only" : formatLabel(workspaceRole.value));
const visibleNavSections = computed(() => {
  if (!focusedTeamMode.value) return navSections;
  return [
    { label: "Operate", items: [{ id: "inbox" as View, label: "Inbox", icon: Inbox }] },
    { label: "Convert", items: [
      { id: "leads" as View, label: "Assigned leads", icon: ContactRound },
    ] },
    { label: "Improve", items: [
      { id: "knowledge" as View, label: "Knowledge", icon: BookOpen },
      { id: "support" as View, label: "Help & support", icon: Headset },
    ] },
  ];
});
const selectedConversationReadOnly = computed(() => {
  const conversation = selectedInboxConversation.value;
  return Boolean(conversation?.assignedUserId && conversation.assignedUserId !== authSnapshot.value?.user.id && !canManageTeam.value);
});
const selectedConversationOwnerLabel = computed(() => {
  const conversation = selectedInboxConversation.value;
  if (!conversation?.assignedUserId) return "Unassigned";
  if (conversation.assignedUserId === authSnapshot.value?.user.id) return "You";
  return conversation.assignedUserName || "Another team member";
});
const selectedBusiness = computed(() => availableBusinesses.value.find((business) => business.slug === demoSlug.value) ?? null);
const businessInitial = computed(() => ((selectedBusiness.value?.name ?? businessName.value).trim().charAt(0) || "?").toUpperCase());
const workspaceLogoSrc = computed(() => {
  if (workspaceLogoLoadFailed.value) return "";
  return workspaceLogoPreviewUrl.value.trim() || widgetLogoUrl.value.trim();
});

function handleWorkspaceLogoError() {
  workspaceLogoLoadFailed.value = true;
}

function handleWorkspaceLogoPreview(previewUrl: string) {
  workspaceLogoPreviewUrl.value = previewUrl.trim();
  workspaceLogoLoadFailed.value = false;
}
const conversationCount = computed(() => workspaceStats.value?.conversations ?? 0);
const inboxUnreadCount = computed(() => inboxSummary.value.unread);
const inboxNeedsResponseCount = computed(() => inboxSummary.value.needsResponse);
const inboxAiCount = computed(() => inboxSummary.value.ai);
const inboxResolvedCount = computed(() => inboxSummary.value.resolved);
const inboxRangeStart = computed(() => inboxTotal.value ? ((inboxPage.value - 1) * inboxPageSize) + 1 : 0);
const inboxRangeEnd = computed(() => Math.min(inboxTotal.value, inboxPage.value * inboxPageSize));
const readinessScore = computed(() => {
  const score = workspaceReadiness.value;
  const validation = workspaceOnboarding.value;
  if (!validation || validation.knowledgeReady) return score;
  return Math.min(score, Math.max(0, Math.min(100, validation.readinessScore)));
});
const semanticSearchHealthy = computed(() => workspaceKnowledge.value?.semantic?.status === "SEMANTIC_SEARCH_HEALTHY");
const semanticSearchLabel = computed(() => semanticSearchHealthy.value ? "Semantic search ready" : workspaceKnowledge.value?.semantic?.status === "EMBEDDING_CONFIGURATION_ERROR" ? "Embedding configuration needs attention" : workspaceKnowledge.value?.semantic?.status === "EMBEDDING_BACKLOG" ? "Embeddings processing" : "Full-text fallback active");
const knowledgeSourcesNeedAttention = computed(() => Boolean((workspaceKnowledge.value?.pendingSources ?? 0) + (workspaceKnowledge.value?.failedSources ?? 0)));
const onboardingNeedsAttention = computed(() => workspaceOnboarding.value?.status === "needs_attention");
const onboardingReasonLabel = computed(() => workspaceOnboarding.value?.code ? formatLabel(workspaceOnboarding.value.code) : "Website validation");
const knowledgeCoverage = computed(() => workspaceOnboarding.value?.crawlCoverage ?? null);
const knowledgeCoverageNeedsAttention = computed(() => {
  const coverage = knowledgeCoverage.value;
  if (!coverage) return false;
  // Older API snapshots may omit eligibleUrls, unprocessedUrls, or
  // additionalPagesDetected. The counters still make an incomplete crawl
  // unambiguous, so never let a legacy payload render as fully ready.
  const discoveredUrls = Math.max(0, Number(coverage.discoveredUrls ?? 0));
  const skippedUrls = Math.max(0, Number(coverage.skippedUrls ?? 0));
  const eligibleUrls = Math.max(1, Number(coverage.eligibleUrls ?? Math.max(1, discoveredUrls - skippedUrls)));
  const attemptedUrls = Math.max(0, Number(coverage.attemptedUrls ?? 0));
  const successfulPages = Math.max(0, Number(coverage.successfulPages ?? 0));
  const unprocessedUrls = Math.max(0, Number(coverage.unprocessedUrls ?? Math.max(0, eligibleUrls - attemptedUrls)));
  const failedUrls = Math.max(0, Number(coverage.failedUrls ?? 0));
  return failedUrls > 0
    || unprocessedUrls > 0
    || (eligibleUrls > 1 && (attemptedUrls < eligibleUrls || successfulPages < eligibleUrls))
    || (discoveredUrls > 1 && successfulPages + skippedUrls < discoveredUrls);
});
const knowledgeWebsiteSources = computed(() => (workspaceKnowledge.value?.sources ?? []).filter((source) => source.contentType === "web_page"));
const knowledgeReadyWebsiteSources = computed(() => knowledgeWebsiteSources.value.filter((source) => source.crawlStatus === "ready"));
const knowledgeManualAnswerSources = computed(() => (workspaceKnowledge.value?.sources ?? []).filter((source) => source.contentType === "faq"));
const knowledgeWebsiteCoverage = computed(() => {
  const total = knowledgeWebsiteSources.value.length;
  if (!total) return { value: "—", detail: "No website pages yet" };
  const discovered = knowledgeCoverage.value?.discoveredUrls ?? total;
  return {
    value: `${Math.round((knowledgeReadyWebsiteSources.value.length / total) * 100)}%`,
    detail: discovered > total
      ? `${knowledgeReadyWebsiteSources.value.length} captured · ${discovered} discovered`
      : `${knowledgeReadyWebsiteSources.value.length} of ${total} pages ready`,
  };
});
const knowledgeSourceRows = computed<KnowledgeSourceRow[]>(() => [
  ...knowledgeWebsiteSources.value.map((source) => ({
    id: source.id,
    title: source.title || source.url,
    type: "Website" as const,
    status: source.crawlStatus === "ready" ? "ready" as const : source.crawlStatus === "failed" ? "attention" as const : "processing" as const,
    statusLabel: source.crawlStatus === "ready" ? "Knowledge ready" : source.crawlStatus === "failed" ? "Needs attention" : "Refreshing",
    detail: source.pageType || "Website page",
    lastRefreshed: source.lastCrawledAt,
    websiteSource: source,
  })),
  ...organizationDocuments.value.map((documentItem) => ({
    id: documentItem.id,
    title: documentItem.fileName,
    type: "Document" as const,
    status: documentItem.status === "ready" ? "ready" as const : documentItem.status === "failed" ? "attention" as const : "processing" as const,
    statusLabel: documentItem.status === "ready" ? "Ready" : documentItem.status === "failed" ? "Needs attention" : "Processing",
    detail: `${documentItem.contentType} · ${formatDocumentSize(documentItem.sizeBytes)}`,
    lastRefreshed: documentItem.updatedAt ?? documentItem.createdAt,
    document: documentItem,
  })),
]);
const knowledgeReadySourceCount = computed(() => knowledgeSourceRows.value.filter((source) => source.status === "ready").length);
const knowledgeLastUpdated = computed(() => {
  const dates = knowledgeSourceRows.value.map((source) => source.lastRefreshed ? Date.parse(source.lastRefreshed) : NaN).filter((value) => Number.isFinite(value));
  if (!dates.length) return "—";
  return formatKnowledgeRelativeTime(new Date(Math.max(...dates)).toISOString());
});
const knowledgeLastSuccessfulRefresh = computed(() => {
  const dates = knowledgeSourceRows.value
    .filter((source) => source.status === "ready")
    .map((source) => source.lastRefreshed ? Date.parse(source.lastRefreshed) : NaN)
    .filter((value) => Number.isFinite(value));
  if (!dates.length) return "—";
  return formatKnowledgeRelativeTime(new Date(Math.max(...dates)).toISOString());
});
const knowledgeSourceGroups = computed<KnowledgeSourceGroup[]>(() => {
  const summarize = (rows: KnowledgeSourceRow[]): Pick<KnowledgeSourceGroup, "status" | "statusLabel"> => {
    if (rows.some((row) => row.status === "attention")) return { status: "attention", statusLabel: "Needs attention" };
    if (rows.some((row) => row.status === "processing")) return { status: "processing", statusLabel: "Processing" };
    return { status: "ready", statusLabel: rows.length ? "Ready" : "Not connected" };
  };
  const websiteStatus = knowledgeCoverageNeedsAttention.value
    ? { status: "attention" as const, statusLabel: "Partial knowledge" }
    : summarize(knowledgeSourceRows.value.filter((row) => row.type === "Website"));
  const documentStatus = summarize(knowledgeSourceRows.value.filter((row) => row.type === "Document"));
  const connectedSystems = integrations.value.filter((integration) => integration.connectionStatus !== "disabled");
  return [
    { key: "website", label: "Website", detail: knowledgeCoverage.value
      ? `${knowledgeWebsiteSources.value.length} captured · ${knowledgeCoverage.value.discoveredUrls} discovered`
      : `${knowledgeWebsiteSources.value.length} page${knowledgeWebsiteSources.value.length === 1 ? "" : "s"}`, count: knowledgeWebsiteSources.value.length, ...websiteStatus, expandable: true },
    { key: "documents", label: "Documents", detail: `${organizationDocuments.value.length} file${organizationDocuments.value.length === 1 ? "" : "s"}`, count: organizationDocuments.value.length, ...documentStatus, expandable: true },
    { key: "manual", label: "Manual answers", detail: knowledgeManualAnswerSources.value.length ? `${knowledgeManualAnswerSources.value.length} answer${knowledgeManualAnswerSources.value.length === 1 ? "" : "s"}` : "No manual answers yet", count: knowledgeManualAnswerSources.value.length, status: knowledgeManualAnswerSources.value.length ? "ready" : "processing", statusLabel: knowledgeManualAnswerSources.value.length ? "Ready" : "Not connected", expandable: false },
    { key: "connected", label: "Connected systems", detail: connectedSystems.length ? connectedSystems.map((integration) => integration.displayName || integration.provider).join(" · ") : "No systems connected", count: connectedSystems.length, status: connectedSystems.some((integration) => integration.connectionStatus === "error") ? "attention" : connectedSystems.length ? "ready" : "processing", statusLabel: connectedSystems.some((integration) => integration.connectionStatus === "error") ? "Needs attention" : connectedSystems.length ? "Connected" : "Not connected", expandable: false },
  ];
});
const filteredKnowledgeSourceRows = computed(() => {
  const search = knowledgeSourceSearch.value.trim().toLowerCase();
  return knowledgeSourceRows.value.filter((row) => {
    const typeMatch = knowledgeSourceTypeFilter.value === "all"
      || (knowledgeSourceTypeFilter.value === "website" && row.type === "Website")
      || (knowledgeSourceTypeFilter.value === "document" && row.type === "Document");
    const statusMatch = knowledgeSourceStatusFilter.value === "all" || row.status === knowledgeSourceStatusFilter.value;
    const searchMatch = !search || [row.title, row.detail, row.websiteSource?.url, row.document?.fileName].some((value) => value?.toLowerCase().includes(search));
    return typeMatch && statusMatch && searchMatch;
  });
});
const visibleKnowledgeSourceRows = computed(() => filteredKnowledgeSourceRows.value.slice((knowledgeSourcePage.value - 1) * 25, knowledgeSourcePage.value * 25));
const knowledgeSourceTotal = computed(() => filteredKnowledgeSourceRows.value.length);
const knowledgeSourceHasPrevious = computed(() => knowledgeSourcePage.value > 1);
const knowledgeSourceHasNext = computed(() => knowledgeSourcePage.value * 25 < knowledgeSourceTotal.value);
const knowledgeSourceRangeStart = computed(() => knowledgeSourceTotal.value ? (knowledgeSourcePage.value - 1) * 25 + 1 : 0);
const knowledgeSourceRangeEnd = computed(() => Math.min(knowledgeSourceTotal.value, knowledgeSourcePage.value * 25));
const knowledgeHealthLabel = computed(() => {
  if (!workspaceKnowledge.value || !knowledgeSourceRows.value.length) return "Add a website or document";
  if (knowledgeSourcesNeedAttention.value) return "Needs attention";
  if (knowledgeCoverageNeedsAttention.value) return "Partial knowledge";
  if (onboardingNeedsAttention.value) return "Needs attention";
  if (workspaceKnowledge.value.status === "indexing") return "Updating knowledge";
  if (workspaceKnowledge.value.status === "review_recommended") return "Review recommended";
  return "Healthy";
});
const knowledgeGapCounts = computed(() => ({
  open: knowledgeGaps.value.filter((gap) => gap.status === "open").length,
  resolved: knowledgeGaps.value.filter((gap) => gap.status === "resolved").length,
  ignored: knowledgeGaps.value.filter((gap) => gap.status === "ignored").length,
  all: knowledgeGaps.value.length,
}));
const knowledgeQnaCounts = computed(() => Object.fromEntries(["VERIFIED", "NEEDS_REVIEW", "CONFLICTED", "STALE", "ARCHIVED"].map((status) => [status, knowledgeQnas.value.filter((qna) => qna.status === status).length])) as Record<string, number>);
const filteredKnowledgeQnas = computed(() => {
  const search = knowledgeQnaSearch.value.trim().toLowerCase();
  return knowledgeQnas.value
    .filter((qna) => knowledgeQnaStatusFilter.value === "ALL" || qna.status === knowledgeQnaStatusFilter.value)
    .filter((qna) => !search || [qna.canonicalQuestion, qna.canonicalAnswer, ...qna.variants].some((value) => value.toLowerCase().includes(search)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
});
const knowledgeQnaAttention = computed(() => knowledgeQnas.value.filter((qna) => qna.status === "CONFLICTED" || qna.status === "STALE"));
const knowledgeGapIntentOptions = computed(() => [...new Set(knowledgeGaps.value.map((gap) => gap.intent).filter((intent): intent is string => Boolean(intent)))].sort());
const filteredKnowledgeGaps = computed(() => {
  const search = knowledgeGapSearch.value.trim().toLowerCase();
  const cutoff = knowledgeGapRange.value === "all" ? null : Date.now() - Number(knowledgeGapRange.value) * 24 * 60 * 60 * 1_000;
  const filtered = knowledgeGaps.value.filter((gap) => {
    const statusMatch = knowledgeGapFilter.value === "all" || gap.status === knowledgeGapFilter.value;
    const intentMatch = knowledgeGapIntentFilter.value === "all" || (gap.intent ?? "general") === knowledgeGapIntentFilter.value;
    const frequencyMatch = knowledgeGapFrequencyFilter.value === "all"
      || (knowledgeGapFrequencyFilter.value === "10+" && gap.occurrenceCount >= 10)
      || (knowledgeGapFrequencyFilter.value === "3+" && gap.occurrenceCount >= 3)
      || (knowledgeGapFrequencyFilter.value === "1" && gap.occurrenceCount === 1);
    const dateMatch = cutoff === null || Date.parse(gap.lastSeenAt) >= cutoff;
    const searchMatch = !search || [gap.question, gap.intent, gap.reason, ...(gap.variants ?? [])].some((value) => value?.toLowerCase().includes(search));
    return statusMatch && intentMatch && frequencyMatch && dateMatch && searchMatch;
  });
  return [...filtered].sort((left, right) => {
    if (knowledgeGapSort.value === "newest") return Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
    if (knowledgeGapSort.value === "highestImpact") return knowledgeGapImpact(right) - knowledgeGapImpact(left) || right.occurrenceCount - left.occurrenceCount;
    return right.occurrenceCount - left.occurrenceCount || Date.parse(right.lastSeenAt) - Date.parse(left.lastSeenAt);
  });
});
const visibleKnowledgeGaps = computed(() => filteredKnowledgeGaps.value.slice((knowledgeGapPage.value - 1) * 25, knowledgeGapPage.value * 25));
const knowledgeGapTotal = computed(() => filteredKnowledgeGaps.value.length);
const knowledgeGapHasPrevious = computed(() => knowledgeGapPage.value > 1);
const knowledgeGapHasNext = computed(() => knowledgeGapPage.value * 25 < knowledgeGapTotal.value);
const knowledgeGapRangeStart = computed(() => knowledgeGapTotal.value ? (knowledgeGapPage.value - 1) * 25 + 1 : 0);
const knowledgeGapRangeEnd = computed(() => Math.min(knowledgeGapTotal.value, knowledgeGapPage.value * 25));
const visibleRetrievalDiagnostics = computed(() => retrievalDiagnostics.value);
const knowledgeQualityRangeLabel = computed(() => knowledgeQualityRange.value === "all" ? "all time" : `last ${knowledgeQualityRange.value} days`);
const knowledgeQualityRangeStart = computed(() => knowledgeQualityTotal.value ? (knowledgeQualityPage.value - 1) * 25 + 1 : 0);
const knowledgeQualityRangeEnd = computed(() => Math.min(knowledgeQualityTotal.value, knowledgeQualityPage.value * 25));
const knowledgeTestAction = computed(() => {
  if (knowledgeSourcesNeedAttention.value) return { label: "Fix sources first", disabled: true };
  if (knowledgeTestContext.value === "answer") return { label: "Test this answer", disabled: false };
  if (knowledgeTestContext.value === "updated" || workspaceKnowledge.value?.status === "indexing") return { label: "Test updated knowledge", disabled: false };
  if ((workspaceKnowledge.value?.openGaps ?? 0) > 0) return { label: "Test assistant anyway", disabled: false };
  return { label: "Test agent", disabled: false };
});
const executiveAnalytics = computed(() => workspaceStats.value?.executive ?? null);
const executiveFunnelSteps = computed(() => executiveAnalytics.value?.funnel.steps ?? []);
const executiveQualityMetrics = computed(() => executiveAnalytics.value?.quality.metrics ?? []);
const chartMax = computed(() => Math.max(1, ...(workspaceStats.value?.trend ?? []).flatMap((point) => [point.conversations, point.leads])));
const trialDaysRemaining = computed(() => {
  const end = billingSnapshot.value?.billing.trialEndAt;
  if (!end || billingSnapshot.value?.billing.status !== "trial") return 0;
  return Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / (24 * 60 * 60 * 1_000)));
});
const billingReadOnly = computed(() => Boolean(billingSnapshot.value && !billingSnapshot.value.billing.access.allowed && billingSnapshot.value.billing.mode !== "sandbox"));
const billingSuccessPlanName = computed(() => billingSnapshot.value?.billing.plan.displayName ?? formatPlanLabel(billingSuccessExpectedPlanKey.value || "starter"));
const billingSuccessPrice = computed(() => {
  const billing = billingSnapshot.value?.billing;
  if (!billing || billing.amountCents === null) return "Contact support";
  return `${new Intl.NumberFormat("en-US", { style: "currency", currency: billing.currency.toUpperCase(), maximumFractionDigits: 0 }).format(billing.amountCents / 100)}/${billing.interval === "year" ? "year" : "month"}`;
});
const billingSuccessViewedKey = computed(() => {
  const organizationId = authSnapshot.value?.activeOrganizationId ?? "workspace";
  const sessionId = route.value.kind === "billing-success" ? route.value.sessionId : "";
  return `frontdeskwise:billing-success-viewed:${organizationId}:${sessionId || billingSuccessExpectedPlanKey.value || "subscription"}`;
});
const billingSuccessToastKey = computed(() => `frontdeskwise:billing-success-toast:${authSnapshot.value?.activeOrganizationId ?? "workspace"}`);
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
const showSetupCard = computed(() => !adminSurfaceMode.value && !focusedTeamMode.value && Boolean(workspaceStats.value || (authSnapshot.value && !availableBusinesses.value.length)));
const setupSteps = computed(() => workspaceStats.value?.setup.steps ?? []);
const knowledgeSetupReady = computed(() => setupSteps.value.find((step) => step.id === "knowledge_ready")?.complete ?? false);
const knowledgeHasOpenGaps = computed(() => (workspaceKnowledge.value?.openGaps ?? 0) > 0);
const activeLeadDeliveryIntegration = computed(() => integrations.value.find((integration) => integration.connectionStatus === "active"
  && ["webhook", "hubspot", "jackrabbit"].includes(integration.provider)) ?? null);
const bookingActionReady = computed(() => visibleActionFlows.value.some((action) => action.enabled
  && (action.key === "book_appointment"
    || action.completion.leadStatus === "booked"
    || action.completion.completionMode === "booking_connector"
    || action.steps?.some((step) => ["book", "generate_link", "redirect"].includes(String(step.type))))));
const agentCapabilities = computed<AgentCapability[]>(() => [
  {
    id: "answer",
    title: "Answer questions",
    description: knowledgeSetupReady.value
      ? `${workspaceKnowledge.value?.sourceCount ?? 0} source${(workspaceKnowledge.value?.sourceCount ?? 0) === 1 ? "" : "s"} are backing grounded answers.`
      : "Review your website knowledge so the assistant can answer with confidence.",
    ready: knowledgeSetupReady.value,
    target: "knowledge",
    actionLabel: knowledgeSetupReady.value ? "Review knowledge" : "Set up knowledge",
  },
  {
    id: "capture",
    title: "Capture leads",
    description: showLeadCapture.value ? "Visitors can share their details with your team." : "Turn on lead capture when you are ready to collect demand.",
    ready: showLeadCapture.value,
    target: "agent",
    actionLabel: showLeadCapture.value ? "Review behavior" : "Set up lead capture",
  },
  {
    id: "handoff",
    title: "Hand off to your team",
    description: humanHandoffEnabled.value ? "Visitors can reach a person when AI should step aside." : "Give visitors a clear path to your team when they need help.",
    ready: humanHandoffEnabled.value,
    target: "agent",
    actionLabel: humanHandoffEnabled.value ? "Review behavior" : "Enable handoff",
  },
  {
    id: "lead-delivery",
    title: "Send leads to your CRM",
    description: activeLeadDeliveryIntegration.value
      ? `Leads are syncing through ${activeLeadDeliveryIntegration.value.displayName}.`
      : "Connect HubSpot, Zapier, or a webhook to send captured leads into your sales workflow.",
    ready: Boolean(activeLeadDeliveryIntegration.value),
    target: "integrations",
    actionLabel: activeLeadDeliveryIntegration.value ? "Manage connection" : "Connect lead delivery",
  },
  {
    id: "booking",
    title: "Book customers",
    description: bookingActionReady.value ? "A booking flow is ready for visitors to use." : "Create a booking or demo action so visitors can take the next step directly from chat.",
    ready: bookingActionReady.value,
    target: "actions",
    actionLabel: bookingActionReady.value ? "Review booking action" : "Create booking action",
  },
  {
    id: "proactive",
    title: "Engage visitors proactively",
    description: proactiveEnabled.value ? "Your assistant can invite high-intent visitors into a conversation." : "Invite visitors to chat when they pause, scroll, return, or show intent.",
    ready: proactiveEnabled.value,
    target: "agent",
    actionLabel: proactiveEnabled.value ? "Review engagement" : "Configure engagement",
  },
]);
const nextGuidance = computed<GuidanceRecommendation>(() => {
  if (publicDemoMode.value) return {
    id: "preview",
    eyebrow: "Live preview",
    title: "Your AI front desk is live ✓",
    description: "Explore the customer experience, then create your own workspace to connect business systems.",
    target: "overview",
    actionLabel: "View dashboard",
    ready: true,
  };
  const next = agentCapabilities.value.find((capability) => ["lead-delivery", "booking", "proactive"].includes(capability.id) && !capability.ready);
  if (next) return {
    id: next.id,
    eyebrow: "Recommended next step",
    title: next.title,
    description: next.description,
    target: next.target,
    actionLabel: next.actionLabel,
    ready: false,
  };
  return {
    id: "optimized",
    eyebrow: "Optimized",
    title: "You’re fully optimized ✓",
    description: "Your AI front desk is ready. It is answering, converting, and connected to the tools that run your business.",
    target: "overview",
    actionLabel: "View dashboard",
    ready: true,
  };
});
const nextSetupStep = computed<SetupStepId | null>(() => {
  if (!availableBusinesses.value.length) return null;
  return workspaceStats.value?.setup.nextRequiredStep ?? setupSteps.value.find((step) => !step.complete)?.id ?? null;
});
const setupCardContent = computed(() => {
  if (!availableBusinesses.value.length) return { eyebrow: "Get started", title: "Add your first business", description: "Add a website to create your AI front desk.", action: "Add business" };
  if (!nextSetupStep.value) return { eyebrow: nextGuidance.value.eyebrow, title: nextGuidance.value.title, description: nextGuidance.value.description, action: nextGuidance.value.actionLabel };
  const content: Record<SetupStepId, { eyebrow: string; title: string; description: string; action: string }> = {
    domain_verified: { eyebrow: "Needs attention", title: "Verify your website", description: "Verify ownership before installing the live widget.", action: "Verify website" },
    knowledge_ready: { eyebrow: "Next step", title: "Review your knowledge", description: "Make sure your assistant has reliable information.", action: "Review knowledge" },
    agent_tested: { eyebrow: "Next step", title: "Test your assistant", description: "Ask representative customer questions before going live.", action: "Test assistant" },
    widget_installed: { eyebrow: "Next step", title: "Install the widget", description: "Add FrontDeskWise to your website.", action: "Install widget" },
    agent_published: { eyebrow: "Ready to go live", title: "Publish your AI front desk", description: "Everything is connected. Make the front desk live.", action: "Publish AI front desk" },
  };
  return content[nextSetupStep.value];
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
  get: () => demoSlug.value,
  set: (value: string) => {
    void selectBusiness(value);
  },
});

const agentModel = computed<AgentSaveModel>(() => ({
  assistantName: assistantName.value,
  welcomeMessage: welcomeMessage.value,
  tone: agentTone.value,
  customToneInstructions: customToneInstructions.value,
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
  citationVisibility: citationVisibility.value,
  proactiveEnabled: proactiveEnabled.value,
  proactiveDelaySeconds: proactiveDelaySeconds.value,
  proactiveMessage: proactiveMessage.value,
  proactiveTriggers: proactiveTriggers.value,
  proactiveBehavior: proactiveBehavior.value,
  proactiveFrequency: proactiveFrequency.value,
  requireLeadConsent: requireLeadConsent.value,
  privacyNoticeUrl: privacyNoticeUrl.value,
  retentionDays: retentionDays.value,
  fallbackPhone: fallbackPhone.value,
  fallbackEmail: fallbackEmail.value,
  fallbackContactUrl: fallbackContactUrl.value,
}));

const agentTestModel = computed(() => ({
  conversationId: conversationId.value,
  messages: testMessages.value,
  suggestedQuestions: suggestedQuestions.value,
  isAsking: isAsking.value,
}));

function ownerHeaders(): Record<string, string> {
  const token = supportViewMode.value ? demoAccessToken.value : firebaseToken.value || demoAccessToken.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

const websitePreviewEndpoint = computed(() => demoSlug.value
  ? apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/website-preview`)
  : "");
const websitePreviewToken = computed(() => ownerHeaders().authorization?.replace(/^Bearer\s+/i, "") ?? "");

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
  if (nextView === "billing") return authSnapshot.value && !canAccessBilling.value
    ? routeForView("inbox")
    : settingsRoute("billing");
  if (nextView === "settings") return settingsRoute(settingsTab.value);
  if (focusedTeamMode.value && !["inbox", "leads", "support"].includes(nextView)) {
    return routeForView("inbox");
  }
  const isAgentSurface = nextView === "agent";
  const nextAgentTab = nextView === "conversations" ? "test" : isAgentSurface ? agentTab.value : undefined;
  const canonicalView: WorkspaceView = nextView === "conversations" || isAgentSurface ? "agent" : nextView as WorkspaceView;
  if (route.value.kind === "demo") return demoRoute(workspaceSlugForRoute(), canonicalView, nextAgentTab ? { agentTab: nextAgentTab } : {});
  return workspaceRoute(workspaceSlugForRoute(), canonicalView, nextAgentTab ? { agentTab: nextAgentTab } : {});
}

function commitRoute(nextRoute: AppRoute, replace = false, apply = true) {
  if (mobileNavOpen.value) closeMobileNav();
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
  if (nextRoute.kind === "auth-reset") {
    publicDemoMode.value = false;
    authModalOpen.value = false;
    await preparePasswordReset(nextRoute);
    return;
  }
  if (nextRoute.kind === "partner") {
    publicDemoMode.value = false;
    if (!authSnapshot.value) {
      redirectToSignIn();
      return;
    }
    return;
  }
  if (nextRoute.kind === "legal" || nextRoute.kind === "landing" || nextRoute.kind === "marketing") {
    const legacyReturn = legacyBillingReturn();
    if (authSnapshot.value && legacyReturn === "success") {
      const sessionId = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("session_id")?.trim() || undefined;
      commitRoute({ kind: "billing-success", ...(sessionId ? { sessionId } : {}) }, true);
      return;
    }
    if (authSnapshot.value && legacyReturn === "cancel") {
      commitRoute(settingsRoute("billing"), true);
      billingFlow.value = "cancelled";
      billingMessage.value = "Checkout was canceled. No changes were made.";
      return;
    }
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
      redirectToSignIn();
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
      redirectToSignIn();
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
      void loadAdminActionRegistry();
      void loadAdminCertification();
      void loadAdminExperienceSignals();
      void loadAdminFeatureFlags();
      void loadAdminUsers();
      void loadAdminDemoRequests();
      void loadAdminInstallationSupport();
      void loadAdminSupportCases();
      void loadAdminMessaging();
      void loadAdminRecovery();
      void loadAdminHealth();
      void loadAdminRequestMetrics();
    }
    return;
  }
  if (nextRoute.kind === "workspace-settings") {
    publicDemoMode.value = false;
    settingsTab.value = nextRoute.tab;
    if (nextRoute.tab === "billing" && authSnapshot.value && !canAccessBilling.value) {
      commitRoute(workspaceRoute(workspaceSlugForRoute(), "inbox"), true);
      return;
    }
    if (focusedTeamMode.value && nextRoute.tab !== "general") {
      commitRoute(workspaceRoute(workspaceSlugForRoute(), "inbox"), true);
      return;
    }
    return;
  }
  if (nextRoute.kind === "billing-success") {
    publicDemoMode.value = false;
    settingsTab.value = "billing";
    if (!authSnapshot.value || !canAccessBilling.value) {
      if (authSnapshot.value) commitRoute(workspaceRoute(workspaceSlugForRoute(), "inbox"), true);
      else redirectToSignIn();
      return;
    }
    void startBillingSuccessFlow();
    return;
  }
  if (nextRoute.kind === "agent-shortcut") {
    agentTab.value = nextRoute.agentTab;
    if (!authSnapshot.value && !demoAccessToken.value) {
      redirectToSignIn();
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
      redirectToSignIn();
      return;
    }
    const needsReload = demoSlug.value !== nextSlug || publicDemoMode.value !== isPublic || !workspaceStats.value;
    publicDemoMode.value = isPublic;
    demoSlug.value = nextSlug;
    if (!isPublic && focusedTeamMode.value && !["inbox", "leads", "support"].includes(nextRoute.view)) {
      commitRoute(workspaceRoute(nextSlug, "inbox"), true);
      return;
    }
    if (nextRoute.agentTab) agentTab.value = nextRoute.agentTab;
    if (needsReload) await loadBusinessWorkspace(nextSlug, isPublic);
    if (nextRoute.view === "support") await loadSupport();
    // Install metadata is ancillary to the conversation. Keep it out of the
    // route transition so entering Agent Test cannot blur the whole preview
    // while the test request is running.
    if (nextRoute.agentTab) void loadWidgetInstall(false);
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
  if (nextSetupStep.value) openSetupStep(nextSetupStep.value);
  else openGuidance(nextGuidance.value);
}

function openGuidance(recommendation: Pick<GuidanceRecommendation, "target">) {
  if (recommendation.target === "integrations") {
    openSettingsTab("integrations");
    return;
  }
  if (recommendation.target === "actions") {
    navigateToWorkspaceView("actions");
    return;
  }
  if (recommendation.target === "knowledge") {
    navigateToWorkspaceView("knowledge");
    return;
  }
  if (recommendation.target === "overview") {
    navigateToWorkspaceView("overview");
    return;
  }
  selectAgentTab(recommendation.target === "test" ? "test" : "behavior");
}

function openCapabilityAction(target: GuidanceTarget) {
  openGuidance({ target });
}

function openAgentWorkflow(workflowId?: string) {
  const options = workflowId?.trim() ? { workflowId: workflowId.trim() } : {};
  const nextRoute = route.value.kind === "demo"
    ? demoRoute(workspaceSlugForRoute(), "workflows", options)
    : workspaceRoute(workspaceSlugForRoute(), "workflows", options);
  commitRoute(nextRoute);
}

function openSetupStep(step: SetupStepId | null) {
  if (!step) {
    navigateToWorkspaceView("overview");
    return;
  }
  if (step === "domain_verified") {
    openSettingsTab("verification");
    return;
  }
  if (step === "knowledge_ready") {
    navigateToWorkspaceView("knowledge");
    return;
  }
  selectAgentTab(step === "agent_tested" ? "test" : "install");
}

function openWorkspaceAttention() {
  const action = workspaceAttention.value?.action;
  if (!action) return;
  if (action === "knowledge") view.value = "knowledge";
  else openSettingsTab(action);
}

function selectAgentTab(tab: AgentTab) {
  agentTab.value = tab;
  mobileNavOpen.value = false;
  commitRoute(routeForView("agent"));
  if (tab === "install") void loadWidgetInstall(false);
}

function openAgentTest(question?: string) {
  const normalizedQuestion = question?.trim() || undefined;
  invalidateTestRequest();
  knowledgeTestContext.value = null;
  resolvedKnowledgeQuestion.value = "";
  routedTestQuestion.value = "";
  const options = { agentTab: "test" as const, ...(normalizedQuestion ? { testQuestion: normalizedQuestion } : {}) };
  const nextRoute = route.value.kind === "demo"
    ? demoRoute(workspaceSlugForRoute(), "agent", options)
    : workspaceRoute(workspaceSlugForRoute(), "agent", options);
  commitRoute(nextRoute);
}

function customerBrandLabel(): string {
  const configured = assistantName.value.trim();
  return configured.replace(/\s+AI Assistant$/i, "").replace(/\s+Assistant$/i, "").trim() || businessName.value || "your business";
}

function actionCustomerMessage(action: ActionFlow): string {
  const configured = action.completion.message?.trim() ?? "";
  const genericMessages = new Set(["The verified link is ready.", "You can try the demo here.", "Here's the verified link.", "Here’s the verified link."]);
  if (configured && !genericMessages.has(configured)) return configured;
  const label = action.completion.linkLabel?.trim() || action.name.trim();
  if (/\bdemo\b/i.test(`${action.name} ${label}`)) return `Absolutely — you can try ${customerBrandLabel()} here.`;
  return configured || `Absolutely — ${label.toLowerCase()} is ready here.`;
}

function actionTestQuestion(action: ActionFlow): string {
  if (action.steps?.length) {
    const fieldKeys = new Set((action.fields ?? []).map((field) => field.key));
    if (fieldKeys.has("business_type")) return "I run a small salon and I'm looking for software.";
    if (fieldKeys.has("customer_type") || fieldKeys.has("child_age")) return "I want to find swim lessons for my child.";
    if (fieldKeys.has("usage_type") || fieldKeys.has("usage_level")) return "I'm choosing a plan for my business.";
    const firstTrigger = action.triggerPhrases.find((phrase) => phrase.trim());
    if (firstTrigger) return firstTrigger;
  }
  if (action.executionMode === "DIRECT_LINK") {
    const label = action.completion.linkLabel?.trim() || action.name.trim();
    return `I'd like to ${label.toLowerCase()}`;
  }
  return action.triggerPhrases.find((phrase) => phrase.trim()) || action.name;
}

function runActionTest(action: ActionFlow) {
  if (!action.enabled) {
    actionsMessage.value = "Enable this action before testing it.";
    return;
  }
  trackProductEvent(MIXPANEL_EVENTS.WORKFLOW_TEST_STARTED, {
    workflow_id: action.id,
    workflow_key: action.key,
    action_id: action.id,
    action_key: action.key,
  });
  clearSavedActionHighlight();
  resetAgentConversation();
  openAgentTest(actionTestQuestion(action));
}

function reviewKnowledgeGaps() {
  knowledgeTab.value = "gaps";
  knowledgeGapFilter.value = "open";
  if (typeof document === "undefined") return;
  nextTick(() => document.querySelector(".knowledge-gaps-panel")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function openKnowledgeAnswer(gap: KnowledgeGap) {
  knowledgeGapMenuOpen.value = null;
  selectedKnowledgeGap.value = gap;
  if (answerDrafts.value[gap.question] === undefined) answerDrafts.value[gap.question] = gap.approvedAnswer ?? "";
  knowledgeAnswerError.value = "";
  knowledgeAnswerFailedGap.value = null;
  knowledgeAnswerStatus.value = "";
  answerGapDrawerOpen.value = true;
}

function openKnowledgeQnaEditor(qna?: KnowledgeQna | null) {
  if (!qna && !canManageTeam.value) return;
  selectedKnowledgeQna.value = qna ?? null;
  knowledgeQnaDraft.value = {
    question: qna?.canonicalQuestion ?? "",
    answer: qna?.canonicalAnswer ?? "",
    variants: qna?.variants.filter((variant) => variant !== qna.canonicalQuestion).join("\n") ?? "",
    validUntil: qna?.validUntil ? qna.validUntil.slice(0, 10) : "",
  };
  knowledgeQnaError.value = "";
  knowledgeQnaMessage.value = "";
  knowledgeQnaDrawerOpen.value = true;
}

function closeKnowledgeQnaEditor() {
  if (knowledgeQnaSaving.value) return;
  knowledgeQnaDrawerOpen.value = false;
  selectedKnowledgeQna.value = null;
}

function qnaStatusLabel(status: KnowledgeQna["status"]): string {
  return status === "NEEDS_REVIEW" ? "Needs review" : formatLabel(status);
}

function qnaSourceLabel(qna: KnowledgeQna): string {
  if (qna.sourceType === "OWNER_CONFIRMED") return "Owner confirmed";
  if (qna.sourceType === "WEBSITE_DERIVED") return "Website";
  return "Owner";
}

async function saveKnowledgeQna() {
  if (!canManageTeam.value || knowledgeQnaSaving.value) return;
  const question = knowledgeQnaDraft.value.question.trim();
  const answer = knowledgeQnaDraft.value.answer.trim();
  if (!question || !answer) {
    knowledgeQnaError.value = "Add both a question and an answer.";
    return;
  }
  knowledgeQnaSaving.value = true;
  knowledgeQnaError.value = "";
  try {
    const variants = knowledgeQnaDraft.value.variants.split(/[\n,]/).map((item) => item.trim()).filter(Boolean);
    const body = { canonicalQuestion: question, canonicalAnswer: answer, variants, validUntil: knowledgeQnaDraft.value.validUntil ? new Date(`${knowledgeQnaDraft.value.validUntil}T23:59:59.000Z`).toISOString() : null };
    const endpoint = selectedKnowledgeQna.value
      ? `/api/v1/demo/${demoSlug.value}/knowledge/qna/${encodeURIComponent(selectedKnowledgeQna.value.id)}`
      : `/api/v1/demo/${demoSlug.value}/knowledge/qna`;
    const response = await trackedFetch(apiUrl(endpoint), {
      method: selectedKnowledgeQna.value ? "PUT" : "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(body),
    });
    const payload = await response.json() as { qna?: KnowledgeQna; error?: string };
    if (!response.ok || !payload.qna) throw new Error(payload.error ?? "Could not save this Q&A.");
    const existingIndex = knowledgeQnas.value.findIndex((item) => item.id === payload.qna?.id);
    if (existingIndex >= 0) knowledgeQnas.value[existingIndex] = payload.qna;
    else knowledgeQnas.value.unshift(payload.qna);
    knowledgeQnaMessage.value = "Answer added to verified business knowledge.";
    knowledgeQnaDrawerOpen.value = false;
    await refreshWorkspaceSummary(false);
  } catch (error) {
    knowledgeQnaError.value = error instanceof Error ? error.message : "Could not save this Q&A.";
  } finally {
    knowledgeQnaSaving.value = false;
  }
}

async function archiveKnowledgeQna(qna: KnowledgeQna) {
  if (!canManageTeam.value || knowledgeQnaSaving.value) return;
  knowledgeQnaSaving.value = true;
  knowledgeQnaError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/qna/${encodeURIComponent(qna.id)}/archive`), { method: "POST", headers: ownerHeaders() });
    const payload = await response.json() as { qna?: KnowledgeQna; error?: string };
    if (!response.ok || !payload.qna) throw new Error(payload.error ?? "Could not archive this Q&A.");
    Object.assign(qna, payload.qna);
  } catch (error) {
    knowledgeQnaError.value = error instanceof Error ? error.message : "Could not archive this Q&A.";
  } finally {
    knowledgeQnaSaving.value = false;
  }
}

async function reviewKnowledgeQna(qna: KnowledgeQna) {
  if (!canManageTeam.value || knowledgeQnaSaving.value) return;
  knowledgeQnaSaving.value = true;
  knowledgeQnaError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/qna/${encodeURIComponent(qna.id)}/review`), { method: "POST", headers: { "content-type": "application/json", ...ownerHeaders() }, body: JSON.stringify({ status: "VERIFIED" }) });
    const payload = await response.json() as { qna?: KnowledgeQna; error?: string };
    if (!response.ok || !payload.qna) throw new Error(payload.error ?? "Could not review this Q&A.");
    Object.assign(qna, payload.qna);
  } catch (error) {
    knowledgeQnaError.value = error instanceof Error ? error.message : "Could not review this Q&A.";
  } finally {
    knowledgeQnaSaving.value = false;
  }
}

function closeKnowledgeAnswer() {
  if (knowledgeAnswerSaving.value) return;
  answerGapDrawerOpen.value = false;
  selectedKnowledgeGap.value = null;
  knowledgeAnswerError.value = "";
  knowledgeAnswerFailedGap.value = null;
}

function viewResolvedQna() {
  const qna = knowledgeQnas.value.find((item) => item.id === selectedKnowledgeGap.value?.resolvedQnaId)
    ?? knowledgeQnas.value.find((item) => item.canonicalQuestion === selectedKnowledgeGap.value?.question);
  if (!qna) return;
  closeKnowledgeAnswer();
  knowledgeTab.value = "qna";
  openKnowledgeQnaEditor(qna);
}

function toggleKnowledgeGapMenu(question: string) {
  knowledgeGapMenuOpen.value = knowledgeGapMenuOpen.value === question ? null : question;
}

function viewKnowledgeGapConversation() {
  knowledgeGapMenuOpen.value = null;
  view.value = "inbox";
}

function viewKnowledgeGapRetrieval(gap: KnowledgeGap) {
  knowledgeGapMenuOpen.value = null;
  knowledgeTab.value = "quality";
  knowledgeQualitySearch.value = gap.question;
  knowledgeQualityRange.value = "all";
  applyKnowledgeQualityFilters();
}

function toggleKnowledgeSourceGroup(key: KnowledgeSourceGroupKey) {
  knowledgeSourceGroupOpen.value = knowledgeSourceGroupOpen.value === key ? null : key;
  if (key === "website") knowledgeSourceTypeFilter.value = "website";
  if (key === "documents") knowledgeSourceTypeFilter.value = "document";
  knowledgeSourcePage.value = 1;
}

async function refreshWebsiteKnowledge() {
  const websiteSource = knowledgeWebsiteSources.value[0];
  if (!websiteSource) {
    await refreshWorkspaceSummary();
    await loadKnowledge();
    return;
  }
  await recrawlSource(websiteSource);
  await loadKnowledge();
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
  // A routed question is a command, not persistent conversation state. The
  // route can be applied more than once while auth/workspace data settles, so
  // mark it as consumed before starting the async request. Previously we only
  // stopped re-entry after an answer existed, which allowed duplicate requests
  // while the test surface was still showing "Thinking…".
  if (!normalizedQuestion || routedTestQuestion.value === normalizedQuestion) return;
  routedTestQuestion.value = normalizedQuestion;

  // Consume the one-shot query immediately. This prevents a later route
  // re-application (for example after session/workspace hydration) from
  // starting the same test again, while preserving the current screen via a
  // replaceState instead of a full navigation.
  const currentRoute = route.value;
  if (currentRoute.kind === "workspace" && currentRoute.testQuestion === normalizedQuestion) {
    const { testQuestion: _testQuestion, ...routeWithoutQuestion } = currentRoute;
    commitRoute(routeWithoutQuestion, true, false);
  } else if (currentRoute.kind === "demo" && currentRoute.testQuestion === normalizedQuestion) {
    const { testQuestion: _testQuestion, ...routeWithoutQuestion } = currentRoute;
    commitRoute(routeWithoutQuestion, true, false);
  } else if (currentRoute.kind === "agent-shortcut" && currentRoute.testQuestion === normalizedQuestion) {
    const { testQuestion: _testQuestion, ...routeWithoutQuestion } = currentRoute;
    commitRoute(routeWithoutQuestion, true, false);
  }

  testQuestion.value = normalizedQuestion;
  clearTestResponse();
  testQuestion.value = normalizedQuestion;
  void askQuestion();
}

function openHelpAndSupport() {
  sidebarAccountMenuOpen.value = false;
  profileMenuOpen.value = false;
  notificationMenuOpen.value = false;
  supportSourcePage.value = pageTitle.value;
  supportCategory.value = "general";
  supportProvider.value = "";
  supportConnectionId.value = "";
  navigateToWorkspaceView("support");
}

function openSupportReport(category: SupportCaseCategory = "general", provider = "", connectionId = "") {
  supportSourcePage.value = pageTitle.value;
  supportCategory.value = category;
  supportProvider.value = provider;
  supportConnectionId.value = connectionId;
  supportSubmitError.value = "";
  supportSubmitMessage.value = "";
  supportOpenReportRequest.value += 1;
  if (view.value !== "support") navigateToWorkspaceView("support");
}

function isProtectedRoute(candidate: AppRoute = route.value): boolean {
  return candidate.kind === "agent-shortcut"
    || candidate.kind === "onboarding"
    || candidate.kind === "partner"
    || candidate.kind === "billing-success"
    || candidate.kind === "platform"
    || candidate.kind === "workspace"
    || candidate.kind === "workspace-settings";
}

function currentReturnTo(): string {
  if (typeof window === "undefined") return routePath(route.value);
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function routeFromReturnTo(returnTo: string | undefined): AppRoute | null {
  if (!returnTo || typeof window === "undefined") return null;
  try {
    const url = new URL(returnTo, window.location.origin);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/") || url.pathname.startsWith("//")) return null;
    const candidate = parseRoute({ pathname: url.pathname, search: url.search });
    return isProtectedRoute(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

function redirectToSignIn(returnTo = currentReturnTo()): void {
  if (sessionRedirecting || route.value.kind === "auth") return;
  sessionRedirecting = true;
  authSnapshot.value = null;
  firebaseToken.value = "";
  isSuperAdmin.value = false;
  clearWorkspaceState();
  authMode.value = "signin";
  authError.value = "";
  authSuccess.value = "";
  authPassword.value = "";
  authModalOpen.value = true;
  const nextRoute: AppRoute = {
    kind: "auth",
    mode: "signin",
    ...(isProtectedRoute(route.value) && returnTo ? { returnTo } : {}),
  };
  commitRoute(nextRoute, true);
  void signOutFrontDeskWise().catch(() => undefined);
}

function openAuth(mode: "signin" | "signup" | "forgot" = "signin", syncRoute = true, requestedReturnTo?: string) {
  const openingSignup = mode === "signup" && (!authModalOpen.value || authMode.value !== "signup");
  authMode.value = mode;
  authError.value = "";
  authSuccess.value = "";
  authPassword.value = "";
  authModalOpen.value = true;
  if (openingSignup) trackProductEvent(MIXPANEL_EVENTS.SIGNUP_STARTED, { entrypoint: view.value });
  const returnTo = requestedReturnTo
    ?? (route.value.kind === "auth" ? route.value.returnTo : isProtectedRoute(route.value) ? currentReturnTo() : undefined);
  if (syncRoute && (route.value.kind !== "auth" || route.value.mode !== mode || route.value.returnTo !== returnTo)) {
    commitRoute({ kind: "auth", mode, ...(returnTo ? { returnTo } : {}) });
  }
}

function openSettingsTab(tab: SettingsTab) {
  if (tab === "billing" && authSnapshot.value && !canAccessBilling.value) {
    navigateToWorkspaceView("inbox");
    return;
  }
  if (focusedTeamMode.value && tab !== "general") {
    navigateToWorkspaceView("inbox");
    return;
  }
  settingsTab.value = tab;
  profileMenuOpen.value = false;
  sidebarAccountMenuOpen.value = false;
  notificationMenuOpen.value = false;
  mobileNavOpen.value = false;
  if (tab === "team") view.value = "team";
  else if (tab === "integrations") view.value = "connections";
  else if (tab === "billing") view.value = "billing";
  else view.value = "settings";
}

function navigateToWorkspaceView(nextView: View) {
  profileMenuOpen.value = false;
  sidebarAccountMenuOpen.value = false;
  notificationMenuOpen.value = false;
  mobileNavOpen.value = false;
  if (focusedTeamMode.value && !["inbox", "leads", "support"].includes(nextView)) {
    nextView = "inbox";
  }
  if (nextView === "settings") openSettingsTab("general");
  else commitRoute(routeForView(nextView));
}

function navigateToNavItem(item: WorkspaceNavItem) {
  if (item.settingsTab) {
    openSettingsTab(item.settingsTab);
    commitRoute(settingsRoute(item.settingsTab));
    return;
  }
  navigateToWorkspaceView(item.id);
}

function isNavItemActive(item: WorkspaceNavItem): boolean {
  return item.settingsTab
    ? view.value === item.id && currentSettingsTab.value === item.settingsTab
    : view.value === item.id;
}

function isExpiredDemoSessionError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /demo (?:access )?session|demo access token/i.test(message) && /invalid|expired/i.test(message);
}

function friendlyAuthError(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code ?? "").replace(/^firebase:\s*/i, "").toLowerCase()
    : (message.match(/auth\/[a-z-]+/i)?.[0] ?? "").toLowerCase();
  const messages: Record<string, string> = {
    "auth/invalid-credential": "The email or password is incorrect.",
    "auth/wrong-password": "The email or password is incorrect.",
    "auth/user-not-found": "The email or password is incorrect.",
    "auth/user-disabled": "This account has been disabled. Contact support.",
    "auth/too-many-requests": "Too many attempts. Please try again later.",
    "auth/network-request-failed": "We couldn't reach the sign-in service. Check your connection and try again.",
    "auth/invalid-email": "Enter a valid email address.",
    "auth/email-already-in-use": "An account already exists for this email. Try signing in instead.",
    "auth/weak-password": "Choose a stronger password with at least 6 characters.",
    "auth/popup-closed-by-user": "Google sign-in was cancelled. Try again or use email and password.",
    "auth/expired-action-code": "This reset link has expired. Request a new one.",
    "auth/invalid-action-code": "This reset link is invalid or has already been used.",
  };
  if (code && messages[code]) return messages[code];
  if (/Firebase web settings|Vercel environment|auth domain|SSL certificate/i.test(message)) {
    return "Sign-in is temporarily unavailable. Please try again later.";
  }
  return fallback;
}

async function preparePasswordReset(nextRoute: Extract<AppRoute, { kind: "auth-reset" }>) {
  resetActionCode.value = nextRoute.oobCode ?? "";
  resetEmail.value = "";
  resetPasswordValue.value = "";
  resetPasswordConfirmation.value = "";
  resetReady.value = false;
  resetComplete.value = false;
  resetError.value = "";
  if (!resetActionCode.value) {
    resetError.value = "This reset link is invalid or incomplete. Request a new one from the sign-in page.";
    return;
  }
  try {
    resetEmail.value = await verifyFrontDeskWisePasswordResetCode(resetActionCode.value);
    resetReady.value = true;
  } catch (error) {
    resetError.value = friendlyAuthError(error, "This reset link is invalid or has expired. Request a new one.");
  }
}

async function submitPasswordUpdate() {
  if (resetLoading.value || !resetReady.value) return;
  if (resetPasswordValue.value.length < 6) {
    resetError.value = "Use at least 6 characters for your new password.";
    return;
  }
  if (resetPasswordValue.value !== resetPasswordConfirmation.value) {
    resetError.value = "The passwords do not match.";
    return;
  }
  resetLoading.value = true;
  resetError.value = "";
  try {
    await confirmFrontDeskWisePasswordReset(resetActionCode.value, resetPasswordValue.value);
    resetComplete.value = true;
    resetReady.value = false;
    resetPasswordValue.value = "";
    resetPasswordConfirmation.value = "";
  } catch (error) {
    resetError.value = friendlyAuthError(error, "We couldn't update your password. Request a new reset link and try again.");
  } finally {
    resetLoading.value = false;
  }
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
  if (authLoading.value) return;
  if (authMode.value === "forgot") {
    if (!authEmail.value.trim()) return;
    await resetPassword();
    return;
  }
  if (!authEmail.value.trim() || authPassword.value.length < 6) return;
  authLoading.value = true;
  authError.value = "";
  authSuccess.value = "";
  startGlobalLoading();
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    const mode = authMode.value;
    const returnTo = route.value.kind === "auth" ? route.value.returnTo : undefined;
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => mode === "signup"
      ? signUpAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value)
      : signInAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value));
    firebaseToken.value = await currentFirebaseToken();
    identifyMixpanelUser(authSnapshot.value.user.id, {
      organization_id: authSnapshot.value.activeOrganizationId ?? undefined,
      user_role: authSnapshot.value.organizations[0]?.role,
      plan: authSnapshot.value.organizations[0]?.billing.planKey,
    });
    if (mode === "signup") trackProductEvent(MIXPANEL_EVENTS.SIGNUP_COMPLETED, { method: "email" });
    if (authSnapshot.value.user.emailVerified) {
      trackProductEventOnce(`email-verified:${authSnapshot.value.user.id}`, MIXPANEL_EVENTS.EMAIL_VERIFIED, { method: "email" });
    }
    await settleAuthenticatedSession(returnTo);
    authModalOpen.value = false;
    sessionRedirecting = false;
    authPassword.value = "";
    notifySuccess(mode === "signup" ? "Your workspace is ready." : "You're signed in.", mode === "signup" ? "Account created" : "Welcome back");
  } catch (error) {
    const message = friendlyAuthError(error, "Could not finish sign-in.");
    authError.value = message;
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

async function submitGoogleAuth() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  authSuccess.value = "";
  startGlobalLoading();
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    const returnTo = route.value.kind === "auth" ? route.value.returnTo : undefined;
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => signInWithGoogleAndBootstrap(demoToken, authOrganizationName.value));
    firebaseToken.value = await currentFirebaseToken();
    identifyMixpanelUser(authSnapshot.value.user.id, {
      organization_id: authSnapshot.value.activeOrganizationId ?? undefined,
      user_role: authSnapshot.value.organizations[0]?.role,
      plan: authSnapshot.value.organizations[0]?.billing.planKey,
    });
    if (authMode.value === "signup") trackProductEvent(MIXPANEL_EVENTS.SIGNUP_COMPLETED, { method: "google" });
    if (authSnapshot.value.user.emailVerified) {
      trackProductEventOnce(`email-verified:${authSnapshot.value.user.id}`, MIXPANEL_EVENTS.EMAIL_VERIFIED, { method: "google" });
    }
    await settleAuthenticatedSession(returnTo);
    authModalOpen.value = false;
    sessionRedirecting = false;
    notifySuccess("You're signed in with Google.", "Welcome back");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const friendlyMessage = message.includes("auth/popup-closed-by-user")
      ? "Google sign-in was cancelled. Try again or use email and password."
      : friendlyAuthError(error, "Could not finish Google sign-in.");
    authError.value = friendlyMessage;
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

async function resendVerificationEmail() {
  if (verificationEmailLoading.value) return;
  verificationEmailLoading.value = true;
  verificationEmailMessage.value = "";
  try {
    await resendFrontDeskWiseVerificationEmail();
    verificationEmailMessage.value = "Verification email sent. Refresh after you confirm your address.";
  } catch (error) {
    verificationEmailMessage.value = friendlyAuthError(error, "Could not send a verification email. Try again shortly.");
  } finally {
    verificationEmailLoading.value = false;
  }
}

async function signOut() {
  startGlobalLoading();
  try {
    await signOutFrontDeskWise();
    forgetDemoAccessToken();
    authSnapshot.value = null;
    firebaseToken.value = "";
    resetMixpanelUser();
    profileMenuOpen.value = false;
    sidebarAccountMenuOpen.value = false;
    notificationMenuOpen.value = false;
    openHome();
    notifySuccess("You have been signed out.", "Signed out");
  } catch (error) {
    notify("error", friendlyAuthError(error, "Could not sign you out. Please try again."), "Sign-out failed");
  } finally {
    stopGlobalLoading();
  }
}

async function resetPassword() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  authSuccess.value = "";
  startGlobalLoading();
  try {
    await sendFrontDeskWisePasswordReset(authEmail.value);
    authSuccess.value = "Check your inbox for password recovery instructions.";
  } catch (error) {
    const message = friendlyAuthError(error, "Could not send password reset instructions.");
    authError.value = message;
  } finally {
    authLoading.value = false;
    stopGlobalLoading();
  }
}

function closeMobileNav() {
  mobileNavOpen.value = false;
  notificationMenuOpen.value = false;
  profileMenuOpen.value = false;
  sidebarAccountMenuOpen.value = false;
}

function handleMobileNavKeydown(event: KeyboardEvent) {
  if (!mobileNavOpen.value || !mobileDrawer.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeMobileNav();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(mobileDrawer.value.querySelectorAll<HTMLElement>(
    'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter((element) => element.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && (document.activeElement === first || !mobileDrawer.value.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (document.activeElement === last || !mobileDrawer.value.contains(document.activeElement))) {
    event.preventDefault();
    first.focus();
  }
}

function handleViewportChange() {
  if (typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches) closeMobileNav();
}

watch(mobileNavOpen, async (open) => {
  if (typeof document === "undefined") return;
  if (open) {
    previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    await nextTick();
    mobileDrawer.value?.querySelector<HTMLElement>(".mobile-drawer-close")?.focus();
    return;
  }
  document.body.style.overflow = previousBodyOverflow;
  previousBodyOverflow = "";
  await nextTick();
  mobileMenuButton.value?.focus();
});

function closeInboxConversation() {
  selectedInboxConversation.value = null;
  inboxReply.value = "";
  inboxNote.value = "";
  inboxLocalMessages.value = {};
  inboxNewMessageCount.value = 0;
  inboxNearBottom.value = true;
}

function requireAccountForPublish() {
  if (authSnapshot.value) return true;
  openAuth("signup");
  return false;
}

function clearWorkspaceState() {
  invalidateTestRequest();
  businessName.value = "";
  businessLocation.value = "";
  websiteUrl.value = "";
  websiteBrandColors.value = [];
  assistantName.value = "AI Front Desk";
  welcomeMessage.value = "Hi! I can answer questions from this business's website and help you get started.";
  agentTone.value = "friendly";
  customToneInstructions.value = "";
  primaryLanguage.value = "English";
  fallbackBehavior.value = "contact_form";
  humanHandoffEnabled.value = true;
  widgetDefaultMode.value = "compact";
  widgetAllowExpand.value = true;
  widgetLogoUrl.value = "";
  workspaceLogoPreviewUrl.value = "";
  workspaceLogoLoadFailed.value = false;
  widgetTheme.value = "auto";
  widgetPosition.value = "bottom-right";
  widgetQuickActions.value = [
    { label: "Ask a question", question: "What would you like help with?", kind: "KNOWLEDGE", approved: true, generated: true },
  ];
  proactiveEnabled.value = false;
  proactiveDelaySeconds.value = 20;
  proactiveMessage.value = "Looking for the right service? I can help.";
  proactiveTriggers.value = ["delay", "scroll", "returning"];
  proactiveBehavior.value = "teaser";
  proactiveFrequency.value = "session";
  requireLeadConsent.value = false;
  privacyNoticeUrl.value = "";
  retentionDays.value = 90;
  showAiDisclosure.value = true;
  citationVisibility.value = "always";
  fallbackPhone.value = "";
  fallbackEmail.value = "";
  fallbackContactUrl.value = "";
  workspaceStats.value = null;
  workspaceKnowledge.value = null;
  workspaceOnboarding.value = null;
  workflowContext.value = null;
  workspaceBusinessId.value = null;
  workspaceOrganizationId.value = null;
  workspaceReadiness.value = 0;
  supportCases.value = [];
  supportContext.value = null;
  supportError.value = "";
  supportSubmitError.value = "";
  supportSubmitMessage.value = "";
  leads.value = [];
  inboxConversations.value = [];
  inboxPage.value = 1;
  inboxTotal.value = 0;
  inboxHasNext.value = false;
  inboxHasPrevious.value = false;
  inboxSummary.value = { needsResponse: 0, unread: 0, ai: 0, resolved: 0 };
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
  notificationActionLoading.value = false;
  notificationActionError.value = "";
  selectedLead.value = null;
  leadDetailOpen.value = false;
  leadSearch.value = "";
  leadStatusFilter.value = "all";
  leadExportMessage.value = "";
  knowledgeGaps.value = [];
  knowledgeQnas.value = [];
  knowledgeQnaSearch.value = "";
  knowledgeQnaStatusFilter.value = "ALL";
  knowledgeQnaDrawerOpen.value = false;
  selectedKnowledgeQna.value = null;
  retrievalDiagnostics.value = [];
  knowledgeTab.value = "overview";
  knowledgeGapFilter.value = "open";
  knowledgeGapSort.value = "highestImpact";
  knowledgeGapSearch.value = "";
  knowledgeGapIntentFilter.value = "all";
  knowledgeGapFrequencyFilter.value = "all";
  knowledgeGapRange.value = "30";
  knowledgeGapPage.value = 1;
  knowledgeSourceSearch.value = "";
  knowledgeSourceTypeFilter.value = "all";
  knowledgeSourceStatusFilter.value = "all";
  knowledgeSourcePage.value = 1;
  knowledgeSourceGroupOpen.value = null;
  knowledgeQualityFilter.value = "all";
  knowledgeQualityRange.value = "30";
  knowledgeQualitySearch.value = "";
  knowledgeQualityPage.value = 1;
  knowledgeQualityTotal.value = 0;
  knowledgeQualityHasNext.value = false;
  knowledgeQualityHasPrevious.value = false;
  knowledgeMoreOpen.value = false;
  knowledgeGapMenuOpen.value = null;
  answerGapDrawerOpen.value = false;
  selectedKnowledgeGap.value = null;
  organizationDocuments.value = [];
  integrations.value = [];
  mcpConnections.value = [];
  actionFlows.value = [];
  workflowRecords.value = [];
  workflowsLoading.value = false;
  workflowsError.value = "";
  workflowsLoadGeneration += 1;
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
  agentPublishing.value = { status: "NOT_PUBLISHED", domain: null, publishedAt: null, configVersion: null };
  agentPublishingLoading.value = false;
  agentPublishingError.value = "";
  ownershipVerification.value = null;
  verificationToken.value = "";
  verificationInstructions.value = "";
  verificationMessage.value = "";
  verificationError.value = "";
  conversationId.value = "";
  testQuestion.value = "";
  routedTestQuestion.value = "";
  testMessages.value = [];
  testAnswer.value = "";
  answerGrounded.value = false;
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
  suggestedQuestions.value = [];
  readinessEvaluation.value = null;
  evaluationError.value = "";
}

function applyWorkspacePayload(payload: WorkspacePayload) {
  workspaceBusinessId.value = payload.business?.id ?? null;
  workspaceOrganizationId.value = payload.business?.organizationId ?? null;
  businessName.value = payload.business?.name ?? "";
  businessLocation.value = payload.business?.location ?? "";
  websiteUrl.value = payload.business?.websiteUrl ?? "";
  websiteBrandColors.value = Array.isArray(payload.branding?.colors)
    ? payload.branding.colors.filter((color): color is string => typeof color === "string" && /^#[\da-f]{6}$/i.test(color))
    : [];
  assistantName.value = payload.agent?.assistantName ?? (businessName.value ? `${businessName.value} Assistant` : "AI Front Desk");
  welcomeMessage.value = payload.agent?.welcomeMessage ?? "Hi! I can answer questions from this business's website and help you get started.";
  agentTone.value = payload.agent?.tone ?? "friendly";
  customToneInstructions.value = payload.agent?.customToneInstructions ?? "";
  primaryLanguage.value = payload.agent?.primaryLanguage ?? "English";
  fallbackBehavior.value = payload.agent?.fallbackBehavior ?? "contact_form";
  humanHandoffEnabled.value = payload.agent?.humanHandoffEnabled ?? true;
  widgetColor.value = payload.agent?.widgetColor ?? "#0d6efd";
  showLeadCapture.value = payload.agent?.collectLeads ?? true;
  showBookingAction.value = payload.agent?.showBookingAction ?? true;
  widgetDefaultMode.value = payload.agent?.widgetDefaultMode ?? "compact";
  widgetAllowExpand.value = payload.agent?.widgetAllowExpand ?? true;
  workspaceLogoPreviewUrl.value = "";
  workspaceLogoLoadFailed.value = false;
  widgetLogoUrl.value = payload.agent?.widgetLogoUrl ?? "";
  widgetTheme.value = payload.agent?.widgetTheme ?? "auto";
  widgetPosition.value = payload.agent?.widgetPosition ?? "bottom-right";
  widgetQuickActions.value = payload.agent?.widgetQuickActions?.length
    ? payload.agent.widgetQuickActions.map((action) => ({ ...action }))
    : [{ label: "Ask a question", question: "What would you like help with?", kind: "KNOWLEDGE", approved: true, generated: true }];
  if (!widgetQuickActions.value.length) widgetQuickActions.value = [{ label: "Ask a question", question: "What would you like help with?", kind: "KNOWLEDGE", approved: true, generated: true }];
  proactiveEnabled.value = payload.agent?.proactiveEnabled ?? false;
  proactiveDelaySeconds.value = payload.agent?.proactiveDelaySeconds ?? 20;
  proactiveMessage.value = payload.agent?.proactiveMessage ?? "Looking for the right service? I can help.";
  proactiveTriggers.value = payload.agent?.proactiveTriggers?.length ? payload.agent.proactiveTriggers : ["delay", "scroll", "returning"];
  proactiveBehavior.value = payload.agent?.proactiveBehavior ?? "teaser";
  proactiveFrequency.value = payload.agent?.proactiveFrequency ?? "session";
  requireLeadConsent.value = payload.agent?.requireLeadConsent ?? false;
  privacyNoticeUrl.value = payload.agent?.privacyNoticeUrl ?? "";
  retentionDays.value = payload.agent?.retentionDays ?? 90;
  showAiDisclosure.value = payload.agent?.showAiDisclosure ?? true;
  citationVisibility.value = payload.agent?.citationVisibility ?? "always";
  fallbackPhone.value = payload.agent?.fallbackContacts?.phone ?? "";
  fallbackEmail.value = payload.agent?.fallbackContacts?.email ?? "";
  fallbackContactUrl.value = payload.agent?.fallbackContacts?.url ?? "";
  suggestedQuestions.value = payload.suggestedQuestions ?? [];
  ownershipVerification.value = payload.ownership ?? null;
  agentPublishing.value = payload.publishing ?? {
    status: payload.publishedAt ? "LIVE" : "NOT_PUBLISHED",
    domain: null,
    publishedAt: payload.publishedAt ?? null,
    configVersion: null,
  };
  workspaceStats.value = payload.stats ?? null;
  workspaceKnowledge.value = payload.knowledge ?? null;
  workspaceOnboarding.value = payload.onboarding ?? null;
  workflowContext.value = payload.workflowContext ?? null;
  workspaceReadiness.value = payload.knowledge?.readiness?.score ?? 0;
  if (payload.business?.id && payload.onboarding?.knowledgeReady === true && (payload.knowledge?.indexed === true || ((payload.knowledge?.sourceCount ?? 0) > 0 && (payload.knowledge?.pendingSources ?? 0) === 0))) {
    trackProductEventOnce(`business-brain-ready:${payload.business.id}`, MIXPANEL_EVENTS.BUSINESS_BRAIN_READY, {
      business_id: payload.business.id,
      readiness_score: payload.knowledge?.readiness?.score,
      source_count: payload.knowledge?.sourceCount,
    });
  }
  conversationId.value = "";
  testMessages.value = [];
}

let workspaceLoadPromise: Promise<void> | null = null;
let workspaceLoadPromiseKey = "";

function loadBusinessWorkspace(slug: string, publicOnly = false): Promise<void> {
  const loadKey = `${publicOnly ? "public" : "owner"}:${slug}`;
  const existingPromise = workspaceLoadPromise;
  if (existingPromise && workspaceLoadPromiseKey === loadKey) return existingPromise;

  const loadPromise = loadBusinessWorkspaceInternal(slug, publicOnly);
  workspaceLoadPromiseKey = loadKey;
  const trackedPromise = loadPromise.finally(() => {
    if (workspaceLoadPromise === trackedPromise) {
      workspaceLoadPromise = null;
      workspaceLoadPromiseKey = "";
    }
  });
  workspaceLoadPromise = trackedPromise;
  return trackedPromise;
}

async function loadBusinessWorkspaceInternal(slug: string, publicOnly = false) {
  const loadGeneration = ++workspaceLoadGeneration;
  workspaceLoading.value = true;
  publicDemoMode.value = publicOnly;
  workspaceError.value = "";
  clearWorkspaceState();
  try {
    const endpoint = publicOnly ? `/api/v1/demo/${slug}/public` : `/api/v1/demo/${slug}`;
    const response = await trackedFetch(apiUrl(endpoint), { headers: ownerHeaders() });
    const payload = await response.json() as WorkspacePayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load this workspace.");
    if (loadGeneration !== workspaceLoadGeneration || demoSlug.value !== slug) return;
    applyWorkspacePayload(payload);
    if (!publicOnly) {
      await Promise.allSettled([loadLeads(), loadKnowledge(), loadWidgetInstall(), loadIntegrations(), loadProviderConnections(), loadMcpConnections(), loadActions(), loadDocuments(), loadOwnershipVerification(), loadNotifications()]);
    }
  } catch (error) {
    if (loadGeneration !== workspaceLoadGeneration || demoSlug.value !== slug) return;
    workspaceError.value = error instanceof Error ? error.message : "Could not load this workspace.";
  } finally {
    if (loadGeneration === workspaceLoadGeneration && demoSlug.value === slug) workspaceLoading.value = false;
  }
}

async function refreshWorkspaceSummary(globalLoading = true) {
  if (!demoSlug.value || (!firebaseToken.value && !demoAccessToken.value)) return;
  const slug = demoSlug.value;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${slug}`), { headers: ownerHeaders() }, { globalLoading });
    const payload = await response.json() as WorkspacePayload;
    if (!response.ok) return;
    if (demoSlug.value !== slug) return;
    workspaceBusinessId.value = payload.business?.id ?? workspaceBusinessId.value;
    workspaceOrganizationId.value = payload.business?.organizationId ?? workspaceOrganizationId.value;
    workspaceStats.value = payload.stats ?? null;
    workspaceKnowledge.value = payload.knowledge ?? null;
    workspaceOnboarding.value = payload.onboarding ?? workspaceOnboarding.value;
    workflowContext.value = payload.workflowContext ?? null;
    workspaceReadiness.value = payload.knowledge?.readiness?.score ?? 0;
  } catch {
    // The mutation already succeeded; the next view load will reconcile the summary.
  }
}

async function refreshWorkflowWorkspace(): Promise<void> {
  workflowContextRefreshMessage.value = "Business context changed. Refreshing business data…";
  const refreshSlug = demoSlug.value;
  await loadBusinessWorkspace(refreshSlug, publicDemoMode.value);
  if (demoSlug.value === refreshSlug && !workspaceError.value && typeof window !== "undefined") {
    window.setTimeout(() => {
      if (demoSlug.value === refreshSlug) workflowContextRefreshMessage.value = "";
    }, 2_400);
  }
}

async function refreshAuthenticatedSnapshot() {
  if (!firebaseToken.value) return;
  try {
    const snapshot = await currentAuthSnapshot();
    if (snapshot) {
      authSnapshot.value = snapshot;
      const refreshedToken = await currentFirebaseToken();
      if (refreshedToken) firebaseToken.value = refreshedToken;
    }
  } catch (error) {
    if (isFirebaseSessionInvalid(error)) redirectToSignIn();
    // Summary refresh must not turn a successful question/lead mutation into an error.
  }
}

async function selectBusiness(slug: string, nextViewOverride?: View) {
  if (!slug) return;
  const previousWorkspaceSlug = demoSlug.value;
  const wasPublicDemo = publicDemoMode.value;
  const nextView = (authSnapshot.value && (roleForBusinessSlug(slug) === "staff" || roleForBusinessSlug(slug) === "viewer"))
    ? "inbox"
    : nextViewOverride ?? view.value;
  publicDemoMode.value = false;
  workflowContextRefreshMessage.value = "";
  actionsLoadGeneration += 1;
  integrationsLoadGeneration += 1;
  demoSlug.value = slug;
  // Keep control-plane and onboarding deep links stable while the session
  // hydrates. Workspace selection should only rewrite a workspace route.
  if (!["workspace-settings", "billing-success", "platform", "onboarding"].includes(route.value.kind)) {
    const nextWorkspaceView: WorkspaceView = nextView === "conversations"
      ? "agent"
      : nextView === "admin" || nextView === "home" || nextView === "privacy" || nextView === "terms"
        ? "overview"
        : nextView as WorkspaceView;
    const routeAgentTab = (route.value.kind === "workspace" || route.value.kind === "demo") && route.value.agentTab
      ? route.value.agentTab
      : agentTab.value;
    const options = nextWorkspaceView === "agent"
      ? {
        agentTab: routeAgentTab,
        ...((route.value.kind === "workspace" || route.value.kind === "demo") && routeAgentTab === "test" && route.value.testQuestion
          ? { testQuestion: route.value.testQuestion }
          : {}),
      }
      : {};
    if (nextWorkspaceView === "agent") agentTab.value = routeAgentTab;
    commitRoute(workspaceRoute(slug, nextWorkspaceView, options), false, false);
  }
  // Firebase's onIdTokenChanged also fires for ordinary token refreshes. The
  // workspace is already hydrated in that case; reloading it here would clear
  // the Agent Test conversation and briefly show the global loading overlay.
  const workspaceAlreadyLoaded = previousWorkspaceSlug === slug && Boolean(workspaceStats.value) && !wasPublicDemo;
  if (!workspaceAlreadyLoaded) await loadBusinessWorkspace(slug);
  if (route.value.kind === "workspace" && route.value.agentTab === "test" && route.value.testQuestion) {
    void runRoutedTestQuestion(route.value.testQuestion);
  }
}

function openBusinessWorkspace(slug: string) {
  if (!slug) return;
  void selectBusiness(slug, "overview");
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
    clearWorkspaceState();
    return false;
  }
}

async function settleAuthenticatedSession(returnTo?: string): Promise<void> {
  if (!authSnapshot.value) return;
  if (route.value.kind === "partner") {
    publicDemoMode.value = false;
    return;
  }
  const legacyReturn = legacyBillingReturn();
  if (legacyReturn === "success") {
    const sessionId = typeof window === "undefined" ? undefined : new URLSearchParams(window.location.search).get("session_id")?.trim() || undefined;
    commitRoute({ kind: "billing-success", ...(sessionId ? { sessionId } : {}) }, true, false);
  } else if (legacyReturn === "cancel") {
    commitRoute(settingsRoute("billing"), true, false);
  }
  const returnRoute = routeFromReturnTo(returnTo);
  if (returnRoute) route.value = returnRoute;
  isSuperAdmin.value = authSnapshot.value.user.isSuperAdmin;
  const hasBusiness = await syncAuthenticatedBusiness(authSnapshot.value);
  if (hasBusiness) {
    await loadBilling();
    if (route.value.kind === "billing-success") await startBillingSuccessFlow();
    else if (legacyReturn === "cancel") {
      billingFlow.value = "cancelled";
      billingMessage.value = "Checkout was canceled. No changes were made.";
    } else await reconcileBillingReturn();
  }
  if (isSuperAdmin.value && (isPlatformRoute() || !hasBusiness)) await loadAdminOrganizations();
  if (supportViewMode.value && demoAccessToken.value && hasBusiness === false) return;
  if (isSuperAdmin.value && !hasBusiness) {
    navigateToAdminSection("overview");
    return;
  }
  const requestedBusinessAvailable = returnRoute?.kind !== "workspace"
    || authSnapshot.value.organizations.some((organization) => organization.businesses.some((business) => business.slug === returnRoute.businessSlug));
  if (returnRoute && hasBusiness && requestedBusinessAvailable) {
    commitRoute(returnRoute, true);
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
    trackProductEvent(MIXPANEL_EVENTS.WEBSITE_SUBMITTED, {
      source: "owner_onboarding",
      url_host: safeUrlHost(normalizedWebsiteUrl),
      is_public_demo: false,
    });
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
    trackProductEvent(MIXPANEL_EVENTS.BUSINESS_CREATED, {
      source: "owner_onboarding",
      url_host: safeUrlHost(normalizedWebsiteUrl),
      success: true,
      business_id: nextBusiness?.id ?? payload.business?.business?.id,
    });
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
  { icon: Waves, name: "Swim school", question: "What class is right for my 5-year-old?", steps: ["Answers from program details", "Asks for location", "Starts enrollment"] },
  { icon: Scissors, name: "Salon", question: "Can I book a haircut Saturday?", steps: ["Understands service", "Guides to booking", "Captures preference"] },
  { icon: Snowflake, name: "HVAC", question: "My AC stopped working.", steps: ["Qualifies urgency", "Captures ZIP + contact", "Sends service lead"] },
  { icon: Smile, name: "Dental", question: "Do you take new patients?", steps: ["Shares accepted services", "Finds a location", "Requests an appointment"] },
  { icon: Scale, name: "Law firm", question: "Can someone review my situation?", steps: ["Sets expectations", "Collects case context", "Routes a qualified inquiry"] },
  { icon: House, name: "Home services", question: "How soon can someone come out?", steps: ["Checks service area", "Qualifies urgency", "Creates a dispatch-ready lead"] },
];

const landingFlowSteps = [
  { label: "Question", title: "A visitor asks", body: "The conversation starts with the question already on their mind." },
  { label: "Answer", title: "Your knowledge responds", body: "The agent gives a grounded answer with a clear source and next step." },
  { label: "Qualify", title: "Intent becomes useful", body: "A short follow-up captures the details your team actually needs." },
  { label: "Convert", title: "The next action happens", body: "Book, request a quote, enroll, or send the lead to your team." },
  { label: "Handoff", title: "A human can step in", body: "When judgment matters, the full context moves with the conversation." },
];

const landingSampleMetrics = [
  { value: "142", label: "visitors assisted", trend: "+22% this week" },
  { value: "38", label: "qualified leads", trend: "with intent attached" },
  { value: "17", label: "human handoffs", trend: "context preserved" },
  { value: "11", label: "bookings / demos", trend: "next steps completed" },
  { value: "$4.8k", label: "pipeline influenced", trend: "illustrative estimate" },
];

const landingFaqs = [
  { question: "Does FrontDeskWise use my website?", answer: "Yes. Start with a website URL, then review the services, pricing, policies, locations, and documents the agent can use before publishing." },
  { question: "What happens when the answer is not in my knowledge?", answer: "The agent should say when it cannot verify an answer, collect useful context, and offer a human handoff instead of guessing." },
  { question: "Can it capture leads and bookings?", answer: "Yes. Configure forms, booking actions, and follow-up steps so the next action stays connected to the conversation that created it." },
  { question: "Can I customize the widget?", answer: "You can set the assistant name, greeting, brand colors, logo, quick actions, lead fields, position, and responsive display mode." },
  { question: "Does it work for more than one business?", answer: "Yes. Multi-business workspaces keep each business's knowledge, agent, widget, and analytics organized under one owner login." },
];

const landingCapabilities = [
  { icon: BookOpen, tone: "blue", title: "Grounded answers", body: "Uses your website, policies, pricing, and approved business knowledge.", previewType: "message", preview: "Our classes start at $45 per month.", status: "Answered from approved knowledge" },
  { icon: CalendarCheck, tone: "orange", title: "Conversion actions", body: "Turns conversations into leads, bookings, quotes, and registrations.", previewType: "booking", preview: "Appointment request", previewMeta: "Sat, Dec 20 at 10:00 AM", status: "Booking created" },
  { icon: Headset, tone: "green", title: "Human handoff", body: "Your team can step in anytime with the full conversation context.", previewType: "handoff", preview: "Sarah joined the conversation", previewMeta: "Team · 2:14 PM", status: "Team joined with full context" },
  { icon: Cable, tone: "purple", title: "Connected systems", body: "Sends the right information to your CRM, booking tools, automations, email, or custom APIs (MCP).", previewType: "systems", preview: "HubSpot · Zapier · Make · Email", status: "Lead sent to HubSpot" },
];

const landingIntegrations = [
  { name: "HubSpot", kind: "CRM", logo: siHubspot as SimpleIcon, icon: UsersRound, tone: "orange", outcome: "Qualified lead created" },
  { name: "Zapier", kind: "Automation", logo: siZapier as SimpleIcon, icon: Workflow, tone: "orange", outcome: "Workflow triggered" },
  { name: "Make", kind: "Automation", logo: siMake as SimpleIcon, icon: Cable, tone: "purple", outcome: "Data delivered" },
  { name: "Booking tools", kind: "Appointments", icon: CalendarCheck, tone: "blue", outcome: "Request sent" },
  { name: "Email", kind: "Notifications", icon: Mail, tone: "blue", outcome: "Team notified" },
  { name: "API / MCP", kind: "Custom workflows", icon: Code2, tone: "blue", outcome: "Tool executed" },
];

const landingPlans = [
  { key: "starter", name: "Starter", price: "$99", priceAmount: 99, description: "A grounded AI front desk for one business.", businesses: "1 business", usage: "300 AI conversations / month", featured: false, badge: "", custom: false, cta: "Start 7-day trial", bullets: ["Website knowledge", "Lead capture + email alerts", "Basic analytics", "Website widget", "Usage-aware launch checklist"] },
  { key: "growth", name: "Growth", price: "$199", priceAmount: 199, description: "For teams turning conversations into bookings and qualified leads.", businesses: "1 business", usage: "1,000 AI conversations / month", featured: true, badge: "Most likely to fit", custom: false, cta: "Start 7-day trial", bullets: ["Everything in Starter", "Booking workflows", "CRM integrations", "Human handoff + reporting", "Guided setup path"] },
  { key: "multi_business", name: "Business Plus", price: "$349", priceAmount: 349, description: "A shared operating layer for higher-volume operators.", businesses: "Up to 2 businesses", usage: "2,000 shared AI conversations / month", featured: false, badge: "For growing operators", custom: false, cta: "Start 7-day trial", bullets: ["Everything in Growth", "Shared team workspace", "Advanced workflows", "Cross-business analytics"] },
  { key: "portfolio", name: "Portfolio / Agency", price: "Custom", priceAmount: null, description: "Per-location pricing for agencies and multi-business operators.", businesses: "Pooled locations", usage: "Pooled usage limits", featured: false, badge: "Talk to sales", custom: true, cta: "Talk to sales", bullets: ["Centralized administration", "Partner discounts", "Custom integrations", "Priority support"] },
];

const pricingCalculatorPlan = ref("growth");
const pricingCalculatorConversations = ref(1_000);
const pricingCalculatorVariableCost = ref(0.025);
const pricingCalculatorOtherCosts = ref(25);
const pricingCalculatorPartnerCommission = ref(0);
const pricingCalculatorPlans = computed(() => landingPlans.filter((plan) => plan.priceAmount !== null));
const selectedPricingCalculatorPlan = computed(() => pricingCalculatorPlans.value.find((plan) => plan.key === pricingCalculatorPlan.value) ?? pricingCalculatorPlans.value[0]);
const pricingCalculatorRevenue = computed(() => selectedPricingCalculatorPlan.value?.priceAmount ?? 0);
const pricingCalculatorAiCost = computed(() => Math.max(0, Number(pricingCalculatorConversations.value) || 0) * Math.max(0, Number(pricingCalculatorVariableCost.value) || 0));
const pricingCalculatorPaymentCost = computed(() => pricingCalculatorRevenue.value > 0 ? pricingCalculatorRevenue.value * 0.029 + 0.30 : 0);
const pricingCalculatorPartnerCost = computed(() => pricingCalculatorRevenue.value * Math.max(0, Number(pricingCalculatorPartnerCommission.value) || 0) / 100);
const pricingCalculatorContribution = computed(() => pricingCalculatorRevenue.value - pricingCalculatorAiCost.value - Math.max(0, Number(pricingCalculatorOtherCosts.value) || 0) - pricingCalculatorPaymentCost.value - pricingCalculatorPartnerCost.value);
const pricingCalculatorMargin = computed(() => pricingCalculatorRevenue.value > 0 ? pricingCalculatorContribution.value / pricingCalculatorRevenue.value : 0);

function formatPricingCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value);
}

function formatPricingPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeWebsiteUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (/^[a-z][a-z\d+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function landingAuditFinding(label: string, detail: string, status: LandingAuditFinding["status"]): LandingAuditFinding {
  return { label, detail, status };
}

function buildLandingAudit(payload: WorkspacePayload, normalizedWebsiteUrl: string): LandingAuditResult {
  const sourcePages = payload.knowledge?.sources ?? [];
  const pageText = sourcePages.map((source) => `${source.title} ${source.url} ${source.pageType}`).join(" ").toLowerCase();
  const questionText = (payload.suggestedQuestions ?? []).join(" ").toLowerCase();
  const hasPricing = /pricing|price|cost|tuition|membership|rates?/.test(`${pageText} ${questionText}`);
  const hasBooking = /book|booking|appointment|schedule|registration|enroll/.test(`${pageText} ${questionText}`) || Boolean(payload.stats?.bookingClicks);
  const hasContent = Boolean((payload.knowledge?.sourceCount ?? 0) > 0 || (payload.knowledge?.chunkCount ?? 0) > 0);
  const hasLeadCapture = payload.agent?.collectLeads !== false;
  const openQuestions = payload.knowledge?.openGaps ?? payload.stats?.unansweredQuestions ?? 0;
  const score = Math.max(0, Math.min(100, Math.round(payload.onboarding?.readinessScore ?? payload.knowledge?.readiness?.score ?? 62)));
  const findings: LandingAuditFinding[] = [
    landingAuditFinding(
      hasContent ? "Your website content is discoverable" : "Your website content needs attention",
      hasContent ? `${payload.knowledge?.sourceCount ?? 0} public page${(payload.knowledge?.sourceCount ?? 0) === 1 ? "" : "s"} found for the first pass.` : "We could not find enough public content to ground an AI front desk yet.",
      hasContent ? "healthy" : "attention",
    ),
    landingAuditFinding(
      hasPricing ? "Pricing answers are easier to find" : "Pricing is hard to find",
      hasPricing ? "A visitor can get a useful starting answer without waiting for staff." : "Make pricing, ranges, or a clear quote path visible before a visitor leaves.",
      hasPricing ? "healthy" : "attention",
    ),
    landingAuditFinding(
      hasBooking ? "A booking or inquiry path is visible" : "Your booking CTA may be buried",
      hasBooking ? "The crawl found language that can move a visitor toward the next action." : "Add one obvious next step for booking, registration, a quote, or a conversation with staff.",
      hasBooking ? "healthy" : "attention",
    ),
    landingAuditFinding(
      "After-hours response is not defined",
      "Visitors who arrive when your team is away need an answer, a capture path, and a reason to come back.",
      "attention",
    ),
    landingAuditFinding(
      hasLeadCapture ? "Lead capture is ready to configure" : "There is no qualification path yet",
      hasLeadCapture ? "FrontDeskWise can collect contact details and the intent behind the request." : "Give the AI a short qualification path so staff gets context, not just a name and email.",
      hasLeadCapture ? "healthy" : "attention",
    ),
    landingAuditFinding(
      openQuestions > 0 ? `${openQuestions} customer question${openQuestions === 1 ? "" : "s"} need a better answer` : "Follow-up opportunities are still invisible",
      openQuestions > 0 ? "These are the questions most likely to create friction in a live conversation." : "A weekly owner report can surface repeat questions and missed opportunities before they become lost leads.",
      "attention",
    ),
  ];
  const attentionCount = findings.filter((finding) => finding.status === "attention").length;
  return {
    businessName: payload.business?.name ?? "Your business",
    websiteUrl: normalizedWebsiteUrl,
    score,
    findings,
    summary: attentionCount
      ? `We found ${attentionCount} conversion gap${attentionCount === 1 ? "" : "s"} worth fixing first.`
      : "Your site has a strong foundation for an AI front desk.",
  };
}

async function runLandingAudit() {
  const normalizedWebsiteUrl = normalizeWebsiteUrl(landingAuditUrl.value || websiteUrl.value);
  if (!normalizedWebsiteUrl || !/^https?:\/\/.+\..+/.test(normalizedWebsiteUrl)) {
    landingAuditError.value = "Enter a public website URL to run the audit.";
    return;
  }
  landingAuditUrl.value = normalizedWebsiteUrl;
  websiteUrl.value = normalizedWebsiteUrl;
  landingAuditLoading.value = true;
  landingAuditError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        websiteUrl: normalizedWebsiteUrl,
        requesterName: demoRequesterName.value || undefined,
        requesterEmail: demoRequesterEmail.value || undefined,
        source: "landing_audit",
      }),
    });
    const payload = await response.json() as WorkspacePayload & { error?: string; access?: { accessToken?: string } };
    if (!response.ok) throw new Error(payload.error ?? "We could not audit that website yet.");
    if (payload.access?.accessToken) {
      demoAccessToken.value = payload.access.accessToken;
      window.localStorage.setItem("frontdeskwiseDemoAccessToken", payload.access.accessToken);
    }
    demoSlug.value = payload.slug ?? demoSlug.value;
    publicDemoMode.value = true;
    conversationId.value = "";
    testMessages.value = [];
    landingAudit.value = buildLandingAudit(payload, normalizedWebsiteUrl);
    landingDemoTurns.value = [{ role: "assistant", content: `Hi! I’m the AI front desk for ${landingAudit.value.businessName}. Ask me about services, pricing, or getting started.` }];
    landingDemoInsight.value = null;
    requestAnimationFrame(() => document.getElementById("audit-result")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  } catch (error) {
    landingAuditError.value = error instanceof Error ? error.message : "We could not audit that website yet.";
  } finally {
    landingAuditLoading.value = false;
  }
}

function runLandingDemo(question = landingDemoQuestion.value) {
  const normalizedQuestion = question.trim();
  if (!normalizedQuestion || landingDemoLoading.value) return;
  landingDemoQuestion.value = "";
  landingDemoTurns.value.push({ role: "visitor", content: normalizedQuestion });
  landingDemoLoading.value = true;
  if (landingDemoTimer !== null) window.clearTimeout(landingDemoTimer);
  landingDemoTimer = window.setTimeout(() => {
    const normalized = normalizedQuestion.toLowerCase();
    const bookingQuestion = /book|saturday|appointment|schedule/.test(normalized);
    const pricingQuestion = /price|cost|membership|rate/.test(normalized);
    const integrationQuestion = /mindbody|integrat|software|crm/.test(normalized);
    const response = bookingQuestion
      ? "Yes — Saturday appointments are available. I can collect your preferred time and contact details, then send the request to the team."
      : pricingQuestion
        ? "Our plans start at $99/month. If you tell me what you want to automate, I can recommend the right starting point and connect you with the team."
        : integrationQuestion
          ? "We can connect the conversation to tools like HubSpot, Zapier, Make, or a business-owned API. If you need a human, I’ll hand off with the context attached."
          : "I can help with services, pricing, availability, and the next step. What would you like to get done today?";
    landingDemoTurns.value.push({ role: "assistant", content: response });
    landingDemoInsight.value = bookingQuestion || pricingQuestion
      ? { label: "High buying intent", score: bookingQuestion ? "78%" : "64%", detail: bookingQuestion ? "Asked about availability · next action ready" : "Asked about pricing · qualification recommended" }
      : { label: "Exploration intent", score: "42%", detail: "Education first · keep the path low-friction" };
    landingDemoLoading.value = false;
    landingDemoTimer = null;
  }, 520);
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
  trackProductEvent(MIXPANEL_EVENTS.WEBSITE_SUBMITTED, {
    source: "marketing_demo",
    url_host: safeUrlHost(normalizedWebsiteUrl),
    is_public_demo: true,
  });
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
    trackProductEvent(MIXPANEL_EVENTS.CRAWL_COMPLETED, {
      source: "marketing_demo",
      url_host: safeUrlHost(normalizedWebsiteUrl),
      success: true,
      is_public_demo: true,
    });
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
  supportViewMode.value = new URLSearchParams(window.location.search).get("support_view") === "1";
  supportViewCaseId.value = new URLSearchParams(window.location.search).get("support_case") ?? "";
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

async function openAdminSupportView(item: SupportCaseRecord) {
  if (adminSupportLoading.value) return;
  adminSupportLoading.value = true;
  adminSupportError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/support-cases/${encodeURIComponent(item.id)}/view`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string; viewUrl?: string };
    if (!response.ok || !payload.viewUrl) throw new Error(payload.error ?? "Could not open the support view.");
    window.location.assign(payload.viewUrl);
  } catch (error) {
    adminSupportError.value = error instanceof Error ? error.message : "Could not open the support view.";
    adminSupportLoading.value = false;
  }
}

function exitSupportView() {
  supportViewMode.value = false;
  supportViewCaseId.value = "";
  publicDemoMode.value = false;
  forgetDemoAccessToken();
  navigateToAdminSection("support");
}

async function loadKnowledge() {
  if ((!firebaseToken.value && !demoAccessToken.value) || knowledgeLoading.value) return;
  if (authSnapshot.value && !selectedBusinessId()) {
    knowledgeGaps.value = [];
    retrievalDiagnostics.value = [];
    knowledgeQualityTotal.value = 0;
    return;
  }
  knowledgeLoading.value = true;
  knowledgeError.value = "";
  try {
    const [gapsResponse, qnaResponse] = await Promise.all([
      trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps`), { headers: ownerHeaders() }),
      trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/qna`), { headers: ownerHeaders() }),
    ]);
    if (!gapsResponse.ok) throw new Error("We could not load the knowledge review. Refresh the page and try again.");
    const gapsPayload = await gapsResponse.json() as { gaps?: KnowledgeGap[] };
    const qnaPayload = await qnaResponse.json() as { qnas?: KnowledgeQna[]; error?: string };
    if (!qnaResponse.ok) throw new Error(qnaPayload.error ?? "We could not load Business Q&A.");
    knowledgeGaps.value = gapsPayload.gaps ?? [];
    knowledgeQnas.value = qnaPayload.qnas ?? [];
    for (const gap of knowledgeGaps.value) {
      if (answerDrafts.value[gap.question] === undefined) answerDrafts.value[gap.question] = gap.approvedAnswer ?? "";
      if (!gap.answerMode) gap.answerMode = "knowledge";
    }
    await loadKnowledgeQuality();
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not load knowledge review.";
  } finally {
    knowledgeLoading.value = false;
  }
}

async function loadKnowledgeQuality() {
  if ((!firebaseToken.value && !demoAccessToken.value) || knowledgeQualityLoading.value) return;
  if (authSnapshot.value && !selectedBusinessId()) {
    retrievalDiagnostics.value = [];
    knowledgeQualityTotal.value = 0;
    return;
  }
  knowledgeQualityLoading.value = true;
  try {
    const params = new URLSearchParams({
      page: String(knowledgeQualityPage.value),
      limit: "25",
      window: knowledgeQualityRange.value,
    });
    if (knowledgeQualitySearch.value.trim()) params.set("q", knowledgeQualitySearch.value.trim());
    if (knowledgeQualityFilter.value !== "all") params.set("status", knowledgeQualityFilter.value === "needsReview" ? "needs_review" : knowledgeQualityFilter.value);
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/retrieval-diagnostics?${params.toString()}`), { headers: ownerHeaders() });
    const payload = await response.json() as { diagnostics?: RetrievalDiagnostic[]; pagination?: { page?: number; total?: number; hasNext?: boolean; hasPrevious?: boolean }; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load answer quality checks.");
    retrievalDiagnostics.value = payload.diagnostics ?? [];
    knowledgeQualityTotal.value = payload.pagination?.total ?? retrievalDiagnostics.value.length;
    knowledgeQualityPage.value = payload.pagination?.page ?? knowledgeQualityPage.value;
    knowledgeQualityHasNext.value = Boolean(payload.pagination?.hasNext);
    knowledgeQualityHasPrevious.value = Boolean(payload.pagination?.hasPrevious);
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not load answer quality checks.";
  } finally {
    knowledgeQualityLoading.value = false;
  }
}

function applyKnowledgeQualityFilters() {
  knowledgeQualityPage.value = 1;
  void loadKnowledgeQuality();
}

function queueKnowledgeQualitySearch() {
  if (knowledgeQualitySearchTimer !== null) window.clearTimeout(knowledgeQualitySearchTimer);
  knowledgeQualitySearchTimer = window.setTimeout(applyKnowledgeQualityFilters, 320);
}

function changeKnowledgeQualityPage(page: number) {
  if (page < 1 || (page > knowledgeQualityPage.value && !knowledgeQualityHasNext.value) || (page < knowledgeQualityPage.value && !knowledgeQualityHasPrevious.value)) return;
  knowledgeQualityPage.value = page;
  void loadKnowledgeQuality();
}

function selectedBusinessId(): string | null {
  return activeOrganization.value?.businesses.find((business) => business.slug === demoSlug.value)?.id ?? null;
}

const workflowSelectedBusinessId = computed(() => selectedBusinessId() ?? (!authSnapshot.value ? workspaceBusinessId.value : null));

function formatKnowledgeRelativeTime(value: string | null): string {
  if (!value) return "—";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "—";
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1_000));
  if (elapsedSeconds < 60) return "Just now";
  const minutes = Math.floor(elapsedSeconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: timestamp < Date.now() - 31536000000 ? "numeric" : undefined }).format(timestamp);
}

function formatKnowledgeGapReason(reason?: string | null): string {
  if (!reason || reason === "legacy_unknown") return "No authoritative answer found";
  return reason.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function knowledgeGapImpact(gap: KnowledgeGap): number {
  const reasonWeight = gap.reason === "grounding_check_failed" ? 3 : gap.reason === "answer_generation_failed" ? 2 : 1;
  return gap.occurrenceCount * reasonWeight;
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
  if (!approvedAnswer || knowledgeAnswerSaving.value) return;
  knowledgeAnswerSaving.value = true;
  knowledgeAnswerStatus.value = "Saving…";
  knowledgeAnswerError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps/resolve`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ question: gap.question, questions: gap.variants ?? [], approvedAnswer, answerMode: gap.answerMode || "knowledge" }),
    });
    const payload = await response.json() as { gap?: KnowledgeGap; qna?: KnowledgeQna; indexingStatus?: "queued" | "ready" | "failed"; error?: string };
    if (!response.ok || !payload.gap) throw new Error(payload.error ?? "Could not save that answer.");
    Object.assign(gap, payload.gap);
    if (payload.qna) {
      const qnaIndex = knowledgeQnas.value.findIndex((item) => item.id === payload.qna?.id);
      if (qnaIndex >= 0) knowledgeQnas.value[qnaIndex] = payload.qna;
      else knowledgeQnas.value.unshift(payload.qna);
    }
    answerDrafts.value[gap.question] = approvedAnswer;
    resolvedKnowledgeQuestion.value = gap.question;
    knowledgeTestContext.value = "answer";
    knowledgeAnswerStatus.value = payload.indexingStatus === "queued" ? "Updating assistant knowledge…" : "Ready ✓";
    knowledgeAnswerFailedGap.value = null;
    await refreshWorkspaceSummary(false);
    if (payload.indexingStatus === "queued") void waitForKnowledgeIndex(gap);
  } catch (error) {
    knowledgeAnswerError.value = error instanceof Error ? error.message : "Update failed — Retry";
    knowledgeAnswerFailedGap.value = gap;
    knowledgeAnswerStatus.value = "";
  } finally {
    knowledgeAnswerSaving.value = false;
  }
}

async function ignoreKnowledgeGap(gap: KnowledgeGap) {
  if (knowledgeAnswerSaving.value) return;
  if (!authSnapshot.value) {
    openAuth("signup");
    return;
  }
  knowledgeAnswerSaving.value = true;
  knowledgeAnswerError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps/ignore`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ question: gap.question, questions: gap.variants ?? [] }),
    });
    const payload = await response.json() as { gap?: KnowledgeGap; error?: string };
    if (!response.ok || !payload.gap) throw new Error(payload.error ?? "Could not ignore that answer gap.");
    Object.assign(gap, payload.gap);
    if (selectedKnowledgeGap.value?.question === gap.question) {
      answerGapDrawerOpen.value = false;
      selectedKnowledgeGap.value = null;
    }
    await refreshWorkspaceSummary(false);
  } catch (error) {
    knowledgeAnswerError.value = error instanceof Error ? error.message : "Could not ignore that answer gap.";
  } finally {
    knowledgeAnswerSaving.value = false;
  }
}

async function waitForKnowledgeIndex(gap?: KnowledgeGap): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
    try {
      const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/embedding-status`), { headers: ownerHeaders() }, { globalLoading: false });
      const payload = await response.json() as { latestJob?: { status?: string; lastError?: string | null } | null; pendingChunks?: number; configured?: boolean };
      if (!response.ok) return;
      if (payload.latestJob?.status === "failed") {
        knowledgeAnswerStatus.value = "";
        knowledgeAnswerFailedGap.value = gap ?? null;
        knowledgeAnswerError.value = payload.latestJob.lastError ? `Update failed — ${payload.latestJob.lastError}` : "Update failed — Retry";
        return;
      }
      if (payload.latestJob?.status === "succeeded" && (payload.pendingChunks ?? 0) === 0) {
        knowledgeAnswerStatus.value = "Ready ✓";
        await refreshWorkspaceSummary(false);
        return;
      }
    } catch {
      // The saved answer remains usable through full-text retrieval while the
      // optional semantic worker catches up.
    }
  }
}

let widgetInstallLoadPromise: Promise<void> | null = null;

async function loadWidgetInstall(globalLoading = true) {
  if (!firebaseToken.value || !authSnapshot.value) return;
  if (ownershipVerification.value?.status !== "verified") {
    widgetInstall.value = null;
    return;
  }
  if (widgetInstallLoadPromise) return widgetInstallLoadPromise;
  const slug = demoSlug.value;
  widgetInstallLoadPromise = (async () => {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${slug}/widget/install`), { headers: ownerHeaders() }, { globalLoading });
    if (!response.ok || demoSlug.value !== slug) return;
    widgetInstall.value = await response.json() as WidgetInstall;
  })().finally(() => {
    widgetInstallLoadPromise = null;
  });
  return widgetInstallLoadPromise;
}

function setLocalSupportContext() {
  const failedSources = (workspaceKnowledge.value?.sources ?? []).filter((source) => source.crawlStatus === "failed");
  const pendingSources = (workspaceKnowledge.value?.sources ?? []).filter((source) => source.crawlStatus === "queued" || source.crawlStatus === "crawling");
  const refreshDates = (workspaceKnowledge.value?.sources ?? []).map((source) => Date.parse(source.lastCrawledAt)).filter((value) => Number.isFinite(value));
  supportContext.value = {
    diagnostics: {
      business: businessName.value,
      businessId: selectedBusinessId(),
      page: supportSourcePage.value,
      source: websiteUrl.value,
      lastRefresh: refreshDates.length ? new Date(Math.max(...refreshDates)).toISOString() : null,
      crawlerStatus: failedSources.length ? "render_failed" : pendingSources.length ? "refreshing" : "ready",
      failedSources: failedSources.slice(0, 5).map((source) => ({ url: source.url })),
      pendingSourceCount: pendingSources.length,
      widget: { detected: Boolean(widgetInstall.value?.verification.loadCount), lastLoadedAt: widgetInstall.value?.verification.lastLoadedAt ?? null, loadCount: widgetInstall.value?.verification.loadCount ?? 0 },
    },
    systemStatus: {
      api: "operational",
      knowledge: failedSources.length ? "needs_attention" : "healthy",
      widget: widgetInstall.value?.verification.loadCount ? "detected" : "not_detected",
      integrations: "available_on_request",
    },
  };
}

async function loadSupport() {
  supportLoading.value = true;
  supportError.value = "";
  setLocalSupportContext();
  if (!demoSlug.value || (publicDemoMode.value && !firebaseToken.value && !demoAccessToken.value)) {
    supportCases.value = [];
    supportLoading.value = false;
    return;
  }
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/support?page=${encodeURIComponent(supportSourcePage.value)}`), { headers: ownerHeaders() });
    const payload = await response.json() as { context?: SupportContext; cases?: SupportCaseRecord[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load support status.");
    supportContext.value = payload.context ?? supportContext.value;
    supportCases.value = payload.cases ?? [];
  } catch (error) {
    supportError.value = error instanceof Error ? error.message : "Could not load support status.";
  } finally {
    supportLoading.value = false;
  }
}

async function submitSupportCase(payload: {
  subject: string;
  category: SupportCaseCategory;
  provider: string;
  connectionId: string;
  description: string;
  severity: "normal" | "urgent";
  sourcePage: string;
  sourceUrl: string;
  diagnostics: Record<string, unknown>;
}) {
  if (!authSnapshot.value) {
    openAuth("signin");
    return;
  }
  supportSubmitting.value = true;
  supportSubmitError.value = "";
  supportSubmitMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/support/cases`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(payload),
    });
    const result = await response.json() as { case?: SupportCaseRecord; error?: string };
    if (!response.ok || !result.case) throw new Error(result.error ?? "Could not create the support case.");
    supportCases.value = [result.case, ...supportCases.value];
    supportSubmitMessage.value = `Case ${result.case.correlationId} is open. Our team has the diagnostics.`;
    notifySuccess("Support case created. Our team has the diagnostics.", "Support case opened");
  } catch (error) {
    supportSubmitError.value = error instanceof Error ? error.message : "Could not create the support case.";
  } finally {
    supportSubmitting.value = false;
  }
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
      else widgetInstall.value = null;
    }
  } catch {
    // The install gate remains closed until the next successful verification read.
  }
}

function continueToKnowledgeAfterVerification() {
  window.setTimeout(() => navigateToWorkspaceView("knowledge"), 700);
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
    verificationMessage.value = payload.verification?.status === "verified"
      ? "Website verified ✓ Next: Review your assistant's knowledge."
      : "Verification request created · complete the instructions, then check again";
    if (payload.verification?.status === "verified") await loadWidgetInstall();
    if (payload.verification?.status === "verified") {
      await refreshWorkspaceSummary(false);
      continueToKnowledgeAfterVerification();
    }
    else widgetInstall.value = null;
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
      verificationMessage.value = "Website verified ✓ Next: Review your assistant's knowledge.";
      verificationToken.value = "";
      await Promise.all([loadWidgetInstall(), refreshWorkspaceSummary(false)]);
      continueToKnowledgeAfterVerification();
    } else {
      verificationError.value = payload.message ?? "The verification proof was not found yet.";
    }
  } catch (error) {
    verificationError.value = error instanceof Error ? error.message : "Could not check ownership verification.";
  } finally {
    verificationLoading.value = false;
  }
}

async function loadLeads(globalLoading = true) {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  leadsLoading.value = true;
  leadsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads?limit=500`), { headers: ownerHeaders() }, { globalLoading });
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
      metadata: lead.metadata ?? {},
      status: lead.status === "qualified" ? "Qualified" : lead.status === "booked" ? "Booked" : "New",
      time: lead.createdAt ? new Date(lead.createdAt).toLocaleString() : "Just now",
    }));
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not load leads.";
  } finally {
    leadsLoading.value = false;
  }
}

function inboxMessageKey(message: InboxMessage): string {
  return message.id ?? `${message.role}:${message.createdAt}:${message.content}`;
}

function rememberInboxLocalMessage(conversationId: string, message: InboxMessage) {
  const current = inboxLocalMessages.value[conversationId] ?? [];
  const next = current.some((item) => item.id === message.id)
    ? current.map((item) => item.id === message.id ? message : item)
    : [...current, message];
  inboxLocalMessages.value = { ...inboxLocalMessages.value, [conversationId]: next };
}

function forgetInboxLocalMessage(conversationId: string, temporaryId: string) {
  const current = inboxLocalMessages.value[conversationId] ?? [];
  const next = current.filter((message) => message.id !== temporaryId);
  if (next.length) inboxLocalMessages.value = { ...inboxLocalMessages.value, [conversationId]: next };
  else {
    const remaining = { ...inboxLocalMessages.value };
    delete remaining[conversationId];
    inboxLocalMessages.value = remaining;
  }
}

function mergeInboxMessages(serverMessages: InboxMessage[], localMessages: InboxMessage[] = []): InboxMessage[] {
  const messages: InboxMessage[] = serverMessages.map((message) => ({ ...message, sendStatus: message.sendStatus === "failed" ? "failed" : "sent" }));
  const serverIds = new Set(messages.flatMap((message) => [message.id, message.clientMessageId].filter((value): value is string => Boolean(value))));
  const localById = new Map(localMessages.filter((message) => message.id?.startsWith("temp_"))
    .map((message) => [message.id as string, message] as const));
  for (const localMessage of localById.values()) {
    if (!localMessage.id?.startsWith("temp_")) continue;
    if (localMessage.clientMessageId && serverIds.has(localMessage.clientMessageId)) continue;
    messages.push({ ...localMessage });
  }
  return messages.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
}

function reconcileInboxRows(serverRows: InboxConversation[]): InboxConversation[] {
  return serverRows.map((serverRow) => {
    const localRow = inboxConversations.value.find((row) => row.id === serverRow.id);
    const localMessage = localRow?.lastMessage;
    if (localRow && localMessage?.id?.startsWith("temp_")) {
      return { ...serverRow, lastMessage: localMessage, lastActivityAt: localRow.lastActivityAt };
    }
    return serverRow;
  });
}

function inboxStatusBucket(status: InboxConversation["status"]): keyof InboxPageSummary | null {
  if (status === "HANDOFF_REQUESTED" || status === "WAITING_FOR_STAFF" || status === "FOLLOW_UP_PENDING") return "needsResponse";
  if (status === "AI_ACTIVE" || status === "AI_ASSISTED") return "ai";
  if (status === "RESOLVED") return "resolved";
  return null;
}

function patchInboxConversationById(conversationId: string, patch: Partial<InboxConversation>) {
  const index = inboxConversations.value.findIndex((conversation) => conversation.id === conversationId);
  const previous = index >= 0 ? inboxConversations.value[index] : null;
  if (index >= 0 && previous) {
    const next = { ...previous, ...patch };
    inboxConversations.value = inboxConversations.value.map((conversation, itemIndex) => itemIndex === index ? next : conversation);
    const previousBucket = inboxStatusBucket(previous.status);
    const nextBucket = inboxStatusBucket(next.status);
    if (previousBucket !== nextBucket) {
      if (previousBucket) inboxSummary.value[previousBucket] = Math.max(0, inboxSummary.value[previousBucket] - 1);
      if (nextBucket) inboxSummary.value[nextBucket] += 1;
    }
  }
  if (selectedInboxConversation.value?.id === conversationId) {
    selectedInboxConversation.value = { ...selectedInboxConversation.value, ...patch };
  }
}

function updateInboxMessage(conversationId: string, temporaryId: string, update: (message: InboxMessage) => InboxMessage) {
  const remembered = inboxLocalMessages.value[conversationId]?.find((message) => message.id === temporaryId);
  if (remembered) {
    const nextMessage = update(remembered);
    if (nextMessage.id?.startsWith("temp_")) rememberInboxLocalMessage(conversationId, nextMessage);
    else forgetInboxLocalMessage(conversationId, temporaryId);
  }
  if (selectedInboxConversation.value?.id === conversationId) {
    const messages = selectedInboxConversation.value.messages ?? [];
    selectedInboxConversation.value = {
      ...selectedInboxConversation.value,
      messages: messages.map((message) => message.id === temporaryId ? update(message) : message),
    };
  }
  const row = inboxConversations.value.find((conversation) => conversation.id === conversationId);
  if (row?.lastMessage?.id === temporaryId) {
    inboxConversations.value = inboxConversations.value.map((conversation) => conversation.id === conversationId
      ? { ...conversation, lastMessage: update(conversation.lastMessage as InboxMessage) }
      : conversation);
  }
}

function inboxThreadIsNearBottom(element = inboxThread.value): boolean {
  if (!element) return true;
  return element.scrollHeight - element.scrollTop - element.clientHeight <= 120;
}

function handleInboxThreadScroll() {
  inboxNearBottom.value = inboxThreadIsNearBottom();
  if (inboxNearBottom.value) inboxNewMessageCount.value = 0;
}

function scrollInboxToLatest(behavior: ScrollBehavior = "smooth") {
  void nextTick(() => {
    const element = inboxThread.value;
    if (!element) return;
    element.scrollTo({ top: element.scrollHeight, behavior });
    inboxNearBottom.value = true;
    inboxNewMessageCount.value = 0;
  });
}

async function refreshSelectedInboxConversation() {
  const current = selectedInboxConversation.value;
  if (!current) return;
  const wasNearBottom = inboxThreadIsNearBottom();
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${current.id}`), { headers: ownerHeaders() }, { globalLoading: false });
    const payload = await response.json() as { error?: string; conversation?: InboxConversation; notes?: InboxNote[]; events?: InboxEvent[] };
    if (!response.ok || !payload.conversation || selectedInboxConversation.value?.id !== current.id) return;
    const oldMessages = current.messages ?? [];
    const nextMessages = mergeInboxMessages(payload.conversation.messages ?? [], oldMessages);
    const oldKeys = new Set(oldMessages.map(inboxMessageKey));
    const optimisticClientIds = new Set(oldMessages.flatMap((message) => message.id?.startsWith("temp_") && message.clientMessageId ? [message.clientMessageId] : []));
    const newServerMessages = (payload.conversation.messages ?? []).filter((message) => !oldKeys.has(inboxMessageKey(message)) && !(message.id && optimisticClientIds.has(message.id)));
    selectedInboxConversation.value = {
      ...current,
      ...payload.conversation,
      messages: nextMessages,
      notes: payload.notes ?? current.notes ?? [],
      events: payload.events ?? current.events ?? [],
    };
    const { messages: _messages, notes: _notes, events: _events, ...conversationSummary } = payload.conversation;
    patchInboxConversationById(current.id, conversationSummary);
    if (newServerMessages.length) {
      if (wasNearBottom) scrollInboxToLatest("smooth");
      else inboxNewMessageCount.value += newServerMessages.length;
    }
  } catch {
    // Background reconciliation is best-effort; the visible thread remains usable.
  }
}

function inboxPollingDelayMs(): number {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return 60_000;
  return selectedInboxConversation.value ? 10_000 : 30_000;
}

function scheduleInboxPolling(delayMs = inboxPollingDelayMs()) {
  if (view.value !== "inbox") {
    stopInboxPolling();
    return;
  }
  if (inboxRefreshTimer !== null) window.clearTimeout(inboxRefreshTimer);
  inboxRefreshTimer = window.setTimeout(async () => {
    inboxRefreshTimer = null;
    if (view.value === "inbox" && !inboxLoading.value) {
      await loadInbox(inboxPage.value, { globalLoading: false, refreshSelected: true });
    }
    if (view.value === "inbox") scheduleInboxPolling();
  }, Math.max(0, delayMs));
}

function startInboxPolling() {
  if (inboxRefreshTimer !== null || view.value !== "inbox") return;
  scheduleInboxPolling();
}

function stopInboxPolling() {
  if (inboxRefreshTimer === null) return;
  window.clearTimeout(inboxRefreshTimer);
  inboxRefreshTimer = null;
}

async function refreshEmailVerificationState() {
  if (typeof document === "undefined" || document.visibilityState !== "visible"
    || verificationRefreshInFlight || authInitializing.value
    || !authSnapshot.value || authSnapshot.value.user.emailVerified) return;
  verificationRefreshInFlight = true;
  try {
    const previousSnapshot = authSnapshot.value;
    const snapshot = await currentAuthSnapshot();
    if (!snapshot || !authSnapshot.value) return;
    authSnapshot.value = snapshot;
    firebaseToken.value = await currentFirebaseToken();
    if (!previousSnapshot.user.emailVerified && snapshot.user.emailVerified) {
      verificationEmailMessage.value = "";
      trackProductEventOnce(`email-verified:${snapshot.user.id}`, MIXPANEL_EVENTS.EMAIL_VERIFIED, { method: "verification_refresh" });
      notifySuccess("Your email is verified. Workspace actions are now unlocked.", "Email verified");
    }
  } catch {
    // Verification polling is opportunistic. Keep the current banner if the
    // tab returns while the API or Firebase is temporarily unavailable.
  } finally {
    verificationRefreshInFlight = false;
  }
}

function handleInboxVisibilityChange() {
  void refreshEmailVerificationState();
  if (view.value !== "inbox") return;
  scheduleInboxPolling(document.visibilityState === "hidden" ? 60_000 : 0);
}

async function loadInbox(page = inboxPage.value, options: { globalLoading?: boolean; refreshSelected?: boolean } = {}) {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  inboxLoading.value = true;
  inboxError.value = "";
  inboxPage.value = Math.max(1, page);
  try {
    const params = new URLSearchParams();
    params.set("page", String(inboxPage.value));
    params.set("limit", String(inboxPageSize));
    if (inboxStatusFilter.value !== "all") params.set("status", inboxStatusFilter.value);
    if (inboxAssignmentFilter.value === "mine" && authSnapshot.value?.user.id) params.set("assignedTo", authSnapshot.value.user.id);
    else if (inboxAssignmentFilter.value === "unassigned") params.set("assignedTo", "unassigned");
    else if (inboxAssignmentFilter.value !== "all") params.set("assignedTo", inboxAssignmentFilter.value);
    const query = params.toString() ? `?${params.toString()}` : "";
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/inbox${query}`), { headers: ownerHeaders() }, { globalLoading: options.globalLoading ?? true });
    const payload = await response.json() as { error?: string; conversations?: InboxConversation[]; pagination?: { page?: number; pageSize?: number; total?: number; hasNext?: boolean; hasPrevious?: boolean }; summary?: InboxPageSummary };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the inbox.");
    inboxConversations.value = reconcileInboxRows(payload.conversations ?? []);
    inboxPage.value = payload.pagination?.page ?? inboxPage.value;
    inboxTotal.value = payload.pagination?.total ?? inboxConversations.value.length;
    inboxHasNext.value = Boolean(payload.pagination?.hasNext);
    inboxHasPrevious.value = Boolean(payload.pagination?.hasPrevious);
    inboxSummary.value = payload.summary ?? {
      needsResponse: inboxConversations.value.filter((conversation) => conversation.status === "HANDOFF_REQUESTED" || conversation.status === "WAITING_FOR_STAFF" || conversation.status === "FOLLOW_UP_PENDING").length,
      unread: inboxConversations.value.reduce((total, conversation) => total + (conversation.unreadCount ?? 0), 0),
      ai: inboxConversations.value.filter((conversation) => conversation.status === "AI_ACTIVE" || conversation.status === "AI_ASSISTED").length,
      resolved: inboxConversations.value.filter((conversation) => conversation.status === "RESOLVED").length,
    };
    if (selectedInboxConversation.value) {
      const current = inboxConversations.value.find((conversation) => conversation.id === selectedInboxConversation.value?.id);
      if (current) {
        selectedInboxConversation.value = { ...selectedInboxConversation.value, ...current };
        if (options.refreshSelected) await refreshSelectedInboxConversation();
      }
      else {
        selectedInboxConversation.value = null;
        inboxReply.value = "";
      }
    } else {
      const requestedConversationId = new URLSearchParams(window.location.search).get("conversation");
      const requested = requestedConversationId ? inboxConversations.value.find((conversation) => conversation.id === requestedConversationId) : null;
      if (requested) await openInboxConversation(requested);
    }
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not load the inbox.";
  } finally {
    inboxLoading.value = false;
  }
}

function setInboxQueue(status: "all" | InboxConversation["status"], assignment: "all" | "unassigned" | "mine" = "all") {
  inboxPage.value = 1;
  inboxStatusFilter.value = status;
  inboxAssignmentFilter.value = assignment;
  void loadInbox();
}

async function loadNotifications() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  notificationActionError.value = "";
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
  void loadPushConfig();
}

async function loadPushConfig() {
  browserNotificationPermission.value = notificationPermission();
  if (!pushSupported() || !demoSlug.value || (!firebaseToken.value && !demoAccessToken.value)) return;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/push/config`), { headers: ownerHeaders() }, { globalLoading: false });
    const payload = await response.json() as { enabled?: boolean; publicKey?: string | null };
    pushConfigured.value = Boolean(response.ok && payload.enabled && payload.publicKey);
    pushPublicKey.value = payload.publicKey ?? "";
    const subscription = await existingPushSubscription();
    pushEnabled.value = Boolean(subscription);
  } catch {
    pushConfigured.value = false;
    pushPublicKey.value = "";
    pushEnabled.value = false;
  }
}

async function enableBrowserAlerts() {
  if (pushLoading.value) return;
  pushLoading.value = true;
  pushError.value = "";
  pushMessage.value = "";
  try {
    await loadPushConfig();
    if (!pushConfigured.value || !pushPublicKey.value) throw new Error("Browser alerts are not configured for this environment yet.");
    const subscription = await subscribeToPush(pushPublicKey.value);
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/push-subscriptions`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    }, { globalLoading: false });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this device for browser alerts.");
    pushEnabled.value = true;
    browserNotificationPermission.value = notificationPermission();
    pushMessage.value = "This device will receive handoff and lead alerts.";
    trackProductEvent(MIXPANEL_EVENTS.PUSH_NOTIFICATIONS_ENABLED, { method: "web_push", success: true, platform: "browser" });
  } catch (error) {
    pushError.value = error instanceof Error ? error.message : "Could not enable browser alerts.";
  } finally {
    pushLoading.value = false;
  }
}

async function disableBrowserAlerts() {
  if (pushLoading.value) return;
  pushLoading.value = true;
  pushError.value = "";
  try {
    const subscription = await unsubscribeFromPush();
    if (subscription) {
      await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(demoSlug.value)}/push-subscriptions`), {
        method: "DELETE",
        headers: { "content-type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      }, { globalLoading: false });
    }
    pushEnabled.value = false;
    pushMessage.value = "Browser alerts are off on this device.";
  } catch (error) {
    pushError.value = error instanceof Error ? error.message : "Could not disable browser alerts.";
  } finally {
    pushLoading.value = false;
  }
}

async function installFrontDeskWisePwa() {
  trackProductEvent(MIXPANEL_EVENTS.PWA_INSTALL_PROMPT_SHOWN, { platform: "browser" });
  const installed = await installPwa();
  if (installed) {
    pwaInstallAvailable.value = false;
    pwaInstalled.value = true;
    trackProductEvent(MIXPANEL_EVENTS.PWA_INSTALLED, { platform: "browser", success: true });
  }
}

async function markAllNotificationsRead() {
  const hasUnreadNotifications = notificationUnreadCount.value > 0 || staffNotifications.value.some((notification) => !notification.readAt);
  if (!authSnapshot.value || notificationActionLoading.value || !hasUnreadNotifications) return;
  notificationActionLoading.value = true;
  notificationActionError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications/read-all`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string; readAt?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not clear notifications.");
    const readAt = payload.readAt ?? new Date().toISOString();
    staffNotifications.value = staffNotifications.value.map((notification) => notification.readAt ? notification : { ...notification, readAt });
    notificationUnreadCount.value = 0;
  } catch (error) {
    notificationActionError.value = error instanceof Error ? error.message : "Could not clear notifications.";
  } finally {
    notificationActionLoading.value = false;
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

async function loadHandoffNotificationSettings() {
  if (!authSnapshot.value) return;
  handoffSettingsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notification-settings`), { headers: ownerHeaders() }, { globalLoading: false });
    const payload = await response.json() as { settings?: HandoffNotificationSettings; error?: string };
    if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Could not load handoff notification settings.");
    handoffNotificationSettings.value = { ...payload.settings, defaultRecipientEmail: payload.settings.defaultRecipientEmail ?? "", repeatAfterSeconds: Math.round(payload.settings.repeatAfterSeconds / 60) };
    handoffAdditionalRecipients.value = payload.settings.additionalRecipientEmails.join("\n");
  } catch (error) {
    handoffSettingsError.value = error instanceof Error ? error.message : "Could not load handoff notification settings.";
  }
}

async function saveHandoffNotificationSettings() {
  if (!authSnapshot.value || handoffSettingsLoading.value) return;
  handoffSettingsLoading.value = true;
  handoffSettingsMessage.value = "";
  handoffSettingsError.value = "";
  const additionalRecipientEmails = handoffAdditionalRecipients.value.split(/[\n,]+/).map((email) => email.trim()).filter(Boolean);
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notification-settings`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ ...handoffNotificationSettings.value, defaultRecipientEmail: handoffNotificationSettings.value.defaultRecipientEmail || null, additionalRecipientEmails, repeatAfterSeconds: handoffNotificationSettings.value.repeatAfterSeconds * 60 }),
    }, { globalLoading: false });
    const payload = await response.json() as { settings?: HandoffNotificationSettings; error?: string };
    if (!response.ok || !payload.settings) throw new Error(payload.error ?? "Could not save handoff notification settings.");
    handoffNotificationSettings.value = { ...payload.settings, defaultRecipientEmail: payload.settings.defaultRecipientEmail ?? "", repeatAfterSeconds: Math.round(payload.settings.repeatAfterSeconds / 60) };
    handoffAdditionalRecipients.value = payload.settings.additionalRecipientEmails.join("\n");
    handoffSettingsMessage.value = "Handoff alerts saved.";
    window.setTimeout(() => (handoffSettingsMessage.value = ""), 2400);
  } catch (error) {
    handoffSettingsError.value = error instanceof Error ? error.message : "Could not save handoff notification settings.";
  } finally {
    handoffSettingsLoading.value = false;
  }
}

function toggleNotifications() {
  if (!authSnapshot.value) return;
  notificationMenuOpen.value = !notificationMenuOpen.value;
  profileMenuOpen.value = false;
  if (notificationMenuOpen.value) void loadNotifications();
}

async function markNotificationRead(notification: StaffNotification) {
  if (notification.readAt) return;
  await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications/${notification.id}/read`), { method: "POST", headers: ownerHeaders() });
  notification.readAt = new Date().toISOString();
  notificationUnreadCount.value = Math.max(0, notificationUnreadCount.value - 1);
}

async function openInboxConversation(conversation: InboxConversation) {
  const previousConversation = selectedInboxConversation.value;
  const isSameConversation = previousConversation?.id === conversation.id;
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversation.id}`), { headers: ownerHeaders() }, { globalLoading: false });
    const payload = await response.json() as { error?: string; conversation?: InboxConversation; notes?: InboxNote[]; events?: InboxEvent[] };
    if (!response.ok || !payload.conversation) throw new Error(payload.error ?? "Could not open this conversation.");
    selectedInboxConversation.value = {
      ...payload.conversation,
      messages: mergeInboxMessages(payload.conversation.messages ?? [], [
        ...(isSameConversation ? previousConversation?.messages ?? [] : []),
        ...(inboxLocalMessages.value[conversation.id] ?? []),
      ]),
      notes: payload.notes ?? [],
      events: payload.events ?? [],
    };
    if (!isSameConversation) {
      inboxReply.value = "";
      inboxNewMessageCount.value = 0;
    }
    await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversation.id}/read`), {
      method: "POST",
      headers: ownerHeaders(),
    }, { globalLoading: false });
    const previousUnreadCount = inboxConversations.value.find((item) => item.id === conversation.id)?.unreadCount ?? 0;
    selectedInboxConversation.value.unreadCount = 0;
    inboxSummary.value.unread = Math.max(0, inboxSummary.value.unread - previousUnreadCount);
    const index = inboxConversations.value.findIndex((item) => item.id === conversation.id);
    if (index >= 0) inboxConversations.value[index] = { ...inboxConversations.value[index], ...payload.conversation, unreadCount: 0 };
    if (!isSameConversation) scrollInboxToLatest("auto");
  } catch (error) {
    inboxError.value = error instanceof Error ? error.message : "Could not open this conversation.";
  }
}

type InboxMutationRequest = { content?: string; clientMessageId?: string; userId?: string } | undefined;
type InboxMutationResponse = { error?: string; conversation?: InboxConversation; message?: InboxMessage; note?: InboxNote; actor?: { id: string; name: string; role: WorkspaceRole } };

async function inboxMutation(path: string, body?: InboxMutationRequest): Promise<InboxMutationResponse | null> {
  if (inboxActionLoading.value) return null;
  inboxActionLoading.value = true;
  inboxError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}${path}`), {
      method: "POST",
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...ownerHeaders() },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, { globalLoading: false });
    const payload = await response.json() as InboxMutationResponse;
    if (!response.ok) throw new Error(payload.error ?? "Could not update this conversation.");
    const conversationId = selectedInboxConversation.value?.id;
    if (conversationId && payload.conversation) {
      const assignmentPatch = payload.conversation.assignedUserId === null
        ? { assignedUserName: null, assignedUserEmail: null }
        : payload.actor && payload.conversation.assignedUserId === payload.actor.id
          ? { assignedUserName: payload.actor.name }
          : {};
      patchInboxConversationById(conversationId, { ...payload.conversation, ...assignmentPatch });
    }
    if (conversationId && payload.note && selectedInboxConversation.value?.id === conversationId) {
      selectedInboxConversation.value = {
        ...selectedInboxConversation.value,
        notes: [payload.note, ...(selectedInboxConversation.value.notes ?? [])],
      };
    }
    inboxMessage.value = "Inbox updated";
    window.setTimeout(() => (inboxMessage.value = ""), 2400);
    return payload;
  } catch (error) {
    inboxError.value = "We couldn't update this conversation. Try again.";
    notifyError(error, inboxError.value);
    return null;
  } finally {
    inboxActionLoading.value = false;
  }
}

async function takeOverConversation() {
  if (!selectedInboxConversation.value) return;
  const confirmed = typeof window === "undefined" || window.confirm("Take over this conversation? You will become the customer-facing owner until you return it to AI or resolve it.");
  if (!confirmed) return;
  if (typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches) {
    trackProductEvent(MIXPANEL_EVENTS.MOBILE_TAKEOVER_CONFIRMED, {
      conversation_status: selectedInboxConversation.value.status,
      source: "inbox",
      platform: "mobile",
      success: true,
    });
  }
  const result = await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/takeover`);
  if (result?.conversation?.status === "HUMAN_ACTIVE") {
    trackProductEvent(MIXPANEL_EVENTS.STAFF_TAKEOVER, {
      conversation_status: result.conversation.status,
      source: "inbox",
      success: true,
    });
  }
  if (selectedInboxConversation.value?.status === "HUMAN_ACTIVE") {
    await nextTick();
    inboxComposer.value?.focus();
  }
}

async function assignInboxConversation(userId: string) {
  if (!selectedInboxConversation.value || !userId || !canManageTeam.value) return;
  const result = await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/assign`, { userId });
  if (result?.conversation) {
    const assignee = teamMembers.value.find((member) => member.id === userId);
    patchInboxConversationById(selectedInboxConversation.value.id, {
      assignedUserName: assignee?.name ?? null,
      assignedUserEmail: assignee?.email ?? null,
    });
  }
}

async function returnConversationToAi() {
  if (!selectedInboxConversation.value || selectedConversationReadOnly.value) return;
  await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/return-to-ai`);
}

async function resolveConversation() {
  if (!selectedInboxConversation.value || selectedConversationReadOnly.value) return;
  const result = await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/resolve`);
  if (result?.conversation?.status === "RESOLVED") {
    trackProductEvent(MIXPANEL_EVENTS.CONVERSATION_RESOLVED, {
      conversation_status: result.conversation.status,
      source: "inbox",
      success: true,
    });
  }
}

function handleInboxComposerKeydown(event: KeyboardEvent) {
  if (event.key !== "Enter" || event.shiftKey) return;
  event.preventDefault();
  if (inboxReply.value.trim()) void sendInboxReply();
}

async function sendInboxReply() {
  if (!selectedInboxConversation.value || selectedConversationReadOnly.value || selectedInboxConversation.value.status !== "HUMAN_ACTIVE" || !inboxReply.value.trim()) return;
  const content = inboxReply.value.trim();
  inboxReply.value = "";
  await sendInboxMessage(content);
}

async function sendInboxMessage(content: string, existingTemporaryId?: string, existingClientMessageId?: string) {
  const conversation = selectedInboxConversation.value;
  if (!conversation || selectedConversationReadOnly.value || conversation.status !== "HUMAN_ACTIVE") return;
  const clientMessageId = existingClientMessageId ?? crypto.randomUUID();
  const temporaryId = existingTemporaryId ?? `temp_${clientMessageId}`;
  const optimisticMessage: InboxMessage = {
    id: temporaryId,
    clientMessageId,
    role: "human",
    kind: "message",
    authorName: authSnapshot.value?.user.name ?? "You",
    content,
    createdAt: new Date().toISOString(),
    sendStatus: "pending",
  };
  if (existingTemporaryId) {
    updateInboxMessage(conversation.id, temporaryId, () => optimisticMessage);
  } else {
    const messages = conversation.messages ?? [];
    const nextConversation = { ...conversation, messages: [...messages, optimisticMessage], lastMessage: optimisticMessage, lastActivityAt: optimisticMessage.createdAt };
    selectedInboxConversation.value = nextConversation;
    patchInboxConversationById(conversation.id, { lastMessage: optimisticMessage, lastActivityAt: optimisticMessage.createdAt });
  }
  rememberInboxLocalMessage(conversation.id, optimisticMessage);
  await nextTick();
  scrollInboxToLatest("smooth");
  inboxComposer.value?.focus();
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversation.id}/messages/human`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ content, clientMessageId }),
    }, { globalLoading: false });
    const payload = await response.json() as InboxMutationResponse;
    if (!response.ok || !payload.message) throw new Error(payload.error ?? "Could not send this reply.");
    const canonicalMessage: InboxMessage = { ...payload.message, id: payload.message.id ?? clientMessageId, clientMessageId, sendStatus: "sent" };
    updateInboxMessage(conversation.id, temporaryId, () => canonicalMessage);
    forgetInboxLocalMessage(conversation.id, temporaryId);
    patchInboxConversationById(conversation.id, {
      ...(payload.conversation ?? {}),
      lastMessage: canonicalMessage,
      lastActivityAt: canonicalMessage.createdAt,
    });
    inboxError.value = "";
  } catch (error) {
    updateInboxMessage(conversation.id, temporaryId, (message) => ({ ...message, sendStatus: "failed" }));
    inboxError.value = "We couldn't send that reply.";
    notifyError(error, inboxError.value);
  } finally {
    inboxComposer.value?.focus();
  }
}

async function retryInboxReply(message: InboxMessage) {
  if (!message.id?.startsWith("temp_") || message.sendStatus !== "failed") return;
  await sendInboxMessage(message.content, message.id, message.clientMessageId ?? message.id.slice("temp_".length));
}

async function addInboxNote() {
  if (!selectedInboxConversation.value || !inboxNote.value.trim()) return;
  const content = inboxNote.value.trim();
  const result = await inboxMutation(`/conversations/${selectedInboxConversation.value.id}/notes`, { content });
  if (result?.note) inboxNote.value = "";
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
    sourceActionMessage.value = `Website knowledge updated ✓ · ${payload.sourceCount ?? 0} pages available to your assistant`;
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
    if (!response.ok) throw new Error(response.status === 503 ? "Knowledge index rebuild is not available yet." : payload.error ?? "Could not rebuild the knowledge index.");
    embeddingMessage.value = payload.status === "queued" ? "Knowledge index rebuild started." : payload.message ?? "Knowledge is already up to date.";
    knowledgeTestContext.value = "updated";
    await refreshWorkspaceSummary();
  } catch (error) {
    knowledgeError.value = error instanceof Error ? error.message : "Could not rebuild the knowledge index.";
  } finally {
    embeddingLoading.value = false;
  }
}

async function loadIntegrations() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  const slug = demoSlug.value;
  const loadGeneration = ++integrationsLoadGeneration;
  integrationLoading.value = true;
  integrationError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${slug}/integrations`), { headers: ownerHeaders() });
    const payload = await response.json() as { integrations?: Integration[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load integrations.");
    if (loadGeneration !== integrationsLoadGeneration || demoSlug.value !== slug) return;
    integrations.value = payload.integrations ?? [];
  } catch (error) {
    if (loadGeneration !== integrationsLoadGeneration || demoSlug.value !== slug) return;
    integrationError.value = error instanceof Error ? error.message : "Could not load integrations.";
  } finally {
    if (loadGeneration === integrationsLoadGeneration && demoSlug.value === slug) integrationLoading.value = false;
  }
}

async function loadProviderConnections() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  providerConnectionError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/provider-connections`), { headers: ownerHeaders() });
    const payload = await response.json() as { connections?: ProviderConnection[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load business API connections.");
    providerConnections.value = payload.connections ?? [];
  } catch (error) {
    providerConnectionError.value = error instanceof Error ? error.message : "Could not load business API connections.";
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

function actionProvider(action: ActionFlow | null): string | null {
  if (!action) return null;
  if (action.provider?.trim()) return action.provider.trim().toLowerCase();
  for (const step of action.steps ?? []) {
    const config = step.config && typeof step.config === "object" && !Array.isArray(step.config)
      ? step.config as Record<string, unknown>
      : null;
    const provider = config?.provider;
    if (typeof provider === "string" && provider.trim()) return provider.trim().toLowerCase();
  }
  return null;
}

function providerIsConnected(provider: string | null): boolean {
  if (!provider) return false;
  const normalizedProvider = provider === "generic_webhook" ? "webhook" : provider.trim().toLowerCase();
  return integrations.value.some((integration) => integration.provider.trim().toLowerCase() === normalizedProvider
    && integration.connectionStatus === "active");
}

function actionNeedsProviderConnection(action: ActionFlow): boolean {
  return action.executionMode === "PROVIDER_FLOW"
    && Boolean(actionProvider(action))
    && !providerIsConnected(actionProvider(action));
}

function actionHasProviderFallback(action: ActionFlow): boolean {
  return (action.steps ?? []).some((step) => {
    const config = step.config && typeof step.config === "object" && !Array.isArray(step.config)
      ? step.config as Record<string, unknown>
      : {};
    return ["form", "handoff", "notify"].includes(String(step.type))
      || typeof config.failureBehavior === "string"
      || config.providerUnavailableBehavior === "capture_request_and_notify";
  }) || action.completion.notifyStaff === true || action.completion.requiresStaff === true;
}

function actionPrimarySetupHint(action: ActionFlow): string {
  if (actionNeedsProviderConnection(action)) {
    return "Connect and verify Jackrabbit before making this primary";
  }
  return !canSetPrimaryAction(action) ? "Approve, enable, and complete this action before making it primary" : "";
}

function actionRecommendationReason(action: ActionFlow): string {
  if (daycareWorkspace.value && action.key === "find_daycare") return "Your Business Brain points to a parent-facing daycare search as the clearest first outcome.";
  if (daycareWorkspace.value && action.key === "claim_daycare") return "Your website also serves daycare providers who need to claim or create a listing.";
  if (action.origin === "discovered" && action.sourceLabel) return `Suggested from the website signal “${action.sourceLabel}”.`;
  if (action.key === "capture_lead") return "A reusable fallback for visitors who need help or are not ready to choose a specific next step.";
  if (action.key === "contact_team") return "A safe support path for questions that need a person or do not fit another outcome.";
  return "Suggested from the business type, website content, and available capabilities.";
}

function clearSavedActionHighlight() {
  savedActionId.value = "";
  if (savedActionHighlightTimer !== null) {
    window.clearTimeout(savedActionHighlightTimer);
    savedActionHighlightTimer = null;
  }
}

function highlightSavedAction(actionId: string) {
  clearSavedActionHighlight();
  savedActionId.value = actionId;
  savedActionHighlightTimer = window.setTimeout(() => {
    savedActionId.value = "";
    savedActionHighlightTimer = null;
  }, 5000);
}

function openActionTemplateChooser(entry: ActionEditorEntry = "actions") {
  actionEditorEntry.value = entry;
  actionTemplateChooserOpen.value = true;
}

function selectAction(action: ActionFlow | null, entry: ActionEditorEntry = "actions") {
  if (!action) {
    actionEditorEntry.value = "actions";
    selectedActionId.value = "";
    actionDraft.value = null;
    actionTriggerText.value = "";
    actionTriggerPhraseInput.value = "";
    actionEditorStage.value = "trigger";
    actionFieldDrawerIndex.value = null;
    actionAdvancedOpen.value = false;
    completionLinkMappingsText.value = "";
    return;
  }
  actionEditorEntry.value = entry;
  selectedActionId.value = action.id;
  actionDraft.value = cloneAction(action);
  actionDraft.value.provider ??= actionProvider(actionDraft.value);
  actionDraft.value.captureMode ??= "auto";
  actionDraft.value.completion.completionMode ??= "native_form";
  actionDraft.value.completion.notifyTargets ??= ["business_team"];
  actionDraft.value.completion.notifyChannels ??= ["in_app", "email"];
  completionLinkMappingsText.value = Object.entries(actionDraft.value.completion.linkTemplate?.fieldMappings ?? {})
    .map(([source, target]) => `${source}=${target}`).join("\n");
  actionDraft.value.fields.forEach((field) => {
    field.visibility ??= "visible";
  });
  actionTriggerText.value = action.triggerPhrases.join("\n");
  actionTriggerPhraseInput.value = "";
  actionEditorStage.value = "trigger";
  actionFieldDrawerIndex.value = null;
  actionAdvancedOpen.value = false;
}

function openWorkflowAction(actionId: string) {
  if (!actionId) {
    navigateToWorkspaceView("actions");
    return;
  }
  const action = actionFlows.value.find((item) => item.id === actionId);
  if (action) selectAction(action);
  navigateToWorkspaceView("actions");
}

function actionHasCurrentWorkflow(action: ActionFlow): boolean {
  const isCurrent = action.enabled !== false && action.lifecycleStatus !== "disabled";
  if (!isCurrent) return false;
  const hasCurrentDefinition = (action.steps?.length ?? 0) > 0;
  return Boolean((action.workflowCount ?? 0) > 0 || (action.workflowCount === 0 && hasCurrentDefinition));
}

function actionWorkflowCount(action: ActionFlow): number {
  return actionHasCurrentWorkflow(action) ? Math.max(1, action.workflowCount ?? 0) : action.workflowCount ?? 0;
}

function actionWorkflowNames(action: ActionFlow): string[] {
  if (action.workflowNames?.length) return action.workflowNames;
  return actionHasCurrentWorkflow(action)
    ? [action.completion.workflow?.name?.trim() || action.name]
    : [];
}

function normalizeActionWorkflowProjection(actions: ActionFlow[]): ActionFlow[] {
  return actions.map((action) => {
    if (!actionHasCurrentWorkflow(action) || action.workflowNames?.length) return action;
    return {
      ...action,
      workflowCount: actionWorkflowCount(action),
      workflowIds: action.workflowIds?.length ? action.workflowIds : [action.id],
      workflowNames: actionWorkflowNames(action),
    };
  });
}

function openWorkflowForAction(action: ActionFlow, workflowIndex = 0) {
  const workflowId = action.workflowIds?.[workflowIndex] ?? (actionHasCurrentWorkflow(action) ? action.id : undefined);
  const options = workflowId ? { workflowId } : { workflowActionId: action.id };
  const nextRoute = route.value.kind === "demo"
    ? demoRoute(workspaceSlugForRoute(), "workflows", options)
    : workspaceRoute(workspaceSlugForRoute(), "workflows", options);
  commitRoute(nextRoute);
}

function openWorkflowFromBuilder(workflowId: string) {
  if (!workflowId.trim()) return;
  const nextRoute = route.value.kind === "demo"
    ? demoRoute(workspaceSlugForRoute(), "workflows", { workflowId: workflowId.trim() })
    : workspaceRoute(workspaceSlugForRoute(), "workflows", { workflowId: workflowId.trim() });
  commitRoute(nextRoute);
}

function testWorkflowFromBuilder(actionId: string) {
  const action = actionFlows.value.find((item) => item.id === actionId);
  if (action) runActionTest(action);
}

async function publishWorkflowFromBuilder() {
  await publishAgent(agentModel.value);
}

function ensureCompletionLinkTemplate() {
  if (!actionDraft.value) return;
  if (actionDraft.value.completion.completionMode === "external_provider" || actionDraft.value.completion.completionMode === "payment_link") {
    actionDraft.value.completion.linkTemplate ??= { baseUrl: "", fieldMappings: {} };
  }
}

function setCompletionLinkMappings(value: string) {
  completionLinkMappingsText.value = value;
  if (!actionDraft.value?.completion.linkTemplate) return;
  const mappings: Record<string, string> = {};
  for (const line of value.split("\n")) {
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const source = line.slice(0, separator).trim();
    const target = line.slice(separator + 1).trim();
    if (source && target) mappings[source] = target;
  }
  actionDraft.value.completion.linkTemplate.fieldMappings = mappings;
}

function setCompletionLinkMappingsFromEvent(event: Event) {
  setCompletionLinkMappings((event.target as HTMLTextAreaElement).value);
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

const workflowPerformanceByAction = computed<Record<string, WorkflowPerformance>>(() => {
  const performance: Record<string, WorkflowPerformance> = {};
  for (const funnel of workspaceStats.value?.conversionFunnels ?? []) {
    if (funnel.flowId) performance[funnel.flowId] = funnel;
    if (funnel.flowKey) performance[funnel.flowKey] = funnel;
  }
  return performance;
});

function actionCompletionRate(action: ActionFlow): number {
  return actionFunnelFor(action)?.completionRate ?? 0;
}

function actionDeliveriesFor(action: ActionFlow): ActionDelivery[] {
  return actionDeliveries.value.filter((delivery) => delivery.actionId === action.id);
}

function actionSetupStatus(action: ActionFlow): "Ready" | "Draft" | "Needs setup" {
  if (action.setupStatus === "READY") return "Ready";
  if (action.setupStatus === "DRAFT") return "Draft";
  if (action.setupStatus === "NEEDS_SETUP") return "Needs setup";
  if (action.readiness?.ready) return "Ready";
  if (action.origin === "discovered" || action.lifecycleStatus === "needs_review") return "Draft";
  return "Needs setup";
}

function actionStatusLabel(action: ActionFlow): "Ready" | "Draft" | "Disabled" | "Needs setup" | "Needs setup · Fallback available" | "Integration error" {
  const delivery = actionDeliveries.value.find((item) => item.actionId === action.id && item.status === "failed");
  if (delivery) return "Integration error";
  if (!action.enabled) return "Disabled";
  if (actionNeedsProviderConnection(action)) return actionHasProviderFallback(action) ? "Needs setup · Fallback available" : "Needs setup";
  return actionSetupStatus(action);
}

function actionStatusTone(status: ReturnType<typeof actionStatusLabel>): "active" | "draft" | "paused" | "attention" {
  if (status === "Ready") return "active";
  if (status === "Disabled") return "paused";
  if (status === "Integration error" || status.startsWith("Needs setup")) return "attention";
  return "draft";
}

function actionCompletionLabel(action: ActionFlow): string {
  switch (action.capability?.completionType) {
    case "link": return "Send visitors to a page";
    case "provider": return "Use a connected provider";
    case "phone": return "Call the business";
    case "email": return "Email the team";
    case "handoff": return "Notify the team";
    case "webhook": return "Send to CRM / webhook";
    default:
      switch (action.executionMode) {
        case "DIRECT_LINK": return "Send visitors to a page";
        case "PROVIDER_FLOW": return "Use a connected provider";
        case "PHONE": return "Call the business";
        case "EMAIL": return "Email the team";
        case "HANDOFF": return "Notify the team";
        case "API_ACTION": return "Send to CRM / webhook";
        default: return "Collect details";
      }
  }
}

function actionOutcomeDetail(action: ActionFlow): string {
  const destination = action.destination?.url || action.completion.linkUrl;
  if (destination) return destination;
  const provider = action.capability?.provider || actionProvider(action);
  if (provider) return `${formatLabel(provider)} · ${providerIsConnected(provider) ? "Connected" : "Needs setup"}`;
  if (action.executionMode === "PHONE") return "Verified business phone destination";
  if (action.executionMode === "HANDOFF" || action.completion.notifyStaff) return "Send the completed request to your team";
  return "FrontDeskWise collects the configured details";
}

function actionFieldLabel(key: string): string {
  const known: Record<string, string> = { selected_slot: "Selected time", selected_class: "Selected class", preferred_date: "Preferred date", preferred_time: "Preferred time" };
  return known[key] ?? formatLabel(key);
}

function actionRequiredInputLabels(action: ActionFlow): string[] {
  return (action.capability?.requiredInputs ?? []).map(actionFieldLabel);
}

function actionRecommendedInputLabels(action: ActionFlow): string[] {
  return (action.capability?.recommendedInputs ?? []).map(actionFieldLabel);
}

function actionCompletionChoice(action: ActionFlow): string {
  switch (action.capability?.completionType) {
    case "link": return "link";
    case "provider": return "provider";
    case "phone": return "phone";
    case "email": return "email";
    case "handoff": return "notify_team";
    case "webhook": return "webhook";
    default: return "collect_details";
  }
}

function setActionCompletionChoice(value: string): void {
  if (!actionDraft.value) return;
  const mapping: Record<string, { executionMode: NonNullable<ActionFlow["executionMode"]>; completionMode?: ActionFlow["completion"]["completionMode"] }> = {
    link: { executionMode: "DIRECT_LINK", completionMode: "external_provider" },
    provider: { executionMode: "PROVIDER_FLOW", completionMode: "booking_connector" },
    phone: { executionMode: "PHONE" },
    email: { executionMode: "EMAIL" },
    notify_team: { executionMode: "HANDOFF", completionMode: "human_follow_up" },
    webhook: { executionMode: "API_ACTION", completionMode: "api_webhook" },
    collect_details: { executionMode: "FORM_FLOW", completionMode: "native_form" },
  };
  const next = mapping[value] ?? mapping.collect_details;
  actionDraft.value.executionMode = next.executionMode;
  if (next.completionMode) actionDraft.value.completion.completionMode = next.completionMode;
}

function setActionCompletionChoiceFromEvent(event: Event): void {
  setActionCompletionChoice((event.target as HTMLSelectElement).value);
}

function actionReadinessDetail(action: ActionFlow): string {
  switch (action.readiness?.reason) {
    case "disabled": return "Enable the action before making it primary.";
    case "needs_review": return "Approve the action before making it primary.";
    case "missing_tracking_key": return "Add a tracking key before making it primary.";
    case "missing_destination": return "Add a destination URL before making it primary.";
    case "invalid_destination": return "Use a valid destination URL before making it primary.";
    case "missing_configuration": return "Complete the required action configuration before making it primary.";
    case "missing_provider_connection": return "Connect and verify the provider before making it primary.";
    default: return "Complete the required action configuration before making it primary.";
  }
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
  const slug = demoSlug.value;
  const loadGeneration = ++actionsLoadGeneration;
  actionsLoading.value = true;
  actionsError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/demo/" + slug + "/actions"), { headers: ownerHeaders() });
    const payload = await response.json() as { actions?: ActionFlow[]; templates?: ActionTemplate[]; deliveries?: ActionDelivery[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load conversation flows.");
    if (loadGeneration !== actionsLoadGeneration || demoSlug.value !== slug) return;
    actionFlows.value = normalizeActionWorkflowProjection(payload.actions ?? []);
    actionTemplates.value = payload.templates ?? [];
    actionDeliveries.value = payload.deliveries ?? [];
    const selected = actionFlows.value.find((action) => action.id === selectedActionId.value) ?? null;
    selectAction(selected, selected ? actionEditorEntry.value : "actions");
    await loadWorkflows();
  } catch (error) {
    if (loadGeneration !== actionsLoadGeneration || demoSlug.value !== slug) return;
    actionsError.value = error instanceof Error ? error.message : "Could not load conversation flows.";
  } finally {
    if (loadGeneration === actionsLoadGeneration && demoSlug.value === slug) actionsLoading.value = false;
  }
}

async function loadWorkflows() {
  if (!firebaseToken.value && !demoAccessToken.value) return;
  const slug = demoSlug.value;
  const loadGeneration = ++workflowsLoadGeneration;
  workflowsLoading.value = true;
  workflowsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${encodeURIComponent(slug)}/workflows`), { headers: ownerHeaders() });
    const payload = await response.json() as { workflows?: ActionFlow[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load workflows.");
    if (loadGeneration !== workflowsLoadGeneration || demoSlug.value !== slug) return;
    workflowRecords.value = payload.workflows ?? [];
  } catch (error) {
    if (loadGeneration !== workflowsLoadGeneration || demoSlug.value !== slug) return;
    workflowsError.value = error instanceof Error ? error.message : "Could not load workflows.";
    workflowRecords.value = [];
  } finally {
    if (loadGeneration === workflowsLoadGeneration && demoSlug.value === slug) workflowsLoading.value = false;
  }
}

async function setPrimaryAction(action: ActionFlow) {
  if (actionsLoading.value) return;
  clearSavedActionHighlight();
  primaryGoalChooserOpen.value = false;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/actions/${action.id}/primary`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not set the primary conversion goal.");
    actionsMessage.value = `${action.name} is now the primary conversion goal`;
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not set the primary conversion goal.";
  } finally {
    actionsLoading.value = false;
  }
}

async function approveAction(action: ActionFlow) {
  if (actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/actions/${action.id}`), {
      method: "PUT",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ ...action, enabled: true, reviewReason: "owner_override" }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not approve this Action.");
    actionsMessage.value = `${action.name} approved. Generate its workflow when you’re ready.`;
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not approve this Action.";
  } finally {
    actionsLoading.value = false;
  }
}

async function ignoreAction(action: ActionFlow) {
  if (actionsLoading.value || !window.confirm(`Ignore “${action.name}” for this workspace?`)) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/actions/${action.id}`), {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not ignore this Action.");
    actionsMessage.value = `${action.name} ignored`;
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not ignore this Action.";
  } finally {
    actionsLoading.value = false;
  }
}

function openPrimaryGoalChooser() {
  if (visibleActionFlows.value.length) {
    primaryGoalChooserOpen.value = true;
    return;
  }
  openActionTemplateChooser("primary");
}

function canSetPrimaryAction(action: ActionFlow) {
  if (action.readiness?.ready !== true) return false;
  if (actionNeedsProviderConnection(action)) return false;
  return true;
}

async function clearPrimaryAction(action: ActionFlow) {
  if (actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/actions/${action.id}/primary`), {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not clear the primary conversion goal.");
    actionsMessage.value = "Primary conversion goal cleared";
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not clear the primary conversion goal.";
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
      // Include the complete template as a compatibility fallback for a
      // briefly skewed deployment where the API does not yet know this key.
      body: JSON.stringify({ ...template, templateKey: template.key }),
    });
    const payload = await response.json() as { error?: string; action?: ActionFlow };
    if (!response.ok) throw new Error(payload.error ?? "Could not add this flow.");
    if (payload.action) {
      trackProductEvent(MIXPANEL_EVENTS.ACTION_GENERATED, {
        action_id: payload.action.id,
        action_key: payload.action.key,
        action_type: payload.action.actionType,
        workflow_id: payload.action.id,
        workflow_key: payload.action.key,
      });
      if (payload.action.steps?.length) {
        trackProductEvent(MIXPANEL_EVENTS.WORKFLOW_GENERATED, {
          workflow_id: payload.action.id,
          workflow_key: payload.action.key,
        });
      }
    }
    actionsMessage.value = "Action added to Recommendations · approve it before generating a workflow";
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
  const savedDraft = cloneAction(actionDraft.value);
  const savedActionEntry = actionEditorEntry.value;
  const savedActionIdBeforeRefresh = savedDraft.id;
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
        reviewReason: "owner_override",
      }),
    });
    const payload = await response.json() as { error?: string; primaryActionCleared?: boolean; action?: ActionFlow };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this flow.");
    selectedActionId.value = "";
    await loadActions();

    const refreshedAction = actionFlows.value.find((action) => action.id === savedActionIdBeforeRefresh) ?? payload.action;
    const needsMoreSetup = payload.primaryActionCleared || !refreshedAction?.readiness?.ready || Boolean(refreshedAction && actionNeedsProviderConnection(refreshedAction));
    if (needsMoreSetup) {
      if (refreshedAction) selectAction(refreshedAction, savedActionEntry);
      else selectAction(savedDraft, savedActionEntry);
      actionsMessage.value = payload.primaryActionCleared
        ? `Saved, but this action still needs setup. ${refreshedAction ? actionReadinessDetail(refreshedAction) : "Complete the required action configuration before making it primary."}`
        : `Saved, but this action still needs setup. ${refreshedAction && actionNeedsProviderConnection(refreshedAction) ? "Connect and verify Jackrabbit before making it primary." : refreshedAction ? actionReadinessDetail(refreshedAction) : "Complete the required action configuration before leaving the editor."}`;
      return;
    }

    if (!refreshedAction) throw new Error("The action was saved, but could not be loaded again.");

    trackProductEvent(MIXPANEL_EVENTS.WORKFLOW_EDITED, {
      workflow_id: refreshedAction.id,
      workflow_key: refreshedAction.key,
      action_id: refreshedAction.id,
      action_key: refreshedAction.key,
      status: needsMoreSetup ? "needs_setup" : "ready",
    });

    highlightSavedAction(savedActionIdBeforeRefresh);
    if (savedActionEntry === "primary") {
      actionsMessage.value = `${refreshedAction.name} is ready. Choose it as your primary conversion goal.`;
      primaryGoalChooserOpen.value = true;
    } else if (savedActionEntry === "test") {
      actionsMessage.value = `${refreshedAction.name} is ready to test.`;
      runActionTest(refreshedAction);
    } else {
      actionsMessage.value = refreshedAction.isPrimary
        ? `${refreshedAction.name} saved as the primary conversion goal.`
        : `${refreshedAction.name} is ready. Set it as primary or test the flow.`;
    }
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
    clearSavedActionHighlight();
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

type BillingAnalyticsEvent = "checkout_returned" | "subscription_pending" | "subscription_activated" | "subscription_success_screen_viewed" | "subscription_success_continue_clicked";

async function trackBillingEvent(event: BillingAnalyticsEvent, metadata: Record<string, unknown> = {}) {
  if (!authSnapshot.value) return;
  try {
    await trackedFetch(apiUrl("/api/v1/billing/events"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ organizationId: authSnapshot.value.activeOrganizationId, event, ...metadata }),
    }, { globalLoading: false });
  } catch {
    // Analytics must never interrupt subscription confirmation.
  }
}

async function loadBilling(showLoading = true) {
  if (!authSnapshot.value || !canAccessBilling.value || (billingLoading.value && showLoading)) return;
  billingLoading.value = true;
  billingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/billing?organizationId=${encodeURIComponent(authSnapshot.value.activeOrganizationId ?? "")}`), { headers: ownerHeaders() }, { globalLoading: showLoading });
    const payload = await response.json() as BillingSnapshot & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load billing.");
    billingSnapshot.value = payload;
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not load billing.";
  } finally {
    billingLoading.value = false;
  }
}

function refreshBillingPage() {
  void loadBilling();
}

function clearBillingReturnQuery() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  url.searchParams.delete("billing");
  url.searchParams.delete("session_id");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
}

async function waitForBillingState(expectedPlanKey?: string): Promise<boolean> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await loadBilling(false);
    const billing = billingSnapshot.value?.billing;
    const settled = billing?.status === "active"
      && (!expectedPlanKey || billing.planKey === expectedPlanKey)
      && billing.checkoutStatus !== "open";
    if (settled) {
      await Promise.all([refreshAuthenticatedSnapshot(), loadBilling(false)]);
      return true;
    }
    if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  return false;
}

function billingSuccessViewed(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(billingSuccessViewedKey.value) === "1";
}

function billingSuccessToastPayload(): { planName: string } | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(billingSuccessToastKey.value);
  if (!raw) return null;
  try {
    const payload = JSON.parse(raw) as { planName?: unknown };
    return typeof payload.planName === "string" && payload.planName.trim() ? { planName: payload.planName } : null;
  } catch {
    return null;
  }
}

function consumeBillingSuccessToast() {
  if (typeof window === "undefined" || view.value !== "overview") return;
  const payload = billingSuccessToastPayload();
  if (!payload) return;
  window.sessionStorage.removeItem(billingSuccessToastKey.value);
  notifySuccess(`${payload.planName} plan activated successfully.`, "Subscription active");
}

function legacyBillingReturn(): "success" | "cancel" | null {
  if (typeof window === "undefined") return null;
  const value = new URLSearchParams(window.location.search).get("billing");
  return value === "success" || value === "cancel" ? value : null;
}

async function startBillingSuccessFlow() {
  if (!authSnapshot.value || route.value.kind !== "billing-success") return;
  const runKey = routePath(route.value);
  if (billingSuccessRunKey === runKey) return;
  billingSuccessRunKey = runKey;
  const sessionId = route.value.sessionId;
  billingSuccessState.value = "activating";
  await loadBilling(false);
  const billingBeforePoll = billingSnapshot.value?.billing;
  const expectedPlanKey = billingBeforePoll?.pendingPlanKey || billingBeforePoll?.planKey || "starter";
  billingSuccessExpectedPlanKey.value = expectedPlanKey;
  if (billingSuccessViewed()) {
    commitRoute(settingsRoute("billing"), true);
    return;
  }
  if (sessionId) await trackBillingEvent("checkout_returned", { sessionId });
  let pendingTracked = false;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await loadBilling(false);
    const billing = billingSnapshot.value?.billing;
    if (billing?.status === "active" && billing.planKey === expectedPlanKey && billing.checkoutStatus !== "open") {
      await refreshAuthenticatedSnapshot();
      await loadBilling(false);
      billingSuccessState.value = "active";
      if (typeof window !== "undefined") window.sessionStorage.setItem(billingSuccessViewedKey.value, "1");
      await trackBillingEvent("subscription_success_screen_viewed", { sessionId: sessionId ?? undefined, planKey: billingSnapshot.value?.billing.planKey });
      return;
    }
    if (billing?.lastPaymentStatus === "failed" || billing?.status === "cancelled" || billing?.status === "paused") {
      billingSuccessState.value = "failed";
      return;
    }
    if (!pendingTracked) {
      pendingTracked = true;
      billingSuccessState.value = "pending";
      await trackBillingEvent("subscription_pending", { sessionId: sessionId ?? undefined, planKey: expectedPlanKey });
    }
    if (attempt < 9) await new Promise((resolve) => window.setTimeout(resolve, 1_500));
  }
  billingSuccessState.value = "pending";
}

function continueFromBillingSuccess() {
  if (!authSnapshot.value || billingSuccessState.value !== "active") return;
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(billingSuccessToastKey.value, JSON.stringify({ planName: billingSuccessPlanName.value }));
  }
  void trackBillingEvent("subscription_success_continue_clicked", {
    sessionId: route.value.kind === "billing-success" ? route.value.sessionId : undefined,
    planKey: billingSnapshot.value?.billing.planKey,
  });
  commitRoute(workspaceRoute(demoSlug.value || availableBusinesses.value[0]?.slug || "", "overview"));
}

function openBillingFromSuccess() {
  commitRoute(settingsRoute("billing"));
}

async function reconcileBillingReturn() {
  if (typeof window === "undefined" || !authSnapshot.value) return;
  const params = new URLSearchParams(window.location.search);
  const billingReturn = params.get("billing");
  if (billingReturn === "cancel") {
    billingFlow.value = "cancelled";
    billingMessage.value = "Checkout was canceled. Your current plan is unchanged.";
    clearBillingReturnQuery();
    return;
  }
  if (billingReturn !== "success") return;
  if (route.value.kind !== "billing-success") {
    const sessionId = params.get("session_id")?.trim();
    commitRoute({ kind: "billing-success", ...(sessionId ? { sessionId } : {}) }, true, false);
  }
  await startBillingSuccessFlow();
}

async function retryBillingRefresh() {
  billingFlow.value = "processing";
  if (route.value.kind === "billing-success") {
    billingSuccessRunKey = "";
    await startBillingSuccessFlow();
    return;
  }
  const params = typeof window === "undefined" ? null : new URLSearchParams(window.location.search);
  if (params?.get("billing") === "success") {
    await reconcileBillingReturn();
    return;
  }
  const settled = await waitForBillingState(billingSnapshot.value?.billing.pendingPlanKey ?? undefined);
  billingFlow.value = settled ? "complete" : "pending";
  billingMessage.value = settled
    ? "You’re all set — your FrontDeskWise plan is active."
    : "Your plan change was received. We’re finishing the update; refresh in a moment.";
}

function formatPlanPrice(plan: BillingPlan): string {
  if (plan.amountCents === null) return "Contact us";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency.toUpperCase(), maximumFractionDigits: 0 }).format(plan.amountCents / 100);
}

function planConversationAllowance(plan: BillingPlan | BillingSnapshot["billing"]["plan"] | null | undefined): number | null {
  const entitlements = plan && "entitlements" in plan ? plan.entitlements : null;
  const value = entitlements && typeof entitlements === "object" ? (entitlements as Record<string, unknown>).ai_conversations : null;
  if (!value || typeof value !== "object") return null;
  const included = (value as Record<string, unknown>).included;
  return typeof included === "number" && Number.isFinite(included) ? included : null;
}

function planConversationLabel(plan: BillingPlan): string {
  const allowance = planConversationAllowance(plan);
  return allowance === null ? "Custom pooled usage" : `${allowance.toLocaleString("en-US")} AI conversations / month`;
}

function formatLabel(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function crawlReasonEntries(validation?: OnboardingValidation): Array<[string, number]> {
  return Object.entries(validation?.crawlRun?.rejectionReasons ?? validation?.crawlCoverage?.rejectionReasons ?? {})
    .filter(([, count]) => Number(count) > 0)
    .sort((left, right) => Number(right[1]) - Number(left[1]));
}

function formatExecutivePercent(value: number | null): string {
  if (value === null) return "—";
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function formatExecutiveMetric(metric: ExecutiveQualityMetric): string {
  if (metric.value === null) return "—";
  if (metric.unit === "currency") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 }).format(metric.value);
  return formatExecutivePercent(metric.value);
}

function executiveMetricTone(status: ExecutiveQualityMetric["status"]): string {
  return status === "healthy" ? "healthy" : status === "watch" ? "watch" : "no-data";
}

function executiveStepTone(status: ExecutiveAnalyticsStep["status"]): string {
  return status === "complete" ? "complete" : status === "attention" ? "attention" : "pending";
}

function conversationEventLabel(event: InboxEvent): string {
  if (event.eventType === "HUMAN_JOINED") return "Took over conversation";
  if (event.eventType === "STAFF_ASSIGNED") return event.metadata?.assignmentType === "transfer" ? "Transferred conversation" : "Assigned conversation";
  if (event.eventType === "MESSAGE_SENT_BY_HUMAN") return "Replied to visitor";
  if (event.eventType === "RETURNED_TO_AI") return "Returned conversation to AI";
  if (event.eventType === "CONVERSATION_RESOLVED") return "Resolved conversation";
  if (event.eventType === "INTERNAL_NOTE_ADDED") return "Added an internal note";
  if (event.eventType === "AI_HANDOFF_REQUESTED") return "AI requested human help";
  return formatLabel(event.eventType);
}

function inboxAssignmentLabel(conversation: InboxConversation): string {
  if (!conversation.assignedUserId) return "Unassigned";
  if (conversation.assignedUserId === authSnapshot.value?.user.id) return "You";
  return conversation.assignedUserName || "Another team member";
}

function certificationScoreLabel(key: string): string {
  return formatLabel(key.replace(/^(retrieval|routing|workflow)\./, ""));
}

function certificationScoreValue(value: number | undefined): string {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

function certificationDeltaValue(value: number | undefined): string {
  if (value === undefined) return "—";
  return `${value > 0 ? "+" : ""}${(value * 100).toFixed(1)} pts`;
}

function formatTemplateVariable(value: string): string {
  return `{{${value}}}`;
}

function formatPlanLabel(value: string): string {
  const labels: Record<string, string> = {
    starter: "Starter",
    growth: "Growth",
    multi_business: "Business Plus",
    portfolio: "Portfolio / Agency",
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

async function loadAdminSupportCases() {
  if (!authSnapshot.value || adminSupportLoading.value) return;
  adminSupportLoading.value = true;
  adminSupportError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/support-cases?limit=500"), { headers: ownerHeaders() });
    const payload = await response.json() as { cases?: SupportCaseRecord[]; assignees?: InstallationSupportAssignee[]; summary?: { open?: number; inProgress?: number; resolved?: number }; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load support cases.");
    adminSupportCases.value = payload.cases ?? [];
    adminSupportAssignees.value = payload.assignees ?? [];
    adminSupportSummary.value = { open: payload.summary?.open ?? 0, inProgress: payload.summary?.inProgress ?? 0, resolved: payload.summary?.resolved ?? 0 };
  } catch (error) {
    adminSupportError.value = error instanceof Error ? error.message : "Could not load support cases.";
  } finally {
    adminSupportLoading.value = false;
  }
}

async function updateAdminSupportCase(item: SupportCaseRecord) {
  if (adminSupportLoading.value) return;
  adminSupportLoading.value = true;
  adminSupportError.value = "";
  adminSupportMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/support-cases/${encodeURIComponent(item.id)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ status: item.status, assignedUserId: item.assignedUserId }),
    });
    const payload = await response.json() as { case?: SupportCaseRecord; error?: string };
    if (!response.ok || !payload.case) throw new Error(payload.error ?? "Could not update support case.");
    const index = adminSupportCases.value.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) adminSupportCases.value.splice(index, 1, payload.case);
    adminSupportMessage.value = "Support case updated.";
    const summary = adminSupportCases.value.reduce((result, candidate) => {
      if (candidate.status === "open") result.open += 1;
      else if (candidate.status === "in_progress") result.inProgress += 1;
      else result.resolved += 1;
      return result;
    }, { open: 0, inProgress: 0, resolved: 0 });
    adminSupportSummary.value = summary;
  } catch (error) {
    adminSupportError.value = error instanceof Error ? error.message : "Could not update support case.";
    await loadAdminSupportCases();
  } finally {
    adminSupportLoading.value = false;
  }
}

function openAdminSupportBusiness(item: SupportCaseRecord) {
  navigateToAdminSection("business-detail", { businessId: item.businessId });
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

async function loadAdminActionRegistry() {
  if (!authSnapshot.value || adminActionRegistryLoading.value) return;
  adminActionRegistryLoading.value = true;
  adminActionRegistryError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/action-registry"), { headers: ownerHeaders() });
    const payload = await response.json() as { actions?: AdminActionRegistryItem[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the action registry.");
    adminActionRegistry.value = payload.actions ?? [];
  } catch (error) {
    adminActionRegistryError.value = error instanceof Error ? error.message : "Could not load the action registry.";
  } finally {
    adminActionRegistryLoading.value = false;
  }
}

async function loadAdminCertification() {
  if (!authSnapshot.value || adminCertificationLoading.value) return;
  adminCertificationLoading.value = true;
  adminCertificationError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/certification"), { headers: ownerHeaders() });
    const payload = await response.json() as AdminCertificationPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load certification status.");
    adminCertification.value = payload;
  } catch (error) {
    adminCertificationError.value = error instanceof Error ? error.message : "Could not load certification status.";
  } finally {
    adminCertificationLoading.value = false;
  }
}

async function loadAdminExperienceSignals() {
  if (!authSnapshot.value || adminExperienceSignalsLoading.value) return;
  adminExperienceSignalsLoading.value = true;
  adminExperienceSignalsError.value = "";
  try {
    const params = new URLSearchParams({ status: adminExperienceSignalStatusFilter.value, days: "30", limit: "150" });
    if (adminExperienceSignalSeverityFilter.value !== "all") params.set("severity", adminExperienceSignalSeverityFilter.value);
    if (adminExperienceSignalTypeFilter.value !== "all") params.set("type", adminExperienceSignalTypeFilter.value);
    const response = await trackedFetch(apiUrl(`/api/v1/admin/experience-signals?${params.toString()}`), { headers: ownerHeaders() });
    const payload = await response.json() as AdminExperienceSignalsPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load experience signals.");
    adminExperienceSignals.value = payload;
  } catch (error) {
    adminExperienceSignalsError.value = error instanceof Error ? error.message : "Could not load experience signals.";
  } finally {
    adminExperienceSignalsLoading.value = false;
  }
}

async function updateAdminExperienceSignal(signal: AdminExperienceSignal, status: AdminExperienceSignal["status"]) {
  if (adminExperienceSignalsLoading.value) return;
  adminExperienceSignalsLoading.value = true;
  adminExperienceSignalsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/experience-signals/${encodeURIComponent(signal.id)}`), {
      method: "PATCH",
      headers: { ...ownerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const payload = await response.json() as { signal?: AdminExperienceSignal; error?: string };
    if (!response.ok || !payload.signal) throw new Error(payload.error ?? "Could not update this signal.");
    const current = adminExperienceSignals.value?.signals.findIndex((item) => item.id === signal.id) ?? -1;
    if (current >= 0 && adminExperienceSignals.value) {
      if (adminExperienceSignalStatusFilter.value !== "all" && status !== adminExperienceSignalStatusFilter.value) adminExperienceSignals.value.signals.splice(current, 1);
      else adminExperienceSignals.value.signals.splice(current, 1, payload.signal);
    }
  } catch (error) {
    adminExperienceSignalsError.value = error instanceof Error ? error.message : "Could not update this signal.";
  } finally {
    adminExperienceSignalsLoading.value = false;
  }
}

async function loadAdminFeatureFlags() {
  if (!authSnapshot.value || adminFeatureFlagsLoading.value) return;
  adminFeatureFlagsLoading.value = true;
  adminFeatureFlagsError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/feature-flags"), { headers: ownerHeaders() });
    const payload = await response.json() as { flags?: AdminFeatureFlag[]; organizations?: AdminFeatureFlagOrganization[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load feature flags.");
    adminFeatureFlags.value = payload.flags ?? [];
    adminFeatureFlagOrganizations.value = payload.organizations ?? [];
    if (!adminFeatureFlagOverride.value.key && adminFeatureFlags.value[0]) adminFeatureFlagOverride.value.key = adminFeatureFlags.value[0].key;
    if (!adminFeatureFlagOverride.value.organizationId && adminFeatureFlagOrganizations.value[0]) adminFeatureFlagOverride.value.organizationId = adminFeatureFlagOrganizations.value[0].id;
  } catch (error) {
    adminFeatureFlagsError.value = error instanceof Error ? error.message : "Could not load feature flags.";
  } finally {
    adminFeatureFlagsLoading.value = false;
  }
}

function adminFeatureFlagOrganizationName(organizationId: string) {
  return adminFeatureFlagOrganizations.value.find((organization) => organization.id === organizationId)?.name ?? organizationId;
}

async function saveAdminFeatureFlag(flag: AdminFeatureFlag) {
  if (adminFeatureFlagsLoading.value) return;
  adminFeatureFlagsLoading.value = true;
  adminFeatureFlagsError.value = "";
  adminFeatureFlagsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/feature-flags/${encodeURIComponent(flag.key)}`), {
      method: "PATCH",
      headers: { ...ownerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({
        description: flag.description,
        stage: flag.stage,
        rolloutPercentage: flag.rolloutPercentage,
        referenceOrganizationIds: flag.referenceOrganizationIds,
      }),
    });
    const payload = await response.json() as { flag?: AdminFeatureFlag; error?: string };
    if (!response.ok || !payload.flag) throw new Error(payload.error ?? "Could not save the feature flag.");
    const index = adminFeatureFlags.value.findIndex((candidate) => candidate.key === flag.key);
    if (index >= 0) adminFeatureFlags.value.splice(index, 1, payload.flag);
    adminFeatureFlagsMessage.value = `${flag.key} is now staged for ${flag.stage}.`;
  } catch (error) {
    adminFeatureFlagsError.value = error instanceof Error ? error.message : "Could not save the feature flag.";
    await loadAdminFeatureFlags();
  } finally {
    adminFeatureFlagsLoading.value = false;
  }
}

async function createAdminFeatureFlag() {
  if (adminFeatureFlagsLoading.value || !adminFeatureFlagDraft.value.key.trim()) return;
  adminFeatureFlagsLoading.value = true;
  adminFeatureFlagsError.value = "";
  adminFeatureFlagsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/feature-flags"), {
      method: "POST",
      headers: { ...ownerHeaders(), "content-type": "application/json" },
      body: JSON.stringify(adminFeatureFlagDraft.value),
    });
    const payload = await response.json() as { flag?: AdminFeatureFlag; error?: string };
    if (!response.ok || !payload.flag) throw new Error(payload.error ?? "Could not create the feature flag.");
    adminFeatureFlags.value.push(payload.flag);
    if (!adminFeatureFlagOverride.value.key) adminFeatureFlagOverride.value.key = payload.flag.key;
    adminFeatureFlagDraft.value = { key: "", description: "", stage: "off", rolloutPercentage: 0, referenceOrganizationIds: [] };
    adminFeatureFlagsMessage.value = "Feature flag created.";
  } catch (error) {
    adminFeatureFlagsError.value = error instanceof Error ? error.message : "Could not create the feature flag.";
  } finally {
    adminFeatureFlagsLoading.value = false;
  }
}

async function saveAdminFeatureFlagOverride() {
  const draft = adminFeatureFlagOverride.value;
  if (adminFeatureFlagsLoading.value || !draft.key || !draft.organizationId) return;
  adminFeatureFlagsLoading.value = true;
  adminFeatureFlagsError.value = "";
  adminFeatureFlagsMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/feature-flags/${encodeURIComponent(draft.key)}/overrides`), {
      method: "POST",
      headers: { ...ownerHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ organizationId: draft.organizationId, state: draft.state, reason: draft.reason || "admin_override" }),
    });
    const payload = await response.json() as { flag?: AdminFeatureFlag; error?: string };
    if (!response.ok || !payload.flag) throw new Error(payload.error ?? "Could not save the tenant override.");
    const index = adminFeatureFlags.value.findIndex((flag) => flag.key === draft.key);
    if (index >= 0) adminFeatureFlags.value.splice(index, 1, payload.flag);
    adminFeatureFlagsMessage.value = `Override saved for ${adminFeatureFlagOrganizations.value.find((organization) => organization.id === draft.organizationId)?.name ?? "tenant"}.`;
  } catch (error) {
    adminFeatureFlagsError.value = error instanceof Error ? error.message : "Could not save the tenant override.";
  } finally {
    adminFeatureFlagsLoading.value = false;
  }
}

async function removeAdminFeatureFlagOverride(flag: AdminFeatureFlag, organizationId: string) {
  if (adminFeatureFlagsLoading.value) return;
  adminFeatureFlagsLoading.value = true;
  adminFeatureFlagsError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/feature-flags/${encodeURIComponent(flag.key)}/overrides/${encodeURIComponent(organizationId)}`), {
      method: "DELETE",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { flag?: AdminFeatureFlag; error?: string };
    if (!response.ok || !payload.flag) throw new Error(payload.error ?? "Could not remove the tenant override.");
    const index = adminFeatureFlags.value.findIndex((candidate) => candidate.key === flag.key);
    if (index >= 0) adminFeatureFlags.value.splice(index, 1, payload.flag);
    adminFeatureFlagsMessage.value = "Tenant override removed.";
  } catch (error) {
    adminFeatureFlagsError.value = error instanceof Error ? error.message : "Could not remove the tenant override.";
  } finally {
    adminFeatureFlagsLoading.value = false;
  }
}

function adminWorkflowStats(action: AdminActionRegistryItem) {
  const steps = action.steps ?? [];
  return {
    transitions: steps.filter((step) => Boolean(step.nextStepId || (step.branches?.length ?? 0))).length,
    providerCalls: steps.filter((step) => step.type === "lookup" || step.type === "api_action" || step.type === "generate_link").length,
    conditions: steps.filter((step) => step.type === "condition" || step.type === "decision" || Boolean(step.branches?.length)).length,
    retries: steps.filter((step) => Boolean(step.config?.retryCount || step.config?.failureBehavior === "retry")).length,
    failurePaths: steps.filter((step) => Boolean(step.config?.failureBehavior) || step.type === "handoff").length,
  };
}

async function loadAdminWorkflowAudit(action: AdminActionRegistryItem) {
  if (adminWorkflowAuditLoading.value) return;
  if (adminWorkflowDetailsActionId.value === action.id) {
    adminWorkflowDetailsActionId.value = "";
    return;
  }
  adminWorkflowDetailsActionId.value = action.id;
  adminWorkflowAuditLoading.value = true;
  adminWorkflowAuditError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/action-registry/${encodeURIComponent(action.id)}/audit`), { headers: ownerHeaders() });
    const payload = await response.json() as { audit?: AdminWorkflowAuditItem[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the workflow trace.");
    adminWorkflowAudit.value = payload.audit ?? [];
  } catch (error) {
    adminWorkflowAudit.value = [];
    adminWorkflowAuditError.value = error instanceof Error ? error.message : "Could not load the workflow trace.";
  } finally {
    adminWorkflowAuditLoading.value = false;
  }
}

async function replayAdminWorkflow(action: AdminActionRegistryItem) {
  if (!adminWorkflowReplayConversationId.value.trim() || !adminWorkflowReplayQuestion.value.trim() || adminWorkflowReplayLoading.value) return;
  adminWorkflowReplayLoading.value = true;
  adminWorkflowReplayError.value = "";
  adminWorkflowReplayResult.value = null;
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/workflow-replay"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        businessSlug: action.businessSlug,
        conversationId: adminWorkflowReplayConversationId.value.trim(),
        actionId: action.id,
        question: adminWorkflowReplayQuestion.value.trim(),
      }),
    });
    const payload = await response.json() as Record<string, unknown> & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not replay this workflow turn.");
    adminWorkflowReplayResult.value = payload;
  } catch (error) {
    adminWorkflowReplayError.value = error instanceof Error ? error.message : "Could not replay this workflow turn.";
  } finally {
    adminWorkflowReplayLoading.value = false;
  }
}

async function updateAdminRegistryAction(action: AdminActionRegistryItem, enabled: boolean) {
  if (adminActionRegistryLoading.value) return;
  adminActionRegistryLoading.value = true;
  adminActionRegistryError.value = "";
  adminActionRegistryMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/action-registry/${encodeURIComponent(action.id)}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        enabled,
        status: enabled ? (action.origin === "discovered" ? "approved" : "active") : "disabled",
        reason: enabled ? null : "owner_override",
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update this action.");
    action.enabled = enabled;
    action.lifecycleStatus = enabled ? (action.origin === "discovered" ? "approved" : "active") : "disabled";
    action.reviewReason = enabled ? null : "owner_override";
    if (!enabled) action.isPrimary = false;
    adminActionRegistryMessage.value = enabled ? `${action.name} is enabled.` : `${action.name} is disabled.`;
  } catch (error) {
    adminActionRegistryError.value = error instanceof Error ? error.message : "Could not update this action.";
    await loadAdminActionRegistry();
  } finally {
    adminActionRegistryLoading.value = false;
  }
}

async function setAdminPrimaryAction(action: AdminActionRegistryItem) {
  if (adminActionRegistryLoading.value || !action.enabled) return;
  const wasPrimary = action.isPrimary;
  adminActionRegistryLoading.value = true;
  adminActionRegistryError.value = "";
  adminActionRegistryMessage.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/admin/businesses/${encodeURIComponent(action.businessId)}/primary-action`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ actionId: wasPrimary ? null : action.id }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not update the primary action.");
    adminActionRegistry.value.forEach((candidate) => {
      if (candidate.businessId === action.businessId) candidate.isPrimary = !wasPrimary && candidate.id === action.id;
    });
    adminActionRegistryMessage.value = wasPrimary ? "Primary action cleared." : `${action.name} is now the primary conversion action.`;
  } catch (error) {
    adminActionRegistryError.value = error instanceof Error ? error.message : "Could not update the primary action.";
    await loadAdminActionRegistry();
  } finally {
    adminActionRegistryLoading.value = false;
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

async function loadAdminRequestMetrics() {
  if (!authSnapshot.value || adminRequestMetricsLoading.value) return;
  adminRequestMetricsLoading.value = true;
  adminRequestMetricsError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/request-metrics?hours=24"), { headers: ownerHeaders() }, { globalLoading: false });
    const payload = await response.json() as AdminRequestMetrics & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load request metrics.");
    adminRequestMetrics.value = payload;
  } catch (error) {
    adminRequestMetricsError.value = error instanceof Error ? error.message : "Could not load request metrics.";
  } finally {
    adminRequestMetricsLoading.value = false;
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

async function loadAdminRecovery() {
  if (!authSnapshot.value || adminRecoveryLoading.value) return;
  adminRecoveryLoading.value = true;
  adminRecoveryError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/admin/onboarding-recovery?limit=500"), { headers: ownerHeaders() });
    const payload = await response.json() as AdminRecoveryPayload & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load onboarding recovery data.");
    adminRecovery.value = payload;
  } catch (error) {
    adminRecoveryError.value = error instanceof Error ? error.message : "Could not load onboarding recovery data.";
  } finally {
    adminRecoveryLoading.value = false;
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
  closeMobileNav();
  const nextRoute = parseRoute();
  route.value = nextRoute;
  void runWithGlobalLoading(() => applyRouteState(nextRoute));
}

async function restoreAuthenticatedSession(user: { uid?: string; emailVerified?: boolean; getIdToken(): Promise<string> } | null) {
  if (!user) {
    restoredFirebaseUserId = "";
    restoringFirebaseUserId = "";
    firebaseToken.value = "";
    authSnapshot.value = null;
    isSuperAdmin.value = false;
    resetMixpanelUser();
    authInitializing.value = false;
    if (route.value.kind === "auth") openAuth(route.value.mode, false, route.value.returnTo);
    else if (isProtectedRoute()) redirectToSignIn();
    return;
  }

  const userId = user.uid ?? "";
  const sameRestoredSession = Boolean(userId && userId === restoredFirebaseUserId && authSnapshot.value);
  if (sameRestoredSession && user.emailVerified === authSnapshot.value?.user.emailVerified) {
    // Token changes are expected during a long-lived browser session. Keep the
    // current workspace and conversation mounted; only replace the API token.
    firebaseToken.value = await user.getIdToken();
    authInitializing.value = false;
    return;
  }
  if (userId && userId === restoringFirebaseUserId) return;
  restoringFirebaseUserId = userId;

  try {
    firebaseToken.value = await user.getIdToken();
    const snapshot = await currentAuthSnapshot();
    if (!snapshot) throw new Error("Could not restore the FrontDeskWise account.");
    authSnapshot.value = snapshot;
    firebaseToken.value = await currentFirebaseToken();
    restoredFirebaseUserId = userId || snapshot.user.id;
    identifyMixpanelUser(snapshot.user.id, {
      organization_id: snapshot.activeOrganizationId ?? undefined,
      user_role: snapshot.organizations[0]?.role,
      plan: snapshot.organizations[0]?.billing.planKey,
    });
    if (snapshot.user.emailVerified) {
      trackProductEventOnce(`email-verified:${snapshot.user.id}`, MIXPANEL_EVENTS.EMAIL_VERIFIED, { method: "restored_session" });
    }
    const returnTo = route.value.kind === "auth" ? route.value.returnTo : undefined;
    await settleAuthenticatedSession(returnTo);
    authModalOpen.value = false;
    sessionRedirecting = false;
  } catch (error) {
    if (isFirebaseSessionInvalid(error)) {
      authInitializing.value = false;
      redirectToSignIn();
      return;
    }
    // Keep Firebase's session intact. A temporary API/CORS/network failure
    // must not sign the user out or erase their local identity.
    authError.value = friendlyAuthError(error, "Could not restore the FrontDeskWise session.");
  } finally {
    if (restoringFirebaseUserId === userId) restoringFirebaseUserId = "";
    authInitializing.value = false;
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
    const payload = await response.json() as { url?: string | null; subscriptionUpdated?: boolean; planKey?: string; changeType?: "upgrade" | "downgrade" | "none"; effectiveAt?: string | null; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "This plan is not ready for checkout yet.");
    if (payload.subscriptionUpdated) {
      if (payload.changeType === "downgrade") {
        await loadBilling(false);
        billingFlow.value = "complete";
        billingMessage.value = `Your ${billingSnapshot.value?.billing.plan.displayName ?? "current"} plan stays active until ${formatBillingDate(payload.effectiveAt ?? billingSnapshot.value?.billing.pendingPlanChangeAt ?? null)}. The change to ${formatPlanLabel(payload.planKey ?? plan.key)} is scheduled.`;
        return;
      }
      billingFlow.value = "processing";
      billingMessage.value = "Your plan change was received. Confirming the updated subscription…";
      const settled = await waitForBillingState(payload.planKey ?? plan.key);
      if (settled) {
        billingSuccessRunKey = "";
        commitRoute({ kind: "billing-success" }, true);
      } else {
        billingFlow.value = "pending";
        billingMessage.value = "Your plan change was received. We’re finishing the update; refresh in a moment.";
      }
      return;
    }
    if (!payload.url) throw new Error(payload.error ?? "This plan is not ready for checkout yet.");
    window.location.assign(payload.url);
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not start checkout.";
  } finally {
    billingLoading.value = false;
  }
}

async function resumeBilling() {
  if (!authSnapshot.value || billingLoading.value) return;
  billingLoading.value = true;
  billingError.value = "";
  try {
    const response = await trackedFetch(apiUrl("/api/v1/billing/resume"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ organizationId: authSnapshot.value.activeOrganizationId }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not resume the current plan.");
    await loadBilling(false);
    billingMessage.value = "Your current plan will continue without a scheduled change.";
  } catch (error) {
    billingError.value = error instanceof Error ? error.message : "Could not resume the current plan.";
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
  if (integrationLoading.value) return;
  if (integrationProvider.value === "hubspot" && !integrationManualMode.value) {
    integrationLoading.value = true;
    integrationError.value = "";
    integrationMessage.value = "";
    try {
      const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/hubspot/connect`), {
        method: "POST",
        headers: ownerHeaders(),
      });
      const payload = await response.json() as { authorizationUrl?: string; error?: string };
      if (!response.ok || !payload.authorizationUrl) throw new Error(payload.error ?? "Could not start HubSpot OAuth.");
      window.location.assign(payload.authorizationUrl);
    } catch (error) {
      integrationError.value = error instanceof Error ? error.message : "Could not start HubSpot OAuth.";
      integrationLoading.value = false;
    }
    return;
  }
  if ((integrationProvider.value === "webhook" ? !integrationWebhookUrl.value.trim() : !integrationAccessToken.value.trim())) return;
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
          : integrationProvider.value === "jackrabbit"
            ? { apiToken: integrationAccessToken.value }
            : { accessToken: integrationAccessToken.value }),
      }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not save this integration.");
    trackProductEvent(MIXPANEL_EVENTS.INTEGRATION_CONNECTED, {
      provider: integrationProvider.value,
      source: "owner_settings",
      success: true,
    });
    integrationSigningSecret.value = "";
    integrationAccessToken.value = "";
    integrationMessage.value = integrationProvider.value === "jackrabbit"
      ? "Connected securely · Jackrabbit account detected"
      : "Saved securely · test the connection to activate delivery";
    await loadIntegrations();
  } catch (error) {
    integrationError.value = error instanceof Error ? error.message : "Could not save this integration.";
  } finally {
    integrationLoading.value = false;
  }
}

function openProviderConnectionDrawer(mode: "openapi" | "manual" = "openapi") {
  providerConnectionMode.value = mode;
  providerConnectionName.value = "";
  providerConnectionBaseUrl.value = "";
  providerConnectionSpecUrl.value = "";
  providerConnectionSpecJson.value = null;
  providerConnectionAuthType.value = "bearer_token";
  providerConnectionSecret.value = "";
  providerConnectionBasicUsername.value = "";
  providerConnectionBasicPassword.value = "";
  providerConnectionApiKeyHeader.value = "x-api-key";
  providerManualCapabilityKey.value = "";
  providerManualCapabilityName.value = "";
  providerManualCapabilityMethod.value = "GET";
  providerManualCapabilityPath.value = "";
  providerConnectionError.value = "";
  providerConnectionMessage.value = "";
  providerConnectionDrawerOpen.value = true;
}

function closeProviderConnectionDrawer() {
  providerConnectionDrawerOpen.value = false;
  providerConnectionSecret.value = "";
  providerConnectionBasicUsername.value = "";
  providerConnectionBasicPassword.value = "";
  providerConnectionSpecJson.value = null;
  providerConnectionError.value = "";
}

async function handleProviderSpecFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  providerConnectionError.value = "";
  try {
    const parsed = JSON.parse(await file.text()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("The selected file is not an OpenAPI JSON document.");
    providerConnectionSpecJson.value = parsed as Record<string, unknown>;
    providerConnectionSpecUrl.value = "";
    providerConnectionMessage.value = `${file.name} ready to import`;
  } catch (error) {
    providerConnectionSpecJson.value = null;
    providerConnectionError.value = error instanceof Error ? error.message : "Could not read that OpenAPI file.";
  } finally {
    input.value = "";
  }
}

async function connectProviderConnection() {
  if (providerConnectionLoading.value) return;
  if (!providerConnectionName.value.trim() || !providerConnectionBaseUrl.value.trim()) {
    providerConnectionError.value = "Add a connection name and base URL first.";
    return;
  }
  if (providerConnectionMode.value === "openapi" && !providerConnectionSpecUrl.value.trim() && !providerConnectionSpecJson.value) {
    providerConnectionError.value = "Import an OpenAPI JSON file or paste its public URL.";
    return;
  }
  if (providerConnectionMode.value === "manual" && (!providerManualCapabilityKey.value.trim() || !providerManualCapabilityPath.value.trim())) {
    providerConnectionError.value = "Add a capability name and API path first.";
    return;
  }
  providerConnectionLoading.value = true;
  providerConnectionError.value = "";
  providerConnectionMessage.value = "";
  const auth = providerConnectionAuthType.value === "none"
    ? { type: "none" }
    : providerConnectionAuthType.value === "api_key"
      ? { type: "api_key", apiKey: providerConnectionSecret.value, headerName: providerConnectionApiKeyHeader.value || "x-api-key" }
      : providerConnectionAuthType.value === "basic"
        ? { type: "basic", username: providerConnectionBasicUsername.value, password: providerConnectionBasicPassword.value }
        : { type: "bearer_token", token: providerConnectionSecret.value };
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/provider-connections`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({
        providerKey: "custom_api",
        displayName: providerConnectionName.value.trim(),
        baseUrl: providerConnectionBaseUrl.value.trim(),
        auth,
        ...(providerConnectionSpecUrl.value.trim() ? { specUrl: providerConnectionSpecUrl.value.trim() } : {}),
        ...(providerConnectionSpecJson.value ? { spec: providerConnectionSpecJson.value } : {}),
        ...(providerConnectionMode.value === "manual" ? {
          capabilities: [{
            key: providerManualCapabilityKey.value.trim(),
            name: providerManualCapabilityName.value.trim() || providerManualCapabilityKey.value.trim(),
            method: providerManualCapabilityMethod.value,
            path: providerManualCapabilityPath.value.trim(),
          }],
        } : {}),
      }),
    });
    const payload = await response.json() as { connection?: ProviderConnection; error?: string };
    if (!response.ok || !payload.connection) throw new Error(payload.error ?? "Could not connect this API.");
    providerConnectionSecret.value = "";
    providerConnectionMessage.value = `${payload.connection.displayName} connected · review the discovered capabilities below`;
    await loadProviderConnections();
    closeProviderConnectionDrawer();
  } catch (error) {
    providerConnectionError.value = error instanceof Error ? error.message : "Could not connect this API.";
  } finally {
    providerConnectionLoading.value = false;
  }
}

function providerCapabilityRequiredFields(capability: ProviderCapability): string[] {
  const required = capability.inputSchema.required;
  return Array.isArray(required) ? required.filter((value): value is string => typeof value === "string") : [];
}

function providerCapabilityPermissionLabel(capability: ProviderCapability): string {
  if (capability.type === "WRITE") {
    return [
      "WRITE",
      capability.requiresVerifiedCustomer ? "verified customer" : "no identity gate",
      capability.requiresConfirmation ? "confirmation" : "no confirmation",
    ].join(" · ");
  }
  return `READ · automatic · fallback ${formatLabel(capability.fallbackBehavior || "capture_request")}`;
}

async function updateProviderCapability(connection: ProviderConnection, capability: ProviderCapability, enabled: boolean) {
  if (providerConnectionLoading.value) return;
  providerConnectionLoading.value = true;
  providerConnectionError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/provider-connections/${connection.id}/capabilities/${capability.id}`), {
      method: "PATCH",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ enabled, status: enabled ? "approved" : "disabled" }),
    });
    const payload = await response.json() as { capability?: ProviderCapability; error?: string };
    if (!response.ok || !payload.capability) throw new Error(payload.error ?? "Could not update this capability.");
    const index = connection.capabilities.findIndex((item) => item.id === capability.id);
    if (index >= 0) connection.capabilities.splice(index, 1, payload.capability);
    providerConnectionMessage.value = enabled ? `${capability.name} is approved for workflows.` : `${capability.name} is disabled.`;
  } catch (error) {
    providerConnectionError.value = error instanceof Error ? error.message : "Could not update this capability.";
  } finally {
    providerConnectionLoading.value = false;
  }
}

async function testProviderCapability(connection: ProviderConnection, capability: ProviderCapability) {
  if (providerConnectionLoading.value) return;
  providerConnectionLoading.value = true;
  providerConnectionError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/provider-connections/${connection.id}/capabilities/${capability.id}/test`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ input: {} }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "The capability test failed.");
    connection.connectionStatus = "active";
    providerConnectionMessage.value = `${capability.name} responded successfully.`;
    await loadProviderConnections();
  } catch (error) {
    providerConnectionError.value = error instanceof Error ? error.message : "The capability test failed.";
    await loadProviderConnections();
  } finally {
    providerConnectionLoading.value = false;
  }
}

function openNativeIntegrationForm(provider: "webhook" | "hubspot" | "jackrabbit") {
  integrationProvider.value = provider;
  integrationDisplayName.value = provider === "hubspot" ? "HubSpot" : provider === "jackrabbit" ? "Jackrabbit" : "Automation webhook";
  integrationAccessToken.value = "";
  integrationManualMode.value = false;
  integrationError.value = "";
  integrationMessage.value = "";
  nativeIntegrationFormOpen.value = true;
}

function openIntegrationSetup(provider: "webhook" | "hubspot" | "jackrabbit") {
  navigateToWorkspaceView("connections");
  openNativeIntegrationForm(provider);
}

function closeNativeIntegrationForm() {
  nativeIntegrationFormOpen.value = false;
  integrationManualMode.value = false;
  integrationAccessToken.value = "";
  integrationSigningSecret.value = "";
  integrationWebhookUrl.value = "";
  integrationError.value = "";
  integrationMessage.value = "";
}

function mcpHasTool(connection: McpConnection | null, patterns: string[]): boolean {
  if (!connection) return false;
  return connection.tools.some((tool) => {
    const searchable = `${tool.name} ${tool.title ?? ""} ${tool.description ?? ""}`.toLowerCase();
    return patterns.some((pattern) => searchable.includes(pattern));
  });
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

function openMcpConnectionDrawer() {
  mcpError.value = "";
  mcpMessage.value = "";
  mcpDrawerOpen.value = true;
}

function closeMcpConnectionDrawer() {
  mcpDrawerOpen.value = false;
  mcpBearerToken.value = "";
  mcpError.value = "";
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
    advancedAiConnectionsOpen.value = true;
    mcpPermissionsOpen.value = null;
    mcpDrawerOpen.value = false;
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
    if (payload.verified || payload.verification?.loadCount) {
      trackProductEventOnce(`widget-installed:${demoSlug.value}`, MIXPANEL_EVENTS.WIDGET_INSTALLED, {
        source: "owner_install",
        success: true,
      });
    }
    widgetVerificationMessage.value = payload.message ?? (payload.verified ? "Widget detected on the website." : "No widget load detected yet.");
    await refreshWorkspaceSummary(false);
  } catch (error) {
    widgetVerificationMessage.value = error instanceof Error ? error.message : "Could not verify the widget installation.";
  } finally {
    widgetVerificationLoading.value = false;
  }
}

function testMessageId(role: TestConversationMessage["role"]): string {
  return `test-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function invalidateTestRequest() {
  testRequestGeneration += 1;
  isAsking.value = false;
}

function actionFormValues(action: TestConversationAction | null | undefined): Record<string, string> {
  return Object.fromEntries((action?.form?.fields ?? []).map((field) => [field.key, field.value ?? ""]));
}

function appendTestAssistantMessage(payload: TestAnswerPayload): TestConversationMessage {
  const message: TestConversationMessage = {
    id: testMessageId("assistant"),
    role: "assistant",
    content: payload.answer ?? "",
    grounded: Boolean(payload.grounded),
    citations: payload.citations ?? [],
    quickActions: payload.quickActions ?? [],
    primaryCta: payload.primaryCta ?? null,
    action: payload.action ?? null,
    formValues: actionFormValues(payload.action),
  };
  testMessages.value.push(message);
  return message;
}

async function askQuestion() {
  const question = testQuestion.value.trim();
  if (!question || isAsking.value) return;
  const requestGeneration = ++testRequestGeneration;
  isAsking.value = true;
  testQuestion.value = "";
  testAnswer.value = "";
  answerSource.value = "";
  answerConfidence.value = 0;
  answerConfidenceBand.value = "low";
  answerRetrievalMode.value = "";
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
  testMessages.value.push({
    id: testMessageId("user"),
    role: "user",
    content: question,
    grounded: false,
    citations: [],
    quickActions: [],
    action: null,
    formValues: {},
  });
  try {
    if (!publicDemoMode.value && !conversationId.value) {
      const conversationResponse = await conversationFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations`), {
        method: "POST",
        headers: { "content-type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ sessionId: `dashboard-${Date.now()}` }),
      });
      const conversationPayload = await conversationResponse.json() as { conversationId?: string };
      if (requestGeneration !== testRequestGeneration) return;
      if (!conversationResponse.ok || !conversationPayload.conversationId) throw new Error("Could not start a test conversation.");
      conversationId.value = conversationPayload.conversationId;
      trackProductEventOnce(`conversation-started:${conversationId.value}`, MIXPANEL_EVENTS.CONVERSATION_STARTED, {
        source: "owner_test",
        conversation_status: "AI_ACTIVE",
      });
    }
    if (publicDemoMode.value) {
      trackProductEventOnce(`public-conversation-started:${demoSlug.value}`, MIXPANEL_EVENTS.CONVERSATION_STARTED, {
        source: "public_demo",
        conversation_status: "AI_ACTIVE",
        is_public_demo: true,
      });
    }
    const endpoint = publicDemoMode.value
      ? `/api/v1/demo/${demoSlug.value}/public/test`
      : `/api/v1/demo/${demoSlug.value}/conversations/${conversationId.value}/messages`;
    const response = await conversationFetch(apiUrl(endpoint), {
      method: "POST",
      headers: { "content-type": "application/json", ...(publicDemoMode.value ? {} : ownerHeaders()) },
      body: JSON.stringify({ question }),
    });
    const payload = await response.json() as TestAnswerPayload;
    if (requestGeneration !== testRequestGeneration) return;
    if (!response.ok) throw new Error(payload.error ?? "Could not answer that question.");
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
    answerConfidence.value = payload.confidenceScore ?? 0;
    answerConfidenceBand.value = payload.confidenceBand ?? "low";
    answerRetrievalMode.value = payload.retrieval?.mode ?? "";
    answerCitations.value = payload.citations ?? [];
    answerAction.value = payload.action ?? null;
    answerFormValues.value = actionFormValues(payload.action);
    answerSource.value = payload.citations?.[0]?.url ?? "";
    appendTestAssistantMessage(payload);
    if (payload.primaryCta) {
      trackProductEvent(MIXPANEL_EVENTS.PRIMARY_CTA_SHOWN, {
        action_id: payload.primaryCta.actionId,
        action_key: payload.primaryCta.key,
        execution_mode: payload.primaryCta.executionMode,
        tracking_key: payload.primaryCta.trackingKey,
        cta_source: "agent_test",
      });
    }
    // The answer is already complete at this point. Stop the chat-local
    // loading state before refreshing owner-only summaries so the preview
    // cannot show a finished answer together with a stale "Thinking…" state.
    isAsking.value = false;
    if (!publicDemoMode.value) void refreshWorkspaceSummary(false);
  } catch (error) {
    if (requestGeneration !== testRequestGeneration) return;
    const message = error instanceof Error ? error.message : "Could not answer that question.";
    testAnswer.value = message;
    answerGrounded.value = false;
    appendTestAssistantMessage({ answer: message, grounded: false, citations: [] });
  } finally {
    if (requestGeneration === testRequestGeneration) isAsking.value = false;
  }
}

async function submitActionForm(messageId: string, actionId: string, values: Record<string, string>) {
  if (!conversationId.value || isAsking.value) return;
  const requestGeneration = ++testRequestGeneration;
  isAsking.value = true;
  try {
    const response = await conversationFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversationId.value}/actions/${actionId}/submit`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ values }),
    });
    const payload = await response.json() as TestAnswerPayload;
    if (requestGeneration !== testRequestGeneration) return;
    if (!response.ok) throw new Error(payload.error ?? "Could not submit this request.");
    const sourceMessage = testMessages.value.find((message) => message.id === messageId);
    if (sourceMessage) {
      sourceMessage.action = payload.action ?? null;
      sourceMessage.formValues = actionFormValues(payload.action);
    }
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
    answerCitations.value = payload.citations ?? [];
    answerAction.value = payload.action ?? null;
    answerFormValues.value = actionFormValues(payload.action);
    appendTestAssistantMessage(payload);
    if (payload.action?.status === "completed") {
      trackProductEvent(MIXPANEL_EVENTS.WORKFLOW_TEST_PASSED, {
        action_id: actionId,
        workflow_id: actionId,
        source: "owner_test",
        success: true,
      });
      trackProductEvent(MIXPANEL_EVENTS.CTA_CONVERSION_COMPLETED, {
        action_id: actionId,
        cta_source: "agent_test",
        success: true,
      });
    }
    isAsking.value = false;
    void Promise.all([refreshWorkspaceSummary(false), loadLeads(false)]);
  } catch (error) {
    if (requestGeneration !== testRequestGeneration) return;
    leadsError.value = error instanceof Error ? error.message : "Could not submit this request.";
  } finally {
    if (requestGeneration === testRequestGeneration) isAsking.value = false;
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
    await Promise.all([loadLeads(), refreshWorkspaceSummary()]);
    window.setTimeout(() => (leadSavedMessage.value = ""), 2600);
  } catch (error) {
    leadsError.value = error instanceof Error ? error.message : "Could not capture that lead.";
  }
}

function agentConfigRequestBody(nextModel: AgentSaveModel, publish = false): Record<string, unknown> {
  return {
    assistantName: nextModel.assistantName,
    welcomeMessage: nextModel.welcomeMessage,
    tone: nextModel.tone,
    customToneInstructions: nextModel.customToneInstructions,
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
    proactiveEnabled: nextModel.proactiveEnabled,
    proactiveDelaySeconds: nextModel.proactiveDelaySeconds,
    proactiveMessage: nextModel.proactiveMessage,
    proactiveTriggers: nextModel.proactiveTriggers,
    proactiveBehavior: nextModel.proactiveBehavior,
    proactiveFrequency: nextModel.proactiveFrequency,
    requireLeadConsent: nextModel.requireLeadConsent,
    privacyNoticeUrl: nextModel.privacyNoticeUrl || null,
    retentionDays: nextModel.retentionDays,
    showAiDisclosure: nextModel.showAiDisclosure,
    citationVisibility: nextModel.citationVisibility,
    fallbackContacts: {
      phone: nextModel.fallbackPhone || null,
      email: nextModel.fallbackEmail || null,
      url: nextModel.fallbackContactUrl || null,
    },
    ...(publish ? { publish: true } : {}),
    ...(publish ? { tested: setupSteps.value.some((step) => step.id === "agent_tested" && step.complete) || testMessages.value.some((message) => message.role === "user" && message.content.trim()) } : {}),
  };
}

async function saveAgent(...args: Array<AgentSaveModel | Event>) {
  if (!requireAccountForPublish()) return;
  const model = args[0];
  const nextModel = model && !(model instanceof Event) ? model : agentModel.value;
  const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/agent-config`), {
    method: "POST",
    headers: { "content-type": "application/json", ...ownerHeaders() },
    body: JSON.stringify(agentConfigRequestBody(nextModel)),
  });
  const payload = await response.json() as { agent?: WorkspacePayload["agent"]; publishing?: AgentPublishing; error?: string };
  if (payload.publishing) agentPublishing.value = payload.publishing;
  savedMessage.value = response.ok ? "Saved · assistant settings updated" : "Could not save the assistant settings";
  window.setTimeout(() => (savedMessage.value = ""), 2600);
}

async function publishAgent(model: AgentSaveModel): Promise<void> {
  if (!requireAccountForPublish() || agentPublishingLoading.value) return;
  agentPublishingLoading.value = true;
  agentPublishingError.value = "";
  try {
    const response = await trackedFetch(apiUrl(`/api/v1/demo/${demoSlug.value}/agent-config`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify(agentConfigRequestBody(model, true)),
    });
    const payload = await response.json() as { agent?: WorkspacePayload["agent"]; publishing?: AgentPublishing; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not publish the AI front desk.");
    if (payload.publishing) agentPublishing.value = payload.publishing;
    trackProductEvent(MIXPANEL_EVENTS.WORKFLOW_PUBLISHED, {
      status: payload.publishing?.status ?? "LIVE",
      publication_version: payload.publishing?.configVersion ?? undefined,
      success: true,
    });
    await refreshWorkspaceSummary(false);
    notifySuccess("Your AI front desk is live.");
  } catch (error) {
    agentPublishingError.value = error instanceof Error ? error.message : "Could not publish the AI front desk.";
    notifyError(error, "Could not publish the AI front desk.");
  } finally {
    agentPublishingLoading.value = false;
  }
}

function askAgentQuestion(question: string) {
  testQuestion.value = question;
  void askQuestion();
}

function submitAgentAction(payload: { messageId: string; actionId: string; values: Record<string, string> }) {
  void submitActionForm(payload.messageId, payload.actionId, payload.values);
}

function resetAgentConversation() {
  invalidateTestRequest();
  conversationId.value = "";
  testQuestion.value = "";
  routedTestQuestion.value = "";
  testMessages.value = [];
  testAnswer.value = "";
  answerGrounded.value = false;
  answerCitations.value = [];
  answerAction.value = null;
  answerFormValues.value = {};
}

watch(() => setupDismissalKey.value, hydrateSetupDismissal, { immediate: true });

watch([knowledgeSourceSearch, knowledgeSourceTypeFilter, knowledgeSourceStatusFilter], () => {
  knowledgeSourcePage.value = 1;
});

watch([knowledgeGapFilter, knowledgeGapSort, knowledgeGapSearch, knowledgeGapIntentFilter, knowledgeGapFrequencyFilter, knowledgeGapRange], () => {
  knowledgeGapPage.value = 1;
});

watch(adminSection, (nextSection, previousSection) => {
  if (nextSection === previousSection || route.value.kind !== "platform" || route.value.section === nextSection) return;
  if (nextSection === "action-registry") void loadAdminActionRegistry();
  if (nextSection === "certification") void loadAdminCertification();
  if (nextSection === "experience-signals") void loadAdminExperienceSignals();
  if (nextSection === "feature-flags") void loadAdminFeatureFlags();
  if (nextSection === "recovery") void loadAdminRecovery();
  if (nextSection === "support") void loadAdminSupportCases();
  if (nextSection === "operations") void loadAdminRequestMetrics();
  commitRoute(platformRoute(nextSection));
});

watch(view, (nextView, previousView) => {
  if (previousView === "agent" && nextView !== "agent") invalidateTestRequest();
  if (nextView === "overview") consumeBillingSuccessToast();
  if (nextView === "support") void loadSupport();
  if (previousView === "inbox" && nextView !== "inbox") stopInboxPolling();
  if (nextView === "inbox") { startInboxPolling(); void loadInbox(); void loadNotifications(); if (canManageTeam.value) void loadTeam(); }
  if (nextView === "team") { settingsTab.value = "team"; void loadTeam(); }
  if (nextView === "knowledge") {
    void loadKnowledge();
    void loadDocuments();
  }
  if (nextView === "agent") { void loadWidgetInstall(false); }
  if (nextView === "leads") void loadLeads();
  if (nextView === "actions") {
    if (previousView !== "actions") selectAction(null);
    void loadActions();
    void loadIntegrations();
    void loadProviderConnections();
  }
  if (nextView === "workflows") {
    void loadActions();
    void loadIntegrations();
    void loadProviderConnections();
  }
  if (nextView === "connections") {
    settingsTab.value = "integrations";
    void loadIntegrations();
    void loadProviderConnections();
    void loadMcpConnections();
  }
  if (nextView === "billing") { settingsTab.value = "billing"; void loadBilling(); }
  if (nextView === "settings" && settingsTab.value === "notifications") { void loadNotifications(); void loadNotificationPreferences(); void loadHandoffNotificationSettings(); }
  if (nextView === "settings" && !["general", "verification", "notifications"].includes(settingsTab.value)) settingsTab.value = "general";
  if (nextView === "admin") {
    void loadAdminOrganizations();
    void loadAdminActionRegistry();
    void loadAdminCertification();
    void loadAdminExperienceSignals();
    void loadAdminUsers();
    void loadAdminDemoRequests();
    void loadAdminInstallationSupport();
    void loadAdminMessaging();
    void loadAdminRecovery();
    void loadAdminHealth();
    void loadAdminRequestMetrics();
  }
});

watch(settingsTab, (nextTab) => {
  if (nextTab === "notifications") {
    void loadNotifications();
    void loadNotificationPreferences();
    void loadHandoffNotificationSettings();
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
  initializeMixpanel();
  pwaInstalled.value = isStandalonePwa();
  browserNotificationPermission.value = notificationPermission();
  stopPwa = initializePwa({
    onInstallAvailable: (available) => {
      pwaInstallAvailable.value = available;
      if (available) trackProductEventOnce("operator-pwa-install-prompt", MIXPANEL_EVENTS.PWA_INSTALL_PROMPT_SHOWN, { platform: "browser" });
    },
    onInstalled: () => {
      pwaInstalled.value = true;
      trackProductEvent(MIXPANEL_EVENTS.PWA_INSTALLED, { platform: "browser", success: true });
    },
    onPushMessage: (payload) => {
      void loadNotifications();
      if (payload.conversationId && view.value === "inbox") void loadInbox(inboxPage.value, { globalLoading: false, refreshSelected: true });
    },
  });
  if (view.value === "home" || route.value.kind === "marketing") {
    trackProductEventOnce("marketing-primary-cta-shown", MIXPANEL_EVENTS.PRIMARY_CTA_SHOWN, { cta_source: "marketing" });
  }
  updateDocumentMetadata();
  void consumeDemoLink();
  if (view.value === "inbox") startInboxPolling();
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", handleRouteChange);
    window.addEventListener("keydown", handleMobileNavKeydown);
    window.addEventListener("resize", handleViewportChange);
    window.addEventListener("orientationchange", handleViewportChange);
    document.addEventListener("visibilitychange", handleInboxVisibilityChange);
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      landingHeroTimer = window.setInterval(() => {
        if (view.value === "home") heroDemoStep.value = (heroDemoStep.value + 1) % landingDemoSteps.length;
      }, 4200);
    }
    if (!firebaseAuthConfigured()) {
      authInitializing.value = false;
      void runWithGlobalLoading(() => applyRouteState(route.value));
    } else {
      stopFirebaseObserver = observeFirebaseUser((user) => {
        void runWithGlobalLoading(() => restoreAuthenticatedSession(user));
      });
    }
  }
});

onBeforeUnmount(() => {
  stopPwa?.();
  stopFirebaseObserver?.();
  stopGenerationProgress();
  stopInboxPolling();
  if (landingDemoTimer !== null) window.clearTimeout(landingDemoTimer);
  if (landingHeroTimer !== null) window.clearInterval(landingHeroTimer);
  if (typeof document !== "undefined") document.body.style.overflow = previousBodyOverflow;
  if (typeof window !== "undefined") {
    window.removeEventListener("popstate", handleRouteChange);
    window.removeEventListener("keydown", handleMobileNavKeydown);
    window.removeEventListener("resize", handleViewportChange);
    window.removeEventListener("orientationchange", handleViewportChange);
    document.removeEventListener("visibilitychange", handleInboxVisibilityChange);
  }
});

function openHome() {
  commitRoute({ kind: "landing" });
}

function openPartnerSection(section: "overview" | "clients" | "referrals" | "settings") {
  commitRoute({ kind: "partner", section });
}

function startMarketingDemo() {
  trackProductEvent(MIXPANEL_EVENTS.PRIMARY_CTA_CLICKED, { cta_source: "marketing", entrypoint: "start_demo" });
  if (route.value.kind === "marketing" && route.value.page === "partners") {
    openAuth("signup", true, "/partner");
    return;
  }
  commitRoute({ kind: "landing" });
  window.setTimeout(() => document.getElementById("final-cta")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
}
</script>

<template>
  <main class="app-shell" :aria-busy="globalLoading || authLoading">
    <section v-if="authInitializing" class="auth-initializing" role="status" aria-live="polite">
      <div class="auth-initializing-card"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><p>Restoring your workspace…</p></div>
    </section>
    <template v-else>
    <section v-if="routeIsNotFound" class="not-found-shell">
      <div class="not-found-card"><p class="eyebrow">404</p><h1>That page is not available.</h1><p>Check the address or return to FrontDeskWise.</p><button class="primary-button" type="button" @click="openHome">Back to home</button></div>
    </section>
    <section v-else-if="route.kind === 'auth-reset'" class="auth-reset-shell">
      <div class="auth-reset-card">
        <div class="auth-reset-brand"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></div>
        <template v-if="resetComplete">
          <div class="auth-reset-success-icon"><CircleCheck :size="28" :stroke-width="2" aria-hidden="true" /></div>
          <p class="eyebrow">Account recovery</p>
          <h1>Password updated</h1>
          <p>Your password has been changed successfully.</p>
          <button class="primary-button auth-submit" type="button" @click="openAuth('signin')">Sign in to FrontDeskWise</button>
        </template>
        <template v-else>
          <p class="eyebrow">Account recovery</p>
          <h1>Reset your password</h1>
          <p v-if="resetReady">Choose a new password for {{ resetEmail }}.</p>
          <p v-else>Use the recovery link from your email to continue.</p>
          <form v-if="resetReady" class="auth-reset-form" @submit.prevent="submitPasswordUpdate">
            <label>New password<input v-model="resetPasswordValue" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters" /></label>
            <label>Confirm new password<input v-model="resetPasswordConfirmation" type="password" autocomplete="new-password" minlength="6" required placeholder="Enter it again" /></label>
            <p v-if="resetError" class="form-error" role="alert">{{ resetError }}</p>
            <button class="primary-button auth-submit" type="submit" :disabled="resetLoading">{{ resetLoading ? 'Updating password…' : 'Update password' }}</button>
          </form>
          <div v-else-if="resetError" class="auth-reset-error" role="alert"><CircleAlert :size="20" :stroke-width="1.9" aria-hidden="true" /><p>{{ resetError }}</p></div>
          <button v-if="!resetReady" class="outline-button auth-submit" type="button" @click="openAuth('forgot')">Request a new reset link</button>
          <button class="text-button auth-switch" type="button" @click="openAuth('signin')">Back to sign in</button>
        </template>
      </div>
    </section>
    <section v-else-if="route.kind === 'billing-success'" class="billing-success-shell">
      <article class="billing-success-card" aria-live="polite">
        <div class="billing-success-brand"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></div>
        <template v-if="billingSuccessState === 'active'">
          <div class="billing-success-icon"><Check :size="30" :stroke-width="2.5" aria-hidden="true" /></div>
          <p class="eyebrow">Payment successful</p>
          <h1>You’re all set!</h1>
          <p class="billing-success-lead">Your {{ billingSuccessPlanName }} plan is now active.</p>
          <div class="billing-success-summary">
            <div><span>Plan</span><strong>{{ billingSuccessPlanName }}</strong></div>
            <div><span>Price</span><strong>{{ billingSuccessPrice }}</strong></div>
            <div><span>Status</span><strong class="billing-success-status">Active</strong></div>
            <div><span>Next billing date</span><strong>{{ formatBillingDate(billingSnapshot?.billing.currentPeriodEndAt ?? null) }}</strong></div>
            <div><span>Business allowance</span><strong>{{ billingSnapshot?.billing.plan.maxBusinesses ?? 1 }} {{ (billingSnapshot?.billing.plan.maxBusinesses ?? 1) === 1 ? 'business' : 'businesses' }}</strong></div>
          </div>
          <p v-if="billingSnapshot?.billing.activationEmailQueuedAt && authSnapshot?.user.email" class="billing-success-email">A confirmation email is on its way to {{ authSnapshot.user.email }}.</p>
          <div class="billing-success-actions"><button class="primary-button" type="button" @click="continueFromBillingSuccess">Go to dashboard</button><button class="outline-button" type="button" @click="openBillingFromSuccess">Manage billing</button></div>
        </template>
        <template v-else-if="billingSuccessState === 'failed'">
          <div class="billing-success-icon billing-success-icon-danger"><CircleAlert :size="30" :stroke-width="2" aria-hidden="true" /></div>
          <p class="eyebrow">Payment received</p>
          <h1>We couldn’t activate your plan</h1>
          <p class="billing-success-lead">Your subscription was not activated. No FrontDeskWise access was changed.</p>
          <div class="billing-success-actions"><button class="primary-button" type="button" @click="openBillingFromSuccess">Return to billing</button><button class="outline-button" type="button" @click="billingSuccessRunKey = ''; void startBillingSuccessFlow()">Refresh status</button></div>
        </template>
        <template v-else>
          <div class="billing-success-icon billing-success-icon-pending"><RefreshCw :size="28" :stroke-width="2" aria-hidden="true" /></div>
          <p class="eyebrow">Payment received</p>
          <h1>{{ billingSuccessState === 'pending' ? 'Finishing setup' : 'Activating your plan' }}</h1>
          <p class="billing-success-lead">{{ billingSuccessState === 'pending' ? 'We’re finishing your subscription setup. This can take a few seconds.' : `We’re activating your ${billingSuccessPlanName} plan…` }}</p>
          <div class="billing-success-progress" aria-hidden="true"><span></span></div>
          <div class="billing-success-actions"><button class="outline-button" type="button" @click="billingSuccessRunKey = ''; void startBillingSuccessFlow()">Refresh status</button><button class="text-button" type="button" @click="openBillingFromSuccess">Go to billing</button></div>
        </template>
      </article>
    </section>
    <PartnerPortal
      v-else-if="route.kind === 'partner'"
      :section="route.section"
      :auth-snapshot="authSnapshot"
      :firebase-token="firebaseToken"
      @navigate="openPartnerSection"
      @sign-out="signOut"
    />
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
          <a class="text-button" href="/partners">Partners</a>
          <a class="text-button" href="/pricing">Pricing</a>
        </nav>
        <div class="nav-actions">
          <button class="dark-button small" type="button" @click="openAuth('signin')">Sign in</button>
        </div>
      </header>

      <div class="landing-hero">
        <div class="landing-hero-copy">
          <div class="eyebrow"><span class="pulse-dot"></span> AI front desk for local businesses</div>
          <h1>Your AI front desk. More leads, fewer missed opportunities.</h1>
          <p class="landing-hero-subtitle"><strong>An AI sales + front-desk employee that answers questions, qualifies intent, and moves the right people toward booking.</strong></p>
          <p class="landing-hero-body">Start with a free AI Front Desk Audit. See where your website is losing opportunities, then test the conversation before you put it live.</p>
          <div class="url-form landing-url-form">
            <input v-model="landingAuditUrl" type="url" placeholder="https://yourbusiness.com" aria-label="Business website URL" @keyup.enter="runLandingAudit" />
            <button class="primary-button" type="button" :disabled="landingAuditLoading" @click="runLandingAudit">
              {{ landingAuditLoading ? "Auditing website…" : "Run my free audit" }} <span aria-hidden="true">→</span>
            </button>
          </div>
          <button class="landing-hero-build-link" type="button" @click="websiteUrl = landingAuditUrl || websiteUrl; generateDemo()">Want to build it now? <span>Generate my AI front desk →</span></button>
          <div class="demo-requester-fields landing-requester-fields">
            <input v-model="demoRequesterName" type="text" placeholder="Your name (optional)" aria-label="Your name" />
            <input v-model="demoRequesterEmail" type="email" placeholder="Work email (optional)" aria-label="Work email" />
            <span>We’ll log the request and can send a fresh demo link later.</span>
          </div>
          <p v-if="landingAuditError" class="form-error">{{ landingAuditError }}</p>
          <div class="trust-row landing-trust-row"><span>✓ Public pages only</span><span>✓ No credit card</span><span>✓ Results in under a minute</span></div>
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

      <div class="landing-story-strip" aria-label="FrontDeskWise customer journey">
        <span class="landing-story-label">From question to outcome</span>
        <span class="landing-story-step"><b>01</b> Question</span><i aria-hidden="true">→</i>
        <span class="landing-story-step"><b>02</b> Answer</span><i aria-hidden="true">→</i>
        <span class="landing-story-step"><b>03</b> Action</span><i aria-hidden="true">→</i>
        <span class="landing-story-step"><b>04</b> Handoff</span>
      </div>

      <section id="front-desk-audit" class="landing-section landing-magnet-section">
        <div class="landing-section-heading landing-section-heading-row landing-magnet-heading">
          <div><p class="eyebrow">Free AI Front Desk Audit</p><h2>Find the leaks between your website and the next customer.</h2><p>FrontDeskWise scans your public pages, scores the front-desk experience, and shows the first conversion gaps worth fixing.</p></div>
          <span class="landing-magnet-note"><Sparkles :size="16" :stroke-width="1.8" aria-hidden="true" /> Value before signup</span>
        </div>
        <div class="landing-magnet-grid">
          <form class="landing-audit-card" @submit.prevent="runLandingAudit">
            <div class="landing-audit-card-header"><span class="landing-audit-icon"><ChartNoAxesCombined :size="19" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>Website conversion audit</strong><small>Built from your public website</small></span><span class="landing-audit-live"><i></i> Free</span></div>
            <label class="landing-audit-label">Your website URL<input v-model="landingAuditUrl" type="url" placeholder="https://yourbusiness.com" required /></label>
            <div class="landing-audit-promise"><span><Check :size="14" :stroke-width="2" aria-hidden="true" /> Pricing visibility</span><span><Check :size="14" :stroke-width="2" aria-hidden="true" /> Booking path</span><span><Check :size="14" :stroke-width="2" aria-hidden="true" /> After-hours capture</span><span><Check :size="14" :stroke-width="2" aria-hidden="true" /> Lead qualification</span></div>
            <button class="primary-button landing-audit-button" type="submit" :disabled="landingAuditLoading">{{ landingAuditLoading ? "Scanning public pages…" : "Get my free audit" }} <ArrowRight :size="15" :stroke-width="1.9" aria-hidden="true" /></button>
            <small class="landing-audit-disclaimer">No login required. We only use public pages to create your reviewable demo.</small>
          </form>

          <article id="interactive-demo" class="landing-demo-card">
            <div class="landing-demo-card-header"><div><span class="landing-demo-kicker">INTERACTIVE DEMO BUSINESS</span><strong>Ask this business anything</strong></div><span class="landing-live-pill"><i></i> Online</span></div>
            <div class="landing-demo-business"><span class="landing-demo-business-avatar">H</span><span><strong>Harbor &amp; Home</strong><small>Home services · sample business</small></span><span class="landing-demo-business-status">AI front desk</span></div>
            <div class="landing-demo-conversation" aria-live="polite">
              <div v-for="(turn, index) in landingDemoTurns" :key="`${turn.role}-${index}-${turn.content}`" :class="['landing-demo-turn', turn.role]"><span v-if="turn.role === 'assistant'" class="landing-demo-avatar"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><span class="landing-demo-bubble">{{ turn.content }}</span></div>
              <div v-if="landingDemoLoading" class="landing-demo-turn assistant"><span class="landing-demo-avatar"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><span class="landing-demo-bubble landing-demo-typing"><i></i><i></i><i></i></span></div>
            </div>
            <div v-if="landingDemoInsight" class="landing-demo-intent"><span class="landing-demo-intent-icon">🔥</span><span><strong>{{ landingDemoInsight.label }} · {{ landingDemoInsight.score }}</strong><small>{{ landingDemoInsight.detail }}</small></span><button type="button" @click="websiteUrl = landingAuditUrl || websiteUrl; generateDemo()">Build this on my site →</button></div>
            <div class="landing-demo-quick-actions"><button v-for="question in ['Can I book Saturday?', 'What does pricing look like?', 'Do you integrate with Mindbody?']" :key="question" type="button" :disabled="landingDemoLoading" @click="runLandingDemo(question)">{{ question }}</button></div>
            <form class="landing-demo-input" @submit.prevent="runLandingDemo()"><input v-model="landingDemoQuestion" type="text" aria-label="Ask the demo business a question" placeholder="Ask this business anything…" /><button type="submit" aria-label="Send question" :disabled="landingDemoLoading || !landingDemoQuestion.trim()"><Send :size="16" :stroke-width="1.9" aria-hidden="true" /></button></form>
            <small class="landing-demo-disclaimer">Illustrative conversation · connect your own website to use real business knowledge.</small>
          </article>
        </div>
        <article v-if="landingAudit" id="audit-result" class="landing-audit-result">
          <div class="landing-audit-score"><span class="landing-audit-score-label">FRONT DESK READINESS</span><strong>{{ landingAudit.score }}</strong><span>/100</span><small>estimated from {{ landingAudit.websiteUrl.replace(/^https?:\/\//, '').replace(/\/$/, '') }}</small></div>
          <div class="landing-audit-result-copy"><p class="eyebrow">{{ landingAudit.businessName }} · audit complete</p><h3>{{ landingAudit.summary }}</h3><p>Here is what a visitor is likely to experience today — and where FrontDeskWise can help turn friction into a useful next step.</p><div class="landing-audit-findings"><div v-for="finding in landingAudit.findings" :key="finding.label" :class="['landing-audit-finding', finding.status]"><span class="landing-audit-finding-icon"><Check v-if="finding.status === 'healthy'" :size="13" :stroke-width="2.2" aria-hidden="true" /><TriangleAlert v-else :size="13" :stroke-width="2" aria-hidden="true" /></span><span><strong>{{ finding.label }}</strong><small>{{ finding.detail }}</small></span></div></div><div class="landing-audit-result-actions"><button class="primary-button small" type="button" @click="websiteUrl = landingAudit.websiteUrl; generateDemo()">Build my AI front desk</button><button class="outline-button small" type="button" @click="scrollLandingTo('interactive-demo')">Try the conversation</button></div></div>
        </article>
      </section>

      <section class="landing-section landing-capabilities-section">
        <div class="landing-section-heading landing-section-heading-centered landing-capabilities-heading">
          <p class="eyebrow">What FrontDeskWise does</p>
          <h2>Built to answer, qualify, act, and hand off.</h2>
          <p>Everything your website needs to turn visitors into customers.</p>
        </div>
        <div class="landing-capability-grid"><article v-for="capability in landingCapabilities" :key="capability.title" :class="['landing-capability-card', capability.tone]"><span :class="['landing-capability-icon', capability.tone]"><component :is="capability.icon" :size="20" :stroke-width="1.8" aria-hidden="true" /></span><h3>{{ capability.title }}</h3><p>{{ capability.body }}</p><div :class="['landing-capability-preview', capability.previewType]"><template v-if="capability.previewType === 'message'"><span class="landing-capability-avatar"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><strong>{{ capability.preview }}</strong></template><template v-else-if="capability.previewType === 'booking'"><span class="landing-capability-preview-icon"><CalendarCheck :size="16" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>{{ capability.preview }}</strong><small>{{ capability.previewMeta }}</small></span><b><Check :size="16" :stroke-width="2" aria-hidden="true" /></b></template><template v-else-if="capability.previewType === 'handoff'"><span class="landing-capability-avatar human">S</span><span><strong>{{ capability.preview }}</strong><small>{{ capability.previewMeta }}</small></span></template><template v-else><strong>{{ capability.preview }}</strong></template></div><span class="landing-capability-status"><Check :size="13" :stroke-width="2" aria-hidden="true" /> {{ capability.status }}</span></article></div>
      </section>

      <section id="how-it-works" class="landing-section landing-conversion-section">
        <div class="landing-section-heading landing-section-heading-centered"><p class="eyebrow">The commercial story</p><h2>See the conversation turn into a next step.</h2><p>FrontDeskWise connects the moment a visitor asks a question to the outcome your business needs.</p></div>
        <div class="landing-flow-shell" aria-label="Illustrative customer conversion flow">
          <div class="landing-flow-cards"><span class="landing-flow-progress" aria-hidden="true"></span><article v-for="(step, index) in landingFlowSteps" :key="step.label" :class="['landing-flow-step', `tone-${index}`]">
            <div class="landing-flow-step-header"><span class="landing-flow-index">0{{ index + 1 }}</span><strong>{{ step.label }}</strong></div>
            <div class="landing-flow-visual">
              <div v-if="index === 0" class="landing-flow-question"><span class="landing-flow-person" aria-hidden="true"><UsersRound :size="16" :stroke-width="1.8" /></span><span>Do you have Saturday appointments?</span></div>
              <div v-else-if="index === 1" class="landing-flow-answer"><span class="mini-orb" aria-hidden="true"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><span>Yes — we have Saturday appointments available.</span></div>
              <div v-else-if="index === 2" class="landing-flow-qualification"><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> <b>Service: Consultation</b></span><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> <b>Preferred: Saturday</b></span><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> <b>Contact: Captured</b></span></div>
              <div v-else-if="index === 3" class="landing-flow-convert"><strong><CalendarCheck :size="15" :stroke-width="1.8" aria-hidden="true" /> Book appointment</strong><small>Sat, Dec 20 at 10:00 AM</small><b><Check :size="13" :stroke-width="2" aria-hidden="true" /> Appointment request sent</b></div>
              <div v-else class="landing-flow-handoff"><span class="landing-flow-human-avatar" aria-hidden="true">S</span><span>Hi! I can help with that. I already have the details from your conversation.</span></div>
            </div>
            <div class="landing-flow-step-copy"><strong>{{ step.title }}</strong><p>{{ step.body }}</p></div>
          </article></div>
          <div class="landing-flow-live-card"><div class="landing-flow-live-copy"><span class="landing-flow-live-label"><i></i> Live illustrative flow</span><strong>Visitor intent stays attached to the conversation.</strong><small>Every step can be reviewed, tested, and improved before it reaches customers.</small></div><div class="landing-flow-live-path"><span><MessageSquare :size="14" :stroke-width="1.8" aria-hidden="true" /> Question <Check :size="13" :stroke-width="2" aria-hidden="true" /></span><ArrowRight :size="15" :stroke-width="1.8" aria-hidden="true" /><span><BookOpen :size="14" :stroke-width="1.8" aria-hidden="true" /> Answer <Check :size="13" :stroke-width="2" aria-hidden="true" /></span><ArrowRight :size="15" :stroke-width="1.8" aria-hidden="true" /><span><Zap :size="14" :stroke-width="1.8" aria-hidden="true" /> Action <Check :size="13" :stroke-width="2" aria-hidden="true" /></span><ArrowRight :size="15" :stroke-width="1.8" aria-hidden="true" /><span><UserCheck :size="14" :stroke-width="1.8" aria-hidden="true" /> Outcome <Check :size="13" :stroke-width="2" aria-hidden="true" /></span></div></div>
        </div>
      </section>

      <section id="industries" class="landing-section landing-industries-section">
        <div class="landing-section-heading landing-section-heading-row"><div><p class="eyebrow">Works where you work</p><h2>Show customers what happens next.</h2></div></div>
        <div class="landing-industry-grid">
          <article v-for="industry in landingIndustries" :key="industry.name" class="landing-industry-card">
            <div class="landing-industry-top"><span class="landing-industry-icon"><component :is="industry.icon" :size="21" :stroke-width="1.8" aria-hidden="true" /></span><span class="landing-industry-tag">{{ industry.name }}</span></div>
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
            <div class="landing-integration-visitor"><span class="landing-integration-visitor-icon" aria-hidden="true"><UsersRound :size="21" :stroke-width="1.8" /></span><span><strong>Website visitor</strong><b>“I’d like to book a consultation.”</b></span></div>
            <span class="landing-integration-arrow" aria-hidden="true"><ArrowDown :size="28" :stroke-width="1.8" /></span>
            <div class="landing-integration-core"><div class="landing-integration-brand"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /> FrontDesk<span>Wise</span></div><strong>Answer <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /> Qualify <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /> Act</strong><span class="landing-integration-context"><Check :size="14" :stroke-width="2" aria-hidden="true" /> Customer context ready</span></div>
            <div class="landing-integration-branch" aria-hidden="true"></div>
            <div class="landing-integration-card-grid">
              <article v-for="integration in landingIntegrations" :key="integration.name" class="landing-integration-card">
                <span :class="['landing-integration-icon', integration.tone]" aria-hidden="true"><svg v-if="integration.logo" class="provider-logo" viewBox="0 0 24 24" :fill="`#${integration.logo.hex}`"><path :d="integration.logo.path" /></svg><component v-else :is="integration.icon" :size="20" :stroke-width="1.8" /></span>
                <strong>{{ integration.name }}</strong>
                <small>{{ integration.kind }}</small>
                <span class="landing-integration-outcome"><Check :size="13" :stroke-width="2" aria-hidden="true" /> {{ integration.outcome }}</span>
              </article>
            </div>
            <div class="landing-integration-trust"><span><ShieldCheck :size="14" :stroke-width="1.8" aria-hidden="true" /> <b>Lead saved first</b></span><span><RefreshCw :size="14" :stroke-width="1.8" aria-hidden="true" /> <b>Retries on delivery failure</b></span><span><Cable :size="14" :stroke-width="1.8" aria-hidden="true" /> <b>Your systems stay in control</b></span></div>
          </div>
        </div>
      </section>

      <section class="landing-section landing-dashboard-section">
        <div class="landing-dashboard-copy"><p class="eyebrow">Owner dashboard</p><h2>See the revenue signals your website used to hide.</h2><p>FrontDeskWise shows the conversations handled, buying intent detected, actions completed, and opportunities that arrived after hours.</p><span class="landing-illustrative-note">Illustrative sample workspace · not customer data</span><button class="outline-button" type="button" @click="openAuth('signup')">Create your workspace</button></div>
        <div class="landing-dashboard-card">
          <div class="landing-dashboard-header"><div><span class="landing-dashboard-kicker">OWNER DASHBOARD · ILLUSTRATIVE SAMPLE</span><h3>This week</h3></div><span class="landing-live-pill"><i></i> Live view</span></div>
          <div class="landing-dashboard-metrics"><div v-for="metric in landingSampleMetrics.slice(0, 4)" :key="metric.label"><strong>{{ metric.value }}</strong><span>{{ metric.label }}</span><small>{{ metric.trend }}</small></div></div>
          <div class="landing-dashboard-revenue-row"><span><strong>$4,800</strong><small>estimated pipeline influenced</small></span><span><strong>8</strong><small>after-hours opportunities</small></span><span><strong>12</strong><small>hot leads ready now</small></span></div>
          <div class="landing-dashboard-bottom"><div class="landing-mini-chart"><div class="landing-mini-chart-head"><strong>Conversation activity</strong><span>Illustrative last 7 days</span></div><div class="landing-bars"><i v-for="(height, index) in [32, 48, 41, 67, 54, 79, 88]" :key="index" :style="{ height: `${height}%` }"></i></div><div class="landing-chart-labels"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div></div><div class="landing-opportunity"><span class="landing-opportunity-label">TOP OPPORTUNITY</span><strong>17 visitors asked about weekend availability.</strong><p>Add weekend hours to your knowledge and turn a repeated question into a better answer.</p><span class="landing-opportunity-action">Knowledge gap</span></div></div>
        </div>
      </section>

      <section class="landing-section landing-intelligence-section">
        <div class="landing-section-heading landing-section-heading-row"><div><p class="eyebrow">Sales intelligence</p><h2>Know who is ready to buy — and why.</h2><p>Every conversation becomes a signal your team can act on, without asking staff to read every transcript.</p></div><span class="landing-magnet-note"><Zap :size="16" :stroke-width="1.8" aria-hidden="true" /> Intent changes the next step</span></div>
        <div class="landing-intelligence-grid"><article class="landing-intent-panel"><div class="landing-intent-panel-header"><span class="landing-hot-badge">🔥 HOT LEAD</span><span>just now</span></div><div class="landing-intent-person"><span class="landing-person-avatar">JM</span><span><strong>Jordan Miller</strong><small>Website visitor · returning</small></span><b>78%</b></div><div class="landing-intent-level"><span>Conversion probability</span><i><em style="width: 78%"></em></i><strong>High</strong></div><div class="landing-intent-signals"><p>Buying signals detected</p><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> Asked about pricing</span><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> Compared two plans</span><span><Check :size="13" :stroke-width="2" aria-hidden="true" /> Requested a demo</span></div><button class="primary-button small" type="button" @click="openAuth('signup')">See hot leads in your workspace →</button></article><article class="landing-weekly-report"><div class="landing-weekly-report-header"><span class="landing-report-icon"><ChartNoAxesCombined :size="18" :stroke-width="1.8" aria-hidden="true" /></span><span><p class="eyebrow">Weekly owner report</p><h3>3 things hurting conversions this week</h3></span></div><div class="landing-report-row"><span>01</span><div><strong>12 visitors asked about pricing before leaving</strong><small>Make the range visible earlier in the conversation.</small></div></div><div class="landing-report-row"><span>02</span><div><strong>7 visitors wanted Saturday appointments</strong><small>Add availability to your knowledge and booking path.</small></div></div><div class="landing-report-row"><span>03</span><div><strong>5 visitors asked about an unlisted integration</strong><small>Turn repeated demand into a useful sales answer.</small></div></div><button class="landing-text-link" type="button" @click="openAuth('signup')">Review recommendations <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></article></div>
      </section>

      <section class="landing-multi-business"><div><p class="eyebrow">One login. Multiple businesses.</p><h2>Grow your portfolio without adding another tool to manage.</h2><p>Keep businesses, teams, actions, and analytics organized in one shared operating layer.</p></div><div class="landing-portfolio-card"><div><span class="landing-portfolio-avatar blue">H</span><strong>Harbor &amp; Home</strong><small>Connected workspace · shared team</small></div><div><span class="landing-portfolio-avatar orange">N</span><strong>Northstar Studio</strong><small>Connected workspace · shared team</small></div><div><span class="landing-portfolio-avatar green">C</span><strong>ClearAir Services</strong><small>Connected workspace · shared team</small></div></div></section>

      <section class="landing-section landing-proof-section"><div class="landing-proof-card"><div><p class="eyebrow">Proof that compounds</p><h2>Make the numbers that matter visible.</h2><p>FrontDeskWise is built to show the conversations handled, leads captured, actions completed, and questions your team should improve next.</p><span class="landing-illustrative-note">The figures below show the kind of operating view owners get once their own workspace is live.</span></div><div class="landing-proof-stats"><span v-for="metric in landingSampleMetrics.slice(0, 3)" :key="metric.label"><strong>{{ metric.value }}</strong><small>{{ metric.label }}</small></span></div></div></section>

      <section id="pricing" class="marketing-pricing landing-pricing">
        <div class="pricing-heading"><div><p class="eyebrow">Simple organization pricing</p><h2>Plans that scale with conversations and outcomes.</h2><p class="pricing-heading-copy">Start with one business, then add booking workflows, reporting, and shared operations as your front desk proves its value.</p></div><span class="pricing-heading-note">7-day trial · no credit card</span></div>
        <div class="pricing-grid">
          <article v-for="plan in landingPlans" :key="plan.key" :class="['pricing-card landing-pricing-card', { featured: plan.featured }]" tabindex="0">
            <span v-if="plan.badge" class="pricing-badge">{{ plan.badge }}</span>
            <h3>{{ plan.name }}</h3>
            <p>{{ plan.description }}</p>
            <strong class="pricing-price">{{ plan.price }}<small v-if="plan.priceAmount !== null">/month</small></strong>
            <span class="pricing-businesses">{{ plan.businesses }}</span>
            <span class="pricing-usage">{{ plan.usage }}</span>
            <ul class="landing-plan-bullets"><li v-for="bullet in plan.bullets" :key="bullet">✓ {{ bullet }}</li></ul>
            <button v-if="!plan.custom" class="primary-button small" type="button" @click="openAuth('signup')">{{ plan.cta }}</button>
            <a v-else class="outline-button small pricing-plan-cta" href="mailto:hello@frontdeskwise.com?subject=FrontDeskWise%20Portfolio%20pricing">{{ plan.cta }}</a>
          </article>
        </div>
        <p class="pricing-guardrail-note">AI conversation allowances are measured per visitor session with abuse filtering. Portfolio plans use pooled, negotiated capacity so agencies are not forced into a five-location bundle.</p>

        <div class="pricing-calculator">
          <div class="pricing-calculator-copy"><p class="eyebrow">Stress-test the economics</p><h3>See what a paying business can contribute.</h3><p>Use your own traffic and cost assumptions. This is an illustrative contribution model—not accounting profit—and helps set a safe usage ceiling before launch.</p></div>
          <div class="pricing-calculator-controls">
            <label>Plan<select v-model="pricingCalculatorPlan"><option v-for="plan in pricingCalculatorPlans" :key="plan.key" :value="plan.key">{{ plan.name }} · {{ plan.price }}/mo</option></select></label>
            <label>AI conversations / month<input v-model.number="pricingCalculatorConversations" type="number" min="0" max="10000" step="100" inputmode="numeric" /></label>
            <label>Variable cost / conversation<input v-model.number="pricingCalculatorVariableCost" type="number" min="0" step="0.001" inputmode="decimal" /></label>
            <label>Other operating costs / customer<input v-model.number="pricingCalculatorOtherCosts" type="number" min="0" step="1" inputmode="decimal" /></label>
            <label>Partner commission<input v-model.number="pricingCalculatorPartnerCommission" type="number" min="0" max="100" step="1" inputmode="decimal" /></label>
          </div>
          <div class="pricing-calculator-results" aria-live="polite">
            <div class="pricing-calculator-contribution"><span>Monthly contribution</span><strong>{{ formatPricingCurrency(pricingCalculatorContribution) }}</strong><small>after listed costs</small></div>
            <div><span>Contribution margin</span><strong>{{ formatPricingPercent(pricingCalculatorMargin) }}</strong></div>
            <div><span>AI conversation cost</span><strong>{{ formatPricingCurrency(pricingCalculatorAiCost) }}</strong></div>
            <div><span>Payment processing</span><strong>{{ formatPricingCurrency(pricingCalculatorPaymentCost) }}</strong></div>
          </div>
        </div>
      </section>

      <section class="landing-section landing-faq-section"><div class="landing-section-heading landing-section-heading-centered"><p class="eyebrow">Questions owners ask</p><h2>A front desk that is easy to understand.</h2><p>Clear answers before you hand over your website, your customers, or your team’s time.</p></div><div class="landing-faq-list"> <details v-for="(faq, index) in landingFaqs" :key="faq.question" :open="index === 0"><summary>{{ faq.question }}</summary><p>{{ faq.answer }}</p></details></div></section>

      <section id="final-cta" class="landing-final-cta"><div><p class="eyebrow">See your own version</p><h2>See what FrontDeskWise can build from your website.</h2><p>Your next customer may already be on the page. Give them a useful next step.</p></div><div class="url-form landing-final-form"><input v-model="websiteUrl" type="url" placeholder="https://yourbusiness.com" aria-label="Business website URL" @keyup.enter="generateDemo" /><button class="primary-button" type="button" :disabled="isGenerating" @click="generateDemo">{{ isGenerating ? "Building…" : "Generate my AI front desk" }} <span aria-hidden="true">→</span></button></div></section>

      <footer class="marketing-footer landing-footer"><div><strong>FrontDeskWise</strong><span>FrontDeskWise is a product of Sudo Programmer, Inc.</span></div><nav aria-label="Footer navigation"><a href="/features">Features</a><a href="/industries">Industries</a><a href="/use-cases">Use cases</a><a href="/integrations">Integrations</a><a href="/resources">Resources</a><a href="/pricing">Pricing</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:hello@frontdeskwise.com">Contact</a></nav><small>© 2026 Sudo Programmer, Inc. · FrontDeskWise. Built for clearer customer conversations.</small></footer>
    </section>

    <section v-else-if="view === 'privacy' || view === 'terms'" class="legal-shell">
      <LegalPage :kind="view === 'privacy' ? 'privacy' : 'terms'" />
    </section>

    <section v-else :class="['product-shell', { 'admin-only-mode': adminSurfaceMode, 'mobile-nav-open': mobileNavOpen }]">
      <div v-if="authSnapshot && authSnapshot.user.emailVerified === false" class="email-verification-banner" role="status">
        <div><strong>Verify your email to unlock workspace actions.</strong><span>You can review this account, but adding businesses, publishing, integrations, invitations, and customer data stay protected until verification.</span></div>
        <button class="outline-button small" type="button" :disabled="verificationEmailLoading" @click="resendVerificationEmail">{{ verificationEmailLoading ? 'Sending…' : 'Resend verification email' }}</button>
        <small v-if="verificationEmailMessage">{{ verificationEmailMessage }}</small>
      </div>
      <div v-if="mobileNavOpen" class="mobile-nav-backdrop" aria-hidden="true" @click="closeMobileNav"></div>
      <aside id="mobile-navigation-drawer" ref="mobileDrawer" class="sidebar" aria-label="Workspace navigation">
        <div class="sidebar-brand-row">
          <button class="sidebar-brand" type="button" @click="openHome"><img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></button>
          <button class="mobile-drawer-close" type="button" aria-label="Close navigation" @click="closeMobileNav"><X :size="20" :stroke-width="1.9" aria-hidden="true" /></button>
        </div>
        <div v-if="adminSurfaceMode" class="admin-identity-card"><span class="admin-identity-mark">SP</span><span><strong>Operations</strong><small>Super-admin access</small></span><span class="admin-identity-check"><BadgeCheck :size="16" :stroke-width="1.8" aria-hidden="true" /></span></div>
        <nav v-if="adminSurfaceMode" class="sidebar-nav admin-sidebar-nav" aria-label="Super-admin navigation">
          <button v-for="item in adminNavItems" :key="item.id" type="button" :class="['nav-item', { active: view === 'admin' && adminSection === item.id }]" @click="adminSection = item.id; view = 'admin'"><span class="nav-icon"><component :is="item.icon" :size="19" :stroke-width="1.8" aria-hidden="true" /></span><span>{{ item.label }}</span></button>
        </nav>
        <nav v-else class="sidebar-nav" aria-label="Workspace navigation">
          <div v-for="section in visibleNavSections" :key="section.label || 'overview'" class="nav-section">
            <p v-if="section.label" class="nav-section-label">{{ section.label }}</p>
            <button v-for="item in section.items" :key="`${item.id}-${item.settingsTab || 'default'}`" type="button" :disabled="publicDemoMode && !['overview', 'support'].includes(item.id)" :class="['nav-item', { active: isNavItemActive(item) }]" @click="navigateToNavItem(item)"><span class="nav-icon"><component :is="item.icon" :size="19" :stroke-width="1.8" aria-hidden="true" /></span><span>{{ item.label }}</span><b v-if="item.id === 'inbox' && inboxUnreadCount">{{ inboxUnreadCount }}</b></button>
          </div>
          <button v-if="isSuperAdmin" type="button" :class="['nav-item', { active: view === 'admin' }]" @click="navigateToAdmin"><span class="nav-icon"><ShieldCheck :size="19" :stroke-width="1.8" aria-hidden="true" /></span><span>Admin control plane</span></button>
        </nav>
        <div v-if="adminSurfaceMode" class="sidebar-bottom"><div class="admin-sidebar-note"><strong>Operations access</strong><small>Manage platform health, organizations, users, and demos from one place.</small></div><button v-if="!adminOnlyMode" class="sidebar-link" type="button" @click="view = 'overview'">← Back to workspace</button><button class="admin-sign-out" type="button" @click="signOut"><LogOut :size="16" :stroke-width="1.9" aria-hidden="true" /><span>Sign out</span></button></div>
        <div v-else class="sidebar-bottom">
          <div v-if="showSetupCard" class="setup-card" aria-label="AI front desk setup">
            <template v-if="!availableBusinesses.length">
              <div class="setup-row"><span>{{ setupCardContent.eyebrow }}</span></div>
              <strong class="setup-card-title">{{ setupCardContent.title }}</strong>
              <small>{{ setupCardContent.description }}</small>
              <button class="sidebar-setup-action" type="button" @click="continueSetup">{{ setupCardContent.action }} →</button>
            </template>
            <template v-else>
              <div class="setup-row"><span>{{ nextSetupStep ? 'Setup' : setupCardContent.eyebrow }}</span><strong>{{ nextSetupStep ? `${setupSteps.filter((step) => step.complete).length}/${setupSteps.length}` : 'Next' }}</strong></div>
              <strong class="setup-card-title">{{ setupCardContent.title }}</strong>
              <small>{{ setupCardContent.description }}</small>
              <small v-if="knowledgeSourcesNeedAttention" class="setup-attention-line">{{ (workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0) }} source{{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? '' : 's' }} {{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? 'needs' : 'need' }} attention</small>
              <button class="sidebar-setup-action" type="button" @click="continueSetup">Continue →</button>
              <button v-if="nextSetupStep" class="setup-progress-toggle" type="button" :aria-expanded="setupProgressOpen" @click="setupProgressOpen = !setupProgressOpen">{{ setupProgressOpen ? 'Hide' : 'Show' }} setup progress</button>
              <div v-if="nextSetupStep && setupProgressOpen" class="setup-progress-list"><div v-for="step in setupSteps" :key="step.id" :class="['setup-progress-step', { complete: step.complete }]" @click="step.complete ? undefined : openSetupStep(step.id)"><span>{{ step.complete ? '✓' : '○' }}</span><small>{{ step.label }}</small></div></div>
            </template>
          </div>
          <div class="sidebar-account"><button class="sidebar-account-trigger" type="button" :aria-expanded="sidebarAccountMenuOpen" @click="sidebarAccountMenuOpen = !sidebarAccountMenuOpen; profileMenuOpen = false; notificationMenuOpen = false"><span class="sidebar-account-avatar">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : businessInitial }}</span><span class="sidebar-account-copy"><strong>{{ authSnapshot?.user.name ?? (businessName || 'Demo workspace') }}</strong><small>{{ focusedTeamMode ? workspaceRoleLabel : `${activeOrganization?.billing.plan.displayName ?? 'Workspace'} plan` }}</small></span><ChevronDown class="sidebar-account-chevron" :size="15" :stroke-width="1.8" aria-hidden="true" /></button><div v-if="sidebarAccountMenuOpen" class="sidebar-account-menu"><button type="button" @click="openSettingsTab('general')">Account & settings</button><button v-if="canAccessBilling" type="button" @click="openSettingsTab('billing')">Billing</button><button type="button" @click="openHelpAndSupport">Help &amp; Support</button><button v-if="authSnapshot" type="button" @click="notificationMenuOpen = true; sidebarAccountMenuOpen = false">Notifications</button><button v-if="authSnapshot" type="button" class="danger-text" @click="sidebarAccountMenuOpen = false; signOut()">Sign out</button><button v-else type="button" @click="sidebarAccountMenuOpen = false; openAuth('signin')">Sign in</button></div></div>
        </div>
      </aside>

      <section class="content-area">
        <header class="mobile-header">
          <button ref="mobileMenuButton" class="mobile-header-icon" type="button" aria-label="Open navigation" aria-controls="mobile-navigation-drawer" :aria-expanded="mobileNavOpen" @click="mobileNavOpen = true"><Menu :size="21" :stroke-width="1.9" aria-hidden="true" /></button>
          <div class="mobile-header-context"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span v-if="availableBusinesses.length" class="mobile-workspace-select-wrap"><span class="mobile-workspace-select-row"><select v-model="workspaceSelection" aria-label="Switch business"><option v-for="business in availableBusinesses" :key="business.id" :value="business.slug">{{ business.name }}</option></select><ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></span><small>{{ activeOrganization?.name ?? 'Business' }}</small></span><button v-else class="mobile-workspace-open" type="button" aria-label="Open business switcher" @click="mobileNavOpen = true"><span><strong>{{ businessName || (authSnapshot ? 'Workspace' : 'FrontDeskWise') }}</strong><small>{{ activeOrganization?.name ?? 'Business' }}</small></span></button></div>
          <div class="mobile-header-actions">
            <button v-if="authSnapshot" class="notification-trigger" type="button" aria-label="Open notifications" :aria-expanded="notificationMenuOpen" @click="toggleNotifications"><Bell class="notification-bell" :size="20" :stroke-width="1.8" aria-hidden="true" /><span v-if="notificationUnreadCount" class="notification-badge">{{ notificationUnreadCount > 9 ? '9+' : notificationUnreadCount }}</span></button>
            <button class="profile-avatar profile-menu-trigger" type="button" aria-label="Open account menu" @click="mobileNavOpen = true; sidebarAccountMenuOpen = true">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : 'SP' }}</button>
          </div>
        </header>
        <div v-if="notificationMenuOpen && authSnapshot" class="notification-menu mobile-notification-menu">
          <div class="panel-heading notification-panel-heading"><strong>Notifications</strong><div class="notification-panel-actions"><button v-if="notificationUnreadCount || staffNotifications.some((notification) => !notification.readAt)" class="text-button" type="button" :disabled="notificationActionLoading" @click="markAllNotificationsRead">{{ notificationActionLoading ? 'Clearing…' : 'Mark all read' }}</button><button class="text-button" type="button" @click="loadNotifications">Refresh</button></div></div>
          <p v-if="notificationActionError" class="notification-action-error">{{ notificationActionError }}</p>
          <div class="notification-list">
            <div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div>
            <button v-for="notification in staffNotifications" :key="notification.id" :class="['notification-row', { 'notification-row-unread': !notification.readAt }]" type="button" @click="markNotificationRead(notification); view = 'inbox'; notificationMenuOpen = false"><span class="notification-row-indicator" aria-hidden="true"></span><span><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></span></button>
          </div>
        </div>
        <header class="content-header mobile-page-heading"><div><p class="breadcrumb">{{ view === 'admin' ? 'Operations / FrontDeskWise' : `${businessName || 'Workspace'} / FrontDeskWise` }}</p><h1>{{ view === 'admin' ? adminSectionTitle : pageTitle }}</h1></div><div class="header-actions"><div v-if="!adminSurfaceMode" class="header-workspace-switcher"><span class="workspace-avatar"><img v-if="workspaceLogoSrc" :src="workspaceLogoSrc" alt="" aria-hidden="true" @error="handleWorkspaceLogoError" /><span v-else aria-hidden="true">{{ businessInitial }}</span></span><span v-if="availableBusinesses.length" class="workspace-select-wrap"><select v-model="workspaceSelection" aria-label="Switch business"><option v-for="business in availableBusinesses" :key="business.id" :value="business.slug">{{ business.name }}</option></select><small>{{ activeOrganization?.name ?? 'Organization' }}</small></span><span v-else><strong>{{ businessName || (authSnapshot ? 'No business yet' : 'Demo workspace') }}</strong><small>{{ businessLocation || (authSnapshot ? 'Add your first business' : 'Preview data from the API') }}</small></span><span class="workspace-actions"><span class="chevron" aria-hidden="true"><ChevronDown :size="16" :stroke-width="1.8" /></span></span></div><button v-if="authSnapshot" class="notification-trigger" type="button" aria-label="Open notifications" :aria-expanded="notificationMenuOpen" @click="toggleNotifications"><Bell class="notification-bell" :size="20" :stroke-width="1.8" aria-hidden="true" /><span v-if="notificationUnreadCount" class="notification-badge">{{ notificationUnreadCount > 9 ? '9+' : notificationUnreadCount }}</span></button><button v-if="authSnapshot" class="profile-avatar profile-menu-trigger" type="button" aria-label="Open account menu" :aria-expanded="profileMenuOpen" @click="profileMenuOpen = !profileMenuOpen; notificationMenuOpen = false">{{ authSnapshot.user.name.charAt(0).toUpperCase() }}</button><span v-else class="profile-avatar">SP</span></div><div v-if="notificationMenuOpen && authSnapshot" class="notification-menu"><div class="panel-heading notification-panel-heading"><strong>Notifications</strong><div class="notification-panel-actions"><button v-if="notificationUnreadCount || staffNotifications.some((notification) => !notification.readAt)" class="text-button" type="button" :disabled="notificationActionLoading" @click="markAllNotificationsRead">{{ notificationActionLoading ? 'Clearing…' : 'Mark all read' }}</button><button class="text-button" type="button" @click="loadNotifications">Refresh</button></div></div><p v-if="notificationActionError" class="notification-action-error">{{ notificationActionError }}</p><div class="notification-list"><div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div><button v-for="notification in staffNotifications" :key="notification.id" :class="['notification-row', { 'notification-row-unread': !notification.readAt }]" type="button" @click="markNotificationRead(notification); view = 'inbox'; notificationMenuOpen = false"><span class="notification-row-indicator" aria-hidden="true"></span><span><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></span></button></div></div><div v-if="profileMenuOpen && authSnapshot" class="profile-menu"><strong>{{ authSnapshot.user.name }}</strong><small>{{ authSnapshot.user.email }}</small><button type="button" @click="openSettingsTab('general')">Account settings</button><button v-if="canAccessBilling" type="button" @click="openSettingsTab('billing')">Billing</button><button type="button" @click="toggleNotifications">Notifications</button><button type="button" class="danger-text" @click="profileMenuOpen = false; signOut()">Sign out</button></div></header>
        <div v-if="!adminSurfaceMode && supportViewMode" class="trial-banner warning support-view-banner"><span><strong>You are viewing {{ businessName || 'this business' }} as support.</strong><small>Read-only support view · case {{ supportViewCaseId || 'linked case' }} · access expires automatically and this session is audited.</small></span><button class="primary-button small" type="button" @click="exitSupportView">Exit support view</button></div>
        <div v-else-if="!adminSurfaceMode && publicDemoMode" class="trial-banner info"><span><strong>Public sample workspace</strong><small>This view is live demo data in read-only mode. Generate your own demo or create an account to customize, install, and capture leads.</small></span><button class="primary-button small" type="button" @click="openAuth('signup')">Create your workspace →</button></div>
        <div v-else-if="!adminSurfaceMode && billingSnapshot?.billing.status === 'trial' && billingSnapshot.billing.mode !== 'sandbox'" class="trial-banner compact"><span><strong>{{ trialDaysRemaining }} {{ trialDaysRemaining === 1 ? 'day' : 'days' }} left in your trial</strong><small>· Upgrade to keep your workspace active</small></span><button class="primary-button small" type="button" @click="openSettingsTab('billing')">Upgrade →</button></div>
        <div v-else-if="!adminSurfaceMode && billingReadOnly" class="trial-banner danger compact"><span><strong>Your workspace is read-only</strong><small>· Restore billing to resume publishing</small></span><button class="primary-button small" type="button" @click="openSettingsTab('billing')">Restore billing →</button></div>
        <div v-if="!adminSurfaceMode && billingFlow !== 'idle'" :class="['billing-return-banner', billingFlow === 'complete' ? 'success' : billingFlow === 'cancelled' ? 'neutral' : 'warning']" role="status" aria-live="polite"><span><strong>{{ billingMessage }}</strong><small v-if="billingFlow === 'processing'">We’ll keep checking for the signed Stripe webhook.</small><small v-else-if="billingFlow === 'pending'">Your data is safe. Refresh this page to check again.</small></span><button v-if="billingFlow === 'pending'" class="outline-button small" type="button" @click="void retryBillingRefresh()">Refresh</button></div>
        <section v-if="!adminSurfaceMode && onboardingNeedsAttention && workspaceOnboarding" class="onboarding-validation-banner" role="alert">
          <div class="onboarding-validation-copy"><p class="eyebrow">Website status: Needs attention</p><h2>{{ workspaceOnboarding.message }}</h2><p>{{ workspaceOnboarding.suggestedAction }}</p><small>Reason: {{ onboardingReasonLabel }}</small></div>
          <div class="onboarding-validation-actions"><button class="outline-button small" type="button" @click="view = 'knowledge'">Add source / upload document</button><button class="primary-button small" type="button" :disabled="Boolean(sourceActionLoading)" @click="refreshWebsiteKnowledge">{{ sourceActionLoading ? 'Trying again…' : 'Try again' }}</button></div>
        </section>

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
            :website-preview-endpoint="websitePreviewEndpoint"
            :website-preview-token="websitePreviewToken"
            :website-brand-colors="websiteBrandColors"
            :model="agentModel"
            :saved-message="savedMessage"
            :auth-ready="Boolean(authSnapshot)"
            :auth-user-name="authSnapshot?.user.name ?? ''"
            :auth-user-email="authSnapshot?.user.email ?? ''"
            :public-demo-mode="publicDemoMode"
            :billing-read-only="billingReadOnly"
            :ownership-status="ownershipVerification?.status ?? null"
            :publishing="agentPublishing"
            :publishing-loading="agentPublishingLoading"
            :install="widgetInstall"
            :install-message="widgetInstallMessage"
            :verification-message="widgetVerificationMessage"
            :verification-loading="widgetVerificationLoading"
            :verification-method="verificationMethod"
            :verification-instructions="verificationInstructions"
            :verification-token="verificationToken"
            :ownership-message="verificationMessage"
            :ownership-error="verificationError"
            :knowledge="workspaceKnowledge ?? null"
            :knowledge-gaps="knowledgeGaps"
            :knowledge-ready="setupSteps.find((step) => step.id === 'knowledge_ready')?.complete ?? false"
            :suggested-questions="suggestedQuestions"
            :agent-tested="setupSteps.find((step) => step.id === 'agent_tested')?.complete ?? false"
            :installation-support-loading="installationSupportOwnerLoading"
            :installation-support-message="installationSupportOwnerMessage"
            :installation-support-error="installationSupportOwnerError"
            :open-support-request="openSupportRequest"
            :test="agentTestModel"
            :capabilities="agentCapabilities"
            :workflows="actionFlows"
            @select-tab="selectAgentTab"
            @save="saveAgent"
            @logo-preview="handleWorkspaceLogoPreview"
            @publish="publishAgent"
            @open-knowledge="navigateToWorkspaceView('knowledge')"
            @view-dashboard="navigateToWorkspaceView('overview')"
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
            @open-capability-action="openCapabilityAction"
            @open-workflow="openAgentWorkflow"
          />
        </div>

        <SupportCenter
          v-else-if="view === 'support'"
          :business-name="businessName"
          :website-url="websiteUrl"
          :auth-ready="Boolean(authSnapshot) && !supportViewMode"
          :public-demo-mode="publicDemoMode"
          :auth-user-name="authSnapshot?.user.name ?? ''"
          :auth-user-email="authSnapshot?.user.email ?? ''"
          :loading="supportLoading"
          :error="supportError"
          :context="supportContext"
          :cases="supportCases"
          :submitting="supportSubmitting"
          :submit-error="supportSubmitError"
          :submit-message="supportSubmitMessage"
          :initial-category="supportCategory"
          :initial-provider="supportProvider"
          :initial-connection-id="supportConnectionId"
          :initial-page="supportSourcePage"
          :open-report-request="supportOpenReportRequest"
          @refresh="loadSupport"
          @require-auth="openAuth('signin')"
          @submit-case="submitSupportCase"
          @navigate="(target) => target === 'install' ? selectAgentTab('install') : target === 'knowledge' ? navigateToWorkspaceView('knowledge') : target === 'connections' ? navigateToWorkspaceView('connections') : target === 'actions' ? navigateToWorkspaceView('actions') : target === 'billing' ? openSettingsTab('billing') : openSettingsTab('verification')"
        />

        <div v-else-if="view === 'overview'" class="view-content">
          <div v-if="workspaceError" class="panel workspace-message"><strong>Workspace data unavailable</strong><p>{{ workspaceError }}</p><button class="outline-button small" type="button" @click="loadBusinessWorkspace(demoSlug)">Retry</button></div>
          <div v-else-if="authSnapshot && !availableBusinesses.length" class="panel workspace-message"><strong>Your organization is ready</strong><p>Add your first business to crawl its website, create the agent, and start collecting real conversations and leads.</p><button class="primary-button small" type="button" @click="openAddBusiness">+ Add your first business</button></div>
          <template v-else>
            <div class="metric-grid">
              <article class="metric-card blue-tint"><span class="metric-icon blue"><UserCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ workspaceStats?.leads ?? 0 }}</strong><span>Leads captured</span><em>{{ workspaceStats?.leads ? 'Live records' : 'No leads yet' }}</em></article>
              <article class="metric-card green-tint"><span class="metric-icon green"><CalendarCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ workspaceStats?.bookingClicks ?? 0 }}</strong><span>Booking clicks</span><em>{{ workspaceStats?.conversations ?? 0 }} conversations</em></article>
              <article class="metric-card orange-tint"><span class="metric-icon orange"><CircleHelp :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ workspaceStats?.unansweredQuestions ?? 0 }}</strong><span>Open answer gaps</span><em class="negative">From live questions</em></article>
              <article class="metric-card purple-tint"><span class="metric-icon purple"><Database :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ readinessScore }}%</strong><span>Knowledge readiness</span><div class="metric-progress"><span :style="{ width: `${readinessScore}%` }"></span></div></article>
            </div>
            <div class="dashboard-grid">
              <article class="panel chart-panel"><div class="panel-heading"><div><h2>Conversations & leads</h2><p>Last 30 days · live records</p></div><div class="legend"><span><i class="blue-dot"></i> Conversations</span><span><i class="orange-dot"></i> Leads</span></div></div><div v-if="workspaceStats?.trend?.length" class="live-chart" aria-label="Conversations and leads trend"><div v-for="point in workspaceStats.trend" :key="point.label" class="live-chart-column"><div class="live-chart-bars"><span class="live-bar blue" :style="{ height: `${point.conversations / chartMax * 100}%` }"></span><span class="live-bar orange" :style="{ height: `${point.leads / chartMax * 100}%` }"></span></div><small>{{ point.label }}</small></div></div><div v-else class="diagnostics-empty">No activity recorded yet.</div></article>
              <article class="panel readiness-panel"><div class="panel-heading"><div><h2>Knowledge readiness</h2><p>Indexed content, semantic coverage, and open gaps</p></div><strong class="readiness-score">{{ readinessScore }}%</strong></div><div class="readiness-ring" :style="{ background: `conic-gradient(#7256c9 0deg ${readinessScore * 3.6}deg, #edf0f6 ${readinessScore * 3.6}deg 360deg)` }"><div><strong>{{ readinessScore }}</strong><span>/100</span></div></div><div class="readiness-list"><div><span :class="workspaceKnowledge?.indexed ? 'check' : 'warning'">{{ workspaceKnowledge?.indexed ? '✓' : '!' }}</span> Website indexed <strong>{{ workspaceKnowledge?.sourceCount ?? 0 }} sources</strong></div><div><span :class="semanticSearchHealthy ? 'check' : 'warning'">{{ semanticSearchHealthy ? '✓' : '!' }}</span> Semantic embeddings <strong>{{ workspaceKnowledge?.semantic?.coveragePercent ?? 0 }}%</strong></div><div><span :class="workspaceStats?.unansweredQuestions ? 'warning' : 'check'">{{ workspaceStats?.unansweredQuestions ? '!' : '✓' }}</span> Open answer gaps <strong>{{ workspaceStats?.unansweredQuestions ?? 0 }}</strong></div><div><span class="check">✓</span> Retrieval mode <strong>{{ semanticSearchLabel }}</strong></div></div></article>
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
              <div v-else class="evaluation-empty"><span class="empty-icon"><CircleCheck :size="30" :stroke-width="1.8" aria-hidden="true" /></span><div><strong>Know whether the assistant is ready to sell.</strong><p>This check uses the business’s indexed content, measures citations and fallback behavior, and shows what needs review.</p></div></div>
            </article>
            <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>What visitors are asking</p></div><button class="text-button" type="button" @click="view = 'conversations'">See all →</button></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Recommended actions</h2><p>Open gaps from live conversations</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Add answer</button></div></div><div v-else class="diagnostics-empty">No open actions. New low-confidence questions will appear here.</div></article><article class="panel"><div class="panel-heading"><div><h2>Visitor friction</h2><p>Owner-safe experience insight · last 30 days</p></div><span v-if="workspaceStats?.experienceInsights?.totalSignals" class="status-pill qualified">{{ workspaceStats.experienceInsights.totalSignals }} signals</span></div><template v-if="workspaceStats?.experienceInsights?.headline"><strong>{{ workspaceStats.experienceInsights.headline }}</strong><p v-if="workspaceStats.experienceInsights.suggestedImprovement">Suggested improvement: {{ workspaceStats.experienceInsights.suggestedImprovement }}</p><div v-if="workspaceStats.experienceInsights.topFriction.length" class="question-list"><div v-for="item in workspaceStats.experienceInsights.topFriction.slice(0, 3)" :key="item.type"><span>{{ formatLabel(item.type) }}</span><strong>{{ item.count }}</strong></div></div></template><div v-else class="diagnostics-empty">No visitor friction pattern detected yet.</div></article></div>
          </template>
        </div>

        <div v-else-if="view === 'inbox'" class="view-content inbox-view">
          <div class="inbox-hero">
            <div class="inbox-hero-copy">
              <div class="inbox-kicker"><span class="inbox-live-dot"></span>Conversation control room</div>
              <h2>Keep every customer conversation moving.</h2>
              <p>Review the moments that need a human, keep your AI assistant in context, and close the loop without losing the thread.</p>
              <div class="inbox-hero-meta"><span><Check :size="14" :stroke-width="2.2" aria-hidden="true" /> AI + team synced</span><span class="inbox-hero-divider"></span><span>{{ inboxLoading ? 'Syncing queue…' : 'Live workspace queue' }}</span></div>
            </div>
            <div class="inbox-hero-actions">
              <span v-if="inboxMessage" class="saved-message">✓ {{ inboxMessage }}</span>
              <button class="outline-button small inbox-refresh-button" type="button" :disabled="inboxLoading" @click="() => loadInbox()"><RefreshCw :size="14" :stroke-width="1.9" :class="{ 'is-spinning': inboxLoading }" aria-hidden="true" />{{ inboxLoading ? 'Refreshing…' : 'Refresh queue' }}</button>
            </div>
          </div>
          <p v-if="inboxError" class="form-error">{{ inboxError }}</p>

          <div class="inbox-summary-grid" aria-label="Inbox summary">
            <article class="inbox-summary-card attention"><span class="inbox-summary-icon"><TriangleAlert :size="17" :stroke-width="2" aria-hidden="true" /></span><span class="inbox-summary-copy"><strong>{{ inboxNeedsResponseCount }}</strong><small>Needs response</small><em>Waiting for your team</em></span></article>
            <article class="inbox-summary-card unread"><span class="inbox-summary-icon"><MessageSquare :size="17" :stroke-width="2" aria-hidden="true" /></span><span class="inbox-summary-copy"><strong>{{ inboxUnreadCount }}</strong><small>Unread messages</small><em>From visitors</em></span></article>
            <article class="inbox-summary-card ai"><span class="inbox-summary-icon"><Sparkles :size="17" :stroke-width="2" aria-hidden="true" /></span><span class="inbox-summary-copy"><strong>{{ inboxAiCount }}</strong><small>AI in motion</small><em>Handled automatically</em></span></article>
            <article class="inbox-summary-card resolved"><span class="inbox-summary-icon"><CircleCheck :size="17" :stroke-width="2" aria-hidden="true" /></span><span class="inbox-summary-copy"><strong>{{ inboxResolvedCount }}</strong><small>Resolved</small><em>Closed conversations</em></span></article>
          </div>

          <div class="inbox-queue-toolbar">
            <div class="inbox-queue-view"><span class="inbox-toolbar-label">Queue view</span><div class="inbox-assignment-shortcuts" aria-label="Inbox assignment shortcuts"><button type="button" :class="{ active: inboxStatusFilter === 'all' && inboxAssignmentFilter === 'all' }" @click="setInboxQueue('all')">All</button><button v-if="authSnapshot?.user.id" type="button" :class="{ active: inboxAssignmentFilter === 'mine' }" @click="setInboxQueue('all', 'mine')">Assigned to me</button><button type="button" :class="{ active: inboxStatusFilter === 'WAITING_FOR_STAFF' }" @click="setInboxQueue('WAITING_FOR_STAFF')">Waiting</button><button type="button" :class="{ active: inboxStatusFilter === 'RESOLVED' }" @click="setInboxQueue('RESOLVED')">Resolved</button><button type="button" :class="{ active: inboxAssignmentFilter === 'unassigned' }" @click="setInboxQueue('all', 'unassigned')">Unassigned</button></div></div>
            <div class="inbox-queue-count"><strong>{{ inboxTotal }}</strong> {{ inboxTotal === 1 ? 'conversation' : 'conversations' }}<span></span><strong>{{ inboxUnreadCount }}</strong> unread</div>
          </div>

          <article v-if="selectedInboxConversation?.notes?.length" class="panel inbox-notes-panel"><div class="panel-heading"><div><p class="eyebrow">Staff only</p><h3>Internal notes</h3><p>These notes stay in the Inbox and are never sent to the visitor.</p></div></div><div class="internal-note-list"><div v-for="note in selectedInboxConversation.notes" :key="note.id" class="internal-note"><strong>{{ note.authorName || 'Team member' }}</strong><small>{{ new Date(note.createdAt).toLocaleString() }}</small><p>{{ note.content }}</p></div></div></article>

          <div class="panel lead-filters inbox-filter-bar"><div class="inbox-filter-copy"><span class="inbox-filter-icon" aria-hidden="true"><Package :size="16" :stroke-width="1.9" /></span><span><strong>Filter queue</strong><small>Focus your next response</small></span></div><label><span>Status</span><select v-model="inboxStatusFilter" @change="inboxPage = 1; loadInbox()"><option value="all">All conversations</option><option value="WAITING_FOR_STAFF">Waiting for staff</option><option value="FOLLOW_UP_PENDING">Follow-up pending</option><option value="HUMAN_ACTIVE">Human active</option><option value="AI_ASSISTED">AI assisted</option><option value="AI_ACTIVE">AI active</option><option value="RESOLVED">Resolved</option><option value="EXPIRED">Expired</option></select></label><label><span>Assignment</span><select v-model="inboxAssignmentFilter" @change="inboxPage = 1; loadInbox()"><option value="all">All assignments</option><option value="mine">Assigned to me</option></select></label><span class="inbox-filter-result"><strong>{{ inboxTotal }}</strong> {{ inboxTotal === 1 ? 'thread' : 'threads' }}<i>·</i>{{ inboxUnreadCount }} unread</span></div>

          <div :class="['dashboard-grid', 'conversation-inbox-grid', { 'inbox-detail-open': selectedInboxConversation }]">
            <article class="panel table-panel inbox-table-panel">
              <div class="inbox-table-titlebar"><div><span class="inbox-table-kicker">Live queue</span><h3>Conversations</h3></div><span class="inbox-table-count">{{ inboxTotal }} total</span></div>
              <div class="table-heading"><span>Conversation</span><span>Status</span><span>Activity</span></div>
              <div class="collection-viewport inbox-collection-viewport">
                <div v-if="!inboxConversations.length" class="inbox-empty-state"><span class="inbox-empty-icon"><Inbox :size="22" :stroke-width="1.8" aria-hidden="true" /></span><strong>No conversations in this view</strong><p>Try a different filter or check back when a visitor needs your team.</p></div>
                <button v-for="conversation in inboxConversations" :key="conversation.id" :class="['table-row', 'table-row-button', { selected: selectedInboxConversation?.id === conversation.id }]" type="button" @click="openInboxConversation(conversation)">
                  <div class="lead-name"><span class="lead-avatar" aria-hidden="true"><Package :size="17" :stroke-width="1.9" /></span><span><strong>{{ conversation.lead?.name || 'Visitor conversation' }}</strong><small>{{ conversation.lastMessage?.content || 'No messages yet' }}</small><small class="inbox-assignee-line">{{ inboxAssignmentLabel(conversation) }}<span v-if="conversation.assignedUserId && conversation.assignedUserId !== authSnapshot?.user.id"> · View only</span></small></span></div>
                  <span :class="['status-pill', conversation.status === 'RESOLVED' ? 'booked' : conversation.status === 'HUMAN_ACTIVE' ? 'active' : conversation.status === 'AI_ACTIVE' || conversation.status === 'AI_ASSISTED' ? 'new' : 'qualified']"><span class="status-pill-dot"></span>{{ formatLabel(conversation.status) }}<b v-if="conversation.unreadCount">{{ conversation.unreadCount }}</b></span>
                  <small class="inbox-activity-time">{{ new Date(conversation.lastActivityAt).toLocaleString() }}</small>
                </button>
              </div>
              <div v-if="inboxTotal" class="collection-pagination"><span>Showing {{ inboxRangeStart }}–{{ inboxRangeEnd }} of {{ inboxTotal }}</span><div><button class="outline-button small" type="button" :disabled="inboxLoading || !inboxHasPrevious" @click="() => loadInbox(inboxPage - 1)">Previous</button><button class="outline-button small" type="button" :disabled="inboxLoading || !inboxHasNext" @click="() => loadInbox(inboxPage + 1)">Next</button></div></div>
            </article>
            <article v-if="selectedInboxConversation" class="panel inbox-detail-panel">
              <div class="panel-heading inbox-detail-heading">
                <div><button class="mobile-inbox-back" type="button" @click="closeInboxConversation"><ArrowLeft :size="16" :stroke-width="1.8" aria-hidden="true" /> Back to Inbox</button><div class="inbox-detail-kicker"><span class="inbox-live-dot"></span>Conversation detail</div><h2>{{ selectedInboxConversation.lead?.name || 'Visitor' }}</h2><p>{{ selectedInboxConversation.lead?.intent || 'General inquiry' }} <span>·</span> {{ formatLabel(selectedInboxConversation.status) }}</p></div>
                <div class="toolbar-actions">
                  <select v-if="canManageTeam && selectedInboxConversation.status !== 'RESOLVED'" class="inbox-assignee-select" :value="selectedInboxConversation.assignedUserId || ''" aria-label="Assign conversation" @change="assignInboxConversation(($event.target as HTMLSelectElement).value)"><option value="" disabled>Assign to…</option><option v-for="member in teamMembers.filter((member) => member.role === 'owner' || member.role === 'admin' || member.role === 'staff')" :key="member.id" :value="member.id">{{ member.name }} · {{ formatLabel(member.role) }}</option></select>
                  <span v-if="selectedConversationReadOnly" class="inbox-view-only-badge">View only · {{ selectedConversationOwnerLabel }} is handling this</span>
                  <button v-if="selectedInboxConversation.status !== 'HUMAN_ACTIVE' && selectedInboxConversation.status !== 'RESOLVED' && !selectedConversationReadOnly" class="primary-button small" type="button" :disabled="inboxActionLoading" @click="takeOverConversation">Take over</button><button v-if="selectedInboxConversation.status === 'HUMAN_ACTIVE' && !selectedConversationReadOnly" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="returnConversationToAi">Return to AI</button><button v-if="selectedInboxConversation.status !== 'RESOLVED' && !selectedConversationReadOnly" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="resolveConversation">Resolve</button>
                </div>
              </div>
              <div class="inbox-ownership-state"><span :class="['inbox-ownership-dot', { active: selectedInboxConversation.assignedUserId }]" aria-hidden="true"></span><strong>{{ selectedInboxConversation.assignedUserId ? `${selectedConversationOwnerLabel} is handling this conversation` : 'Unassigned' }}</strong><small>{{ selectedInboxConversation.assignedUserId ? 'Only the owner can send customer-facing replies.' : 'The first staff member to take over becomes the owner.' }}</small></div>
              <div v-if="selectedInboxConversation.events?.length" class="inbox-audit-trail"><div class="inbox-audit-heading"><span>Activity</span><small>Ownership and handoff history</small></div><div v-for="event in selectedInboxConversation.events.slice(0, 8)" :key="event.id" class="inbox-audit-row"><span class="inbox-audit-dot" aria-hidden="true"></span><div><strong>{{ conversationEventLabel(event) }}</strong><small>{{ event.metadata?.name || (event.actorUserId === authSnapshot?.user.id ? 'You' : 'Team member') }} · {{ new Date(event.createdAt).toLocaleString() }}</small></div></div></div>
              <div ref="inboxThread" class="inbox-message-thread" @scroll="handleInboxThreadScroll"><div v-for="(message, index) in selectedInboxConversation.messages ?? []" :key="message.id || `${message.createdAt}-${message.role}-${index}`" :class="['message-thread-item', message.role, { 'message-pending': message.sendStatus === 'pending', 'message-failed': message.sendStatus === 'failed' }]"><small>{{ message.authorName || formatLabel(message.role) }} · {{ new Date(message.createdAt).toLocaleString() }}<span v-if="message.sendStatus === 'pending'"> · Sending…</span></small><p>{{ message.content }}</p><div v-if="message.sendStatus === 'failed'" class="message-send-failed"><span>Failed to send</span><button type="button" @click.stop="retryInboxReply(message)">Retry</button></div></div><div v-if="!(selectedInboxConversation.messages?.length)" class="diagnostics-empty">No messages to display.</div></div><button v-if="inboxNewMessageCount" class="inbox-new-message-indicator" type="button" @click="scrollInboxToLatest('smooth')">{{ inboxNewMessageCount }} new message{{ inboxNewMessageCount === 1 ? '' : 's' }} ↓</button><form class="question-form inbox-composer-form" @submit.prevent="sendInboxReply"><textarea ref="inboxComposer" v-model="inboxReply" rows="1" placeholder="Reply as your team…" :disabled="selectedInboxConversation.status !== 'HUMAN_ACTIVE' || selectedConversationReadOnly" @keydown="handleInboxComposerKeydown"></textarea><button class="primary-button small" type="submit" :disabled="!inboxReply.trim() || selectedInboxConversation.status !== 'HUMAN_ACTIVE' || selectedConversationReadOnly"><Send :size="14" :stroke-width="1.9" aria-hidden="true" />Send</button></form><form class="question-form" @submit.prevent="addInboxNote"><input v-model="inboxNote" type="text" placeholder="Add a private internal note…" /><button class="outline-button small" type="submit" :disabled="!inboxNote.trim() || inboxActionLoading">Add note</button></form>
            </article>
            <article v-else class="panel workspace-message inbox-select-state"><span class="inbox-select-icon"><MessageSquare :size="22" :stroke-width="1.8" aria-hidden="true" /></span><div><span class="inbox-table-kicker">Workspace context</span><strong>Select a conversation</strong><p>Choose a visitor conversation to review the thread, take over, or return it to AI.</p></div></article>
          </div>

        </div>

        <div v-else-if="view === 'team'" class="view-content">
          <div class="section-toolbar team-page-header"><div><p class="eyebrow team-eyebrow"><UsersRound :size="15" :stroke-width="2" aria-hidden="true" /> People and permissions</p><h2>Team access</h2><p>Invite staff, keep access business-scoped, and see who is active in the inbox.</p></div><span v-if="teamMessage" class="saved-message team-success" role="status"><CircleCheck :size="16" :stroke-width="2" aria-hidden="true" /> {{ teamMessage }}</span></div>
          <p v-if="teamError" class="form-error team-error" role="alert"><CircleAlert :size="16" :stroke-width="1.9" aria-hidden="true" /> {{ teamError }}</p>
          <article class="panel form-panel team-invite-panel"><div class="panel-heading team-invite-heading"><span class="team-card-icon"><UserRoundPlus :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><p class="eyebrow">Invite people you trust</p><h2>Invite a team member</h2><p>They can sign in with this email to accept access.</p></div></div><form class="team-invite-form" @submit.prevent="inviteTeamMember"><div class="team-invite-grid"><label><span class="field-label"><UsersRound :size="14" :stroke-width="1.8" aria-hidden="true" /> Name <span class="optional">Optional</span></span><input v-model="teamInviteName" type="text" autocomplete="name" placeholder="Alex Morgan" /></label><label><span class="field-label"><Mail :size="14" :stroke-width="1.8" aria-hidden="true" /> Email</span><input v-model="teamInviteEmail" type="email" autocomplete="email" required placeholder="alex@business.com" /></label><label><span class="field-label"><ShieldCheck :size="14" :stroke-width="1.8" aria-hidden="true" /> Role</span><select v-model="teamInviteRole"><option value="staff">Staff</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><div class="toolbar-actions"><button class="primary-button small" type="submit" :disabled="teamLoading || !teamInviteEmail.trim()"><Send :size="15" :stroke-width="1.9" aria-hidden="true" />{{ teamLoading ? 'Inviting…' : 'Send invitation' }}</button><button class="outline-button small" type="button" :disabled="teamLoading" @click="loadTeam"><RefreshCw :size="15" :stroke-width="1.9" :class="{ 'is-spinning': teamLoading }" aria-hidden="true" />Refresh</button></div></div></form></article>
          <article class="panel table-panel team-table-panel"><div class="table-heading team-row"><span class="team-table-heading"><UsersRound :size="14" :stroke-width="1.8" aria-hidden="true" /> Team member</span><span class="team-table-heading"><ShieldCheck :size="14" :stroke-width="1.8" aria-hidden="true" /> Role</span><span class="team-table-heading"><CircleCheck :size="14" :stroke-width="1.8" aria-hidden="true" /> Status</span><span class="team-table-heading"><Activity :size="14" :stroke-width="1.8" aria-hidden="true" /> Last active</span></div><div v-if="!teamMembers.length" class="diagnostics-empty">No team members found.</div><div v-for="member in teamMembers" :key="member.id" class="table-row team-row"><div class="lead-name"><span class="lead-avatar">{{ member.name.charAt(0).toUpperCase() }}</span><span><strong>{{ member.name }}</strong><small>{{ member.email }}</small></span></div><select v-if="member.role !== 'owner'" :value="member.role" :disabled="teamLoading" :aria-label="`Role for ${member.name}`" @change="updateTeamMember(member, String(($event.target as HTMLSelectElement).value) as TeamMember['role'])"><option value="admin">Admin</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select><span v-else class="status-pill booked team-role-pill"><ShieldCheck :size="13" :stroke-width="1.9" aria-hidden="true" /> Owner</span><span :class="['status-pill', 'team-status-pill', member.status === 'active' ? 'booked' : 'qualified']"><CircleCheck v-if="member.status === 'active'" :size="13" :stroke-width="1.9" aria-hidden="true" /><CircleAlert v-else :size="13" :stroke-width="1.9" aria-hidden="true" /> {{ member.status }}</span><small class="team-last-active">{{ member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString() : 'Not active yet' }}</small></div></article>
        </div>


        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>Review, qualify, and export the contacts FrontDeskWise captured.</p></div><div class="toolbar-actions"><span v-if="leadExportMessage" class="saved-message">✓ {{ leadExportMessage }}</span><button class="outline-button small" type="button" :disabled="leadsLoading" @click="loadLeads()">{{ leadsLoading ? 'Refreshing…' : 'Refresh' }}</button><button class="outline-button small" type="button" :disabled="!visibleLeads.length" @click="exportLeadsCsv">Export CSV</button><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div></div><p v-if="leadsError" class="form-error">{{ leadsError }}</p><div class="panel lead-filters"><label>Search<input v-model="leadSearch" type="search" placeholder="Name, email, intent…" /></label><label>Status<select v-model="leadStatusFilter"><option value="all">All statuses</option><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label><span>{{ visibleLeads.length }} of {{ leads.length }} lead{{ leads.length === 1 ? '' : 's' }}</span></div><div class="panel table-panel collection-panel-scroll"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-if="!visibleLeads.length && !leadsError" class="diagnostics-empty">{{ leads.length ? 'No leads match these filters.' : 'No leads captured yet.' }}</div><button v-for="lead in visibleLeads" :key="lead.id" class="table-row table-row-button" type="button" @click="openLeadDetail(lead)"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0).toUpperCase() }}</span><span><strong>{{ lead.name }}</strong><small>{{ lead.email || lead.phone || 'Contact details not provided' }}</small></span></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></button></div></div>


        <div v-else-if="view === 'knowledge'" class="view-content knowledge-workspace">
          <div class="knowledge-page-header">
            <div><p class="eyebrow">Knowledge</p><h2>Knowledge</h2><p>{{ knowledgeSourceRows.length }} connected source{{ knowledgeSourceRows.length === 1 ? '' : 's' }} available to your assistant · Last successful refresh {{ knowledgeLastSuccessfulRefresh }}.</p></div>
            <div class="knowledge-page-actions"><span v-if="knowledgeLoading" class="conversation-status">Refreshing…</span><button class="outline-button small" type="button" :disabled="Boolean(sourceActionLoading)" @click="refreshWebsiteKnowledge">{{ sourceActionLoading ? 'Refreshing…' : 'Refresh website knowledge' }}</button><button class="primary-button small" type="button" :disabled="knowledgeTestAction.disabled" @click="openAgentTest(knowledgeTestContext === 'answer' ? resolvedKnowledgeQuestion : undefined)">Test assistant</button><button class="text-button" type="button" @click="openSupportReport('knowledge')">Report a problem</button></div>
          </div>

          <nav class="knowledge-tabs" role="tablist" aria-label="Knowledge sections">
            <button type="button" role="tab" :aria-selected="knowledgeTab === 'overview'" :class="{ active: knowledgeTab === 'overview' }" @click="knowledgeTab = 'overview'">Overview</button>
            <button type="button" role="tab" :aria-selected="knowledgeTab === 'sources'" :class="{ active: knowledgeTab === 'sources' }" @click="knowledgeTab = 'sources'">Sources <span>{{ knowledgeSourceRows.length }}</span></button>
            <button type="button" role="tab" :aria-selected="knowledgeTab === 'qna'" :class="{ active: knowledgeTab === 'qna' }" @click="knowledgeTab = 'qna'">Q&amp;A <span>{{ knowledgeQnas.length }}</span></button>
            <button type="button" role="tab" :aria-selected="knowledgeTab === 'gaps'" :class="{ active: knowledgeTab === 'gaps' }" @click="knowledgeTab = 'gaps'">Answer gaps <span v-if="knowledgeGapCounts.open">{{ knowledgeGapCounts.open }}</span></button>
            <button type="button" role="tab" :aria-selected="knowledgeTab === 'quality'" :class="{ active: knowledgeTab === 'quality' }" @click="knowledgeTab = 'quality'">Quality</button>
          </nav>

          <p v-if="knowledgeError" class="form-error knowledge-inline-message">{{ knowledgeError }}</p>
          <p v-if="documentsError" class="form-error knowledge-inline-message">{{ documentsError }}</p>
          <p v-if="documentsMessage" class="saved-message knowledge-inline-message">✓ {{ documentsMessage }}</p>
          <p v-if="embeddingMessage" class="saved-message knowledge-inline-message">✓ {{ embeddingMessage }}</p>
          <article v-if="authSnapshot && !availableBusinesses.length" class="panel workspace-message knowledge-start-panel"><strong>Start your knowledge base</strong><p>Add your first business website to make reliable information available for customer questions.</p><button class="primary-button small" type="button" @click="openAddBusiness">Add website / domain →</button></article>

          <template v-if="!authSnapshot || availableBusinesses.length">
            <section v-if="knowledgeTab === 'overview'" class="knowledge-tab-content" aria-labelledby="knowledge-overview-heading">
              <div class="knowledge-health-strip"><div><span class="knowledge-health-indicator" :class="knowledgeHealthLabel === 'Healthy' ? 'healthy' : 'attention'"></span><div><p class="eyebrow">Knowledge health</p><h3 id="knowledge-overview-heading">{{ knowledgeHealthLabel }}</h3></div></div><span class="status-pill" :class="knowledgeHealthLabel === 'Healthy' ? 'booked' : knowledgeHealthLabel === 'Needs attention' ? 'new' : 'qualified'">{{ readinessScore }}% ready</span></div>
              <div class="knowledge-metric-strip"><div><strong>{{ knowledgeWebsiteSources.length }}</strong><span>Website pages</span><small>{{ knowledgeWebsiteCoverage.detail }}</small></div><div><strong>{{ workspaceKnowledge?.chunkCount ?? 0 }}</strong><span>Knowledge sections</span><small>Searchable content for your assistant</small></div><div><strong>{{ knowledgeGapCounts.open }}</strong><span>Open answer gaps</span><small>{{ knowledgeGapCounts.open ? 'Questions to review' : 'Nothing waiting' }}</small></div><div><strong>{{ knowledgeLastSuccessfulRefresh }}</strong><span>Last successful refresh</span><small>Across connected sources</small></div></div>
              <div class="knowledge-overview-actions"><div class="knowledge-refresh-control"><button class="primary-button" type="button" :disabled="Boolean(sourceActionLoading)" @click="refreshWebsiteKnowledge">{{ sourceActionLoading ? 'Scanning website…' : 'Refresh website knowledge' }}</button><p>Re-scan your website for new or updated pages and refresh what your assistant knows.</p><span v-if="sourceActionLoading" class="knowledge-refresh-progress" role="status" aria-live="polite">Scanning website… <span>Discovering pages</span> → <span>Reading content</span> → <span>Updating knowledge</span></span></div><label class="outline-button document-upload-button">{{ documentsLoading ? 'Working…' : 'Upload document' }}<input type="file" accept=".pdf,.txt,.md,.csv,.json,.rtf,.docx,.xls,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/json" :disabled="documentsLoading || !authSnapshot || !selectedBusinessId()" @change="uploadDocument" /></label><div class="knowledge-more-actions"><button class="outline-button knowledge-more-trigger" type="button" aria-label="More website knowledge actions" :aria-expanded="knowledgeMoreOpen" @click="knowledgeMoreOpen = !knowledgeMoreOpen"><MoreHorizontal :size="18" :stroke-width="1.8" aria-hidden="true" /></button><div v-if="knowledgeMoreOpen" class="knowledge-more-menu" role="menu"><button type="button" role="menuitem" @click="knowledgeTab = 'quality'; knowledgeMoreOpen = false">View crawl details</button><button type="button" role="menuitem" @click="knowledgeTab = 'sources'; knowledgeMoreOpen = false">View website pages</button><button type="button" role="menuitem" :disabled="Boolean(embeddingLoading)" @click="knowledgeMoreOpen = false; void reindexKnowledge()">{{ embeddingLoading ? 'Rebuilding…' : 'Rebuild knowledge index' }}</button></div></div></div>
              <button v-if="knowledgeSourcesNeedAttention" class="knowledge-warning-row" type="button" @click="knowledgeTab = 'sources'"><span class="knowledge-warning-icon">!</span><span><strong>{{ (workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0) }} source{{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? '' : 's' }} {{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? 'needs' : 'need' }} attention</strong><small>Review the source status before your next test.</small></span><span>Review source <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></span></button>
              <button v-if="knowledgeSourcesNeedAttention" class="knowledge-warning-row" type="button" @click="knowledgeTab = 'sources'"><span class="knowledge-warning-icon">!</span><span><strong>{{ (workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0) }} source{{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? '' : 's' }} {{ ((workspaceKnowledge?.pendingSources ?? 0) + (workspaceKnowledge?.failedSources ?? 0)) === 1 ? 'needs' : 'need' }} attention</strong><small>Review the source status before your next test.</small></span><span>View issues <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></span></button>
              <button v-if="knowledgeCoverageNeedsAttention" class="knowledge-warning-row" type="button" @click="knowledgeTab = 'quality'"><span class="knowledge-warning-icon">!</span><span><strong>Partial knowledge — {{ knowledgeCoverage?.successfulPages ?? 0 }} page{{ (knowledgeCoverage?.successfulPages ?? 0) === 1 ? '' : 's' }} captured, {{ knowledgeCoverage?.discoveredUrls ?? 0 }} public pages detected</strong><small>FrontDeskWise found more pages on this website but hasn’t indexed them yet.</small></span><span>View crawl details <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></span></button>
              <div class="knowledge-next-step"><div><p class="eyebrow">Next best action</p><strong>{{ knowledgeHasOpenGaps ? 'Answer the questions visitors ask most.' : knowledgeSourcesNeedAttention ? 'Review the source that needs attention.' : knowledgeCoverageNeedsAttention ? 'Finish indexing the public website.' : 'Test a representative customer question.' }}</strong><small>{{ knowledgeHasOpenGaps ? `${knowledgeGapCounts.open} open answer gap${knowledgeGapCounts.open === 1 ? '' : 's'} are ready for review.` : knowledgeCoverageNeedsAttention ? 'Review crawl coverage before treating website knowledge as complete.' : 'Keep the path from source to answer easy to verify.' }}</small></div><button class="text-button" type="button" @click="knowledgeHasOpenGaps ? reviewKnowledgeGaps() : knowledgeCoverageNeedsAttention ? (knowledgeTab = 'quality') : openAgentTest()">{{ knowledgeHasOpenGaps ? 'Review answer gaps →' : knowledgeCoverageNeedsAttention ? 'View crawl details →' : 'Test assistant →' }}</button></div>
            </section>

            <section v-else-if="knowledgeTab === 'sources'" class="knowledge-tab-content" aria-labelledby="knowledge-sources-heading">
              <div class="knowledge-section-heading"><div><p class="eyebrow">Source management</p><h2 id="knowledge-sources-heading">Sources</h2><p>Group connected knowledge first, then open the page-level view when you need detail.</p></div><label class="outline-button small document-upload-button">{{ documentsLoading ? 'Working…' : 'Upload document' }}<input type="file" accept=".pdf,.txt,.md,.csv,.json,.rtf,.docx,.xls,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/json" :disabled="documentsLoading || !authSnapshot || !selectedBusinessId()" @change="uploadDocument" /></label></div>
              <div v-if="sourceActionMessage" class="saved-message source-action-message">✓ {{ sourceActionMessage }}</div>
              <div class="knowledge-source-groups" aria-label="Knowledge source groups">
                <article v-for="group in knowledgeSourceGroups" :key="group.key" class="knowledge-source-group">
                  <div class="knowledge-source-group-summary"><span :class="['knowledge-source-icon', group.key === 'website' ? 'website' : group.key === 'documents' ? 'document' : 'system']"><BookOpen v-if="group.key === 'website'" :size="17" :stroke-width="1.8" aria-hidden="true" /><FileText v-else-if="group.key === 'documents'" :size="17" :stroke-width="1.8" aria-hidden="true" /><Database v-else :size="17" :stroke-width="1.8" aria-hidden="true" /></span><div><strong>{{ group.label }}</strong><small>{{ group.detail }}</small></div><span :class="['status-pill', group.status === 'ready' ? 'booked' : group.status === 'attention' ? 'new' : 'qualified']">{{ group.statusLabel }}</span><button v-if="group.expandable" class="outline-button small" type="button" @click="toggleKnowledgeSourceGroup(group.key)">{{ knowledgeSourceGroupOpen === group.key ? 'Hide pages' : group.key === 'website' ? 'View pages' : 'View documents' }}</button><button v-else-if="group.key === 'connected'" class="outline-button small" type="button" @click="view = 'connections'">Manage</button><span v-else class="knowledge-source-group-count">{{ group.count }}</span></div>
                  <div v-if="knowledgeSourceGroupOpen === group.key" class="knowledge-source-group-detail">
                    <div class="knowledge-source-filter-bar"><label>Search<input v-model="knowledgeSourceSearch" type="search" placeholder="Page title, URL, or file name…" /></label><label>Type<select v-model="knowledgeSourceTypeFilter"><option value="all">All types</option><option value="website">Website pages</option><option value="document">Documents</option></select></label><label>Status<select v-model="knowledgeSourceStatusFilter"><option value="all">All statuses</option><option value="ready">Ready</option><option value="processing">Processing</option><option value="attention">Needs attention</option></select></label></div>
                    <div class="knowledge-source-table" role="table" aria-label="Knowledge sources"><div class="knowledge-source-table-head" role="row"><span>Source</span><span>Type</span><span>Status</span><span>Pages / chunks</span><span>Last refreshed</span><span>Actions</span></div><div v-if="!filteredKnowledgeSourceRows.length" class="knowledge-empty-row">No sources match these filters.</div><div v-for="row in visibleKnowledgeSourceRows" :key="`${row.type}-${row.id}`" class="knowledge-source-table-row" role="row"><div class="knowledge-source-name"><span :class="['knowledge-source-icon', row.type === 'Website' ? 'website' : 'document']"><BookOpen v-if="row.type === 'Website'" :size="15" :stroke-width="1.8" aria-hidden="true" /><FileText v-else :size="15" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>{{ row.title }}</strong><small>{{ row.detail }}</small></span></div><span class="knowledge-source-type">{{ row.type }}</span><span :class="['status-pill', row.status === 'ready' ? 'booked' : row.status === 'attention' ? 'new' : 'qualified']">{{ row.statusLabel }}</span><span class="knowledge-source-meta">{{ row.type === 'Website' ? 'Website page' : 'Private file' }}</span><span class="knowledge-source-meta">{{ formatKnowledgeRelativeTime(row.lastRefreshed) }}</span><div class="knowledge-source-actions"><button v-if="row.websiteSource" class="text-button" type="button" :disabled="Boolean(sourceActionLoading)" @click="recrawlSource(row.websiteSource)">{{ sourceActionLoading === row.id ? 'Refreshing…' : 'Refresh page' }}</button><button v-if="row.document" class="text-button" type="button" @click="downloadDocument(row.document)">Download</button><button v-if="row.websiteSource" class="text-button danger-text" type="button" :disabled="Boolean(sourceActionLoading)" @click="deleteSource(row.websiteSource)">Remove</button><button v-if="row.document" class="text-button danger-text" type="button" :disabled="documentsLoading" @click="deleteDocument(row.document)">Remove</button></div></div><div v-if="knowledgeSourceTotal" class="collection-pagination"><span>Showing {{ knowledgeSourceRangeStart }}–{{ knowledgeSourceRangeEnd }} of {{ knowledgeSourceTotal }}</span><div><button class="outline-button small" type="button" :disabled="!knowledgeSourceHasPrevious" @click="knowledgeSourcePage -= 1">Previous</button><button class="outline-button small" type="button" :disabled="!knowledgeSourceHasNext" @click="knowledgeSourcePage += 1">Next</button></div></div></div>
                  </div>
                </article>
              </div>
              <div v-if="!authSnapshot" class="knowledge-auth-note">Sign in to upload private documents or refresh website knowledge.</div>
            </section>

            <section v-else-if="knowledgeTab === 'qna'" class="knowledge-tab-content knowledge-qna-panel" aria-labelledby="knowledge-qna-heading">
              <div class="knowledge-section-heading"><div><p class="eyebrow">Owner-maintained knowledge</p><h2 id="knowledge-qna-heading">Business Q&amp;A</h2><p>Verified answers visitors can use immediately, with their origin and usage kept visible.</p></div><button v-if="canManageTeam" class="primary-button small" type="button" @click="openKnowledgeQnaEditor()">Add Q&amp;A</button></div>
              <div class="knowledge-qna-toolbar"><label>Search<input v-model="knowledgeQnaSearch" type="search" placeholder="Question or answer…" /></label><label>Status<select v-model="knowledgeQnaStatusFilter"><option value="ALL">All statuses</option><option value="VERIFIED">Verified</option><option value="NEEDS_REVIEW">Needs review</option><option value="CONFLICTED">Conflicted</option><option value="STALE">Stale</option><option value="ARCHIVED">Archived</option></select></label><span>{{ filteredKnowledgeQnas.length }} item{{ filteredKnowledgeQnas.length === 1 ? '' : 's' }} · {{ knowledgeQnaCounts.VERIFIED || 0 }} verified</span></div>
              <div class="knowledge-qna-table" role="table" aria-label="Business Q&A">
                <div class="knowledge-qna-table-head" role="row"><span>Question</span><span>Answer</span><span>Status</span><span>Source</span><span>Usage</span><span>Actions</span></div>
                <div v-if="!filteredKnowledgeQnas.length" class="knowledge-empty-row">No Business Q&amp;A items match this view. Answer an open gap to create the first verified answer.</div>
                <div v-for="qna in filteredKnowledgeQnas" :key="qna.id" class="knowledge-qna-table-row" role="row"><div><strong>{{ qna.canonicalQuestion }}</strong><small>{{ qna.variants.length }} variant{{ qna.variants.length === 1 ? '' : 's' }}</small></div><div><span>{{ qna.canonicalAnswer }}</span><small v-if="qna.answerGapId">Origin: Answer Gap</small></div><span :class="['status-pill', qna.status === 'VERIFIED' ? 'booked' : qna.status === 'CONFLICTED' || qna.status === 'STALE' ? 'new' : 'qualified']">{{ qnaStatusLabel(qna.status) }}</span><span class="knowledge-source-meta">{{ qnaSourceLabel(qna) }}<small>{{ formatKnowledgeRelativeTime(qna.updatedAt) }}</small></span><span class="knowledge-source-meta">{{ qna.timesUsed ? `Used ${qna.timesUsed} time${qna.timesUsed === 1 ? '' : 's'}` : 'Not used yet' }}<small v-if="qna.lastUsedAt">{{ formatKnowledgeRelativeTime(qna.lastUsedAt) }}</small></span><div class="knowledge-source-actions"><button class="text-button" type="button" @click="openKnowledgeQnaEditor(qna)">{{ canManageTeam ? 'Edit' : 'View' }}</button><button v-if="canManageTeam && qna.status !== 'VERIFIED' && qna.status !== 'ARCHIVED'" class="text-button" type="button" @click="reviewKnowledgeQna(qna)">Review</button><button v-if="canManageTeam && qna.status !== 'ARCHIVED'" class="text-button danger-text" type="button" @click="archiveKnowledgeQna(qna)">Archive</button></div></div>
              </div>
              <p v-if="knowledgeQnaMessage" class="saved-message">✓ {{ knowledgeQnaMessage }}</p><p v-if="knowledgeQnaError" class="form-error">{{ knowledgeQnaError }}</p>
            </section>

            <section v-else-if="knowledgeTab === 'gaps'" class="knowledge-tab-content knowledge-gaps-panel" aria-labelledby="knowledge-gaps-heading">
              <div class="knowledge-section-heading"><div><p class="eyebrow">Conversation signals</p><h2 id="knowledge-gaps-heading">Answer gaps</h2><p>Cluster repeated question variants and rank the work by operational impact.</p></div><span class="knowledge-count-note">{{ knowledgeGapCounts.open }} open</span></div>
              <div class="knowledge-filter-bar knowledge-gap-filters"><div class="knowledge-filter-group" role="group" aria-label="Answer gap status"><button type="button" :class="{ active: knowledgeGapFilter === 'open' }" @click="knowledgeGapFilter = 'open'">Open <span>{{ knowledgeGapCounts.open }}</span></button><button type="button" :class="{ active: knowledgeGapFilter === 'resolved' }" @click="knowledgeGapFilter = 'resolved'">Resolved <span>{{ knowledgeGapCounts.resolved }}</span></button><button type="button" :class="{ active: knowledgeGapFilter === 'ignored' }" @click="knowledgeGapFilter = 'ignored'">Ignored <span>{{ knowledgeGapCounts.ignored }}</span></button><button type="button" :class="{ active: knowledgeGapFilter === 'all' }" @click="knowledgeGapFilter = 'all'">All <span>{{ knowledgeGapCounts.all }}</span></button></div><label class="knowledge-inline-filter">Search<input v-model="knowledgeGapSearch" type="search" placeholder="Question or intent…" /></label><label class="knowledge-inline-filter">Intent<select v-model="knowledgeGapIntentFilter"><option value="all">All intents</option><option v-for="intent in knowledgeGapIntentOptions" :key="intent" :value="intent">{{ intent }}</option></select></label><label class="knowledge-inline-filter">Frequency<select v-model="knowledgeGapFrequencyFilter"><option value="all">Any frequency</option><option value="10+">10+ times</option><option value="3+">3+ times</option><option value="1">Once</option></select></label><label class="knowledge-inline-filter">Date range<select v-model="knowledgeGapRange"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label><label class="knowledge-sort-control"><span>Sort</span><select v-model="knowledgeGapSort"><option value="highestImpact">Highest impact</option><option value="mostAsked">Most asked</option><option value="newest">Newest</option></select></label></div>
              <div v-if="!visibleKnowledgeGaps.length" class="knowledge-empty-state"><CircleCheck :size="23" :stroke-width="1.8" aria-hidden="true" /><div><strong>{{ knowledgeGapFilter === 'open' ? 'No open answer gaps.' : 'No answer gaps in this view.' }}</strong><small>New low-confidence questions will appear here as visitors ask them.</small></div></div>
              <div v-else class="knowledge-gap-queue"><article v-for="gap in visibleKnowledgeGaps" :key="gap.question" class="knowledge-gap-row"><div class="knowledge-gap-main"><div class="knowledge-gap-topline"><span :class="['status-pill', gap.status === 'resolved' ? 'booked' : gap.status === 'ignored' ? 'qualified' : 'new']">{{ gap.status === 'resolved' ? 'Resolved' : gap.status === 'ignored' ? 'Ignored' : 'Open' }}</span><span class="knowledge-gap-intent">{{ gap.intent || 'General intent' }}</span></div><h3>{{ gap.question }}</h3><p>{{ gap.occurrenceCount }}× asked · {{ gap.variants?.length ?? 1 }} question variant{{ (gap.variants?.length ?? 1) === 1 ? '' : 's' }} · Last seen {{ formatKnowledgeRelativeTime(gap.lastSeenAt) }}</p></div><div class="knowledge-gap-stats"><strong>{{ gap.occurrenceCount }}×</strong><span>asked</span><small>{{ gap.variants?.length ?? 1 }} variant{{ (gap.variants?.length ?? 1) === 1 ? '' : 's' }}</small></div><div class="knowledge-gap-actions"><button class="primary-button small" type="button" @click="openKnowledgeAnswer(gap)">{{ canManageTeam ? (gap.status === 'resolved' ? 'Edit answer' : 'Add answer') : 'View' }}</button><div class="knowledge-gap-menu-wrap"><button class="outline-button small knowledge-gap-menu-trigger" type="button" aria-label="More answer gap actions" :aria-expanded="knowledgeGapMenuOpen === gap.question" @click="toggleKnowledgeGapMenu(gap.question)"><MoreHorizontal :size="16" :stroke-width="1.9" aria-hidden="true" /></button><div v-if="knowledgeGapMenuOpen === gap.question" class="knowledge-gap-menu" role="menu"><button type="button" role="menuitem" :disabled="Boolean(sourceActionLoading)" @click="knowledgeGapMenuOpen = null; refreshWebsiteKnowledge()">Refresh website knowledge</button><button v-if="gap.status === 'open' && canManageTeam" type="button" role="menuitem" :disabled="knowledgeAnswerSaving" @click="ignoreKnowledgeGap(gap); knowledgeGapMenuOpen = null">Ignore</button><button type="button" role="menuitem" @click="viewKnowledgeGapConversation">View conversation</button><button type="button" role="menuitem" @click="viewKnowledgeGapRetrieval(gap)">View retrieval details</button></div></div></div></article><div v-if="knowledgeGapTotal" class="collection-pagination"><span>Showing {{ knowledgeGapRangeStart }}–{{ knowledgeGapRangeEnd }} of {{ knowledgeGapTotal }} clusters</span><div><button class="outline-button small" type="button" :disabled="!knowledgeGapHasPrevious" @click="knowledgeGapPage -= 1">Previous</button><button class="outline-button small" type="button" :disabled="!knowledgeGapHasNext" @click="knowledgeGapPage += 1">Next</button></div></div></div>
            </section>

            <section v-else class="knowledge-tab-content" aria-labelledby="knowledge-quality-heading">
              <div class="knowledge-section-heading"><div><p class="eyebrow">Answer quality</p><h2 id="knowledge-quality-heading">Recent answer checks</h2><p>Only real knowledge interactions appear here. Greetings, handoff events, and waiting-for-staff messages stay out.</p></div><span class="knowledge-count-note">{{ knowledgeQualityTotal }} checks · {{ knowledgeQualityRangeLabel }}</span></div>
              <div v-if="knowledgeCoverage" class="knowledge-crawl-diagnostics"><div><p class="eyebrow">Website crawl coverage</p><strong>{{ knowledgeCoverage.successfulPages }} captured of {{ knowledgeCoverage.discoveredUrls }} discovered</strong><small>{{ knowledgeCoverage.attemptedUrls }} attempted · {{ knowledgeCoverage.skippedUrls }} skipped · {{ knowledgeCoverage.failedUrls }} failed · {{ knowledgeCoverage.coveragePercent }}% eligible coverage</small><small v-if="workspaceOnboarding?.crawlRun">Run {{ workspaceOnboarding.crawlRun.crawlRunId }} · {{ workspaceOnboarding.crawlRun.legacyCodePathUsed ? 'legacy discovery path' : workspaceOnboarding.crawlRun.backgroundWorkerUsed ? `worker ${workspaceOnboarding.crawlRun.workerJobId || 'used'}` : 'synchronous API crawl' }} · limit {{ workspaceOnboarding.crawlRun.maxPages }} pages / depth {{ workspaceOnboarding.crawlRun.maxDepth }}</small></div><div v-if="crawlReasonEntries(workspaceOnboarding ?? undefined).length" class="crawl-reason-list"><span v-for="([reason, count]) in crawlReasonEntries(workspaceOnboarding ?? undefined)" :key="reason">{{ formatLabel(reason) }} <strong>{{ count }}</strong></span></div></div>
              <div v-if="knowledgeQnaAttention.length" class="knowledge-warning-row knowledge-qna-warning-list"><span class="knowledge-warning-icon">!</span><span><strong>{{ knowledgeQnaAttention.length }} Q&amp;A item{{ knowledgeQnaAttention.length === 1 ? '' : 's' }} need review</strong><small>Conflicted or stale answers are excluded from trusted runtime matching.</small></span><button class="text-button" type="button" @click="knowledgeTab = 'qna'">Review Q&amp;A →</button></div>
              <div class="knowledge-quality-toolbar"><label>Search<input v-model="knowledgeQualitySearch" type="search" placeholder="Question or answer…" @input="queueKnowledgeQualitySearch" /></label><label>Date range<select v-model="knowledgeQualityRange" @change="applyKnowledgeQualityFilters"><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="all">All time</option></select></label><div class="knowledge-filter-group knowledge-quality-filters" role="group" aria-label="Answer quality filters"><button type="button" :class="{ active: knowledgeQualityFilter === 'all' }" @click="knowledgeQualityFilter = 'all'; applyKnowledgeQualityFilters()">All</button><button type="button" :class="{ active: knowledgeQualityFilter === 'grounded' }" @click="knowledgeQualityFilter = 'grounded'; applyKnowledgeQualityFilters()">Grounded</button><button type="button" :class="{ active: knowledgeQualityFilter === 'fallback' }" @click="knowledgeQualityFilter = 'fallback'; applyKnowledgeQualityFilters()">Fallback</button><button type="button" :class="{ active: knowledgeQualityFilter === 'needsReview' }" @click="knowledgeQualityFilter = 'needsReview'; applyKnowledgeQualityFilters()">Needs review</button></div></div>
              <div class="knowledge-quality-table" role="table" aria-label="Recent answer checks"><div class="knowledge-quality-table-head" role="row"><span>Question</span><span>Confidence</span><span>Outcome</span><span>Sources</span><span>Time</span></div><div v-if="knowledgeQualityLoading" class="knowledge-empty-row">Loading answer checks…</div><div v-else-if="!visibleRetrievalDiagnostics.length" class="knowledge-empty-row">No answer checks match this filter.</div><div v-for="diagnostic in visibleRetrievalDiagnostics" :key="`${diagnostic.conversationId}-${diagnostic.createdAt}`" class="knowledge-quality-table-row" role="row"><div><strong>{{ diagnostic.question }}</strong><small>{{ diagnostic.answer }}</small></div><span :class="['status-pill', diagnostic.confidenceBand === 'high' ? 'booked' : diagnostic.confidenceBand === 'medium' ? 'qualified' : 'new']">{{ Math.round(diagnostic.confidenceScore * 100) }}%</span><span :class="['status-pill', diagnostic.grounded ? 'booked' : 'new']">{{ diagnostic.grounded ? 'Grounded' : 'Fallback' }}</span><span class="knowledge-source-meta">{{ diagnostic.citations?.length ?? 0 }} source{{ (diagnostic.citations?.length ?? 0) === 1 ? '' : 's' }}</span><span class="knowledge-source-meta">{{ formatKnowledgeRelativeTime(diagnostic.createdAt) }}</span></div><div v-if="knowledgeQualityTotal" class="collection-pagination"><span>Showing {{ knowledgeQualityRangeStart }}–{{ knowledgeQualityRangeEnd }} of {{ knowledgeQualityTotal }}</span><div><button class="outline-button small" type="button" :disabled="knowledgeQualityLoading || !knowledgeQualityHasPrevious" @click="changeKnowledgeQualityPage(knowledgeQualityPage - 1)">Previous</button><button class="outline-button small" type="button" :disabled="knowledgeQualityLoading || !knowledgeQualityHasNext" @click="changeKnowledgeQualityPage(knowledgeQualityPage + 1)">Next</button></div></div></div>
            </section>
          </template>

          <div v-if="answerGapDrawerOpen && selectedKnowledgeGap" class="knowledge-drawer-backdrop" role="presentation" @click.self="closeKnowledgeAnswer">
            <aside class="knowledge-answer-drawer" role="dialog" aria-modal="true" aria-labelledby="knowledge-answer-heading"><div class="knowledge-drawer-header"><div><p class="eyebrow">{{ canManageTeam ? 'Answer editor' : 'Answer review' }}</p><h2 id="knowledge-answer-heading">{{ canManageTeam ? 'Answer this question' : 'Review this question' }}</h2></div><button class="knowledge-close-button" type="button" aria-label="Close answer editor" @click="closeKnowledgeAnswer">×</button></div><div class="knowledge-drawer-question"><span>Question cluster</span><strong>{{ selectedKnowledgeGap.question }}</strong><small>{{ selectedKnowledgeGap.occurrenceCount }}× asked · {{ selectedKnowledgeGap.variants?.length ?? 1 }} question variant{{ (selectedKnowledgeGap.variants?.length ?? 1) === 1 ? '' : 's' }} · {{ formatKnowledgeGapReason(selectedKnowledgeGap.reason) }}</small><div v-if="(selectedKnowledgeGap.variants?.length ?? 0) > 1" class="knowledge-variant-list"><span>Examples</span><small v-for="variant in selectedKnowledgeGap.variants" :key="variant">“{{ variant }}”</small></div></div><label class="knowledge-answer-mode"><span>Answer behavior</span><select v-model="selectedKnowledgeGap.answerMode" :disabled="!canManageTeam"><option value="knowledge">Knowledge answer — AI may summarize</option><option value="fixed_response">Fixed response — return controlled wording</option></select></label><label class="knowledge-answer-field"><span>Answer</span><textarea v-model="answerDrafts[selectedKnowledgeGap.question]" :readonly="!canManageTeam" rows="9" placeholder="Write the answer the assistant should use…"></textarea><small>Keep it clear and specific. FrontDeskWise updates assistant knowledge automatically after you save.</small></label><p v-if="knowledgeAnswerError" class="form-error">{{ knowledgeAnswerError }} <button v-if="canManageTeam && knowledgeAnswerFailedGap" class="text-button" type="button" @click="resolveKnowledgeGap(knowledgeAnswerFailedGap)">Retry</button></p><div v-if="knowledgeAnswerSaving || knowledgeAnswerStatus" class="knowledge-answer-progress" role="status" aria-live="polite"><span :class="knowledgeAnswerStatus === 'Ready ✓' ? 'ready' : ''">{{ knowledgeAnswerSaving ? (knowledgeAnswerStatus || 'Saving…') : knowledgeAnswerStatus }}</span><small v-if="knowledgeAnswerStatus === 'Updating assistant knowledge…'">Your answer is saved. We’re making it available to the assistant.</small><small v-else-if="knowledgeAnswerStatus === 'Ready ✓'">The gap moved to Resolved.</small></div><div class="knowledge-drawer-actions"><button v-if="selectedKnowledgeGap.resolvedQnaId" class="text-button" type="button" :disabled="knowledgeAnswerSaving" @click="viewResolvedQna">View in Q&amp;A</button><button class="outline-button" type="button" :disabled="knowledgeAnswerSaving" @click="closeKnowledgeAnswer">Close</button><button v-if="canManageTeam" class="primary-button" type="button" :disabled="!answerDrafts[selectedKnowledgeGap.question]?.trim() || knowledgeAnswerSaving" @click="resolveKnowledgeGap(selectedKnowledgeGap)">{{ knowledgeAnswerSaving ? 'Saving…' : 'Save answer' }}</button></div></aside>
          </div>
          <div v-if="knowledgeQnaDrawerOpen" class="knowledge-drawer-backdrop" role="presentation" @click.self="closeKnowledgeQnaEditor">
            <aside class="knowledge-answer-drawer" role="dialog" aria-modal="true" aria-labelledby="knowledge-qna-editor-heading"><div class="knowledge-drawer-header"><div><p class="eyebrow">{{ selectedKnowledgeQna ? 'Q&amp;A editor' : 'New verified knowledge' }}</p><h2 id="knowledge-qna-editor-heading">{{ selectedKnowledgeQna ? 'Edit Business Q&amp;A' : 'Add Business Q&amp;A' }}</h2></div><button class="knowledge-close-button" type="button" aria-label="Close Q&A editor" @click="closeKnowledgeQnaEditor">×</button></div><label class="knowledge-answer-field"><span>Canonical question</span><input v-model="knowledgeQnaDraft.question" :readonly="!canManageTeam" type="text" placeholder="How much does your service cost?" /><small>Use the version you want owners to recognize in the knowledge base.</small></label><label class="knowledge-answer-field"><span>Answer</span><textarea v-model="knowledgeQnaDraft.answer" :readonly="!canManageTeam" rows="8" placeholder="Write the verified answer visitors should receive…"></textarea></label><label class="knowledge-answer-field"><span>Question variants</span><textarea v-model="knowledgeQnaDraft.variants" :readonly="!canManageTeam" rows="4" placeholder="One variant per line"></textarea><small>Variants let common wording map to this canonical answer.</small></label><label class="knowledge-answer-field"><span>Review until <span class="optional">Optional</span></span><input v-model="knowledgeQnaDraft.validUntil" :readonly="!canManageTeam" type="date" /><small>Useful for pricing, hours, availability, and other high-change facts.</small></label><p v-if="knowledgeQnaError" class="form-error">{{ knowledgeQnaError }}</p><div class="knowledge-drawer-actions"><button class="outline-button" type="button" :disabled="knowledgeQnaSaving" @click="closeKnowledgeQnaEditor">Close</button><button v-if="canManageTeam" class="primary-button" type="button" :disabled="knowledgeQnaSaving" @click="saveKnowledgeQna">{{ knowledgeQnaSaving ? 'Saving…' : 'Save verified Q&amp;A' }}</button></div></aside>
          </div>
        </div>

        <div v-else-if="view === 'workflows'" class="workflow-workspace-shell">
          <p v-if="workflowContextRefreshMessage" class="form-error workflow-context-refresh-message" role="status">{{ workflowContextRefreshMessage }}</p>
          <WorkflowWorkspace :key="`${activeOrganization?.id ?? workflowContext?.organizationId ?? 'organization'}:${workflowContext?.businessId ?? demoSlug}:${workflowContext?.contextVersion ?? 0}`" :actions="actionFlows" :workflows="workflowRecords" :workflows-loading="workflowsLoading" :workflows-error="workflowsError" :integrations="integrations" :provider-connections="providerConnections" :demo-slug="demoSlug" :selected-business-id="workflowSelectedBusinessId" :workspace-business-id="workspaceBusinessId" :workspace-organization-id="workspaceOrganizationId" :organization-id="activeOrganization?.id ?? workflowContext?.organizationId ?? null" :api-url="apiUrl" :owner-headers="ownerHeaders" :business-name="businessName" :business-context="workflowContext" :performance-by-workflow="workflowPerformanceByAction" :initial-workflow-id="route.kind === 'workspace' || route.kind === 'demo' ? route.workflowId : undefined" :initial-action-id="route.kind === 'workspace' || route.kind === 'demo' ? route.workflowActionId : undefined" :agent-tone="agentTone" :agent-primary-language="primaryLanguage" :agent-citation-visibility="citationVisibility" :agent-fallback-behavior="fallbackBehavior" :agent-human-handoff-enabled="humanHandoffEnabled" :agent-proactive-enabled="proactiveEnabled" :publishing-status="agentPublishing.status" :publish-error="agentPublishingError" @refresh="loadActions" @refresh-workspace="refreshWorkflowWorkspace" @open-action="openWorkflowAction" @open-workflow="openWorkflowFromBuilder" @open-agent-behavior="selectAgentTab('behavior')" @test-workflow="testWorkflowFromBuilder" @publish-workflow="publishWorkflowFromBuilder" />
        </div>

        <div v-else-if="view === 'actions'" class="view-content action-page">
          <div class="actions-page-header">
            <div><p class="eyebrow">AI front desk</p><h2>Actions</h2><p>Choose the customer outcomes your AI front desk should help visitors accomplish.</p></div>
            <div v-if="!actionDraft" class="toolbar-actions"><button class="text-button" type="button" @click="openSupportReport('actions')">Report a problem</button><button class="primary-button" type="button" @click="openActionTemplateChooser()">Browse templates</button></div>
            <div v-else class="toolbar-actions"><button class="outline-button small" type="button" @click="selectAction(null)">← All actions</button><button class="primary-button small" type="button" :disabled="actionsLoading" @click="saveAction">{{ actionsLoading ? 'Saving…' : 'Save changes' }}</button></div>
          </div>
          <p v-if="integrationError" class="form-error">{{ integrationError }}</p>
          <p v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</p>
          <p v-if="actionsError" class="form-error">{{ actionsError }}</p>
          <p v-if="actionsMessage && !savedActionId" class="saved-message">✓ {{ actionsMessage }}</p>

          <template v-if="!actionDraft">
            <div v-if="savedAction" class="action-save-success" role="status">
              <div><strong>✓ {{ savedAction.name }} saved.</strong><span>{{ savedAction.isPrimary ? 'This is now your primary conversion goal.' : 'It is ready for the next step.' }}</span></div>
              <div class="action-save-success-actions"><button v-if="!savedAction.isPrimary && canSetPrimaryAction(savedAction)" class="outline-button small" type="button" :disabled="actionsLoading" @click="setPrimaryAction(savedAction)">Set as primary</button><button v-if="canSetPrimaryAction(savedAction)" class="primary-button small" type="button" @click="runActionTest(savedAction)">Test flow</button></div>
            </div>
            <section class="actions-setup-hero">
              <div><p class="eyebrow">Business Brain → Actions → Workflow</p><h2>We found these likely customer outcomes from your website.</h2><p>Choose what you want your AI front desk to help visitors accomplish. Approve, edit, or ignore each suggestion before generating a Workflow.</p></div>
              <div class="actions-setup-steps" aria-label="Action setup progress"><span class="complete">✓ Website connected</span><span class="complete">✓ Business Brain ready</span><span class="active">3 Review Actions</span><span>4 Generate Workflow</span></div>
            </section>
            <section class="primary-goal-card">
              <div class="primary-goal-copy"><p class="eyebrow">Primary conversion goal</p><h2>{{ primaryActionFlow?.name || 'Choose a primary Action after approval' }}</h2><p>{{ primaryActionFlow ? 'This is the preferred outcome FrontDeskWise may recommend when no more specific Workflow outcome takes precedence.' : 'Finalize an Action first. Once it is approved and ready, make it the outcome your front desk prioritizes.' }}</p><div v-if="primaryActionFlow" class="primary-goal-details"><span>{{ actionCompletionLabel(primaryActionFlow) }} · {{ formatLabel(primaryActionFlow.attachmentPolicy || 'explicit_request_only') }}</span><span v-if="primaryActionFlow.executionMode === 'PROVIDER_FLOW'">Provider: {{ formatLabel(actionProvider(primaryActionFlow) || 'Not selected') }} · {{ providerIsConnected(actionProvider(primaryActionFlow)) ? 'Connected' : 'Needs connection' }}</span><a v-if="primaryActionFlow.completion.linkUrl || primaryActionFlow.destination?.url" :href="primaryActionFlow.completion.linkUrl || primaryActionFlow.destination?.url" target="_blank" rel="noreferrer">{{ primaryActionFlow.completion.linkUrl || primaryActionFlow.destination?.url }}</a></div></div>
              <div class="primary-goal-actions"><span v-if="primaryActionFlow" class="primary-goal-status">✓ Active</span><template v-if="primaryActionFlow"><button class="outline-button small" type="button" @click="openPrimaryGoalChooser">Change goal</button><button class="primary-button small" type="button" @click="runActionTest(primaryActionFlow)">Test</button></template><button v-else class="primary-button small" type="button" @click="openPrimaryGoalChooser">Choose a primary goal</button></div>
              <div v-if="!primaryActionFlow && recommendedPrimaryAction" class="primary-goal-recommendation"><span>Recommended from your website</span><strong>{{ recommendedPrimaryAction.name }}</strong><small>{{ recommendedPrimaryAction.destination?.url || recommendedPrimaryAction.completion.linkUrl || 'Owner-confirmed action' }}</small></div>
            </section>
            <section v-if="recommendedActionFlows.length" class="action-dashboard-list action-group">
              <div class="action-section-heading"><div><p class="eyebrow">Recommended for this business</p><h3>Review the outcomes we found</h3><p>These suggestions are based on your website and Business Brain. Nothing becomes a Workflow until you approve it.</p></div><span class="action-section-count">{{ recommendedActionFlows.length }} suggested</span></div>
              <article v-for="action in recommendedActionFlows" :key="action.id" :class="['action-summary-card', 'action-recommendation-card', { 'action-summary-card-saved': action.id === savedActionId }]">
                <div class="action-summary-main"><span class="action-summary-icon"><Zap :size="21" :stroke-width="1.8" aria-hidden="true" /></span><div><div class="action-card-kicker"><span class="action-recommended-label">Recommended for this business</span><span :class="['action-status-badge', `action-status-${actionStatusTone(actionStatusLabel(action))}`]">{{ actionStatusLabel(action) }}</span></div><h3>{{ action.name }}</h3><p class="action-card-description">{{ action.description }}</p><p class="action-recommendation-reason">{{ actionRecommendationReason(action) }}</p><div class="action-card-outcome"><span class="eyebrow">Outcome</span><strong>{{ actionCompletionLabel(action) }}</strong><span>{{ actionOutcomeDetail(action) }}</span></div><div class="action-card-inputs"><div><span class="eyebrow">Required information</span><strong>{{ actionRequiredInputLabels(action).length ? actionRequiredInputLabels(action).join(' · ') : 'None' }}</strong></div><div v-if="actionRecommendedInputLabels(action).length"><span class="eyebrow">Useful for your business</span><strong>{{ actionRecommendedInputLabels(action).join(' · ') }}</strong></div></div></div></div>
                <div class="action-summary-actions action-review-actions"><div class="action-readiness-note"><span>Readiness</span><strong>{{ actionStatusLabel(action) }}</strong></div><button class="primary-button small" type="button" :disabled="actionsLoading" @click="approveAction(action)">Approve</button><button class="outline-button small" type="button" :disabled="actionsLoading" @click="selectAction(action)">Edit</button><button class="text-button danger-text" type="button" :disabled="actionsLoading" @click="ignoreAction(action)">Ignore</button></div>
              </article>
            </section>
            <section v-if="configuredActionFlows.length" class="action-dashboard-list action-group">
              <div class="action-section-heading"><div><p class="eyebrow">Configured</p><h3>Approved Actions</h3><p>These outcomes are ready to connect to a customer journey.</p></div><span v-if="actionsLoading" class="conversation-status">Refreshing…</span></div>
              <article v-for="action in configuredActionFlows" :key="action.id" :class="['action-summary-card', { 'action-summary-card-saved': action.id === savedActionId }]">
                <div class="action-summary-main"><span class="action-summary-icon"><Zap :size="21" :stroke-width="1.8" aria-hidden="true" /></span><div><div class="action-summary-meta"><span :class="['action-status-badge', `action-status-${actionStatusTone(actionStatusLabel(action))}`]">{{ actionStatusLabel(action) }}<template v-if="action.isPrimary"> · Primary</template></span><span v-if="action.workflowCount">Used by {{ action.workflowCount }} workflow{{ action.workflowCount === 1 ? '' : 's' }}</span></div><h3>{{ action.name }}</h3><p class="action-card-description">{{ action.description }}</p><div class="action-card-outcome"><span class="eyebrow">Outcome</span><strong>{{ actionCompletionLabel(action) }}</strong><span>{{ actionOutcomeDetail(action) }}</span></div><div class="action-card-inputs"><div><span class="eyebrow">Required information</span><strong>{{ actionRequiredInputLabels(action).length ? actionRequiredInputLabels(action).join(' · ') : 'None' }}</strong></div><div v-if="actionRecommendedInputLabels(action).length"><span class="eyebrow">Useful for your business</span><strong>{{ actionRecommendedInputLabels(action).join(' · ') }}</strong></div></div><div v-if="action.workflowNames?.length" class="action-card-relationships"><span class="eyebrow">Used by</span><button v-for="(workflowName, workflowIndex) in action.workflowNames" :key="`${action.id}-${workflowName}`" class="text-button" type="button" @click="openWorkflowForAction(action, workflowIndex)">{{ workflowName }} <ArrowRight :size="12" :stroke-width="1.8" aria-hidden="true" /></button></div><p v-else class="action-card-no-workflow">No Workflow currently guides visitors to this outcome.</p></div></div>
                <div class="action-summary-actions"><div class="action-summary-progress"><strong>{{ actionCompletionRate(action) }}%</strong><span>completion</span><div class="progress-bar"><span :style="{ width: `${Math.min(100, actionCompletionRate(action))}%` }"></span></div></div><button v-if="!action.workflowCount" class="primary-button small" type="button" @click="openWorkflowForAction(action)">Generate workflow</button><button v-else class="text-button" type="button" @click="openWorkflowForAction(action)">Open workflow <ArrowRight :size="13" :stroke-width="1.8" aria-hidden="true" /></button><button class="outline-button small" type="button" @click="runActionTest(action)">Test</button><button class="outline-button small" type="button" @click="selectAction(action)">Edit</button></div>
              </article>
            </section>
            <section v-if="availableActionTemplates.length" class="action-template-strip action-template-library"><div><p class="eyebrow">Quick-start templates</p><h3>Templates</h3><p>Add another capability when the business is ready for it.</p></div><div class="action-template-chips"><button v-for="template in availableActionTemplates" :key="template.key" type="button" :disabled="actionsLoading" @click="addActionTemplate(template)">{{ template.name }} <span>+</span></button><button type="button" @click="openActionTemplateChooser()">Custom action <span>+</span></button></div></section>
            <section v-if="!visibleActionFlows.length" class="panel action-empty-state"><span class="action-empty-icon"><Sparkles :size="26" :stroke-width="1.8" aria-hidden="true" /></span><div><p class="eyebrow">Start with an outcome</p><h2>Your AI can do more than answer questions.</h2><p>Choose a focused customer outcome, then approve it before creating the Workflow.</p><button class="primary-button small" type="button" @click="openActionTemplateChooser()">Browse templates <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div></section>
          </template>

          <div v-else-if="actionDraft">
            <div class="action-editor-titlebar"><div><p class="eyebrow">Action editor</p><h2>{{ actionDraft.name }}</h2><p>{{ actionDraft.description }}</p></div><div class="action-editor-title-actions"><span :class="['action-status-badge', `action-status-${actionStatusTone(actionStatusLabel(actionDraft))}`]">{{ actionStatusLabel(actionDraft) }}</span><label class="toggle-row"><span>Active</span><input v-model="actionDraft.enabled" type="checkbox" /></label><button class="outline-button small" type="button" @click="actionAdvancedOpen = !actionAdvancedOpen">{{ actionAdvancedOpen ? 'Hide advanced' : 'Advanced' }}</button></div></div>
            <section class="action-funnel-summary"><div><p class="eyebrow">Last 30 days</p><h3>Conversion flow</h3></div><div class="action-funnel-steps"><div><strong>{{ actionFunnelFor(actionDraft)?.started ?? 0 }}</strong><span>Started</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.formDisplayed ?? 0 }}</strong><span>Reached form</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.submitted ?? 0 }}</strong><span>Submitted</span></div><i></i><div><strong>{{ actionFunnelFor(actionDraft)?.completed ?? 0 }}</strong><span>Completed</span></div><div class="action-funnel-rate"><strong>{{ actionCompletionRate(actionDraft) }}%</strong><span>Completion rate</span></div></div><small v-if="actionFunnelFor(actionDraft)?.dropOffs?.length">Biggest drop-off: {{ actionFunnelFor(actionDraft)?.dropOffs[0].label }} · {{ actionFunnelFor(actionDraft)?.dropOffs[0].count }} visitors</small></section>
            <section class="action-editor-layout">
              <article class="panel action-outcome-panel">
                <div class="action-stage-heading"><span class="action-stage-number">1</span><div><p class="eyebrow">Outcome</p><h3>What should visitors be able to accomplish?</h3><p>Configure the business outcome here. The Workflow page owns the questions and journey.</p></div></div>
                <div class="action-two-column"><label>Action name<input v-model="actionDraft.name" type="text" placeholder="Request a demo" /></label><label>How does this complete?<select :value="actionCompletionChoice(actionDraft)" @change="setActionCompletionChoiceFromEvent"><option value="link">Send visitors to a page</option><option value="notify_team">Notify the team</option><option value="webhook">Send to CRM / webhook</option><option value="provider">Use a connected provider</option><option value="phone">Call the business</option><option value="collect_details">Collect details</option></select></label></div>
                <label>What this Action accomplishes<textarea v-model="actionDraft.description" rows="2" placeholder="Send interested visitors to the verified demo page."></textarea></label>
                <label v-if="actionCompletionChoice(actionDraft) === 'link'">Destination<input v-model="actionDraft.completion.linkUrl" type="url" placeholder="https://yourbusiness.com/demo" /><small class="form-help">Use the verified page visitors should open.</small></label>
                <label v-if="actionCompletionChoice(actionDraft) === 'provider'">Connected provider<select v-model="actionDraft.provider"><option value="">Select a provider…</option><option value="jackrabbit">Jackrabbit</option><option value="booking">Booking system</option></select><small class="form-help">The provider remains the system of record for the final transaction.</small></label>
                <div class="action-capability-summary"><div><span class="eyebrow">Required information</span><strong>{{ actionRequiredInputLabels(actionDraft).length ? actionRequiredInputLabels(actionDraft).join(' · ') : 'None' }}</strong><small>Technically required to complete this Action.</small></div><div><span class="eyebrow">Useful for your business</span><strong>{{ actionRecommendedInputLabels(actionDraft).length ? actionRecommendedInputLabels(actionDraft).join(' · ') : 'Workflow decides' }}</strong><small>Workflows may collect these when useful.</small></div></div>
                <div v-if="actionDraft.workflowNames?.length" class="action-relationship-box"><div><p class="eyebrow">Used by</p><strong>{{ actionDraft.workflowCount }} workflow{{ actionDraft.workflowCount === 1 ? '' : 's' }}</strong></div><button v-for="(workflowName, workflowIndex) in actionDraft.workflowNames" :key="`${actionDraft.id}-editor-${workflowName}`" class="text-button" type="button" @click="openWorkflowForAction(actionDraft, workflowIndex)">{{ workflowName }} <ArrowRight :size="12" :stroke-width="1.8" aria-hidden="true" /></button></div><div v-else class="action-relationship-empty"><strong>No workflow currently guides visitors to this outcome.</strong><button class="outline-button small" type="button" @click="openWorkflowForAction(actionDraft)">Generate workflow</button></div>
                <p class="form-help">Lead capture and qualification belong to Workflows. This Action only declares what must happen at the end.</p>
              </article>
              <article class="panel action-config-panel">
                <details class="action-advanced-editor" :open="actionAdvancedOpen">
                  <summary @click.prevent="actionAdvancedOpen = !actionAdvancedOpen"><span><p class="eyebrow">Advanced settings</p><strong>Questions, triggers, and delivery</strong><small>Legacy fields remain available here without making Actions a second Workflow builder.</small></span><span>{{ actionAdvancedOpen ? 'Hide' : 'Show' }}</span></summary>
                  <div class="action-advanced-editor-body">
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
                    <div class="action-two-column"><label v-if="actionDraft.executionMode !== 'DIRECT_LINK'">Success message<textarea v-model="actionDraft.completion.message" rows="3"></textarea></label><label>Lead status<select v-model="actionDraft.completion.leadStatus"><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label></div>
                  </template>

                  <template v-else>
                    <div class="action-stage-heading"><span class="action-stage-number">5</span><div><p class="eyebrow">Deliver</p><h3>Where should the completed action go?</h3><p>Leads are saved first. Select an existing connection for an additional delivery.</p></div></div>
                    <div class="action-delivery-choice"><label>Deliver to<select :value="actionDraft.completion.connector?.provider ?? 'none'" @change="setActionConnectorProviderFromEvent"><option value="none">FrontDeskWise only</option><option value="email">Email the team</option><option v-if="integrations.some((integration) => integration.provider === 'webhook' && integration.connectionStatus === 'active')" value="generic_webhook">Webhook / automation</option><option v-if="integrations.some((integration) => integration.provider === 'hubspot' && integration.connectionStatus === 'active')" value="hubspot">HubSpot CRM</option></select></label><label v-if="actionConnectorProvider !== 'email' && actionConnectorProvider !== 'none'">Connected system<select :value="actionDraft.completion.connector?.integrationId ?? ''" @change="setActionConnectorIntegrationFromEvent"><option value="">Select a connected system…</option><option v-for="integration in activeActionIntegrations" :key="integration.id" :value="integration.id">{{ integration.displayName }}</option></select></label></div>
                    <div v-if="!integrations.length" class="action-connection-empty"><strong>No CRM connected</strong><span>Choose where completed leads should go after they’re saved.</span><div class="action-connection-empty-actions"><button class="outline-button small" type="button" @click="openIntegrationSetup('hubspot')">Connect HubSpot</button><button class="text-button" type="button" @click="openIntegrationSetup('webhook')">Use Zapier</button></div></div>
                    <div v-else class="action-delivery-queue"><div class="panel-heading"><div><p class="eyebrow">Delivery history</p><h3>{{ actionDeliveriesFor(actionDraft).length ? 'Recent deliveries' : 'No deliveries yet' }}</h3></div><button class="text-button" type="button" :disabled="actionsLoading" @click="loadActions">Refresh</button></div><div v-for="delivery in actionDeliveriesFor(actionDraft)" :key="delivery.id" class="action-delivery-row"><span><strong>{{ delivery.provider }}</strong><small>{{ delivery.attempts }} attempt{{ delivery.attempts === 1 ? '' : 's' }} · {{ new Date(delivery.updatedAt).toLocaleString() }}</small></span><span :class="['status-pill', delivery.status === 'succeeded' ? 'booked' : delivery.status === 'failed' ? 'new' : 'qualified']">{{ delivery.status }}</span><button v-if="delivery.status === 'failed'" class="text-button" type="button" :disabled="actionsLoading" @click="retryActionDelivery(delivery)">Retry</button></div></div>
                  </template>

                  <section class="action-semantics-card">
                    <div><p class="eyebrow">Conversion semantics</p><h3>How should this action behave?</h3><p>These settings control the primary CTA and when it appears after an answer.</p></div>
                    <div v-if="actionDraft.executionMode === 'DIRECT_LINK'" class="action-customer-copy"><div><p class="eyebrow">Customer-facing copy</p><p>These words are shown to visitors. The internal template name stays out of the conversation.</p></div><div class="action-two-column action-copy-grid"><label>Action name<input v-model="actionDraft.name" type="text" placeholder="Try the demo" /></label><label>Button label<input v-model="actionDraft.completion.linkLabel" type="text" placeholder="Try the demo" /></label></div><label>Message before button<textarea v-model="actionDraft.completion.message" rows="2" placeholder="You can try it here."></textarea></label></div>
                    <div class="action-two-column action-semantics-fields"><label>Execution mode<select v-model="actionDraft.executionMode"><option value="DIRECT_LINK">Direct link</option><option value="FORM_FLOW">Form flow</option><option value="PROVIDER_FLOW">Provider flow</option><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="HANDOFF">Internal handoff</option><option value="API_ACTION">API action</option></select></label><label>When should this appear<select v-model="actionDraft.attachmentPolicy"><option value="sales_intent">When relevant to sales intent</option><option value="high_intent_only">Only for high intent</option><option value="explicit_request_only">Only when explicitly requested</option><option value="always">Frequently</option><option value="never_auto">Never automatically</option></select></label></div>
                    <label v-if="actionDraft.executionMode === 'PROVIDER_FLOW'">Provider<select v-model="actionDraft.provider"><option value="">Select a provider…</option><option value="jackrabbit">Jackrabbit</option></select><small class="form-help">The provider supplies live availability and the verified registration path. Connect it in Settings before making this action primary.</small></label>
                    <div v-if="actionDraft.executionMode === 'PROVIDER_FLOW' && actionProvider(actionDraft) === 'jackrabbit'" class="action-provider-status"><div><strong>Jackrabbit</strong><span>{{ providerIsConnected('jackrabbit') ? 'Connected and ready to verify live classes.' : 'Not connected yet.' }}</span></div><span :class="['status-pill', providerIsConnected('jackrabbit') ? 'booked' : 'qualified']">{{ providerIsConnected('jackrabbit') ? 'Connected' : 'Needs connection' }}</span><button v-if="!providerIsConnected('jackrabbit')" class="outline-button small" type="button" @click="openIntegrationSetup('jackrabbit')">Connect Jackrabbit</button></div>
                    <label v-if="actionDraft.executionMode === 'DIRECT_LINK'">Destination URL<input v-model="actionDraft.completion.linkUrl" type="url" placeholder="https://yourbusiness.com/demo" /><small class="form-help">Use the verified page visitors should open. Direct-link actions need a destination before they can be primary.</small></label>
                    <label>Tracking key<input v-model="actionDraft.trackingKey" type="text" placeholder="try_demo" /><small class="form-help">Used for CTA and conversion analytics.</small></label>
                  </section>

                  <details class="action-advanced" :open="actionAdvancedOpen"><summary @click.prevent="actionAdvancedOpen = !actionAdvancedOpen">Advanced settings <span>{{ actionAdvancedOpen ? 'Hide' : 'Show' }}</span></summary><div v-if="actionAdvancedOpen" class="action-advanced-body"><label>Internal action key<input v-model="actionDraft.key" type="text" /></label><label>Trigger intents <input :value="actionDraft.triggerIntents.join(', ')" type="text" placeholder="contact, lead" @input="setActionTriggerIntents" /></label><label v-if="actionDraft.executionMode !== 'DIRECT_LINK'">Continue link <span class="optional">optional</span><input v-model="actionDraft.completion.linkUrl" type="url" placeholder="https://…" /></label><label>Completion mode<select v-model="actionDraft.completion.completionMode" @change="ensureCompletionLinkTemplate"><option value="native_form">FrontDeskWise native</option><option value="external_provider">External provider link</option><option value="booking_connector">Booking connector</option><option value="payment_link">Payment link</option><option value="human_follow_up">Human follow-up</option></select></label><template v-if="(actionDraft.completion.completionMode === 'external_provider' || actionDraft.completion.completionMode === 'payment_link') && actionDraft.completion.linkTemplate"><label>Provider completion URL<input v-model="actionDraft.completion.linkTemplate.baseUrl" type="url" placeholder="https://provider.example/register" @focus="ensureCompletionLinkTemplate" /></label><label>Prefill mappings <span class="optional">one per line · source.path=providerParameter</span><textarea :value="completionLinkMappingsText" rows="4" placeholder="parent_name=MFName&#10;email=MEmail&#10;student.name=S1FName" @input="setCompletionLinkMappingsFromEvent"></textarea></label></template><p class="form-help">Completion links only include fields you explicitly map. Provider-owned waivers, signatures, and payment details stay on the provider.</p></div></details>
                </div>
                  </div>
                </details>
                <div class="action-editor-footer"><button class="text-button danger-text" type="button" :disabled="actionsLoading" @click="removeAction">Delete action</button><span v-if="actionsMessage" class="saved-message">✓ {{ actionsMessage }}</span><button class="primary-button small" type="button" :disabled="actionsLoading" @click="saveAction">{{ actionsLoading ? 'Saving…' : 'Save changes' }}</button></div>
              </article>
              <aside class="panel action-live-preview"><div class="action-preview-heading"><div><p class="eyebrow">Live customer preview</p><h3>What visitors will see</h3></div><span class="preview-live-dot">Live</span></div><div class="action-preview-window"><div class="action-preview-top"><span class="mini-orb"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /></span><div><strong>{{ assistantName }}</strong><small>{{ businessName || 'Your business' }}</small></div><span class="online-dot"></span></div><div class="action-preview-thread"><div class="action-preview-bubble">{{ actionDraft.executionMode === 'DIRECT_LINK' ? actionCustomerMessage(actionDraft) : actionDraft.completion.message || 'Absolutely. I just need a few details.' }}</div><div class="action-preview-bubble visitor">{{ actionDraft.executionMode === 'DIRECT_LINK' ? actionTestQuestion(actionDraft) : `I’d like to ${actionDraft.name.toLowerCase()}.` }}</div><div v-if="actionDraft.executionMode === 'DIRECT_LINK' && (actionDraft.completion.linkUrl || actionDraft.destination?.url)" class="action-preview-link"><strong>{{ actionDraft.completion.linkLabel || actionDraft.name || 'Continue' }}</strong><small>{{ actionDraft.completion.linkUrl || actionDraft.destination?.url }}</small><button class="primary-button small" type="button">{{ actionDraft.completion.linkLabel || actionDraft.name || 'Continue' }}</button></div><div v-else class="action-preview-form"><div class="action-preview-bubble">Absolutely. I just need a few details.</div><label v-for="field in actionDraft.fields.filter((item) => item.visibility !== 'hidden').slice(0, 4)" :key="field.id">{{ field.label }} <span v-if="!field.required">optional</span><input :type="field.type === 'phone' ? 'tel' : field.type" disabled :placeholder="field.label" /></label><span v-if="!actionDraft.fields.length" class="action-inline-empty">Add questions to see the form preview.</span><button class="primary-button small" type="button">{{ actionDraft.completion.submitLabel || 'Send request' }}</button></div></div><div class="action-preview-input">Ask a question… <Send :size="14" :stroke-width="1.8" aria-hidden="true" /></div></div><p class="form-help">Updates appear here as you change questions, capture style, or completion behavior.</p></aside>
            </section>
          </div>

          <div v-if="primaryGoalChooserOpen" class="action-modal-backdrop" role="presentation" @click.self="primaryGoalChooserOpen = false"><section class="action-template-modal primary-goal-chooser" role="dialog" aria-modal="true" aria-labelledby="primary-goal-title"><button class="auth-close" type="button" aria-label="Close" @click="primaryGoalChooserOpen = false">×</button><p class="eyebrow">Business objective</p><h2 id="primary-goal-title">Choose a primary goal</h2><p>Pick an approved Action the assistant should recommend after relevant answers.</p><div v-if="configuredActionFlows.length" class="primary-goal-choice-list"><button v-for="action in configuredActionFlows" :key="action.id" class="primary-goal-choice" type="button" :disabled="actionsLoading || !canSetPrimaryAction(action)" @click="setPrimaryAction(action)"><span><strong>{{ action.name }}</strong><small>{{ action.description }}</small></span><em>{{ action.isPrimary ? 'Current primary' : formatLabel(action.executionMode || 'FORM_FLOW') }}</em></button></div><div v-else class="action-modal-empty">Approve an Action above before choosing a primary goal.</div><div class="primary-goal-chooser-actions"><button v-if="primaryActionFlow" class="text-button danger-text" type="button" :disabled="actionsLoading" @click="clearPrimaryAction(primaryActionFlow); primaryGoalChooserOpen = false">Clear primary goal</button><button class="outline-button small" type="button" @click="primaryGoalChooserOpen = false">Cancel</button><button class="primary-button small" type="button" @click="primaryGoalChooserOpen = false; openActionTemplateChooser('primary')">Create an action</button></div></section></div>
          <div v-if="actionTemplateChooserOpen" class="action-modal-backdrop" role="presentation" @click.self="actionTemplateChooserOpen = false"><section class="action-template-modal" role="dialog" aria-modal="true" aria-labelledby="create-action-title"><button class="auth-close" type="button" aria-label="Close" @click="actionTemplateChooserOpen = false">×</button><p class="eyebrow">Quick start</p><h2 id="create-action-title">Create an action</h2><p>What should visitors be able to do?</p><div class="action-template-modal-grid"><button v-for="template in actionTemplates" :key="template.key" type="button" :disabled="actionsLoading || visibleActionFlows.some((action) => action.key === template.key)" @click="addActionTemplate(template)"><strong>{{ template.name }}</strong><small>{{ visibleActionFlows.some((action) => action.key === template.key) ? 'Already configured' : template.description }}</small></button><button type="button" :disabled="actionsLoading" @click="addCustomAction"><strong>Custom action</strong><small>Start with a blank conversion flow.</small></button></div></section></div>
          <div v-if="actionFieldDrawerIndex !== null && selectedActionField" class="action-modal-backdrop" role="presentation" @click.self="closeActionField"><aside class="action-field-drawer" role="dialog" aria-modal="true" aria-labelledby="question-editor-title"><div class="action-drawer-header"><div><p class="eyebrow">Question {{ actionFieldDrawerIndex + 1 }}</p><h2 id="question-editor-title">Edit question</h2></div><button class="auth-close" type="button" aria-label="Close" @click="closeActionField">×</button></div><label>Label<input v-model="selectedActionField.label" type="text" /></label><label>How the AI asks<input v-model="selectedActionField.question" type="text" /></label><label>Type<select v-model="selectedActionField.type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="select">Single select</option><option value="multi_select">Multi-select</option><option value="date">Date</option><option value="number">Number</option></select></label><label class="toggle-row"><span>Required</span><input v-model="selectedActionField.required" type="checkbox" /></label><label>Show when<select :value="selectedActionField.condition?.field ?? ''" @change="setFieldCondition(selectedActionField, $event)"><option value="">Always</option><option v-for="conditionField in actionDraft?.fields.slice(0, actionFieldDrawerIndex)" :key="conditionField.key" :value="conditionField.key">{{ conditionField.label }}</option></select></label><div v-if="selectedActionField.type === 'select' || selectedActionField.type === 'multi_select'"><label>Choices <span class="optional">comma separated</span><input :value="(selectedActionField.options ?? []).join(', ')" type="text" @input="setFieldOptions(selectedActionField, $event)" /></label></div><details class="action-advanced" :open="actionAdvancedOpen"><summary @click.prevent="actionAdvancedOpen = !actionAdvancedOpen">Advanced <span>{{ actionAdvancedOpen ? 'Hide' : 'Show' }}</span></summary><div v-if="actionAdvancedOpen" class="action-advanced-body"><label>Field key<input v-model="selectedActionField.key" type="text" /></label><label>Visibility<select v-model="selectedActionField.visibility"><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><label v-if="selectedActionField.condition?.field">Equals<input :value="selectedActionField.condition?.equals ?? ''" type="text" @input="setFieldConditionEquals(selectedActionField, $event)" /></label></div></details><div class="action-drawer-footer"><div class="action-drawer-reorder"><button class="outline-button small" type="button" :disabled="actionFieldDrawerIndex === 0" @click="moveSelectedActionField(-1)">↑ Move up</button><button class="outline-button small" type="button" :disabled="actionDraft ? actionFieldDrawerIndex === actionDraft.fields.length - 1 : true" @click="moveSelectedActionField(1)">Move down ↓</button></div><button class="text-button danger-text" type="button" @click="removeActionField(actionFieldDrawerIndex); closeActionField()">Remove question</button><button class="primary-button small" type="button" @click="closeActionField">Done</button></div></aside></div>
        </div>

        <div v-else-if="view === 'connections'" class="view-content">
          <div class="section-toolbar">
            <div><p class="eyebrow">Settings · integrations</p><h2>Integrations</h2><p>Connect the tools your business already uses.</p></div>
            <div class="toolbar-actions"><span v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</span><span v-if="mcpMessage" class="saved-message">✓ {{ mcpMessage }}</span><button class="outline-button small" type="button" :disabled="integrationLoading || mcpLoading || providerConnectionLoading" @click="loadIntegrations(); loadProviderConnections(); loadMcpConnections()">{{ integrationLoading || mcpLoading || providerConnectionLoading ? 'Working…' : 'Refresh' }}</button><button class="text-button" type="button" @click="openSupportReport('integration', hubspotIntegration?.provider ?? '', hubspotIntegration?.id ?? '')">Get help</button></div>
          </div>
          <p v-if="integrationError || mcpError" class="form-error">{{ integrationError || mcpError }}</p>

          <div class="integration-model-banner">
            <div class="integration-model-copy"><span class="integration-model-icon"><Cable :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><p class="eyebrow">Integrations</p><h3>Connect the systems your business already uses.</h3><p>FrontDeskWise uses business integrations for bookings, lead delivery, and other customer actions. Advanced AI tool connections are optional.</p><button class="integration-info-link" type="button" @click="integrationHowItWorksOpen = !integrationHowItWorksOpen">How integrations work <ChevronDown :size="14" :stroke-width="1.8" aria-hidden="true" /></button><p v-if="integrationHowItWorksOpen" class="integration-how-it-works">Business integrations handle customer-facing actions. AI tool connections are an optional way to let FrontDeskWise look up information or help with follow-up work.</p></div></div>
          </div>

          <section class="integration-section">
            <div class="integration-section-heading"><div><p class="eyebrow">Business integrations</p><h2>Connect the tools your business already uses.</h2><p>Keep the setup focused on bookings, leads, and customer actions.</p></div></div>
            <div class="integration-compact-grid">
              <article class="panel integration-compact-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo hubspot-logo"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path :d="siHubspot.path" /></svg></span><div><h3>HubSpot</h3><small>CRM</small></div></div><span :class="['status-pill', hubspotIntegration?.connectionStatus === 'active' ? 'booked' : hubspotIntegration?.connectionStatus === 'error' ? 'new' : 'qualified']">{{ hubspotIntegration?.connectionStatus === 'active' ? 'Connected' : hubspotIntegration?.connectionStatus === 'error' ? 'Needs attention' : 'Not connected' }}</span></div>
                <p>Send captured leads and follow-up data to HubSpot.</p>
                <div class="integration-compact-meta"><span><strong>{{ hubspotIntegration ? 'Used for' : 'Best for' }}</strong>{{ hubspotIntegration ? 'Lead delivery · follow-up tasks' : 'Lead delivery and CRM sync' }}</span></div>
                <div class="integration-card-actions"><button class="primary-button small" type="button" @click="openNativeIntegrationForm('hubspot')">{{ hubspotIntegration ? 'Manage' : 'Connect' }}</button></div>
              </article>
              <article class="panel integration-compact-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo automation-logo"><Workflow :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Zapier / Make</h3><small>Automation</small></div></div><span :class="['status-pill', webhookIntegration?.connectionStatus === 'active' ? 'booked' : webhookIntegration ? 'new' : 'qualified']">{{ webhookIntegration?.connectionStatus === 'active' ? 'Connected' : webhookIntegration ? 'Needs attention' : 'Not connected' }}</span></div>
                <p>Send events to the workflows your team already uses.</p>
                <div class="integration-compact-meta"><span><strong>{{ webhookIntegration ? 'Used for' : 'Best for' }}</strong>{{ webhookIntegration ? 'Lead and action events' : 'Flexible workflow automation' }}</span></div>
                <div class="integration-card-actions"><button class="primary-button small" type="button" @click="openNativeIntegrationForm('webhook')">{{ webhookIntegration ? 'Manage' : 'Connect' }}</button></div>
              </article>
              <article class="panel integration-compact-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo booking-logo"><CalendarCheck :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Booking tools</h3><small>Booking provider</small></div></div><span :class="['status-pill', bookingIntegrationConfigured ? 'booked' : 'qualified']">{{ bookingIntegrationConfigured ? 'Configured' : 'Not configured' }}</span></div>
                <p>Use your booking page or provider for appointments.</p>
                <div class="integration-compact-meta"><span><strong>{{ bookingIntegrationConfigured ? 'Used for' : 'Best for' }}</strong>{{ bookingIntegrationConfigured ? 'Appointment actions' : 'Calendly or custom booking links' }}</span></div>
                <div class="integration-card-actions"><button class="primary-button small" type="button" @click="navigateToWorkspaceView('actions')">{{ bookingIntegrationConfigured ? 'Manage' : 'Configure' }}</button></div>
              </article>
              <article class="panel integration-compact-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo booking-logo"><Waves :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Jackrabbit</h3><small>Class management</small></div></div><span :class="['status-pill', jackrabbitIntegration?.connectionStatus === 'active' ? 'booked' : jackrabbitIntegration?.connectionStatus === 'error' ? 'new' : 'qualified']">{{ jackrabbitIntegration?.connectionStatus === 'active' ? 'Connected' : jackrabbitIntegration?.connectionStatus === 'error' ? 'Needs attention' : 'Not connected' }}</span></div>
                <p>Check live classes and availability for your customers.</p>
                <div class="integration-compact-meta"><span><strong>{{ jackrabbitIntegration ? 'Used for' : 'Best for' }}</strong>{{ jackrabbitIntegration ? 'Live class lookup' : 'Class lookup and registration' }}</span></div>
                <div class="integration-card-actions"><button class="primary-button small" type="button" @click="openNativeIntegrationForm('jackrabbit')">{{ jackrabbitIntegration ? 'Manage' : 'Connect' }}</button></div>
              </article>
            </div>
            <section class="provider-capability-section">
              <div class="integration-section-heading"><div><p class="eyebrow">Business API connectors</p><h2>Connect your API</h2><p>Bring live business data into workflows without giving the model arbitrary API access.</p></div><div class="toolbar-actions"><button class="outline-button small" type="button" @click="openProviderConnectionDrawer('manual')">Add endpoint manually</button><button class="primary-button small" type="button" @click="openProviderConnectionDrawer('openapi')">Import OpenAPI</button></div></div>
              <div class="provider-capability-flow"><span>Connect API</span><b>→</b><span>Discover capabilities</span><b>→</b><span>Review permissions</span><b>→</b><span>Use in workflows</span></div>
              <p v-if="providerConnectionError" class="form-error">{{ providerConnectionError }}</p>
              <p v-if="providerConnectionMessage" class="saved-message">✓ {{ providerConnectionMessage }}</p>
              <div v-if="!providerConnections.length" class="panel provider-connector-empty"><div><strong>No business API connectors yet</strong><span>Connect a daycare, booking, CRM, or custom business API. Imported operations start disabled until you approve them.</span></div><button class="primary-button small" type="button" @click="openProviderConnectionDrawer('openapi')">Connect an API →</button></div>
              <div v-else class="provider-connector-list">
                <article v-for="connection in providerConnections" :key="connection.id" class="panel provider-connector-card">
                  <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo booking-logo"><Cable :size="20" :stroke-width="1.8" /></span><div><h3>{{ connection.displayName }}</h3><small>{{ connection.baseUrl }} · {{ connection.sourceType === 'openapi' ? 'OpenAPI import' : 'Custom REST' }}</small></div></div><span :class="['status-pill', connection.connectionStatus === 'active' ? 'booked' : connection.connectionStatus === 'error' ? 'new' : 'qualified']">{{ formatLabel(connection.connectionStatus) }}</span></div>
                  <div class="provider-connector-meta"><span><strong>{{ connection.capabilities.length }}</strong> discovered capabilities</span><span v-if="connection.credentialHint">Credential {{ connection.credentialHint }}</span><span v-if="connection.lastTestedAt">Tested {{ new Date(connection.lastTestedAt).toLocaleString() }}</span></div>
                  <p v-if="connection.lastError" class="form-error">{{ connection.lastError }}</p>
                  <div v-if="connection.capabilities.length" class="provider-capability-list"><div v-for="capability in connection.capabilities" :key="capability.id" class="provider-capability-row"><div class="provider-capability-copy"><div><strong>{{ capability.name }}</strong><span :class="['provider-capability-risk', capability.type === 'WRITE' ? 'write' : 'read']">{{ providerCapabilityPermissionLabel(capability) }}</span><span v-if="capability.lifecycleStatus === 'approved'" class="capability-check">✓ Approved</span><span v-else class="capability-pending">Needs review</span></div><small><code>{{ capability.key }}</code> · {{ capability.method }} {{ capability.path }}</small><small v-if="providerCapabilityRequiredFields(capability).length">Inputs: {{ providerCapabilityRequiredFields(capability).join(', ') }}</small></div><div class="provider-capability-actions"><button class="outline-button small" type="button" :disabled="providerConnectionLoading" @click="updateProviderCapability(connection, capability, !(capability.enabled && capability.lifecycleStatus === 'approved'))">{{ capability.enabled && capability.lifecycleStatus === 'approved' ? 'Disable' : 'Approve capability' }}</button><button v-if="capability.enabled && capability.lifecycleStatus === 'approved' && !providerCapabilityRequiredFields(capability).length" class="text-button" type="button" :disabled="providerConnectionLoading" @click="testProviderCapability(connection, capability)">Test</button></div></div></div>
                  <div v-else class="provider-capability-empty">Add an endpoint or import an OpenAPI document to discover capabilities.</div>
                </article>
              </div>
            </section>
            <div class="integration-card-grid integration-detailed-grid">
              <article class="panel business-integration-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo booking-logo"><Waves :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Jackrabbit</h3><small>Class management · read-only availability</small></div></div><span :class="['status-pill', jackrabbitIntegration?.connectionStatus === 'active' ? 'booked' : jackrabbitIntegration?.connectionStatus === 'error' ? 'new' : jackrabbitIntegration ? 'qualified' : 'qualified']">{{ jackrabbitIntegration?.connectionStatus === 'active' ? 'Connected ✓' : jackrabbitIntegration?.connectionStatus === 'error' ? 'Needs attention' : jackrabbitIntegration ? formatLabel(jackrabbitIntegration.connectionStatus) : 'Not connected' }}</span></div>
                <p class="integration-card-description">Find live classes and availability while Jackrabbit remains the system of record for registration, waivers, and payment.</p>
                <div v-if="jackrabbitIntegration?.accountName" class="integration-account-line">Account: {{ jackrabbitIntegration.accountName }}</div>
                <div v-if="jackrabbitIntegration?.accountId" class="integration-account-line">Organization ID: {{ jackrabbitIntegration.accountId }}</div>
                <div v-if="jackrabbitIntegration" class="integration-subsection"><div class="integration-subsection-heading"><strong>Connection</strong><span>{{ jackrabbitIntegration.lastTestedAt ? `Verified ${new Date(jackrabbitIntegration.lastTestedAt).toLocaleString()}` : 'Not verified yet' }}</span></div><div class="integration-capability-list"><div><span>Credential</span><b>{{ jackrabbitIntegration.credentialHint ?? 'Stored securely' }}</b></div><div><span>Read class availability</span><b :class="jackrabbitIntegration.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ jackrabbitIntegration.connectionStatus === 'active' ? '✓' : '—' }}</b></div><div><span>Enrollment writes</span><b class="capability-pending">—</b></div></div></div>
                <p v-if="jackrabbitIntegration?.lastError" class="form-error">{{ jackrabbitIntegration.lastError }}</p>
                <div class="integration-card-actions"><button v-if="!jackrabbitIntegration" class="primary-button small" type="button" @click="openNativeIntegrationForm('jackrabbit')">Connect Jackrabbit</button><template v-else><button class="outline-button small" type="button" :disabled="integrationLoading" @click="testIntegration(jackrabbitIntegration)">Test connection</button><button class="outline-button small" type="button" :disabled="integrationLoading" @click="openNativeIntegrationForm('jackrabbit')">Replace token</button><button class="text-button danger-text" type="button" :disabled="integrationLoading" @click="disconnectIntegration(jackrabbitIntegration)">Disconnect</button></template></div>
              </article>
              <article class="panel business-integration-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo hubspot-logo"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path :d="siHubspot.path" /></svg></span><div><h3>HubSpot</h3><small>CRM · native OAuth connection</small></div></div><span :class="['status-pill', hubspotIntegration?.connectionStatus === 'active' ? 'booked' : hubspotIntegration ? 'new' : 'qualified']">{{ hubspotIntegration?.connectionStatus === 'active' ? 'Connected ✓' : hubspotIntegration?.connectionStatus === 'error' ? 'Needs attention' : hubspotIntegration ? 'Connecting…' : 'Not connected' }}</span></div>
                <p class="integration-card-description">Send captured lead context to HubSpot while FrontDeskWise remains the source of truth.</p>
                <p v-if="hubspotIntegration?.accountName" class="integration-account-line">Account: {{ hubspotIntegration.accountName }}</p>
                <div class="integration-subsection"><div class="integration-subsection-heading"><strong>CRM Sync</strong><span>{{ hubspotIntegration ? (hubspotIntegration.connectionStatus === 'active' ? 'Connected securely' : 'Needs attention') : 'Connect to enable delivery' }}</span></div><div class="integration-capability-list"><div><span>Create and update contacts</span><b :class="hubspotIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ hubspotIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div><div><span>Send lead data and lifecycle fields</span><b :class="hubspotIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ hubspotIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div><div><span>Attach conversation context</span><b :class="hubspotIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ hubspotIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div></div><div v-if="hubspotIntegration" class="integration-sync-summary"><span>{{ hubspotIntegration.sync.synced }} synced</span><span v-if="hubspotIntegration.sync.pending">{{ hubspotIntegration.sync.pending }} pending</span><span v-if="hubspotIntegration.sync.failed">{{ hubspotIntegration.sync.failed }} failed</span></div></div>
                <div class="integration-subsection ai-access-subsection"><div class="integration-subsection-heading"><strong>AI Access</strong><span>{{ hubspotMcpConnection ? `${hubspotMcpConnection.tools.filter((tool) => tool.allowed).length} tools enabled` : 'Optional · MCP not connected' }}</span></div><div class="integration-capability-list"><div><span>Search contacts</span><b :class="mcpHasTool(hubspotMcpConnection, ['contact', 'search']) ? 'capability-check' : 'capability-pending'">{{ mcpHasTool(hubspotMcpConnection, ['contact', 'search']) ? '✓' : '—' }}</b></div><div><span>Read deals and tasks</span><b :class="mcpHasTool(hubspotMcpConnection, ['deal', 'task']) ? 'capability-check' : 'capability-pending'">{{ mcpHasTool(hubspotMcpConnection, ['deal', 'task']) ? '✓' : '—' }}</b></div><div><span>Create follow-up task</span><b :class="mcpHasTool(hubspotMcpConnection, ['task', 'create']) ? 'capability-check' : 'capability-pending'">{{ mcpHasTool(hubspotMcpConnection, ['task', 'create']) ? '✓' : '—' }}</b></div></div><small class="integration-subsection-note">AI access is configured separately below. MCP permissions never replace deterministic completion connectors.</small></div>
                <p v-if="hubspotIntegration?.lastError" class="form-error">{{ hubspotIntegration.lastError }}</p>
                <div class="integration-card-actions"><button v-if="!hubspotIntegration" class="primary-button small" type="button" @click="openNativeIntegrationForm('hubspot')">Connect HubSpot</button><template v-else><button class="outline-button small" type="button" :disabled="integrationLoading" @click="testIntegration(hubspotIntegration)">Test connection</button><button class="text-button danger-text" type="button" :disabled="integrationLoading" @click="disconnectIntegration(hubspotIntegration)">Disconnect</button></template></div>
              </article>

              <article class="panel business-integration-card">
                <div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo automation-logo"><Workflow :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Zapier / Make</h3><small>Automation · signed webhook</small></div></div><span :class="['status-pill', webhookIntegration?.connectionStatus === 'active' ? 'booked' : webhookIntegration ? 'new' : 'qualified']">{{ webhookIntegration ? formatLabel(webhookIntegration.connectionStatus) : 'Not connected' }}</span></div>
                <p class="integration-card-description">Trigger an automation after a lead or action is saved. Use this for flexible workflows that do not need direct CRM semantics.</p>
                <div class="integration-subsection"><div class="integration-subsection-heading"><strong>Automation delivery</strong><span>{{ webhookIntegration ? (webhookIntegration.connectionStatus === 'active' ? 'Connected securely' : 'Needs attention') : 'Connect to enable delivery' }}</span></div><div class="integration-capability-list"><div><span>Signed event payloads</span><b :class="webhookIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ webhookIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div><div><span>Retryable delivery queue</span><b :class="webhookIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ webhookIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div><div><span>Use from Actions</span><b :class="webhookIntegration?.connectionStatus === 'active' ? 'capability-check' : 'capability-pending'">{{ webhookIntegration?.connectionStatus === 'active' ? '✓' : '—' }}</b></div></div></div>
                <p v-if="webhookIntegration?.lastError" class="form-error">{{ webhookIntegration.lastError }}</p>
                <div class="integration-card-actions"><button v-if="!webhookIntegration" class="primary-button small" type="button" @click="openNativeIntegrationForm('webhook')">Connect automation</button><template v-else><button class="outline-button small" type="button" :disabled="integrationLoading" @click="testIntegration(webhookIntegration)">Test connection</button><button class="text-button danger-text" type="button" :disabled="integrationLoading" @click="disconnectIntegration(webhookIntegration)">Disconnect</button></template></div>
              </article>

              <article class="panel business-integration-card integration-card-muted"><div class="integration-card-header"><div class="integration-provider"><span class="integration-provider-logo booking-logo"><CalendarCheck :size="20" :stroke-width="1.8" aria-hidden="true" /></span><div><h3>Booking tools</h3><small>Calendly / custom booking endpoint</small></div></div><span class="status-pill qualified">Action connector</span></div><p class="integration-card-description">Keep bookings deterministic. Configure a booking link or supported completion connector inside Actions so the customer-facing confirmation stays reliable.</p><div class="integration-subsection"><div class="integration-subsection-heading"><strong>Completion actions</strong><span>Configured in Actions</span></div><div class="integration-capability-list"><div><span>Booking links</span><b class="capability-check">✓</b></div><div><span>Vendor HTTP connectors</span><b class="capability-check">✓</b></div><div><span>Lead saved before booking delivery</span><b class="capability-check">✓</b></div></div></div><div class="integration-card-actions"><button class="outline-button small" type="button" @click="view = 'actions'">Configure in Actions →</button></div></article>
            </div>

            <div v-if="nativeIntegrationFormOpen" class="panel integration-connect-panel"><div class="integration-connect-heading"><div><p class="eyebrow">Secure connection</p><h3>{{ integrationProvider === 'jackrabbit' ? 'Connect Jackrabbit' : 'Connect a business integration' }}</h3><p>FrontDeskWise keeps credentials server-side, encrypted at rest, and out of the browser.</p></div><button class="text-button" type="button" @click="closeNativeIntegrationForm">Close</button></div><div class="integration-connect-grid"><label>Provider<select v-model="integrationProvider"><option value="jackrabbit">Jackrabbit</option><option value="hubspot">HubSpot CRM</option><option value="webhook">Zapier / Make / custom webhook</option></select></label><label>Connection name <span class="optional">optional</span><input v-model="integrationDisplayName" type="text" maxlength="120" :placeholder="integrationProvider === 'hubspot' ? 'HubSpot' : integrationProvider === 'jackrabbit' ? 'Jackrabbit' : 'Automation webhook'" /></label><label v-if="integrationProvider === 'jackrabbit'" class="integration-connect-wide">Customer API token <span class="optional">encrypted · never shown again</span><input v-model="integrationAccessToken" type="password" autocomplete="new-password" placeholder="Paste your Jackrabbit Customer API token" /><small>FrontDeskWise detects the Jackrabbit account automatically after validation. Enrollment, payment, waivers, and registration remain in Jackrabbit.</small></label><div v-if="integrationProvider === 'hubspot' && !integrationManualMode" class="integration-connect-wide integration-oauth-callout"><strong>Connect with HubSpot OAuth</strong><p>Authorize FrontDeskWise to create or update contacts in the selected HubSpot account. You will return here after authorization.</p><button class="primary-button small" type="button" :disabled="integrationLoading" @click="connectIntegration">{{ integrationLoading ? 'Opening HubSpot…' : 'Connect HubSpot' }}</button><button class="text-button" type="button" @click="integrationManualMode = true">Advanced / Manual connection</button></div><label v-if="integrationProvider === 'hubspot' && integrationManualMode" class="integration-connect-wide">Private app or service key <span class="optional">encrypted · advanced</span><input v-model="integrationAccessToken" type="password" autocomplete="new-password" placeholder="Paste the provider token" /><small>Use this only for an account-local manual connection. Customer installs should use OAuth.</small></label><template v-else-if="integrationProvider === 'webhook'"><label class="integration-connect-wide">Webhook URL<input v-model="integrationWebhookUrl" type="url" inputmode="url" placeholder="https://hooks.zapier.com/…" /></label><label class="integration-connect-wide">Signing secret <span class="optional">optional · encrypted</span><input v-model="integrationSigningSecret" type="password" autocomplete="new-password" placeholder="Used to sign outbound events" /></label></template></div><p v-if="integrationError" class="form-error">{{ integrationError }}</p><p v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</p><div class="integration-connect-actions"><button class="outline-button small" type="button" @click="closeNativeIntegrationForm">Cancel</button><button v-if="integrationProvider === 'webhook' || integrationProvider === 'jackrabbit' || integrationManualMode" class="primary-button small" type="button" :disabled="integrationLoading || (integrationProvider === 'hubspot' ? !integrationAccessToken.trim() : integrationProvider === 'jackrabbit' ? !integrationAccessToken.trim() : !integrationWebhookUrl.trim())" @click="connectIntegration">{{ integrationLoading ? 'Testing connection…' : integrationProvider === 'jackrabbit' ? 'Connect Jackrabbit' : 'Test & connect securely →' }}</button></div></div>
            <div v-if="providerConnectionDrawerOpen" class="integration-drawer-backdrop" role="presentation" @click.self="closeProviderConnectionDrawer">
              <aside class="integration-drawer provider-connection-drawer" role="dialog" aria-modal="true" aria-labelledby="connect-provider-api-title">
                <div class="integration-drawer-header"><div><p class="eyebrow">Business API connector</p><h2 id="connect-provider-api-title">{{ providerConnectionMode === 'openapi' ? 'Import an API' : 'Add an endpoint' }}</h2><p>Credentials stay encrypted server-side. Capabilities are discovered into a review queue before workflows can use them.</p></div><button class="auth-close" type="button" aria-label="Close" @click="closeProviderConnectionDrawer">×</button></div>
                <div class="provider-connection-steps"><span class="active">1 · Connect</span><span>2 · Review</span><span>3 · Test</span></div>
                <label>Connection name<input v-model="providerConnectionName" type="text" maxlength="120" placeholder="DaycareSpots API" /></label>
                <label>Base URL<input v-model="providerConnectionBaseUrl" type="url" inputmode="url" placeholder="https://api.example.com" /><small>Use the API host, not a browser page. HTTPS is required.</small></label>
                <label>Authentication<select v-model="providerConnectionAuthType"><option value="bearer_token">Bearer token</option><option value="api_key">API key</option><option value="basic">Basic authentication</option><option value="none">No authentication</option></select></label>
                <label v-if="providerConnectionAuthType === 'api_key'">API key header<input v-model="providerConnectionApiKeyHeader" type="text" maxlength="120" placeholder="x-api-key" /></label>
                <template v-if="providerConnectionAuthType === 'basic'"><label>Username<input v-model="providerConnectionBasicUsername" type="text" autocomplete="username" placeholder="API username" /></label><label>Password<input v-model="providerConnectionBasicPassword" type="password" autocomplete="new-password" placeholder="Stored securely · never shown again" /></label></template><label v-else-if="providerConnectionAuthType !== 'none'">{{ providerConnectionAuthType === 'api_key' ? 'API key' : 'Bearer token' }}<input v-model="providerConnectionSecret" type="password" autocomplete="new-password" placeholder="Stored securely · never shown again" /></label>
                <template v-if="providerConnectionMode === 'openapi'"><div class="provider-import-choice"><label>OpenAPI / Swagger URL <span class="optional">JSON</span><input v-model="providerConnectionSpecUrl" type="url" inputmode="url" placeholder="https://…/openapi.json" @input="providerConnectionSpecJson = null" /></label><span>or</span><label class="outline-button small document-upload-button">Choose JSON file<input type="file" accept="application/json,.json" @change="handleProviderSpecFile" /></label></div><small class="form-help">FrontDeskWise will classify operations, generate input/output schemas, and keep every imported capability disabled until you approve it.</small></template>
                <template v-else><div class="provider-manual-heading"><strong>Endpoint details</strong><span>One capability to start</span></div><label>Capability key<input v-model="providerManualCapabilityKey" type="text" maxlength="120" placeholder="search_daycares" /></label><label>Display name <span class="optional">optional</span><input v-model="providerManualCapabilityName" type="text" maxlength="160" placeholder="Search daycares" /></label><div class="provider-manual-grid"><label>Method<select v-model="providerManualCapabilityMethod"><option>GET</option><option>POST</option><option>PUT</option><option>PATCH</option><option>DELETE</option></select></label><label>Path<input v-model="providerManualCapabilityPath" type="text" maxlength="1000" placeholder="/daycares/search" /></label></div><small class="form-help">Field mapping and typed schemas can be reviewed after the endpoint is registered.</small></template>
                <p v-if="providerConnectionError" class="form-error">{{ providerConnectionError }}</p><p v-if="providerConnectionMessage" class="saved-message">✓ {{ providerConnectionMessage }}</p>
                <div class="integration-drawer-actions"><button class="outline-button small" type="button" @click="closeProviderConnectionDrawer">Cancel</button><button class="primary-button small" type="button" :disabled="providerConnectionLoading" @click="connectProviderConnection">{{ providerConnectionLoading ? 'Discovering…' : providerConnectionMode === 'openapi' ? 'Discover capabilities' : 'Add endpoint' }}</button></div>
              </aside>
            </div>
          </section>

          <section class="integration-section advanced-ai-section">
            <div class="advanced-ai-heading">
              <button class="advanced-ai-toggle" type="button" @click="advancedAiConnectionsOpen = !advancedAiConnectionsOpen">
                <span><p class="eyebrow">Advanced</p><h2>AI tool connections</h2><small>For businesses that want FrontDeskWise to use external tools for lookups and follow-up tasks.</small></span>
                <span class="advanced-ai-toggle-state">{{ mcpConnections.length ? `${mcpConnections.length} connected` : 'Optional' }} <ChevronDown :size="16" :stroke-width="1.8" :class="{ rotated: advancedAiConnectionsOpen }" aria-hidden="true" /></span>
              </button>
              <button class="outline-button small" type="button" @click="openMcpConnectionDrawer">Connect AI tool</button>
            </div>
            <div v-if="advancedAiConnectionsOpen" class="advanced-ai-body">
              <div v-if="!mcpConnections.length" class="advanced-ai-empty"><div><strong>No AI tools connected</strong><span>Add one only when FrontDeskWise needs context from another system.</span></div><button class="primary-button small" type="button" @click="openMcpConnectionDrawer">Connect AI tool</button></div>
              <div v-else class="mcp-summary-list">
                <article v-for="connection in mcpConnections" :key="connection.id" class="mcp-summary-card">
                  <div class="mcp-summary-header"><div><strong>{{ connection.displayName }}</strong><small>{{ mcpProviderName(connection.provider) }}</small></div><span :class="['status-pill', connection.connectionStatus === 'active' ? 'booked' : connection.connectionStatus === 'error' ? 'new' : 'qualified']">{{ connection.connectionStatus === 'active' ? 'Connected' : formatLabel(connection.connectionStatus) }}</span></div>
                  <div class="mcp-summary-tools"><strong>Allowed tools</strong><span v-for="tool in connection.tools.slice(0, 3)" :key="tool.name"><b :class="tool.allowed ? 'capability-check' : 'capability-pending'">{{ tool.allowed ? '✓' : '○' }}</b>{{ tool.title || tool.name }}</span><small v-if="connection.tools.length > 3">+{{ connection.tools.length - 3 }} more</small></div>
                  <div class="mcp-summary-actions"><button class="outline-button small" type="button" @click="mcpPermissionsOpen = mcpPermissionsOpen === connection.id ? null : connection.id">{{ mcpPermissionsOpen === connection.id ? 'Hide permissions' : 'Manage permissions' }}</button><button class="text-button" type="button" :disabled="mcpLoading" @click="testMcpConnection(connection)">Test connection</button></div>
                  <div v-if="mcpPermissionsOpen === connection.id" class="mcp-permission-editor"><div class="mcp-policy-note"><strong>{{ connection.tools.filter((tool) => tool.allowed).length }} of {{ connection.tools.length }} tools enabled</strong><span>Read-only tools are enabled by default. Turn on write tools only when you understand what they do.</span></div><div v-if="connection.tools.length" class="mcp-tool-list"><label v-for="tool in connection.tools" :key="tool.name" class="mcp-tool-row"><input v-model="tool.allowed" type="checkbox" :disabled="mcpLoading" /><span><strong>{{ tool.title || tool.name }}</strong><small>{{ tool.description || tool.name }}</small><em :class="tool.destructive ? 'tool-risk-danger' : tool.approvalRequired ? 'tool-risk-review' : 'tool-risk-safe'">{{ tool.destructive ? 'Destructive · review carefully' : tool.approvalRequired ? 'Write action · explicit permission' : 'Read-only · safe default' }}</em></span></label></div><div class="toolbar-actions"><button class="primary-button small" type="button" :disabled="mcpLoading" @click="saveMcpPermissions(connection)">Save permissions</button><button class="text-button danger-text" type="button" :disabled="mcpLoading" @click="disconnectMcpConnection(connection)">Disconnect</button></div></div>
                </article>
              </div>
            </div>
          </section>

          <div v-if="mcpDrawerOpen" class="integration-drawer-backdrop" role="presentation" @click.self="closeMcpConnectionDrawer">
            <aside class="integration-drawer" role="dialog" aria-modal="true" aria-labelledby="connect-ai-tool-title">
              <div class="integration-drawer-header"><div><p class="eyebrow">Advanced AI connections</p><h2 id="connect-ai-tool-title">Connect an AI tool</h2><p>Give FrontDeskWise optional access to an external tool for lookups and follow-up tasks.</p></div><button class="auth-close" type="button" aria-label="Close" @click="closeMcpConnectionDrawer">×</button></div>
              <label>Choose provider<select v-model="mcpProvider"><option value="hubspot">HubSpot MCP</option><option value="zapier">Zapier MCP</option><option value="make">Make MCP</option><option value="custom">Custom MCP server</option></select></label>
              <label>Connection name<input v-model="mcpDisplayName" type="text" maxlength="120" :placeholder="`${mcpProviderName(mcpProvider)} workspace`" /></label>
              <label>Server URL<input v-model="mcpServerUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://…" /></label>
              <label>Access token<input v-model="mcpBearerToken" type="password" autocomplete="new-password" placeholder="Paste the token from your provider" /></label>
              <p class="form-help">{{ mcpProviderHelp(mcpProvider) }}</p>
              <p v-if="mcpError" class="form-error">{{ mcpError }}</p>
              <p v-if="mcpMessage" class="saved-message">✓ {{ mcpMessage }}</p>
              <div class="integration-drawer-actions"><button class="outline-button small" type="button" @click="closeMcpConnectionDrawer">Cancel</button><button class="primary-button small" type="button" :disabled="mcpLoading || !mcpServerUrl.trim() || !mcpBearerToken.trim()" @click="connectMcpConnection">{{ mcpLoading ? 'Testing connection…' : 'Test connection' }}</button></div>
            </aside>
          </div>

          <section class="integration-section mcp-section legacy-mcp-section">
            <div class="integration-section-heading"><div><p class="eyebrow">AI tool connections (MCP)</p><h2>Give the assistant useful context</h2><p>MCP is for agent lookups and flexible follow-up tools. Every discovered tool is reviewed and permissioned separately.</p></div><span class="integration-section-badge"><Sparkles :size="14" :stroke-width="1.8" aria-hidden="true" /> Agent layer</span></div>
            <div class="dashboard-grid connection-setup-grid">
              <article class="panel form-panel">
                <div class="panel-heading"><div><p class="eyebrow">Connect an AI tool source</p><h2>Connect an MCP server</h2><p>FrontDeskWise discovers available tools before saving anything.</p></div></div>
                <div class="connection-steps"><div><span>1</span><p><strong>Choose your provider</strong><small>Use the service where the assistant needs context or tools.</small></p></div><div><span>2</span><p><strong>Paste the connection details</strong><small>The token is encrypted and never shown again.</small></p></div><div><span>3</span><p><strong>Review permissions</strong><small>Read-only tools start enabled. Other tools require your approval.</small></p></div></div>
                <label>Provider<select v-model="mcpProvider"><option value="hubspot">HubSpot MCP</option><option value="zapier">Zapier MCP</option><option value="make">Make MCP</option><option value="custom">Custom MCP server</option></select></label>
                <p class="form-help">{{ mcpProviderHelp(mcpProvider) }}</p>
                <label>Connection name <span class="optional">optional</span><input v-model="mcpDisplayName" type="text" maxlength="120" :placeholder="`${mcpProviderName(mcpProvider)} workspace`" /></label>
                <label>Server URL<input v-model="mcpServerUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://…" /></label>
                <label>Access token <span class="optional">encrypted · never shown again</span><input v-model="mcpBearerToken" type="password" autocomplete="new-password" placeholder="Paste the token from your provider" /></label>
                <p class="form-help">For this connection flow, use the MCP URL and token supplied by the provider. OAuth buttons can be added provider-by-provider without changing permissions or tool safety.</p>
                <button class="primary-button" type="button" :disabled="mcpLoading || !mcpServerUrl.trim() || !mcpBearerToken.trim()" @click="connectMcpConnection">{{ mcpLoading ? 'Testing connection…' : 'Test & connect securely →' }}</button>
              </article>
              <article class="panel form-panel connection-explainer"><div class="panel-heading"><div><p class="eyebrow">What MCP is for</p><h2>Useful context for the assistant</h2><p>MCP is best for questions and follow-up work, not high-stakes completion steps.</p></div></div><div class="connection-use-list"><div><span class="check">✓</span><p><strong>Good fit</strong><small>Find an existing customer, check availability, search a CRM, or create a follow-up task.</small></p></div><div><span class="check">✓</span><p><strong>Still deterministic</strong><small>Bookings, enrollments, payments, and lead delivery stay in your configured action connectors.</small></p></div><div><span class="check">!</span><p><strong>Always controlled</strong><small>FrontDeskWise never runs every discovered tool automatically. Only allowed tools can be used.</small></p></div></div></article>
            </div>
            <article class="panel form-panel"><div class="panel-heading"><div><p class="eyebrow">Connected AI tools</p><h2>Review tool access</h2><p>Keep only the tools your assistant needs. Changing a permission takes effect after you save.</p></div></div><div v-if="!mcpConnections.length" class="diagnostics-empty">No MCP connections yet. Connect one above when the assistant needs external context.</div><div v-for="connection in mcpConnections" :key="connection.id" class="mcp-connection-card"><div class="setup-row"><div><strong>{{ connection.displayName }}</strong><small>{{ mcpProviderName(connection.provider) }} · {{ connection.serverUrl }}</small></div><span :class="['status-pill', connection.connectionStatus === 'active' ? 'booked' : connection.connectionStatus === 'error' ? 'new' : 'qualified']">{{ connection.connectionStatus }}</span></div><p v-if="connection.lastError" class="form-error">{{ connection.lastError }}</p><div class="mcp-policy-note"><strong>{{ connection.tools.filter((tool) => tool.allowed).length }} of {{ connection.tools.length }} tools enabled</strong><span>Read-only tools are the safest default. Write or destructive tools should be enabled only when you understand the effect.</span></div><div v-if="connection.tools.length" class="mcp-tool-list"><label v-for="tool in connection.tools" :key="tool.name" class="mcp-tool-row"><input v-model="tool.allowed" type="checkbox" :disabled="mcpLoading" /><span><strong>{{ tool.title || tool.name }}</strong><small>{{ tool.description || tool.name }}</small><em :class="tool.destructive ? 'tool-risk-danger' : tool.approvalRequired ? 'tool-risk-review' : 'tool-risk-safe'">{{ tool.destructive ? 'Destructive · review carefully' : tool.approvalRequired ? 'Write action · explicit permission' : 'Read-only · safe default' }}</em></span></label></div><div v-else class="diagnostics-empty">No tools were advertised by this server.</div><div class="toolbar-actions"><button class="primary-button small" type="button" :disabled="mcpLoading" @click="saveMcpPermissions(connection)">Save permissions</button><button class="outline-button small" type="button" :disabled="mcpLoading" @click="testMcpConnection(connection)">Refresh tools</button><button class="text-button danger-text" type="button" :disabled="mcpLoading" @click="disconnectMcpConnection(connection)">Disconnect</button></div></div></article>
          </section>
        </div>

        <div v-else-if="view === 'analytics'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Live operating signals</p><h2>Analytics</h2><p>Real conversations, leads, bookings, and knowledge activity for {{ businessName || 'this business' }}.</p></div><button class="outline-button small" type="button" @click="refreshWorkspaceSummary()">Refresh data</button></div>
          <div class="metric-grid"><article class="metric-card blue-tint"><strong>{{ workspaceStats?.conversations ?? 0 }}</strong><span>Conversations</span><em>Recorded conversations</em></article><article class="metric-card green-tint"><strong>{{ workspaceStats?.leads ?? 0 }}</strong><span>Leads captured</span><em>Durable FrontDeskWise records</em></article><article class="metric-card orange-tint"><strong>{{ workspaceStats?.handoffs ?? 0 }}</strong><span>Human handoffs</span><em>{{ workspaceStats?.humanActive ?? 0 }} active with staff</em></article><article class="metric-card purple-tint"><strong>{{ workspaceStats?.widgetLoads ?? 0 }}</strong><span>Widget loads</span><em>Verified public installs</em></article></div>
          <section v-if="executiveAnalytics" class="executive-analytics-grid" aria-label="Executive KPI and product quality metrics">
            <article class="panel executive-funnel-panel">
              <div class="panel-heading executive-panel-heading"><div><p class="eyebrow">Executive KPI funnel</p><h2>From signup to conversion</h2><p>One operating view for the milestones and outcomes that matter to the owner.</p></div><span class="status-pill qualified">{{ executiveAnalytics.windowLabel }}</span></div>
              <div class="executive-funnel-grid"><article v-for="(step, index) in executiveFunnelSteps" :key="step.key" :class="['executive-funnel-step', executiveStepTone(step.status)]"><div class="executive-funnel-step-top"><span class="executive-funnel-index">{{ String(index + 1).padStart(2, '0') }}</span><strong>{{ step.label }}</strong></div><strong class="executive-funnel-value">{{ step.value }}</strong><small>{{ step.detail }}</small><div class="executive-funnel-progress"><span :style="{ width: `${Math.min(100, Math.max(0, step.rate ?? 0))}%` }"></span></div><em>{{ step.rate === null ? '—' : `${formatExecutivePercent(step.rate)} · ${step.rateLabel}` }}</em></article></div>
              <p class="executive-funnel-note">Signup, verification, publishing, and installation are all-time setup milestones. Qualified leads and conversions reflect {{ executiveAnalytics.windowLabel.toLowerCase() }}.</p>
            </article>
            <article class="panel executive-quality-panel">
              <div class="panel-heading executive-panel-heading"><div><p class="eyebrow">Product quality</p><h2>Can the front desk be trusted?</h2><p>Quality, safety, experience, and unit economics in one scorecard.</p></div><span class="status-pill" :class="executiveAnalytics.quality.totalConversations ? 'booked' : 'qualified'">{{ executiveAnalytics.quality.totalConversations }} conversations</span></div>
              <div class="executive-quality-grid"><article v-for="metric in executiveQualityMetrics" :key="metric.key" :class="['executive-quality-metric', executiveMetricTone(metric.status)]"><span class="executive-quality-status"></span><strong>{{ formatExecutiveMetric(metric) }}</strong><span>{{ metric.label }}</span><small>{{ metric.detail }}</small></article></div>
            </article>
          </section>
          <article class="panel chart-panel analytics-chart"><div class="panel-heading"><div><h2>Activity by day</h2><p>Last 30 days · live records</p></div></div><div v-if="workspaceStats?.trend?.length" class="live-chart" aria-label="Analytics activity by day"><div v-for="point in workspaceStats.trend" :key="point.label" class="live-chart-column"><div class="live-chart-bars"><span class="live-bar blue" :style="{ height: `${point.conversations / chartMax * 100}%` }"></span><span class="live-bar orange" :style="{ height: `${point.leads / chartMax * 100}%` }"></span></div><small>{{ point.label }}</small></div></div><div v-else class="diagnostics-empty">No activity recorded yet.</div></article>
          <article class="panel funnel-panel"><div class="panel-heading"><div><h2>Conversion funnels</h2><p>Flow starts, form progress, connector outcomes, and completion.</p></div></div><div v-if="workspaceStats?.conversionFunnels?.length" class="funnel-list"><div v-for="funnel in workspaceStats.conversionFunnels" :key="funnel.flowId" class="funnel-card"><div class="setup-row"><strong>{{ funnel.name }}</strong><span class="status-pill" :class="funnel.completionRate >= 60 ? 'booked' : funnel.completionRate >= 30 ? 'qualified' : 'new'">{{ funnel.completionRate }}% complete</span></div><div class="funnel-steps"><span>{{ funnel.started }} started</span><span>{{ funnel.formDisplayed }} reached form</span><span>{{ funnel.submitted }} submitted</span><span>{{ funnel.actionSucceeded }} action succeeded</span><span>{{ funnel.completed }} completed</span></div><div v-if="funnel.exitRescueOffered || funnel.exitRescueSaved || funnel.exitRescueReturned || funnel.exitRescueConverted" class="exit-rescue-metrics" aria-label="Exit Rescue metrics"><div class="exit-rescue-metrics-heading"><strong>Exit Rescue</strong><small>Conditional conversion safety net</small></div><div class="exit-rescue-metrics-grid"><span><strong>{{ funnel.exitRescueOffered ?? 0 }}</strong><small>Offered</small></span><span><strong>{{ funnel.exitRescueSaved ?? 0 }}</strong><small>Saved</small></span><span><strong>{{ funnel.exitRescueReturned ?? 0 }}</strong><small>Returned</small></span><span><strong>{{ funnel.exitRescueConverted ?? 0 }}</strong><small>Converted</small></span></div></div><small v-if="funnel.dropOffs.length">Biggest drop-off: {{ funnel.dropOffs[0].label }} · {{ funnel.dropOffs[0].count }}</small></div></div><div v-else class="diagnostics-empty">No action flow telemetry yet. Run a flow through the widget to see conversion data.</div></article>
          <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>Most common visitor questions</p></div></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Knowledge gaps</h2><p>Questions that need a stronger answer</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Review</button></div></div><div v-else class="diagnostics-empty">No open knowledge gaps.</div></article></div>
        </div>

        <div v-else-if="view === 'businesses'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One account · multiple businesses</p><h2>Businesses</h2><p>Manage every business under {{ activeOrganization?.name ?? 'your organization' }}.</p></div><button class="primary-button small" type="button" @click="openAddBusiness">+ Add business</button></div>
          <article class="panel table-panel"><div class="table-heading business-row"><span>Business</span><span>Website</span><span>Billing</span><span>Actions</span></div><div v-if="!availableBusinesses.length" class="diagnostics-empty">No businesses yet. Add your first public website to begin.</div><div v-for="business in availableBusinesses" :key="business.id" class="table-row business-row"><div><strong>{{ business.name }}</strong><small>{{ formatLabel(business.role) }} · {{ formatPlanLabel(business.planKey) }}</small></div><span>{{ business.websiteUrl || 'Website pending' }}</span><span><span :class="['status-pill', business.billingStatus === 'active' || business.billingStatus === 'trial' ? 'booked' : 'new']">{{ formatLabel(business.billingStatus) }}</span></span><button class="outline-button small" type="button" :aria-label="`Open ${business.name}`" @click="openBusinessWorkspace(business.slug)">Open →</button></div></article>
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
            <div class="section-toolbar"><div><p class="eyebrow">Workspace updates</p><h2>Notifications</h2><p>Review operational updates for conversations, delivery, and account activity.</p></div><div class="notification-settings-actions"><button v-if="notificationUnreadCount || staffNotifications.some((notification) => !notification.readAt)" class="text-button" type="button" :disabled="notificationActionLoading" @click="markAllNotificationsRead">{{ notificationActionLoading ? 'Clearing…' : 'Mark all read' }}</button><button v-if="pwaInstallAvailable && !pwaInstalled" class="outline-button small" type="button" @click="installFrontDeskWisePwa">Install app</button><button class="outline-button small" type="button" @click="loadNotifications">Refresh</button></div></div>
            <article v-if="authSnapshot" class="panel browser-alerts-card"><div class="panel-heading"><div><p class="eyebrow">Operator device</p><h3>Stay close to waiting conversations</h3><p>Install FrontDeskWise for a focused mobile shell, then enable browser alerts for handoffs and qualified leads. Notification clicks open the exact conversation.</p></div><span :class="['status-pill', pushEnabled ? 'booked' : pushConfigured ? 'qualified' : 'new']">{{ pushEnabled ? 'Alerts on' : pushConfigured ? 'Ready to enable' : 'Not configured' }}</span></div><div class="browser-alerts-actions"><button v-if="pwaInstallAvailable && !pwaInstalled" class="outline-button small" type="button" @click="installFrontDeskWisePwa">Install FrontDeskWise</button><button v-if="pushConfigured && !pushEnabled" class="primary-button small" type="button" :disabled="pushLoading" @click="enableBrowserAlerts">{{ pushLoading ? 'Enabling…' : 'Enable browser alerts' }}</button><button v-else-if="pushEnabled" class="outline-button small" type="button" :disabled="pushLoading" @click="disableBrowserAlerts">{{ pushLoading ? 'Updating…' : 'Disable on this device' }}</button><span v-if="browserNotificationPermission === 'denied'" class="form-help">Browser permission is blocked. Re-enable notifications in this device’s site settings.</span><span v-else-if="!pushConfigured" class="form-help">A workspace administrator must configure Web Push keys before device alerts can be enabled.</span><span v-else-if="pushMessage" class="saved-message">✓ {{ pushMessage }}</span></div><p v-if="pushError" class="form-error">{{ pushError }}</p></article>
            <article v-if="authSnapshot" class="panel handoff-notification-card"><div class="panel-heading"><div><p class="eyebrow">Human handoff alerts</p><h3>Tell the team when a visitor is waiting</h3><p>Explicit requests notify staff immediately by default. Knowledge gaps stay in the Inbox unless you opt them into email alerts.</p></div><button class="primary-button small" type="button" :disabled="handoffSettingsLoading" @click="saveHandoffNotificationSettings">{{ handoffSettingsLoading ? 'Saving…' : 'Save handoff alerts' }}</button></div><div class="handoff-settings-grid"><label class="handoff-toggle"><span><strong>Email handoff alerts</strong><small>Send an actionable email with a direct link to the exact conversation.</small></span><input v-model="handoffNotificationSettings.enabled" type="checkbox" /></label><label><span class="field-label">Default recipient</span><input v-model="handoffNotificationSettings.defaultRecipientEmail" type="email" placeholder="support@business.com" /></label><label><span class="field-label">Additional recipients <span class="optional">One per line or comma-separated</span></span><textarea v-model="handoffAdditionalRecipients" rows="3" placeholder="manager@business.com&#10;frontdesk@business.com"></textarea></label><fieldset><legend>Send alert</legend><label><input v-model="handoffNotificationSettings.handoffDelaySeconds" type="radio" :value="0" /> Immediately</label><label><input v-model="handoffNotificationSettings.handoffDelaySeconds" type="radio" :value="120" /> After 2 minutes</label><label><input v-model="handoffNotificationSettings.handoffDelaySeconds" type="radio" :value="300" /> After 5 minutes</label></fieldset><fieldset><legend>Move to follow-up mode after</legend><label><input v-model="handoffNotificationSettings.handoffTimeoutSeconds" type="radio" :value="120" /> 2 minutes</label><label><input v-model="handoffNotificationSettings.handoffTimeoutSeconds" type="radio" :value="300" /> 5 minutes</label><label><input v-model="handoffNotificationSettings.handoffTimeoutSeconds" type="radio" :value="600" /> 10 minutes</label><label><input v-model="handoffNotificationSettings.handoffTimeoutSeconds" type="radio" :value="900" /> 15 minutes</label><label><input v-model="handoffNotificationSettings.handoffTimeoutSeconds" type="radio" :value="1800" /> 30 minutes</label><small>AI stays available throughout. This only changes the team-facing status and follow-up wording.</small></fieldset><label class="handoff-toggle"><span><strong>Remind if unanswered</strong><small>Keep the repeat policy ready for the async delivery worker.</small></span><input v-model="handoffNotificationSettings.repeatEnabled" type="checkbox" /></label><label v-if="handoffNotificationSettings.repeatEnabled"><span class="field-label">Reminder after (minutes)</span><input v-model.number="handoffNotificationSettings.repeatAfterSeconds" type="number" min="1" max="1440" /></label></div><div class="notification-preference-list handoff-trigger-list"><label><span><strong>Visitor explicitly asks for a person</strong><small>Immediate handoff and notification.</small></span><input v-model="handoffNotificationSettings.notifyExplicitHumanRequest" type="checkbox" /></label><label><span><strong>AI cannot answer confidently</strong><small>Optional; disabled by default to avoid noisy escalation.</small></span><input v-model="handoffNotificationSettings.notifyKnowledgeGap" type="checkbox" /></label><label><span><strong>High-value lead needs staff</strong><small>Notify when a configured action requires staff.</small></span><input v-model="handoffNotificationSettings.notifyHighValueLead" type="checkbox" /></label><label><span><strong>Every lead submission</strong><small>Leave this off unless every lead needs an email.</small></span><input v-model="handoffNotificationSettings.notifyEveryLead" type="checkbox" /></label></div><p v-if="handoffSettingsMessage" class="saved-message">✓ {{ handoffSettingsMessage }}</p><p v-if="handoffSettingsError" class="form-error">{{ handoffSettingsError }}</p></article>
            <article v-if="authSnapshot" class="panel notification-preferences-card"><div class="panel-heading"><div><p class="eyebrow">Owner preferences</p><h3>Operational email</h3><p>Choose which non-mandatory team updates reach you by email. Billing and security notices always stay on.</p></div><button class="primary-button small" type="button" :disabled="notificationPreferencesLoading" @click="saveNotificationPreferences">{{ notificationPreferencesLoading ? 'Saving…' : 'Save preferences' }}</button></div><div class="notification-preference-list"><label><span><strong>New qualified leads</strong><small>Get an email when a qualified inquiry is captured.</small></span><input v-model="notificationPreferences.newLead" type="checkbox" /></label><label><span><strong>Human handoffs</strong><small>Know when a visitor is waiting for a team member.</small></span><input v-model="notificationPreferences.humanHandoff" type="checkbox" /></label><label><span><strong>Integration failures</strong><small>Get notified when a connected CRM needs attention.</small></span><input v-model="notificationPreferences.integrationFailure" type="checkbox" /></label></div><p v-if="notificationPreferencesMessage" class="saved-message">✓ {{ notificationPreferencesMessage }}</p><p v-if="notificationPreferencesError" class="form-error">{{ notificationPreferencesError }}</p></article><article class="panel notification-settings-panel"><p v-if="notificationActionError" class="notification-action-error">{{ notificationActionError }}</p><div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div><button v-for="notification in staffNotifications" :key="notification.id" :class="['notification-row', { 'notification-row-unread': !notification.readAt }]" type="button" @click="markNotificationRead(notification); view = 'inbox'"><span class="notification-row-indicator" aria-hidden="true"></span><span><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></span></button></article>
          </template>
          <article v-if="authSnapshot && ownershipVerification && currentSettingsTab === 'verification'" class="panel verification-panel"><div class="panel-heading"><div><p class="eyebrow">Website ownership</p><h2>{{ ownershipVerification.status === 'verified' ? 'Ownership verified' : 'Verify before publishing' }}</h2><p>{{ ownershipVerification.status === 'verified' ? 'This business can publish its widget and receive production leads.' : 'Complete one verification method to protect production publishing.' }}</p></div><span :class="['status-pill', ownershipVerification.status === 'verified' ? 'booked' : ownershipVerification.status === 'rejected' ? 'new' : 'qualified']">{{ formatLabel(ownershipVerification.status) }}</span></div><div v-if="ownershipVerification.status !== 'verified'" class="verification-controls"><label>Method<select v-model="verificationMethod"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><button class="outline-button small" type="button" :disabled="verificationLoading" @click="requestOwnershipVerification">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethod !== 'email' && verificationMethod !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="checkOwnershipVerification">Check now</button></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="verificationMessage" class="saved-message">✓ {{ verificationMessage }}</p><p v-if="verificationError" class="form-error">{{ verificationError }}</p></article>
          <article v-if="currentSettingsTab === 'verification' && !ownershipVerification" class="panel empty-view"><div class="empty-icon"><BadgeCheck :size="30" :stroke-width="1.8" aria-hidden="true" /></div><h2>Verification is loading</h2><p>We’re checking the website ownership state for this business.</p></article>
        </div>

        <div v-else-if="view === 'billing'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One organization · every business</p><h2>Billing & plan</h2><p>Keep one subscription relationship as you add businesses to {{ activeOrganization?.name ?? 'your organization' }}.</p></div><div class="toolbar-actions"><span v-if="billingLoading" class="conversation-status">Working…</span></div></div>
          <p v-if="billingError" class="form-error">{{ billingError }}</p>
          <p v-if="billingMessage" class="saved-message">✓ {{ billingMessage }}</p>
          <template v-if="billingSnapshot">
            <div v-if="billingSnapshot.billing.providerCustomerId" class="billing-portal-callout"><div><p class="eyebrow">Subscription management</p><strong>{{ billingSnapshot.billing.status === 'active' ? 'Subscription is active — manage below.' : 'Manage your billing details in the Stripe portal.' }}</strong><p>Update payment methods, view invoices, or manage your subscription securely.</p></div><button class="outline-button small" type="button" :disabled="billingLoading" @click="openBillingPortal">Manage billing →</button></div>
            <div v-if="billingSnapshot.billing.status === 'grace'" class="billing-alert warning">Payment needs attention. Your organization remains available until {{ formatBillingDate(billingSnapshot.billing.graceEndAt) }}.</div>
            <div v-else-if="billingSnapshot.billing.status === 'cancelled' || billingSnapshot.billing.status === 'paused'" class="billing-alert danger">Billing is {{ billingSnapshot.billing.status }}. Existing data remains visible, but new paid actions and businesses are paused until billing is restored.</div>
            <div v-if="billingSnapshot.billing.pendingPlanKey && billingSnapshot.billing.pendingPlanChangeType === 'downgrade'" class="billing-alert warning"><span><strong>{{ billingSnapshot.billing.plan.displayName }} stays active.</strong> Your change to {{ formatPlanLabel(billingSnapshot.billing.pendingPlanKey) }} begins {{ formatBillingDate(billingSnapshot.billing.pendingPlanChangeAt) }}.</span><button class="outline-button small" type="button" :disabled="billingLoading" @click="resumeBilling">Keep {{ billingSnapshot.billing.plan.displayName }}</button></div><div v-else-if="billingSnapshot.billing.pendingPlanKey && billingSnapshot.billing.pendingPlanChangeType === 'upgrade'" class="billing-alert warning"><span><strong>{{ billingSnapshot.billing.plan.displayName }} remains active.</strong> Your upgrade to {{ formatPlanLabel(billingSnapshot.billing.pendingPlanKey) }} is awaiting successful payment.</span><button class="outline-button small" type="button" :disabled="billingLoading" @click="openBillingPortal">Update payment method</button></div>
            <div class="billing-summary-grid">
              <article class="panel billing-status-card"><p class="eyebrow">Current status</p><div class="billing-status-line"><strong>{{ billingSnapshot.billing.plan.displayName }}</strong><span :class="['status-pill', billingSnapshot.billing.status === 'active' ? 'booked' : billingSnapshot.billing.status === 'trial' ? 'qualified' : 'new']">{{ billingSnapshot.billing.cancelAtPeriodEnd && billingSnapshot.billing.status === 'active' ? 'Active · cancellation scheduled' : formatLabel(billingSnapshot.billing.status) }}</span></div><p v-if="billingSnapshot.billing.pendingPlanKey && billingSnapshot.billing.pendingPlanChangeType === 'downgrade'">{{ billingSnapshot.billing.plan.displayName }} remains active until {{ formatBillingDate(billingSnapshot.billing.pendingPlanChangeAt) }}.</p><p v-else-if="billingSnapshot.billing.status === 'active'">Your {{ billingSnapshot.billing.plan.displayName }} subscription is active.</p><p v-else-if="billingSnapshot.billing.cancelAtPeriodEnd && billingSnapshot.billing.currentPeriodEndAt">Cancels on {{ formatBillingDate(billingSnapshot.billing.currentPeriodEndAt) }}</p><p v-else-if="billingSnapshot.billing.status === 'trial'">Trial ends {{ formatBillingDate(billingSnapshot.billing.trialEndAt) }}</p><p v-else-if="billingSnapshot.billing.currentPeriodEndAt">Next renewal: {{ formatBillingDate(billingSnapshot.billing.currentPeriodEndAt) }}</p><p v-else>{{ billingSnapshot.billing.mode === 'sandbox' ? 'Sandbox billing · no charge' : 'Choose a plan to activate billing.' }}</p><small v-if="billingSnapshot.billing.status === 'active' && billingSnapshot.billing.currentPeriodEndAt">Next renewal: {{ formatBillingDate(billingSnapshot.billing.currentPeriodEndAt) }}</small><small v-if="billingSnapshot.billing.lastPaymentStatus">Payment status: {{ billingSnapshot.billing.lastPaymentStatus === 'paid' ? 'Paid' : formatLabel(billingSnapshot.billing.lastPaymentStatus) }}</small><small v-if="billingSnapshot.billing.override">{{ billingSnapshot.billing.override.reason }}</small><button v-if="billingSnapshot.billing.cancelAtPeriodEnd" class="outline-button small" type="button" :disabled="billingLoading" @click="resumeBilling">Keep my plan active</button></article>
              <article class="panel billing-status-card"><p class="eyebrow">Business capacity</p><strong class="billing-big-number">{{ availableBusinesses.length }} <span>/ {{ billingSnapshot.billing.plan.maxBusinesses }}</span></strong><p>Businesses in this organization</p><div class="metric-progress"><span :style="{ width: `${Math.min(100, (availableBusinesses.length / billingSnapshot.billing.plan.maxBusinesses) * 100)}%` }"></span></div></article>
              <article class="panel billing-status-card"><p class="eyebrow">Last 30 days</p><div class="billing-usage-stats"><span><strong>{{ billingSnapshot.usageLast30Days.conversations }}</strong> conversations</span><span><strong>{{ billingSnapshot.usageLast30Days.leads }}</strong> leads</span><span><strong>{{ billingSnapshot.usageLast30Days.bookings }}</strong> bookings</span></div><small v-if="planConversationAllowance(billingSnapshot.billing.plan) !== null" class="billing-usage-limit">{{ planConversationAllowance(billingSnapshot.billing.plan)?.toLocaleString('en-US') }} AI conversations included each month</small></article>
            </div>
            <div class="section-toolbar billing-plans-heading"><div><p class="eyebrow">Flexible plans</p><h2>Choose the right operating level</h2><p>Pricing is organization-level. Client-specific founding terms are represented as a plan override, not a special code path.</p></div></div>
            <div class="billing-plan-grid"><article v-for="plan in billingSnapshot.plans" :key="plan.key" :class="['panel', 'billing-plan-card', { selected: plan.key === billingSnapshot.billing.planKey }]" ><div class="billing-plan-top"><h3>{{ plan.displayName }}</h3><span v-if="plan.key === billingSnapshot.billing.planKey" class="status-pill booked">Current</span></div><strong class="billing-price">{{ formatPlanPrice(plan) }}<small v-if="plan.amountCents !== null">/mo</small></strong><p>{{ plan.description }}</p><div class="billing-plan-meta">Up to {{ plan.maxBusinesses }} {{ plan.maxBusinesses === 1 ? 'business' : 'businesses' }}</div><div class="billing-plan-meta billing-plan-usage">{{ planConversationLabel(plan) }}</div><button v-if="plan.key !== billingSnapshot.billing.planKey && plan.amountCents !== null" class="primary-button small" type="button" :disabled="billingLoading || !billingSnapshot.stripeConfigured || !plan.checkoutReady" @click="startCheckout(plan)">{{ !billingSnapshot.stripeConfigured ? 'Contact support' : plan.checkoutReady ? (billingSnapshot.billing.status === 'active' ? 'Change to this plan' : 'Start subscription') : 'Unavailable' }}</button><a v-else-if="plan.key !== billingSnapshot.billing.planKey" class="outline-button small billing-plan-contact" href="mailto:hello@frontdeskwise.com?subject=FrontDeskWise%20Portfolio%20pricing">Contact support</a><span v-else class="saved-message">✓ Active plan</span></article></div>
            <p v-if="!billingSnapshot.stripeConfigured" class="billing-note">Online subscription checkout is not available for this workspace yet. <a href="mailto:hello@frontdeskwise.com">Contact support</a> to activate a plan.</p>
          </template>
          <article v-else class="panel empty-view"><div class="empty-icon"><DollarSign :size="30" :stroke-width="1.8" aria-hidden="true" /></div><h2>{{ billingError ? 'Billing unavailable' : 'Billing is loading' }}</h2><p>{{ billingError || 'Loading your organization plan and usage.' }}</p><button class="outline-button small" type="button" @click="refreshBillingPage">{{ billingError ? 'Retry' : 'Refresh' }}</button></article>
        </div>

        <div v-else-if="view === 'admin' && isSuperAdmin" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Internal operations</p><h2>{{ adminSectionTitle }}</h2><p>Run the platform with a consistent view of organizations, access, demos, and system health.</p></div><div class="toolbar-actions"><span v-if="adminEmailTestMessage" class="saved-message">✓ {{ adminEmailTestMessage }}</span><button class="outline-button small" type="button" :disabled="adminEmailTestLoading" @click="testAdminEmail">{{ adminEmailTestLoading ? 'Sending…' : 'Test SES email' }}</button><span v-if="adminLoading" class="conversation-status">Working…</span></div></div>
          <nav class="admin-section-tabs" aria-label="Admin sections"><button v-for="item in adminNavItems" :key="item.id" type="button" :class="{ active: adminSection === item.id }" @click="adminSection = item.id">{{ item.label }}</button></nav>
          <p v-if="adminError" class="form-error">{{ adminError }}</p>
          <section v-if="adminSection === 'business-detail' && adminBusinessDetail" class="ds-card admin-onboarding-status-card">
            <div class="ds-card-heading"><div><p class="eyebrow">Onboarding validation</p><h2>Website status: {{ formatLabel(adminBusinessDetail.business.onboardingStatus || 'needs_attention') }}</h2><p>{{ adminBusinessDetail.business.onboardingValidation?.message || 'This business has not completed website validation yet.' }}</p></div><span :class="['status-pill', adminBusinessDetail.business.onboardingStatus === 'valid' ? 'booked' : 'new']">{{ adminBusinessDetail.business.onboardingFailureCode ? formatLabel(adminBusinessDetail.business.onboardingFailureCode) : 'No failure code' }}</span></div>
            <div class="health-list"><div><span>Failure classification</span><strong>{{ adminBusinessDetail.business.onboardingFailureCode || 'Not recorded' }}</strong></div><div><span>Readiness</span><strong>{{ adminBusinessDetail.business.onboardingValidation?.knowledgeReady ? 'Ready' : 'Needs attention' }}</strong></div><div><span>Last checked</span><strong>{{ adminBusinessDetail.business.onboardingValidatedAt ? new Date(adminBusinessDetail.business.onboardingValidatedAt).toLocaleString() : 'Not recorded' }}</strong></div></div>
            <div v-if="adminBusinessDetail.business.onboardingValidation?.crawlCoverage" class="detail-subsection admin-crawl-diagnostics">
              <p class="eyebrow">Crawl diagnostics</p>
              <div class="health-list"><div><span>Discovered URLs</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.discoveredUrls }}</strong></div><div><span>Eligible URLs</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.eligibleUrls }}</strong></div><div><span>Attempted</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.attemptedUrls }}</strong></div><div><span>Successful pages</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.successfulPages }}</strong></div><div><span>Coverage</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.coveragePercent }}%</strong></div><div><span>Skipped</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.skippedUrls }}</strong></div><div><span>Failed</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlCoverage.failedUrls }}</strong></div><div v-if="adminBusinessDetail.business.onboardingValidation.crawlRun"><span>Run / path</span><strong>{{ adminBusinessDetail.business.onboardingValidation.crawlRun.crawlRunId }} · {{ adminBusinessDetail.business.onboardingValidation.crawlRun.legacyCodePathUsed ? 'legacy' : 'current' }}</strong></div></div>
              <div v-if="crawlReasonEntries(adminBusinessDetail.business.onboardingValidation).length" class="crawl-reason-list"><span v-for="([reason, count]) in crawlReasonEntries(adminBusinessDetail.business.onboardingValidation)" :key="reason">{{ formatLabel(reason) }} <strong>{{ count }}</strong></span></div>
              <p v-if="adminBusinessDetail.business.onboardingValidation.crawlCoverage.additionalPagesDetected && (adminBusinessDetail.business.onboardingValidation.crawlCoverage.unprocessedUrls > 0 || adminBusinessDetail.business.onboardingValidation.crawlCoverage.failedUrls > 0)" class="form-help">Additional public pages were detected but are not all indexed yet.</p>
            </div>
          </section>
          <template v-if="adminSection === 'overview'">
            <div class="ds-stat-grid admin-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><Building2 :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminOrganizations.length }}</strong><small>Organizations</small><em>{{ adminTrialCount }} on trial</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><UserCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminLeadTotal }}</strong><small>Leads captured</small><em>Across all tenants</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><MessageSquare :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminConversationTotal }}</strong><small>Conversations</small><em>Persisted outcomes</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminPausedCount + adminFailedDemoCount }}</strong><small>Needs attention</small><em>{{ adminDisabledUserCount }} disabled users</em></article></div>
            <div class="admin-overview-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Platform health</p><h2>Know what is breaking</h2><p>Live checks for the API, database, storage, and email delivery.</p></div><span :class="['status-pill', adminHealth?.api === 'healthy' ? 'booked' : adminHealth?.api === 'degraded' ? 'qualified' : 'new']">{{ adminHealth?.api ?? 'checking' }}</span></div><div class="health-list"><div><span>API and database</span><strong>{{ adminHealth?.database ?? 'Checking…' }}</strong></div><div><span>Private storage</span><strong>{{ adminHealth?.objectStorageConfigured ? 'Configured' : 'Needs setup' }}</strong></div><div><span>Email delivery</span><strong>{{ adminHealth?.emailConfigured ? 'Configured' : 'Needs setup' }}</strong></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Attention queue</p><h2>Operator follow-up</h2><p>Small, explicit queues keep the control plane useful.</p></div></div><div class="admin-attention-list"><button type="button" @click="adminSection = 'organizations'"><span>Paused organizations</span><strong>{{ adminPausedCount }}</strong></button><button type="button" @click="adminSection = 'demos'"><span>Failed or expired demos</span><strong>{{ adminFailedDemoCount }}</strong></button><button type="button" @click="adminSection = 'support'"><span>Open support cases</span><strong>{{ adminSupportSummary.open }}</strong></button><button type="button" @click="adminSection = 'installation-support'"><span>New installation requests</span><strong>{{ installationSupportSummary.new }}</strong></button><button type="button" @click="adminSection = 'users'"><span>Disabled users</span><strong>{{ adminDisabledUserCount }}</strong></button></div></article></div>
          </template>
          <article v-if="adminSection === 'certification'" class="panel certification-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Release confidence</p><h2>Platform certification</h2><p>Retrieval, routing, and workflow quality from the latest release-gate run.</p></div><div class="toolbar-actions"><span v-if="adminCertification?.latest" :class="['status-pill', adminCertification.latest.pass ? 'booked' : 'new']">{{ adminCertification.latest.pass ? 'PASS' : 'FAIL' }}</span><button class="outline-button small" type="button" :disabled="adminCertificationLoading" @click="loadAdminCertification">{{ adminCertificationLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <p v-if="adminCertificationError" class="form-error">{{ adminCertificationError }}</p>
            <template v-if="adminCertification?.latest">
              <div class="ds-stat-grid admin-detail-stat-grid"><article v-for="layer in [{ key: 'retrieval', label: 'Retrieval', pass: adminCertification.latest.layers.retrieval.pass }, { key: 'routing', label: 'Routing', pass: adminCertification.latest.layers.routing.pass }, { key: 'workflow', label: 'Workflow', pass: adminCertification.latest.layers.workflow.pass }]" :key="layer.key" class="ds-stat-card"><span :class="['ds-stat-icon', layer.pass ? 'green' : 'orange']"><ShieldCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ layer.pass ? 'PASS' : 'FAIL' }}</strong><small>{{ layer.label }}</small><em>{{ layer.pass ? 'Release invariant satisfied' : 'Needs investigation' }}</em></article></div>
              <div class="admin-certification-meta"><span>Last run {{ new Date(adminCertification.latest.generatedAt).toLocaleString() }}</span><span>Commit {{ adminCertification.latest.commit || 'not recorded' }}</span><span v-if="adminCertification.latest.baseline">Compared with {{ adminCertification.latest.baseline.fileName }}{{ adminCertification.latest.baseline.commit ? ` · ${adminCertification.latest.baseline.commit}` : '' }}</span></div>
              <div class="admin-certification-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Quality deltas</p><h3>Score movement</h3></div><span class="status-pill qualified">{{ adminCertification.latest.scoreDeltas ? 'Compared' : 'Baseline pending' }}</span></div><div v-if="adminCertification.latest.scoreDeltas" class="admin-certification-score-list"><div v-for="(delta, key) in adminCertification.latest.scoreDeltas" :key="key"><span>{{ certificationScoreLabel(String(key)) }}</span><strong>{{ certificationDeltaValue(delta) }}</strong><small>Current {{ certificationScoreValue(adminCertification.latest.scores[String(key)]) }}</small></div></div><div v-else class="diagnostics-empty">The next run will establish the first score baseline.</div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Reference businesses</p><h3>End-to-end workflow status</h3></div></div><div class="admin-certification-business-list"><div v-for="business in adminCertification.latest.layers.workflow.businesses" :key="business.key"><span><strong>{{ business.name }}</strong><small>{{ business.processPassRate * 100 }}% process · {{ business.outcomePassRate * 100 }}% outcome</small></span><span :class="['status-pill', business.pass && business.workflowVerification.ok ? 'booked' : 'new']">{{ business.pass && business.workflowVerification.ok ? 'PASS' : 'FAIL' }}</span></div></div></article></div>
              <div class="admin-certification-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Observed production signals</p><h3>Improvement queue</h3></div><span class="status-pill qualified">{{ adminCertification.improvementSignals.recent.length }} recent</span></div><div v-if="adminCertification.improvementSignals.counts.length" class="admin-certification-score-list"><div v-for="signal in adminCertification.improvementSignals.counts" :key="signal.type"><span>{{ formatLabel(signal.type) }}</span><strong>{{ signal.count }}</strong><small>Last {{ signal.lastSeenAt ? new Date(signal.lastSeenAt).toLocaleString() : '—' }}</small></div></div><div v-else class="diagnostics-empty">No improvement signals recorded yet.</div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Recent examples</p><h3>Failure signals to review</h3></div></div><div v-if="adminCertification.improvementSignals.recent.length" class="admin-certification-signal-list"><div v-for="signal in adminCertification.improvementSignals.recent" :key="signal.id"><span class="status-pill qualified">{{ formatLabel(signal.type) }}</span><div><strong>{{ signal.businessName }}</strong><small>{{ signal.normalizedQuestion || signal.reason || 'No question captured' }}</small><em>{{ new Date(signal.occurredAt).toLocaleString() }}</em></div></div></div><div v-else class="diagnostics-empty">The platform will show redacted production examples here.</div></article></div>
            </template>
            <div v-else-if="!adminCertificationLoading" class="diagnostics-empty">No certification report is available in this deployment yet. Run the release gate and publish the report artifact.</div>
          </article>
          <article v-if="adminSection === 'experience-signals'" class="panel experience-signals-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Customer experience alerts</p><h2>Frustration & experience signals</h2><p>Find where visitors struggle, inspect the session trace, and turn recurring friction into a fixable product signal.</p></div><div class="toolbar-actions"><span v-if="adminExperienceSignals" class="status-pill" :class="adminExperienceSignals.summary.total ? 'new' : 'booked'">{{ adminExperienceSignals.summary.total }} open</span><button class="outline-button small" type="button" :disabled="adminExperienceSignalsLoading" @click="loadAdminExperienceSignals">{{ adminExperienceSignalsLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <p v-if="adminExperienceSignalsError" class="form-error">{{ adminExperienceSignalsError }}</p>
            <div class="experience-signal-filter-row"><label>Status<select v-model="adminExperienceSignalStatusFilter" @change="loadAdminExperienceSignals"><option value="open">Open</option><option value="reviewed">Reviewed</option><option value="resolved">Resolved</option><option value="ignored">Ignored</option><option value="all">All</option></select></label><label>Severity<select v-model="adminExperienceSignalSeverityFilter" @change="loadAdminExperienceSignals"><option value="all">All severities</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label><label>Signal type<select v-model="adminExperienceSignalTypeFilter" @change="loadAdminExperienceSignals"><option value="all">All types</option><option v-for="item in adminExperienceSignals?.summary.byType ?? []" :key="item.type" :value="item.type">{{ formatLabel(item.type) }}</option></select></label></div>
            <template v-if="adminExperienceSignals">
              <div class="ds-stat-grid admin-detail-stat-grid"><article v-for="item in [{ key: 'critical', label: 'Critical', className: 'purple' }, { key: 'high', label: 'High', className: 'orange' }, { key: 'medium', label: 'Medium', className: 'blue' }, { key: 'low', label: 'Low', className: 'green' }]" :key="item.key" class="ds-stat-card"><span :class="['ds-stat-icon', item.className]"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminExperienceSignals.summary.bySeverity.find((entry) => entry.severity === item.key)?.count ?? 0 }}</strong><small>{{ item.label }} signals</small><em>Last 30 days</em></article></div>
              <div class="admin-certification-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Recurring friction</p><h3>What to fix next</h3></div><span class="status-pill qualified">{{ adminExperienceSignals.clusters.length }} clusters</span></div><div v-if="adminExperienceSignals.clusters.length" class="admin-certification-score-list"><div v-for="cluster in adminExperienceSignals.clusters.slice(0, 8)" :key="cluster.clusterKey"><span>{{ formatLabel(cluster.type) }}<small>{{ cluster.businessName }}{{ cluster.workflowStep ? ` · ${cluster.workflowStep}` : '' }}</small></span><strong>{{ cluster.count }}</strong><small>{{ cluster.sessions }} session{{ cluster.sessions === 1 ? '' : 's' }}</small></div></div><div v-else class="diagnostics-empty">No recurring experience friction in this view.</div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Triage rule</p><h3>Trace before aggregate</h3></div></div><p>Super Admins get the redacted message and technical trace. Owners only receive the aggregate pattern and suggested improvement.</p><div class="health-list"><div><span>Language</span><strong>Redacted</strong></div><div><span>Session context</span><strong>Attached</strong></div><div><span>Owner exposure</span><strong>Aggregate only</strong></div></div></article></div>
              <div class="experience-signal-list"><div v-if="!adminExperienceSignals.signals.length" class="diagnostics-empty">No experience signals match these filters.</div><article v-for="signal in adminExperienceSignals.signals" :key="signal.id" class="experience-signal-row"><div class="experience-signal-main"><div class="experience-signal-topline"><span :class="['status-pill', signal.severity === 'critical' || signal.severity === 'high' ? 'new' : signal.severity === 'medium' ? 'qualified' : 'booked']">{{ signal.severity }}</span><span class="status-pill qualified">{{ formatLabel(signal.type) }}</span><span class="experience-signal-confidence">{{ Math.round(signal.confidence * 100) }}% confidence</span></div><h3>{{ signal.business.name }}</h3><p>{{ signal.messageExcerptRedacted || 'Behavioral friction detected without a message excerpt.' }}</p><small>Likely layer: {{ formatLabel(signal.likelyLayer) }}<span v-if="signal.workflowStep"> · Step: {{ signal.workflowStep }}</span><span v-if="signal.publicationVersion"> · Publication: v{{ signal.publicationVersion }}</span></small><small>{{ new Date(signal.occurredAt).toLocaleString() }}<span v-if="signal.reason"> · {{ formatLabel(signal.reason) }}</span></small></div><div class="experience-signal-actions"><button class="text-button" type="button" @click="adminExperienceSignalTraceId = adminExperienceSignalTraceId === signal.id ? '' : signal.id">{{ adminExperienceSignalTraceId === signal.id ? 'Hide trace' : 'Open trace' }}</button><button v-if="signal.status === 'open'" class="outline-button small" type="button" :disabled="adminExperienceSignalsLoading" @click="updateAdminExperienceSignal(signal, 'reviewed')">Mark reviewed</button><button v-if="signal.status !== 'resolved'" class="outline-button small" type="button" :disabled="adminExperienceSignalsLoading" @click="updateAdminExperienceSignal(signal, 'resolved')">Resolve</button><button v-if="signal.status !== 'ignored'" class="text-button" type="button" :disabled="adminExperienceSignalsLoading" @click="updateAdminExperienceSignal(signal, 'ignored')">Ignore</button></div><div v-if="adminExperienceSignalTraceId === signal.id" class="experience-signal-trace"><div class="health-list"><div><span>Validation</span><strong>{{ String(signal.validationResult.status || 'not recorded') }}</strong></div><div><span>Model role</span><strong>{{ signal.modelRole || 'deterministic' }}</strong></div><div><span>Provider</span><strong>{{ String(signal.providerState.provider || 'none') }}</strong></div><div><span>Conversation</span><strong>{{ signal.conversationId || 'not linked' }}</strong></div></div><details open><summary>Attached session trace</summary><pre>{{ JSON.stringify(signal.trace, null, 2) }}</pre></details></div></article></div>
            </template>
            <div v-else-if="!adminExperienceSignalsLoading" class="diagnostics-empty">No experience signal data is available yet. Signals appear after visitors encounter friction in a published widget session.</div>
          </article>
          <article v-if="adminSection === 'feature-flags'" class="panel feature-flags-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Safe runtime rollout</p><h2>Feature flags</h2><p>Move behavior from internal tenants to reference tenants, a deterministic percentage, or everyone. Organization cohorts stay stable across requests.</p></div><div class="toolbar-actions"><span v-if="adminFeatureFlagsLoading" class="conversation-status">Working…</span><button class="outline-button small" type="button" :disabled="adminFeatureFlagsLoading" @click="loadAdminFeatureFlags">Refresh</button></div></div>
            <p v-if="adminFeatureFlagsError" class="form-error">{{ adminFeatureFlagsError }}</p>
            <p v-if="adminFeatureFlagsMessage" class="saved-message">✓ {{ adminFeatureFlagsMessage }}</p>
            <div class="admin-detail-grid">
              <article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Create a controlled rollout</p><h3>New flag</h3><p>Use a stable key such as <code>workflow.runtime_v2</code>. Keep safety-critical behavior fail-closed unless the default is explicitly verified.</p></div></div><form class="admin-detail-form" @submit.prevent="createAdminFeatureFlag"><label>Key<input v-model="adminFeatureFlagDraft.key" required maxlength="80" pattern="[a-zA-Z][a-zA-Z0-9._-]{1,79}" placeholder="workflow.runtime_v2" /></label><label>Description<textarea v-model="adminFeatureFlagDraft.description" rows="2" maxlength="500" placeholder="What behavior does this flag control?"></textarea></label><div class="admin-detail-form-grid"><label>Stage<select v-model="adminFeatureFlagDraft.stage"><option value="off">Off</option><option value="internal">Internal</option><option value="reference_tenants">Reference tenants</option><option value="percentage">Percentage</option><option value="all">All customers</option></select></label><label>Percentage<input v-model.number="adminFeatureFlagDraft.rolloutPercentage" type="number" min="0" max="100" step="0.01" :disabled="adminFeatureFlagDraft.stage !== 'percentage'" /></label></div><label>Reference tenants <span class="optional">used by the reference-tenants stage</span><select v-model="adminFeatureFlagDraft.referenceOrganizationIds" multiple size="5"><option v-for="organization in adminFeatureFlagOrganizations" :key="organization.id" :value="organization.id">{{ organization.name }} · {{ organization.slug }}{{ organization.isInternal ? ' · internal' : '' }}</option></select></label><button class="primary-button small" type="submit" :disabled="adminFeatureFlagsLoading || !adminFeatureFlagDraft.key.trim()">Create flag →</button></form></article>
              <article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Rollout guardrails</p><h3>How cohorts work</h3><p>Stages are evaluated server-side. Tenant overrides take precedence over the stage and are recorded in the privileged audit log.</p></div></div><div class="health-list"><div><span>Internal</span><strong>Internal demo organizations</strong></div><div><span>Reference tenants</span><strong>Explicit organization list</strong></div><div><span>Percentage</span><strong>Stable SHA-256 bucket</strong></div><div><span>Kill switch</span><strong>Set stage to Off</strong></div></div><form class="feature-flag-override-form" @submit.prevent="saveAdminFeatureFlagOverride"><p class="eyebrow">Tenant override</p><div class="admin-detail-form-grid"><label>Flag<select v-model="adminFeatureFlagOverride.key" required><option v-for="flag in adminFeatureFlags" :key="flag.key" :value="flag.key">{{ flag.key }}</option></select></label><label>State<select v-model="adminFeatureFlagOverride.state"><option value="on">Force on</option><option value="off">Force off</option></select></label></div><label>Organization<select v-model="adminFeatureFlagOverride.organizationId" required><option v-for="organization in adminFeatureFlagOrganizations" :key="organization.id" :value="organization.id">{{ organization.name }} · {{ organization.slug }}</option></select></label><label>Reason<input v-model="adminFeatureFlagOverride.reason" maxlength="240" placeholder="Reference tenant validation" /></label><button class="outline-button small" type="submit" :disabled="adminFeatureFlagsLoading || !adminFeatureFlagOverride.key || !adminFeatureFlagOverride.organizationId">Save override →</button></form></article>
            </div>
            <div class="feature-flag-list"><div v-if="!adminFeatureFlags.length" class="diagnostics-empty">No feature flags are configured.</div><article v-for="flag in adminFeatureFlags" :key="flag.id" class="feature-flag-row"><div class="feature-flag-row-heading"><div><strong>{{ flag.key }}</strong><small>{{ flag.description || 'No description' }}</small><small>Updated {{ flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : '—' }}</small></div><span :class="['status-pill', flag.stage === 'off' ? 'new' : flag.stage === 'all' ? 'booked' : 'qualified']">{{ formatLabel(flag.stage) }}</span></div><div class="admin-detail-form-grid"><label>Stage<select v-model="flag.stage"><option value="off">Off</option><option value="internal">Internal</option><option value="reference_tenants">Reference tenants</option><option value="percentage">Percentage</option><option value="all">All customers</option></select></label><label>Percentage<input v-model.number="flag.rolloutPercentage" type="number" min="0" max="100" step="0.01" :disabled="flag.stage !== 'percentage'" /></label></div><label>Description<input v-model="flag.description" maxlength="500" /></label><label>Reference tenants<select v-model="flag.referenceOrganizationIds" multiple size="4"><option v-for="organization in adminFeatureFlagOrganizations" :key="organization.id" :value="organization.id">{{ organization.name }} · {{ organization.slug }}</option></select></label><div v-if="flag.overrides.length" class="feature-flag-overrides"><div v-for="override in flag.overrides" :key="override.organizationId" class="feature-flag-override"><span><strong>{{ adminFeatureFlagOrganizationName(override.organizationId) }}</strong><small>{{ override.state === 'on' ? 'Forced on' : 'Forced off' }} · {{ override.reason || 'No reason recorded' }}</small></span><button class="text-button" type="button" :disabled="adminFeatureFlagsLoading" @click="removeAdminFeatureFlagOverride(flag, override.organizationId)">Remove</button></div></div><div class="feature-flag-row-footer"><span>{{ flag.referenceOrganizationIds.length }} reference tenant{{ flag.referenceOrganizationIds.length === 1 ? '' : 's' }} · {{ flag.overrides.length }} override{{ flag.overrides.length === 1 ? '' : 's' }}</span><button class="primary-button small" type="button" :disabled="adminFeatureFlagsLoading" @click="saveAdminFeatureFlag(flag)">Save rollout →</button></div></article></div>
          </article>
          <article v-if="adminSection === 'overview' || adminSection === 'organizations'" class="panel table-panel admin-table-panel"><div class="table-heading admin-row"><span>Organization</span><span>Plan / status</span><span>Businesses</span><span>Outcomes</span><span>Actions</span></div><div v-if="!adminOrganizations.length" class="diagnostics-empty">No organizations found.</div><div v-for="organization in adminOrganizations" :key="organization.id" class="table-row admin-row"><div><strong>{{ organization.name }}</strong><small>{{ organization.ownerEmail ?? 'No owner email' }}</small></div><div><strong>{{ organization.planName }}</strong><small>{{ organization.status }} · {{ organization.mode }} · {{ organization.mrrAmountCents === null ? 'No MRR' : `$${(organization.mrrAmountCents / 100).toFixed(0)} MRR` }}</small><small v-if="organization.lastPaymentStatus || organization.cancelAtPeriodEnd">{{ organization.lastPaymentStatus ? `Payment ${organization.lastPaymentStatus}` : '' }}{{ organization.cancelAtPeriodEnd ? ' · cancellation scheduled' : '' }}</small></div><span>{{ organization.businessCount }}</span><span><strong>{{ organization.leadCount }}</strong> leads · {{ organization.conversationCount }} conversations</span><div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading || adminOrganizationDetailLoading" @click="loadAdminOrganizationDetail(organization.id)">Inspect</button><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'trial')">30-day trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'suspend')">Suspend</button></div></div></article>
          <template v-if="adminSection === 'business-detail'">
            <div v-if="adminBusinessDetailLoading" class="ds-card admin-detail-loading">Loading business detail…</div>
            <template v-else-if="adminBusinessDetail">
              <div class="section-toolbar admin-detail-toolbar"><div><p class="eyebrow">Business detail</p><h2>{{ adminBusinessDetail.business.name }}</h2><p>{{ adminBusinessDetail.business.websiteUrl }} · {{ adminBusinessDetail.business.slug }}</p></div><div class="toolbar-actions"><button v-if="adminBusinessDetail.business.ownershipStatus !== 'verified'" class="outline-button small" type="button" :disabled="adminLoading" @click="approveAdminBusiness(adminBusinessDetail.business)">Approve ownership</button><button class="outline-button small" type="button" @click="navigateToAdminSection('organizations')">← Back</button></div></div>
              <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><Database :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminBusinessDetail.business.sourceCount }}</strong><small>Knowledge sources</small><em>{{ adminBusinessDetail.business.chunkCount }} indexed chunks</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><UserCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminBusinessDetail.business.leadCount }}</strong><small>Leads captured</small><em>Persisted outcomes</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><MessageSquare :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminBusinessDetail.business.conversationCount }}</strong><small>Conversations</small><em>Customer activity</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><DollarSign :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminBusinessDetail.business.billingStatus }}</strong><small>Billing status</small><em>{{ adminBusinessDetail.business.ownershipStatus }} ownership</em></article></div>
              <div class="admin-detail-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Business context</p><h2>{{ adminBusinessDetail.organization.name }}</h2><p>{{ adminBusinessDetail.business.location || 'Location not provided' }} · Updated {{ adminBusinessDetail.business.updatedAt ? new Date(adminBusinessDetail.business.updatedAt).toLocaleDateString() : 'not yet' }}</p></div></div><div class="health-list"><div><span>Plan</span><strong>{{ adminBusinessDetail.business.planKey }}</strong></div><div><span>Ownership</span><strong>{{ adminBusinessDetail.business.ownershipStatus }}</strong></div><div><span>Organization access</span><strong>{{ adminBusinessDetail.organization.billing.access.allowed ? 'Write access' : 'Read-only' }}</strong></div></div><div class="detail-subsection"><p class="eyebrow">Organization members</p><div v-for="owner in adminBusinessDetail.owners" :key="`${owner.email}-${owner.role}`" class="detail-list-row"><span><strong>{{ owner.name || 'Unnamed user' }}</strong><small>{{ owner.email }}</small></span><span class="status-pill qualified">{{ owner.role }}</span></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Billing relationship</p><h2>{{ adminBusinessDetail.organization.billing.plan.displayName }}</h2><p>Business access follows the organization billing relationship.</p></div></div><div class="billing-intervention-note"><strong>Current organization billing</strong><span>{{ adminBusinessDetail.organization.billing.status }} · {{ adminBusinessDetail.organization.billing.amountCents === null ? 'No amount' : `$${(adminBusinessDetail.organization.billing.amountCents / 100).toFixed(2)}` }}</span><small>{{ adminBusinessDetail.organization.billing.access.reason }}</small></div><button class="outline-button small" type="button" @click="navigateToAdminSection('organization-detail', { organizationId: adminBusinessDetail.organization.id })">Open organization billing →</button></article></div>
            </template>
          </template>
          <template v-if="adminSection === 'organization-detail'">
            <div v-if="adminOrganizationDetailLoading" class="ds-card admin-detail-loading">Loading organization detail…</div>
            <template v-else-if="adminOrganizationDetail">
              <div class="section-toolbar admin-detail-toolbar"><div><p class="eyebrow">Organization detail</p><h2>{{ adminOrganizationDetail.organization.name }}</h2><p>{{ adminOrganizationDetail.organization.slug }} · inspect business health and apply audited billing interventions.</p></div><div class="toolbar-actions"><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminDetailBillingAction('trial')">Extend trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminDetailBillingAction('suspend')">Suspend</button><button class="outline-button small" type="button" @click="adminSection = 'organizations'">← Back</button></div></div>
              <p v-if="adminBillingMessage" class="saved-message">✓ {{ adminBillingMessage }}</p>
              <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><DollarSign :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminOrganizationDetail.organization.billing.plan.displayName }}</strong><small>Current plan</small><em>{{ adminOrganizationDetail.organization.billing.status }}</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><Building2 :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminOrganizationDetail.businesses.length }} / {{ adminOrganizationDetail.organization.billing.plan.maxBusinesses }}</strong><small>Business capacity</small><em>{{ adminOrganizationDetail.organization.billing.access.allowed ? 'Write access' : 'Read-only' }}</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><UserCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminOrganizationDetail.businesses.reduce((total, business) => total + business.leadCount, 0) }}</strong><small>Leads captured</small><em>Across businesses</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><MessageSquare :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminOrganizationDetail.businesses.reduce((total, business) => total + business.conversationCount, 0) }}</strong><small>Conversations</small><em>{{ adminOrganizationDetail.owners.length }} members</em></article></div>
            <div class="admin-detail-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Businesses & access</p><h2>Business health</h2><p>Review ownership, billing projection, source coverage, and activity before taking action.</p></div></div><div v-if="!adminOrganizationDetail.businesses.length" class="diagnostics-empty">No businesses are attached to this organization.</div><div v-for="business in adminOrganizationDetail.businesses" :key="business.id" class="admin-business-detail-row"><div><strong>{{ business.name }}</strong><small>{{ business.websiteUrl }} · {{ business.slug }}</small></div><div class="admin-business-metrics"><span>{{ business.sourceCount }} sources</span><span>{{ business.leadCount }} leads</span><span>{{ business.conversationCount }} conversations</span></div><div class="admin-business-status"><span :class="['status-pill', business.ownershipStatus === 'verified' ? 'booked' : 'qualified']">{{ business.ownershipStatus }}</span><span :class="['status-pill', business.billingStatus === 'active' || business.billingStatus === 'trial' ? 'booked' : 'new']">{{ business.billingStatus }}</span></div><button v-if="business.ownershipStatus !== 'verified'" class="outline-button small" type="button" :disabled="adminLoading" @click="approveAdminBusiness(business)">Approve ownership</button><span v-else class="saved-message">✓ Verified</span></div><div class="detail-subsection"><p class="eyebrow">Organization members</p><div v-for="owner in adminOrganizationDetail.owners" :key="`${owner.email}-${owner.role}`" class="detail-list-row"><span><strong>{{ owner.name || 'Unnamed user' }}</strong><small>{{ owner.email }}</small></span><span class="status-pill qualified">{{ owner.role }}</span></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Billing intervention</p><h2>Apply a controlled override</h2><p>Use a documented reason. This updates the organization and projected business billing state.</p></div></div><form class="admin-detail-form" @submit.prevent="saveAdminPlanOverride"><label>Plan<select v-model="adminOverridePlanKey"><option value="starter">Starter</option><option value="growth">Growth</option><option value="multi_business">Business Plus</option><option value="portfolio">Portfolio / Agency</option></select></label><div class="admin-detail-form-grid"><label>Interval<select v-model="adminOverrideInterval"><option value="month">Monthly</option><option value="year">Yearly</option></select></label><label>Amount (cents)<input v-model="adminOverrideAmountCents" type="number" min="0" step="1" inputmode="numeric" /></label><label>Max businesses<input v-model="adminOverrideMaxBusinesses" type="number" min="1" step="1" inputmode="numeric" /></label></div><label>Reason<textarea v-model="adminOverrideReason" rows="3" placeholder="Founding customer pricing, service recovery, or approved exception"></textarea></label><button class="primary-button small" type="submit" :disabled="adminLoading">{{ adminLoading ? 'Saving…' : 'Save intervention →' }}</button></form><div class="billing-intervention-note"><strong>Current billing</strong><span>{{ adminOrganizationDetail.organization.billing.status }} · {{ adminOrganizationDetail.organization.billing.plan.displayName }} · {{ adminOrganizationDetail.organization.billing.amountCents === null ? 'No amount' : `$${(adminOrganizationDetail.organization.billing.amountCents / 100).toFixed(2)}` }}</span><small v-if="adminOrganizationDetail.organization.billing.override">Existing override: {{ adminOrganizationDetail.organization.billing.override.reason }}</small><small v-if="adminOrganizationDetail.organization.billing.providerSubscriptionId">Stripe subscription {{ adminOrganizationDetail.organization.billing.providerSubscriptionId }} · {{ adminOrganizationDetail.organization.billing.lastPaymentStatus || 'payment pending' }}<span v-if="adminOrganizationDetail.organization.billing.cancelAtPeriodEnd"> · cancellation scheduled</span></small></div></article></div>
              <article class="panel table-panel admin-timeline-panel"><div class="panel-heading"><div><p class="eyebrow">Subscription event timeline</p><h2>Billing audit</h2><p>Internal Stripe and lifecycle milestones for troubleshooting.</p></div></div><div v-if="!adminOrganizationDetail.billingTimeline.length" class="diagnostics-empty">No billing events recorded yet.</div><div v-for="event in adminOrganizationDetail.billingTimeline" :key="event.eventKey" class="detail-list-row"><span><strong>{{ formatLabel(event.eventName) }}</strong><small>{{ event.occurredAt ? new Date(event.occurredAt).toLocaleString() : 'Unknown time' }}</small></span><span class="status-pill" :class="event.status === 'sent' ? 'booked' : event.status === 'failed' ? 'new' : 'qualified'">{{ event.status }}</span></div></article>
            </template>
          </template>
          <article v-if="adminSection === 'action-registry'" class="panel action-registry-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Conversion control</p><h2>Action registry review</h2><p>Review what the crawler found, keep unsafe candidates disabled, and choose the primary next step for each business.</p></div><div class="toolbar-actions"><span v-if="adminActionRegistryMessage" class="saved-message">✓ {{ adminActionRegistryMessage }}</span><button class="outline-button small" type="button" :disabled="adminActionRegistryLoading" @click="loadAdminActionRegistry">{{ adminActionRegistryLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><Zap :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminActionRegistry.length }}</strong><small>Detected actions</small><em>Across all businesses</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminActionRegistryEnabledCount }}</strong><small>Enabled actions</small><em>Available to visitors</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminActionRegistryReviewCount }}</strong><small>Needs review</small><em>Disabled or below confidence threshold</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><BadgeCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminActionRegistryPrimaryCount }}</strong><small>Primary actions</small><em>Explicit business choices</em></article></div>
            <p v-if="adminActionRegistryError" class="form-error">{{ adminActionRegistryError }}</p>
              <div class="action-registry-table-wrap"><div class="action-registry-table-heading"><span>Business / action</span><span>Evidence</span><span>Destination</span><span>Confidence</span><span>Controls</span></div><div v-if="!adminActionRegistry.length" class="diagnostics-empty">No crawled actions found yet.</div><template v-for="action in adminActionRegistry" :key="action.id"><div class="action-registry-row"><div><strong>{{ action.businessName }}</strong><small>{{ action.name }} · {{ formatLabel(action.actionType) }}</small><small v-if="action.steps?.length">Workflow: {{ action.steps.length }} steps · v{{ action.workflowVersion ?? 1 }}</small><small>{{ action.businessSlug }}</small><small>{{ formatLabel(action.origin) }} · {{ formatLabel(action.lifecycleStatus) }}<span v-if="action.reviewReason"> · {{ formatLabel(action.reviewReason) }}</span></small><small :class="action.readiness?.ready ? 'action-readiness-ready' : 'action-readiness-attention'">{{ action.readiness?.ready ? 'Ready' : `Needs setup · ${formatLabel(action.readiness?.reason || 'incomplete')}` }}</small><span v-if="action.isPrimary" class="status-pill qualified action-primary-pill">Primary action</span></div><div><small>{{ action.evidence[0]?.quote || 'No source evidence captured' }}</small><small>{{ formatLabel(action.sourceType || 'unknown') }} · Discovered {{ action.discoveredAt ? new Date(action.discoveredAt).toLocaleString() : '—' }}</small><small v-if="action.sourceLabel">Extracted label: {{ action.sourceLabel }}</small><small v-if="action.classificationReason" :title="action.classificationReason">Why: {{ action.classificationReason }}</small><a v-if="action.sourceUrl" :href="action.sourceUrl" target="_blank" rel="noreferrer">Open source ↗</a></div><div><a v-if="action.destination?.url" :href="action.destination.url" target="_blank" rel="noreferrer">{{ action.destination.label || action.destination.url }}</a><small v-else>No destination</small><small v-if="action.provider">Provider: {{ action.provider }}</small><small>{{ formatLabel(action.safetyPolicy) }}</small></div><div><strong>{{ action.confidence === null ? '—' : `${Math.round(action.confidence * 100)}%` }}</strong><small>Priority {{ action.priority }}</small><small>{{ action.enabled ? 'Enabled' : 'Disabled' }}</small></div><div class="admin-actions action-registry-controls"><button v-if="action.steps?.length" class="text-button" type="button" :disabled="adminWorkflowAuditLoading" @click="loadAdminWorkflowAudit(action)">{{ adminWorkflowDetailsActionId === action.id ? 'Hide workflow' : 'Advanced workflow' }}</button><button v-if="action.enabled" class="outline-button small" type="button" :disabled="adminActionRegistryLoading" @click="updateAdminRegistryAction(action, false)">Disable</button><button v-else class="outline-button small" type="button" :disabled="adminActionRegistryLoading || (action.confidence ?? 0) < 0.88 || action.safetyPolicy === 'manual_review' || (action.actionType === 'call_emergency' && !action.destination?.url?.startsWith('tel:'))" :title="(action.confidence ?? 0) < 0.88 ? 'Low-confidence actions need stronger evidence' : action.actionType === 'call_emergency' ? 'Emergency actions also require verified source ownership and evidence' : 'Approve action'" @click="updateAdminRegistryAction(action, true)">{{ action.origin === 'discovered' ? 'Approve' : 'Enable' }}</button><button class="text-button action-primary-button" type="button" :disabled="adminActionRegistryLoading || !action.enabled || !action.readiness?.ready" :title="!action.readiness?.ready ? 'Complete the action setup before making it primary' : undefined" @click="setAdminPrimaryAction(action)">{{ action.isPrimary ? 'Clear primary' : 'Set primary' }}</button></div></div><div v-if="adminWorkflowDetailsActionId === action.id" class="admin-workflow-details"><div class="admin-workflow-details-heading"><div><p class="eyebrow">Super Admin advanced view</p><h3>Workflow execution map</h3><p>Inspect transitions, provider calls, conditions, retries, traces, and failure paths.</p></div><span v-if="adminWorkflowAuditLoading" class="conversation-status">Loading trace…</span></div><div class="admin-workflow-stat-grid"><span><strong>{{ adminWorkflowStats(action).transitions }}</strong>Transitions</span><span><strong>{{ adminWorkflowStats(action).providerCalls }}</strong>Provider calls</span><span><strong>{{ adminWorkflowStats(action).conditions }}</strong>Conditions</span><span><strong>{{ adminWorkflowStats(action).retries }}</strong>Retries</span><span><strong>{{ adminWorkflowStats(action).failurePaths }}</strong>Failure paths</span></div><div class="admin-workflow-step-list"><div v-for="(step, index) in action.steps" :key="step.id || index"><span>{{ index + 1 }}</span><strong>{{ formatLabel(step.type || 'step') }}</strong><small>{{ step.id || 'generated step' }}<span v-if="step.nextStepId"> · → {{ step.nextStepId }}</span></small></div></div><p v-if="adminWorkflowAuditError" class="form-error">{{ adminWorkflowAuditError }}</p><div v-if="!adminWorkflowAuditLoading && !adminWorkflowAudit.length" class="diagnostics-empty">No audit trace recorded for this workflow yet.</div><div v-for="event in adminWorkflowAudit" :key="event.id" class="admin-workflow-trace-row"><span>{{ formatLabel(event.eventType) }}</span><small>{{ event.actorName || event.actorType }} · {{ new Date(event.createdAt).toLocaleString() }}</small><em v-if="event.reason">{{ formatLabel(event.reason) }}</em></div></div></template></div>
          </article>
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
          <article v-if="adminSection === 'support'" class="panel installation-support-admin-panel support-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Customer operations</p><h2>Support cases</h2><p>Every case is linked to the tenant, affected feature, diagnostics, recent errors, and an auditable status history.</p></div><div class="toolbar-actions"><span v-if="adminSupportMessage" class="saved-message">✓ {{ adminSupportMessage }}</span><button class="outline-button small" type="button" :disabled="adminSupportLoading" @click="loadAdminSupportCases">{{ adminSupportLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon orange"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminSupportSummary.open }}</strong><small>Open</small><em>Needs first response</em></article><article class="ds-stat-card"><span class="ds-stat-icon blue"><Activity :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminSupportSummary.inProgress }}</strong><small>In progress</small><em>Assigned or being handled</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminSupportSummary.resolved }}</strong><small>Resolved</small><em>Closed cases</em></article></div>
            <p v-if="adminSupportError" class="form-error">{{ adminSupportError }}</p>
            <div class="table-heading support-case-admin-row"><span>Business / requester</span><span>Case</span><span>Diagnostics</span><span>Owner</span><span>Status</span></div>
            <div v-if="!adminSupportCases.length" class="diagnostics-empty">No support cases yet.</div>
            <div v-for="item in adminSupportCases" :key="item.id" class="table-row support-case-admin-row">
              <div><button class="text-button support-business-link" type="button" @click="openAdminSupportBusiness(item)">{{ item.businessName }}</button><small>{{ item.requesterName }} · {{ item.requesterEmail }}</small><small>{{ new Date(item.createdAt).toLocaleString() }}</small></div>
              <div><strong>{{ item.subject }}</strong><small><span class="status-pill qualified">{{ formatLabel(item.category) }}</span><span v-if="item.provider"> · {{ formatLabel(item.provider) }}</span></small><small>{{ item.description }}</small></div>
              <div><small>Page: {{ item.sourcePage || 'Support' }}</small><small>Correlation: {{ item.correlationId }}</small><small>Severity: {{ item.severity }}</small><button class="text-button" type="button" :disabled="adminSupportLoading" @click="openAdminSupportView(item)">View as owner ↗</button></div>
              <select v-model="item.assignedUserId" aria-label="Assign support case" :disabled="adminSupportLoading" @change="updateAdminSupportCase(item)"><option :value="null">Unassigned</option><option v-for="assignee in adminSupportAssignees" :key="assignee.id" :value="assignee.id">{{ assignee.name || assignee.email }}</option></select>
              <select v-model="item.status" aria-label="Update support case status" :disabled="adminSupportLoading" @change="updateAdminSupportCase(item)"><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select>
            </div>
          </article>
          <article v-if="adminSection === 'installation-support'" class="panel installation-support-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Customer onboarding</p><h2>Installation support requests</h2><p>Self-service first, human help one click away. Every request includes the website and widget context your team needs.</p></div><div class="toolbar-actions"><span v-if="installationSupportMessage" class="saved-message">✓ {{ installationSupportMessage }}</span><button class="outline-button small" type="button" :disabled="installationSupportLoading" @click="loadAdminInstallationSupport">{{ installationSupportLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <div class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon orange"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ installationSupportSummary.new }}</strong><small>New</small><em>Needs first response</em></article><article class="ds-stat-card"><span class="ds-stat-icon blue"><Activity :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ installationSupportSummary.inProgress }}</strong><small>In progress</small><em>Assigned or being handled</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ installationSupportSummary.resolved }}</strong><small>Resolved</small><em>Closed requests</em></article></div>
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
          <article v-if="adminSection === 'recovery'" class="panel onboarding-recovery-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Customer onboarding health</p><h2>Recovery funnel</h2><p>Recover high-intent setups with the exact progress, blocker, and next step each owner needs.</p></div><div class="toolbar-actions"><button class="outline-button small" type="button" :disabled="adminRecoveryLoading" @click="loadAdminRecovery">{{ adminRecoveryLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
            <p v-if="adminRecoveryError" class="form-error">{{ adminRecoveryError }}</p>
            <div v-if="adminRecovery" class="ds-stat-grid admin-detail-stat-grid recovery-funnel-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><UsersRound :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRecovery.funnel.incompleteSignups }}</strong><small>Incomplete signups</small><em>Not published yet</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><Mail :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRecovery.funnel.reminded }}</strong><small>Reminded</small><em>Entered recovery</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><RotateCcw :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRecovery.funnel.returned }}</strong><small>Returned</small><em>Activity after email</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRecovery.funnel.finishedSetup }}</strong><small>Finished setup</small><em>80%+ complete</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><BadgeCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRecovery.funnel.published }}</strong><small>Published</small><em>Live AI front desks</em></article></div>
            <div v-if="adminRecovery" class="recovery-funnel-explainer"><span>{{ adminRecovery.funnel.incompleteSignups }} incomplete signups</span><ArrowRight :size="14" aria-hidden="true" /><span>{{ adminRecovery.funnel.reminded }} reminded</span><ArrowRight :size="14" aria-hidden="true" /><span>{{ adminRecovery.funnel.returned }} returned</span><ArrowRight :size="14" aria-hidden="true" /><span>{{ adminRecovery.funnel.finishedSetup }} finished setup</span><ArrowRight :size="14" aria-hidden="true" /><span>{{ adminRecovery.funnel.published }} published</span></div>
            <div class="table-heading onboarding-recovery-row"><span>Business / owner</span><span>Progress</span><span>Next step / blocker</span><span>Recovery state</span><span>Activity</span></div>
            <div v-if="!adminRecovery?.records.length" class="diagnostics-empty">No onboarding recovery records yet.</div>
            <div v-for="item in adminRecovery?.records" :key="item.businessId" class="table-row onboarding-recovery-row">
              <div><strong>{{ item.businessName }}</strong><small>{{ item.ownerName || 'Verified owner' }}<span v-if="item.ownerEmail"> · {{ item.ownerEmail }}</span></small><small>{{ formatLabel(item.onboardingStage) }}</small></div>
              <div class="recovery-progress-cell"><strong>{{ item.published ? 'Published' : `${item.completionPercent}%` }}</strong><span class="progress-bar"><span :style="{ width: `${item.published ? 100 : item.completionPercent}%` }"></span></span></div>
              <div><strong>{{ item.currentBlocker || (item.published ? 'Live' : 'No blocker recorded') }}</strong><small v-if="item.lastSuccessfulStep">Last success: {{ item.lastSuccessfulStep }}</small><small v-if="item.lastError">Error: {{ item.lastError }}</small></div>
              <div><span :class="['status-pill', item.unsubscribed || item.dormant ? 'new' : item.reminderCount ? 'qualified' : 'booked']">{{ item.unsubscribed ? 'Unsubscribed' : item.dormant ? 'Dormant' : item.reminderCount ? `${item.reminderCount} reminder${item.reminderCount === 1 ? '' : 's'}` : 'Monitoring' }}</span><small>{{ item.returnedAfterEmail ? 'Returned after email' : item.emailOpened ? 'Email opened' : item.lastReminderType ? formatLabel(item.lastReminderType) : 'No email yet' }}</small></div>
              <div><strong>{{ item.lastActivityAt ? new Date(item.lastActivityAt).toLocaleString() : '—' }}</strong><small v-if="item.lastReminderAt">Last reminder {{ new Date(item.lastReminderAt).toLocaleString() }}</small></div>
            </div>
          </article>
          <article v-if="adminSection === 'messaging'" class="panel messaging-admin-panel">
            <div class="section-toolbar"><div><p class="eyebrow">Lifecycle messaging</p><h2>Centralized communication control</h2><p>Manage transactional templates, activation automations, and delivery health without putting email logic in product requests.</p></div><div class="toolbar-actions"><span v-if="messagingSummary" class="status-pill" :class="messagingSummary.provider.configured ? 'booked' : 'new'">{{ messagingSummary.provider.configured ? 'Provider ready' : 'Provider setup needed' }}</span><button class="outline-button small" type="button" :disabled="messagingLoading" @click="loadAdminMessaging(true)">Refresh</button></div></div>
            <div v-if="messagingSummary" class="ds-stat-grid admin-detail-stat-grid"><article class="ds-stat-card"><span class="ds-stat-icon blue"><Send :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ messagingSummary.last24Hours.queued }}</strong><small>Queued · last 24h</small><em>Async delivery</em></article><article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ messagingSummary.last24Hours.sent }}</strong><small>Sent · last 24h</small><em>SES accepted</em></article><article class="ds-stat-card"><span class="ds-stat-icon orange"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ messagingSummary.last24Hours.deferred }}</strong><small>Deferred</small><em>Retrying automatically</em></article><article class="ds-stat-card"><span class="ds-stat-icon purple"><Mail :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ messagingSummary.last24Hours.failed }}</strong><small>Failed</small><em>Needs review</em></article></div>
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
          <div v-if="adminSection === 'operations'" class="admin-operations-stack">
            <div class="admin-overview-grid">
              <article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">System health</p><h2>Infrastructure readiness</h2><p>Refresh this page after changing Render, storage, email, or model configuration.</p></div><button class="outline-button small" type="button" @click="loadAdminHealth">Refresh checks</button></div><div class="health-list health-list-large"><div><span>API</span><strong :class="`health-${adminHealth?.api ?? 'degraded'}`">{{ adminHealth?.api ?? 'Checking…' }}</strong></div><div><span>Database</span><strong>{{ adminHealth?.database ?? 'Checking…' }}</strong></div><div><span>Object storage</span><strong>{{ adminHealth?.objectStorageConfigured ? 'Ready' : 'Not configured' }}</strong></div><div><span>Transactional email</span><strong>{{ adminHealth?.emailConfigured ? 'Ready' : 'Not configured' }}</strong></div><div><span>Stripe billing</span><strong>{{ adminHealth?.stripeConfigured ? 'Ready' : 'Not configured' }}</strong></div></div></article>
              <article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Delivery test</p><h2>Email operations</h2><p>Send a controlled SES test to the authenticated super-admin address.</p></div></div><button class="primary-button small" type="button" :disabled="adminEmailTestLoading" @click="testAdminEmail">{{ adminEmailTestLoading ? 'Sending…' : 'Send test email →' }}</button><p v-if="adminEmailTestMessage" class="saved-message">✓ {{ adminEmailTestMessage }}</p></article>
            </div>
            <section class="panel request-metrics-panel">
              <div class="section-toolbar"><div><p class="eyebrow">Capacity planning · last {{ adminRequestMetrics?.windowHours ?? 24 }}h</p><h2>Where API traffic is coming from</h2><p>Aggregated route counts separate customer work, polling, background telemetry, health checks, and internal traffic.</p></div><button class="outline-button small" type="button" :disabled="adminRequestMetricsLoading" @click="loadAdminRequestMetrics">{{ adminRequestMetricsLoading ? 'Refreshing…' : 'Refresh metrics' }}</button></div>
              <p v-if="adminRequestMetricsError" class="form-error">{{ adminRequestMetricsError }}</p>
              <div v-if="adminRequestMetrics" class="ds-stat-grid admin-detail-stat-grid request-health-stat-grid">
                <article class="ds-stat-card"><span class="ds-stat-icon blue"><MessageSquare :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.requests.toLocaleString() ?? '0' }}</strong><small>Customer traffic</small><em>Infrastructure noise excluded</em></article>
                <article class="ds-stat-card"><span class="ds-stat-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ ((adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.requests ?? 0) - (adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.errors ?? 0)).toLocaleString() }}</strong><small>Successful customer responses</small><em>Based on 5xx responses</em></article>
                <article class="ds-stat-card"><span class="ds-stat-icon purple"><Gauge :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ requestMetricDuration(adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.p95ApproxMs) }}</strong><small>Customer p95 latency</small><em>p50 {{ requestMetricDuration(adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.p50ApproxMs) }} · p99 {{ requestMetricDuration(adminRequestMetrics.trafficClasses.find((item) => item.trafficClass === 'customer_value')?.p99ApproxMs) }}</em></article>
                <article class="ds-stat-card"><span class="ds-stat-icon orange"><TriangleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /></span><strong>{{ requestMetricPercent(adminRequestMetrics.totals.errorRate) }}</strong><small>5xx rate</small><em>{{ adminRequestMetrics.totals.errors.toLocaleString() }} server errors</em></article>
              </div>
              <div v-if="adminRequestMetrics" class="request-metrics-grid">
                <article class="ds-card request-attention-card"><div class="panel-heading"><div><p class="eyebrow">Actionable attention</p><h3>What needs investigation</h3><small>Lifecycle 404/410s are shown separately from failures.</small></div></div><div v-if="!adminRequestMetrics.routes.some((item) => (item.trafficClass === 'polling' && item.route?.endsWith('/status') && item.errorRate > 0.01) || item.errorRate > 0.01)" class="diagnostics-empty">No route is above the 1% 5xx investigation threshold.</div><div v-for="item in adminRequestMetrics.routes.filter((route) => (route.trafficClass === 'polling' && route.route?.endsWith('/status') && route.errorRate > 0.01) || route.errorRate > 0.01).slice(0, 6)" :key="`${item.method}-${item.route}-${item.trafficClass}-attention`" class="detail-list-row"><span><strong>{{ item.method }} {{ item.route }}</strong><small>{{ formatLabel(item.trafficClass || 'other') }} · {{ item.requests.toLocaleString() }} requests</small><small>{{ requestMetricStatusSummary(item) }}</small></span><span><strong>{{ requestMetricPercent(item.errorRate) }} 5xx</strong><small>p95 {{ requestMetricDuration(item.p95ApproxMs) }}</small></span></div></article>
                <article class="ds-card"><div class="panel-heading"><div><p class="eyebrow">Traffic mix</p><h3>Customer-value first</h3><small>Health checks remain visible, but do not lead the headline.</small></div></div><div v-if="!adminRequestMetrics.trafficClasses.length" class="diagnostics-empty">No persisted samples yet. Metrics appear after the next flush.</div><div v-for="item in adminRequestMetrics.trafficClasses" :key="item.trafficClass" class="detail-list-row"><span><strong>{{ formatLabel(item.trafficClass || 'other') }}</strong><small>{{ item.requests.toLocaleString() }} requests · {{ requestMetricDuration(item.averageDurationMs) }} average</small><small>p50 {{ requestMetricDuration(item.p50ApproxMs) }} · p95 {{ requestMetricDuration(item.p95ApproxMs) }} · p99 {{ requestMetricDuration(item.p99ApproxMs) }}</small></span><span><strong>{{ requestMetricPercent(item.requests / Math.max(1, adminRequestMetrics.totals.requests)) }}</strong><small>{{ requestMetricPercent(item.errorRate) }} 5xx</small></span></div></article>
                <article class="ds-card"><div class="panel-heading"><div><p class="eyebrow">Error classification</p><h3>Why requests failed</h3><small>Derived from response status codes; status breakdown is the source of truth.</small></div></div><div v-if="!adminRequestMetrics.errorClasses.length" class="diagnostics-empty">No non-2xx response classes recorded.</div><div v-for="item in adminRequestMetrics.errorClasses" :key="item.failureClass" class="detail-list-row"><span><strong :class="`request-error-${requestMetricErrorClassTone(item.failureClass)}`">{{ requestMetricErrorClassLabel(item.failureClass) }}</strong><small>{{ item.requests.toLocaleString() }} responses</small></span><span><strong>{{ requestMetricPercent(item.errorRate) }}</strong><small>of all requests</small></span></div></article>
                <article class="ds-card"><div class="panel-heading"><div><p class="eyebrow">AI response stages</p><h3>Where message time goes</h3><small>Instrumented message-backend timings.</small></div></div><div v-if="!adminRequestMetrics.responseStages.length" class="diagnostics-empty">No message stage samples yet.</div><div v-for="item in adminRequestMetrics.responseStages" :key="item.stage" class="detail-list-row"><span><strong>{{ formatLabel(item.stage) }}</strong><small>{{ item.samples.toLocaleString() }} samples · avg {{ requestMetricDuration(item.averageDurationMs) }}</small></span><span><strong>p95 {{ requestMetricDuration(item.p95DurationMs) }}</strong><small>p50 {{ requestMetricDuration(item.p50DurationMs) }}</small></span></div></article>
                <article class="ds-card request-routes-card"><div class="panel-heading"><div><p class="eyebrow">Top routes</p><h3>Highest request volume</h3><small>Each row includes p50, p95, p99, and the observed non-2xx statuses.</small></div></div><div v-if="!adminRequestMetrics.routes.length" class="diagnostics-empty">No route samples yet.</div><div v-for="item in adminRequestMetrics.routes.slice(0, 12)" :key="`${item.method}-${item.route}-${item.trafficClass}`" class="detail-list-row"><span><strong>{{ item.method }} {{ item.route }}</strong><small>{{ formatLabel(item.trafficClass || 'other') }} · {{ item.requests.toLocaleString() }} requests · {{ requestMetricPercent(item.errorRate) }} 5xx</small><small>p50 {{ requestMetricDuration(item.p50ApproxMs) }} · p95 {{ requestMetricDuration(item.p95ApproxMs) }} · p99 {{ requestMetricDuration(item.p99ApproxMs) }} · {{ requestMetricStatusSummary(item) }}</small></span><span><strong>{{ requestMetricDuration(item.averageDurationMs) }}</strong><small>average</small></span></div></article>
              </div>
              <p v-else class="diagnostics-empty">Request metrics are loading…</p>
            </section>
          </div>
        </div>

        <div v-else class="view-content empty-view"><div class="empty-icon"><CircleHelp :size="30" :stroke-width="1.8" aria-hidden="true" /></div><p class="eyebrow">{{ pageTitle }}</p><h2>This page is unavailable</h2><p>Return to the overview and choose a workspace section.</p><button class="primary-button small" type="button" @click="view = 'overview'">Back to overview <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
      </section>
    </section>

    <div v-if="view === 'admin' && adminSection === 'action-registry' && selectedAdminWorkflowAction" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="workflow-replay-title" @click.self="adminWorkflowDetailsActionId = ''"><section class="auth-card admin-workflow-replay-modal"><button class="auth-close" type="button" aria-label="Close replay" @click="adminWorkflowDetailsActionId = ''">×</button><p class="eyebrow">Replay workflow · {{ selectedAdminWorkflowAction.businessName }}</p><h2 id="workflow-replay-title">Re-run a failed turn safely</h2><p class="auth-copy">Run this visitor turn against workflow v{{ selectedAdminWorkflowAction.workflowVersion ?? 1 }}. This dry run does not change production data.</p><label>Conversation ID<input v-model="adminWorkflowReplayConversationId" type="text" placeholder="Paste the failed conversation ID" /></label><label>Visitor turn<textarea v-model="adminWorkflowReplayQuestion" rows="3" placeholder="e.g. Actually, Clearwater works better on Saturdays."></textarea></label><button class="primary-button small" type="button" :disabled="adminWorkflowReplayLoading || !adminWorkflowReplayConversationId.trim() || !adminWorkflowReplayQuestion.trim()" @click="replayAdminWorkflow(selectedAdminWorkflowAction)">{{ adminWorkflowReplayLoading ? 'Replaying…' : 'Replay turn' }}</button><p v-if="adminWorkflowReplayError" class="form-error">{{ adminWorkflowReplayError }}</p><div v-if="adminWorkflowReplayResult" class="admin-workflow-replay-result"><span>Next best action: <strong>{{ formatLabel(String(adminWorkflowReplayResult.nextBestActionAfter || 'unknown')) }}</strong></span><span>Provider result: <strong>{{ adminWorkflowReplayResult.providerResult ? 'Captured' : 'None' }}</strong></span><details><summary>View state before / after</summary><pre>{{ JSON.stringify({ stateBefore: adminWorkflowReplayResult.stateBefore, extractedFields: adminWorkflowReplayResult.extractedFields, nextBestAction: adminWorkflowReplayResult.nextBestActionAfter, providerCall: adminWorkflowReplayResult.providerCall, providerResult: adminWorkflowReplayResult.providerResult, stateAfter: adminWorkflowReplayResult.stateAfter }, null, 2) }}</pre></details></div></section></div>

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
        <div v-if="selectedLead.metadata.workflow || selectedLead.metadata.selectedService || selectedLead.metadata.selectedLocation || selectedLead.metadata.journeyStatus" class="lead-qualification-card"><span class="eyebrow">Qualification</span><strong>{{ formatLabel(String(selectedLead.metadata.workflow || selectedLead.intent)) }}</strong><small v-if="selectedLead.metadata.selectedService">Recommended: {{ selectedLead.metadata.selectedService }}</small><small v-if="selectedLead.metadata.selectedLocation">Location: {{ selectedLead.metadata.selectedLocation }}</small><small v-if="selectedLead.metadata.schedulePreference">Schedule: {{ selectedLead.metadata.schedulePreference }}</small><small v-if="selectedLead.metadata.providerObjectId">Provider ID: {{ selectedLead.metadata.providerObjectId }}</small><small v-if="selectedLead.metadata.conversionStage">Stage: {{ formatLabel(String(selectedLead.metadata.conversionStage)) }}</small><small v-if="selectedLead.metadata.journeyStatus">Journey: {{ formatLabel(String(selectedLead.metadata.journeyStatus)) }}<span v-if="selectedLead.metadata.followUpStatus"> · {{ formatLabel(String(selectedLead.metadata.followUpStatus)) }} follow-up</span></small></div>
        <div class="lead-detail-actions"><button v-if="!focusedTeamMode" class="outline-button small danger-text" type="button" :disabled="leadDetailLoading" @click="deleteLead">Delete record</button><button class="primary-button auth-submit" type="submit" :disabled="leadDetailLoading">{{ leadDetailLoading ? 'Saving…' : 'Save lead →' }}</button></div>
      </form>
    </div>

    <div v-if="authModalOpen" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title" @click.self="!authRequiresSignIn && (authModalOpen = false)">
      <form class="auth-card" @submit.prevent="authMode === 'forgot' ? resetPassword() : submitAuth()">
        <button v-if="!authRequiresSignIn" class="auth-close" type="button" aria-label="Close" @click="authModalOpen = false">×</button>
        <p class="eyebrow">{{ authMode === 'signup' ? 'Save your AI front desk' : authMode === 'forgot' ? 'Account recovery' : 'Welcome back' }}</p>
        <h2 id="auth-title">{{ authMode === 'signup' ? 'Create your FrontDeskWise account' : authMode === 'forgot' ? 'Reset your password' : 'Sign in to FrontDeskWise' }}</h2>
        <p class="auth-copy">{{ authMode === 'signup' ? (publicDemoMode ? 'Your workspace stays attached to your new organization.' : 'Create your organization and add your first business.') : authMode === 'forgot' ? 'Enter your email and we will send password recovery instructions.' : 'Pick up where you left off across all your businesses.' }}</p>
        <label>Email<input v-model="authEmail" type="email" autocomplete="email" required placeholder="name@company.com" /></label>
        <label v-if="authMode !== 'forgot'">Password<input v-model="authPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters" /></label>
        <label v-if="authMode === 'signup'">Organization name <span class="optional">optional</span><input v-model="authOrganizationName" type="text" placeholder="Your company" /></label>
        <div v-if="authSuccess" class="auth-success" role="status" aria-live="polite"><CircleCheck :size="20" :stroke-width="2" aria-hidden="true" /><span><strong>Reset email sent</strong><small>{{ authSuccess }}</small></span></div>
        <p v-if="authError" class="form-error" role="alert">{{ authError }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="authLoading">{{ authLoading ? 'Working…' : authMode === 'signup' ? 'Create account →' : authMode === 'forgot' ? (authSuccess ? 'Send again' : 'Send reset instructions') : 'Sign in →' }}</button>
        <template v-if="authMode !== 'forgot'"><div class="auth-divider"><span>or</span></div><button class="google-button" type="button" :disabled="authLoading" @click="submitGoogleAuth"><span class="google-mark">G</span> Continue with Google</button></template>
        <button v-if="authMode === 'signin'" class="text-button auth-switch" type="button" @click="openAuth('forgot')">Forgot password?</button>
        <button class="text-button auth-switch" type="button" @click="openAuth(authMode === 'signup' ? 'signin' : 'signup')">{{ authMode === 'signup' ? 'Already have an account? Sign in' : authMode === 'forgot' ? 'Back to sign in' : 'New to FrontDeskWise? Create an account' }}</button>
      </form>
    </div>

    <aside v-if="view === 'inbox' && selectedInboxConversation?.action?.workflow" class="workflow-floating-card" aria-label="Workflow progress">
      <div class="workflow-progress-heading"><div><span class="inbox-table-kicker">Workflow state</span><strong>{{ selectedInboxConversation.action.workflow.name }}</strong></div><span>{{ selectedInboxConversation.action.workflow.progressPercent }}%</span></div>
      <div class="workflow-progress-track"><span :style="{ width: `${selectedInboxConversation.action.workflow.progressPercent}%` }"></span></div>
      <p>Next best action: <strong>{{ formatLabel(selectedInboxConversation.action.workflow.nextBestAction) }}</strong></p>
      <div class="workflow-step-list"><span v-for="step in selectedInboxConversation.action.workflow.steps" :key="step.id" :class="['workflow-step', step.status]"><b>{{ step.status === 'completed' ? '✓' : step.status === 'current' ? '○' : '·' }}</b>{{ step.label }}</span></div>
      <small v-if="selectedInboxConversation.action.workflow.missing.length">Missing: {{ selectedInboxConversation.action.workflow.missing.map(formatLabel).join(', ') }}</small>
    </aside>

    </template>
    <AppFeedback :loading="!authInitializing && (globalLoading || authLoading)" :toasts="feedbackToasts" @dismiss="dismissToast" />
  </main>
</template>

