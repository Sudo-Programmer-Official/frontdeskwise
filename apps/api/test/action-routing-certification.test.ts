import assert from "node:assert/strict";
import test from "node:test";
import { loadActionRoutingFixture, runActionRoutingCertification } from "../src/action-routing-certification.js";

test("action routing certification separates knowledge from business actions", async () => {
  const report = runActionRoutingCertification(await loadActionRoutingFixture());
  assert.equal(report.pass, true, JSON.stringify(report, null, 2));
  assert.equal(report.summary.incorrectActionRate, 0);
  assert.equal(report.summary.unnecessaryActionRate, 0);
  const swim = report.cases.find((item) => item.id === "swim-lesson-need");
  assert.deepEqual(swim?.extractedArgs, { child_age: "6", location: "33626", schedule_preference: "Saturday" });
});
