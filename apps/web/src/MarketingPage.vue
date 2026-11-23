<script setup lang="ts">
import { computed, ref } from "vue";
import { getMarketingPageByPath, marketingHref, type MarketingPage } from "./marketing";

const props = defineProps<{ pagePath: string }>();
const emit = defineEmits<{ (event: "start-demo"): void }>();

const page = computed<MarketingPage>(() => getMarketingPageByPath(props.pagePath) ?? {
  key: "missing",
  path: props.pagePath,
  type: "commercial",
  eyebrow: "FrontDeskWise",
  title: "A useful AI front desk for your website",
  description: "Answer questions, capture leads, and make the next step clear.",
  intro: "FrontDeskWise helps local businesses turn website conversations into useful next steps.",
  primaryCta: "Build from your website",
  secondaryCta: "Explore FrontDeskWise",
});

const pricingPlans = [
  { key: "starter", name: "Starter", price: "$99", businesses: "1 business", usage: "300 AI conversations / month", description: "Grounded answers, lead capture, and a clear starting point.", featured: false, custom: false, bullets: ["Website knowledge", "Lead capture + email alerts", "Basic analytics", "Website widget"] },
  { key: "growth", name: "Growth", price: "$199", businesses: "1 business", usage: "1,000 AI conversations / month", description: "Booking workflows, integrations, and visibility for teams focused on outcomes.", featured: true, custom: false, bullets: ["Everything in Starter", "Booking workflows", "CRM integrations", "Human handoff + reporting"] },
  { key: "multi_business", name: "Business Plus", price: "$349", businesses: "Up to 2 businesses", usage: "2,000 shared AI conversations / month", description: "Shared operations for higher-volume businesses under one organization.", featured: false, custom: false, bullets: ["Everything in Growth", "Shared team workspace", "Advanced workflows", "Cross-business analytics"] },
  { key: "portfolio", name: "Portfolio / Agency", price: "Custom", businesses: "Pooled locations", usage: "Pooled usage limits", description: "Per-location pricing with centralized administration and partner terms.", featured: false, custom: true, bullets: ["Centralized administration", "Partner discounts", "Custom integrations", "Priority support"] },
];

const readinessUrl = ref("");
const readinessAnswers = ref([false, false, false, false]);
const readinessScore = ref<number | null>(null);
const readinessMessage = ref("");

const relatedPages = computed(() => (page.value.related ?? [])
  .map((key) => ({ key, page: getMarketingPageByPath(marketingHref(key)) }))
  .filter((item): item is { key: string; page: MarketingPage } => Boolean(item.page)));
const workflowSteps = computed(() => page.value.workflow ?? page.value.flow ?? []);

const readinessItems = [
  "Services and locations are easy to find",
  "Hours, policies, and contact details are current",
  "The booking or inquiry path is clear",
  "Common customer questions have useful answers",
];

function calculateReadiness() {
  const answered = readinessAnswers.value.filter(Boolean).length;
  const hasUrl = /^https?:\/\/.+\..+/.test(readinessUrl.value.trim());
  readinessScore.value = Math.min(100, (hasUrl ? 20 : 0) + answered * 20);
  readinessMessage.value = readinessScore.value >= 80
    ? "Your site has a strong starting point. Test the assistant against real customer questions next."
    : readinessScore.value >= 40
      ? "You have useful building blocks. Improve the unchecked areas before relying on the assistant for conversion."
      : "Start with the unchecked basics. Clear source material and a visible next step will make the assistant more useful.";
}

function childHref(path: string) {
  return path;
}

function secondaryHref() {
  const destinations: Record<string, string> = {
    partners: "/partner",
    industries: "/use-cases",
    "use-cases": "/industries",
    integrations: "/features",
    resources: "/use-cases",
    contact: "mailto:hello@frontdeskwise.com",
  };
  return destinations[page.value.key] ?? (page.value.type === "commercial" ? "/features" : "/ai-front-desk");
}
</script>

