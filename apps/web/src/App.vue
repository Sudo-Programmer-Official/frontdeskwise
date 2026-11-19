<script setup lang="ts">
import { computed, ref } from "vue";

type View = "home" | "overview" | "conversations" | "leads" | "knowledge" | "actions" | "agent";

interface Lead {
  name: string;
  intent: string;
  status: "New" | "Qualified" | "Booked";
  time: string;
}

const view = ref<View>("home");
const websiteUrl = ref("");
const isGenerating = ref(false);
const generationError = ref("");
const demoSlug = ref("british-swim-school-tampa-bay");
const businessName = ref("British Swim School");
const assistantName = ref("Swim Assistant");
const welcomeMessage = ref(
  "Hi! 👋 I’m your Swim Assistant. I can answer questions, help you find the right swim program, check locations and schedules, and get you started with enrollment.",
);
const widgetColor = ref("#0d6efd");
const showLeadCapture = ref(true);
const savedMessage = ref("");
const conversationId = ref("");
const testQuestion = ref("");
const testAnswer = ref("");
const answerSource = ref("");
const answerGrounded = ref(false);
const isAsking = ref(false);
const leadName = ref("");
const leadEmail = ref("");
const leadPhone = ref("");
const leadIntent = ref("");
const leadSavedMessage = ref("");

