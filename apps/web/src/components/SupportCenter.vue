<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Headset,
  MessageCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Ticket,
  Wrench,
} from "@lucide/vue";

export type SupportCaseCategory = "general" | "installation" | "knowledge" | "actions" | "integration" | "billing" | "verification" | "widget" | "account";
export type SupportCaseStatus = "open" | "in_progress" | "resolved";

export interface SupportCase {
  id: string;
  businessId: string;
  businessName: string;
  websiteUrl: string;
  requesterName: string;
  requesterEmail: string;
  subject: string;
  category: SupportCaseCategory;
  provider: string | null;
  connectionId: string | null;
  sourcePage: string | null;
  sourceUrl: string | null;
  severity: "normal" | "urgent";
  description: string;
  diagnostics: Record<string, unknown>;
  correlationId: string;
  assignedUserId: string | null;
  assignedUserName: string | null;
  status: SupportCaseStatus;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  events: Array<{ id: string; eventType: string; actorName: string | null; body: string | null; createdAt: string }>;
}

export interface SupportContext {
  diagnostics: Record<string, unknown>;
  systemStatus: Record<string, string>;
}

const props = withDefaults(defineProps<{
  businessName: string;
  websiteUrl: string;
  authReady: boolean;
  publicDemoMode: boolean;
  authUserName: string;
  authUserEmail: string;
  loading: boolean;
  error: string;
  context: SupportContext | null;
  cases: SupportCase[];
  submitting: boolean;
  submitError: string;
  submitMessage: string;
  initialCategory?: SupportCaseCategory;
  initialProvider?: string;
  initialConnectionId?: string;
  initialPage?: string;
  openReportRequest?: number;
}>(), {
  initialCategory: "general",
  initialProvider: "",
  initialConnectionId: "",
  initialPage: "Support",
  openReportRequest: 0,
});

const emit = defineEmits<{
  (event: "refresh"): void;
  (event: "require-auth"): void;
  (event: "submit-case", payload: {
    subject: string;
    category: SupportCaseCategory;
    provider: string;
    connectionId: string;
    description: string;
    severity: "normal" | "urgent";
    sourcePage: string;
    sourceUrl: string;
    diagnostics: Record<string, unknown>;
  }): void;
  (event: "navigate", target: "install" | "knowledge" | "connections" | "actions" | "billing" | "verification"): void;
}>();

const search = ref("");
const reportOpen = ref(false);
const selectedCase = ref<SupportCase | null>(null);
const assistantQuestion = ref("");
const assistantAnswer = ref("");
const form = reactive({
  subject: "",
  category: props.initialCategory,
  provider: props.initialProvider,
  connectionId: props.initialConnectionId,
  description: "",
  severity: "normal" as "normal" | "urgent",
});

const articles = [
  { id: "knowledge", title: "How to refresh knowledge", description: "Understand crawl states, failed pages, and when to rebuild the index.", target: "knowledge" as const, icon: BookOpen },
  { id: "integrations", title: "How to connect HubSpot", description: "Connect a CRM, test the connection, and interpret sync failures.", target: "connections" as const, icon: Wrench },
  { id: "widget", title: "Why is my widget offline?", description: "Check verification, installation, publishing, and live widget detection.", target: "install" as const, icon: CircleHelp },
  { id: "actions", title: "When an action delivery fails", description: "Retry a delivery and see the provider error without hunting through logs.", target: "actions" as const, icon: Ticket },
];

const filteredCases = computed(() => {
  const needle = search.value.trim().toLowerCase();
  if (!needle) return props.cases;
  return props.cases.filter((item) => [item.subject, item.description, item.category, item.provider, item.correlationId].some((value) => value?.toLowerCase().includes(needle)));
});

const diagnostics = computed(() => props.context?.diagnostics ?? {});
const systemStatus = computed(() => props.context?.systemStatus ?? {});
const diagnosticsRows = computed(() => [
  { label: "Business", value: String(diagnostics.value.business ?? (props.businessName || "—")) },
  { label: "Page", value: String(diagnostics.value.page ?? props.initialPage) },
  { label: "Source", value: String(diagnostics.value.source ?? (props.websiteUrl || "—")) },
  { label: "Last refresh", value: diagnostics.value.lastRefresh ? new Date(String(diagnostics.value.lastRefresh)).toLocaleString() : "Not available" },
  { label: "Crawler status", value: formatLabel(String(diagnostics.value.crawlerStatus ?? "unknown")) },
  { label: "Browser", value: typeof navigator === "undefined" ? "Unknown" : navigator.userAgent },
  { label: "Timestamp", value: new Date().toLocaleString() },
]);

