/**
 * Customer-facing response validation.
 *
 * This module is intentionally dependency-free and synchronous. It is the
 * cheap gateway that every answer can pass through before it is persisted or
 * sent to a visitor. Semantic verification remains an exception path owned by
 * the caller; it should not be required for ordinary state or fact answers.
 */

export type ResponseValidationTier = 1 | 2 | 3;

export type ResponseValidationReason =
  | "ANSWER_RENDER_FAILURE"
  | "STRUCTURED_OUTPUT_PARSE_FAILURE"
  | "RETRIEVAL_LOW_CONFIDENCE"
  | "CONFLICTED_EVIDENCE"
  | "STATE_MISSING"
  | "MODEL_FAILURE"
  | "EMPTY_RESPONSE"
  | "UNSUPPORTED_CUSTOMER_COPY"
  | "ANSWER_NOT_GROUNDED";

export type SafeFallbackKind = "no_reliable_evidence" | "temporary_technical_failure" | "state_missing";

export const customerSafeFallbacks: Record<SafeFallbackKind, string> = {
  no_reliable_evidence: "I don’t have enough verified information to answer that confidently.",
  temporary_technical_failure: "I’m having trouble completing that right now. I can still help with something else, or connect you with the team.",
  state_missing: "I don’t have your contact details yet. What’s the best email or phone number to reach you?",
};

export type ResponseValidationInput = {
  question?: string;
  answer: unknown;
  publicTerms?: readonly string[];
  route?: "state" | "workflow" | "provider" | "knowledge" | "generative" | "handoff" | "system";
  grounded?: boolean;
  confidenceScore?: number;
  citations?: readonly unknown[];
  hasReliableEvidence?: boolean;
  evidence?: string;
  conflictCount?: number;
  structuralFailure?: boolean;
  semanticVerified?: boolean;
};

export type ResponseValidationResult = {
  accepted: boolean;
  answer: string;
  tier: ResponseValidationTier;
  latencyMs: number;
  reason: ResponseValidationReason | null;
  fallbackKind: SafeFallbackKind | null;
  suspicious: boolean;
  customerCopyRewritten: boolean;
};

