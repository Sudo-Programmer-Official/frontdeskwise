<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  currentAuthSnapshot,
  firebaseAuthConfigured,
  observeFirebaseUser,
  sendFrontDeskWisePasswordReset,
  signInAndBootstrap,
  signInWithGoogleAndBootstrap,
  signOutFrontDeskWise,
  signUpAndBootstrap,
  type AuthSnapshot,
} from "./auth/firebase";

type View = "home" | "overview" | "conversations" | "leads" | "knowledge" | "actions" | "agent" | "analytics" | "businesses" | "settings" | "billing" | "admin";
type VerificationMethod = "email" | "meta_tag" | "file" | "dns_txt" | "manual";

interface Lead {
  id: string;
  name: string;
  intent: string;
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
  retrieval?: { mode?: string; candidateCount?: number; topScore?: number };
  createdAt: string;
}

interface WidgetInstall {
  siteKey: string;
  snippet: string;
  verification: { lastLoadedAt: string | null; loadCount: number };
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
  setup: { completed: number; total: number; percent: number };
}

interface WorkspacePayload {
  slug: string;
  status: string;
  business?: { id?: string; name?: string; location?: string; websiteUrl?: string };
  agent?: { assistantName?: string; welcomeMessage?: string; widgetColor?: string; collectLeads?: boolean; showBookingAction?: boolean };
  ownership?: { status: "pending" | "verified" | "rejected"; method: VerificationMethod | null; verifiedAt: string | null };
  knowledge?: { sourceCount: number; chunkCount: number; openGaps: number; readiness?: { score: number; sources: number; chunks: number; openGaps: number } };
  stats?: WorkspaceStats;
}

interface FeaturedDemo extends WorkspacePayload {
  business: { id: string; name: string; location: string; websiteUrl: string };
  knowledge: { sourceCount: number; chunkCount: number; openGaps: number; readiness?: { score: number; sources: number; chunks: number; openGaps: number } };
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
  usageLast30Days: { conversations: number; leads: number; bookings: number; llmRequests: number; llmInputTokens: number; llmOutputTokens: number };
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
const savedMessage = ref("");
const conversationId = ref("");
const testQuestion = ref("");
const testAnswer = ref("");
const answerSource = ref("");
const answerGrounded = ref(false);
const answerConfidence = ref(0);
const answerConfidenceBand = ref<"high" | "medium" | "low">("low");
const answerRetrievalMode = ref("");
const widgetInstall = ref<WidgetInstall | null>(null);
const widgetInstallMessage = ref("");
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
const knowledgeError = ref("");
const knowledgeLoading = ref(false);
const answerDrafts = ref<Record<string, string>>({});
const organizationDocuments = ref<OrganizationDocument[]>([]);
const documentsLoading = ref(false);
const documentsError = ref("");
const documentsMessage = ref("");
const integrations = ref<Integration[]>([]);
const integrationProvider = ref<"webhook" | "hubspot">("webhook");
const integrationDisplayName = ref("CRM webhook");
const integrationWebhookUrl = ref("");
const integrationSigningSecret = ref("");
const integrationAccessToken = ref("");
const integrationLoading = ref(false);
const integrationError = ref("");
const integrationMessage = ref("");
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
const featuredDemos = ref<FeaturedDemo[]>([]);
const workspaceStats = ref<WorkspaceStats | null>(null);
const workspaceKnowledge = ref<WorkspacePayload["knowledge"] | null>(null);
const workspaceReadiness = ref(0);
const workspaceLoading = ref(false);
const workspaceError = ref("");

const leads = ref<Lead[]>([]);

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "conversations", label: "Conversations", icon: "◌" },
  { id: "leads", label: "Leads", icon: "♧" },
  { id: "knowledge", label: "Knowledge", icon: "▤" },
  { id: "actions", label: "Actions & Integrations", icon: "ϟ" },
  { id: "agent", label: "Agent & Widget", icon: "✦" },
  { id: "analytics", label: "Analytics", icon: "◒" },
  { id: "businesses", label: "Businesses", icon: "▦" },
  { id: "settings", label: "Settings", icon: "⚙" },
  { id: "billing", label: "Billing", icon: "$" },
];

const pageTitle = computed(() => {
  if (view.value === "home") return "Build your AI front desk";
  if (view.value === "admin") return "Admin control plane";
  return navItems.find((item) => item.id === view.value)?.label ?? "Overview";
});

const activeLeads = computed(() => leads.value.filter((lead) => lead.status !== "Booked").length);
const activeOrganization = computed(() => authSnapshot.value?.organizations.find((organization) => organization.id === authSnapshot.value?.activeOrganizationId) ?? authSnapshot.value?.organizations[0] ?? null);
const availableBusinesses = computed(() => activeOrganization.value?.businesses ?? []);
const aggregateMetrics = computed(() => activeOrganization.value?.metrics ?? { conversations: 0, leads: 0, bookings: 0 });
const businessInitial = computed(() => (businessName.value.trim().charAt(0) || "?").toUpperCase());
const conversationCount = computed(() => workspaceStats.value?.conversations ?? 0);
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

async function submitAuth() {
  if (!authEmail.value.trim() || authPassword.value.length < 6 || authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in is not configured yet. Add the Firebase web settings to the Vercel environment.");
    authSnapshot.value = authMode.value === "signup"
      ? await signUpAndBootstrap(authEmail.value, authPassword.value, demoAccessToken.value || undefined, authOrganizationName.value)
      : await signInAndBootstrap(authEmail.value, authPassword.value, demoAccessToken.value || undefined, authOrganizationName.value);
    await syncAuthenticatedBusiness(authSnapshot.value);
    await loadBilling();
    authModalOpen.value = false;
    authPassword.value = "";
    view.value = "overview";
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Could not finish sign-in.";
  } finally {
    authLoading.value = false;
  }
}

async function submitGoogleAuth() {
  if (authLoading.value) return;
  authLoading.value = true;
  authError.value = "";
  try {
    if (!firebaseAuthConfigured()) throw new Error("Sign-in is not configured yet. Add the Firebase web settings to the Vercel environment.");
    authSnapshot.value = await signInWithGoogleAndBootstrap(demoAccessToken.value || undefined, authOrganizationName.value);
    await syncAuthenticatedBusiness(authSnapshot.value);
    await loadBilling();
    authModalOpen.value = false;
    view.value = "overview";
  } catch (error) {
    authError.value = error instanceof Error ? error.message : "Could not finish Google sign-in.";
  } finally {
    authLoading.value = false;
  }
}

