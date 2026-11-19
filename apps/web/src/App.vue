<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
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

type View = "home" | "overview" | "conversations" | "leads" | "knowledge" | "actions" | "agent";

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

const view = ref<View>("home");
const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
function apiUrl(path: string): string {
  return `${apiOrigin}${path}`;
}

const websiteUrl = ref("");
const isGenerating = ref(false);
const generationError = ref("");
const demoSlug = ref("british-swim-school-tampa-bay");
const demoAccessToken = ref(typeof window !== "undefined" ? window.localStorage.getItem("frontdeskwiseDemoAccessToken") ?? "" : "");
const firebaseToken = ref("");
const authSnapshot = ref<AuthSnapshot | null>(null);
const authModalOpen = ref(false);
const authMode = ref<"signin" | "signup">("signin");
const authEmail = ref("");
const authPassword = ref("");
const authOrganizationName = ref("");
const authError = ref("");
const authLoading = ref(false);
const businessName = ref("British Swim School");
const assistantName = ref("Swim Assistant");
const welcomeMessage = ref(
  "Hi! 👋 I’m your Swim Assistant. I can answer questions, help you find the right swim program, check locations and schedules, and get you started with enrollment.",
);
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
const integrations = ref<Integration[]>([]);
const integrationProvider = ref<"webhook" | "hubspot">("webhook");
const integrationDisplayName = ref("CRM webhook");
const integrationWebhookUrl = ref("");
const integrationSigningSecret = ref("");
const integrationAccessToken = ref("");
const integrationLoading = ref(false);
const integrationError = ref("");
const integrationMessage = ref("");

const leads = ref<Lead[]>([
  { id: "demo-1", name: "Maya Rodriguez", intent: "Toddler lessons", status: "New", time: "8 min ago" },
  { id: "demo-2", name: "James Wilson", intent: "Birthday party", status: "Qualified", time: "34 min ago" },
  { id: "demo-3", name: "Priya Shah", intent: "Adult swim assessment", status: "Booked", time: "1 hr ago" },
  { id: "demo-4", name: "Noah Bennett", intent: "Summer registration", status: "New", time: "2 hrs ago" },
]);

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "overview", label: "Overview", icon: "⌂" },
  { id: "conversations", label: "Conversations", icon: "◌" },
  { id: "leads", label: "Leads", icon: "♧" },
  { id: "knowledge", label: "Knowledge", icon: "▤" },
  { id: "actions", label: "Actions & Integrations", icon: "ϟ" },
  { id: "agent", label: "Agent & Widget", icon: "✦" },
];

const pageTitle = computed(() => {
  if (view.value === "home") return "Build your AI front desk";
  return navItems.find((item) => item.id === view.value)?.label ?? "Overview";
});

const activeLeads = computed(() => leads.value.filter((lead) => lead.status !== "Booked").length);
const activeOrganization = computed(() => authSnapshot.value?.organizations.find((organization) => organization.id === authSnapshot.value?.activeOrganizationId) ?? authSnapshot.value?.organizations[0] ?? null);
const availableBusinesses = computed(() => activeOrganization.value?.businesses ?? []);

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

async function loadBusinessWorkspace(slug: string) {
  const response = await fetch(apiUrl(`/api/v1/demo/${slug}`), { headers: ownerHeaders() });
  if (!response.ok) return;
  const payload = await response.json() as {
    business?: { name?: string; websiteUrl?: string };
    agent?: { assistantName?: string; welcomeMessage?: string; widgetColor?: string; collectLeads?: boolean; showBookingAction?: boolean };
  };
  businessName.value = payload.business?.name ?? businessName.value;
  websiteUrl.value = payload.business?.websiteUrl ?? websiteUrl.value;
  assistantName.value = payload.agent?.assistantName ?? assistantName.value;
  welcomeMessage.value = payload.agent?.welcomeMessage ?? welcomeMessage.value;
  widgetColor.value = payload.agent?.widgetColor ?? widgetColor.value;
  showLeadCapture.value = payload.agent?.collectLeads ?? showLeadCapture.value;
  showBookingAction.value = payload.agent?.showBookingAction ?? showBookingAction.value;
  conversationId.value = "";
  leads.value = [];
  await loadLeads();
}

