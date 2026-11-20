import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyQuestionIntent, type RetrievalIntent } from "../src/retrieval.js";

type GoldenCase = {
  id: string;
  category: string;
  question: string;
  expectedIntent: RetrievalIntent;
  answerable: boolean;
  expectedSourceTypes: string[];
};

const golden = JSON.parse(readFileSync(new URL("./fixtures/plancraftai-golden.json", import.meta.url), "utf8")) as GoldenCase[];

test("PlanCraftAI golden set is reusable and covers answerable and abstention cases", () => {
  assert.ok(golden.length >= 30);
  assert.equal(new Set(golden.map((item) => item.id)).size, golden.length);
  assert.ok(golden.some((item) => item.answerable));
  assert.ok(golden.some((item) => !item.answerable));
  assert.ok(new Set(golden.map((item) => item.category)).size >= 8);
  for (const item of golden) {
    assert.equal(classifyQuestionIntent(item.question), item.expectedIntent, item.id);
  }
});
