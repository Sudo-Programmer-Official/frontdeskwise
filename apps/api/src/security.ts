import { createHash } from "node:crypto";

export type SecurityEventRisk = "low" | "medium" | "high" | "critical";

const PROMPT_INJECTION_PATTERNS = [
  /\bignore\s+(?:all\s+)?(?:previous|prior|above)\s+instructions\b/i,
  /\b(?:reveal|show|print|expose)\b.{0,40}\b(?:system prompt|developer message|hidden instructions|secret|token)\b/i,
  /\b(?:call|invoke|run|execute)\b.{0,32}\b(?:every|all|admin|private|internal)\b.{0,32}\b(?:tool|action|function|api)\b/i,
  /\b(?:bypass|override|disable)\b.{0,32}\b(?:policy|permission|authorization|tenant|safety)\b/i,
  /\bact\s+as\s+(?:the\s+)?(?:system|developer|admin)\b/i,
];

export function looksLikePromptInjection(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, " ").trim().slice(0, 4_000);
  return PROMPT_INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function securityRiskForPromptInjection(value: unknown): SecurityEventRisk {
  if (!looksLikePromptInjection(value)) return "low";
  const text = String(value).toLowerCase();
  return /(?:private|internal|secret|token|admin|every tool|all tools|tenant)/.test(text) ? "high" : "medium";
}

export function hashSecurityIdentifier(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  return createHash("sha256").update(value.trim()).digest("hex");
}

export function boundedSecurityMetadata(value: unknown, maxEntries = 20): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const metadata: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value).slice(0, maxEntries)) {
    const safeKey = key.replace(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 80);
    if (!safeKey) continue;
    if (typeof item === "string") metadata[safeKey] = item.replace(/\s+/g, " ").slice(0, 240);
    else if (typeof item === "number" && Number.isFinite(item)) metadata[safeKey] = Math.round(item * 100) / 100;
    else if (typeof item === "boolean" || item === null) metadata[safeKey] = item;
  }
  return metadata;
}

export function firebaseEmailVerifiedClaim(claims: Record<string, unknown>): boolean {
  return claims.email_verified === true;
}

