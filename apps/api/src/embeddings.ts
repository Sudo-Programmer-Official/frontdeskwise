const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1_536;

type EmbeddingResponse = {
  data?: Array<{ index: number; embedding: number[] }>;
};

export function embeddingModel(): string {
  return process.env.FRONTDESKWISE_EMBEDDING_MODEL?.trim() || DEFAULT_EMBEDDING_MODEL;
}

export function embeddingsConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function embeddingDimensions(): number {
  return EMBEDDING_DIMENSIONS;
}

export function vectorLiteral(vector: number[]): string {
  return `[${vector.map((value) => Number(value).toFixed(8)).join(",")}]`;
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
  if (!response.ok) throw new Error(`Embedding provider returned HTTP ${response.status}`);
  const payload = await response.json() as EmbeddingResponse;
  const values = (payload.data ?? []).sort((left, right) => left.index - right.index).map((item) => item.embedding);
  if (values.length !== texts.length || values.some((value) => value.length !== EMBEDDING_DIMENSIONS)) {
    throw new Error("Embedding provider returned an unexpected vector shape");
  }
  return values;
}