async function signOut() {
  await signOutFrontDeskWise();
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
  workspaceStats.value = null;
  workspaceKnowledge.value = null;
  workspaceReadiness.value = 0;
  leads.value = [];
  knowledgeGaps.value = [];
  retrievalDiagnostics.value = [];
  organizationDocuments.value = [];
  integrations.value = [];
  widgetInstall.value = null;
  ownershipVerification.value = null;
  verificationToken.value = "";
  verificationInstructions.value = "";
  verificationMessage.value = "";
  verificationError.value = "";
  conversationId.value = "";
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
      await Promise.allSettled([loadLeads(), loadKnowledge(), loadWidgetInstall(), loadIntegrations(), loadDocuments(), loadOwnershipVerification()]);
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

async function syncAuthenticatedBusiness(snapshot: AuthSnapshot) {
  const organization = snapshot.organizations.find((item) => item.id === snapshot.activeOrganizationId) ?? snapshot.organizations[0];
  const preferred = organization?.businesses.find((business) => business.slug === demoSlug.value)
    ?? snapshot.organizations.flatMap((item) => item.businesses).find((business) => business.slug === demoSlug.value)
    ?? organization?.businesses[0]
    ?? snapshot.organizations[0]?.businesses[0];
  if (preferred) await selectBusiness(preferred.slug);
  else {
    showAllBusinesses.value = false;
    clearWorkspaceState();
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
    generationError.value = error instanceof Error ? error.message : "This demo link is invalid or expired.";
  }
}

async function loadKnowledge() {
  if ((!firebaseToken.value && !demoAccessToken.value) || knowledgeLoading.value) return;
  knowledgeLoading.value = true;
  knowledgeError.value = "";
  try {
    const [gapsResponse, diagnosticsResponse] = await Promise.all([
      fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/knowledge-gaps`), { headers: ownerHeaders() }),
      fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/retrieval-diagnostics`), { headers: ownerHeaders() }),
    ]);
    if (!gapsResponse.ok || !diagnosticsResponse.ok) throw new Error("Your demo owner session may have expired. Generate a fresh demo to continue.");
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
  documentsLoading.value = true;
  documentsError.value = "";
  try {
    const params = new URLSearchParams({ organizationId: activeOrganization.value.id });
    const businessId = selectedBusinessId();
    if (businessId) params.set("businessId", businessId);
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
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/install`), { headers: ownerHeaders() });
  if (!response.ok) return;
  widgetInstall.value = await response.json() as WidgetInstall;
}

async function loadOwnershipVerification() {
  if (!firebaseToken.value || !authSnapshot.value) return;
  try {
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/verification`), { headers: ownerHeaders() });
    const payload = await response.json() as { verification?: WorkspacePayload["ownership"] };
    if (response.ok && payload.verification) ownershipVerification.value = payload.verification;
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
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/leads`), { headers: ownerHeaders() });
  if (!response.ok) return;
  const payload = await response.json() as { leads?: Array<{ id: string; name?: string | null; intent?: string | null; status?: string; createdAt?: string }> };
  leads.value = (payload.leads ?? []).map((lead) => ({
    id: lead.id,
    name: lead.name ?? "Unknown contact",
    intent: lead.intent ?? "General inquiry",
    status: lead.status === "qualified" ? "Qualified" : lead.status === "booked" ? "Booked" : "New",
    time: lead.createdAt ? new Date(lead.createdAt).toLocaleString() : "Just now",
  }));
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
      return;
    }
    const payload = await response.json() as { organizations?: AdminOrganization[] };
    adminOrganizations.value = payload.organizations ?? [];
    isSuperAdmin.value = true;
  } catch {
    isSuperAdmin.value = false;
  } finally {
    adminLoading.value = false;
  }
}

function isPlatformRoute(): boolean {
  return typeof window !== "undefined" && window.location.pathname === "/platform";
}

function navigateToAdmin() {
  if (typeof window !== "undefined" && window.location.pathname !== "/platform") {
    window.history.pushState({}, "", "/platform");
  }
  if (isSuperAdmin.value) view.value = "admin";
  else openAuth("signin");
}

function handleRouteChange() {
  if (isPlatformRoute()) {
    if (isSuperAdmin.value) view.value = "admin";
    else if (authSnapshot.value) void loadAdminOrganizations();
    else openAuth("signin");
    return;
  }
  if (view.value === "admin") view.value = authSnapshot.value ? "overview" : "home";
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
  } catch (error) {
    adminError.value = error instanceof Error ? error.message : "Admin action failed.";
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

async function copyWidgetSnippet() {
  if (!widgetInstall.value) return;
  await navigator.clipboard.writeText(widgetInstall.value.snippet);
  widgetInstallMessage.value = "Copied install snippet";
  window.setTimeout(() => (widgetInstallMessage.value = ""), 2600);
}

async function askQuestion() {
  if (!testQuestion.value.trim() || isAsking.value) return;
  isAsking.value = true;
  testAnswer.value = "";
  answerSource.value = "";
  answerConfidence.value = 0;
  answerConfidenceBand.value = "low";
  answerRetrievalMode.value = "";
  try {
    if (!conversationId.value) {
      const conversationResponse = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations`), {
        method: "POST",
        headers: { "content-type": "application/json", ...ownerHeaders() },
        body: JSON.stringify({ sessionId: `dashboard-${Date.now()}` }),
      });
      const conversationPayload = await conversationResponse.json() as { conversationId?: string };
      if (!conversationResponse.ok || !conversationPayload.conversationId) throw new Error("Could not start a test conversation.");
      conversationId.value = conversationPayload.conversationId;
    }
    const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/conversations/${conversationId.value}/messages`), {
      method: "POST",
      headers: { "content-type": "application/json", ...ownerHeaders() },
      body: JSON.stringify({ question: testQuestion.value }),
    });
    const payload = await response.json() as { error?: string; answer?: string; grounded?: boolean; confidenceScore?: number; confidenceBand?: "high" | "medium" | "low"; retrieval?: { mode?: string }; citations?: Array<{ url?: string }> };
    if (!response.ok) throw new Error(payload.error ?? "Could not answer that question.");
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
    answerConfidence.value = payload.confidenceScore ?? 0;
    answerConfidenceBand.value = payload.confidenceBand ?? "low";
    answerRetrievalMode.value = payload.retrieval?.mode ?? "";
    answerSource.value = payload.citations?.[0]?.url ?? "";
    testQuestion.value = "";
    await Promise.all([refreshWorkspaceSummary(), refreshAuthenticatedSnapshot()]);
  } catch (error) {
    testAnswer.value = error instanceof Error ? error.message : "Could not answer that question.";
    answerGrounded.value = false;
  } finally {
    isAsking.value = false;
  }
}

async function captureLead() {
  if (!leadEmail.value.trim() && !leadPhone.value.trim()) return;
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
  if (!response.ok) return;
  leadName.value = "";
  leadEmail.value = "";
  leadPhone.value = "";
  leadIntent.value = "";
  leadSavedMessage.value = "Lead captured · visible in Leads";
  await Promise.all([loadLeads(), refreshWorkspaceSummary(), refreshAuthenticatedSnapshot()]);
  window.setTimeout(() => (leadSavedMessage.value = ""), 2600);
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
    }),
  });
  savedMessage.value = response.ok ? "Saved · demo is ready to share" : "Could not save the agent";
  window.setTimeout(() => (savedMessage.value = ""), 2600);
}

watch(view, (nextView) => {
  if (nextView === "knowledge") {
    void loadKnowledge();
    void loadDocuments();
  }
  if (nextView === "agent") void loadWidgetInstall();
  if (nextView === "leads") void loadLeads();
  if (nextView === "actions") void loadIntegrations();
  if (nextView === "billing") void loadBilling();
  if (nextView === "admin") {
    void loadAdminOrganizations();
    void loadAdminDemoRequests();
  }
});

function updateDocumentMetadata() {
  if (typeof document === "undefined") return;
  const landing = view.value === "home";
  document.title = landing ? "FrontDeskWise — AI front desk for local businesses" : `${pageTitle.value} · FrontDeskWise`;
  const robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (robots) robots.content = landing ? "index,follow" : "noindex,nofollow";
}

watch(view, updateDocumentMetadata);
onMounted(() => {
  updateDocumentMetadata();
  void loadFeaturedDemos();
  void consumeDemoLink();
  if (typeof window !== "undefined") {
    window.addEventListener("popstate", handleRouteChange);
    if (isPlatformRoute() && !authSnapshot.value) openAuth("signin");
    observeFirebaseUser((user) => {
      void (async () => {
        firebaseToken.value = user ? await user.getIdToken() : "";
        authSnapshot.value = user ? await currentAuthSnapshot() : null;
        if (authSnapshot.value) {
          await syncAuthenticatedBusiness(authSnapshot.value);
          await loadBilling();
          await loadAdminOrganizations();
          if (isPlatformRoute()) {
            if (isSuperAdmin.value) view.value = "admin";
            else openAuth("signin");
          }
        } else {
          isSuperAdmin.value = false;
          if (isPlatformRoute()) openAuth("signin");
        }
      })();
    });
  }
});

onBeforeUnmount(() => {
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
    </section>

    <section v-else class="product-shell">
      <aside class="sidebar">
        <button class="sidebar-brand" type="button" @click="openHome"><img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></button>
        <div class="workspace-switcher"><span class="workspace-avatar">{{ businessInitial }}</span><span v-if="availableBusinesses.length" class="workspace-select-wrap"><select v-model="workspaceSelection" aria-label="Switch business"><option v-if="availableBusinesses.length > 1" value="__all__">All businesses</option><option v-for="business in availableBusinesses" :key="business.id" :value="business.slug">{{ business.name }}</option></select><small>{{ activeOrganization?.name ?? 'Organization' }}</small></span><span v-else><strong>{{ businessName || (authSnapshot ? 'No business yet' : 'Demo workspace') }}</strong><small>{{ businessLocation || (authSnapshot ? 'Add your first business' : 'Preview data from the API') }}</small></span><button v-if="authSnapshot" class="workspace-add" type="button" aria-label="Add business" @click="openAddBusiness">+</button><span class="chevron">⌄</span></div>
          <nav class="sidebar-nav">
          <button v-for="item in navItems" :key="item.id" type="button" :disabled="publicDemoMode && item.id !== 'overview'" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><b v-if="item.id === 'conversations' && conversationCount">{{ conversationCount }}</b></button>
          <button v-if="isSuperAdmin" type="button" :class="['nav-item', { active: view === 'admin' }]" @click="navigateToAdmin"><span class="nav-icon">⚙</span><span>Admin control plane</span></button>
        </nav>
        <div class="sidebar-bottom"><div class="setup-card"><div class="setup-row"><span>Setup progress</span><strong>{{ workspaceStats?.setup.percent ?? 0 }}%</strong></div><div class="progress-bar"><span :style="{ width: `${workspaceStats?.setup.percent ?? 0}%` }"></span></div><small>{{ workspaceStats?.setup.completed ?? 0 }} of {{ workspaceStats?.setup.total ?? 4 }} steps complete</small></div><button class="sidebar-link" type="button" @click="openHome">← Back to landing page</button></div>
      </aside>

      <section class="content-area">
        <header class="content-header"><div><p class="breadcrumb">{{ showAllBusinesses ? 'All businesses' : (businessName || 'Workspace') }} / FrontDeskWise</p><h1>{{ pageTitle }}</h1></div><div class="header-actions"><button class="outline-button" type="button" @click="publicDemoMode ? openAuth('signup') : view = 'agent'">Preview on website ↗</button><button class="primary-button small" type="button" @click="publicDemoMode ? openAuth('signup') : view = 'agent'">Edit agent</button><button v-if="authSnapshot" class="text-button" type="button" @click="signOut">Sign out</button><span class="notification">♧<i></i></span><span class="profile-avatar">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : 'SP' }}</span></div></header>
        <div v-if="publicDemoMode" class="trial-banner info"><span><strong>Public sample workspace</strong><small>This view is live demo data in read-only mode. Generate your own demo or create an account to customize, install, and capture leads.</small></span><button class="primary-button small" type="button" @click="openAuth('signup')">Create your workspace →</button></div>
        <div v-else-if="billingSnapshot?.billing.status === 'trial' && billingSnapshot.billing.mode !== 'sandbox'" class="trial-banner"><span><strong>{{ trialDaysRemaining }} {{ trialDaysRemaining === 1 ? 'day' : 'days' }} left in your trial</strong><small>Keep your workspace, knowledge, and leads active by choosing a plan.</small></span><button class="primary-button small" type="button" @click="view = 'billing'">Upgrade →</button></div>
        <div v-else-if="billingReadOnly" class="trial-banner danger"><span><strong>Your workspace is read-only</strong><small>Existing data is preserved. Restore billing to resume publishing and production lead capture.</small></span><button class="primary-button small" type="button" @click="view = 'billing'">Restore billing →</button></div>

        <div v-if="view === 'overview' && showAllBusinesses" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Organization overview</p><h2>All businesses</h2><p>One account, one subscription, and a clear view across every business you manage.</p></div><button class="primary-button small" type="button" @click="openAddBusiness">+ Add business</button></div>
          <div class="metric-grid aggregate-metric-grid"><article class="metric-card blue-tint"><span class="metric-icon blue">♧</span><strong>{{ aggregateMetrics.leads }}</strong><span>Total leads</span><em>Across all businesses</em></article><article class="metric-card green-tint"><span class="metric-icon green">▣</span><strong>{{ aggregateMetrics.bookings }}</strong><span>Booking actions</span><em>Across all businesses</em></article><article class="metric-card orange-tint"><span class="metric-icon orange">◌</span><strong>{{ aggregateMetrics.conversations }}</strong><span>Conversations</span><em>Last recorded totals</em></article><article class="metric-card purple-tint"><span class="metric-icon purple">▱</span><strong>{{ activeOrganization?.businesses.length ?? 0 }}</strong><span>Businesses</span><em>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }} plan</em></article></div>
          <article class="panel aggregate-business-panel"><div class="panel-heading"><div><h2>Businesses in {{ activeOrganization?.name ?? 'your organization' }}</h2><p>Switch context without creating another account.</p></div><span class="conversation-status">{{ activeOrganization?.billing.status ?? 'trial' }}</span></div><div class="aggregate-business-list"><div v-for="business in availableBusinesses" :key="business.id" class="aggregate-business-row"><div><strong>{{ business.name }}</strong><small>{{ business.websiteUrl ?? 'Website pending' }}</small></div><span>{{ business.role }}</span><span class="status-pill qualified">{{ business.planKey }}</span><button class="outline-button small" type="button" @click="workspaceSelection = business.slug">Open →</button></div></div></article>
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
            <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>What visitors are asking</p></div><button class="text-button" type="button" @click="view = 'conversations'">See all →</button></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Recommended actions</h2><p>Open gaps from live conversations</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Add answer</button></div></div><div v-else class="diagnostics-empty">No open actions. New low-confidence questions will appear here.</div></article></div>
          </template>
        </div>

        <div v-else-if="view === 'conversations'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Grounded answers</p><h2>Test a conversation</h2><p>Ask what a visitor would ask and verify the source before sharing the demo.</p></div><span v-if="conversationId" class="conversation-status">Conversation active</span></div><div class="conversation-layout"><article class="panel conversation-panel"><div class="conversation-intro"><span class="mini-orb">✦</span><div><strong>{{ assistantName }}</strong><small>Answers from {{ businessName }} knowledge</small></div></div><div v-if="testAnswer" class="answer-card"><div class="answer-meta"><span :class="['answer-badge', answerGrounded ? 'grounded' : 'fallback']">{{ answerGrounded ? '✓ Grounded in source' : '! Needs an answer' }}</span><span class="answer-diagnostic">{{ Math.round(answerConfidence * 100) }}% · {{ answerConfidenceBand }}<span v-if="answerRetrievalMode"> · {{ answerRetrievalMode }}</span></span><a v-if="answerSource" :href="answerSource" target="_blank" rel="noreferrer">View source ↗</a></div><p>{{ testAnswer }}</p></div><div v-else class="conversation-empty">Ask a question to see the agent’s answer and citation.</div><form class="question-form" @submit.prevent="askQuestion"><input v-model="testQuestion" type="text" placeholder="e.g. What age can my child start?" aria-label="Test question" /><button class="primary-button small" type="submit" :disabled="isAsking">{{ isAsking ? 'Checking…' : 'Ask agent' }}</button></form></article><article class="panel lead-capture-panel"><div class="panel-heading"><div><h2>Capture the next step</h2><p>Send a contact to the owner dashboard.</p></div></div><label>Name<input v-model="leadName" type="text" placeholder="Jamie Rodriguez" /></label><label>Email<input v-model="leadEmail" type="email" placeholder="jamie@example.com" /></label><label>Phone <span class="optional">optional</span><input v-model="leadPhone" type="tel" placeholder="(555) 010-2026" /></label><label>Intent <span class="optional">optional</span><input v-model="leadIntent" type="text" placeholder="Toddler lessons" /></label><button class="primary-button" type="button" :disabled="!leadEmail && !leadPhone" @click="captureLead">Capture lead →</button><span v-if="leadSavedMessage" class="saved-message">✓ {{ leadSavedMessage }}</span></article></div></div>

        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>People FrontDeskWise helped move closer to a booking.</p></div><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div><div class="panel table-panel"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-if="!leads.length" class="diagnostics-empty">No leads captured yet.</div><div v-for="lead in leads" :key="lead.id" class="table-row"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0) }}</span><strong>{{ lead.name }}</strong></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></div></div></div>

        <div v-else-if="view === 'agent'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Make it yours</p><h2>Agent & widget</h2><p>Customize the demo, then publish it to a real business website.</p></div><div class="toolbar-actions"><span v-if="savedMessage" class="saved-message">✓ {{ savedMessage }}</span><button class="outline-button" type="button" @click="view = 'overview'">Test conversation</button><button class="primary-button small" type="button" @click="saveAgent">{{ authSnapshot ? 'Save & publish' : 'Create account to publish' }}</button></div></div><div class="agent-layout"><article class="panel form-panel"><div class="form-section"><h3>Agent identity</h3><label>Assistant name<input v-model="assistantName" type="text" /></label><label>Welcome message<textarea v-model="welcomeMessage" rows="5"></textarea></label><label>Widget color<div class="color-row"><button v-for="color in ['#0d6efd','#18a999','#7447d9','#f27b35','#112c64']" :key="color" type="button" :class="['color-swatch', { selected: widgetColor === color }]" :style="{ background: color }" @click="widgetColor = color"></button></div></label></div><div class="form-section"><h3>Lead capture</h3><label class="toggle-row"><span>Collect lead information</span><input v-model="showLeadCapture" type="checkbox" /></label><label class="toggle-row"><span>Show booking action button</span><input v-model="showBookingAction" type="checkbox" /></label><label class="toggle-row"><span>Offer human handoff when uncertain</span><input type="checkbox" checked /></label></div></article><article class="panel live-preview"><div class="preview-browser"><div class="preview-browser-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>{{ websiteUrl || 'https://yourbusiness.com' }}</span></div><div class="preview-site"><div class="preview-site-nav"><strong>{{ businessName || 'YOUR BUSINESS' }}</strong><span>Services　About　FAQs　Contact</span><button>Get started</button></div><div class="preview-site-hero"><div><h2>Help visitors<br />take the next step</h2><p>Grounded answers from {{ businessName || 'your website' }}.</p><button>Explore services →</button></div><div class="fake-swimmer">✦</div></div><div class="preview-chat" :style="{ '--accent': widgetColor }"><div class="chat-header"><span class="mini-orb">✦</span><span>{{ assistantName }}</span><span class="online-dot"></span></div><div class="chat-bubble">{{ welcomeMessage }}</div><div class="suggested-question">What services do you offer? <span>›</span></div><div class="suggested-question">How do I get started? <span>›</span></div><button v-if="showLeadCapture" class="chat-cta" type="button">Get started / Request information</button><div class="chat-input">Type your question… <span>➤</span></div></div></div></div></article></div><article class="panel install-panel"><div class="panel-heading"><div><p class="eyebrow">Publish anywhere</p><h2>Install your front desk</h2><p>Copy one snippet and paste it before <code>&lt;/body&gt;</code> on the business website.</p></div><span v-if="widgetInstallMessage" class="saved-message">✓ {{ widgetInstallMessage }}</span></div><template v-if="authSnapshot && widgetInstall"><div class="install-snippet"><code>{{ widgetInstall.snippet }}</code><button class="primary-button small" type="button" @click="copyWidgetSnippet">Copy snippet</button></div><small class="install-note">Site key: {{ widgetInstall.siteKey }} · Widget verification: {{ widgetInstall.verification.loadCount }} loads</small></template><div v-else class="install-gate"><p>Sign in to generate a private install snippet for this business. The preview remains available without an account.</p><button class="outline-button small" type="button" @click="openAuth('signup')">Create account to install →</button></div></article></div>

        <div v-else-if="view === 'knowledge'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Knowledge review</p><h2>Close the answer gaps</h2><p>Approve safe answers for questions the front desk could not ground confidently.</p></div><button class="outline-button small" type="button" @click="loadKnowledge">{{ knowledgeLoading ? 'Refreshing…' : 'Refresh' }}</button></div>
          <p v-if="knowledgeError" class="form-error">{{ knowledgeError }}</p>
          <article class="panel document-library">
            <div class="panel-heading"><div><p class="eyebrow">Organization knowledge</p><h2>Private documents</h2><p>Upload policies, menus, service guides, and other business material. Files are private and scoped to {{ businessName }}.</p></div><label class="primary-button small document-upload-button">{{ documentsLoading ? 'Working…' : 'Upload document' }}<input type="file" accept=".pdf,.txt,.md,.csv,.json,.rtf,.doc,.docx,.xls,.xlsx,application/pdf,text/plain,text/markdown,text/csv,application/json" :disabled="documentsLoading || !authSnapshot" @change="uploadDocument" /></label></div>
            <p v-if="documentsError" class="form-error">{{ documentsError }}</p>
            <p v-if="documentsMessage" class="saved-message">✓ {{ documentsMessage }}</p>
            <div v-if="!authSnapshot" class="install-gate"><p>Sign in to upload organization knowledge. The public demo still uses the crawled website.</p><button class="outline-button small" type="button" @click="openAuth('signup')">Create account to upload →</button></div>
            <div v-else-if="!organizationDocuments.length && !documentsError" class="diagnostics-empty">No private documents uploaded for this business yet.</div>
            <div v-else class="document-list"><div v-for="documentItem in organizationDocuments" :key="documentItem.id" class="document-row"><div><strong>{{ documentItem.fileName }}</strong><small>{{ documentItem.contentType }} · {{ formatDocumentSize(documentItem.sizeBytes) }} · {{ documentItem.status }}</small></div><div class="admin-actions"><button class="outline-button small" type="button" @click="downloadDocument(documentItem)">Download</button><button class="text-button" type="button" :disabled="documentsLoading" @click="deleteDocument(documentItem)">Remove</button></div></div></div>
          </article>
          <article v-if="!knowledgeGaps.length && !knowledgeError" class="panel empty-knowledge"><div class="empty-icon">✓</div><h2>No open knowledge gaps</h2><p>New low-confidence questions will appear here for review.</p></article>
          <div v-else class="knowledge-review-grid"><article v-for="gap in knowledgeGaps" :key="gap.question" class="panel gap-card"><div class="gap-card-heading"><div><span :class="['answer-badge', gap.status === 'resolved' ? 'grounded' : 'fallback']">{{ gap.status === 'resolved' ? '✓ Approved' : '! Open gap' }}</span><h3>{{ gap.question }}</h3></div><strong>{{ gap.occurrenceCount }}×</strong></div><textarea v-model="answerDrafts[gap.question]" rows="4" placeholder="Write the answer the assistant may use…"></textarea><div class="gap-card-actions"><small>Last seen {{ new Date(gap.lastSeenAt).toLocaleString() }}</small><button class="primary-button small" type="button" :disabled="!answerDrafts[gap.question]?.trim() || gap.status === 'resolved'" @click="resolveKnowledgeGap(gap)">{{ gap.status === 'resolved' ? 'Approved' : 'Approve answer' }}</button></div></article></div>
          <div class="section-toolbar diagnostics-heading"><div><p class="eyebrow">Explainability</p><h2>Retrieval diagnostics</h2><p>Recent answers with confidence and retrieval mode.</p></div></div>
          <article class="panel table-panel diagnostics-panel"><div class="table-heading diagnostics-row"><span>Question</span><span>Confidence</span><span>Mode</span><span>Grounded</span></div><div v-for="diagnostic in retrievalDiagnostics" :key="`${diagnostic.conversationId}-${diagnostic.createdAt}`" class="table-row diagnostics-row"><div><strong>{{ diagnostic.question }}</strong><small>{{ diagnostic.answer }}</small></div><span :class="['status-pill', diagnostic.confidenceBand === 'high' ? 'booked' : diagnostic.confidenceBand === 'medium' ? 'qualified' : 'new']">{{ Math.round(diagnostic.confidenceScore * 100) }}% · {{ diagnostic.confidenceBand }}</span><span>{{ diagnostic.retrieval?.mode ?? 'unknown' }}</span><span>{{ diagnostic.grounded ? 'Yes' : 'Fallback' }}</span></div><div v-if="!retrievalDiagnostics.length" class="diagnostics-empty">No retrieval diagnostics yet.</div></article>
        </div>

        <div v-else-if="view === 'actions'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Reliable handoff</p><h2>Actions & integrations</h2><p>Keep FrontDeskWise as the lead source of truth, then deliver contacts to the systems your team already uses.</p></div><span v-if="integrationLoading" class="conversation-status">Working…</span></div>
          <p v-if="integrationError" class="form-error">{{ integrationError }}</p>
          <p v-if="integrationMessage" class="saved-message">✓ {{ integrationMessage }}</p>
          <div class="agent-layout">
            <article class="panel form-panel">
              <div class="form-section"><h3>Connect a CRM</h3><p>Use a signed webhook for Zapier, Make, or an internal endpoint, or connect a HubSpot private-app token. Secrets stay server-side.</p><label>Provider<select v-model="integrationProvider"><option value="webhook">Webhook / automation tool</option><option value="hubspot">HubSpot</option></select></label><label>Display name<input v-model="integrationDisplayName" type="text" placeholder="Sales CRM" /></label><template v-if="integrationProvider === 'webhook'"><label>Webhook URL<input v-model="integrationWebhookUrl" type="url" placeholder="https://hooks.example.com/frontdeskwise" /></label><label>Signing secret <span class="optional">optional · never shown again</span><input v-model="integrationSigningSecret" type="password" placeholder="Secret stored server-side" /></label></template><label v-else>HubSpot private-app token <span class="optional">never shown again</span><input v-model="integrationAccessToken" type="password" placeholder="pat-na1-…" /></label><button class="primary-button" type="button" :disabled="integrationLoading || (integrationProvider === 'webhook' ? !integrationWebhookUrl.trim() : !integrationAccessToken.trim())" @click="connectIntegration">Save integration →</button></div>
              <div class="form-section"><h3>Delivery contract</h3><p>Every lead is saved first, then queued for delivery. Temporary failures retry with backoff; permanent failures stay visible for a manual retry.</p></div>
            </article>
            <article class="panel form-panel"><div class="form-section"><h3>Connected systems</h3><p v-if="!integrations.length">No CRM connected yet.</p><div v-for="integration in integrations" :key="integration.id" class="integration-card"><div class="setup-row"><strong>{{ integration.displayName }}</strong><span :class="['status-pill', integration.connectionStatus === 'active' ? 'booked' : integration.connectionStatus === 'error' ? 'new' : 'qualified']">{{ integration.connectionStatus }}</span></div><small>{{ integration.provider }} · {{ integration.sync.synced }}/{{ integration.sync.total }} leads synced</small><small v-if="integration.sync.pending">{{ integration.sync.pending }} pending delivery</small><small v-if="integration.sync.failed" class="form-error">{{ integration.sync.failed }} failed delivery</small><small v-if="integration.lastError" class="form-error">{{ integration.lastError }}</small><div class="toolbar-actions"><button class="outline-button small" type="button" :disabled="integrationLoading" @click="testIntegration(integration)">Test connection</button><button v-if="integration.sync.failed" class="text-button" type="button" :disabled="integrationLoading" @click="retryIntegration(integration)">Retry failed</button></div></div></div></article>
          </div>
        </div>

        <div v-else-if="view === 'analytics'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Live operating signals</p><h2>Analytics</h2><p>Real conversations, leads, bookings, and knowledge activity for {{ showAllBusinesses ? 'all businesses' : (businessName || 'this business') }}.</p></div><button class="outline-button small" type="button" @click="refreshWorkspaceSummary">Refresh data</button></div>
          <div class="metric-grid"><article class="metric-card blue-tint"><strong>{{ workspaceStats?.conversations ?? 0 }}</strong><span>Conversations</span><em>Recorded conversations</em></article><article class="metric-card green-tint"><strong>{{ workspaceStats?.leads ?? 0 }}</strong><span>Leads captured</span><em>Durable FrontDeskWise records</em></article><article class="metric-card orange-tint"><strong>{{ workspaceStats?.bookingClicks ?? 0 }}</strong><span>Booking actions</span><em>Visitor next steps</em></article><article class="metric-card purple-tint"><strong>{{ workspaceStats?.widgetLoads ?? 0 }}</strong><span>Widget loads</span><em>Verified public installs</em></article></div>
          <article class="panel chart-panel analytics-chart"><div class="panel-heading"><div><h2>Activity by day</h2><p>Last 30 days · live records</p></div></div><div v-if="workspaceStats?.trend?.length" class="live-chart" aria-label="Analytics activity by day"><div v-for="point in workspaceStats.trend" :key="point.label" class="live-chart-column"><div class="live-chart-bars"><span class="live-bar blue" :style="{ height: `${point.conversations / chartMax * 100}%` }"></span><span class="live-bar orange" :style="{ height: `${point.leads / chartMax * 100}%` }"></span></div><small>{{ point.label }}</small></div></div><div v-else class="diagnostics-empty">No activity recorded yet.</div></article>
          <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>Most common visitor questions</p></div></div><div v-if="workspaceStats?.topQuestions?.length" class="question-list"><div v-for="question in workspaceStats.topQuestions" :key="question.question"><span>{{ question.question }}</span><strong>{{ question.count }}</strong></div></div><div v-else class="diagnostics-empty">No visitor questions recorded yet.</div></article><article class="panel"><div class="panel-heading"><div><h2>Knowledge gaps</h2><p>Questions that need a stronger answer</p></div></div><div v-if="workspaceStats?.actions?.length" class="action-list"><div v-for="action in workspaceStats.actions" :key="action.question"><span class="action-check">!</span><span>{{ action.question }}</span><button type="button" @click="view = 'knowledge'">Review</button></div></div><div v-else class="diagnostics-empty">No open knowledge gaps.</div></article></div>
        </div>

        <div v-else-if="view === 'businesses'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One account · multiple businesses</p><h2>Businesses</h2><p>Manage every business under {{ activeOrganization?.name ?? 'your organization' }}.</p></div><button class="primary-button small" type="button" @click="openAddBusiness">+ Add business</button></div>
          <article class="panel table-panel"><div class="table-heading business-row"><span>Business</span><span>Website</span><span>Access</span><span>Actions</span></div><div v-if="!availableBusinesses.length" class="diagnostics-empty">No businesses yet. Add your first public website to begin.</div><div v-for="business in availableBusinesses" :key="business.id" class="table-row business-row"><div><strong>{{ business.name }}</strong><small>{{ business.role }} · {{ business.planKey }}</small></div><span>{{ business.websiteUrl || 'Website pending' }}</span><span><span :class="['status-pill', business.billingStatus === 'active' || business.billingStatus === 'trial' ? 'booked' : 'new']">{{ business.billingStatus }}</span></span><button class="outline-button small" type="button" @click="workspaceSelection = business.slug">Open →</button></div></article>
          <article class="panel aggregate-billing-note"><p class="eyebrow">Shared organization billing</p><h2>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h2><p>{{ availableBusinesses.length }} of {{ activeOrganization?.billing.plan.maxBusinesses ?? 1 }} business slots used. Add capacity from Billing when you are ready to grow.</p><button class="text-button" type="button" @click="view = 'billing'">View plan →</button></article>
        </div>

        <div v-else-if="view === 'settings'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Account controls</p><h2>Settings</h2><p>Identity, organization, and access details for this FrontDeskWise account.</p></div></div>
          <div class="settings-grid"><article class="panel settings-card"><p class="eyebrow">Signed-in account</p><h3>{{ authSnapshot?.user.name ?? 'FrontDeskWise user' }}</h3><p>{{ authSnapshot?.user.email ?? 'Not signed in' }}</p><small>Authentication is managed by Firebase. Password changes and Google sign-in are handled by the identity provider.</small><button v-if="authSnapshot" class="outline-button small" type="button" @click="signOut">Sign out</button></article><article class="panel settings-card"><p class="eyebrow">Organization</p><h3>{{ activeOrganization?.name ?? 'Your organization' }}</h3><p>{{ activeOrganization?.role ?? 'owner' }} · {{ availableBusinesses.length }} businesses</p><small>One organization owns the businesses, CRM connections, knowledge, and billing relationship.</small><button class="outline-button small" type="button" @click="view = 'businesses'">Manage businesses →</button></article><article class="panel settings-card"><p class="eyebrow">Billing access</p><h3>{{ activeOrganization?.billing.plan.displayName ?? 'Trial' }}</h3><p>{{ activeOrganization?.billing.status ?? 'trial' }} · {{ activeOrganization?.billing.access.allowed ? 'write access enabled' : 'read-only access' }}</p><small>Access changes only after the server receives the provider-confirmed billing state.</small><button class="outline-button small" type="button" @click="view = 'billing'">Open billing →</button></article></div>
          <article v-if="authSnapshot && ownershipVerification" class="panel verification-panel"><div class="panel-heading"><div><p class="eyebrow">Website ownership</p><h2>{{ ownershipVerification.status === 'verified' ? 'Ownership verified' : 'Verify before publishing' }}</h2><p>{{ ownershipVerification.status === 'verified' ? 'This business can publish its widget and receive production leads.' : 'Verify the website connected to this business before installing the live widget.' }}</p></div><span :class="['status-pill', ownershipVerification.status === 'verified' ? 'booked' : ownershipVerification.status === 'rejected' ? 'new' : 'qualified']">{{ ownershipVerification.status }}</span></div><div v-if="ownershipVerification.status !== 'verified'" class="verification-controls"><label>Method<select v-model="verificationMethod"><option value="meta_tag">Meta tag</option><option value="file">Verification file</option><option value="dns_txt">DNS TXT</option><option value="email">Email domain</option><option value="manual">Request admin review</option></select></label><button class="outline-button small" type="button" :disabled="verificationLoading" @click="requestOwnershipVerification">{{ verificationLoading ? 'Preparing…' : 'Start verification' }}</button><button v-if="verificationMethod !== 'email' && verificationMethod !== 'manual'" class="primary-button small" type="button" :disabled="verificationLoading" @click="checkOwnershipVerification">Check now</button></div><p v-if="verificationInstructions" class="verification-instructions">{{ verificationInstructions }}</p><code v-if="verificationToken" class="verification-token">{{ verificationToken }}</code><p v-if="verificationMessage" class="saved-message">✓ {{ verificationMessage }}</p><p v-if="verificationError" class="form-error">{{ verificationError }}</p></article>
        </div>

        <div v-else-if="view === 'billing'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">One organization · every business</p><h2>Billing & plan</h2><p>Keep one subscription relationship as you add businesses to {{ activeOrganization?.name ?? 'your organization' }}.</p></div><div class="toolbar-actions"><span v-if="billingLoading" class="conversation-status">Working…</span><button v-if="billingSnapshot?.billing.providerCustomerId" class="outline-button small" type="button" @click="openBillingPortal">Manage billing ↗</button></div></div>
          <p v-if="billingError" class="form-error">{{ billingError }}</p>
          <p v-if="billingMessage" class="saved-message">✓ {{ billingMessage }}</p>
          <template v-if="billingSnapshot">
            <div v-if="billingSnapshot.billing.status === 'grace'" class="billing-alert warning">Payment needs attention. Your organization remains available until {{ formatBillingDate(billingSnapshot.billing.graceEndAt) }}.</div>
            <div v-else-if="billingSnapshot.billing.status === 'cancelled' || billingSnapshot.billing.status === 'paused'" class="billing-alert danger">Billing is {{ billingSnapshot.billing.status }}. Existing data remains visible, but new paid actions and businesses are paused until billing is restored.</div>
            <div class="billing-summary-grid">
              <article class="panel billing-status-card"><p class="eyebrow">Current status</p><div class="billing-status-line"><strong>{{ billingSnapshot.billing.plan.displayName }}</strong><span :class="['status-pill', billingSnapshot.billing.status === 'active' ? 'booked' : billingSnapshot.billing.status === 'trial' ? 'qualified' : 'new']">{{ billingSnapshot.billing.status }}</span></div><p v-if="billingSnapshot.billing.status === 'trial'">Trial ends {{ formatBillingDate(billingSnapshot.billing.trialEndAt) }}</p><p v-else-if="billingSnapshot.billing.currentPeriodEndAt">Current period ends {{ formatBillingDate(billingSnapshot.billing.currentPeriodEndAt) }}</p><p v-else>{{ billingSnapshot.billing.mode === 'sandbox' ? 'Sandbox billing · no charge' : 'Choose a plan to activate billing.' }}</p><small v-if="billingSnapshot.billing.override">{{ billingSnapshot.billing.override.reason }}</small></article>
              <article class="panel billing-status-card"><p class="eyebrow">Business capacity</p><strong class="billing-big-number">{{ activeOrganization?.businesses.length ?? 0 }} <span>/ {{ billingSnapshot.billing.plan.maxBusinesses }}</span></strong><p>Businesses in this organization</p><div class="metric-progress"><span :style="{ width: `${Math.min(100, ((activeOrganization?.businesses.length ?? 0) / billingSnapshot.billing.plan.maxBusinesses) * 100)}%` }"></span></div></article>
              <article class="panel billing-status-card"><p class="eyebrow">Last 30 days</p><div class="billing-usage-stats"><span><strong>{{ billingSnapshot.usageLast30Days.conversations }}</strong> conversations</span><span><strong>{{ billingSnapshot.usageLast30Days.leads }}</strong> leads</span><span><strong>{{ billingSnapshot.usageLast30Days.bookings }}</strong> bookings</span></div></article>
            </div>
            <div class="section-toolbar billing-plans-heading"><div><p class="eyebrow">Flexible plans</p><h2>Choose the right operating level</h2><p>Pricing is organization-level. Client-specific founding terms are represented as a plan override, not a special code path.</p></div></div>
            <div class="billing-plan-grid"><article v-for="plan in billingSnapshot.plans" :key="plan.key" :class="['panel', 'billing-plan-card', { selected: plan.key === billingSnapshot.billing.planKey }]" ><div class="billing-plan-top"><h3>{{ plan.displayName }}</h3><span v-if="plan.key === billingSnapshot.billing.planKey" class="status-pill booked">Current</span></div><strong class="billing-price">{{ formatPlanPrice(plan) }}<small v-if="plan.amountCents !== null">/mo</small></strong><p>{{ plan.description }}</p><div class="billing-plan-meta">Up to {{ plan.maxBusinesses }} {{ plan.maxBusinesses === 1 ? 'business' : 'businesses' }}</div><button v-if="plan.key !== billingSnapshot.billing.planKey" class="primary-button small" type="button" :disabled="billingLoading || !billingSnapshot.stripeConfigured || !plan.checkoutReady" @click="startCheckout(plan)">{{ !billingSnapshot.stripeConfigured ? 'Configure Stripe' : plan.checkoutReady ? 'Start subscription →' : 'Connect Stripe price' }}</button><span v-else class="saved-message">✓ Active plan</span></article></div>
            <p v-if="!billingSnapshot.stripeConfigured" class="billing-note">Checkout is intentionally disabled until the API has STRIPE_SECRET_KEY and the FrontDeskWise monthly price IDs configured. The plan catalog remains visible for review.</p>
          </template>
          <article v-else class="panel empty-view"><div class="empty-icon">$</div><h2>Billing is loading</h2><p>Sign in to view your organization plan and trial.</p></article>
        </div>

        <div v-else-if="view === 'admin' && isSuperAdmin" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Internal operations</p><h2>Super-admin control plane</h2><p>Monitor organizations, pilot status, business count, usage outcomes, and account health.</p></div><div class="toolbar-actions"><span v-if="adminEmailTestMessage" class="saved-message">✓ {{ adminEmailTestMessage }}</span><button class="outline-button small" type="button" :disabled="adminEmailTestLoading" @click="testAdminEmail">{{ adminEmailTestLoading ? 'Sending…' : 'Test SES email' }}</button><span v-if="adminLoading" class="conversation-status">Working…</span></div></div>
          <p v-if="adminError" class="form-error">{{ adminError }}</p>
          <article class="panel table-panel admin-table-panel"><div class="table-heading admin-row"><span>Organization</span><span>Plan / status</span><span>Businesses</span><span>Outcomes</span><span>Actions</span></div><div v-if="!adminOrganizations.length" class="diagnostics-empty">No organizations found.</div><div v-for="organization in adminOrganizations" :key="organization.id" class="table-row admin-row"><div><strong>{{ organization.name }}</strong><small>{{ organization.ownerEmail ?? 'No owner email' }}</small></div><div><strong>{{ organization.planName }}</strong><small>{{ organization.status }} · {{ organization.mode }}</small></div><span>{{ organization.businessCount }}</span><span><strong>{{ organization.leadCount }}</strong> leads · {{ organization.conversationCount }} conversations</span><div class="admin-actions"><button class="outline-button small" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'trial')">30-day trial</button><button class="text-button" type="button" :disabled="adminLoading" @click="adminOrganizationAction(organization, 'suspend')">Suspend</button></div></div></article>
          <article class="panel admin-demo-operations">
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
        </div>

        <div v-else class="view-content empty-view"><div class="empty-icon">ϟ</div><p class="eyebrow">{{ pageTitle }}</p><h2>This surface is ready for the first real business.</h2><p>We’ll connect this view to tenant-scoped data, grounded answers, and real actions next.</p><button class="primary-button small" type="button" @click="view = 'overview'">Back to overview</button></div>
      </section>
    </section>

    <div v-if="addBusinessOpen" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="add-business-title" @click.self="addBusinessOpen = false">
      <form class="auth-card" @submit.prevent="createBusiness">
        <button class="auth-close" type="button" aria-label="Close" @click="addBusinessOpen = false">×</button>
        <p class="eyebrow">{{ activeOrganization?.name ?? 'Your organization' }}</p>
        <h2 id="add-business-title">Add another business</h2>
        <p class="auth-copy">Paste a public website URL. FrontDeskWise will crawl it and add the new business to this organization, subject to your plan capacity.</p>
        <label>Business website<input v-model="addBusinessUrl" type="url" required placeholder="https://anotherbusiness.com" /></label>
        <p v-if="addBusinessError" class="form-error">{{ addBusinessError }}</p>
        <p v-if="addBusinessMessage" class="saved-message">✓ {{ addBusinessMessage }}</p>
        <button class="primary-button auth-submit" type="submit" :disabled="addBusinessLoading">{{ addBusinessLoading ? 'Crawling website…' : 'Add business →' }}</button>
      </form>
    </div>

    <div v-if="authModalOpen" class="auth-overlay" role="dialog" aria-modal="true" aria-labelledby="auth-title" @click.self="authModalOpen = false">
      <form class="auth-card" @submit.prevent="submitAuth">
        <button class="auth-close" type="button" aria-label="Close" @click="authModalOpen = false">×</button>
        <p class="eyebrow">{{ authMode === 'signup' ? 'Save your AI front desk' : 'Welcome back' }}</p>
        <h2 id="auth-title">{{ authMode === 'signup' ? 'Create your FrontDeskWise account' : 'Sign in to FrontDeskWise' }}</h2>
        <p class="auth-copy">{{ authMode === 'signup' ? 'Your demo stays attached to your new organization.' : 'Pick up where you left off across all your businesses.' }}</p>
        <label>Email<input v-model="authEmail" type="email" autocomplete="email" required placeholder="you@business.com" /></label>
        <label>Password<input v-model="authPassword" type="password" autocomplete="new-password" minlength="6" required placeholder="At least 6 characters" /></label>
        <label v-if="authMode === 'signup'">Organization name <span class="optional">optional</span><input v-model="authOrganizationName" type="text" placeholder="Dave's Businesses" /></label>
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

