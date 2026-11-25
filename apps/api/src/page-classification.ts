export const PAGE_TYPES = [
  "service",
  "pricing",
  "booking",
  "demo",
  "contact",
  "location",
  "emergency",
  "faq",
  "policy",
  "blog",
  "cart",
  "checkout",
  "account",
  "other",
] as const;

export type PageType = typeof PAGE_TYPES[number];

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Classifies a page from stable URL/title/content signals. This is a prior for
 * crawl ordering and source weighting, not an answerability decision. */
export function classifyPage(url: string, title = "", text = ""): PageType {
  const value = normalized(`${url} ${title} ${text.slice(0, 4_000)}`);
  const pathname = (() => {
    try { return new URL(url).pathname.toLowerCase(); } catch { return url.toLowerCase(); }
  })();

  if (/cart|basket|shopping-cart|(?:^|\/)shop(?:\/|$)|(?:^|\/)store(?:\/|$)/.test(pathname) || /\b(cart|shopping cart|basket)\b/.test(value)) return "cart";
  if (/checkout|payment|order-confirmation/.test(pathname) || /\b(checkout|payment details|order confirmation)\b/.test(value)) return "checkout";
  // Registration/enrollment pages usually explain the business process and
  // belong in knowledge. Keep only authenticated account surfaces out of the
  // crawl so a public /register page is not silently discarded.
  if (/account|login|signin|sign-in|my-account|parent-portal/.test(pathname) || /\b(log in|login|sign in|create account|parent portal|my account)\b/.test(value)) return "account";
  if (/emergency|urgent|24[- ]?7/.test(value) || /emergency|urgent/.test(pathname)) return "emergency";
  if (/demo|request-a-demo|book-a-demo/.test(pathname) || /\b(request|book|schedule)\s+(a\s+)?demo\b/.test(value)) return "demo";
  if (/book|booking|appointment|schedule|reservation|reserve|enroll|enrollment|register|tour|waitlist|wait-list/.test(pathname)
    || /\b(schedule|book|reserve|enroll|register|join the waitlist|schedule a tour)\b/.test(value)) return "booking";
  if (/price|pricing|cost|rates?|fees?|plans?/.test(pathname) || /\b(price|pricing|cost|rates?|fees?|plans?)\b/.test(value)) return "pricing";
  if (/faq|frequently-asked|questions/.test(pathname) || /\bfrequently asked questions?\b|\bfaq\b/.test(value)) return "faq";
  if (/privacy|terms|policy|legal|cookie|cancellation|refund/.test(pathname) || /\b(privacy|terms of service|legal|cookie policy|cancellation policy)\b/.test(value)) return "policy";
  if (/contact|locations?|hours|directions|about|visit/.test(pathname) || /\b(contact us|locations?|office hours|opening hours|directions|visit us)\b/.test(value)) return "contact";
  if (/blog|news|article|insight|post\//.test(pathname) || /\b(blog|news|article|insight)\b/.test(value)) return "blog";
  if (/service|solution|product|feature|program|class|treatment|repair|installation|maintenance|play|membership/.test(pathname)
    || /\b(services?|solutions?|products?|features?|programs?|classes?|treatments?|repairs?|maintenance)\b/.test(value)) return "service";
  return "other";
}

/** Higher scores are crawled earlier when a finite page budget is applied. */
export function crawlPriority(url: string, depth = 1): number {
  const type = classifyPage(url);
  const score: Record<PageType, number> = {
    emergency: 1_000,
    booking: 900,
    demo: 880,
    pricing: 800,
    service: 700,
    contact: 600,
    location: 580,
    faq: 500,
    policy: 400,
    other: 300,
    blog: 100,
    account: 40,
    cart: 10,
    checkout: 0,
  };
  return score[type] - Math.min(depth, 4) * 3;
}
