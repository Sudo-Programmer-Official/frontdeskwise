export type CertificationScoreSnapshot = Record<string, number>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function average(values: number[]): number | null {
  return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4)) : null;
}

/** Extract stable, comparable quality scores from a certification pyramid report. */
export function certificationScoreSnapshot(report: unknown): CertificationScoreSnapshot {
  const root = record(report);
  const layers = record(root.layers);
  const retrieval = record(layers.retrieval);
  const retrievalMetrics = record(retrieval.metrics);
  const routing = record(layers.routing);
  const routingSummary = record(routing.summary);
  const workflow = record(layers.workflow);
  const businesses = Array.isArray(workflow.businesses) ? workflow.businesses.map(record) : [];
  const processRates = businesses.map((business) => finiteNumber(business.processPassRate)).filter((value): value is number => value !== null);
  const outcomeRates = businesses.map((business) => finiteNumber(business.outcomePassRate)).filter((value): value is number => value !== null);
  const workflowSuccessRates = businesses
    .map((business): number | null => typeof business.pass === "boolean" ? (business.pass ? 1 : 0) : null)
    .filter((value): value is number => value !== null);
  const scores: CertificationScoreSnapshot = {};
  const add = (key: string, value: unknown): void => {
    const numeric = finiteNumber(value);
    if (numeric !== null) scores[key] = numeric;
  };
  add("retrieval.recallAtK", retrievalMetrics.recallAtK);
  add("retrieval.precisionAtK", retrievalMetrics.precisionAtK);
  add("retrieval.mrr", retrievalMetrics.reciprocalRank);
  add("retrieval.ndcgAtK", retrievalMetrics.ndcgAtK);
  add("retrieval.forbiddenEvidenceRate", retrieval.forbiddenEvidenceRate);
  add("routing.routeAccuracy", routingSummary.routeAccuracy);
  add("routing.actionAccuracy", routingSummary.actionAccuracy);
  add("routing.argumentAccuracy", routingSummary.argumentAccuracy);
  add("routing.incorrectActionRate", routingSummary.incorrectActionRate);
  add("routing.unnecessaryActionRate", routingSummary.unnecessaryActionRate);
  add("workflow.processPassRate", average(processRates));
  add("workflow.outcomePassRate", average(outcomeRates));
  add("workflow.successRate", average(workflowSuccessRates));
  return scores;
}

export function certificationScoreDeltas(current: CertificationScoreSnapshot, baseline: CertificationScoreSnapshot): CertificationScoreSnapshot {
  const keys = new Set([...Object.keys(current), ...Object.keys(baseline)]);
  return Object.fromEntries([...keys].sort().map((key) => [key, Number(((current[key] ?? 0) - (baseline[key] ?? 0)).toFixed(4))]));
}
