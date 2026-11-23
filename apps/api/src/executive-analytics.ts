export type ExecutiveAnalyticsMessage = {
  role: string;
  createdAt: string;
  grounded?: boolean;
  retrieval?: {
    validationStatus?: "accepted" | "fallback" | null;
    estimatedCostUsd?: number | null;
  };
};

export type ExecutiveAnalyticsConversation = {
  id: string;
  status: string;
  createdAt: string;
  humanJoinedAt?: string | null;
  messages: ExecutiveAnalyticsMessage[];
};

export type ExecutiveAnalyticsLead = {
  id: string;
  conversationId?: string | null;
  status: "new" | "qualified" | "booked";
  createdAt: string;
};

export type ExecutiveAnalyticsEvent = {
  id?: string;
  event: string;
  conversationId?: string | null;
  timestamp: string;
};

export type ExecutiveAnalyticsExperience = {
  totalSignals: number;
  affectedSessions: number;
};

export type ExecutiveAnalyticsStep = {
  key: string;
  label: string;
  value: number;
  rate: number | null;
  rateLabel: string;
  detail: string;
  status: "complete" | "attention" | "pending";
};

export type ExecutiveQualityMetric = {
  key: string;
  label: string;
  value: number | null;
  unit: "percent" | "currency";
  detail: string;
  status: "healthy" | "watch" | "no_data";
};

export type ExecutiveAnalytics = {
  windowDays: number;
  windowLabel: string;
  funnel: {
    steps: ExecutiveAnalyticsStep[];
    qualifiedLeads: number;
    conversions: number;
    activityConversations: number;
  };
  quality: {
    metrics: ExecutiveQualityMetric[];
    totalConversations: number;
    assistantResponses: number;
    fallbackResponses: number;
    totalLlmCostUsd: number | null;
    costDataAvailable: boolean;
  };
};

function roundedPercent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10);
}

function inWindow(value: string, cutoff: number): boolean {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp >= cutoff;
}

function stepStatus(value: number, hasData: boolean): ExecutiveAnalyticsStep["status"] {
  if (!hasData) return "pending";
  return value > 0 ? "complete" : "attention";
}

function milestoneStep(
  key: string,
  label: string,
  value: number,
  detail: string,
  rateLabel = "Account milestone",
): ExecutiveAnalyticsStep {
  return {
    key,
    label,
    value,
    rate: value > 0 ? 100 : 0,
    rateLabel,
    detail,
    status: stepStatus(value, true),
  };
}

function countConversions(events: ExecutiveAnalyticsEvent[], bookedLeads: ExecutiveAnalyticsLead[]): number {
  const conversionEvents = events.filter((event) => event.event === "FLOW_COMPLETED");
  const convertedConversationIds = new Set(
    conversionEvents.map((event) => event.conversationId).filter((id): id is string => Boolean(id)),
  );
  let count = conversionEvents.length;
  for (const lead of bookedLeads) {
    if (lead.conversationId && convertedConversationIds.has(lead.conversationId)) continue;
    count += 1;
    if (lead.conversationId) convertedConversationIds.add(lead.conversationId);
  }
  return count;
}

function handoffConversationIds(
  conversations: ExecutiveAnalyticsConversation[],
  events: ExecutiveAnalyticsEvent[],
): Set<string> {
  const ids = new Set(
    events
      .filter((event) => event.event === "HANDOFF_REQUESTED" && event.conversationId)
      .map((event) => event.conversationId as string),
  );
  for (const conversation of conversations) {
    if (conversation.humanJoinedAt
      || ["HANDOFF_REQUESTED", "CONTACT_REQUIRED", "WAITING_FOR_STAFF", "FOLLOW_UP_PENDING", "HUMAN_ACTIVE", "AI_ASSISTED"].includes(conversation.status)) {
      ids.add(conversation.id);
    }
  }
  return ids;
}

