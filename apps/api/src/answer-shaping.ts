export type AnswerTone = "friendly" | "professional" | "concise" | "custom";

const MAX_CUSTOMER_WORDS = 120;

export function toneInstructions(tone: AnswerTone, customInstructions = ""): string {
  if (tone === "concise") return "Use a very short answer: one to three short sentences or three compact bullets, normally under 80 words.";
  if (tone === "professional") return "Use structured but compact business language: two to five short sentences or three to five compact bullets, normally under 120 words.";
  if (tone === "custom" && customInstructions.trim()) return `Follow these owner instructions while keeping the answer compact (normally under 120 words): ${customInstructions.trim().slice(0, 600)}`;
  if (tone === "custom") return "Use the configured custom style while keeping the answer compact: two to five short sentences or three to five compact bullets, normally under 120 words.";
  return "Use a short, warm, conversational answer: two to five short sentences or three to five compact bullets, normally under 120 words.";
}

function wordCount(value: string): number {
  return value.trim() ? value.trim().split(/\s+/).length : 0;
}

function trimToWords(value: string, maxWords = MAX_CUSTOMER_WORDS): string {
  if (wordCount(value) <= maxWords) return value.trim();
  const words = value.trim().split(/\s+/).slice(0, maxWords);
  return `${words.join(" ").replace(/[,:;\-–—]+$/, "")}…`;
}

/**
 * Keep extractive/model answers useful in a small chat bubble. This only
 * removes excess evidence; it never invents a fact or changes fixed-response
 * wording.
 */
export function shapeCustomerAnswer(value: string, tone: AnswerTone = "friendly"): string {
  const answer = value.trim();
  if (!answer || tone === "custom" && wordCount(answer) <= MAX_CUSTOMER_WORDS) return answer;

  const lines = answer.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const listLines = lines.filter((line) => /^\s*(?:\d+[.)]|[-*+])\s+/.test(line));
  if (listLines.length > 5) {
    const intro = lines.find((line) => !/^\s*(?:\d+[.)]|[-*+])\s+/.test(line)) ?? "";
    const selected = listLines.slice(0, tone === "concise" ? 3 : 5);
    const suffix = listLines.length > selected.length ? "\n\nAsk if you’d like the remaining steps." : "";
    return trimToWords([intro, ...selected, suffix].filter(Boolean).join("\n"), tone === "concise" ? 80 : MAX_CUSTOMER_WORDS);
  }

  if (wordCount(answer) <= MAX_CUSTOMER_WORDS) return answer;
  const sentences = answer.match(/[^.!?]+[.!?]+(?=\s|$)/g)?.map((sentence) => sentence.trim()) ?? [];
  const selected = sentences.slice(0, tone === "concise" ? 3 : 5).join(" ");
  return trimToWords(selected || answer, tone === "concise" ? 80 : MAX_CUSTOMER_WORDS);
}
