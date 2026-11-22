import { readFile } from "node:fs/promises";
import { classifyQuestionIntent, rankMatches, sourceSemanticType, type RankableMatch, type RetrievalIntent, type RetrievalSource } from "./retrieval.js";
import { meanMetric, scoreRanking, type RankingMetrics } from "./certification-metrics.js";

export type RetrievalCertificationChunk = {
  id: string;
  sourceId: string;
  title: string;
  url: string;
  pageType: string;
  content: string;
};

export type RetrievalCertificationCase = {
  id: string;
  query: string;
  relevantChunkIds: string[];
  gradedRelevance?: Record<string, number>;
  forbiddenChunkIds?: string[];
};

export type RetrievalCertificationTenant = {
  key: string;
  chunks: RetrievalCertificationChunk[];
  cases: RetrievalCertificationCase[];
};

export type RetrievalCertificationFixture = { tenants: RetrievalCertificationTenant[] };

export type RetrievalCaseResult = RetrievalCertificationCase & {
  intent: RetrievalIntent;
  rankedChunkIds: string[];
  metrics: RankingMetrics;
  forbiddenEvidenceHit: boolean;
};

export type RetrievalTenantReport = {
  key: string;
  cases: RetrievalCaseResult[];
  metrics: RankingMetrics;
  forbiddenEvidenceRate: number;
  pass: boolean;
};

export type RetrievalCertificationReport = {
  generatedAt: string;
  k: number;
  tenants: RetrievalTenantReport[];
  metrics: RankingMetrics;
  forbiddenEvidenceRate: number;
  pass: boolean;
};

function tokens(value: string): string[] {
  return [...new Set(value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter((token) => token.length > 2))];
}

function lexicalScore(query: string, content: string): number {
  const queryTokens = tokens(query);
  if (!queryTokens.length) return 0;
  const lower = content.toLowerCase();
  return queryTokens.filter((token) => lower.includes(token)).length / queryTokens.length;
}

function sourceFor(chunk: RetrievalCertificationChunk): RetrievalSource {
  return { id: chunk.sourceId, url: chunk.url, title: chunk.title, pageType: chunk.pageType };
}

function rankTenantChunks(tenant: RetrievalCertificationTenant, query: string): RetrievalCertificationChunk[] {
  const sources = [...new Map(tenant.chunks.map((chunk) => [chunk.sourceId, sourceFor(chunk)])).values()];
  const intent = classifyQuestionIntent(query);
  const matches: Array<RankableMatch<RetrievalCertificationChunk>> = tenant.chunks.map((chunk) => {
    const lexical = lexicalScore(query, `${chunk.title} ${chunk.content}`);
    return {
      chunk,
      score: lexical,
      evidenceScore: lexical,
      lexicalScore: lexical,
      vectorScore: null,
    };
  }).filter((match) => match.score > 0);
  return rankMatches(matches, sources, intent, Math.max(8, tenant.chunks.length)).map((match) => match.chunk);
}

function forbiddenRate(rows: RetrievalCaseResult[]): number {
  return rows.length ? Number((rows.filter((row) => row.forbiddenEvidenceHit).length / rows.length).toFixed(4)) : 0;
}

export async function loadRetrievalFixture(): Promise<RetrievalCertificationFixture> {
  const raw = await readFile(new URL("../test/fixtures/retrieval-certification.json", import.meta.url), "utf8");
  return JSON.parse(raw) as RetrievalCertificationFixture;
}

export function runRetrievalCertification(fixture: RetrievalCertificationFixture, k = 5): RetrievalCertificationReport {
  const tenantReports = fixture.tenants.map((tenant): RetrievalTenantReport => {
    const cases = tenant.cases.map((item): RetrievalCaseResult => {
      const ranked = rankTenantChunks(tenant, item.query);
      const rankedIds = ranked.map((chunk) => chunk.id);
      const relevant = item.gradedRelevance ?? Object.fromEntries(item.relevantChunkIds.map((id) => [id, 1]));
      const topK = new Set(rankedIds.slice(0, k));
      return {
        ...item,
        intent: classifyQuestionIntent(item.query),
        rankedChunkIds: rankedIds,
        metrics: scoreRanking(rankedIds, relevant, k),
        forbiddenEvidenceHit: (item.forbiddenChunkIds ?? []).some((id) => topK.has(id)),
      };
    });
    const metrics = meanMetric(cases.map((item) => item.metrics));
    return {
      key: tenant.key,
      cases,
      metrics,
      forbiddenEvidenceRate: forbiddenRate(cases),
      pass: metrics.recallAtK >= 0.8 && metrics.reciprocalRank >= 0.8 && metrics.ndcgAtK >= 0.8 && forbiddenRate(cases) === 0,
    };
  });
  const allCases = tenantReports.flatMap((tenant) => tenant.cases);
  const metrics = meanMetric(allCases.map((item) => item.metrics));
  const forbiddenEvidenceRate = forbiddenRate(allCases);
  return {
    generatedAt: new Date().toISOString(),
    k,
    tenants: tenantReports,
    metrics,
    forbiddenEvidenceRate,
    pass: tenantReports.every((tenant) => tenant.pass),
  };
}

export function describeRetrievalChunk(chunk: RetrievalCertificationChunk): { id: string; sourceId: string; semanticType: string } {
  return { id: chunk.id, sourceId: chunk.sourceId, semanticType: sourceSemanticType(chunk) };
}

if (process.argv[1]?.endsWith("retrieval-certification.ts")) {
  const fixture = await loadRetrievalFixture();
  const report = runRetrievalCertification(fixture);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}
