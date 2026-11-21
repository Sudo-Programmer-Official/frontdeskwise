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
  const heavy = /every day|daily|heavy|frequent/.test(normalized(usageLevel));
  if (heavy && /pro|premium|growth|advanced|unlimited/.test(value)) return 30;
  if (!heavy && /starter|basic|essential|solo/.test(value)) return 20;
  if (/pro|premium|growth|advanced|unlimited/.test(value)) return 10;
  if (/starter|basic|essential/.test(value)) return 8;
  return 0;
}

function planNameForFact(fact: VerifiedPlanFact): string {
  const subject = fact.subject.trim();
  if (/\b(solo|team|starter|basic|essential|pro|premium|growth|advanced|unlimited)\b/i.test(subject)) return subject;
  const fromValue = fact.valueText.match(/\b((?:solo|team|starter|basic|essential|pro|premium|growth|advanced|unlimited)[a-z0-9+& -]{0,40}?)(?=\s*(?:—|-|:|\$|€|£|at\b|for\b))/i);
  return fromValue?.[1]?.trim() || subject || fact.valueText.trim();
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

  const selected = candidates[0];
  if (!selected) return null;
  const plan = planNameForFact(selected.fact);
  const price = /\$|€|£|per month|monthly|\/month/i.test(selected.fact.valueText) ? selected.fact.valueText.trim() : null;
  const audience = team ? "your team" : "solo use";
  const cadence = /every day|daily|heavy|frequent/i.test(normalized(usageLevel)) ? "daily use" : `${usageLevel.toLowerCase()} use`;
  return {
    plan,
    price,
    usageType,
    usageLevel,
    reason: `${plan} fits ${audience} and ${cadence}${values.main_goal ? ` focused on ${values.main_goal.toLowerCase()}` : ""}.`,
  };
}

export function planRecommendationMessage(recommendation: PlanRecommendation): string {
  return `Based on what you told me, I recommend **${recommendation.plan}**. ${recommendation.reason}${recommendation.price ? ` Verified pricing: ${recommendation.price}.` : ""}`;
}
