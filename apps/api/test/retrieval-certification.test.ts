import assert from "node:assert/strict";
import test from "node:test";
import { loadRetrievalFixture, runRetrievalCertification } from "../src/retrieval-certification.js";

test("retrieval certification reports tenant-level ranking metrics", async () => {
  const report = runRetrievalCertification(await loadRetrievalFixture());
  assert.equal(report.pass, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.tenants.map((tenant) => tenant.key), ["salonflow", "plancraftai", "british-swim-school"]);
  assert.ok(report.metrics.recallAtK >= 0.8);
  assert.equal(report.forbiddenEvidenceRate, 0);
  assert.ok(report.tenants.every((tenant) => tenant.cases.every((item) => item.rankedChunkIds.length > 0)));
});