export function buildExecutiveAnalytics(input: {
  businessCreatedAt: string;
  verified: boolean;
  published: boolean;
  widgetInstalled: boolean;
  knowledgeReadinessScore: number;
  conversations: ExecutiveAnalyticsConversation[];
  leads: ExecutiveAnalyticsLead[];
  conversionEvents: ExecutiveAnalyticsEvent[];
  experience: ExecutiveAnalyticsExperience;
  now?: Date;
  windowDays?: number;
}): ExecutiveAnalytics {
  const windowDays = input.windowDays ?? 30;
  const now = input.now ?? new Date();
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1_000;
  const activityConversations = input.conversations.filter((conversation) => inWindow(conversation.createdAt, cutoff));
  const activityConversationIds = new Set(activityConversations.map((conversation) => conversation.id));
  const activityLeads = input.leads.filter((lead) => inWindow(lead.createdAt, cutoff));
  const qualifiedLeads = activityLeads.filter((lead) => lead.status === "qualified" || lead.status === "booked");
  const activityEvents = input.conversionEvents.filter((event) => inWindow(event.timestamp, cutoff));
  const bookedLeads = activityLeads.filter((lead) => lead.status === "booked");
  const conversions = countConversions(activityEvents, bookedLeads);
  const published = input.published ? 1 : 0;
  const widgetInstalled = input.widgetInstalled ? 1 : 0;
  const firstConversation = input.conversations.length > 0 ? 1 : 0;
  const signup = input.businessCreatedAt ? 1 : 0;

  const funnelSteps: ExecutiveAnalyticsStep[] = [
    milestoneStep("signup", "Signup", signup, "Workspace started"),
    milestoneStep("verified", "Verified", input.verified ? 1 : 0, input.verified ? "Website ownership confirmed" : "Verify the website to unlock publishing"),
    milestoneStep("business_created", "Business created", signup, "Business workspace exists"),
    milestoneStep("published", "Published", published, published ? "Live configuration is available" : "Publish the agent when setup is ready"),
    milestoneStep("widget_installed", "Widget installed", widgetInstalled, widgetInstalled ? "Public widget has loaded" : "Install the widget on the website"),
    milestoneStep("first_conversation", "First conversation", firstConversation, firstConversation ? "Visitors have started a conversation" : "Waiting for the first visitor", "Demand signal"),
    {
      key: "qualified_lead",
      label: "Qualified lead",
      value: qualifiedLeads.length,
      rate: roundedPercent(qualifiedLeads.length, activityConversations.length),
      rateLabel: activityConversations.length ? "Visitor → lead" : "Waiting for visitor activity",
      detail: `${activityConversations.length} conversation${activityConversations.length === 1 ? "" : "s"} in the last ${windowDays} days`,
      status: stepStatus(qualifiedLeads.length, activityConversations.length > 0),
    },
    {
      key: "conversion",
      label: "Conversion",
      value: conversions,
      rate: roundedPercent(conversions, qualifiedLeads.length),
      rateLabel: qualifiedLeads.length ? "Lead → conversion" : "Waiting for qualified leads",
      detail: `${conversions} completed outcome${conversions === 1 ? "" : "s"} in the last ${windowDays} days`,
      status: stepStatus(conversions, qualifiedLeads.length > 0),
    },
  ];

  const assistantMessages = activityConversations.flatMap((conversation) => conversation.messages)
    .filter((message) => message.role === "assistant");
  const fallbackResponses = assistantMessages.filter((message) => message.retrieval?.validationStatus === "fallback").length;
  const fallbackDataAvailable = assistantMessages.some((message) => message.retrieval?.validationStatus === "accepted" || message.retrieval?.validationStatus === "fallback");
  const totalLlmCostUsd = assistantMessages.reduce<number | null>((total, message) => {
    const cost = message.retrieval?.estimatedCostUsd;
    if (typeof cost !== "number" || !Number.isFinite(cost)) return total;
    return (total ?? 0) + Math.max(0, cost);
  }, null);
  const workflowStarts = activityEvents.filter((event) => event.event === "FLOW_STARTED").length;
  const workflowCompletions = activityEvents.filter((event) => event.event === "FLOW_COMPLETED").length;
  const handoffIds = handoffConversationIds(activityConversations, activityEvents);
  const activityHandoffs = [...handoffIds].filter((id) => activityConversationIds.has(id)).length;
  const frustrationRate = roundedPercent(input.experience.affectedSessions, activityConversations.length);
  const handoffRate = roundedPercent(activityHandoffs, activityConversations.length);
  const conversionRate = roundedPercent(conversions, activityConversations.length);
  const workflowSuccessRate = roundedPercent(workflowCompletions, workflowStarts);
  const costPerConversation = totalLlmCostUsd === null ? null : activityConversations.length ? totalLlmCostUsd / activityConversations.length : null;
  const costPerConversion = totalLlmCostUsd === null ? null : conversions ? totalLlmCostUsd / conversions : null;

  const metrics: ExecutiveQualityMetric[] = [
    {
      key: "knowledge_readiness",
      label: "Knowledge readiness",
      value: Math.max(0, Math.min(100, Math.round(input.knowledgeReadinessScore))),
      unit: "percent",
      detail: "Source coverage, embeddings, and open gaps",
      status: input.knowledgeReadinessScore >= 80 ? "healthy" : input.knowledgeReadinessScore > 0 ? "watch" : "no_data",
    },
    {
      key: "workflow_success",
      label: "Workflow success",
      value: workflowSuccessRate,
      unit: "percent",
      detail: workflowStarts ? `${workflowCompletions} of ${workflowStarts} flows completed` : "No conversion flows started yet",
      status: workflowSuccessRate === null ? "no_data" : workflowSuccessRate >= 80 ? "healthy" : "watch",
    },
    {
      key: "safe_fallback_rate",
      label: "Safe fallback rate",
      value: fallbackDataAvailable ? roundedPercent(fallbackResponses, assistantMessages.length) : null,
      unit: "percent",
      detail: fallbackDataAvailable ? `${fallbackResponses} validated fallback${fallbackResponses === 1 ? "" : "s"} response${fallbackResponses === 1 ? "" : "s"}` : "Validation telemetry is not available yet",
      status: !fallbackDataAvailable ? "no_data" : fallbackResponses === 0 ? "healthy" : "watch",
    },
    {
      key: "frustration_rate",
      label: "Frustration rate",
      value: frustrationRate,
      unit: "percent",
      detail: input.experience.totalSignals ? `${input.experience.affectedSessions} affected session${input.experience.affectedSessions === 1 ? "" : "s"}` : "No visitor friction signals",
      status: frustrationRate === null ? "no_data" : frustrationRate <= 5 ? "healthy" : "watch",
    },
    {
      key: "handoff_rate",
      label: "Handoff rate",
      value: handoffRate,
      unit: "percent",
      detail: activityHandoffs ? `${activityHandoffs} conversation${activityHandoffs === 1 ? "" : "s"} reached staff` : "No staff handoffs in this window",
      status: handoffRate === null ? "no_data" : handoffRate <= 25 ? "healthy" : "watch",
    },
    {
      key: "conversion_rate",
      label: "Conversion rate",
      value: conversionRate,
      unit: "percent",
      detail: conversions ? `${conversions} completed outcome${conversions === 1 ? "" : "s"}` : "No completed outcomes yet",
      status: conversionRate === null ? "no_data" : conversionRate > 0 ? "healthy" : "watch",
    },
    {
      key: "cost_per_conversation",
      label: "Cost / conversation",
      value: costPerConversation,
      unit: "currency",
      detail: totalLlmCostUsd === null ? "Model cost telemetry is not available yet" : `$${totalLlmCostUsd.toFixed(4)} total model cost`,
      status: costPerConversation === null ? "no_data" : "healthy",
    },
    {
      key: "cost_per_conversion",
      label: "Cost / conversion",
      value: costPerConversion,
      unit: "currency",
      detail: costPerConversion === null ? "Requires a completed conversion and cost telemetry" : `${conversions} completed outcome${conversions === 1 ? "" : "s"}`,
      status: costPerConversion === null ? "no_data" : "healthy",
    },
  ];

  return {
    windowDays,
    windowLabel: `Last ${windowDays} days`,
    funnel: { steps: funnelSteps, qualifiedLeads: qualifiedLeads.length, conversions, activityConversations: activityConversations.length },
    quality: {
      metrics,
      totalConversations: activityConversations.length,
      assistantResponses: assistantMessages.length,
      fallbackResponses,
      totalLlmCostUsd,
      costDataAvailable: totalLlmCostUsd !== null,
    },
  };
}
