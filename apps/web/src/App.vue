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

type View = "home" | "privacy" | "terms" | "overview" | "inbox" | "team" | "conversations" | "leads" | "knowledge" | "actions" | "connections" | "agent" | "analytics" | "businesses" | "settings" | "billing" | "admin";
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
  agent?: { assistantName?: string; welcomeMessage?: string; widgetColor?: string; collectLeads?: boolean; showBookingAction?: boolean; widgetDefaultMode?: "compact" | "expanded" | "fullscreen"; widgetAllowExpand?: boolean; widgetQuickActions?: WidgetQuickAction[]; widgetLogoUrl?: string | null; proactiveEnabled?: boolean; proactiveDelaySeconds?: number; proactiveMessage?: string; proactiveTriggers?: Array<"delay" | "scroll" | "exit" | "returning">; requireLeadConsent?: boolean; privacyNoticeUrl?: string | null; retentionDays?: number; showAiDisclosure?: boolean };
  suggestedQuestions?: string[];
  ownership?: { status: "pending" | "verified" | "rejected"; method: VerificationMethod | null; verifiedAt: string | null };
  knowledge?: { sourceCount: number; chunkCount: number; openGaps: number; pendingSources?: number; failedSources?: number; status?: string; sources?: WorkspaceSource[]; readiness?: { score: number; sources: number; chunks: number; openGaps: number; pendingSources?: number; failedSources?: number } };
  stats?: WorkspaceStats;
}

interface FeaturedDemo extends WorkspacePayload {
  business: { id: string; name: string; location: string; websiteUrl: string };
  knowledge: { sourceCount: number; chunkCount: number; openGaps: number; pendingSources?: number; failedSources?: number; status?: string; sources?: WorkspaceSource[]; readiness?: { score: number; sources: number; chunks: number; openGaps: number; pendingSources?: number; failedSources?: number } };
  stats: WorkspaceStats;
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

type AdminSection = "overview" | "organizations" | "organization-detail" | "users" | "demos" | "operations";

interface AdminHealthSnapshot {
  api: "healthy" | "degraded" | "down";
  database: string;
  objectStorageConfigured: boolean;
  emailConfigured: boolean;
  stripeConfigured: boolean;
  checkedAt: string;
}

const view = ref<View>("home");
const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
function apiUrl(path: string): string {
  return `${apiOrigin}${path}`;
}

const websiteUrl = ref("");
const demoRequesterName = ref("");
const demoRequesterEmail = ref("");
const isGenerating = ref(false);
const generationError = ref("");
const demoSlug = ref("british-swim-school-tampa-bay");
const demoAccessToken = ref(typeof window !== "undefined" ? window.localStorage.getItem("frontdeskwiseDemoAccessToken") ?? "" : "");
const publicDemoMode = ref(false);
const firebaseToken = ref("");
const authSnapshot = ref<AuthSnapshot | null>(null);
const authModalOpen = ref(false);
const authMode = ref<"signin" | "signup">("signin");
const authEmail = ref("");
const authPassword = ref("");
const authOrganizationName = ref("");
const authError = ref("");
const authLoading = ref(false);
const businessName = ref("");
const businessLocation = ref("");
const assistantName = ref("AI Front Desk");
const welcomeMessage = ref("Hi! I can answer questions from this business's website and help you get started.");
const widgetColor = ref("#0d6efd");
const showLeadCapture = ref(true);
const showBookingAction = ref(true);
const widgetDefaultMode = ref<"compact" | "expanded" | "fullscreen">("compact");
const widgetAllowExpand = ref(true);
const widgetLogoUrl = ref("");
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
const actionTriggerText = ref("");
const billingSnapshot = ref<BillingSnapshot | null>(null);
const billingLoading = ref(false);
const billingError = ref("");
const billingMessage = ref("");
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
const adminOrganizationDetail = ref<AdminOrganizationDetail | null>(null);
const adminOrganizationDetailLoading = ref(false);
const adminBillingMessage = ref("");
const adminOverridePlanKey = ref("starter");
const adminOverrideInterval = ref<"month" | "year">("month");
const adminOverrideAmountCents = ref("9900");
const adminOverrideMaxBusinesses = ref("1");
const adminOverrideReason = ref("");
const featuredDemos = ref<FeaturedDemo[]>([]);
const workspaceStats = ref<WorkspaceStats | null>(null);
const workspaceKnowledge = ref<WorkspacePayload["knowledge"] | null>(null);
const workspaceReadiness = ref(0);
const workspaceLoading = ref(false);
const workspaceError = ref("");
let stopFirebaseObserver: (() => void) | null = null;

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
const embeddingLoading = ref(false);
const embeddingMessage = ref("");

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "inbox", label: "Inbox", icon: "✉" },
  { id: "team", label: "Team", icon: "♙" },
  { id: "conversations", label: "Conversations", icon: "◌" },
  { id: "leads", label: "Leads", icon: "♧" },
  { id: "knowledge", label: "Knowledge", icon: "▤" },
  { id: "actions", label: "Actions & Flows", icon: "ϟ" },
  { id: "connections", label: "Connections", icon: "↔" },
  { id: "agent", label: "Agent & Widget", icon: "✦" },
  { id: "analytics", label: "Analytics", icon: "◒" },
  { id: "businesses", label: "Businesses", icon: "▦" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "billing", label: "Billing", icon: "$" },
];

const adminNavItems: Array<{ id: AdminSection; label: string; icon: string }> = [
  { id: "overview", label: "Command center", icon: "⌂" },
  { id: "organizations", label: "Organizations", icon: "▦" },
  { id: "users", label: "Users & access", icon: "♧" },
  { id: "demos", label: "Demo operations", icon: "✦" },
  { id: "operations", label: "System health", icon: "◒" },
];

const pageTitle = computed(() => {
  if (view.value === "home") return "Build your AI front desk";
  if (view.value === "privacy") return "Privacy Policy";
  if (view.value === "terms") return "Terms of Service";
  if (view.value === "admin") return "Admin control plane";
  return navItems.find((item) => item.id === view.value)?.label ?? "Overview";
});

const adminOnlyMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && !availableBusinesses.value.length));
const adminSurfaceMode = computed(() => Boolean(isSuperAdmin.value && authSnapshot.value && view.value === "admin"));
const adminSectionTitle = computed(() => adminSection.value === "organization-detail"
  ? adminOrganizationDetail.value?.organization.name ?? "Organization detail"
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
const aggregateMetrics = computed(() => activeOrganization.value?.metrics ?? { conversations: 0, leads: 0, bookings: 0 });
const businessInitial = computed(() => (businessName.value.trim().charAt(0) || "?").toUpperCase());
const conversationCount = computed(() => workspaceStats.value?.conversations ?? 0);
const inboxUnreadCount = computed(() => inboxConversations.value.reduce((total, conversation) => total + (conversation.unreadCount ?? 0), 0));
const readinessScore = computed(() => workspaceReadiness.value);
const chartMax = computed(() => Math.max(1, ...(workspaceStats.value?.trend ?? []).flatMap((point) => [point.conversations, point.leads])));
const featuredDemo = computed(() => featuredDemos.value[0] ?? null);
const trialDaysRemaining = computed(() => {
  const end = billingSnapshot.value?.billing.trialEndAt;
  if (!end || billingSnapshot.value?.billing.status !== "trial") return 0;
  return Math.max(0, Math.ceil((Date.parse(end) - Date.now()) / (24 * 60 * 60 * 1_000)));
});
const billingReadOnly = computed(() => Boolean(billingSnapshot.value && !billingSnapshot.value.billing.access.allowed && billingSnapshot.value.billing.mode !== "sandbox"));
const workspaceSelection = computed({
  get: () => showAllBusinesses.value ? "__all__" : demoSlug.value,
  set: (value: string) => {
    if (value === "__all__") {
      showAllBusinesses.value = true;
      view.value = "overview";
      return;
    }
    showAllBusinesses.value = false;
    void selectBusiness(value);
  },
});

function ownerHeaders(): Record<string, string> {
  const token = firebaseToken.value || demoAccessToken.value;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function openAuth(mode: "signin" | "signup" = "signin") {
  authMode.value = mode;
  authError.value = "";
  authPassword.value = "";
  authModalOpen.value = true;
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
  authLoading.value = true;
  authError.value = "";
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    const mode = authMode.value;
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => mode === "signup"
      ? signUpAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value)
      : signInAndBootstrap(authEmail.value, authPassword.value, demoToken, authOrganizationName.value));
    await settleAuthenticatedSession();
    authModalOpen.value = false;
    authPassword.value = "";
  } catch (error) {
    authError.value = friendlyAuthError(error, "Could not finish sign-in.");
  } finally {
    authLoading.value = false;
  }
}

async function submitGoogleAuth() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in configuration is unavailable.");
    authSnapshot.value = await bootstrapAccountWithDemoRecovery((demoToken) => signInWithGoogleAndBootstrap(demoToken, authOrganizationName.value));
    await settleAuthenticatedSession();
    authModalOpen.value = false;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    authError.value = message.includes("auth/popup-closed-by-user")
      ? "Google sign-in was cancelled. Try again or use email and password."
      : friendlyAuthError(error, "Could not finish Google sign-in.");
  } finally {
    authLoading.value = false;
  }
}

async function signOut() {
  await signOutFrontDeskWise();
  forgetDemoAccessToken();
  authSnapshot.value = null;
  firebaseToken.value = "";
  openHome();
}