// These phrases describe implementation details and are never appropriate in
// visitor copy. Keep the list broad enough to catch provider/parser leakage,
// while allowing the intentionally generic "I'm having trouble" fallback.
const internalFailureCopy = /(?:trouble\s+(?:formatting|parsing|rendering)|found relevant information[\s\S]{0,80}(?:format|parse|render)|json\s+(?:parsing|parse)|structured\s+output|tool\s+(?:returned|failed|error)|retrieval\s+(?:failed|error)|model\s+(?:failure|error)|stack\s+trace|uncaught\s+(?:exception|error)|internal\s+(?:error|failure)|parse\s+(?:failed|error)|validation\s+(?:failed|error)|insufficient_evidence)/i;
const implementationPayload = /^\s*[\[{][\s\S]*(?:"?(?:tool|retrieval|error|stack|trace|json|reason)"?\s*:|```(?:json|javascript|typescript))/i;
const customerFacingInternalTerms = /\b(?:jackrabbit|providers?|apis?|endpoints?|workflows?|tools?|rag|retrieval|databases?|authorization\s+gates?)\b/i;

function explicitlyAskedAboutJackrabbit(question: string): boolean {
  const value = question.trim();
  return /\bjackrabbit\b/i.test(value)
    && (/[?]/.test(value) || /^(?:do|does|is|are|what|which|can|how)\b/i.test(value))
    && /\b(?:use|using|connected|connect|integration|system|platform|jackrabbit)\b/i.test(value);
}

/** Rewrite implementation vocabulary at the customer-facing boundary. */
export function rewriteCustomerFacingTerminology(value: string, question = "", publicTerms: readonly string[] = []): { text: string; rewritten: boolean } {
  const allowJackrabbit = explicitlyAskedAboutJackrabbit(question);
  const original = value;
  const protectedCopy = protectCustomerCopyTokens(value, [
    ...publicTerms,
    ...(allowJackrabbit ? ["Jackrabbit"] : []),
  ]);
  const text = protectedCopy.restore(protectedCopy.text
    .replace(/\b(?:I|we) couldn['’]t check live jackrabbit availability right now\b/gi, "I can’t confirm live availability right now")
    .replace(/\blive\s+jackrabbit\s+availability\b/gi, "live availability")
    .replace(/\bjackrabbit\b/gi, (match) => allowJackrabbit ? match : "the scheduling system")
    .replace(/\bprovider\s+API\b/gi, "connected system")
    .replace(/\bproviders?\b/gi, "connected system")
    .replace(/\bAPIs?\b/gi, "system connection")
    .replace(/\bendpoints?\b/gi, "link")
    .replace(/\bworkflows?\b/gi, "next steps")
    .replace(/\btool calls?\b/gi, "system actions")
    .replace(/\btools?\b/gi, "capabilities")
    .replace(/\bRAG\b/gi, "business information")
    .replace(/\bretrieval\b/gi, "business information")
    .replace(/\bdatabases?\b/gi, "records")
    .replace(/\bauthorization gates?\b/gi, "verification")
    .replace(/\bauthorization\b/gi, "access verification"));
  return { text, rewritten: text !== original };
}

function asCustomerText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function protectCustomerCopyTokens(value: string, publicTerms: readonly string[]): { text: string; restore: (value: string) => string } {
  const protectedValues: string[] = [];
  let text = value.replace(/https?:\/\/[^\s<>"']+/gi, (match) => {
    const token = `__CUSTOMER_COPY_TOKEN_${protectedValues.length}__`;
    protectedValues.push(match);
    return token;
  });
  for (const term of [...publicTerms].map((item) => item.trim()).filter(Boolean).sort((left, right) => right.length - left.length)) {
    text = text.replace(new RegExp(escapeRegExp(term), "gi"), (match) => {
      const token = `__CUSTOMER_COPY_TOKEN_${protectedValues.length}__`;
      protectedValues.push(match);
      return token;
    });
  }
  return {
    text,
    restore: (input) => input.replace(/__CUSTOMER_COPY_TOKEN_(\d+)__/g, (_match, index: string) => protectedValues[Number(index)] ?? _match),
  };
}

function fallbackKindFor(reason: ResponseValidationReason): SafeFallbackKind {
  if (reason === "STATE_MISSING") return "state_missing";
  if ([
    "ANSWER_RENDER_FAILURE",
    "STRUCTURED_OUTPUT_PARSE_FAILURE",
    "MODEL_FAILURE",
    "EMPTY_RESPONSE",
    "UNSUPPORTED_CUSTOMER_COPY",
  ].includes(reason)) return "temporary_technical_failure";
  return "no_reliable_evidence";
}

function reasonForInput(input: ResponseValidationInput, answer: string): ResponseValidationReason | null {
  if (input.structuralFailure) return "STRUCTURED_OUTPUT_PARSE_FAILURE";
  if (!answer) return "EMPTY_RESPONSE";
  if (internalFailureCopy.test(answer) || implementationPayload.test(answer)) {
    return /format|render/i.test(answer) ? "ANSWER_RENDER_FAILURE" : "UNSUPPORTED_CUSTOMER_COPY";
  }
  if (input.route === "knowledge" || input.route === "generative") {
    if (input.conflictCount && input.conflictCount > 0) return "CONFLICTED_EVIDENCE";
    if (input.grounded === true && input.hasReliableEvidence === false) return "ANSWER_NOT_GROUNDED";
    if (input.hasReliableEvidence === false) return "RETRIEVAL_LOW_CONFIDENCE";
  }
  return null;
}

/**
 * Run the deterministic validation tiers. The result is safe to use directly
 * as customer copy when accepted, or as the fallback decision when rejected.
 */
export function validateCustomerResponse(input: ResponseValidationInput): ResponseValidationResult {
  const startedAt = performance.now();
  const rawAnswer = asCustomerText(input.answer);
  const terminology = rewriteCustomerFacingTerminology(rawAnswer, input.question, input.publicTerms);
  const answer = terminology.text;
  const reason = reasonForInput(input, rawAnswer) ?? reasonForInput(input, answer);
  const suspicious = Boolean(
    reason
    || (input.route === "knowledge" || input.route === "generative")
      && ((input.confidenceScore ?? 1) < 0.78 || input.conflictCount && input.conflictCount > 0),
  );
  const tier: ResponseValidationTier = input.semanticVerified
    ? 3
    : input.route === "knowledge" || input.route === "generative" ? 2 : 1;
  const fallbackKind = reason ? fallbackKindFor(reason) : null;
  return {
    accepted: !reason,
    answer: reason ? customerSafeFallbacks[fallbackKind!] : answer,
    tier,
    latencyMs: Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100),
    reason,
    fallbackKind,
    suspicious,
    customerCopyRewritten: terminology.rewritten,
  };
}

/**
 * Decide whether a semantic verifier is worth its network round trip. Simple,
 * high-confidence grounded answers stay on deterministic validation only.
 */
export function shouldRunSemanticVerifier(input: {
  question: string;
  confidenceScore: number;
  hasReliableEvidence: boolean;
  conflictCount?: number;
  highRisk?: boolean;
}): boolean {
  const question = input.question.trim();
  const complex = question.split(/\?|\band\b|\balso\b|\bcompare\b|\bversus\b|\bwhich\b/gi).filter((part) => part.trim()).length >= 3
    || question.length > 220;
  return input.highRisk === true
    || input.conflictCount !== undefined && input.conflictCount > 0
    || input.confidenceScore < 0.78
    || !input.hasReliableEvidence
    || complex;
}

export function isInternalCustomerCopy(value: unknown, question = "", publicTerms: readonly string[] = []): boolean {
  const answer = asCustomerText(value);
  const rewritten = rewriteCustomerFacingTerminology(answer, question, publicTerms).text;
  const remainingTerms = explicitlyAskedAboutJackrabbit(question)
    ? /\b(?:providers?|apis?|endpoints?|workflows?|tools?|rag|retrieval|databases?|authorization\s+gates?)\b/i
    : customerFacingInternalTerms;
  const withoutUrls = rewritten.replace(/https?:\/\/[^\s<>"']+/gi, "");
  return Boolean(rewritten && (internalFailureCopy.test(withoutUrls) || implementationPayload.test(withoutUrls) || remainingTerms.test(withoutUrls)));
}

