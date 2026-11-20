export type SemanticSearchStatus =
  | "SEMANTIC_SEARCH_HEALTHY"
  | "DEGRADED_FULL_TEXT_ONLY"
  | "EMBEDDING_CONFIGURATION_ERROR"
  | "EMBEDDING_BACKLOG";

export type EmbeddingReadiness = {
  status: SemanticSearchStatus;
  retrievalMode: "hybrid_rrf" | "degraded_full_text";
  configured: boolean;
  providerStatus: "unknown" | "healthy" | "configuration_error" | "unavailable";
  providerReason: string | null;
  model: string;
  dimensions: number;
  totalChunks: number;
  embeddedChunks: number;
  pendingChunks: number;
  coveragePercent: number;
  latestJob: {
    id: string;
    status: string;
    model: string;
    attempts: number;
    maxAttempts: number;
    totalChunks: number;
    embeddedChunks: number;
    nextAttemptAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    lastError: string | null;
  } | null;
};

export function embeddingReadiness(input: {
  configured: boolean;
  providerStatus: EmbeddingReadiness["providerStatus"];
  providerReason?: string | null;
  model: string;
  dimensions: number;
  totalChunks: number;
  embeddedChunks: number;
  latestJob?: EmbeddingReadiness["latestJob"];
}): EmbeddingReadiness {
  const totalChunks = Math.max(0, input.totalChunks);
  const embeddedChunks = Math.max(0, Math.min(totalChunks, input.embeddedChunks));
  const pendingChunks = Math.max(0, totalChunks - embeddedChunks);
  const coveragePercent = totalChunks ? Math.round((embeddedChunks / totalChunks) * 1000) / 10 : 0;
  const providerConfigurationError = input.providerStatus === "configuration_error"
    || input.latestJob?.lastError?.toLowerCase().includes("invalid_api_key")
    || input.latestJob?.lastError?.toLowerCase().includes("http 401")
    || input.latestJob?.lastError?.toLowerCase().includes("http 403");
  const providerUnavailable = input.providerStatus === "unavailable";

  let status: SemanticSearchStatus;
  if (providerConfigurationError || !input.configured) status = "EMBEDDING_CONFIGURATION_ERROR";
  else if (totalChunks > 0 && embeddedChunks === totalChunks && input.providerStatus !== "unavailable") status = "SEMANTIC_SEARCH_HEALTHY";
  else if (pendingChunks > 0 || providerUnavailable || input.latestJob?.status === "queued" || input.latestJob?.status === "running" || input.latestJob?.status === "failed") status = "EMBEDDING_BACKLOG";
  else status = "DEGRADED_FULL_TEXT_ONLY";

  return {
    status,
    retrievalMode: status === "SEMANTIC_SEARCH_HEALTHY" ? "hybrid_rrf" : "degraded_full_text",
    configured: input.configured,
    providerStatus: input.providerStatus,
    providerReason: input.providerReason ?? null,
    model: input.model,
    dimensions: input.dimensions,
    totalChunks,
    embeddedChunks,
    pendingChunks,
    coveragePercent,
    latestJob: input.latestJob ?? null,
  };
}

type RagMetricCounters = {
  embeddingJobsAttempted: number;
  embeddingJobsFailed: number;
  retrievalRequests: number;
  vectorRetrievalUsed: number;
  fullTextOnlyFallbacks: number;
  lowConfidenceFallbacks: number;
  retrievalLatencyMs: number;
  answerRequests: number;
  answerLatencyMs: number;
};

const counters: RagMetricCounters = {
  embeddingJobsAttempted: 0,
  embeddingJobsFailed: 0,
  retrievalRequests: 0,
  vectorRetrievalUsed: 0,
  fullTextOnlyFallbacks: 0,
  lowConfidenceFallbacks: 0,
  retrievalLatencyMs: 0,
  answerRequests: 0,
  answerLatencyMs: 0,
};

export function recordEmbeddingJobAttempt(): void {
  counters.embeddingJobsAttempted += 1;
}

export function recordEmbeddingJobFailure(): void {
  counters.embeddingJobsFailed += 1;
}

export function recordRetrieval(mode: string, latencyMs: number): void {
  counters.retrievalRequests += 1;
  if (mode === "hybrid_rrf") counters.vectorRetrievalUsed += 1;
  if (mode === "postgres_full_text" || mode === "degraded_full_text" || mode === "memory_lexical") counters.fullTextOnlyFallbacks += 1;
  counters.retrievalLatencyMs += Math.max(0, latencyMs);
}

export function recordLowConfidenceFallback(): void {
  counters.lowConfidenceFallbacks += 1;
}

export function recordAnswer(latencyMs: number): void {
  counters.answerRequests += 1;
  counters.answerLatencyMs += Math.max(0, latencyMs);
}

export function ragMetricsSnapshot(): RagMetricCounters & {
  vectorRetrievalUsedPercent: number;
  fullTextOnlyFallbackPercent: number;
  lowConfidenceFallbackPercent: number;
  averageRetrievalLatencyMs: number;
  averageAnswerLatencyMs: number;
} {
  const retrievalRequests = counters.retrievalRequests;
  const answerRequests = counters.answerRequests;
  return {
    ...counters,
    vectorRetrievalUsedPercent: retrievalRequests ? Math.round((counters.vectorRetrievalUsed / retrievalRequests) * 1000) / 10 : 0,
    fullTextOnlyFallbackPercent: retrievalRequests ? Math.round((counters.fullTextOnlyFallbacks / retrievalRequests) * 1000) / 10 : 0,
    lowConfidenceFallbackPercent: retrievalRequests ? Math.round((counters.lowConfidenceFallbacks / retrievalRequests) * 1000) / 10 : 0,
    averageRetrievalLatencyMs: retrievalRequests ? Math.round(counters.retrievalLatencyMs / retrievalRequests) : 0,
    averageAnswerLatencyMs: answerRequests ? Math.round(counters.answerLatencyMs / answerRequests) : 0,
  };
}