async function selectBusiness(slug: string) {
  if (!slug) return;
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
}

async function generateDemo() {
  if (!websiteUrl.value.trim()) return;
  isGenerating.value = true;
  generationError.value = "";
  try {
    const response = await fetch(apiUrl("/api/v1/demos"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: websiteUrl.value }),
    });
    const payload = await response.json() as { error?: string; slug?: string; access?: { accessToken?: string }; business?: { name?: string; websiteUrl?: string }; agent?: { assistantName?: string; welcomeMessage?: string } };
    if (!response.ok) throw new Error(payload.error ?? "We could not crawl that website yet.");
    if (payload.access?.accessToken) {
      demoAccessToken.value = payload.access.accessToken;
      window.localStorage.setItem("frontdeskwiseDemoAccessToken", payload.access.accessToken);
    }
    demoSlug.value = payload.slug ?? demoSlug.value;
    businessName.value = payload.business?.name ?? businessName.value;
    websiteUrl.value = payload.business?.websiteUrl ?? websiteUrl.value;
    assistantName.value = payload.agent?.assistantName ?? assistantName.value;
    welcomeMessage.value = payload.agent?.welcomeMessage ?? welcomeMessage.value;
    view.value = "overview";
  } catch (error) {
    generationError.value = error instanceof Error ? error.message : "We could not create that demo yet.";
  } finally {
    isGenerating.value = false;
  }
}

async function loadKnowledge() {
  if (!demoAccessToken.value || knowledgeLoading.value) return;
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
  if (!demoAccessToken.value) return;
  const response = await fetch(apiUrl(`/api/v1/demo/${demoSlug.value}/widget/install`), { headers: ownerHeaders() });
  if (!response.ok) return;
  widgetInstall.value = await response.json() as WidgetInstall;
}

async function loadLeads() {
  if (!demoAccessToken.value) return;
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
  if (!demoAccessToken.value) return;
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
  void loadLeads();
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
  if (nextView === "knowledge") void loadKnowledge();
  if (nextView === "agent") void loadWidgetInstall();
  if (nextView === "leads") void loadLeads();
  if (nextView === "actions") void loadIntegrations();
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
  if (typeof window !== "undefined") {
    observeFirebaseUser((user) => {
      void (async () => {
        firebaseToken.value = user ? await user.getIdToken() : "";
        authSnapshot.value = user ? await currentAuthSnapshot() : null;
        if (authSnapshot.value) await syncAuthenticatedBusiness(authSnapshot.value);
      })();
    });
  }
});

function openHome() {
  view.value = "home";
}
</script>

