import assert from "node:assert/strict";
import test from "node:test";
import { parseGroundingDecision, routeQuestion } from "../src/model-routing.js";
import {
  citationMatches,
  classifyQuestionIntent,
  rankMatches,
  sourceSemanticType,
  type RetrievalSource,
} from "../src/retrieval.js";

const sources: RetrievalSource[] = [
  { id: "terms", url: "https://sudo-programmer.com/terms", title: "Terms of Service", pageType: "policy" },
  { id: "home", url: "https://sudo-programmer.com/", title: "Sudo Programmer | AI Automation for Growing Businesses", pageType: "web_page" },
  { id: "services", url: "https://sudo-programmer.com/services", title: "Services | Sudo Programmer", pageType: "service" },
  { id: "solutions", url: "https://sudo-programmer.com/solutions", title: "Solutions | Sudo Programmer", pageType: "service" },
];

test("classifies business service questions as services intent", () => {
  assert.equal(classifyQuestionIntent("What services does Sudo Programmer offer?"), "services");
  assert.equal(classifyQuestionIntent("What are your cancellation policy terms?"), "policy");
});

test("recognizes a homepage and keeps legal pages distinct", () => {
  assert.equal(sourceSemanticType(sources[1]), "homepage");
  assert.equal(sourceSemanticType(sources[0]), "policy");
  assert.equal(sourceSemanticType(sources[2]), "service");
  assert.equal(sourceSemanticType(sources[3]), "solution");
});

test("service intent outranks and filters Terms of Service", () => {
  const matches = [
    { chunk: { sourceId: "terms", content: "Our services are governed by these Terms of Service." }, score: 1, evidenceScore: 0.95 },
    { chunk: { sourceId: "home", content: "Sudo Programmer provides AI automation and custom software." }, score: 0.8, evidenceScore: 0.75 },
    { chunk: { sourceId: "services", content: "Sudo Programmer offers AI automation, software, and integrations." }, score: 0.6, evidenceScore: 0.7 },
  ];
  const ranked = rankMatches(matches, sources, "services");
  assert.deepEqual(ranked.map((match) => match.chunk.sourceId), ["services", "home"]);
  assert.ok(!ranked.some((match) => match.chunk.sourceId === "terms"));
  assert.deepEqual(citationMatches(ranked, sources, "services").map((match) => match.chunk.sourceId), ["services", "home"]);
});

test("legal intent can still select Terms of Service", () => {
  const ranked = rankMatches([
    { chunk: { sourceId: "terms", content: "These Terms govern use of the service." }, score: 0.4, evidenceScore: 0.8 },
    { chunk: { sourceId: "services", content: "Our services include AI automation." }, score: 0.9, evidenceScore: 0.9 },
  ], sources, "policy");
  assert.equal(ranked[0]?.chunk.sourceId, "terms");
});

test("grounding verification fails closed on anything except SUPPORTED", () => {
  assert.equal(parseGroundingDecision("SUPPORTED"), true);
  assert.equal(parseGroundingDecision("SUPPORTED\n"), true);
  assert.equal(parseGroundingDecision("UNSUPPORTED"), false);
  assert.equal(parseGroundingDecision("I think this is supported"), false);
});

test("model routing keeps clear FAQs cheap and sends lead qualification to tier 2", () => {
  assert.equal(routeQuestion({ question: "What are your hours?", hasMatch: true, confidenceScore: 0.9, candidateCount: 8 }).route, "tier1");
  assert.equal(routeQuestion({ question: "We need help automating our intake workflow", hasMatch: true, confidenceScore: 0.9, candidateCount: 2 }).reason, "lead_qualification");
});
