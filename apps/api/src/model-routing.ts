export type ModelRoute = "tier0" | "tier1" | "tier2";

export type ModelUsage = {
  route: ModelRoute;
  model: string | null;
  reason: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number | null;
  latencyMs: number;
};

type RouteDecision = {
  route: ModelRoute;
  model: string | null;
  reason: string;
};

type GroundedAnswerInput = {
  question: string;
  context: string;
  decision: RouteDecision;
};

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const defaultTier1Model = "gpt-4o-mini";
const defaultTier2Model = "gpt-4o";

function numberEnv(name: string): number | null {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function llmConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim()) && process.env.FRONTDESKWISE_LLM_ENABLED?.trim().toLowerCase() !== "false";
}

export function routeQuestion(input: { question: string; hasMatch: boolean; confidenceScore: number; candidateCount: number }): RouteDecision {
  const question = input.question.trim();
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b[.!? ]*$/i.test(question)) {
    return { route: "tier0", model: null, reason: "deterministic_greeting" };
  }
  if (!input.hasMatch) return { route: "tier2", model: llmConfigured() ? modelForRoute("tier2") : null, reason: "no_strong_evidence" };
  const parts = question.split(/\?|\band\b|\balso\b|\bcompare\b|\bversus\b|\bwhich\b/gi).filter((part) => part.trim()).length;
  const complex = parts >= 3 || question.length > 220;
  const ambiguous = input.confidenceScore < 0.68 || input.candidateCount > 5;
  const route: ModelRoute = complex || ambiguous ? "tier2" : "tier1";
  return {
    route,
    model: llmConfigured() ? modelForRoute(route) : null,
    reason: complex ? "multi_part_question" : ambiguous ? "ambiguous_retrieval" : "standard_grounded_question",
  };
}

export function modelForRoute(route: ModelRoute): string | null {
  if (route === "tier0" || !llmConfigured()) return null;
  return process.env[route === "tier1" ? "FRONTDESKWISE_LLM_MODEL_TIER1" : "FRONTDESKWISE_LLM_MODEL_TIER2"]?.trim()
    || (route === "tier1" ? defaultTier1Model : defaultTier2Model);
}

function estimateCostUsd(route: ModelRoute, inputTokens: number, outputTokens: number): number | null {
  if (route === "tier0") return 0;
  const prefix = route === "tier1" ? "FRONTDESKWISE_LLM_TIER1" : "FRONTDESKWISE_LLM_TIER2";
  const inputRate = numberEnv(`${prefix}_INPUT_COST_PER_MILLION_USD`);
  const outputRate = numberEnv(`${prefix}_OUTPUT_COST_PER_MILLION_USD`);
  if (inputRate === null || outputRate === null) return null;
  return Number(((inputTokens / 1_000_000) * inputRate + (outputTokens / 1_000_000) * outputRate).toFixed(8));
}

export async function generateGroundedAnswer(input: GroundedAnswerInput): Promise<{ answer: string; usage: ModelUsage } | null> {
  if (input.decision.route === "tier0" || !input.decision.model || !llmConfigured()) return null;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(15_000, Math.max(3_000, Number(process.env.FRONTDESKWISE_LLM_TIMEOUT_MS ?? 8_000))));
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: input.decision.model,
        temperature: 0.1,
        max_tokens: Math.min(500, Math.max(80, Number(process.env.FRONTDESKWISE_LLM_MAX_OUTPUT_TOKENS ?? 280))),
        messages: [
          {
            role: "system",
            content: "You are FrontDeskWise, a local business front desk. Answer only from the supplied business context. Never invent prices, hours, policies, availability, guarantees, or services. If the context is insufficient, reply exactly INSUFFICIENT_EVIDENCE. Keep the answer concise and helpful.",
          },
          { role: "user", content: `Question:\n${input.question}\n\nBusiness context:\n${input.context}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`LLM provider returned HTTP ${response.status}`);
    const payload = await response.json() as ChatCompletionResponse;
    const answer = payload.choices?.[0]?.message?.content?.trim() ?? "";
    const inputTokens = Number(payload.usage?.prompt_tokens ?? 0);
    const outputTokens = Number(payload.usage?.completion_tokens ?? 0);
    if (!answer || /^INSUFFICIENT_EVIDENCE$/i.test(answer)) return null;
    return {
      answer,
      usage: {
        route: input.decision.route,
        model: input.decision.model,
        reason: input.decision.reason,
        inputTokens,
        outputTokens,
        estimatedCostUsd: estimateCostUsd(input.decision.route, inputTokens, outputTokens),
        latencyMs: Date.now() - startedAt,
      },
    };
  } finally {
    clearTimeout(timeout);
  }
}
