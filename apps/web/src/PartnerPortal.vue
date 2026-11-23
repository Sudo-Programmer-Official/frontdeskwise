<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { ArrowRight, Building2, Check, Copy, ExternalLink, Link2, LogOut, Plus, RefreshCw, Sparkles, UsersRound, WalletCards } from "@lucide/vue";
import type { AuthSnapshot } from "./auth/firebase";
import { currentFirebaseToken } from "./auth/firebase";

type PartnerSection = "overview" | "clients" | "referrals" | "settings";
type PartnerDashboard = {
  partner: {
    id: string;
    companyName: string;
    slug: string;
    websiteUrl: string | null;
    partnerType: string;
    status: string;
    commissionRate: number;
    commissionWindowMonths: number;
    referralCode: string;
    referralLink: string;
  };
  summary: {
    clients: number;
    liveClients: number;
    trialClients: number;
    activeBusinesses: number;
    leads: number;
    conversations: number;
    estimatedCommissionCents: number;
    pipelineCommissionCents: number;
    referralCount: number;
    convertedReferralCount: number;
  };
  clients: Array<{
    id: string;
    organizationId: string;
    organizationName: string;
    organizationSlug: string;
    relationshipStatus: string;
    pricingTier: string;
    billingStatus: string;
    planKey: string;
    businessCount: number;
    liveBusinessCount: number;
    conversationCount: number;
    leadCount: number;
    monthlyAmountCents: number;
    estimatedCommissionCents: number;
    pipelineCommissionCents: number;
    lastActiveAt: string | null;
    activatedAt: string | null;
  }>;
  referrals: Array<{
    id: string;
    prospectName: string | null;
    prospectEmail: string | null;
    websiteUrl: string;
    demoUrl: string | null;
    status: string;
    createdAt: string | null;
    convertedAt: string | null;
  }>;
};

const props = defineProps<{
  section: PartnerSection;
  authSnapshot: AuthSnapshot | null;
  firebaseToken: string;
}>();
const emit = defineEmits<{
  (event: "navigate", section: PartnerSection): void;
  (event: "sign-out"): void;
}>();

const apiOrigin = String(import.meta.env.VITE_API_ORIGIN ?? "").replace(/\/$/, "");
const token = ref(props.firebaseToken);
const dashboard = ref<PartnerDashboard | null>(null);
const loading = ref(true);
const actionLoading = ref(false);
const error = ref("");
const notice = ref("");
const enrollOpen = ref(false);
const demoOpen = ref(false);
const clientOpen = ref(false);
const copied = ref(false);

const enrollForm = ref({ companyName: "", websiteUrl: "", partnerType: "agency" });
const demoForm = ref({ websiteUrl: "", prospectName: "", prospectEmail: "" });
const clientForm = ref({ businessName: "", websiteUrl: "", clientName: "", clientEmail: "" });
const generatedDemoUrl = ref("");

const navigation = [
  { id: "overview" as const, label: "Overview", icon: Sparkles },
  { id: "clients" as const, label: "Client businesses", icon: Building2 },
  { id: "referrals" as const, label: "Demos & referrals", icon: Link2 },
  { id: "settings" as const, label: "Partner settings", icon: WalletCards },
];

const displaySection = computed(() => props.section);
const userInitial = computed(() => (props.authSnapshot?.user.name?.trim().charAt(0) || "F").toUpperCase());
const canUsePartnerActions = computed(() => props.authSnapshot?.user.emailVerified !== false);
const apiUrl = (path: string) => `${apiOrigin}${path}`;

watch(() => props.firebaseToken, (next) => {
  if (next) token.value = next;
});

function headers(json = false): Record<string, string> {
  return {
    ...(json ? { "content-type": "application/json" } : {}),
    ...(token.value ? { authorization: `Bearer ${token.value}` } : {}),
  };
}

async function partnerFetch(path: string, init: RequestInit = {}): Promise<Response> {
  let response = await fetch(apiUrl(path), { ...init, headers: { ...headers(Boolean(init.body)), ...(init.headers ?? {}) } });
  if (response.status === 401) {
    const refreshed = await currentFirebaseToken(true).catch(() => "");
    if (refreshed) {
      token.value = refreshed;
      response = await fetch(apiUrl(path), { ...init, headers: { ...headers(Boolean(init.body)), ...(init.headers ?? {}) } });
    }
  }
  return response;
}

async function loadDashboard() {
  if (!props.authSnapshot) return;
  loading.value = true;
  error.value = "";
  try {
    const response = await partnerFetch("/api/v1/partners/dashboard");
    if (response.status === 404) {
      dashboard.value = null;
      enrollOpen.value = true;
      return;
    }
    const payload = await response.json() as PartnerDashboard & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not load the partner workspace.");
    dashboard.value = payload;
    enrollOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not load the partner workspace.";
  } finally {
    loading.value = false;
  }
}