async function resetPassword() {
  authError.value = "";
  try {
    await sendFrontDeskWisePasswordReset(authEmail.value);
    authError.value = "Password reset instructions sent. Check your inbox.";
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Could not send password reset instructions.";
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
  widgetDefaultMode.value = "compact";
  widgetAllowExpand.value = true;
  widgetLogoUrl.value = "";
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
  actionDraft.value = null;
  actionTriggerText.value = "";
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
  widgetColor.value = payload.agent?.widgetColor ?? "#0d6efd";
  showLeadCapture.value = payload.agent?.collectLeads ?? true;
  showBookingAction.value = payload.agent?.showBookingAction ?? true;
  widgetDefaultMode.value = payload.agent?.widgetDefaultMode ?? "compact";
  widgetAllowExpand.value = payload.agent?.widgetAllowExpand ?? true;
  widgetLogoUrl.value = payload.agent?.widgetLogoUrl ?? "";
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
    const response = await fetch(apiUrl(endpoint), { headers: publicOnly ? {} : ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}`), { headers: ownerHeaders() });
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

async function loadFeaturedDemos() {
  try {
    const response = await fetch(apiUrl("/api/v1/demo-catalog"));
    const payload = await response.json() as { demos?: FeaturedDemo[] };
    if (response.ok) featuredDemos.value = payload.demos ?? [];
  } catch {
    featuredDemos.value = [];
  }
}

async function openPublicDemo(slug = featuredDemo.value?.slug ?? demoSlug.value) {
  if (!slug) return;
  demoSlug.value = slug;
  showAllBusinesses.value = false;
  view.value = "overview";
  await loadBusinessWorkspace(slug, true);
}

async function selectBusiness(slug: string) {
  if (!slug) return;
  publicDemoMode.value = false;
  showAllBusinesses.value = false;
  demoSlug.value = slug;
  await loadBusinessWorkspace(slug);
}

async function syncAuthenticatedBusiness(snapshot: AuthSnapshot): Promise<boolean> {
  const organization = snapshot.organizations.find((item) => item.id === snapshot.activeOrganizationId) ?? snapshot.organizations[0];
  const preferred = organization?.businesses.find((business) => business.slug === demoSlug.value)
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
    adminSection.value = "overview";
    view.value = "admin";
    return;
  }
  if (isPlatformRoute()) {
    if (isSuperAdmin.value) {
      adminSection.value = "overview";
      view.value = "admin";
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
    const response = await fetch(apiUrl("/api/v1/auth/businesses"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ websiteUrl: addBusinessUrl.value.trim(), organizationId: authSnapshot.value.activeOrganizationId }),
    });
    const payload = await response.json() as { error?: string; auth?: AuthSnapshot; business?: { slug?: string } };
    if (!response.ok || !payload.auth) throw new Error(payload.error ?? "Could not add this business.");
    authSnapshot.value = payload.auth;
    addBusinessMessage.value = "Business added · crawling its knowledge now";
    addBusinessOpen.value = false;
    const createdSlug = payload.business?.slug;
    const nextBusiness = createdSlug
      ? payload.auth.organizations.flatMap((organization) => organization.businesses).find((business) => business.slug === createdSlug)
      : undefined;
    if (nextBusiness) await selectBusiness(nextBusiness.slug);
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

const landingPlans = [
  { key: "starter", name: "Starter", price: "$99", description: "A grounded AI front desk for one business.", businesses: "1 business", featured: false },
  { key: "growth", name: "Growth", price: "$199", description: "More volume, routing, and operating visibility.", businesses: "1 business", featured: false },
  { key: "multi_business", name: "Multi-Business", price: "$349", description: "One organization for up to two businesses.", businesses: "Up to 2 businesses", featured: true },
  { key: "portfolio", name: "Portfolio", price: "$499", description: "A higher-capacity operating layer for your portfolio.", businesses: "Up to 5 businesses", featured: false },
];

async function generateDemo() {
  if (!websiteUrl.value.trim()) return;
  isGenerating.value = true;
  generationError.value = "";
  try {
    const response = await fetch(apiUrl("/api/v1/demos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        websiteUrl: websiteUrl.value,
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
    demoSlug.value = payload.slug ?? demoSlug.value;
    await loadBusinessWorkspace(demoSlug.value);
    view.value = "overview";
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : "We could not create that demo yet.";
  } finally {
    isGenerating.value = false;
  }
}

async function consumeDemoLink() {
  if (typeof window === "undefined") return;
  const token = new URLSearchParams(window.location.search).get("demo");
  if (!token) return;
  try {
    const response = await fetch(apiUrl("/api/v1/demo-access/exchange"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accessToken: token }),
    });
    const payload = await response.json() as { error?: string; accessToken?: string; workspace?: WorkspacePayload };
    if (!response.ok || !payload.accessToken || !payload.workspace) throw new Error(payload.error ?? "This demo link is invalid or expired.");
    demoAccessToken.value = payload.accessToken;
    window.localStorage.setItem("frontdeskwiseDemoAccessToken", payload.accessToken);
    demoSlug.value = payload.workspace.slug ?? demoSlug.value;
    await loadBusinessWorkspace(demoSlug.value);
    view.value = "overview";
    window.history.replaceState({}, "", window.location.pathname);
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
      fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps`), { headers: ownerHeaders() }),
      fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/retrieval-diagnostics`), { headers: ownerHeaders() }),
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
    const response = await fetch(apiUrl(`/api/v1/storage/documents?${params.toString()}`), { headers: ownerHeaders() });
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
    const presignResponse = await fetch(apiUrl("/api/v1/storage/documents/presign"), {
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
    const uploadResponse = await fetch(presignPayload.upload.url, {
      method: "PUT",
      headers: presignPayload.upload.headers,
      body: file,
    });
    if (!uploadResponse.ok) throw new Error("The file could not be uploaded to secure storage.");
    const completeResponse = await fetch(apiUrl(`/api/v1/storage/documents/${presignPayload.document.id}/complete`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const completePayload = await completeResponse.json() as { error?: string; document?: OrganizationDocument };
    if (!completeResponse.ok) throw new Error(completePayload.error ?? "The upload could not be finalized.");
    documentsMessage.value = `${file.name} uploaded securely.`;
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
    const response = await fetch(apiUrl(`/api/v1/storage/documents/${documentItem.id}/download`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/storage/documents/${documentItem.id}`), { method: "DELETE", headers: ownerHeaders() });
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
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps/resolve`), {
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
}

async function loadWidgetInstall() {
  if (!firebaseToken.value || !authSnapshot.value) return;
  if (ownershipVerification.value?.status !== "verified") {
    widgetInstall.value = null;
    return;
  }
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/install`), { headers: ownerHeaders() });
  if (!response.ok) return;
  widgetInstall.value = await response.json() as WidgetInstall;
}

async function loadOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value) return;
  try {
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification/request`), {
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

async function checkOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value || !verificationToken.value.trim() || verificationLoading.value) return;
  verificationLoading.value = true;
  verificationError.value = "";
  verificationMessage.value = "";
  try {
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification/check`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads?limit=500`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/inbox${query}`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications?limit=30`), { headers: ownerHeaders() });
    const payload = await response.json() as { notifications?: StaffNotification[]; unreadCount?: number };
    if (response.ok) {
      staffNotifications.value = payload.notifications ?? [];
      notificationUnreadCount.value = payload.unreadCount ?? 0;
    }
  } catch {
    // Notification badges are best-effort and should not block the workspace.
  }
}

async function markNotificationRead(notification: StaffNotification) {
  if (notification.readAt) return;
  await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/notifications/${notification.id}/read`), { method: "POST", headers: ownerHeaders() });
  notification.readAt = new Date().toISOString();
  notificationUnreadCount.value = Math.max(0, notificationUnreadCount.value - 1);
}

async function openInboxConversation(conversation: InboxConversation) {
  try {
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversation.id}`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}${path}`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${selectedInboxConversation.value.id}/ai-assist`), { method: "POST", headers: { "content-type": "application/json", ...ownerHeaders() } });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team/invite`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/team/${member.id}`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads/${selectedLead.value.id}`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads/${selectedLead.value.id}`), { method: "DELETE", headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/sources/${source.id}/recrawl`), { method: "POST", headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/sources/${source.id}`), { method: "DELETE", headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge/reindex`), {
      method: "POST",
      headers: ownerHeaders(),
    });
    const payload = await response.json() as { status?: string; message?: string; error?: string };
    if (!response.ok) throw new Error(response.status === 503 ? "Knowledge re-indexing is not available yet." : payload.error ?? "Could not re-index knowledge.");
    embeddingMessage.value = payload.status === "queued" ? "Knowledge re-indexing started." : payload.message ?? "Knowledge is already up to date.";
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections`), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions"), { headers: ownerHeaders() });
    const payload = await response.json() as { actions?: ActionFlow[]; templates?: ActionTemplate[]; deliveries?: ActionDelivery[]; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load conversation flows.");
    actionFlows.value = payload.actions ?? [];
    actionTemplates.value = payload.templates ?? [];
    actionDeliveries.value = payload.deliveries ?? [];
    const selected = actionFlows.value.find((action) => action.id === selectedActionId.value) ?? actionFlows.value[0] ?? null;
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/action-deliveries/${delivery.id}/retry`), {
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
    const response = await fetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions"), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ templateKey: template.key }),
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not add this flow.");
    actionsMessage.value = "Flow added · review the questions before publishing";
    await loadActions();
  } catch (error) {
    actionsError.value = error instanceof Error ? error.message : "Could not add this flow.";
  } finally {
    actionsLoading.value = false;
  }
}

