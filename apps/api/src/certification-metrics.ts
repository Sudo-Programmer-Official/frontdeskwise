/**
 * Ranking metrics shared by offline certification jobs.
 *
 * The functions intentionally accept ids rather than retrieval-specific
 * objects so the same contract can score website chunks, business facts, or
 * provider resources.
 */

export type RankedItem = {
  id: string;
  /** Optional graded relevance. Any positive value is relevant. */
  relevance?: number;
};

export type RankingMetrics = {
  recallAtK: number;
  precisionAtK: number;
  reciprocalRank: number;
  ndcgAtK: number;
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Number(clamp(value).toFixed(4));
}

function relevanceMap(relevant: Iterable<string> | Record<string, number>): Map<string, number> {
  const iterable = relevant as Iterable<string>;
  if (typeof relevant === "object" && typeof iterable[Symbol.iterator] !== "function") {
    return new Map(Object.entries(relevant).map(([id, score]) => [id, Math.max(0, Number(score) || 0)]));
  }
  return new Map([...iterable].map((id) => [id, 1]));
}

function rankedIds(ranked: Array<string | RankedItem>): RankedItem[] {
  return ranked.map((item) => typeof item === "string" ? { id: item, relevance: 1 } : item);
}

export function recallAtK(ranked: Array<string | RankedItem>, relevant: Iterable<string> | Record<string, number>, k: number): number {
  const expected = relevanceMap(relevant);
  if (!expected.size || k <= 0) return 0;
  const retrieved = new Set(rankedIds(ranked).slice(0, k).map((item) => item.id));
  return round([...expected.keys()].filter((id) => retrieved.has(id)).length / expected.size);
}

export function precisionAtK(ranked: Array<string | RankedItem>, relevant: Iterable<string> | Record<string, number>, k: number): number {
  const expected = relevanceMap(relevant);
  if (k <= 0) return 0;
  const retrieved = rankedIds(ranked).slice(0, k);
  return round(retrieved.filter((item) => expected.has(item.id)).length / k);
}

export function reciprocalRank(ranked: Array<string | RankedItem>, relevant: Iterable<string> | Record<string, number>): number {
  const expected = relevanceMap(relevant);
  const index = rankedIds(ranked).findIndex((item) => expected.has(item.id));
  return index < 0 ? 0 : round(1 / (index + 1));
}

function discountedGain(relevance: number, rank: number): number {
  return relevance / Math.log2(rank + 2);
}

export function ndcgAtK(ranked: Array<string | RankedItem>, relevant: Iterable<string> | Record<string, number>, k: number): number {
  const expected = relevanceMap(relevant);
  if (!expected.size || k <= 0) return 0;
  const actual = rankedIds(ranked).slice(0, k).reduce((total, item, index) => total + discountedGain(expected.get(item.id) ?? 0, index), 0);
  const ideal = [...expected.values()]
    .sort((left, right) => right - left)
    .slice(0, k)
    .reduce((total, relevance, index) => total + discountedGain(relevance, index), 0);
  return ideal ? round(actual / ideal) : 0;
}

export function scoreRanking(ranked: Array<string | RankedItem>, relevant: Iterable<string> | Record<string, number>, k = 5): RankingMetrics {
  return {
    recallAtK: recallAtK(ranked, relevant, k),
    precisionAtK: precisionAtK(ranked, relevant, k),
    reciprocalRank: reciprocalRank(ranked, relevant),
    ndcgAtK: ndcgAtK(ranked, relevant, k),
  };
}

export function meanMetric<T extends Record<string, number>>(rows: T[]): T {
  if (!rows.length) return {} as T;
  const keys = Object.keys(rows[0]) as Array<keyof T>;
  return Object.fromEntries(keys.map((key) => [key, Number((rows.reduce((sum, row) => sum + Number(row[key] ?? 0), 0) / rows.length).toFixed(4))])) as T;
}