async function submitEnrollment() {
  if (!enrollForm.value.companyName.trim() || actionLoading.value) return;
  await runAction(async () => {
    const response = await partnerFetch("/api/v1/partners/enroll", { method: "POST", body: JSON.stringify(enrollForm.value) });
    const payload = await response.json() as PartnerDashboard & { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not create your partner profile.");
    dashboard.value = payload;
    enrollOpen.value = false;
    notice.value = "Your partner workspace is ready. Start with a client demo.";
  });
}

async function submitDemo() {
  if (!demoForm.value.websiteUrl.trim() || actionLoading.value) return;
  await runAction(async () => {
    const response = await partnerFetch("/api/v1/partners/demos", { method: "POST", body: JSON.stringify(demoForm.value) });
    const payload = await response.json() as { error?: string; referral?: { demoUrl?: string | null } };
    if (!response.ok) throw new Error(payload.error ?? "Could not create the client demo.");
    generatedDemoUrl.value = payload.referral?.demoUrl ?? "";
    demoOpen.value = false;
    demoForm.value = { websiteUrl: "", prospectName: "", prospectEmail: "" };
    notice.value = "Personalized demo created. Send it to the prospect while the conversation is fresh.";
    await loadDashboard();
  });
}

async function submitClient() {
  if (!clientForm.value.websiteUrl.trim() || actionLoading.value) return;
  await runAction(async () => {
    const response = await partnerFetch("/api/v1/partners/clients", { method: "POST", body: JSON.stringify(clientForm.value) });
    const payload = await response.json() as { error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Could not provision this client.");
    clientOpen.value = false;
    clientForm.value = { businessName: "", websiteUrl: "", clientName: "", clientEmail: "" };
    notice.value = "Client workspace provisioned. The website is being prepared for review.";
    await loadDashboard();
  });
}

async function runAction(action: () => Promise<void>) {
  actionLoading.value = true;
  error.value = "";
  try {
    await action();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "The action could not be completed.";
  } finally {
    actionLoading.value = false;
  }
}

function money(cents: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);
}

function date(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)) : "Not yet";
}

