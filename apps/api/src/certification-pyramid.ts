import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loadActionRoutingFixture, runActionRoutingCertification } from "./action-routing-certification.js";
import { certificationScoreDeltas, certificationScoreSnapshot } from "./certification-deltas.js";
import { loadReferenceFixture, runReferenceCertification } from "./reference-certification.js";
import { loadRetrievalFixture, runRetrievalCertification } from "./retrieval-certification.js";

/**
 * Offline certification entry point for the evaluation pyramid:
 * retrieval → routing → workflow/conversation behavior.
 *
 * The report keeps each layer separate so a failing end-to-end turn can be
 * attributed to evidence ranking, action selection, or workflow state.
 */
async function main(): Promise<void> {
  const retrieval = runRetrievalCertification(await loadRetrievalFixture());
  const routing = runActionRoutingCertification(await loadActionRoutingFixture());
  const workflow = await runReferenceCertification(await loadReferenceFixture());
  const generatedAt = new Date().toISOString();
  const commit = process.env.CERTIFICATION_COMMIT?.trim()
    || process.env.GITHUB_SHA?.trim()?.slice(0, 12)
    || process.env.VERCEL_GIT_COMMIT_SHA?.trim()?.slice(0, 12)
    || (() => {
      try { return execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim() || null; } catch { return null; }
    })();
  const report = {
    generatedAt,
    commit,
    layers: {
      retrieval: {
        pass: retrieval.pass,
        metrics: retrieval.metrics,
        forbiddenEvidenceRate: retrieval.forbiddenEvidenceRate,
        tenants: retrieval.tenants.map((tenant) => ({ key: tenant.key, pass: tenant.pass, metrics: tenant.metrics, forbiddenEvidenceRate: tenant.forbiddenEvidenceRate })),
      },
      routing: routing,
      workflow,
    },
    pass: retrieval.pass && routing.pass && workflow.pass,
  };
  const outputDirectory = join(process.cwd(), "benchmark-results");
  await mkdir(outputDirectory, { recursive: true });
  let baseline: { fileName: string; report: unknown } | null = null;
  try {
    const candidates = (await readdir(outputDirectory)).filter((fileName) => /^certification-pyramid-.*\.json$/.test(fileName)).sort().reverse();
    const fileName = candidates[0];
    if (fileName) baseline = { fileName, report: JSON.parse(await readFile(join(outputDirectory, fileName), "utf8")) as unknown };
  } catch {
    baseline = null;
  }
  const currentScores = certificationScoreSnapshot(report);
  const baselineScores = baseline ? certificationScoreSnapshot(baseline.report) : null;
  const reportWithDeltas = {
    ...report,
    baseline: baseline ? {
      fileName: baseline.fileName,
      generatedAt: (baseline.report as { generatedAt?: string }).generatedAt ?? null,
      commit: (baseline.report as { commit?: string | null }).commit ?? null,
    } : null,
    scores: currentScores,
    scoreDeltas: baselineScores ? certificationScoreDeltas(currentScores, baselineScores) : null,
  };
  const outputPath = join(outputDirectory, `certification-pyramid-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(outputPath, `${JSON.stringify(reportWithDeltas, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ outputPath, pass: report.pass, commit, baseline: baseline?.fileName ?? null, scoreDeltas: reportWithDeltas.scoreDeltas, layers: { retrieval: retrieval.pass, routing: routing.pass, workflow: workflow.pass } }, null, 2));
  if (!report.pass) process.exitCode = 1;
}

void main();