<template>
  <main class="app-shell">
    <section v-if="view === 'home'" class="marketing-shell">
      <header class="marketing-nav">
        <button class="brand-mark" type="button" @click="openHome">
          <span class="brand-orb">✦</span>
          <span>FrontDesk<span>Wise</span></span>
        </button>
        <div class="nav-actions">
          <button class="text-button" type="button" @click="view = 'overview'">View demo dashboard</button>
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
          <p v-if="generationError" class="form-error">{{ generationError }}</p>
          <div class="trust-row"><span>✓ No credit card</span><span>✓ Demo in under 5 minutes</span><span>✓ Built from your website</span></div>
        </div>

        <div class="hero-visual">
          <div class="floating-label label-one">42 leads captured</div>
          <div class="floating-label label-two">11 knowledge gaps found</div>
          <div class="demo-card">
            <div class="demo-card-top"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span class="demo-url">yourbusiness.com</span></div>
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

      <section class="proof-strip">
        <span>One simple loop:</span><strong>Question</strong><i>→</i><strong>Qualification</strong><i>→</i><strong>Action</strong><i>→</i><strong>Lead</strong><i>→</i><strong>Booking</strong>
      </section>
      <section class="benefit-grid">
        <article><span class="benefit-icon blue">◎</span><h3>Grounded answers</h3><p>It answers from approved business information and knows when to say, “I’m not sure.”</p></article>
        <article><span class="benefit-icon orange">↗</span><h3>Revenue outcomes</h3><p>Every conversation can become a lead, registration, appointment, or human handoff.</p></article>
        <article><span class="benefit-icon green">✦</span><h3>Ready in minutes</h3><p>Paste a URL, review the generated agent, and share a personalized demo before you buy.</p></article>
      </section>
    </section>

    <section v-else class="product-shell">
      <aside class="sidebar">
        <button class="sidebar-brand" type="button" @click="openHome"><span class="brand-orb">✦</span><span>FrontDesk<span>Wise</span></span></button>
        <div class="workspace-switcher"><span class="workspace-avatar">{{ businessName.charAt(0).toUpperCase() }}</span><span v-if="availableBusinesses.length" class="workspace-select-wrap"><select v-model="demoSlug" aria-label="Switch business" @change="selectBusiness(demoSlug)"><option v-for="business in availableBusinesses" :key="business.id" :value="business.slug">{{ business.name }}</option></select><small>{{ activeOrganization?.name ?? 'Organization' }}</small></span><span v-else><strong>{{ businessName }}</strong><small>Tampa Bay · Demo</small></span><span class="chevron">⌄</span></div>
        <nav class="sidebar-nav">
          <button v-for="item in navItems" :key="item.id" type="button" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><b v-if="item.id === 'conversations'">24</b></button>
        </nav>
        <div class="sidebar-bottom"><div class="setup-card"><div class="setup-row"><span>Setup progress</span><strong>85%</strong></div><div class="progress-bar"><span></span></div><small>3 of 4 steps complete</small></div><button class="sidebar-link" type="button" @click="openHome">← Back to landing page</button></div>
      </aside>

      <section class="content-area">
        <header class="content-header"><div><p class="breadcrumb">{{ businessName }} / FrontDeskWise</p><h1>{{ pageTitle }}</h1></div><div class="header-actions"><button class="outline-button" type="button" @click="view = 'agent'">Preview on website ↗</button><button class="primary-button small" type="button" @click="view = 'agent'">Edit agent</button><button v-if="authSnapshot" class="text-button" type="button" @click="signOut">Sign out</button><span class="notification">♧<i></i></span><span class="profile-avatar">{{ authSnapshot ? authSnapshot.user.name.charAt(0).toUpperCase() : 'SP' }}</span></div></header>

        <div v-if="view === 'overview'" class="view-content">
          <div class="metric-grid">
            <article class="metric-card blue-tint"><span class="metric-icon blue">♧</span><strong>42</strong><span>Leads captured</span><em>↗ +24%</em></article>
            <article class="metric-card green-tint"><span class="metric-icon green">▣</span><strong>17</strong><span>Booking clicks</span><em>↗ +31%</em></article>
            <article class="metric-card orange-tint"><span class="metric-icon orange">?</span><strong>11</strong><span>Unanswered questions</span><em class="negative">↗ +2</em></article>
            <article class="metric-card purple-tint"><span class="metric-icon purple">▱</span><strong>82%</strong><span>AI readiness</span><div class="metric-progress"><span></span></div></article>
          </div>
          <div class="dashboard-grid">
            <article class="panel chart-panel"><div class="panel-heading"><div><h2>Conversations & leads</h2><p>Last 30 days</p></div><div class="legend"><span><i class="blue-dot"></i> Conversations</span><span><i class="orange-dot"></i> Leads</span></div></div><div class="chart"><svg viewBox="0 0 640 190" preserveAspectRatio="none" aria-label="Conversations and leads trend"><path class="chart-grid" d="M0 25H640 M0 75H640 M0 125H640 M0 175H640"/><path class="area-blue" d="M0 150 C50 135 65 142 90 125 S145 148 180 105 S230 124 260 96 S310 116 345 80 S400 100 435 73 S485 97 520 56 S580 75 640 32 L640 190 L0 190Z"/><path class="line-blue" d="M0 150 C50 135 65 142 90 125 S145 148 180 105 S230 124 260 96 S310 116 345 80 S400 100 435 73 S485 97 520 56 S580 75 640 32"/><path class="line-orange" d="M0 175 C50 168 70 172 100 155 S145 170 185 148 S235 162 265 143 S320 158 350 130 S395 146 430 118 S480 139 520 105 S575 122 640 92"/></svg><div class="chart-labels"><span>Mar 1</span><span>Mar 9</span><span>Mar 17</span><span>Mar 25</span><span>Mar 29</span></div></div></article>
            <article class="panel readiness-panel"><div class="panel-heading"><div><h2>AI readiness</h2><p>Based on your business knowledge</p></div><strong class="readiness-score">82%</strong></div><div class="readiness-ring"><div><strong>82</strong><span>/100</span></div></div><div class="readiness-list"><div><span class="check">✓</span> Website coverage <strong>91%</strong></div><div><span class="check">✓</span> Services <strong>96%</strong></div><div><span class="warning">!</span> Pricing coverage <strong>72%</strong></div><div><span class="warning">!</span> Policies <strong>64%</strong></div></div></article>
          </div>
          <div class="dashboard-grid bottom-grid"><article class="panel"><div class="panel-heading"><div><h2>Top questions</h2><p>What visitors are asking</p></div><button class="text-button" type="button" @click="view = 'conversations'">See all →</button></div><div class="question-list"><div><span>What age can my child start swim lessons?</span><strong>18</strong></div><div><span>How do I register for classes?</span><strong>14</strong></div><div><span>Do you offer a free trial or assessment?</span><strong>9</strong></div><div><span>What locations do you have?</span><strong>7</strong></div><div><span>What is your cancellation policy?</span><strong>6</strong></div></div></article><article class="panel"><div class="panel-heading"><div><h2>Recommended actions</h2><p>Turn gaps into better conversions</p></div></div><div class="action-list"><div><span class="action-check">✓</span><span>Add cancellation policy details</span><button type="button" @click="view = 'knowledge'">Add answer</button></div><div><span class="action-check">✓</span><span>Clarify birthday party options</span><button type="button" @click="view = 'knowledge'">Add answer</button></div><div><span class="action-check done">✓</span><span>Update swim class age requirements</span><button type="button" @click="view = 'knowledge'">View</button></div><div><span class="action-check done">✓</span><span>Add summer program information</span><button type="button" @click="view = 'knowledge'">View</button></div></div></article></div>
        </div>

        <div v-else-if="view === 'conversations'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Grounded answers</p><h2>Test a conversation</h2><p>Ask what a visitor would ask and verify the source before sharing the demo.</p></div><span v-if="conversationId" class="conversation-status">Conversation active</span></div><div class="conversation-layout"><article class="panel conversation-panel"><div class="conversation-intro"><span class="mini-orb">✦</span><div><strong>{{ assistantName }}</strong><small>Answers from {{ businessName }} knowledge</small></div></div><div v-if="testAnswer" class="answer-card"><div class="answer-meta"><span :class="['answer-badge', answerGrounded ? 'grounded' : 'fallback']">{{ answerGrounded ? '✓ Grounded in source' : '! Needs an answer' }}</span><span class="answer-diagnostic">{{ Math.round(answerConfidence * 100) }}% · {{ answerConfidenceBand }}<span v-if="answerRetrievalMode"> · {{ answerRetrievalMode }}</span></span><a v-if="answerSource" :href="answerSource" target="_blank" rel="noreferrer">View source ↗</a></div><p>{{ testAnswer }}</p></div><div v-else class="conversation-empty">Ask a question to see the agent’s answer and citation.</div><form class="question-form" @submit.prevent="askQuestion"><input v-model="testQuestion" type="text" placeholder="e.g. What age can my child start?" aria-label="Test question" /><button class="primary-button small" type="submit" :disabled="isAsking">{{ isAsking ? 'Checking…' : 'Ask agent' }}</button></form></article><article class="panel lead-capture-panel"><div class="panel-heading"><div><h2>Capture the next step</h2><p>Send a contact to the owner dashboard.</p></div></div><label>Name<input v-model="leadName" type="text" placeholder="Jamie Rodriguez" /></label><label>Email<input v-model="leadEmail" type="email" placeholder="jamie@example.com" /></label><label>Phone <span class="optional">optional</span><input v-model="leadPhone" type="tel" placeholder="(555) 010-2026" /></label><label>Intent <span class="optional">optional</span><input v-model="leadIntent" type="text" placeholder="Toddler lessons" /></label><button class="primary-button" type="button" :disabled="!leadEmail && !leadPhone" @click="captureLead">Capture lead →</button><span v-if="leadSavedMessage" class="saved-message">✓ {{ leadSavedMessage }}</span></article></div></div>

        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>People FrontDeskWise helped move closer to a booking.</p></div><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div><div class="panel table-panel"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-if="!leads.length" class="diagnostics-empty">No leads captured yet.</div><div v-for="lead in leads" :key="lead.id" class="table-row"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0) }}</span><strong>{{ lead.name }}</strong></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></div></div></div>

        <div v-else-if="view === 'agent'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Make it yours</p><h2>Agent & widget</h2><p>Customize the demo, then publish it to a real business website.</p></div><div class="toolbar-actions"><span v-if="savedMessage" class="saved-message">✓ {{ savedMessage }}</span><button class="outline-button" type="button" @click="view = 'overview'">Test conversation</button><button class="primary-button small" type="button" @click="saveAgent">{{ authSnapshot ? 'Save & publish' : 'Create account to publish' }}</button></div></div><div class="agent-layout"><article class="panel form-panel"><div class="form-section"><h3>Agent identity</h3><label>Assistant name<input v-model="assistantName" type="text" /></label><label>Welcome message<textarea v-model="welcomeMessage" rows="5"></textarea></label><label>Widget color<div class="color-row"><button v-for="color in ['#0d6efd','#18a999','#7447d9','#f27b35','#112c64']" :key="color" type="button" :class="['color-swatch', { selected: widgetColor === color }]" :style="{ background: color }" @click="widgetColor = color"></button></div></label></div><div class="form-section"><h3>Lead capture</h3><label class="toggle-row"><span>Collect lead information</span><input v-model="showLeadCapture" type="checkbox" /></label><label class="toggle-row"><span>Show booking action button</span><input v-model="showBookingAction" type="checkbox" /></label><label class="toggle-row"><span>Offer human handoff when uncertain</span><input type="checkbox" checked /></label></div></article><article class="panel live-preview"><div class="preview-browser"><div class="preview-browser-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>https://britishswimschool.com/tampa-bay/</span></div><div class="preview-site"><div class="preview-site-nav"><strong>BRITISH SWIM SCHOOL</strong><span>Programs　Locations　FAQs　About</span><button>Enroll now</button></div><div class="preview-site-hero"><div><h2>Swim lessons<br />for all ages</h2><p>Building safer, stronger, more confident swimmers.</p><button>Find a location →</button></div><div class="fake-swimmer">◉</div></div><div class="preview-chat" :style="{ '--accent': widgetColor }"><div class="chat-header"><span class="mini-orb">✦</span><span>{{ assistantName }}</span><span class="online-dot"></span></div><div class="chat-bubble">{{ welcomeMessage }}</div><div class="suggested-question">What swim programs do you offer? <span>›</span></div><div class="suggested-question">How do I enroll my child? <span>›</span></div><button v-if="showLeadCapture" class="chat-cta" type="button">Get started / Request information</button><div class="chat-input">Type your question… <span>➤</span></div></div></div></div></article></div></div>

        <div v-else-if="view === 'knowledge'" class="view-content">
          <div class="section-toolbar"><div><p class="eyebrow">Knowledge review</p><h2>Close the answer gaps</h2><p>Approve safe answers for questions the front desk could not ground confidently.</p></div><button class="outline-button small" type="button" @click="loadKnowledge">{{ knowledgeLoading ? 'Refreshing…' : 'Refresh' }}</button></div>
          <p v-if="knowledgeError" class="form-error">{{ knowledgeError }}</p>
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

        <div v-else class="view-content empty-view"><div class="empty-icon">ϟ</div><p class="eyebrow">{{ pageTitle }}</p><h2>This surface is ready for the first real business.</h2><p>We’ll connect this view to tenant-scoped data, grounded answers, and real actions next.</p><button class="primary-button small" type="button" @click="view = 'overview'">Back to overview</button></div>
      </section>
    </section>

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

