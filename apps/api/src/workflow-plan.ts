export type VerifiedPlanFact = {
  subject: string;
  predicate: string;
  valueText: string;
  verified: boolean;
};

export type PlanRecommendation = {
  plan: string;
  price: string | null;
  reason: string;
  usageType: string;
  usageLevel: string;
};

export type PlanRecommendationPayload = {
  recommendedPlan: string;
  verifiedPrice: string | null;
  reason: string;
};

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function isTeamPlan(text: string): boolean {
  return /\b(team|teams|workspace|workspaces|seat|seats|business|organization|multiple users?)\b/.test(normalized(text));
}

function isSoloPlan(text: string): boolean {
  return /\b(solo|individual|personal|single user|one user|starter|personal plan)\b/.test(normalized(text));
}

function planTierScore(text: string, usageLevel: string): number {
  const value = normalized(text);
  const heavy = /every day|daily|all the time|heavy|frequent/.test(normalized(usageLevel));
  if (heavy && /pro|premium|growth|advanced|unlimited/.test(value)) return 30;
  if (!heavy && /starter|basic|essential|solo/.test(value)) return 20;
  if (/pro|premium|growth|advanced|unlimited/.test(value)) return 10;
  if (/starter|basic|essential/.test(value)) return 8;
  return 0;
}

function planNameForFact(fact: VerifiedPlanFact): string {
  const subject = fact.subject.trim();
  if (/\b(solo|team|starter|basic|essential|pro|premium|growth|advanced|unlimited)\b/i.test(subject)) return subject;
  const fromValue = fact.valueText.match(/\b((?:free|solo|team|starter|basic|essential|pro|premium|growth|advanced|unlimited)[a-z0-9+& -]{0,40}?)(?=\s*(?:—|-|:|\$|€|£|at\b|for\b))/i);
  return fromValue?.[1]?.trim() || subject || fact.valueText.trim();
}

function priceForFact(valueText: string): string | null {
  const currency = valueText.match(/(?:\$|€|£)\s?\d+(?:[.,]\d+)?(?:\s*\/\s*(?:month|mo|year|yr))?/i)?.[0];
  if (currency) return currency.replace(/\s*\/\s*/, "/");
  return /per month|monthly|\/month/i.test(valueText) ? valueText.trim() : null;
}

/**
 * Selects only from verified plan facts. The runtime must not manufacture a
 * plan name from generic retrieval text, and a solo journey must never select
 * a team-only tier merely because it ranked highly in search.
 */
export function recommendPlan(
  values: Record<string, string>,
  facts: VerifiedPlanFact[],
): PlanRecommendation | null {
  const usageType = values.usage_type?.trim() || "";
  const usageLevel = values.usage_level?.trim() || "";
  if (!usageType || !usageLevel) return null;

  const team = /team|group|multiple/i.test(usageType);
  const candidates = facts
    .filter((fact) => fact.verified)
    .filter((fact) => /price|pricing|plan|tier|subscription|monthly|seat/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`))
    .map((fact) => ({ fact, text: `${fact.subject} ${fact.predicate} ${fact.valueText}` }))
    .filter(({ text }) => team ? !isSoloPlan(text) : !isTeamPlan(text))
    .sort((left, right) => planTierScore(right.text, usageLevel) - planTierScore(left.text, usageLevel));

  // A team journey must not fall back to an unscoped free or solo tier when
  // the canonical Business Brain has no verified team fact. That is a safe
  // data gap, not permission to guess from a generic pricing result.
  if (team && !candidates.some(({ text }) => isTeamPlan(text))) return null;

  const audienceCandidates = team
    ? candidates.filter(({ text }) => isTeamPlan(text))
    : candidates;

  const selected = audienceCandidates[0];
  if (!selected) return null;
  const plan = planNameForFact(selected.fact);
  const price = priceForFact(selected.fact.valueText);
  const audience = team ? "with your team" : "by yourself";
  const cadence = /every day|daily|all the time|heavy|frequent/i.test(normalized(usageLevel)) ? "every day" : usageLevel.toLowerCase();
  const goal = values.main_goal?.trim().toLowerCase();
  return {
    plan,
    price,
    usageType,
    usageLevel,
    reason: `${plan} is the best fit for using PlanCraftAI ${audience}, mainly for ${goal || "your stated goal"}, with ${cadence} usage.`,
  };
}

export function planRecommendationMessage(recommendation: PlanRecommendation): string {
  return `Based on what you've told me, **${recommendation.plan}** is the best fit. ${recommendation.reason}${recommendation.price ? ` It's ${recommendation.price}.` : ""}`;
}

export function planRecommendationPayload(recommendation: PlanRecommendation): PlanRecommendationPayload {
  return {
    recommendedPlan: recommendation.plan,
    verifiedPrice: recommendation.price,
    reason: recommendation.reason,
  };
}
