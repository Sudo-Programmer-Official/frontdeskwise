import assert from "node:assert/strict";
import test from "node:test";
import { parseGroundingDecision, routeQuestion } from "../src/model-routing.js";
import {
  answerabilityDecision,
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
  { id: "voice", url: "https://sudo-programmer.com/blog/voice-reminders", title: "Voice reminders", pageType: "web_page" },
];

test("classifies business service questions as services intent", () => {
  assert.equal(classifyQuestionIntent("What services does Sudo Programmer offer?"), "services");
  assert.equal(classifyQuestionIntent("What are your cancellation policy terms?"), "policy");
  assert.equal(classifyQuestionIntent("What permissions does PlanCraftAI use?"), "permissions");
  assert.equal(classifyQuestionIntent("Does PlanCraftAI work with calendars?"), "calendar");
  assert.equal(classifyQuestionIntent("Does PlanCraftAI support reminders?"), "reminders");
  assert.equal(classifyQuestionIntent("Can I create tasks using voice?"), "voice");
});

test("classifies onboarding language as getting_started without exact-string matching", () => {
  for (const question of [
    "How do I get started with PlanCraftAI?",
    "How do I start?",
    "Where should I begin?",
    "How can I try PlanCraftAI?",
    "What do I do first?",
    "How do I use the app?",
    "How does PlanCraftAI work?",
  ]) {
    assert.equal(classifyQuestionIntent(question), "getting_started", question);
  }
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

test("pricing and permissions do not fall back to unrelated web pages", () => {
  const unrelated = { chunk: { sourceId: "voice", content: "Voice reminders help people review unfinished tasks." }, score: 0.95, evidenceScore: 0.9 };
  assert.deepEqual(rankMatches([unrelated], sources, "pricing"), []);
  assert.deepEqual(rankMatches([unrelated], sources, "policy"), []);
});

test("getting started filters legal pages and combines corroborating product chunks", () => {
  const matches = [
    { chunk: { sourceId: "home", content: "Try it free and start with a task." }, score: 0.4, evidenceScore: 0.34 },
    { chunk: { sourceId: "services", content: "Create tasks naturally and organize your daily plan." }, score: 0.35, evidenceScore: 0.3 },
    { chunk: { sourceId: "terms", content: "Use of the service is subject to these terms." }, score: 0.9, evidenceScore: 0.95 },
  ];
  const ranked = rankMatches(matches, sources, "getting_started");
  assert.deepEqual(ranked.map((match) => match.chunk.sourceId), ["home", "services"]);
  const decision = answerabilityDecision(ranked, sources, "getting_started");
  assert.equal(decision.answerable, true);
  assert.equal(decision.reason, "multi_source_relevant_evidence");
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
