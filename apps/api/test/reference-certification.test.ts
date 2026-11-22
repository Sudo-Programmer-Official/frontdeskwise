import assert from "node:assert/strict";
import test from "node:test";
import { loadReferenceFixture, runReferenceCertification } from "../src/reference-certification.js";

test("three reference businesses pass the authoritative runtime certification", async () => {
  const fixture = await loadReferenceFixture();
  const report = await runReferenceCertification(fixture);
  assert.equal(report.pass, true, JSON.stringify(report, null, 2));
  assert.deepEqual(report.businesses.map((business) => business.key), ["salonflow", "plancraftai", "british-swim-school"]);
  assert.ok(report.businesses.every((business) => business.turns.length >= 5));
});