const leads = ref<Lead[]>([
  { name: "Maya Rodriguez", intent: "Toddler lessons", status: "New", time: "8 min ago" },
  { name: "James Wilson", intent: "Birthday party", status: "Qualified", time: "34 min ago" },
  { name: "Priya Shah", intent: "Adult swim assessment", status: "Booked", time: "1 hr ago" },
  { name: "Noah Bennett", intent: "Summer registration", status: "New", time: "2 hrs ago" },
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

async function generateDemo() {
  if (!websiteUrl.value.trim()) return;
  isGenerating.value = true;
  generationError.value = "";
  try {
    const response = await fetch("/api/v1/demos", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ websiteUrl: websiteUrl.value }),
    });
    const payload = await response.json() as { error?: string; slug?: string; business?: { name?: string; websiteUrl?: string }; agent?: { assistantName?: string; welcomeMessage?: string } };
    if (!response.ok) throw new Error(payload.error ?? "We could not crawl that website yet.");
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

async function askQuestion() {
  if (!testQuestion.value.trim() || isAsking.value) return;
  isAsking.value = true;
  testAnswer.value = "";
  answerSource.value = "";
  try {
    if (!conversationId.value) {
      const conversationResponse = await fetch(`/api/v1/demo/${demoSlug.value}/conversations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: `dashboard-${Date.now()}` }),
      });
      const conversationPayload = await conversationResponse.json() as { conversationId?: string };
      if (!conversationResponse.ok || !conversationPayload.conversationId) throw new Error("Could not start a test conversation.");
      conversationId.value = conversationPayload.conversationId;
    }
    const response = await fetch(`/api/v1/demo/${demoSlug.value}/conversations/${conversationId.value}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question: testQuestion.value }),
    });
    const payload = await response.json() as { error?: string; answer?: string; grounded?: boolean; citations?: Array<{ url?: string }> };
    if (!response.ok) throw new Error(payload.error ?? "Could not answer that question.");
    testAnswer.value = payload.answer ?? "";
    answerGrounded.value = Boolean(payload.grounded);
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
  const response = await fetch(`/api/v1/demo/${demoSlug.value}/leads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
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
  window.setTimeout(() => (leadSavedMessage.value = ""), 2600);
}

function saveAgent() {
  savedMessage.value = "Saved · demo is ready to share";
  window.setTimeout(() => (savedMessage.value = ""), 2600);
}

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
          <button class="dark-button small" type="button" @click="view = 'overview'">Sign in</button>
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
        <div class="workspace-switcher"><span class="workspace-avatar">B</span><span><strong>{{ businessName }}</strong><small>Tampa Bay · Demo</small></span><span class="chevron">⌄</span></div>
        <nav class="sidebar-nav">
          <button v-for="item in navItems" :key="item.id" type="button" :class="['nav-item', { active: view === item.id }]" @click="view = item.id"><span class="nav-icon">{{ item.icon }}</span><span>{{ item.label }}</span><b v-if="item.id === 'conversations'">24</b></button>
        </nav>
        <div class="sidebar-bottom"><div class="setup-card"><div class="setup-row"><span>Setup progress</span><strong>85%</strong></div><div class="progress-bar"><span></span></div><small>3 of 4 steps complete</small></div><button class="sidebar-link" type="button" @click="openHome">← Back to landing page</button></div>
      </aside>

      <section class="content-area">
        <header class="content-header"><div><p class="breadcrumb">{{ businessName }} / FrontDeskWise</p><h1>{{ pageTitle }}</h1></div><div class="header-actions"><button class="outline-button" type="button" @click="view = 'agent'">Preview on website ↗</button><button class="primary-button small" type="button" @click="view = 'agent'">Edit agent</button><span class="notification">♧<i></i></span><span class="profile-avatar">SP</span></div></header>

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

        <div v-else-if="view === 'conversations'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Grounded answers</p><h2>Test a conversation</h2><p>Ask what a visitor would ask and verify the source before sharing the demo.</p></div><span v-if="conversationId" class="conversation-status">Conversation active</span></div><div class="conversation-layout"><article class="panel conversation-panel"><div class="conversation-intro"><span class="mini-orb">✦</span><div><strong>{{ assistantName }}</strong><small>Answers from {{ businessName }} knowledge</small></div></div><div v-if="testAnswer" class="answer-card"><div class="answer-meta"><span :class="['answer-badge', answerGrounded ? 'grounded' : 'fallback']">{{ answerGrounded ? '✓ Grounded in source' : '! Needs an answer' }}</span><a v-if="answerSource" :href="answerSource" target="_blank" rel="noreferrer">View source ↗</a></div><p>{{ testAnswer }}</p></div><div v-else class="conversation-empty">Ask a question to see the agent’s answer and citation.</div><form class="question-form" @submit.prevent="askQuestion"><input v-model="testQuestion" type="text" placeholder="e.g. What age can my child start?" aria-label="Test question" /><button class="primary-button small" type="submit" :disabled="isAsking">{{ isAsking ? 'Checking…' : 'Ask agent' }}</button></form></article><article class="panel lead-capture-panel"><div class="panel-heading"><div><h2>Capture the next step</h2><p>Send a contact to the owner dashboard.</p></div></div><label>Name<input v-model="leadName" type="text" placeholder="Jamie Rodriguez" /></label><label>Email<input v-model="leadEmail" type="email" placeholder="jamie@example.com" /></label><label>Phone <span class="optional">optional</span><input v-model="leadPhone" type="tel" placeholder="(555) 010-2026" /></label><label>Intent <span class="optional">optional</span><input v-model="leadIntent" type="text" placeholder="Toddler lessons" /></label><button class="primary-button" type="button" :disabled="!leadEmail && !leadPhone" @click="captureLead">Capture lead →</button><span v-if="leadSavedMessage" class="saved-message">✓ {{ leadSavedMessage }}</span></article></div></div>

        <div v-else-if="view === 'leads'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Revenue outcomes</p><h2>Captured leads</h2><p>People FrontDeskWise helped move closer to a booking.</p></div><button class="primary-button small" type="button" @click="view = 'agent'">Configure lead capture</button></div><div class="panel table-panel"><div class="table-heading"><span>Lead</span><span>Intent</span><span>Status</span><span>Captured</span></div><div v-for="lead in leads" :key="lead.name" class="table-row"><div class="lead-name"><span class="lead-avatar">{{ lead.name.charAt(0) }}</span><strong>{{ lead.name }}</strong></div><span>{{ lead.intent }}</span><span :class="['status-pill', lead.status.toLowerCase()]">{{ lead.status }}</span><small>{{ lead.time }}</small></div></div></div>

        <div v-else-if="view === 'agent'" class="view-content"><div class="section-toolbar"><div><p class="eyebrow">Make it yours</p><h2>Agent & widget</h2><p>Customize the demo, then publish it to a real business website.</p></div><div class="toolbar-actions"><span v-if="savedMessage" class="saved-message">✓ {{ savedMessage }}</span><button class="outline-button" type="button" @click="view = 'overview'">Test conversation</button><button class="primary-button small" type="button" @click="saveAgent">Save & publish</button></div></div><div class="agent-layout"><article class="panel form-panel"><div class="form-section"><h3>Agent identity</h3><label>Assistant name<input v-model="assistantName" type="text" /></label><label>Welcome message<textarea v-model="welcomeMessage" rows="5"></textarea></label><label>Widget color<div class="color-row"><button v-for="color in ['#0d6efd','#18a999','#7447d9','#f27b35','#112c64']" :key="color" type="button" :class="['color-swatch', { selected: widgetColor === color }]" :style="{ background: color }" @click="widgetColor = color"></button></div></label></div><div class="form-section"><h3>Lead capture</h3><label class="toggle-row"><span>Collect lead information</span><input v-model="showLeadCapture" type="checkbox" /></label><label class="toggle-row"><span>Show booking action button</span><input type="checkbox" checked /></label><label class="toggle-row"><span>Offer human handoff when uncertain</span><input type="checkbox" checked /></label></div></article><article class="panel live-preview"><div class="preview-browser"><div class="preview-browser-bar"><span class="window-dot red"></span><span class="window-dot yellow"></span><span class="window-dot green"></span><span>https://britishswimschool.com/tampa-bay/</span></div><div class="preview-site"><div class="preview-site-nav"><strong>BRITISH SWIM SCHOOL</strong><span>Programs　Locations　FAQs　About</span><button>Enroll now</button></div><div class="preview-site-hero"><div><h2>Swim lessons<br />for all ages</h2><p>Building safer, stronger, more confident swimmers.</p><button>Find a location →</button></div><div class="fake-swimmer">◉</div></div><div class="preview-chat" :style="{ '--accent': widgetColor }"><div class="chat-header"><span class="mini-orb">✦</span><span>{{ assistantName }}</span><span class="online-dot"></span></div><div class="chat-bubble">{{ welcomeMessage }}</div><div class="suggested-question">What swim programs do you offer? <span>›</span></div><div class="suggested-question">How do I enroll my child? <span>›</span></div><button v-if="showLeadCapture" class="chat-cta" type="button">Get started / Request information</button><div class="chat-input">Type your question… <span>➤</span></div></div></div></div></article></div></div>

        <div v-else class="view-content empty-view"><div class="empty-icon">{{ view === 'conversations' ? '◌' : view === 'knowledge' ? '▤' : 'ϟ' }}</div><p class="eyebrow">{{ pageTitle }}</p><h2>This surface is ready for the first real business.</h2><p>We’ll connect this view to tenant-scoped data, grounded answers, and real actions next.</p><button class="primary-button small" type="button" @click="view = 'overview'">Back to overview</button></div>
      </section>
    </section>
  </main>
</template>