function label(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

async function copyReferralLink() {
  if (!dashboard.value?.partner.referralLink) return;
  await navigator.clipboard?.writeText(dashboard.value.partner.referralLink).catch(() => undefined);
  copied.value = true;
  window.setTimeout(() => { copied.value = false; }, 2_000);
}

function backToFrontDeskWise() {
  window.location.href = "/";
}

async function copyGeneratedLink() {
  if (!generatedDemoUrl.value) return;
  await navigator.clipboard?.writeText(generatedDemoUrl.value).catch(() => undefined);
}

onMounted(() => { void loadDashboard(); });
</script>

<template>
  <section class="partner-portal">
    <header class="partner-topbar">
      <a class="partner-brand" href="/"><img src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></a>
      <div class="partner-topbar-actions">
        <span class="partner-user"><span class="partner-user-avatar">{{ userInitial }}</span><span><strong>{{ authSnapshot?.user.name }}</strong><small>{{ authSnapshot?.user.email }}</small></span></span>
        <button class="partner-icon-button" type="button" aria-label="Sign out" @click="emit('sign-out')"><LogOut :size="17" :stroke-width="1.8" /></button>
      </div>
    </header>

    <div class="partner-body">
      <aside class="partner-sidebar">
        <div class="partner-sidebar-intro"><span class="partner-eyebrow">Partner workspace</span><h1>{{ dashboard?.partner.companyName || 'Your agency' }}</h1><p>Operate every client AI front desk from one place.</p></div>
        <nav aria-label="Partner navigation">
          <button v-for="item in navigation" :key="item.id" type="button" :class="{ active: displaySection === item.id }" @click="emit('navigate', item.id)"><component :is="item.icon" :size="17" :stroke-width="1.8" /><span>{{ item.label }}</span></button>
        </nav>
        <div v-if="dashboard" class="partner-sidebar-callout"><span class="partner-callout-icon"><Link2 :size="15" /></span><div><strong>Your referral link</strong><small>Share it with your next prospect.</small><button type="button" @click="copyReferralLink">{{ copied ? 'Copied' : 'Copy link' }}</button></div></div>
        <button class="partner-back-link" type="button" @click="backToFrontDeskWise">← Back to FrontDeskWise</button>
      </aside>

      <main class="partner-main">
        <div v-if="loading" class="partner-loading"><RefreshCw :size="18" class="partner-spin" /> Loading your partner workspace…</div>
        <div v-else-if="error" class="partner-error"><strong>We couldn’t load this workspace.</strong><span>{{ error }}</span><button type="button" @click="loadDashboard">Try again</button></div>

        <section v-else-if="enrollOpen || !dashboard" class="partner-enroll-card">
          <div class="partner-enroll-mark"><Sparkles :size="20" /></div><span class="partner-eyebrow">One relationship · many businesses</span><h2>Turn every website you manage into recurring AI revenue.</h2><p>Add an AI front desk to client websites without building the platform yourself. Your partner workspace will give you a demo generator, client provisioning, and performance reporting.</p>
          <form class="partner-form partner-enroll-form" @submit.prevent="submitEnrollment"><label>Agency or company name<input v-model="enrollForm.companyName" required placeholder="ABC Digital" /></label><label>Company website <span>optional</span><input v-model="enrollForm.websiteUrl" type="url" placeholder="https://abcdigital.com" /></label><label>Partner model<select v-model="enrollForm.partnerType"><option value="agency">Agency partner</option><option value="referral">Referral partner</option><option value="consultant">Consultant</option><option value="reseller">Reseller</option></select></label><p v-if="error" class="partner-form-error">{{ error }}</p><button class="partner-primary-button" type="submit" :disabled="actionLoading">{{ actionLoading ? 'Creating workspace…' : 'Create partner workspace' }} <ArrowRight :size="16" /></button></form>
        </section>

        <template v-else>
          <div class="partner-page-heading"><div><span class="partner-eyebrow">{{ displaySection === 'overview' ? 'Your distribution layer' : label(displaySection) }}</span><h2>{{ displaySection === 'overview' ? `Good morning, ${authSnapshot?.user.name?.split(' ')[0] || 'there'}.` : displaySection === 'clients' ? 'Client businesses' : displaySection === 'referrals' ? 'Demos & referrals' : 'Partner settings' }}</h2><p>{{ displaySection === 'overview' ? 'See what needs attention and keep the next client moving.' : displaySection === 'clients' ? 'Provision, monitor, and support every client workspace you manage.' : displaySection === 'referrals' ? 'Create personalized demos that make your agency the hero in the sales conversation.' : 'Your referral identity and partner economics.' }}</p></div><div class="partner-heading-actions"><button class="partner-secondary-button" type="button" :disabled="loading" @click="loadDashboard"><RefreshCw :size="15" /> Refresh</button><button class="partner-primary-button" type="button" :disabled="!canUsePartnerActions" @click="demoOpen = true"><Plus :size="16" /> Build client demo</button></div></div>
          <div v-if="!canUsePartnerActions" class="partner-verification-banner"><strong>Verify your email before launching client workspaces.</strong><span>We’ve created your partner profile, but demo generation and client provisioning unlock after email verification. Refresh after confirming the link.</span><button type="button" @click="loadDashboard">I’ve verified — refresh</button></div>
          <p v-if="notice" class="partner-notice"><Check :size="15" /> {{ notice }} <button type="button" @click="notice = ''">Dismiss</button></p>

          <template v-if="displaySection === 'overview'">
            <div class="partner-stat-grid"><article><span class="partner-stat-icon blue"><Building2 :size="17" /></span><strong>{{ dashboard.summary.activeBusinesses }}</strong><small>Active businesses</small><em>{{ dashboard.summary.clients }} client accounts</em></article><article><span class="partner-stat-icon green"><UsersRound :size="17" /></span><strong>{{ dashboard.summary.leads }}</strong><small>Leads captured</small><em>{{ dashboard.summary.conversations }} conversations</em></article><article><span class="partner-stat-icon purple"><WalletCards :size="17" /></span><strong>{{ money(dashboard.summary.estimatedCommissionCents) }}</strong><small>Estimated partner MRR</small><em>{{ dashboard.summary.liveClients }} live clients</em></article><article><span class="partner-stat-icon orange"><Link2 :size="17" /></span><strong>{{ dashboard.summary.referralCount }}</strong><small>Demos created</small><em>{{ dashboard.summary.convertedReferralCount }} converted</em></article></div>
            <div class="partner-overview-grid"><article class="partner-panel partner-next-action"><div class="partner-panel-heading"><div><span class="partner-eyebrow">Next best action</span><h3>Launch your next client in minutes</h3><p>Paste a website and FrontDeskWise creates the starting Business Brain, workflow, and preview for you.</p></div><span class="partner-action-orb"><Sparkles :size="18" /></span></div><div class="partner-flow"><span>Website</span><i>→</i><span>Business Brain</span><i>→</i><span>Preview</span><i>→</i><span>Client launch</span></div><div class="partner-panel-actions"><button class="partner-primary-button" type="button" @click="demoOpen = true">Create a personalized demo <ArrowRight :size="15" /></button><button class="partner-text-button" type="button" @click="clientOpen = true">Provision a live client</button></div></article><article class="partner-panel"><div class="partner-panel-heading"><div><span class="partner-eyebrow">Partner economics</span><h3>Recurring revenue you can see</h3><p>Standard partner commission is {{ dashboard.partner.commissionRate }}% for {{ dashboard.partner.commissionWindowMonths }} months.</p></div></div><div class="partner-economics"><div><span>Live client MRR</span><strong>{{ money(dashboard.summary.estimatedCommissionCents) }}</strong></div><div><span>Pipeline including trials</span><strong>{{ money(dashboard.summary.pipelineCommissionCents) }}</strong></div></div><small class="partner-muted">Projected from connected client billing plans. Final payouts follow your partner agreement.</small></article></div>
            <div class="partner-panel"><div class="partner-panel-heading"><div><span class="partner-eyebrow">Clients needing attention</span><h3>Keep your portfolio moving</h3></div><button class="partner-text-button" type="button" @click="emit('navigate', 'clients')">View all clients →</button></div><div v-if="!dashboard.clients.length" class="partner-empty">Your first client will appear here after you provision a workspace.</div><div v-else class="partner-client-list"><div v-for="client in dashboard.clients.slice(0, 5)" :key="client.id" class="partner-client-row"><span class="partner-client-logo">{{ client.organizationName.charAt(0) }}</span><span class="partner-client-copy"><strong>{{ client.organizationName }}</strong><small>{{ client.businessCount }} business{{ client.businessCount === 1 ? '' : 'es' }} · {{ client.leadCount }} leads · last active {{ date(client.lastActiveAt) }}</small></span><span :class="['partner-status', client.billingStatus === 'active' ? 'success' : client.billingStatus === 'trial' ? 'warning' : 'neutral']">{{ label(client.billingStatus) }}</span><span class="partner-client-revenue">{{ money(client.estimatedCommissionCents) }}<small>commission / mo</small></span></div></div></div>
          </template>

          <section v-else-if="displaySection === 'clients'" class="partner-panel partner-table-panel"><div v-if="!dashboard.clients.length" class="partner-empty partner-empty-large"><Building2 :size="26" /><h3>No client businesses yet</h3><p>Provision a client workspace to start building your portfolio.</p><button class="partner-primary-button" type="button" @click="clientOpen = true">Provision first client <ArrowRight :size="15" /></button></div><template v-else><div class="partner-table-heading"><span>Client organization</span><span>Portfolio</span><span>Activity</span><span>Revenue</span><span>Status</span></div><div v-for="client in dashboard.clients" :key="client.id" class="partner-table-row"><div class="partner-table-client"><span class="partner-client-logo">{{ client.organizationName.charAt(0) }}</span><span><strong>{{ client.organizationName }}</strong><small>{{ label(client.pricingTier) }} pricing · joined {{ date(client.activatedAt) }}</small></span></div><span>{{ client.businessCount }} businesses<small>{{ client.liveBusinessCount }} widgets detected</small></span><span>{{ client.leadCount }} leads<small>{{ client.conversationCount }} conversations</small></span><strong>{{ money(client.estimatedCommissionCents) }}<small>estimated / mo</small></strong><span :class="['partner-status', client.billingStatus === 'active' ? 'success' : client.billingStatus === 'trial' ? 'warning' : 'neutral']">{{ label(client.billingStatus) }}</span></div></template></section>

          <section v-else-if="displaySection === 'referrals'" class="partner-panel partner-table-panel"><div class="partner-panel-heading"><div><span class="partner-eyebrow">Sales tool</span><h3>Personalized client demos</h3><p>Give every prospect a preview shaped around their website before asking for a buying decision.</p></div><button class="partner-primary-button" type="button" @click="demoOpen = true"><Plus :size="16" /> Create demo</button></div><div v-if="!dashboard.referrals.length" class="partner-empty partner-empty-large"><Link2 :size="26" /><h3>No demos created yet</h3><p>Paste a prospect’s website and let FrontDeskWise build the first conversation.</p></div><div v-else class="partner-referral-list"><div v-for="referral in dashboard.referrals" :key="referral.id" class="partner-referral-row"><span class="partner-referral-icon"><Sparkles :size="16" /></span><span class="partner-referral-copy"><strong>{{ referral.prospectName || referral.websiteUrl }}</strong><small>{{ referral.prospectEmail || 'No email provided' }} · {{ date(referral.createdAt) }}</small></span><span :class="['partner-status', referral.status === 'converted' ? 'success' : 'warning']">{{ label(referral.status) }}</span><a v-if="referral.demoUrl" :href="referral.demoUrl" target="_blank" rel="noreferrer" class="partner-icon-link" aria-label="Open demo"><ExternalLink :size="16" /></a></div></div></section>

          <section v-else class="partner-settings-grid"><article class="partner-panel"><span class="partner-eyebrow">Agency identity</span><h3>{{ dashboard.partner.companyName }}</h3><p>{{ label(dashboard.partner.partnerType) }} · {{ dashboard.partner.websiteUrl || 'Website not added' }}</p><div class="partner-setting-row"><span>Referral code</span><code>{{ dashboard.partner.referralCode }}</code></div><div class="partner-setting-row"><span>Commission window</span><strong>{{ dashboard.partner.commissionWindowMonths }} months</strong></div><div class="partner-setting-row"><span>Commission rate</span><strong>{{ dashboard.partner.commissionRate }}%</strong></div></article><article class="partner-panel partner-referral-link-card"><span class="partner-eyebrow">Your shareable link</span><h3>Bring prospects into your channel</h3><p>Use this link in proposals, onboarding emails, and your agency’s services page.</p><div class="partner-copy-field"><input :value="dashboard.partner.referralLink" readonly aria-label="Partner referral link" /><button type="button" @click="copyReferralLink"><Check v-if="copied" :size="16" /><Copy v-else :size="16" /></button></div><small>Link attribution is stored with your partner account. Create a personalized demo when you want a client-specific preview.</small></article></section>
        </template>
      </main>
    </div>

    <div v-if="demoOpen" class="partner-modal-backdrop" @click.self="demoOpen = false"><form class="partner-modal" @submit.prevent="submitDemo"><button class="partner-modal-close" type="button" aria-label="Close" @click="demoOpen = false">×</button><span class="partner-eyebrow">Sales enablement</span><h3>Build a client demo</h3><p>Paste a prospect’s website. We’ll crawl public pages and generate a shareable AI front desk preview.</p><label>Prospect website<input v-model="demoForm.websiteUrl" required type="url" placeholder="https://joesplumbing.com" /></label><label>Prospect name <span>optional</span><input v-model="demoForm.prospectName" placeholder="Joe’s Plumbing" /></label><label>Prospect email <span>optional</span><input v-model="demoForm.prospectEmail" type="email" placeholder="joe@joesplumbing.com" /></label><p v-if="error" class="partner-form-error">{{ error }}</p><button class="partner-primary-button" type="submit" :disabled="actionLoading">{{ actionLoading ? 'Crawling and building…' : 'Create personalized demo' }} <ArrowRight :size="15" /></button><div v-if="generatedDemoUrl" class="partner-generated-link"><strong>Demo ready</strong><a :href="generatedDemoUrl" target="_blank" rel="noreferrer">{{ generatedDemoUrl }}</a><button type="button" @click="copyGeneratedLink">Copy link</button></div></form></div>

    <div v-if="clientOpen" class="partner-modal-backdrop" @click.self="clientOpen = false"><form class="partner-modal" @submit.prevent="submitClient"><button class="partner-modal-close" type="button" aria-label="Close" @click="clientOpen = false">×</button><span class="partner-eyebrow">Client provisioning</span><h3>Create a client workspace</h3><p>FrontDeskWise will create a dedicated organization, crawl the website, and attach it to your portfolio.</p><label>Website URL<input v-model="clientForm.websiteUrl" required type="url" placeholder="https://clientbusiness.com" /></label><label>Business name <span>optional</span><input v-model="clientForm.businessName" placeholder="Client business" /></label><label>Client contact name <span>optional</span><input v-model="clientForm.clientName" placeholder="Alex Morgan" /></label><label>Client contact email <span>optional</span><input v-model="clientForm.clientEmail" type="email" placeholder="alex@clientbusiness.com" /></label><p class="partner-form-hint">If you add an email, FrontDeskWise creates an invitation-ready client owner record. You still control the partner relationship.</p><p v-if="error" class="partner-form-error">{{ error }}</p><button class="partner-primary-button" type="submit" :disabled="actionLoading">{{ actionLoading ? 'Provisioning workspace…' : 'Provision client workspace' }} <ArrowRight :size="15" /></button></form></div>
  </section>
</template>

<style scoped>
.partner-verification-banner { display: flex; align-items: center; gap: 10px; margin: -8px 0 18px; padding: 12px 14px; border: 1px solid #f0d79f; border-radius: 9px; color: #7a5a18; background: #fff9eb; font-size: 11px; }.partner-verification-banner strong { color: #6d4e10; }.partner-verification-banner span { flex: 1; color: #8b6f36; line-height: 1.45; }.partner-verification-banner button { padding: 7px 9px; border: 1px solid #e6c97f; border-radius: 7px; color: #765619; background: #fff; font-size: 10px; font-weight: 800; }
.partner-portal { min-height: 100vh; color: #14233d; background: #f6f8fc; }
.partner-topbar { display: flex; align-items: center; justify-content: space-between; min-height: 74px; padding: 0 34px; border-bottom: 1px solid #e1e8f2; background: #fff; }
.partner-brand { display: inline-flex; align-items: center; gap: 10px; color: #14233d; font-size: 19px; font-weight: 850; letter-spacing: -.04em; text-decoration: none; }.partner-brand img { width: 34px; height: 34px; border-radius: 10px; }.partner-brand span span { color: #1f6feb; }
.partner-topbar-actions, .partner-user, .partner-heading-actions, .partner-panel-actions, .partner-flow { display: flex; align-items: center; gap: 12px; }.partner-user { gap: 10px; }.partner-user-avatar { display: grid; width: 33px; height: 33px; place-items: center; border-radius: 50%; color: #1f6feb; background: #eaf2ff; font-size: 12px; font-weight: 850; }.partner-user strong, .partner-user small { display: block; }.partner-user strong { font-size: 12px; }.partner-user small { margin-top: 3px; color: #8290a4; font-size: 10px; }.partner-icon-button, .partner-modal-close { display: grid; place-items: center; border: 0; color: #6f7e94; background: transparent; }.partner-icon-button { width: 34px; height: 34px; border-radius: 8px; }.partner-icon-button:hover { color: #1f6feb; background: #f0f5fc; }
.partner-body { display: grid; grid-template-columns: 255px minmax(0, 1fr); min-height: calc(100vh - 74px); }.partner-sidebar { display: flex; flex-direction: column; padding: 32px 20px 22px; border-right: 1px solid #e1e8f2; background: #fff; }.partner-sidebar-intro { padding: 0 12px 28px; }.partner-eyebrow { display: block; color: #2a72dd; font-size: 10px; font-weight: 850; letter-spacing: .12em; text-transform: uppercase; }.partner-sidebar h1 { margin: 8px 0 7px; overflow: hidden; color: #19325d; font-size: 18px; letter-spacing: -.04em; text-overflow: ellipsis; white-space: nowrap; }.partner-sidebar p, .partner-page-heading p, .partner-panel p, .partner-enroll-card p, .partner-modal p { margin: 0; color: #74849b; font-size: 12px; line-height: 1.55; }.partner-sidebar nav { display: grid; gap: 5px; }.partner-sidebar nav button { display: flex; align-items: center; gap: 11px; min-height: 42px; padding: 0 12px; border: 0; border-radius: 9px; color: #6f7e94; background: transparent; font-size: 12px; font-weight: 750; text-align: left; }.partner-sidebar nav button:hover, .partner-sidebar nav button.active { color: #1e5fbc; background: #eef5ff; }.partner-sidebar nav button.active { box-shadow: inset 3px 0 #2f80ed; }.partner-sidebar-callout { display: flex; gap: 10px; margin: auto 0 15px; padding: 12px; border: 1px solid #dbe8fa; border-radius: 11px; background: #f7fbff; }.partner-callout-icon { display: grid; width: 26px; height: 26px; flex: 0 0 26px; place-items: center; border-radius: 8px; color: #2167c9; background: #e6f1ff; }.partner-sidebar-callout strong, .partner-sidebar-callout small { display: block; }.partner-sidebar-callout strong { color: #27456f; font-size: 11px; }.partner-sidebar-callout small { margin-top: 3px; color: #8091a8; font-size: 10px; line-height: 1.4; }.partner-sidebar-callout button, .partner-text-button { margin-top: 8px; padding: 0; border: 0; color: #2167c9; background: transparent; font-size: 10px; font-weight: 800; }.partner-back-link { padding: 12px; border: 0; color: #8997aa; background: transparent; font-size: 11px; text-align: left; }
.partner-main { width: min(1280px, 100%); padding: 36px 42px 58px; margin: 0 auto; }.partner-page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 26px; }.partner-page-heading h2 { margin: 7px 0 7px; color: #172f58; font-size: 28px; letter-spacing: -.06em; }.partner-primary-button, .partner-secondary-button { display: inline-flex; min-height: 38px; align-items: center; justify-content: center; gap: 7px; padding: 0 13px; border-radius: 8px; font-size: 11px; font-weight: 800; }.partner-primary-button { border: 1px solid #1f6feb; color: #fff; background: #1f6feb; box-shadow: 0 6px 14px rgba(31,111,235,.16); }.partner-primary-button:hover:not(:disabled) { background: #175fcf; }.partner-secondary-button { border: 1px solid #d0dbe9; color: #4c6383; background: #fff; }.partner-secondary-button:hover { border-color: #9db8dc; }
.partner-stat-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }.partner-stat-grid article { min-height: 143px; padding: 17px; border: 1px solid #dfe7f1; border-radius: 13px; background: #fff; box-shadow: 0 7px 22px rgba(21,54,99,.045); }.partner-stat-icon { display: inline-grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; }.partner-stat-icon.blue { color: #2a72df; background: #e9f2ff; }.partner-stat-icon.green { color: #079875; background: #e7faf4; }.partner-stat-icon.purple { color: #765bc9; background: #f0edff; }.partner-stat-icon.orange { color: #d68119; background: #fff2df; }.partner-stat-grid strong, .partner-stat-grid small, .partner-stat-grid em { display: block; }.partner-stat-grid strong { margin-top: 17px; color: #172f58; font-size: 26px; letter-spacing: -.06em; }.partner-stat-grid small { margin-top: 2px; color: #627590; font-size: 11px; font-weight: 800; }.partner-stat-grid em { width: max-content; margin-top: 10px; padding: 4px 7px; border-radius: 6px; color: #13856d; background: #edf9f5; font-size: 10px; font-style: normal; font-weight: 750; }
.partner-overview-grid { display: grid; grid-template-columns: 1.35fr .95fr; gap: 18px; margin-bottom: 18px; }.partner-panel { padding: 21px; border: 1px solid #dfe7f1; border-radius: 13px; background: #fff; box-shadow: 0 7px 22px rgba(21,54,99,.045); }.partner-panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; }.partner-panel h3 { margin: 7px 0 6px; color: #203b66; font-size: 16px; letter-spacing: -.035em; }.partner-action-orb { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 12px; color: #216bd5; background: #eaf3ff; }.partner-flow { flex-wrap: wrap; margin: 21px 0 20px; }.partner-flow span { padding: 8px 10px; border: 1px solid #dce6f3; border-radius: 7px; color: #355475; background: #f8fbff; font-size: 10px; font-weight: 750; }.partner-flow i { color: #a0aec0; font-size: 12px; font-style: normal; }.partner-economics { display: grid; gap: 9px; margin: 22px 0 12px; }.partner-economics div { display: flex; align-items: center; justify-content: space-between; padding: 11px 0; border-top: 1px solid #edf1f6; }.partner-economics span { color: #74849b; font-size: 11px; }.partner-economics strong { color: #1b3f76; font-size: 17px; }.partner-muted { color: #96a2b3; font-size: 10px; line-height: 1.5; }.partner-panel-actions { flex-wrap: wrap; }.partner-panel-actions .partner-text-button { margin: 0; }.partner-client-list, .partner-referral-list { margin-top: 15px; }.partner-client-row, .partner-referral-row { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 14px 0; border-top: 1px solid #edf1f6; }.partner-client-logo { display: grid; width: 31px; height: 31px; place-items: center; border-radius: 9px; color: #2868c5; background: #eaf2ff; font-size: 12px; font-weight: 850; }.partner-client-copy { min-width: 0; }.partner-client-copy strong, .partner-client-copy small, .partner-client-revenue, .partner-client-revenue small, .partner-table-row > span small, .partner-table-row > strong small, .partner-referral-copy strong, .partner-referral-copy small { display: block; }.partner-client-copy strong, .partner-referral-copy strong { overflow: hidden; color: #30496e; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.partner-client-copy small, .partner-referral-copy small { margin-top: 4px; overflow: hidden; color: #8997a9; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.partner-client-revenue { color: #1b6f5e; font-size: 12px; font-weight: 800; text-align: right; }.partner-client-revenue small { margin-top: 3px; color: #95a2b3; font-size: 9px; font-weight: 600; }.partner-status { display: inline-flex; min-height: 23px; align-items: center; padding: 0 8px; border-radius: 999px; font-size: 9px; font-weight: 800; text-transform: capitalize; white-space: nowrap; }.partner-status.success { color: #087b60; background: #eaf9f3; }.partner-status.warning { color: #9a6b13; background: #fff7e7; }.partner-status.neutral { color: #74849b; background: #f1f4f8; }
.partner-table-panel { padding: 22px; }.partner-table-heading, .partner-table-row { display: grid; grid-template-columns: 1.45fr .9fr 1fr .8fr auto; gap: 16px; align-items: center; }.partner-table-heading { padding: 0 0 12px; color: #98a4b4; font-size: 9px; font-weight: 850; letter-spacing: .1em; text-transform: uppercase; }.partner-table-row { padding: 14px 0; border-top: 1px solid #edf1f6; color: #48617f; font-size: 11px; }.partner-table-row > span small, .partner-table-row > strong small { margin-top: 4px; color: #8e9bad; font-size: 9px; font-weight: 550; }.partner-table-client { display: flex; align-items: center; gap: 10px; min-width: 0; }.partner-table-client strong, .partner-table-client small { display: block; }.partner-table-client strong { color: #30496e; font-size: 12px; }.partner-table-client small { margin-top: 4px; color: #8997a9; font-size: 9px; }.partner-table-row > strong { color: #1b6f5e; font-size: 12px; }.partner-referral-list { margin-top: 20px; }.partner-referral-row { grid-template-columns: auto minmax(0, 1fr) auto auto; }.partner-referral-icon { display: grid; width: 30px; height: 30px; place-items: center; border-radius: 9px; color: #765bc9; background: #f0edff; }.partner-icon-link { display: grid; width: 29px; height: 29px; place-items: center; border-radius: 7px; color: #216bd5; background: #edf5ff; }.partner-settings-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }.partner-settings-grid h3 { margin: 8px 0 6px; color: #203b66; font-size: 18px; }.partner-setting-row { display: flex; justify-content: space-between; gap: 15px; padding: 13px 0; border-top: 1px solid #edf1f6; color: #77879e; font-size: 11px; }.partner-setting-row:first-of-type { margin-top: 24px; }.partner-setting-row strong, .partner-setting-row code { color: #2f4b70; font-size: 11px; }.partner-referral-link-card p { margin-top: 7px; }.partner-copy-field { display: flex; gap: 7px; margin: 24px 0 10px; }.partner-copy-field input { min-width: 0; flex: 1; padding: 10px; border: 1px solid #d7e1ee; border-radius: 8px; color: #3a587c; background: #fbfdff; font-size: 11px; }.partner-copy-field button { display: grid; width: 39px; place-items: center; border: 1px solid #cddcf0; border-radius: 8px; color: #216bd5; background: #eef5ff; }.partner-referral-link-card > small { color: #8a98aa; font-size: 10px; line-height: 1.5; }.partner-notice { display: flex; align-items: center; gap: 7px; margin: -8px 0 18px; padding: 11px 13px; border: 1px solid #c6e8dc; border-radius: 8px; color: #08785d; background: #f0fbf7; font-size: 11px; }.partner-notice button { margin-left: auto; padding: 0; border: 0; color: #08785d; background: transparent; font-size: 10px; font-weight: 800; }.partner-empty { padding: 24px 10px; color: #8997a9; font-size: 11px; text-align: center; }.partner-empty-large { display: grid; justify-items: center; gap: 9px; min-height: 240px; align-content: center; }.partner-empty-large h3 { margin: 0; color: #30496e; font-size: 14px; }.partner-empty-large p { margin: 0 0 8px; }.partner-loading { display: flex; align-items: center; gap: 9px; padding: 20px; color: #71829a; font-size: 12px; }.partner-spin { animation: partner-spin 1s linear infinite; }@keyframes partner-spin { to { transform: rotate(360deg); } }.partner-error { display: grid; gap: 8px; max-width: 520px; padding: 20px; border: 1px solid #f0d1cd; border-radius: 12px; color: #8f4840; background: #fff7f6; font-size: 12px; }.partner-error span { color: #9e726d; line-height: 1.5; }.partner-error button { width: max-content; padding: 8px 10px; border: 1px solid #efc9c5; border-radius: 7px; color: #9b4942; background: #fff; font-size: 11px; font-weight: 800; }.partner-enroll-card { width: min(720px, 100%); margin: 9vh auto; padding: 42px; border: 1px solid #dfe7f1; border-radius: 18px; background: #fff; box-shadow: 0 15px 50px rgba(21,54,99,.08); }.partner-enroll-mark { display: grid; width: 42px; height: 42px; place-items: center; margin-bottom: 22px; border-radius: 12px; color: #216bd5; background: #eaf3ff; }.partner-enroll-card h2 { max-width: 590px; margin: 9px 0 10px; color: #17325e; font-size: 30px; letter-spacing: -.06em; line-height: 1.08; }.partner-enroll-card > p { max-width: 600px; }.partner-form { display: grid; gap: 13px; margin-top: 26px; }.partner-form label, .partner-modal label { display: grid; gap: 7px; color: #506684; font-size: 11px; font-weight: 800; }.partner-form label span, .partner-modal label span { color: #9aa6b5; font-size: 10px; font-weight: 550; }.partner-form input, .partner-form select, .partner-modal input { width: 100%; min-height: 42px; padding: 10px 11px; border: 1px solid #cdd9e7; border-radius: 8px; color: #203b66; background: #fbfdff; font-size: 12px; }.partner-form input:focus, .partner-form select:focus, .partner-modal input:focus { outline: 0; border-color: #2f80ed; box-shadow: 0 0 0 3px rgba(47,128,237,.12); }.partner-form-error { margin: 0; color: #aa493f; font-size: 11px; line-height: 1.45; }.partner-form-hint { margin: 0; color: #8a98aa; font-size: 10px; line-height: 1.5; }.partner-modal-backdrop { position: fixed; z-index: 20; inset: 0; display: grid; place-items: center; padding: 20px; background: rgba(14,31,58,.35); backdrop-filter: blur(5px); }.partner-modal { position: relative; width: min(100%, 480px); max-height: calc(100vh - 40px); overflow: auto; padding: 28px; border: 1px solid #dce5f1; border-radius: 16px; background: #fff; box-shadow: 0 25px 80px rgba(15,44,84,.25); }.partner-modal-close { position: absolute; top: 14px; right: 16px; width: 28px; height: 28px; font-size: 25px; }.partner-modal h3 { margin: 8px 0 8px; color: #19365f; font-size: 21px; letter-spacing: -.045em; }.partner-modal > p:not(.partner-form-error):not(.partner-form-hint) { margin-bottom: 20px; }.partner-modal label + label { margin-top: 14px; }.partner-modal .partner-primary-button { width: 100%; margin-top: 21px; }.partner-generated-link { display: grid; gap: 6px; margin-top: 16px; padding: 12px; border: 1px solid #c9e8dd; border-radius: 8px; background: #f2fbf8; }.partner-generated-link strong { color: #17755f; font-size: 11px; }.partner-generated-link a { overflow: hidden; color: #2868c5; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }.partner-generated-link button { width: max-content; padding: 0; border: 0; color: #2868c5; background: transparent; font-size: 10px; font-weight: 800; }
@media (max-width: 1060px) { .partner-stat-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.partner-overview-grid { grid-template-columns: 1fr; } }
@media (max-width: 800px) { .partner-body { grid-template-columns: 1fr; }.partner-sidebar { gap: 16px; padding: 18px; border-right: 0; border-bottom: 1px solid #e1e8f2; }.partner-sidebar-intro { padding: 0; }.partner-sidebar nav { display: flex; overflow-x: auto; }.partner-sidebar nav button { flex: 0 0 auto; }.partner-sidebar-callout, .partner-back-link { display: none; }.partner-main { padding: 26px 18px 42px; }.partner-page-heading { align-items: flex-start; flex-direction: column; }.partner-heading-actions { flex-wrap: wrap; }.partner-settings-grid { grid-template-columns: 1fr; } }
@media (max-width: 620px) { .partner-topbar { padding: 0 18px; }.partner-user > span:last-child { display: none; }.partner-stat-grid { grid-template-columns: 1fr 1fr; gap: 9px; }.partner-stat-grid article { min-height: 128px; padding: 13px; }.partner-stat-grid strong { font-size: 22px; }.partner-client-row { grid-template-columns: auto minmax(0, 1fr) auto; }.partner-client-revenue { display: none; }.partner-table-heading { display: none; }.partner-table-row { grid-template-columns: 1fr auto; gap: 10px; }.partner-table-row > span:nth-child(2), .partner-table-row > span:nth-child(3), .partner-table-row > strong { display: none; }.partner-table-row > span:last-child { justify-self: end; }.partner-referral-row { grid-template-columns: auto minmax(0, 1fr) auto; }.partner-referral-row .partner-icon-link { display: none; }.partner-enroll-card { margin: 20px 0; padding: 26px 20px; }.partner-enroll-card h2 { font-size: 25px; } }
</style>
