const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1_536;

export type EmbeddingProviderStatus = "unknown" | "healthy" | "configuration_error" | "unavailable";

export type EmbeddingProviderHealth = {
  status: EmbeddingProviderStatus;
  reason: string | null;
  checkedAt: string | null;
  httpStatus: number | null;
};

let providerHealth: EmbeddingProviderHealth = {
  status: "unknown",
  reason: null,
  checkedAt: null,
  httpStatus: null,
};

type EmbeddingResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
};

export function embeddingModel(): string {
  return process.env.FRONTDESKWISE_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function embeddingProviderHealth(): EmbeddingProviderHealth {
  return { ...providerHealth };
}

export function embeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
}

function providerFailureReason(status: number, code?: string | null): string {
  if (status === 401 || code === "invalid_api_key") return "invalid_api_key";
  if (status === 403) return "provider_forbidden";
  if (status === 429) return "provider_rate_limited";
  if (code === "model_not_found") return "embedding_model_not_found";
  if (status >= 500) return "provider_unavailable";
  return code || `provider_http_${status}`;
}

function setProviderHealth(status: EmbeddingProviderStatus, reason: string | null, httpStatus: number | null): void {
  providerHealth = { status, reason, httpStatus, checkedAt: new Date().toISOString() };
}

export async function probeEmbeddingProvider(): Promise<EmbeddingProviderHealth> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    setProviderHealth("configuration_error", "missing_api_key", null);
    return embeddingProviderHealth();
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model: embeddingModel(), input: ["FrontDeskWise readiness probe"], dimensions: EMBEDDING_DIMENSIONS }),
    });
    if (response.ok) {
      setProviderHealth("healthy", null, response.status);
      return embeddingProviderHealth();
    }
    let code: string | null = null;
    try {
      const payload = await response.json() as { error?: { code?: string } };
      code = typeof payload.error?.code === "string" ? payload.error.code : null;
    } catch {
      // The status code is sufficient for readiness classification.
    }
    const reason = providerFailureReason(response.status, code);
    setProviderHealth(response.status === 401 || response.status === 403 || code === "model_not_found" ? "configuration_error" : "unavailable", reason, response.status);
    return embeddingProviderHealth();
  } catch (error) {
    const reason = error instanceof DOMException && error.name === "AbortError" ? "provider_timeout" : "provider_network_error";
    setProviderHealth("unavailable", reason, null);
    return embeddingProviderHealth();
  } finally {
    clearTimeout(timeout);
  }
}

export async function embedTexts(texts: string[]): Promise<number[][] | null> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey || !texts.length) return null;

  const response = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ model: embeddingModel(), input: texts, dimensions: EMBEDDING_DIMENSIONS }),
  });
  if (!response.ok) {
    let code: string | null = null;
    try {
      const payload = await response.json() as { error?: { code?: string } };
      code = typeof payload.error?.code === "string" ? payload.error.code : null;
    } catch {
      // Preserve a safe status-only error when the provider response is not JSON.
    }
    const reason = providerFailureReason(response.status, code);
    setProviderHealth(response.status === 401 || response.status === 403 || code === "model_not_found" ? "configuration_error" : "unavailable", reason, response.status);
    throw new Error(`Embedding provider returned HTTP ${response.status} (${reason})`);
  }
  const payload = await response.json() as EmbeddingResponse;
  const values = (payload.data ?? []).sort((left, right) => left.index - right.index).map((item) => item.embedding);
  if (values.length !== texts.length || values.some((value) => value.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Embedding provider returned an unexpected vector shape");
  }
  setProviderHealth("healthy", null, response.status);
  return values;
}