function formatLabel(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusLabel(status: SupportCaseStatus): string {
  return status === "in_progress" ? "In progress" : status === "resolved" ? "Resolved" : "Open";
}

function statusClass(status: SupportCaseStatus): string {
  return status === "resolved" ? "booked" : status === "in_progress" ? "qualified" : "new";
}

function openReport(category: SupportCaseCategory = form.category): void {
  form.category = category;
  if (!form.subject) form.subject = category === "integration" && form.provider ? `${formatLabel(form.provider)} connection needs attention` : `Help with ${formatLabel(category)}`;
  reportOpen.value = true;
}

function submitCase(): void {
  if (!form.subject.trim() || !form.description.trim()) return;
  emit("submit-case", {
    subject: form.subject.trim(),
    category: form.category,
    provider: form.provider.trim(),
    connectionId: form.connectionId.trim(),
    description: form.description.trim(),
    severity: form.severity,
    sourcePage: props.initialPage,
    sourceUrl: typeof window === "undefined" ? "" : window.location.href,
    diagnostics: {
      ...diagnostics.value,
      browser: typeof navigator === "undefined" ? null : navigator.userAgent,
      timestamp: new Date().toISOString(),
    },
  });
}

function askAssistant(): void {
  const question = assistantQuestion.value.trim().toLowerCase();
  if (!question) return;
  if (question.includes("widget") || question.includes("live") || question.includes("offline")) {
    assistantAnswer.value = systemStatus.value.widget === "not_detected"
      ? "Your domain is verified, but the widget has not been detected on your website yet. Open installation to check the snippet and run a live check."
      : "Your widget has been detected. If it still looks offline, open installation and run the live check so we can attach the result to a support case.";
    return;
  }
  if (question.includes("hubspot") || question.includes("integration") || question.includes("crm")) {
    assistantAnswer.value = "Open Integrations to test the connection and inspect the last provider response. If it fails again, Report a problem will include the provider and connection context automatically.";
    return;
  }
  if (question.includes("knowledge") || question.includes("refresh") || question.includes("crawl")) {
    assistantAnswer.value = diagnostics.value.crawlerStatus === "render_failed"
      ? "A knowledge source needs attention. Open Knowledge to review the failed source, then refresh it or send us the attached diagnostics."
      : "Open Knowledge to refresh your website sources or review the latest answer gaps.";
    return;
  }
  assistantAnswer.value = "I can help with installation, knowledge, actions, integrations, billing, and verification. Try one of those terms, or report a problem with the current context attached.";
}

function startCase(caseItem: SupportCase): void {
  selectedCase.value = selectedCase.value?.id === caseItem.id ? null : caseItem;
}

watch(() => props.openReportRequest, (next, previous) => {
  if (next && next !== previous) openReport();
}, { immediate: true });
</script>

<template>
  <div class="view-content support-workspace">
    <div class="support-hero">
      <div>
        <p class="eyebrow">Support / Help</p>
        <h2>How can we help?</h2>
        <p>Find a quick answer, ask FrontDeskWise, or open a case with the technical context already attached.</p>
      </div>
      <div class="support-hero-actions">
        <button class="outline-button small" type="button" :disabled="loading" @click="emit('refresh')"><RefreshCw :size="15" :stroke-width="1.8" aria-hidden="true" /> {{ loading ? 'Refreshing…' : 'Refresh status' }}</button>
        <button class="primary-button small" type="button" @click="openReport()"><MessageCircle :size="15" :stroke-width="1.8" aria-hidden="true" /> Report a problem</button>
      </div>
    </div>

    <div v-if="publicDemoMode" class="support-demo-note"><CircleAlert :size="17" :stroke-width="1.8" aria-hidden="true" /><span><strong>You're viewing a sample workspace.</strong> Help articles and diagnostics are available now. Sign in to create a tenant-linked support case.</span></div>

    <div class="support-status-grid">
      <article class="panel support-status-card"><span class="support-status-icon green"><CircleCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><div><small>FrontDeskWise API</small><strong>{{ formatLabel(systemStatus.api ?? 'checking') }}</strong></div></article>
      <article class="panel support-status-card"><span class="support-status-icon blue"><BookOpen :size="18" :stroke-width="1.8" aria-hidden="true" /></span><div><small>Knowledge</small><strong>{{ formatLabel(systemStatus.knowledge ?? 'checking') }}</strong></div></article>
      <article class="panel support-status-card"><span class="support-status-icon purple"><Sparkles :size="18" :stroke-width="1.8" aria-hidden="true" /></span><div><small>Widget</small><strong>{{ formatLabel(systemStatus.widget ?? 'checking') }}</strong></div></article>
      <article class="panel support-status-card"><span class="support-status-icon orange"><ShieldCheck :size="18" :stroke-width="1.8" aria-hidden="true" /></span><div><small>Account context</small><strong>{{ authReady ? 'Signed in' : 'Sign in required' }}</strong></div></article>
    </div>

    <div class="support-grid">
      <section class="support-main-column">
        <article class="panel support-ai-card">
          <div class="support-card-heading"><div><p class="eyebrow">AI support</p><h3>Ask FrontDeskWise</h3><p>Get a product answer first. If the issue needs a human, carry this context into a case.</p></div><span class="support-ai-mark"><Headset :size="20" :stroke-width="1.8" aria-hidden="true" /></span></div>
          <form class="support-ask-form" @submit.prevent="askAssistant"><input v-model="assistantQuestion" type="search" placeholder="Why isn't my widget live?" aria-label="Ask FrontDeskWise" /><button class="primary-button small" type="submit">Ask</button></form>
          <div v-if="assistantAnswer" class="support-ai-answer"><Sparkles :size="16" :stroke-width="1.8" aria-hidden="true" /><p>{{ assistantAnswer }}</p><button v-if="assistantQuestion.toLowerCase().includes('widget') || assistantQuestion.toLowerCase().includes('live')" class="text-button" type="button" @click="emit('navigate', 'install')">Open installation <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div>
        </article>

        <article class="panel support-articles-card">
          <div class="support-card-heading"><div><p class="eyebrow">Self-service first</p><h3>Common fixes</h3><p>Short guides for the moments that usually block a business owner.</p></div><BookOpen :size="21" :stroke-width="1.8" aria-hidden="true" /></div>
          <div class="support-article-list"><button v-for="article in articles" :key="article.id" type="button" class="support-article" @click="emit('navigate', article.target)"><span class="support-article-icon"><component :is="article.icon" :size="17" :stroke-width="1.8" aria-hidden="true" /></span><span><strong>{{ article.title }}</strong><small>{{ article.description }}</small></span><ArrowRight :size="16" :stroke-width="1.8" aria-hidden="true" /></button></div>
        </article>

        <article class="panel support-cases-card">
          <div class="support-card-heading"><div><p class="eyebrow">Your support history</p><h3>Cases and status</h3><p>Every case stays linked to {{ businessName || 'this business' }}, the affected feature, and its diagnostics.</p></div><div class="support-case-toolbar"><label class="support-search"><Search :size="15" :stroke-width="1.8" aria-hidden="true" /><input v-model="search" type="search" placeholder="Search cases" aria-label="Search support cases" /></label><Ticket :size="21" :stroke-width="1.8" aria-hidden="true" /></div></div>
          <div v-if="!filteredCases.length" class="support-empty"><Ticket :size="24" :stroke-width="1.7" aria-hidden="true" /><div><strong>No support cases yet.</strong><p>When something breaks, report it here and we’ll already have the business and system context.</p><button class="outline-button small" type="button" @click="openReport()">Report a problem</button></div></div>
          <div v-else class="support-case-list"><div v-for="caseItem in filteredCases" :key="caseItem.id" class="support-case-row"><button class="support-case-summary" type="button" @click="startCase(caseItem)"><span :class="['status-pill', statusClass(caseItem.status)]">{{ statusLabel(caseItem.status) }}</span><span class="support-case-copy"><strong>{{ caseItem.subject }}</strong><small>{{ formatLabel(caseItem.category) }}<span v-if="caseItem.provider"> · {{ formatLabel(caseItem.provider) }}</span> · {{ new Date(caseItem.createdAt).toLocaleString() }}</small></span><ChevronDown :class="{ rotated: selectedCase?.id === caseItem.id }" :size="16" :stroke-width="1.8" aria-hidden="true" /></button><div v-if="selectedCase?.id === caseItem.id" class="support-case-detail"><p>{{ caseItem.description }}</p><div class="support-case-meta"><span>Correlation ID <strong>{{ caseItem.correlationId }}</strong></span><span>Page <strong>{{ caseItem.sourcePage || 'Support' }}</strong></span><span v-if="caseItem.assignedUserName">Owner <strong>{{ caseItem.assignedUserName }}</strong></span></div><div class="support-case-events"><span v-for="event in caseItem.events" :key="event.id"><Check :size="13" :stroke-width="2" aria-hidden="true" /> {{ event.body || formatLabel(event.eventType) }} · {{ new Date(event.createdAt).toLocaleString() }}</span></div></div></div></div>
        </article>
      </section>

      <aside class="support-side-column">
        <article class="panel support-context-card"><div class="support-card-heading"><div><p class="eyebrow">Attached automatically</p><h3>Technical context</h3><p>You never need to copy logs or explain the setup from scratch.</p></div><CircleHelp :size="21" :stroke-width="1.8" aria-hidden="true" /></div><dl class="support-diagnostics-list"><div v-for="row in diagnosticsRows" :key="row.label"><dt>{{ row.label }}</dt><dd :title="row.value">{{ row.value }}</dd></div></dl><button class="outline-button small support-context-button" type="button" @click="openReport()">Report with this context <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></article>
        <article class="panel support-escape-card"><span class="support-escape-icon"><Wrench :size="19" :stroke-width="1.8" aria-hidden="true" /></span><div><p class="eyebrow">Human support</p><h3>Something still isn't working?</h3><p>Open a case with the business, page, feature, and recent system state attached.</p><button class="primary-button small" type="button" @click="openReport()">Get support <ArrowRight :size="14" :stroke-width="1.8" aria-hidden="true" /></button></div></article>
      </aside>
    </div>

    <div v-if="reportOpen" class="support-modal-backdrop" role="presentation" @click.self="reportOpen = false">
      <section class="support-report-modal" role="dialog" aria-modal="true" aria-labelledby="support-report-title">
        <button class="support-modal-close" type="button" aria-label="Close report form" @click="reportOpen = false">×</button>
        <p class="eyebrow">Human support</p><h2 id="support-report-title">Report a problem</h2><p class="support-modal-copy">We’ll attach {{ businessName || 'your business' }}, the current page, browser, timestamp, and recent system state to this case.</p>
        <div v-if="!authReady" class="support-auth-gate"><CircleAlert :size="18" :stroke-width="1.8" aria-hidden="true" /><p><strong>Sign in to send a case.</strong><br />Your support history is private to your workspace.</p><button class="outline-button small" type="button" @click="emit('require-auth')">Sign in</button></div>
        <form v-else class="support-report-form" @submit.prevent="submitCase">
          <label>What happened?<input v-model="form.subject" required maxlength="180" placeholder="e.g. Knowledge refresh failed" /></label>
          <div class="support-form-grid"><label>Area<select v-model="form.category"><option value="general">General</option><option value="installation">Widget / Install</option><option value="knowledge">Knowledge</option><option value="actions">Actions</option><option value="integration">Integration</option><option value="billing">Billing</option><option value="verification">Verification</option><option value="account">Account</option></select></label><label>Urgency<select v-model="form.severity"><option value="normal">Normal</option><option value="urgent">Business-critical</option></select></label></div>
          <div class="support-form-grid"><label>Provider <span class="optional">Optional</span><input v-model="form.provider" placeholder="e.g. HubSpot" /></label><label>Connection ID <span class="optional">Optional</span><input v-model="form.connectionId" placeholder="Attached automatically when available" /></label></div>
          <label>Tell us what you saw<textarea v-model="form.description" rows="6" required maxlength="8000" placeholder="Describe the outcome you expected and what happened instead."></textarea></label>
          <div class="support-attached-note"><ShieldCheck :size="16" :stroke-width="1.8" aria-hidden="true" /><span><strong>Diagnostics attached</strong><small>Business, feature, page, browser, timestamp, and recent system state.</small></span></div>
          <p v-if="submitError" class="form-error">{{ submitError }}</p><p v-if="submitMessage" class="saved-message">✓ {{ submitMessage }}</p>
          <div class="support-modal-actions"><button class="outline-button small" type="button" @click="reportOpen = false">Cancel</button><button class="primary-button small" type="submit" :disabled="submitting">{{ submitting ? 'Sending…' : 'Create support case' }}</button></div>
        </form>
      </section>
    </div>
  </div>
</template>
