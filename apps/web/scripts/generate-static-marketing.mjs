import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const siteOrigin = (process.env.VITE_SITE_ORIGIN || "https://www.frontdeskwise.com").replace(/\/$/, "");
const distDirectory = resolve(process.cwd(), "dist");
const template = await readFile(resolve(distDirectory, "index.html"), "utf8");
const pages = JSON.parse(await readFile(resolve(process.cwd(), "src/marketing-pages.json"), "utf8"));

function escapeHtml(value = "") {
  return String(value).replace(/[&<>\"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}

function pageByKey(key) {
  return pages.find((page) => page.key === key);
}

function secondaryHref(page) {
  const destinations = {
    industries: "/use-cases",
    "use-cases": "/industries",
    integrations: "/features",
    resources: "/use-cases",
    contact: "mailto:hello@frontdeskwise.com",
  };
  return destinations[page.key] || (page.type === "commercial" ? "/features" : "/ai-front-desk");
}

function staticMarketingMarkup(page) {
  const children = page.children?.length ? `<section class="marketing-page-section"><div class="marketing-page-section-heading"><p class="eyebrow">Explore the surface</p><h2>Start with the problem closest to your business.</h2></div><div class="marketing-page-card-grid">${page.children.map((child) => `<a class="marketing-page-card" href="${escapeHtml(child.path)}"><span class="marketing-page-card-kicker">${escapeHtml(page.eyebrow)}</span><h3>${escapeHtml(child.title)}</h3><p>${escapeHtml(child.description)}</p><span class="marketing-page-card-link">Explore page</span></a>`).join("")}</div></section>` : "";
  const article = page.articleSections?.length ? `<section class="marketing-page-section"><div class="marketing-page-section-heading"><p class="eyebrow">A practical guide</p><h2>Useful context before you choose a workflow.</h2></div><article class="marketing-page-article">${page.articleSections.map((section) => `<div class="marketing-page-article-block"><h3>${escapeHtml(section.heading)}</h3><p>${escapeHtml(section.body)}</p></div>`).join("")}</article></section>` : "";
  const sections = (page.sections || []).map((section) => `<section class="marketing-page-section"><div class="marketing-page-content-card"><div><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h2>${escapeHtml(section.heading)}</h2><p>${escapeHtml(section.body)}</p></div>${section.bullets?.length ? `<ul>${section.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}</ul>` : ""}</div></section>`).join("");
  const faqs = page.faqs?.length ? `<section class="marketing-page-section"><div class="marketing-page-section-heading"><p class="eyebrow">Questions owners ask</p><h2>Clear answers before you get started.</h2></div><div class="marketing-page-faq-list">${page.faqs.map((faq) => `<details><summary>${escapeHtml(faq.question)}</summary><p>${escapeHtml(faq.answer)}</p></details>`).join("")}</div></section>` : "";
  const related = page.related?.length ? `<section class="marketing-page-related"><div><p class="eyebrow">Keep exploring</p><h2>Build the next part of the system.</h2></div><div class="marketing-page-related-links">${page.related.map((key) => pageByKey(key)).filter(Boolean).map((relatedPage) => `<a href="${escapeHtml(relatedPage.path)}">${escapeHtml(relatedPage.title)}</a>`).join("")}</div></section>` : "";

  return `<section class="marketing-page-shell"><header class="marketing-nav marketing-page-nav"><a class="brand-mark" href="/"><img class="brand-logo" src="/frontdeskwise-logo-mark.png" alt="" aria-hidden="true" /><span>FrontDesk<span>Wise</span></span></a><nav class="marketing-page-nav-links" aria-label="Marketing navigation"><a href="/features">Features</a><a href="/industries">Industries</a><a href="/use-cases">Use cases</a><a href="/resources">Resources</a><a href="/pricing">Pricing</a></nav><div class="marketing-page-nav-actions"><a class="text-button" href="/auth/sign-in">Sign in</a><a class="primary-button small" href="/">${escapeHtml(page.primaryCta)}</a></div></header><main><section class="marketing-page-hero"><div class="marketing-page-hero-copy"><p class="eyebrow">${escapeHtml(page.eyebrow)}</p><h1>${escapeHtml(page.title)}</h1><p class="marketing-page-description">${escapeHtml(page.description)}</p><p class="marketing-page-intro">${escapeHtml(page.intro)}</p><div class="marketing-page-cta-row"><a class="primary-button" href="/">${escapeHtml(page.primaryCta)}</a><a class="outline-button" href="${secondaryHref(page)}">${escapeHtml(page.secondaryCta)}</a></div></div><aside class="marketing-page-hero-card"><span class="marketing-page-card-kicker">THE FRONT DESK LOOP</span><strong>Question → answer → next step</strong><div class="marketing-page-loop"><span>Grounded reply</span><span>Useful detail</span><span>Lead or booking</span><span>Human when needed</span></div><small>Built around your business knowledge and the actions your team already uses.</small></aside></section>${children}${article}${sections}${faqs}${related}<section class="marketing-page-final-cta"><div><p class="eyebrow">Start with your website</p><h2>See what FrontDeskWise can build from the information you already have.</h2><p>Your next customer may already be on the page. Give them a useful next step.</p></div><a class="primary-button" href="/">${escapeHtml(page.primaryCta)}</a></section></main><footer class="marketing-footer marketing-page-footer"><div><strong>FrontDeskWise</strong><span>AI front desk for local businesses.</span></div><nav aria-label="Footer navigation"><a href="/features">Features</a><a href="/industries">Industries</a><a href="/integrations">Integrations</a><a href="/resources">Resources</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav><small>© 2026 Sudo Programmer, Inc. · FrontDeskWise</small></footer></section>`;
}

function pageStructuredData(page) {
  const data = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: page.title,
    description: page.description,
    url: `${siteOrigin}${page.path}`,
    isPartOf: { "@type": "WebSite", name: "FrontDeskWise", url: siteOrigin },
    breadcrumb: {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "FrontDeskWise", item: siteOrigin },
        { "@type": "ListItem", position: 2, name: page.eyebrow, item: `${siteOrigin}${page.path}` },
      ],
    },
  };
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

for (const page of pages) {
  const routeDirectory = resolve(distDirectory, page.path.slice(1));
  const routeFile = resolve(routeDirectory, "index.html");
  const description = escapeHtml(page.description);
  const title = escapeHtml(`${page.title} · FrontDeskWise`);
  const canonical = `${siteOrigin}${page.path}`;
  const html = template
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${description}" />`)
    .replace(/<meta name="robots" content="[^"]*" \/>/, `<meta name="robots" content="index,follow" />`)
    .replace(/<link rel="canonical" href="[^"]*" \/>/, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta property="og:title" content="[^"]*" \/>/, `<meta property="og:title" content="${title}" />`)
    .replace(/<meta property="og:description" content="[^"]*" \/>/, `<meta property="og:description" content="${description}" />`)
    .replace(/<meta property="og:url" content="[^"]*" \/>/, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*" \/>/, `<meta name="twitter:title" content="${title}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*" \/>/, `<meta name="twitter:description" content="${description}" />`)
    .replace("</head>", `${pageStructuredData(page)}</head>`)
    .replace('<div id="app"></div>', `<div id="app">${staticMarketingMarkup(page)}</div>`);
  await mkdir(dirname(routeFile), { recursive: true });
  await writeFile(routeFile, html, "utf8");
}
