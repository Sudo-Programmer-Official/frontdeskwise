import { classifyPage } from "./page-classification.js";

export const WEBSITE_ACTION_TYPES = [
  "request_demo",
  "book_appointment",
  "enroll",
  "schedule_service",
  "request_quote",
  "call_business",
  "call_emergency",
  "external_booking",
  "join_waitlist",
  "contact_team",
] as const;

export type WebsiteActionType = typeof WEBSITE_ACTION_TYPES[number];

export type WebsiteActionCandidate = {
  actionType: WebsiteActionType;
  label: string;
  description: string;
  mode: "transactional";
  destination: { url: string; label: string } | null;
  provider: string | null;
  priority: number;
  requiredFields: string[];
  conditions: Array<{ field: string; contains?: string; equals?: string }>;
  safetyPolicy: "standard" | "verified_contact" | "healthcare_emergency" | "manual_review";
  sourceUrl: string;
  sourceType: "website";
  sourceLabel: string;
  discoveredAt: string;
  classificationReason: string;
  reviewReason: "low_confidence" | "unsafe_destination" | null;
  evidence: string[];
  confidence: number;
  enabled: boolean;
};

const actionRules: Array<{
  type: WebsiteActionType;
  pattern: RegExp;
  priority: number;
  fields: string[];
}> = [
  { type: "call_emergency", pattern: /\b(emergency|urgent|24\s*\/\s*7)\b.*\b(call|phone|tel|now)\b|\b(call|phone|tel)\b.*\b(emergency|urgent|24\s*\/\s*7)\b/i, priority: 1_000, fields: [] },
  { type: "request_demo", pattern: /\b(request|book|schedule|get|start)\b.{0,24}\bdemo\b|\bdemo\b.{0,24}\b(request|book|schedule|get|start)\b/i, priority: 880, fields: ["name", "email", "business_name"] },
  { type: "schedule_service", pattern: /\b(schedule|book|request)\b.{0,24}\b(service|repair|maintenance)\b/i, priority: 900, fields: ["service", "name", "email", "phone"] },
  { type: "join_waitlist", pattern: /\b(join|add me to|register for)\b.{0,24}\b(waitlist|waiting list)\b/i, priority: 850, fields: ["name", "email"] },
  { type: "external_booking", pattern: /\b(book|reserve|schedule)\b.{0,32}\b(birthday|party|open play|event|class|lesson)\b|\b(birthday|party|open play|event)\b.{0,32}\b(book|reserve|schedule)\b/i, priority: 840, fields: ["service", "preferred_date", "name", "email"] },
  { type: "enroll", pattern: /\b(enroll|enrollment|register|registration|sign\s+(?:me|my child|my student)\s+up|start enrollment)\b/i, priority: 830, fields: ["program", "location", "name", "email"] },
  { type: "book_appointment", pattern: /\b(book|schedule|make)\b.{0,24}\b(appointment|visit|consultation)\b|\bappointment\b/i, priority: 820, fields: ["service", "preferred_date", "preferred_time", "name", "email"] },
  { type: "request_quote", pattern: /\b(request|get|need)\b.{0,20}\b(quote|estimate)\b|\bhow much would it cost\b/i, priority: 800, fields: ["project", "name", "email", "phone"] },
  { type: "contact_team", pattern: /\b(contact|message|email|reach|talk to|speak with)\b.{0,24}\b(team|us|someone|staff)\b|\bcontact us\b/i, priority: 600, fields: ["name", "email", "message"] },
  { type: "call_business", pattern: /\b(call|phone|tel)\b|^\+?[\d ()-]{7,}$/i, priority: 590, fields: [] },
];

function stripMarkup(value: string): string {
  return value.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&#39;/g, "'").replace(/&quot;/gi, '"').replace(/\s+/g, " ").trim();
}

function sameSite(candidate: URL, root: URL): boolean {
  return candidate.protocol === root.protocol && candidate.hostname.replace(/^www\./i, "") === root.hostname.replace(/^www\./i, "");
}