async function saveAction() {
  if (!actionDraft.value || actionsLoading.value) return;
  actionsLoading.value = true;
  actionsError.value = "";
  actionsMessage.value = "";
  try {
    const response = await fetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions/" + actionDraft.value.id), {
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
    const response = await fetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/actions/" + actionDraft.value.id), {
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
    const response = await fetch(apiUrl(`/api/v1/billing?organizationId=${encodeURIComponent(authSnapshot.value.activeOrganizationId ?? "")}`), { headers: ownerHeaders() });
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

async function loadAdminOrganizations() {
  if (!authSnapshot.value || adminLoading.value) return;
  adminLoading.value = true;
  try {
    const response = await fetch(apiUrl("/api/v1/admin/organizations"), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}`), { headers: ownerHeaders() });
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
      adminSection.value = "organization-detail";
      view.value = "admin";
    }
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Could not load organization detail.";
  } finally {
    adminOrganizationDetailLoading.value = false;
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
      fetch(apiUrl("/health")),
      fetch(apiUrl("/ready")),
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
    const response = await fetch(apiUrl("/api/v1/admin/users?limit=200"), { headers: ownerHeaders() });
    if (!response.ok) return;
    const payload = await response.json() as { users?: AdminUser[] };
    adminUsers.value = payload.users ?? [];
  } catch {
    adminUsers.value = [];
  }
}

function isPlatformRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname.replace(/\/+$/, "") === "/platform";
}

function legalRoute(): "privacy" | "terms" | null {
  if (typeof window === "undefined") return null;
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  return path === "/privacy" ? "privacy" : path === "/terms" ? "terms" : null;
}

function navigateToAdmin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/platform") {
    window.history.pushState({}, "", "/platform");
  }
  if (isSuperAdmin.value) {
    adminSection.value = "overview";
    view.value = "admin";
    void loadAdminOrganizations();
  }
  else openAuth("signin");
}

function handleRouteChange() {
  if (isPlatformRoute()) {
    if (isSuperAdmin.value) {
      view.value = "admin";
      void loadAdminOrganizations();
    }
    else if (authSnapshot.value) openHome();
    else openAuth("signin");
    return;
  }
  const legal = legalRoute();
  if (legal) {
    view.value = legal;
    return;
  }
  if (view.value === "privacy" || view.value === "terms") {
    view.value = authSnapshot.value ? "overview" : "home";
  }
  if (view.value === "admin") view.value = authSnapshot.value ? "overview" : "home";
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
    const response = await fetch(apiUrl("/api/v1/admin/demo-requests?limit=100"), { headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/admin/demo-requests/${item.id}/${action}`), {
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
    const response = await fetch(apiUrl("/api/v1/admin/demo-requests"), {
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
    const response = await fetch(apiUrl("/api/v1/admin/email/test"), {
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
    const response = await fetch(apiUrl(`/api/v1/admin/organizations/${organization.id}/${action}`), {
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
    const response = await fetch(apiUrl(`/api/v1/admin/organizations/${encodeURIComponent(organizationId)}/plan-override`), {
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
    const response = await fetch(apiUrl(`/api/v1/admin/businesses/${encodeURIComponent(business.id)}/verification/approve`), {
      method: "POST",
      headers: { ...ownerHeaders() },
    });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not approve business ownership.");
    adminBillingMessage.value = `${business.name} is now marked verified.`;
    adminLoading.value = false;
    await refreshAdminOrganizationDetail();
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
    const response = await fetch(apiUrl(`/api/v1/admin/users/${user.id}/status`), {
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
    const response = await fetch(apiUrl("/api/v1/billing/checkout-session"), {
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
    const response = await fetch(apiUrl("/api/v1/billing/portal-session"), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}/test`), { method: "POST", headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}/tools`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/mcp-connections/${connection.id}`), { method: "DELETE", headers: ownerHeaders() });
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}/test`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}/retry`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/integrations/${integration.id}`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/verify`), { method: "POST", headers: ownerHeaders() });
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
      const conversationResponse = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations`), {
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
    const response = await fetch(apiUrl(endpoint), {
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
    testQuestion.value = "";
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
    const response = await fetch(apiUrl("/api/v1/demo/" + demoSlug.value + "/conversations/" + conversationId.value + "/actions/" + answerAction.value.id + "/submit"), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/evaluation`), {
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
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads`), {
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

async function saveAgent() {
  if (!requireAccountForPublish()) return;
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/agent-config`), {
    method: "POST",
    headers: { "content-type": "application/json", ...ownerHeaders() },
    body: JSON.stringify({
      assistantName: assistantName.value,
      welcomeMessage: welcomeMessage.value,
      widgetColor: widgetColor.value,
      collectLeads: showLeadCapture.value,
      showBookingAction: showBookingAction.value,
      widgetDefaultMode: widgetDefaultMode.value,
      widgetAllowExpand: widgetAllowExpand.value,
      widgetLogoUrl: widgetLogoUrl.value || null,
      widgetQuickActions: widgetQuickActions.value,
      proactiveEnabled: proactiveEnabled.value,
      proactiveDelaySeconds: proactiveDelaySeconds.value,
      proactiveMessage: proactiveMessage.value,
      proactiveTriggers: proactiveTriggers.value,
      requireLeadConsent: requireLeadConsent.value,
      privacyNoticeUrl: privacyNoticeUrl.value || null,
      retentionDays: retentionDays.value,
      showAiDisclosure: showAiDisclosure.value,
    }),
  });
  savedMessage.value = response.ok ? "Saved · assistant settings updated" : "Could not save the assistant settings";
  window.setTimeout(() => (savedMessage.value = ""), 2600);
}

watch(view, (nextView) => {
  if (nextView === "inbox") { void loadInbox(); void loadNotifications(); }
  if (nextView === "team") void loadTeam();
  if (nextView === "knowledge") {
    void loadKnowledge();
    void loadDocuments();
  }
  if (nextView === "agent") void loadWidgetInstall();
  if (nextView === "leads") void loadLeads();
  if (nextView === "actions") {
    void loadActions();
    void loadIntegrations();
  }
  if (nextView === "connections") void loadMcpConnections();
  if (nextView === "billing") void loadBilling();
  if (nextView === "admin") {
    void loadAdminOrganizations();
    void loadAdminUsers();
    void loadAdminDemoRequests();
    void loadAdminHealth();
  }
});

function updateDocumentMetadata() {
  if (typeof document === "undefined") return;
  const landing = view.value === "home";
  const legal = view.value === "privacy" || view.value === "terms";
  document.title = landing ? "FrontDeskWise — AI front desk for local businesses" : `${pageTitle.value} · FrontDeskWise`;
  const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (robots) robots.content = landing || legal ? "index,follow" : "noindex,nofollow";
  const canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (canonical && typeof window !== "undefined") {
    const siteOrigin = String(import.meta.env.VITE_SITE_ORIGIN ?? window.location.origin).replace(/\/$/, "");
    canonical.href = `${siteOrigin}${legal ? `/${view.value}` : "/"}`;
  }
}

watch(view, updateDocumentMetadata);
onMounted(() => {
  const initialLegalRoute = legalRoute();
  if (initialLegalRoute) view.value = initialLegalRoute;
  updateDocumentMetadata();
  void loadFeaturedDemos();
  void consumeDemoLink();
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", handleRouteChange);
    if (!firebaseAuthConfigured()) {
      if (isPlatformRoute()) openAuth("signin");
    } else {
      stopFirebaseObserver = observeFirebaseUser((user) => {
        void restoreAuthenticatedSession(user);
      });
    }
  }
});

onBeforeUnmount(() => {
  stopFirebaseObserver?.();
  if (typeof window !== "undefined") window.removeEventListener("popstate", handleRouteChange);
});

function openHome() {
  if (typeof window !== "undefined" && window.location.pathname !== "/") window.history.pushState({}, "", "/");
  view.value = "home";
}
</script>

<template>
  <main class="app-shell">
    <section v-if="view === 'home'" class="marketing-shell">
      <header class="marketing-nav">
        <button class="brand-mark" type="button" @click="openHome">
          <img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" />
          <span>FrontDesk<span>Wise</span></span>
        </button>
        <div class="nav-actions">
            <button class="text-button" type="button" @click="scrollToPricing">Pricing</button>
            <button class="text-button" type="button" @click="openPublicDemo()">View demo dashboard</button>
          <button class="dark-button small" type="button" @click="openAuth('signin')">Sign in</button>
        </div>
      </header>

      <div class="hero-grid">
        <div class="hero-copy">
          <div class="eyebrow"><span class="pulse-dot"></span> AI front desk for local businesses</div>
          <h1>Turn your website into your best front desk.</h1>
          <p class="hero-subtitle">
            Answer questions, capture leads, and move visitors toward booking — in minutes, using the information your business already has.
          </p>
          <div class="url-form">
            <input v-model="websiteUrl" type="url" placeholder="https://yourbusiness.com" aria-label="Business website URL" @keyup.enter="generateDemo" />
            <button class="primary-button" type="button" :disabled="isGenerating" @click="generateDemo">
              {{ isGenerating ? "Building demo…" : "Generate my AI front desk" }}
              <span aria-hidden="true">→</span>
            </button>
          </div>
          <div class="demo-requester-fields">
            <input v-model="demoRequesterName" type="text" placeholder="Your name (optional)" aria-label="Your name" />
            <input v-model="demoRequesterEmail" type="email" placeholder="Work email (optional)" aria-label="Work email" />
            <span>We’ll log the request and can send a fresh demo link later.</span>
          </div>
          <p v-if="generationError" class="form-error">{{ generationError }}</p>
          <div class="trust-row"><span>✓ No credit card</span><span>✓ Demo in under 5 minutes</span><span>✓ Built from your website</span></div>
        </div>

        <div class="hero-visual">
          <div class="floating-label label-one">{{ featuredDemo ? `${featuredDemo.stats.leads} leads in demo` : 'Live demo workspace' }}</div>
          <div class="floating-label label-two">{{ featuredDemo ? `${featuredDemo.knowledge.openGaps} open knowledge gaps` : 'Grounded knowledge' }}</div>
          <div class="demo-card">
            <div class="demo-card-top"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span class="demo-url">{{ featuredDemo?.business.websiteUrl || 'yourbusiness.com' }}</span></div>
            <div class="demo-site-hero"><span class="demo-badge">AI FRONT DESK · ONLINE</span><h3>More answers.<br />More bookings.</h3><div class="fake-cta">Get started <span>→</span></div></div>
            <div class="chat-preview">
              <div class="chat-header"><span class="mini-orb">✦</span><span>{{ assistantName }}</span><span class="online-dot"></span></div>
              <div class="chat-bubble">Hi! I can answer questions, recommend the right service, and help you book.</div>
              <div class="suggested-question">What should I book for my child? <span>›</span></div>
              <div class="suggested-question">Do you have weekend availability? <span>›</span></div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="featuredDemos.length" class="featured-demo-links"><span>Preview a sample workspace:</span><button v-for="demo in featuredDemos" :key="demo.slug" type="button" @click="openPublicDemo(demo.slug)">{{ demo.business.name }}</button></div>

      <section class="proof-strip">
        <span>One simple loop:</span><strong>Question</strong><i>→</i><strong>Qualification</strong><i>→</i><strong>Action</strong><i>→</i><strong>Lead</strong><i>→</i><strong>Booking</strong>
      </section>
      <section class="benefit-grid">
        <article><span class="benefit-icon blue">◎</span><h3>Grounded answers</h3><p>It answers from approved business information and knows when to say, “I’m not sure.”</p></article>
        <article><span class="benefit-icon orange">↗</span><h3>Revenue outcomes</h3><p>Every conversation can become a lead, registration, appointment, or human handoff.</p></article>
        <article><span class="benefit-icon green">✦</span><h3>Ready in minutes</h3><p>Paste a URL, review the generated agent, and share a personalized demo before you buy.</p></article>
      </section>
      <section id="pricing" class="marketing-pricing">
        <div class="pricing-heading"><div><p class="eyebrow">Simple organization pricing</p><h2>Start with one business. Grow without another login.</h2></div><p>Every plan includes grounded answers, lead capture, and a shared path to booking. Start with a trial—no card required.</p></div>
        <div class="pricing-grid">
          <article v-for="plan in landingPlans" :key="plan.key" :class="['pricing-card', { featured: plan.featured }]">
            <span v-if="plan.featured" class="pricing-badge">Most flexible</span>
            <h3>{{ plan.name }}</h3><p>{{ plan.description }}</p><strong class="pricing-price">{{ plan.price }}<small>/month</small></strong><span class="pricing-businesses">{{ plan.businesses }}</span>
            <button class="primary-button small" type="button" @click="openAuth('signup')">Start free trial →</button>
          </article>
        </div>
      </section>

      <footer class="marketing-footer">
        <div><strong>FrontDeskWise</strong><span>FrontDeskWise is a product of Sudo Programmer, Inc.</span></div>
        <nav aria-label="Footer navigation"><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:hello@frontdeskwise.com">Contact</a></nav>
        <small>© 2026 Sudo Programmer, Inc. · FrontDeskWise. Built for clearer customer conversations.</small>
      </footer>
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
          <button v-for="item in navItems" :key="item.id" type="button" :disabled="publicDemoMode && item.id !== 'overview'" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><b v-if="item.id === 'inbox' && inboxUnreadCount">{{ inboxUnreadCount }}</b><b v-else-if="item.id === 'conversations' && conversationCount">{{ conversationCount }}</b></button>
          <button v-if="isSuperAdmin" type="button" :class="['nav-item', { active: view === 'admin' }]" @click="navigateToAdmin"><span class="nav-icon">⚙</span><span>Admin control plane</span></button>
        </nav>
        <div v-if="adminSurfaceMode" class="sidebar-bottom"><div class="admin-sidebar-note"><strong>Operations access</strong><small>Manage platform health, organizations, users, and demos from one place.</small></div><button v-if="!adminOnlyMode" class="sidebar-link" type="button" @click="view = 'overview'">← Back to workspace</button><button class="sidebar-link" type="button" @click="signOut">Sign out</button></div>
        <div v-else class="sidebar-bottom"><div class="setup-card"><div class="setup-row"><span>Setup progress</span><strong>{{ workspaceStats?.setup.percent ?? 0 }}%</strong></div><div class="progress-bar"><span :style="{ width: `${workspaceStats?.setup.percent ?? 0}%` }"></span></div><small>{{ workspaceStats?.setup.completed ?? 0 }} of {{ workspaceStats?.setup.total ?? 4 }} steps complete</small></div><button class="sidebar-link" type="button" @click="openHome">← Back to landing page</button></div>
      </aside>

      <section class="content-area">
        <header class="content-header"><div><p class="breadcrumb">{{ view === 'admin' ? 'Operations / FrontDeskWise' : `${showAllBusinesses ? 'All businesses' : (businessName || 'Workspace')} / FrontDeskWise` }}</p><h1>{{ view === 'admin' ? adminSectionTitle : pageTitle }}</h1></div><div class="header-actions"><button v-if="authSnapshot && !adminSurfaceMode" class="notification-button" type="button" aria-label="Notifications" @click="notificationMenuOpen = !notificationMenuOpen">♧<b v-if="notificationUnreadCount">{{ notificationUnreadCount }}</b></button><button v-if="!adminSurfaceMode" class="outline-button" type="button" @click="publicDemoMode ? openAuth('signup') : view = 'agent'">Preview on website ↗</button><button v-if="!adminSurfaceMode" class="primary-button small" type="button" @click="publicDemoMode ? openAuth('signup') : view = 'agent'">Edit agent</button><button v-if="authSnapshot" class="text-button" type="button" @click="signOut">Sign out</button><span class="profile-avatar">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : 'SP' }}</span></div><div v-if="notificationMenuOpen && authSnapshot" class="notification-menu"><div class="panel-heading"><strong>Notifications</strong><button class="text-button" type="button" @click="loadNotifications">Refresh</button></div><div v-if="!staffNotifications.length" class="diagnostics-empty">No new team notifications.</div><button v-for="notification in staffNotifications" :key="notification.id" class="notification-row" type="button" @click="markNotificationRead(notification); view = 'inbox'; notificationMenuOpen = false"><strong>{{ notification.title }}</strong><small>{{ notification.body }}</small><em>{{ new Date(notification.createdAt).toLocaleString() }}</em></button></div></header>
        <div v-if="!adminSurfaceMode && publicDemoMode" class="trial-banner info"><span><strong>Public sample workspace</strong><small>This view is live demo data in read-only mode. Generate your own demo or create an account to customize, install, and capture leads.</small></span><button class="primary-button small" type="button" @click="openAuth('signup')">Create your workspace →</button></div>
        <div v-else-if="!adminSurfaceMode && billingSnapshot?.billing.status === 'trial' && billingSnapshot.billing.mode !== 'sandbox'" class="trial-banner"><span><strong>{{ trialDaysRemaining }} {{ trialDaysRemaining === 1 ? 'day' : 'days' }} left in your trial</strong><small>Keep your workspace, knowledge, and leads active by choosing a plan.</small></span><button class="primary-button small" type="button" @click="view = 'billing'">Upgrade →</button></div>
        <div v-else-if="!adminSurfaceMode && billingReadOnly" class="trial-banner danger"><span><strong>Your workspace is read-only</strong><small>Existing data is preserved. Restore billing to resume publishing and production lead capture.</small></span><button class="primary-button small" type="button" @click="view = 'billing'">Restore billing →</button></div>

        <div v-if="view === 'overview' && showAllBusinesses" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Organization overview</p><h2>All businesses</h2><p>One account, one subscription, and a clear view across every business you manage.</p></div><button class="primary-button small" type="button" @click="openAddBusiness">+ Add business</button></div>
          <div class="metric-grid aggregate-metric-grid"><article class="metric-card blue-tint"><span class="metric-icon blue">♧</span><strong>{{ aggregateMetrics.leads }}</strong><span>Total leads</span><em>Across all businesses</em></article><article class="metric-card green-tint"><span class="metric-icon green">▣</span><strong>{{ aggregateMetrics.bookings }}</strong><span>Booking actions</span><em>Across all businesses</em></article><article class="metric-card orange-tint"><span class="metric-icon orange">◌</span><strong>{{ aggregateMetrics.conversations }}</strong><span>Conversations</span><em>Last recorded totals</em></article><article class="metric-card purple-tint"><span class="metric-icon purple">▱</span><strong>{{ activeOrganization?.businesses.length ?? 0 }}</strong><span>Businesses</span><em>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }} plan</em></article></div>
          <article class="panel aggregate-business-panel"><div class="panel-heading"><div><h2>Businesses in {{ activeOrganization?.name ?? 'your organization' }}</h2><p>Switch context without creating another account.</p></div><span class="conversation-status">{{ formatLabel(activeOrganization?.billing.status ?? 'trial') }}</span></div><div class="aggregate-business-list"><div v-for="business in availableBusinesses" :key="business.id" class="aggregate-business-row"><div><strong>{{ business.name }}</strong><small>{{ business.websiteUrl ?? 'Website pending' }}</small></div><span>{{ formatLabel(business.role) }}</span><span class="status-pill qualified">{{ formatPlanLabel(business.planKey) }}</span><button class="outline-button small" type="button" @click="workspaceSelection = business.slug">Open →</button></div></div></article>
          <article class="panel aggregate-billing-note"><p class="eyebrow">Shared billing</p><h2>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }} · {{ activeOrganization?.billing.access.allowed ? 'Access enabled' : 'Read-only access' }}</h2><p>{{ activeOrganization?.billing.access.allowed ? 'All businesses share this organization subscription and its capacity.' : 'Billing needs attention before new businesses or write actions can be added.' }}</p><button class="text-button" type="button" @click="view = 'billing'">View billing →</button></article>
        </div>

        <div v-else-if="view === 'overview'" class="view-content">
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
          <div class="section-toolbar"><div><p class="eyebrow">Team support</p><h2>Team inbox</h2><p>See conversations that need people, take over safely, and keep the AI in the loop.</p></div><div class="toolbar-actions"><span v-if="inboxMessage" class="saved-message">✓ {{ inboxMessage }}</span><button class="outline-button small" type="button" :disabled="inboxLoading" @click="loadInbox">{{ inboxLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
          <p v-if="inboxError" class="form-error">{{ inboxError }}</p>
          <div class="panel lead-filters"><label>Status<select v-model="inboxStatusFilter" @change="loadInbox"><option value="all">All conversations</option><option value="WAITING_FOR_STAFF">Waiting for staff</option><option value="HUMAN_ACTIVE">Human active</option><option value="AI_ASSISTED">AI assisted</option><option value="AI_ACTIVE">AI active</option><option value="RESOLVED">Resolved</option></select></label><label>Assignment<select v-model="inboxAssignmentFilter" @change="loadInbox"><option value="all">All assignments</option><option value="mine">Assigned to me</option></select></label><span>{{ inboxConversations.length }} conversation{{ inboxConversations.length === 1 ? '' : 's' }} · {{ inboxUnreadCount }} unread visitor message{{ inboxUnreadCount === 1 ? '' : 's' }}</span></div>
          <div class="dashboard-grid conversation-inbox-grid"><article class="panel table-panel"><div class="table-heading"><span>Conversation</span><span>Status</span><span>Activity</span></div><div v-if="!inboxConversations.length" class="diagnostics-empty">No conversations match this view.</div><button v-for="conversation in inboxConversations" :key="conversation.id" :class="['table-row', 'table-row-button', { selected: selectedInboxConversation?.id === conversation.id }]" type="button" @click="openInboxConversation(conversation)"><div class="lead-name"><span class="lead-avatar">{{ (conversation.lead?.name || 'V').charAt(0).toUpperCase() }}</span><span><strong>{{ conversation.lead?.name || 'Visitor conversation' }}</strong><small>{{ conversation.lastMessage?.content || 'No messages yet' }}</small></span></div><span :class="['status-pill', conversation.status === 'RESOLVED' ? 'booked' : conversation.status === 'AI_ACTIVE' ? 'new' : 'qualified']">{{ formatLabel(conversation.status) }}<b v-if="conversation.unreadCount"> · {{ conversation.unreadCount }}</b></span><small>{{ new Date(conversation.lastActivityAt).toLocaleString() }}</small></button></article><article v-if="selectedInboxConversation" class="panel inbox-detail-panel"><div class="panel-heading"><div><p class="eyebrow">Conversation detail</p><h2>{{ selectedInboxConversation.lead?.name || 'Visitor' }}</h2><p>{{ selectedInboxConversation.lead?.intent || 'General inquiry' }} · {{ formatLabel(selectedInboxConversation.status) }}</p></div><div class="toolbar-actions"><button v-if="selectedInboxConversation.status !== 'HUMAN_ACTIVE' && selectedInboxConversation.status !== 'RESOLVED'" class="primary-button small" type="button" :disabled="inboxActionLoading" @click="takeOverConversation">Take over</button><button v-if="selectedInboxConversation.status === 'HUMAN_ACTIVE'" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="returnConversationToAi">Return to AI</button><button v-if="selectedInboxConversation.status !== 'RESOLVED'" class="outline-button small" type="button" :disabled="inboxActionLoading" @click="resolveConversation">Resolve</button></div></div><div class="inbox-message-thread"><div v-for="(message, index) in selectedInboxConversation.messages ?? []" :key="`${message.createdAt}-${index}`" :class="['message-thread-item', message.role]"><small>{{ message.authorName || formatLabel(message.role) }} · {{ new Date(message.createdAt).toLocaleString() }}</small><p>{{ message.content }}</p></div><div v-if="!(selectedInboxConversation.messages?.length)" class="diagnostics-empty">No messages to display.</div></div><form class="question-form" @submit.prevent="sendInboxReply"><input v-model="inboxReply" type="text" placeholder="Reply as your team…" :disabled="selectedInboxConversation.status !== 'HUMAN_ACTIVE'" /><button class="primary-button small" type="submit" :disabled="!inboxReply.trim() || inboxActionLoading">Send</button></form><form class="question-form" @submit.prevent="addInboxNote"><input v-model="inboxNote" type="text" placeholder="Add a private internal note…" /><button class="outline-button small" type="submit" :disabled="!inboxNote.trim() || inboxActionLoading">Add note</button></form></article><article v-else class="panel workspace-message"><strong>Select a conversation</strong><p>Choose a visitor conversation to review the thread, take over, or return it to AI.</p></article></div>
        </div>

        <div v-else-if="view === 'team'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">People and permissions</p><h2>Team access</h2><p>Invite staff, keep access business-scoped, and see who is active in the inbox.</p></div><span v-if="teamMessage" class="saved-message">✓ {{ teamMessage }}</span></div>
          <p v-if="teamError" class="form-error">{{ teamError }}</p>
          <article class="panel form-panel"><div class="panel-heading"><div><h2>Invite a team member</h2><p>They can sign in with this email to accept access.</p></div></div><div class="flow-field-grid"><label>Name <span class="optional">optional</span><input v-model="teamInviteName" type="text" placeholder="Alex Morgan" /></label><label>Email<input v-model="teamInviteEmail" type="email" placeholder="alex@business.com" /></label><label>Role<select v-model="teamInviteRole"><option value="staff">Staff</option><option value="viewer">Viewer</option><option value="admin">Admin</option></select></label><div class="toolbar-actions"><button class="primary-button small" type="button" :disabled="teamLoading || !teamInviteEmail.trim()" @click="inviteTeamMember">{{ teamLoading ? 'Inviting…' : 'Send invitation' }}</button><button class="outline-button small" type="button" :disabled="teamLoading" @click="loadTeam">Refresh</button></div></div></article>
          <article class="panel table-panel"><div class="table-heading"><span>Team member</span><span>Role</span><span>Status</span><span>Last active</span></div><div v-if="!teamMembers.length" class="diagnostics-empty">No team members found.</div><div v-for="member in teamMembers" :key="member.id" class="table-row"><div class="lead-name"><span class="lead-avatar">{{ member.name.charAt(0).toUpperCase() }}</span><span><strong>{{ member.name }}</strong><small>{{ member.email }}</small></span></div><select v-if="member.role !== 'owner'" :value="member.role" :disabled="teamLoading" @change="updateTeamMember(member, String(($event.target as HTMLSelectElement).value) as TeamMember['role'])"><option value="admin">Admin</option><option value="staff">Staff</option><option value="viewer">Viewer</option></select><span v-else class="status-pill booked">Owner</span><span :class="['status-pill', member.status === 'active' ? 'booked' : 'qualified']">{{ member.status }}</span><small>{{ member.lastActiveAt ? new Date(member.lastActiveAt).toLocaleString() : 'Not active yet' }}</small></div></article>
        </div>

        <div v-else-if="view === 'conversations'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Grounded answers</p><h2>Test a conversation</h2><p>Ask a real customer question and check the answer before publishing.</p></div><span v-if="conversationId" class="conversation-status">Conversation active</span></div><div class="conversation-layout"><article class="panel conversation-panel"><div class="conversation-intro"><span class="mini-orb">✦</span><div><strong>{{ assistantName }}</strong><small>Answers from {{ businessName }} knowledge</small></div></div><div v-if="suggestedQuestions.length" class="suggested-question-list"><span>Try a common question</span><button v-for="suggestion in suggestedQuestions" :key="suggestion" type="button" @click="testQuestion = suggestion; void askQuestion()">{{ suggestion }} <b>›</b></button></div><div v-if="testAnswer" class="answer-card"><div class="answer-meta"><span v-if="answerAction" class="answer-badge grounded">✓ {{ answerAction.status === 'completed' ? 'Flow completed' : 'Conversation flow' }}</span><span v-else :class="['answer-badge', answerGrounded ? 'grounded' : 'fallback']">{{ answerGrounded ? '✓ Grounded in your business knowledge' : '! Not found in business knowledge' }}</span></div><p>{{ testAnswer }}</p><form v-if="answerAction?.form" class="action-inline-form" @submit.prevent="submitActionForm"><label v-for="field in answerAction.form.fields" :key="field.id">{{ field.label }} <span v-if="!field.required" class="optional">optional</span><select v-if="field.type === 'select'" v-model="answerFormValues[field.key]" :required="field.required"><option value="">Select…</option><option v-for="option in field.options ?? []" :key="option" :value="option">{{ option }}</option></select><input v-else v-model="answerFormValues[field.key]" :type="field.type === 'phone' ? 'tel' : field.type" :required="field.required" /></label><button class="primary-button small" type="submit" :disabled="isAsking">{{ isAsking ? 'Submitting…' : answerAction.form.submitLabel }}</button></form><div v-if="answerCitations.length" class="answer-citations"><span>Sources ({{ answerCitations.length }})</span><a v-for="citation in answerCitations" :key="citation.url" :href="citation.url" target="_blank" rel="noreferrer">{{ citation.title || citation.url }} ↗</a></div></div><div v-else class="conversation-empty">Ask a question to see the answer and its sources.</div><form class="question-form" @submit.prevent="askQuestion"><input v-model="testQuestion" type="text" placeholder="e.g. What services do you offer?" aria-label="Test question" /><button class="primary-button small" type="submit" :disabled="isAsking">{{ isAsking ? 'Checking…' : 'Ask assistant' }}</button></form></article><article class="panel lead-capture-panel"><div class="panel-heading"><div><h2>Capture a lead</h2><p>Submit a contact to verify lead capture.</p></div></div><label>Name<input v-model="leadName" type="text" placeholder="Jamie Rodriguez" /></label><label>Email<input v-model="leadEmail" type="email" placeholder="jamie@company.com" /></label><label>Phone <span class="optional">optional</span><input v-model="leadPhone" type="tel" placeholder="(555) 010-2026" /></label><label>Intent <span class="optional">optional</span><input v-model="leadIntent" type="text" placeholder="Service inquiry" /></label><button class="primary-button" type="button" :disabled="!leadEmail && !leadPhone" @click="captureLead">Save lead →</button><span v-if="leadSavedMessage" class="saved-message">✓ {{ leadSavedMessage }}</span></article></div></div>

        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>Review, qualify, and export the contacts FrontDeskWise captured.</p></div><div class="toolbar-actions"><span v-if="leadExportMessage" class="saved-message">✓ {{ leadExportMessage }}</span><button class="outline-button small" type="button" :disabled="leadsLoading" @click="loadLeads">{{ leadsLoading ? 'Refreshing…' : 'Refresh' }}</button><button class="outline-button small" type="button" :disabled="!visibleLeads.length" @click="exportLeadsCsv">Export CSV</button><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div></div><p v-if="leadsError" class="form-error">{{ leadsError }}</p><div class="panel lead-filters"><label>Search<input v-model="leadSearch" type="search" placeholder="Name, email, intent…" /></label><label>Status<select v-model="leadStatusFilter"><option value="all">All statuses</option><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label><span>{{ visibleLeads.length }} of {{ leads.length }} lead{{ leads.length === 1 ? '' : 's' }}</span></div><div class="panel table-panel"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-if="!visibleLeads.length && !leadsError" class="diagnostics-empty">{{ leads.length ? 'No leads match these filters.' : 'No leads captured yet.' }}</div><button v-for="lead in visibleLeads" :key="lead.id" class="table-row table-row-button" type="button" @click="openLeadDetail(lead)"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0).toUpperCase() }}</span><span><strong>{{ lead.name }}</strong><small>{{ lead.email || lead.phone || 'Contact details not provided' }}</small></span></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></button></div></div>

        <div v-else-if="view === 'agent'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Make it yours</p><h2>Agent & widget</h2><p>Configure your assistant, then publish it to your website.</p></div><div class="toolbar-actions"><span v-if="savedMessage" class="saved-message">✓ {{ savedMessage }}</span><button class="outline-button" type="button" @click="view = 'overview'">Test conversation</button><button class="primary-button small" type="button" @click="saveAgent">{{ authSnapshot ? 'Save & publish' : 'Create account to publish' }}</button></div></div><div class="agent-layout"><article class="panel form-panel"><div class="form-section"><h3>Assistant identity</h3><label>Assistant name<input v-model="assistantName" type="text" /></label><label>Welcome message<textarea v-model="welcomeMessage" rows="5"></textarea></label><label>Widget color<div class="color-row"><button v-for="color in ['#0d6efd','#18a999','#7447d9','#f27b35','#112c64']" :key="color" type="button" :class="['color-swatch', { selected: widgetColor === color }]" :style="{ background: color }" @click="widgetColor = color"></button></div></label></div><div class="form-section"><h3>Widget behavior</h3><label>Opening size<select v-model="widgetDefaultMode"><option value="compact">Compact</option><option value="expanded">Expanded</option><option value="fullscreen">Full screen</option></select></label><label>Logo URL <span class="optional">optional · HTTPS only</span><input v-model="widgetLogoUrl" type="url" placeholder="https://example.com/logo.png" /></label><label class="toggle-row"><span>Allow visitors to expand the assistant</span><input v-model="widgetAllowExpand" type="checkbox" /></label><p class="form-help">Compact keeps the assistant beside the page. Expanded gives visitors more room for services, forms, and booking flows. On mobile it opens full screen automatically.</p></div><div class="form-section"><h3>Quick actions</h3><p class="form-help">Give visitors useful starting points before they type. Keep the labels short and the questions specific.</p><div class="quick-action-editor"><div v-for="(action, index) in widgetQuickActions" :key="index" class="quick-action-row"><label>Button {{ index + 1 }}<input v-model="action.label" type="text" maxlength="48" placeholder="Pricing" /></label><label>Question <input v-model="action.question" type="text" maxlength="300" placeholder="What does pricing look like?" /></label></div></div></div><div class="form-section"><h3>Proactive engagement</h3><label class="toggle-row"><span>Invite visitors before they click</span><input v-model="proactiveEnabled" type="checkbox" /></label><label>Proactive message<input v-model="proactiveMessage" type="text" maxlength="240" placeholder="Looking for the right service? I can help." /></label><label>Delay<select v-model.number="proactiveDelaySeconds"><option :value="10">10 seconds</option><option :value="20">20 seconds</option><option :value="30">30 seconds</option><option :value="60">60 seconds</option></select></label><div class="trigger-options"><span>Triggers</span><label><input v-model="proactiveTriggers" type="checkbox" value="delay" /> Time on page</label><label><input v-model="proactiveTriggers" type="checkbox" value="scroll" /> 70% scroll</label><label><input v-model="proactiveTriggers" type="checkbox" value="exit" /> Exit intent</label><label><input v-model="proactiveTriggers" type="checkbox" value="returning" /> Returning visitor</label></div><p class="form-help">The prompt appears once per page and respects the visitor’s close action.</p></div><div class="form-section"><h3>Lead capture</h3><label class="toggle-row"><span>Collect lead information</span><input v-model="showLeadCapture" type="checkbox" /></label><label class="toggle-row"><span>Show booking action button</span><input v-model="showBookingAction" type="checkbox" /></label><div class="form-section"><h3>Privacy & trust</h3><label class="toggle-row"><span>Show AI assistant disclosure</span><input v-model="showAiDisclosure" type="checkbox" /></label><label class="toggle-row"><span>Require consent before lead capture</span><input v-model="requireLeadConsent" type="checkbox" /></label><label>Privacy notice URL <span class="optional">optional · HTTPS only</span><input v-model="privacyNoticeUrl" type="url" placeholder="https://yourbusiness.com/privacy" /></label><label>Conversation retention<select v-model.number="retentionDays"><option :value="30">30 days</option><option :value="60">60 days</option><option :value="90">90 days</option><option :value="365">1 year</option></select></label><p class="form-help">Consent is shown in the widget before details are sent. Retention controls are stored with this business and prepare the workspace for automated cleanup.</p></div></div></article><article :class="['panel', 'live-preview', { 'mobile-preview': widgetPreviewMode === 'mobile' }]" aria-label="Widget preview"><div class="preview-toolbar"><strong>Preview</strong><div class="preview-mode-toggle"><button type="button" :class="{ active: widgetPreviewMode === 'desktop' }" @click="widgetPreviewMode = 'desktop'">Desktop</button><button type="button" :class="{ active: widgetPreviewMode === 'mobile' }" @click="widgetPreviewMode = 'mobile'">Mobile</button></div></div><div class="preview-browser"><div class="preview-browser-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ websiteUrl || 'Your website' }}</span></div><div class="preview-site"><div class="preview-site-nav"><strong>{{ businessName || 'Your business' }}</strong><span>Services　About　FAQs　Contact</span><button>Get started</button></div><div class="preview-site-hero"><div><h2>Help visitors<br />take the next step</h2><p>Grounded answers from {{ businessName || 'your website' }}.</p><button>Explore services →</button></div><div class="fake-swimmer">✦</div></div><div class="preview-chat" :style="{ '--accent': widgetColor }"><div class="chat-header"><span class="mini-orb">✦</span><span>{{ assistantName }}</span><span class="online-dot"></span></div><div class="chat-bubble">{{ welcomeMessage }}</div><template v-if="widgetQuickActions.length"><div v-for="action in widgetQuickActions.slice(0, 2)" :key="action.label" class="suggested-question">{{ action.label }} <span>›</span></div></template><div v-else class="preview-empty-question">Add quick actions to guide visitors.</div><button v-if="showLeadCapture" class="chat-cta" type="button">Request information</button><div class="chat-input">Ask a question… <span>➤</span></div></div></div></div></article></div><article class="panel install-panel"><div class="panel-heading"><div><p class="eyebrow">Publish anywhere</p><h2>Install your front desk</h2><p>Copy one snippet and paste it before <code>&lt;/body&gt;</code> on the business website.</p></div><span v-if="widgetInstallMessage" class="saved-message">✓ {{ widgetInstallMessage }}</span></div><template v-if="authSnapshot && widgetInstall"><div class="install-snippet"><code>{{ widgetInstall.snippet }}</code><button class="primary-button small" type="button" @click="copyWidgetSnippet">Copy snippet</button></div><div class="install-verification"><small class="install-note">Site key: {{ widgetInstall.siteKey }} · {{ widgetInstall.verification.loadCount }} detected load{{ widgetInstall.verification.loadCount === 1 ? '' : 's' }}</small><button class="outline-button small" type="button" :disabled="widgetVerificationLoading" @click="verifyWidgetInstall">{{ widgetVerificationLoading ? 'Checking…' : 'Verify installation' }}</button></div><p v-if="widgetVerificationMessage" class="conversation-status">{{ widgetVerificationMessage }}</p></template><div v-else-if="!authSnapshot" class="install-gate"><p>Sign in to generate a private install snippet for this business. The preview remains available without an account.</p><button class="outline-button small" type="button" @click="openAuth('signup')">Create account to install →</button></div><div v-else-if="ownershipVerification && ownershipVerification.status !== 'verified'" class="install-gate"><p>Verify website ownership before installing the live widget. This protects the business from unauthorized publishing.</p><button class="outline-button small" type="button" @click="view = 'settings'">Verify ownership →</button></div><div v-else-if="billingReadOnly" class="install-gate"><p>Your workspace is read-only until billing is restored. Existing preview data is safe, but live publishing is paused.</p><button class="outline-button small" type="button" @click="view = 'billing'">Review billing →</button></div><div v-else class="install-gate"><p>Your private install snippet is still loading. Refresh the page if it does not appear shortly.</p><button class="outline-button small" type="button" @click="void loadWidgetInstall()">Refresh install details</button></div></article></div>

        <div v-else-if="view === 'knowledge'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Knowledge review</p><h2>Close the answer gaps</h2><p>Approve safe answers for questions the front desk could not ground confidently.</p></div><div class="toolbar-actions"><span v-if="embeddingMessage" class="saved-message">✓ {{ embeddingMessage }}</span><button v-if="authSnapshot && availableBusinesses.length" class="outline-button small" type="button" :disabled="embeddingLoading" @click="reindexKnowledge">{{ embeddingLoading ? 'Re-indexing…' : 'Re-index knowledge' }}</button><button class="outline-button small" type="button" @click="loadKnowledge">{{ knowledgeLoading ? 'Refreshing…' : 'Refresh' }}</button></div></div>
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
          <article v-if="!knowledgeGaps.length && !knowledgeError" class="panel empty-knowledge"><div class="empty-icon">✓</div><h2>No open knowledge gaps</h2><p>New low-confidence questions will appear here for review.</p></article>
          <div v-else class="knowledge-review-grid"><article v-for="gap in knowledgeGaps" :key="gap.question" class="panel gap-card"><div class="gap-card-heading"><div><span :class="['answer-badge', gap.status === 'resolved' ? 'grounded' : 'fallback']">{{ gap.status === 'resolved' ? '✓ Approved' : '! Open gap' }}</span><h3>{{ gap.question }}</h3></div><strong>{{ gap.occurrenceCount }}×</strong></div><textarea v-model="answerDrafts[gap.question]" rows="4" placeholder="Write the answer the assistant may use…"></textarea><div class="gap-card-actions"><small>Last seen {{ new Date(gap.lastSeenAt).toLocaleString() }}</small><button class="primary-button small" type="button" :disabled="!answerDrafts[gap.question]?.trim() || gap.status === 'resolved'" @click="resolveKnowledgeGap(gap)">{{ gap.status === 'resolved' ? 'Approved' : 'Approve answer' }}</button></div></article></div>
          <div class="section-toolbar diagnostics-heading"><div><p class="eyebrow">Answer quality</p><h2>Recent answer checks</h2><p>Review confidence and whether each answer was grounded in your knowledge.</p></div></div>
          <article class="panel table-panel diagnostics-panel"><div class="table-heading diagnostics-row"><span>Question</span><span>Confidence</span><span>Outcome</span></div><div v-for="diagnostic in retrievalDiagnostics" :key="`${diagnostic.conversationId}-${diagnostic.createdAt}`" class="table-row diagnostics-row"><div><strong>{{ diagnostic.question }}</strong><small>{{ diagnostic.answer }}</small></div><span :class="['status-pill', diagnostic.confidenceBand === 'high' ? 'booked' : diagnostic.confidenceBand === 'medium' ? 'qualified' : 'new']">{{ Math.round(diagnostic.confidenceScore * 100) }}% · {{ diagnostic.confidenceBand }}</span><span :class="['status-pill', diagnostic.grounded ? 'booked' : 'new']">{{ diagnostic.grounded ? 'Grounded' : 'Needs review' }}<small>{{ diagnostic.retrieval?.candidateCount ?? 0 }} knowledge matches</small></span></div><div v-if="!retrievalDiagnostics.length" class="diagnostics-empty">No answer checks yet.</div></article>
        </div>

        <div v-else-if="view === 'actions'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Reliable handoff</p><h2>Actions & conversation flows</h2><p>Configure the next-best question for each customer action, then deliver completed leads to the systems your team already uses.</p></div><span v-if="integrationLoading" class="conversation-status">Working…</span></div>
          <p v-if="integrationError" class="form-error">{{ integrationError }}</p>
          <p v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</p>
          <p v-if="actionsError" class="form-error">{{ actionsError }}</p>
          <p v-if="actionsMessage" class="saved-message">✓ {{ actionsMessage }}</p>
          <section class="flow-builder-grid">
            <article class="panel flow-library">
              <div class="panel-heading"><div><p class="eyebrow">Owner-controlled automation</p><h2>Conversation flows</h2><p>Define the business rules once. The AI asks each next question naturally.</p></div><span v-if="actionsLoading" class="conversation-status">Working…</span></div>
              <div class="flow-template-list"><p class="flow-subheading">Quick setup</p><button v-for="template in actionTemplates" :key="template.key" class="flow-template-button" type="button" :disabled="actionsLoading || actionFlows.some((action) => action.key === template.key)" @click="addActionTemplate(template)"><span>＋</span><span><strong>{{ template.name }}</strong><small>{{ actionFlows.some((action) => action.key === template.key) ? 'Already added' : template.description }}</small></span></button></div>
              <div class="flow-list"><p class="flow-subheading">Your flows</p><button v-for="action in actionFlows" :key="action.id" :class="['flow-card', { selected: selectedActionId === action.id }]" type="button" @click="selectAction(action)"><span class="flow-card-icon">ϟ</span><span><strong>{{ action.name }}</strong><small>{{ action.fields.length }} questions · {{ action.enabled ? 'Enabled' : 'Paused' }}</small></span><span class="flow-card-arrow">›</span></button><div v-if="!actionFlows.length" class="diagnostics-empty">Add a template to create your first action.</div></div>
            </article>
            <article v-if="actionDraft" class="panel flow-editor">
              <div class="panel-heading"><div><p class="eyebrow">Customize</p><h2>{{ actionDraft.name }}</h2><p>Owner defines the rules; AI chooses the conversational wording.</p></div><label class="toggle-row flow-enabled-toggle"><span>Enabled</span><input v-model="actionDraft.enabled" type="checkbox" /></label></div>
              <div class="flow-steps"><span>Trigger</span><b>→</b><span v-for="field in actionDraft.fields.slice(0, 4)" :key="field.id">{{ field.label }}</span><b v-if="actionDraft.fields.length > 4">→</b><span v-if="actionDraft.fields.length > 4">More fields</span><b>→</b><span>Complete</span></div>
              <div class="form-section"><label>Flow name<input v-model="actionDraft.name" type="text" /></label><label>Description<textarea v-model="actionDraft.description" rows="2"></textarea></label><label>Lead capture style<select v-model="actionDraft.captureMode"><option value="auto">Auto — Recommended</option><option value="conversational">Conversational</option><option value="form">Inline form</option><option value="hybrid">Hybrid</option></select></label><label>Trigger phrases <span class="optional">one per line</span><textarea v-model="actionTriggerText" rows="3" placeholder="Book an appointment&#10;Schedule a visit"></textarea></label></div>
              <div class="form-section"><div class="panel-heading compact-heading"><div><h3>Questions and fields</h3><p>Ask only what is still missing. Reorder steps with the arrows.</p></div><button class="outline-button small" type="button" @click="addActionField">+ Add question</button></div><div v-for="(field, index) in actionDraft.fields" :key="field.id" class="flow-field-card"><div class="flow-field-heading"><strong>Step {{ index + 1 }}</strong><div class="flow-field-controls"><button type="button" title="Move up" :disabled="index === 0" @click="moveActionField(index, -1)">↑</button><button type="button" title="Move down" :disabled="index === actionDraft.fields.length - 1" @click="moveActionField(index, 1)">↓</button><button type="button" title="Remove field" @click="removeActionField(index)">×</button></div></div><div class="flow-field-grid"><label>Field key<input v-model="field.key" type="text" /></label><label>Type<select v-model="field.type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="select">Select</option><option value="date">Date</option><option value="number">Number</option></select></label><label>Visibility<select v-model="field.visibility"><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label><label class="toggle-row"><span>Required</span><input v-model="field.required" type="checkbox" /></label><label class="flow-field-wide">Question / wording<input v-model="field.question" type="text" /></label><label class="flow-field-wide">Label<input v-model="field.label" type="text" /></label><label v-if="field.type === 'select'" class="flow-field-wide">Choices <span class="optional">comma separated</span><input :value="(field.options ?? []).join(', ')" type="text" @input="setFieldOptions(field, $event)" /></label><label>Show when<select :value="field.condition?.field ?? ''" @change="setFieldCondition(field, $event)"><option value="">Always</option><option v-for="conditionField in actionDraft.fields.slice(0, index)" :key="conditionField.key" :value="conditionField.key">{{ conditionField.label }}</option></select></label><label v-if="field.condition?.field">Equals<input :value="field.condition?.equals ?? ''" type="text" @input="setFieldConditionEquals(field, $event)" /></label></div></div><button class="outline-button small" type="button" @click="addActionField">+ Add another question</button></div>
              <div class="form-section"><h3>Completion</h3><div class="flow-field-grid"><label class="flow-field-wide">Success message<textarea v-model="actionDraft.completion.message" rows="2"></textarea></label><label>Submit button label<input v-model="actionDraft.completion.submitLabel" type="text" placeholder="Continue request" /></label><label>Lead status<select v-model="actionDraft.completion.leadStatus"><option value="new">New</option><option value="qualified">Qualified</option><option value="booked">Booked</option></select></label><label>Continue link <span class="optional">optional</span><input v-model="actionDraft.completion.linkUrl" type="url" placeholder="https://…" /></label><label class="toggle-row"><span>Create lead</span><input v-model="actionDraft.completion.createLead" type="checkbox" /></label><label class="toggle-row"><span>Notify staff</span><input v-model="actionDraft.completion.notifyStaff" type="checkbox" /></label><label class="toggle-row"><span>Require staff handoff</span><input v-model="actionDraft.completion.requiresStaff" type="checkbox" /></label><label class="toggle-row"><span>Notify owner</span><input :checked="hasActionNotificationTarget('owner')" type="checkbox" @change="toggleActionNotificationTarget('owner', $event)" /></label><label class="toggle-row"><span>Notify assigned staff</span><input :checked="hasActionNotificationTarget('assigned_staff')" type="checkbox" @change="toggleActionNotificationTarget('assigned_staff', $event)" /></label></div></div>
              <div class="form-section"><h3>External completion action</h3><p>Save the lead first, then run this connector. Failures stay in a retry queue and never remove the captured lead.</p><div class="flow-field-grid"><label>Connector<select :value="actionDraft.completion.connector?.provider ?? 'none'" @change="setActionConnectorProviderFromEvent"><option value="none">None — FrontDeskWise only</option><option value="email">Email the team</option><option v-if="integrations.some((integration) => integration.provider === 'webhook' && integration.connectionStatus === 'active')" value="generic_webhook">Generic webhook</option><option v-if="integrations.some((integration) => integration.provider === 'hubspot' && integration.connectionStatus === 'active')" value="hubspot">HubSpot</option></select></label><label v-if="actionDraft.completion.connector && actionDraft.completion.connector.provider !== 'email'">Connected system<select :value="actionDraft.completion.connector?.integrationId ?? ''" @change="setActionConnectorIntegrationFromEvent"><option value="">Select a connected system…</option><option v-for="integration in integrations.filter((item) => item.connectionStatus === 'active' && ((actionDraft?.completion.connector?.provider === 'generic_webhook' && item.provider === 'webhook') || (actionDraft?.completion.connector?.provider === 'hubspot' && item.provider === 'hubspot')))" :key="integration.id" :value="integration.id">{{ integration.displayName }} · {{ integration.connectionStatus }}</option></select></label><small class="flow-field-wide">Use the Generic webhook connector for Jackrabbit, Square, Mindbody, Calendly, or another vendor through Zapier, Make, or your own integration endpoint.</small></div></div>
              <div class="toolbar-actions flow-editor-actions"><button class="text-button" type="button" :disabled="actionsLoading" @click="removeAction">Remove flow</button><button class="primary-button small" type="button" :disabled="actionsLoading" @click="saveAction">{{ actionsLoading ? 'Saving…' : 'Save flow' }}</button></div>
            </article>
            <article v-else class="panel empty-view flow-editor-empty"><div class="empty-icon">ϟ</div><h2>Select a flow to customize</h2><p>Start with a template on the left, then make the questions fit your business.</p></article>
          </section>
          <div class="agent-layout">
            <article class="panel form-panel">
              <div class="form-section"><h3>Connect a CRM</h3><p>Use a signed webhook for Zapier, Make, or an internal endpoint, or connect a HubSpot private-app token. Secrets stay server-side.</p><label>Provider<select v-model="integrationProvider"><option value="webhook">Webhook / automation tool</option><option value="hubspot">HubSpot</option></select></label><label>Display name<input v-model="integrationDisplayName" type="text" autocomplete="organization" placeholder="Sales CRM" /></label><template v-if="integrationProvider === 'webhook'"><label>Webhook URL<input v-model="integrationWebhookUrl" name="webhookUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://hooks.example.com/frontdeskwise" /></label><label>Signing secret <span class="optional">optional · never shown again</span><input v-model="integrationSigningSecret" type="password" autocomplete="new-password" placeholder="Secret stored server-side" /></label></template><label v-else>HubSpot private-app token <span class="optional">never shown again</span><input v-model="integrationAccessToken" type="password" autocomplete="new-password" placeholder="pat-na1-…" /></label><button class="primary-button" type="button" :disabled="integrationLoading || (integrationProvider === 'webhook' ? !integrationWebhookUrl.trim() : !integrationAccessToken.trim())" @click="connectIntegration">Save integration →</button></div>
              <div class="form-section"><h3>Delivery contract</h3><p>Every lead is saved first, then queued for delivery. Temporary failures retry with backoff; permanent failures stay visible for a manual retry.</p></div>
            </article>
            <article class="panel form-panel"><div class="form-section"><h3>Connected systems</h3><p v-if="!integrations.length">No CRM connected yet.</p><div v-for="integration in integrations" :key="integration.id" class="integration-card"><div class="setup-row"><strong>{{ integration.displayName }}</strong><span :class="['status-pill', integration.connectionStatus === 'active' ? 'booked' : integration.connectionStatus === 'error' ? 'new' : 'qualified']">{{ integration.connectionStatus }}</span></div><small>{{ integration.provider }} · {{ integration.sync.synced }}/{{ integration.sync.total }} leads synced</small><small v-if="integration.sync.pending">{{ integration.sync.pending }} pending delivery</small><small v-if="integration.sync.failed" class="form-error">{{ integration.sync.failed }} failed delivery</small><small v-if="integration.lastError" class="form-error">{{ integration.lastError }}</small><div class="toolbar-actions"><button class="outline-button small" type="button" :disabled="integrationLoading" @click="testIntegration(integration)">Test connection</button><button v-if="integration.sync.failed" class="text-button" type="button" :disabled="integrationLoading" @click="retryIntegration(integration)">Retry failed</button><button class="text-button danger-text" type="button" :disabled="integrationLoading" @click="disconnectIntegration(integration)">Disconnect</button></div></div></div></article>
          </div>
          <article class="panel action-delivery-panel"><div class="panel-heading"><div><h3>Completion delivery queue</h3><p>External actions are retried independently from saved leads.</p></div><button class="outline-button small" type="button" :disabled="actionsLoading" @click="loadActions">Refresh</button></div><div v-if="!actionDeliveries.length" class="diagnostics-empty">No external action deliveries yet.</div><div v-for="delivery in actionDeliveries" :key="delivery.id" class="integration-card"><div class="setup-row"><strong>{{ delivery.actionName }}</strong><span :class="['status-pill', delivery.status === 'succeeded' ? 'booked' : delivery.status === 'failed' ? 'new' : 'qualified']">{{ delivery.status }}</span></div><small>{{ delivery.provider }} · {{ delivery.attempts }} attempt{{ delivery.attempts === 1 ? '' : 's' }} · {{ new Date(delivery.updatedAt).toLocaleString() }}</small><small v-if="delivery.lastError" class="form-error">{{ delivery.lastError }}</small><button v-if="delivery.status === 'failed'" class="text-button" type="button" :disabled="actionsLoading" @click="retryActionDelivery(delivery)">Retry action</button></div></article>
        </div>

        <div v-else-if="view === 'connections'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Safe assistant connections</p><h2>Connections</h2><p>Connect business systems for lookups and assistant tools. Your completion actions still use the reliable delivery connectors in Actions & Flows.</p></div><div class="toolbar-actions"><span v-if="mcpMessage" class="saved-message">✓ {{ mcpMessage }}</span><button class="outline-button small" type="button" :disabled="mcpLoading" @click="loadMcpConnections">{{ mcpLoading ? 'Working…' : 'Refresh' }}</button></div></div>
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
          <article class="panel aggregate-billing-note"><p class="eyebrow">Shared organization billing</p><h2>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h2><p>{{ availableBusinesses.length }} of {{ activeOrganization?.billing.plan.maxBusinesses ?? 1 }} business slots used. Add capacity from Billing when you are ready to grow.</p><button class="text-button" type="button" @click="view = 'billing'">View plan →</button></article>
        </div>

        <div v-else-if="view === 'settings'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Account controls</p><h2>Settings</h2><p>Identity, organization, and access details for this FrontDeskWise account.</p></div></div>
          <div class="settings-grid"><article class="panel settings-card"><p class="eyebrow">Signed-in account</p><h3>{{ authSnapshot?.user.name ?? 'FrontDeskWise user' }}</h3><p>{{ authSnapshot?.user.email ?? 'Not signed in' }}</p><small>Use your email or Google account to sign in. Password recovery is available from the sign-in screen.</small><button v-if="authSnapshot" class="outline-button small" type="button" @click="signOut">Sign out</button></article><article class="panel settings-card"><p class="eyebrow">Organization</p><h3>{{ activeOrganization?.name ?? 'Your organization' }}</h3><p>{{ formatLabel(activeOrganization?.role ?? 'owner') }} · {{ availableBusinesses.length }} businesses</p><small>One organization owns the businesses, assistant settings, knowledge, and billing relationship.</small><button class="outline-button small" type="button" @click="view = 'businesses'">Manage businesses →</button></article><article class="panel settings-card"><p class="eyebrow">Billing access</p><h3>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h3><p>{{ formatLabel(activeOrganization?.billing.status ?? 'trial') }} · {{ activeOrganization?.billing.access.allowed ? 'Write access enabled' : 'Read-only access' }}</p><small>Billing controls access to publishing, new businesses, and other write actions.</small><button class="outline-button small" type="button" @click="view = 'billing'">Open billing →</button></article></div>
          <article v-if="authSnapshot && ownershipVerification" class="panel verification-panel"><div class="panel-heading"><div><p class="eyebrow">Website ownership</p><h2>{{ ownershipVerification.status === 'verified' ? 'Ownership verified' : 'Verify before publishing' }}</h2><p>{{ ownershipVerification.status === 'verified' ? 'This business can publish its widget and receive production leads.' : 'Verify the website connected to this business before installing the live widget.' }}</p></div><span :class="['status-pill', ownershipVerification.status === 'verified' ? 'booked' : ownershipVerification.status === 'rejected' ? 'new' : 'qualified']">{{ formatLabel(ownershipVerification.status) }}</span></div><div v-if="ownershipVerification.status !== 'verified'" class="verification-controls"><label>Method<select v-model="verificationMethod"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><button class="outline-button small" type="button" :disabled="verificationLoading" @click="requestOwnershipVerification">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethod !== 'email' && verificationMethod !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="checkOwnershipVerification">Check now</button></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="verificationMessage" class="saved-message">✓ {{ verificationMessage }}</p><p v-if="verificationError" class="form-error">{{ verificationError }}</p></article>
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
            <div class="admin-overview-grid"><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Platform health</p><h2>Know what is breaking</h2><p>Live checks for the API, database, storage, and email delivery.</p></div><span :class="['status-pill', adminHealth?.api === 'healthy' ? 'booked' : adminHealth?.api === 'degraded' ? 'qualified' : 'new']">{{ adminHealth?.api ?? 'checking' }}</span></div><div class="health-list"><div><span>API and database</span><strong>{{ adminHealth?.database ?? 'Checking…' }}</strong></div><div><span>Private storage</span><strong>{{ adminHealth?.objectStorageConfigured ? 'Configured' : 'Needs setup' }}</strong></div><div><span>Email delivery</span><strong>{{ adminHealth?.emailConfigured ? 'Configured' : 'Needs setup' }}</strong></div></div></article><article class="ds-card"><div class="ds-card-heading"><div><p class="eyebrow">Attention queue</p><h2>Operator follow-up</h2><p>Small, explicit queues keep the control plane useful.</p></div></div><div class="admin-attention-list"><button type="button" @click="adminSection = 'organizations'"><span>Paused organizations</span><strong>{{ adminPausedCount }}</strong></button><button type="button" @click="adminSection = 'demos'"><span>Failed or expired demos</span><strong>{{ adminFailedDemoCount }}</strong></button><button type="button" @click="adminSection = 'users'"><span>Disabled users</span><strong>{{ adminDisabledUserCount }}</strong></button></div></article></div>
          </template>
          <article v-if="adminSection === 'overview' || adminSection === 'organizations'" class="panel table-panel admin-table-panel"><div class="table-heading admin-row"><span>Organization</span><span>Plan / status</span><span>Businesses</span><span>Outcomes</span><span>Actions</span></div><div v-if="!adminOrganizations.length" class="diagnostics-empty">No organizations found.</div><div v-for="organization in adminOrganizations" :key="organization.id" class="table-row admin-row"><div><strong>{{ organization.name }}</strong><small>{{ organization.ownerEmail ?? 'No owner email' }}</small></div><div><strong>{{ organization.planName }}</strong><small>{{ organization.status }} · {{ organization.mode }}</small></div><span>{{ organization.businessCount }}</span><span><strong>{{ organization.leadCount }}</strong> leads · {{ organization.conversationCount }} conversations</span><div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading || adminOrganizationDetailLoading" @click="loadAdminOrganizationDetail(organization.id)">Inspect</button><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'trial')">30-day trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'suspend')">Suspend</button></div></div></article>
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
        <label>Business website<input v-model="addBusinessUrl" type="url" required placeholder="https://company.com" /></label>
        <p v-if="addBusinessError" class="form-error">{{ addBusinessError }}</p>
        <p v-if="addBusinessMessage" class="saved-message">✓ {{ addBusinessMessage }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="addBusinessLoading">{{ addBusinessLoading ? 'Crawling website…' : 'Add business →' }}</button>
      </form>
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
      <form class="auth-card" @submit.prevent="submitAuth">
        <button class="auth-close" type="button" aria-label="Close" @click="authModalOpen = false">×</button>
        <p class="eyebrow">{{ authMode === 'signup' ? 'Save your AI front desk' : 'Welcome back' }}</p>
        <h2 id="auth-title">{{ authMode === 'signup' ? 'Create your FrontDeskWise account' : 'Sign in to FrontDeskWise' }}</h2>
        <p class="auth-copy">{{ authMode === 'signup' ? (publicDemoMode ? 'Your workspace stays attached to your new organization.' : 'Create your organization and add your first business.') : 'Pick up where you left off across all your businesses.' }}</p>
        <label>Email<input v-model="authEmail" type="email" autocomplete="email" required placeholder="name@company.com" /></label>
        <label>Password<input v-model="authPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters" /></label>
        <label v-if="authMode === 'signup'">Organization name <span class="optional">optional</span><input v-model="authOrganizationName" type="text" placeholder="Your company" /></label>
        <p v-if="authError" class="form-error">{{ authError }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="authLoading">{{ authLoading ? 'Working…' : authMode === 'signup' ? 'Create account →' : 'Sign in →' }}</button>
        <div class="auth-divider"><span>or</span></div>
        <button class="google-button" type="button" :disabled="authLoading" @click="submitGoogleAuth"><span class="google-mark">G</span> Continue with Google</button>
        <button v-if="authMode === 'signin'" class="text-button auth-switch" type="button" @click="resetPassword">Forgot password?</button>
        <button class="text-button auth-switch" type="button" @click="authMode = authMode === 'signup' ? 'signin' : 'signup'; authError = ''">{{ authMode === 'signup' ? 'Already have an account? Sign in' : 'New to FrontDeskWise? Create an account' }}</button>
      </form>
    </div>
  </main>
</template>

