import { readFile } from "node:fs/promises";
import { defaultActionFlows, detectAction, classifyVisitorRequest, type ActionFlow, type VisitorRequestMode } from "./action-flows.js";
import { extractWorkflowValues } from "./workflow-engine.js";
import type { WebsiteActionCandidate } from "./website-actions.js";

export type ActionRoutingCase = {
  id: string;
  tenant: string;
  message: string;
  expectedMode: VisitorRequestMode;
  expectedActionType: string | null;
  expectedIntent?: string;
  expectedArgs?: Record<string, string>;
};

export type ActionRoutingFixture = { cases: ActionRoutingCase[] };

export type ActionRoutingCaseResult = ActionRoutingCase & {
  actualMode: VisitorRequestMode;
  actualIntent: string;
  selectedActionType: string | null;
  selectedActionKey: string | null;
  extractedArgs: Record<string, string>;
  routeCorrect: boolean;
  actionCorrect: boolean;
  argsCorrect: boolean;
  unnecessaryAction: boolean;
  pass: boolean;
};

export type ActionRoutingReport = {
  generatedAt: string;
  cases: ActionRoutingCaseResult[];
  summary: {
    total: number;
    passed: number;
    routeAccuracy: number;
    actionAccuracy: number;
    argumentAccuracy: number;
    incorrectActionRate: number;
    unnecessaryActionRate: number;
  };
  pass: boolean;
};

function candidate(actionType: WebsiteActionCandidate["actionType"], label: string, url = "https://example.com/action"): WebsiteActionCandidate {
  const now = "2026-01-01T00:00:00.000Z";
  return {
    actionType,
    label,
    description: label,
    mode: "transactional",
    destination: { url, label },
    provider: null,
    priority: 900,
    requiredFields: [],
    conditions: [],
    safetyPolicy: "standard",
    sourceUrl: "https://example.com/",
    sourceType: "website",
    sourceLabel: label,
    discoveredAt: now,
    classificationReason: "routing certification fixture",
    reviewReason: null,
    evidence: [label],
    confidence: 1,
    enabled: true,
  };
}

function actionsForTenant(tenant: string): ActionFlow[] {
  const actions = tenant === "british-swim-school"
    ? defaultActionFlows("British Swim School", "swim lessons enrollment", (key) => `${tenant}:${key}`)
    : tenant === "daycarespots"
      ? defaultActionFlows("DaycareSpots", "daycare tour waitlist", (key) => `${tenant}:${key}`)
      : tenant === "salonflow"
        ? defaultActionFlows("SalonFlow", "salon appointment", (key) => `${tenant}:${key}`, [candidate("request_demo", "Request a guided demo")])
        : defaultActionFlows("FrontDeskWise", "local service appointment", (key) => `${tenant}:${key}`);
  for (const action of actions) {
    // Discovered actions are deliberately approved in this offline benchmark
    // so routing is measured independently from the registry lifecycle gate.
    if (action.origin === "discovered") {
      action.enabled = true;
      action.lifecycleStatus = "approved";
    }
  }
  return actions;
}

function equalArgs(actual: Record<string, string>, expected: Record<string, string> | undefined): boolean {
  if (!expected) return true;
  return Object.entries(expected).every(([key, value]) => actual[key] === value);
}

function ratio(value: number, total: number): number {
  return total ? Number((value / total).toFixed(4)) : 0;
}

export async function loadActionRoutingFixture(): Promise<ActionRoutingFixture> {
  const raw = await readFile(new URL("../test/fixtures/action-routing-certification.json", import.meta.url), "utf8");
  return JSON.parse(raw) as ActionRoutingFixture;
}

export function runActionRoutingCertification(fixture: ActionRoutingFixture): ActionRoutingReport {
  const results = fixture.cases.map((item): ActionRoutingCaseResult => {
    const actions = actionsForTenant(item.tenant);
    const classification = classifyVisitorRequest(item.message);
    const selected = detectAction(actions, item.message);
    const extractedArgs = selected ? extractWorkflowValues(selected, item.message) : {};
    const routeCorrect = classification.mode === item.expectedMode && (!item.expectedIntent || classification.actionIntent === item.expectedIntent);
    const actionCorrect = (selected?.actionType ?? null) === item.expectedActionType;
    const argsCorrect = equalArgs(extractedArgs, item.expectedArgs);
    const unnecessaryAction = item.expectedActionType === null && selected !== null;
    return {
      ...item,
      actualMode: classification.mode,
      actualIntent: classification.actionIntent,
      selectedActionType: selected?.actionType ?? null,
      selectedActionKey: selected?.key ?? null,
      extractedArgs,
      routeCorrect,
      actionCorrect,
      argsCorrect,
      unnecessaryAction,
      pass: routeCorrect && actionCorrect && argsCorrect && !unnecessaryAction,
    };
  });
  const total = results.length;
  const passed = results.filter((item) => item.pass).length;
  const incorrectAction = results.filter((item) => !item.actionCorrect).length;
  const unnecessaryAction = results.filter((item) => item.unnecessaryAction).length;
  const summary = {
    total,
    passed,
    routeAccuracy: ratio(results.filter((item) => item.routeCorrect).length, total),
    actionAccuracy: ratio(results.filter((item) => item.actionCorrect).length, total),
    argumentAccuracy: ratio(results.filter((item) => item.argsCorrect).length, total),
    incorrectActionRate: ratio(incorrectAction, total),
    unnecessaryActionRate: ratio(unnecessaryAction, total),
  };
  return { generatedAt: new Date().toISOString(), cases: results, summary, pass: passed === total };
}

if (process.argv[1]?.endsWith("action-routing-certification.ts")) {
  const fixture = await loadActionRoutingFixture();
  const report = runActionRoutingCertification(fixture);
  console.log(JSON.stringify(report, null, 2));
  if (!report.pass) process.exitCode = 1;
}