function destinationFor(raw: string, sourceUrl: string): { url: string; provider: string | null } | null {
  try {
    const source = new URL(sourceUrl);
    const cleanRaw = raw.replace(/&(?:#\d+|#x[\da-f]+|[a-z]+);/gi, "");
    const destination = new URL(cleanRaw, source);
    if (destination.protocol === "tel:") {
      let telValue = `${cleanRaw.slice(cleanRaw.indexOf(":") + 1)}${destination.search}`;
      try { telValue = decodeURIComponent(telValue); } catch { /* Keep the encoded value and strip it below. */ }
      const phone = telValue.replace(/[^\d+]/g, "");
      return phone ? { url: `tel:${phone}`, provider: null } : null;
    }
    destination.hash = "";
    for (const key of [...destination.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$|mc_cid$|mc_eid$)/i.test(key)) destination.searchParams.delete(key);
    return { url: destination.toString(), provider: destination.protocol === "tel:" || sameSite(destination, source) ? null : destination.hostname.replace(/^www\./i, "") };
  } catch {
    return null;
  }
}

function candidateFor(label: string, sourceUrl: string, href: string | null, evidence: string): WebsiteActionCandidate | null {
  const match = actionRules
    .map((rule) => ({ rule, hit: rule.pattern.test(label) }))
    .filter((item) => item.hit)
    .sort((left, right) => right.rule.priority - left.rule.priority)[0];
  if (!match) return null;
  const destination = href ? destinationFor(href, sourceUrl) : null;
  if (destination && /(?:wp-comments-post|comment(?:s)?|logout|signout)/i.test(destination.url)) return null;
  const isEmergency = match.rule.type === "call_emergency";
  const healthcareEvidence = /\b(dental|dentist|medical|clinic|healthcare|health)\b/i.test(
    `${sourceUrl} ${label} ${evidence}`,
  );
  const confidence = destination || match.rule.type === "call_business" ? 0.92 : 0.76;
  const safeToEnable = confidence >= 0.88 && (!isEmergency || Boolean(destination?.url.startsWith("tel:")));
  const reviewReason = confidence < 0.88 ? "low_confidence" : !safeToEnable ? "unsafe_destination" : null;
  const discoveredAt = new Date().toISOString();
  return {
    actionType: match.rule.type,
    label: label.slice(0, 120),
    description: `${label.slice(0, 120)} discovered on ${classifyPage(sourceUrl)} page`,
    mode: "transactional",
    destination: destination ? { url: destination.url, label: label.slice(0, 120) } : null,
    provider: destination?.provider ?? null,
    priority: match.rule.priority,
    requiredFields: match.rule.fields,
    conditions: isEmergency ? [{ field: "visitor_intent", contains: "emergency" }] : [],
    safetyPolicy: isEmergency
      ? healthcareEvidence
        ? "healthcare_emergency"
        : "verified_contact"
      : match.rule.type === "call_business"
        ? "verified_contact"
        : "standard",
    sourceUrl,
    sourceType: "website",
    sourceLabel: label.slice(0, 240),
    discoveredAt,
    classificationReason: `Matched the ${match.rule.type} CTA rule from ${evidence.slice(0, 240)}`,
    reviewReason,
    evidence: [evidence.slice(0, 500)],
    confidence,
    enabled: safeToEnable,
  };
}

export function extractWebsiteActions(html: string, sourceUrl: string): WebsiteActionCandidate[] {
  const found: WebsiteActionCandidate[] = [];
  const add = (candidate: WebsiteActionCandidate | null): void => {
    if (!candidate) return;
    const key = `${candidate.actionType}|${candidate.destination?.url ?? ""}|${candidate.label.toLowerCase()}`;
    if (!found.some((item) => `${item.actionType}|${item.destination?.url ?? ""}|${item.label.toLowerCase()}` === key)) found.push(candidate);
  };

  const anchorPattern = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html))) {
    const label = stripMarkup(match[4]);
    if (label) add(candidateFor(label, sourceUrl, match[3], `anchor text: ${label}; href: ${match[3]}`));
  }
  const buttonPattern = /<button\b([^>]*)>([\s\S]*?)<\/button>/gi;
  while ((match = buttonPattern.exec(html))) {
    const label = stripMarkup(match[2]);
    if (label) add(candidateFor(label, sourceUrl, null, `button text: ${label}`));
  }
  const inputPattern = /<input\b([^>]*?)(?:value|aria-label)\s*=\s*(["'])(.*?)\2[^>]*>/gi;
  while ((match = inputPattern.exec(html))) {
    const inputType = /\btype\s*=\s*("|')([^"']+)\1/i.exec(match[1])?.[2]?.toLowerCase() ?? "";
    if (inputType === "hidden" || inputType === "password") continue;
    const label = stripMarkup(match[3]);
    if (label) add(candidateFor(label, sourceUrl, null, `input label: ${label}`));
  }
  const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
  while ((match = formPattern.exec(html))) {
    const actionMatch = /action\s*=\s*(["'])(.*?)\1/i.exec(match[1]);
    const context = stripMarkup(match[2]).slice(0, 300);
    const formUrl = actionMatch?.[2] ?? sourceUrl;
    const inferred = classifyPage(formUrl, "", context);
    const label = inferred === "demo" ? "Request a demo" : inferred === "booking" ? "Book an appointment" : inferred === "emergency" ? "Emergency contact" : inferred === "pricing" ? "Request a quote" : "Contact the team";
    add(candidateFor(label, sourceUrl, formUrl, `form action: ${formUrl}; context: ${context}`));
  }
  const telPattern = /href\s*=\s*(["'])(tel:[^"']+)\1/gi;
  while ((match = telPattern.exec(html))) {
    const context = stripMarkup(html.slice(Math.max(0, match.index - 180), Math.min(html.length, match.index + 220)));
    add(candidateFor(context.includes("emergency") || context.includes("24/7") ? "Emergency call" : "Call business", sourceUrl, match[2], `tel link: ${match[2]}; context: ${context}`));
  }
  return found.sort((left, right) => right.priority - left.priority || right.confidence - left.confidence).slice(0, 50);
}
