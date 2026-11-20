import test from "node:test";
import assert from "node:assert/strict";
import { embeddingReadiness } from "../src/rag-observability.js";

test("semantic readiness requires complete current-model coverage", () => {
  const readiness = embeddingReadiness({
    configured: true,
    providerStatus: "healthy",
    model: "text-embedding-3-small",
    dimensions: 1536,
    totalChunks: 10,
    embeddedChunks: 10,
  });
  assert.equal(readiness.status, "SEMANTIC_SEARCH_HEALTHY");
  assert.equal(readiness.retrievalMode, "hybrid_rrf");
  assert.equal(readiness.coveragePercent, 100);
});

test("invalid provider credentials are configuration errors even with an embedding backlog", () => {
  const readiness = embeddingReadiness({
    configured: true,
    providerStatus: "configuration_error",
    providerReason: "invalid_api_key",
    model: "text-embedding-3-small",
    dimensions: 1536,
    totalChunks: 157,
    embeddedChunks: 0,
    latestJob: {
      id: "job-1",
      status: "failed",
      model: "text-embedding-3-small",
      attempts: 3,
      maxAttempts: 3,
      totalChunks: 157,
      embeddedChunks: 0,
      nextAttemptAt: null,
      startedAt: null,
      completedAt: null,
      lastError: "Embedding provider returned HTTP 401 (invalid_api_key)",
    },
  });
  assert.equal(readiness.status, "EMBEDDING_CONFIGURATION_ERROR");
  assert.equal(readiness.retrievalMode, "degraded_full_text");
  assert.equal(readiness.pendingChunks, 157);
});

test("queued work is reported as an embedding backlog", () => {
  const readiness = embeddingReadiness({
    configured: true,
    providerStatus: "healthy",
    model: "text-embedding-3-small",
    dimensions: 1536,
    totalChunks: 4,
    embeddedChunks: 2,
    latestJob: {
      id: "job-2",
      status: "queued",
      model: "text-embedding-3-small",
      attempts: 0,
      maxAttempts: 3,
      totalChunks: 4,
      embeddedChunks: 0,
      nextAttemptAt: null,
      startedAt: null,
      completedAt: null,
      lastError: null,
    },
  });
  assert.equal(readiness.status, "EMBEDDING_BACKLOG");
  assert.equal(readiness.coveragePercent, 50);
});