<template>
  <section class="marketing-page-shell">
    <header class="marketing-nav marketing-page-nav">
      <a class="brand-mark" href="/" aria-label="FrontDeskWise home">
        <img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" />
        <span>FrontDesk<span>Wise</span></span>
      </a>
      <nav class="marketing-page-nav-links" aria-label="Marketing navigation">
        <a href="/features">Features</a>
        <a href="/industries">Industries</a>
        <a href="/use-cases">Use cases</a>
        <a href="/resources">Resources</a>
        <a href="/pricing">Pricing</a>
      </nav>
      <div class="marketing-page-nav-actions">
        <a class="text-button" href="/auth/sign-in">Sign in</a>
        <button class="primary-button small" type="button" @click="emit('start-demo')">{{ page.primaryCta }}</button>
      </div>
    </header>

    <main>
      <section class="marketing-page-hero">
        <div class="marketing-page-hero-copy">
          <p class="eyebrow"><span class="pulse-dot"></span>{{ page.eyebrow }}</p>
          <h1>{{ page.title }}</h1>
          <p class="marketing-page-description">{{ page.description }}</p>
          <p class="marketing-page-intro">{{ page.intro }}</p>
          <div class="marketing-page-cta-row">
            <button class="primary-button" type="button" @click="emit('start-demo')">{{ page.primaryCta }}</button>
            <a class="outline-button" :href="secondaryHref()">{{ page.secondaryCta }}</a>
          </div>
        </div>
        <aside class="marketing-page-hero-card" aria-label="FrontDeskWise workflow">
          <span class="marketing-page-card-kicker">THE FRONT DESK LOOP</span>
          <strong>Question → answer → next step</strong>
          <div class="marketing-page-loop"><span>Grounded reply</span><span>Useful detail</span><span>Lead or booking</span><span>Human when needed</span></div>
          <small>Built around your business knowledge and the actions your team already uses.</small>
        </aside>
      </section>

      <section v-if="page.key === 'pricing'" class="marketing-page-section marketing-page-pricing-section">
        <div class="marketing-page-section-heading"><p class="eyebrow">Choose the operating level</p><h2>Plans that scale with conversations and outcomes.</h2><p>Every paid plan starts with a 7-day trial. Pick the level that matches your business today; move to pooled agency capacity when one workspace is no longer enough.</p></div>
        <div class="pricing-grid marketing-page-pricing-grid">
          <article v-for="plan in pricingPlans" :key="plan.key" :class="['pricing-card', { featured: plan.featured }]">
            <span v-if="plan.featured" class="pricing-badge">Most likely to fit</span>
            <h3>{{ plan.name }}</h3><p>{{ plan.description }}</p>
            <strong class="pricing-price">{{ plan.price }}<small v-if="!plan.custom">/month</small></strong>
            <span class="pricing-businesses">{{ plan.businesses }}</span><span class="pricing-usage">{{ plan.usage }}</span>
            <ul class="landing-plan-bullets"><li v-for="bullet in plan.bullets" :key="bullet">✓ {{ bullet }}</li></ul>
            <button v-if="!plan.custom" class="primary-button small" type="button" @click="emit('start-demo')">Start 7-day trial</button>
            <a v-else class="outline-button small pricing-plan-cta" href="mailto:hello@frontdeskwise.com?subject=FrontDeskWise%20Portfolio%20pricing">Talk to sales</a>
          </article>
        </div>
        <p class="pricing-guardrail-note">AI conversation allowances are measured per visitor session with abuse filtering. Portfolio / Agency uses custom pooled capacity instead of a five-location bundle.</p>
      </section>

      <section v-if="page.children?.length" class="marketing-page-section marketing-page-directory">
        <div class="marketing-page-section-heading"><p class="eyebrow">Explore the surface</p><h2>Start with the problem closest to your business.</h2><p>Each page focuses on a distinct workflow, audience, or decision.</p></div>
        <div class="marketing-page-card-grid">
          <a v-for="child in page.children" :key="child.key" class="marketing-page-card" :href="childHref(child.path)">
            <span class="marketing-page-card-kicker">{{ page.type === 'hub' ? page.eyebrow : 'Related workflow' }}</span>
            <h3>{{ child.title }}</h3>
            <p>{{ child.description }}</p>
            <span class="marketing-page-card-link">Explore page</span>
          </a>
        </div>
      </section>

      <section v-if="page.workflow?.length || page.flow?.length" class="marketing-page-section marketing-page-workflow-section">
        <div class="marketing-page-section-heading"><p class="eyebrow">How it works</p><h2>Make the next customer step easier to complete.</h2></div>
        <div class="marketing-page-workflow">
          <article v-for="(step, index) in workflowSteps" :key="step" class="marketing-page-workflow-step"><span>{{ String(index + 1).padStart(2, '0') }}</span><div><h3>{{ step }}</h3><p v-if="index === 0">The visitor starts with the question or request they already have.</p><p v-else-if="index === workflowSteps.length - 1">The business gets a clear next step with context attached.</p><p v-else>Keep the interaction focused on the information that changes what happens next.</p></div></article>
        </div>
      </section>

      <section v-if="page.type === 'industry'" class="marketing-page-section marketing-page-industry-section">
        <div class="marketing-page-section-heading"><p class="eyebrow">Make it specific</p><h2>Design the conversation around the work your team actually does.</h2><p>These details are where an industry workflow becomes more than a keyword swap.</p></div>
        <div class="marketing-page-detail-grid">
          <article><h3>Questions customers ask</h3><ul><li v-for="item in page.customerQuestions" :key="item">{{ item }}</li></ul></article>
          <article><h3>Context worth capturing</h3><ul><li v-for="item in page.captures" :key="item">{{ item }}</li></ul></article>
          <article><h3>Useful integrations</h3><ul><li v-for="item in page.integrations" :key="item">{{ item }}</li></ul></article>
          <article class="marketing-page-handoff-card"><h3>Human handoff boundary</h3><p>{{ page.handoff }}</p></article>
        </div>
      </section>

      <section v-if="page.articleSections?.length" class="marketing-page-section marketing-page-article-section">
        <div class="marketing-page-section-heading"><p class="eyebrow">A practical guide</p><h2>Useful context before you choose a workflow.</h2></div>
        <article class="marketing-page-article">
          <div v-for="articleSection in page.articleSections" :key="articleSection.heading" class="marketing-page-article-block"><h3>{{ articleSection.heading }}</h3><p>{{ articleSection.body }}</p></div>
        </article>
      </section>

      <section v-for="section in page.sections" :key="section.heading" class="marketing-page-section marketing-page-content-section">
        <div class="marketing-page-content-card"><div><p class="eyebrow">{{ page.eyebrow }}</p><h2>{{ section.heading }}</h2><p>{{ section.body }}</p></div><ul v-if="section.bullets"><li v-for="bullet in section.bullets" :key="bullet">{{ bullet }}</li></ul></div>
      </section>

      <section v-if="page.tool" class="marketing-page-section marketing-page-tool-section" id="readiness-checker">
        <div class="marketing-page-section-heading"><p class="eyebrow">Free tool</p><h2>Get a practical readiness score in under a minute.</h2><p>Your answers stay in this page. This is a self-assessment, not a claim that we crawled your site.</p></div>
        <form class="marketing-readiness-tool" @submit.prevent="calculateReadiness">
          <label>Website URL<input v-model="readinessUrl" type="url" placeholder="https://yourbusiness.com" required /></label>
          <div class="marketing-readiness-checks"><label v-for="(item, index) in readinessItems" :key="item" class="marketing-readiness-check"><input v-model="readinessAnswers[index]" type="checkbox" /><span>{{ item }}</span></label></div>
          <button class="primary-button" type="submit">Calculate readiness score</button>
          <output v-if="readinessScore !== null" class="marketing-readiness-result"><strong>{{ readinessScore }}%</strong><span>{{ readinessMessage }}</span><a href="/resources/how-to-add-ai-assistant-to-website">See how to improve your starting point</a></output>
        </form>
      </section>

      <section v-if="page.faqs?.length" class="marketing-page-section marketing-page-faq-section">
        <div class="marketing-page-section-heading"><p class="eyebrow">Questions owners ask</p><h2>Clear answers before you get started.</h2></div>
        <div class="marketing-page-faq-list"><details v-for="faq in page.faqs" :key="faq.question"><summary>{{ faq.question }}</summary><p>{{ faq.answer }}</p></details></div>
      </section>

      <section v-if="relatedPages.length" class="marketing-page-related">
        <div><p class="eyebrow">Keep exploring</p><h2>Build the next part of the system.</h2></div>
        <div class="marketing-page-related-links"><a v-for="item in relatedPages" :key="item.key" :href="item.page.path">{{ item.page.title }}</a></div>
      </section>

      <section class="marketing-page-final-cta"><div><p class="eyebrow">Start with your website</p><h2>See what FrontDeskWise can build from the information you already have.</h2><p>Review the knowledge, test real questions, and decide what should happen next.</p></div><button class="primary-button" type="button" @click="emit('start-demo')">{{ page.primaryCta }}</button></section>
    </main>

    <footer class="marketing-footer marketing-page-footer"><div><strong>FrontDeskWise</strong><span>AI front desk for local businesses.</span></div><nav aria-label="Footer navigation"><a href="/features">Features</a><a href="/industries">Industries</a><a href="/integrations">Integrations</a><a href="/resources">Resources</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><small>© 2026 Sudo Programmer, Inc. · FrontDeskWise</small></footer>
  </section>
</template>
