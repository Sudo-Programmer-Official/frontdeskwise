import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import type { PoolClient } from "pg";
import Stripe from "stripe";
import { createPoolFromEnv } from "./database.js";
import { CrawlError, crawlWebsite, normalisePublicUrl, websiteIdentityKey, type CrawledPage } from "./crawler.js";
import { createRenderedPageAdapter } from "./rendered-crawler.js";
import { chunkDocumentText, extractDocumentText } from "./document-ingestion.js";
import { embedTexts, embeddingDimensions, embeddingModel, embeddingProviderHealth, embeddingsConfigured, probeEmbeddingProvider, vectorLiteral } from "./embeddings.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { generateGroundedAnswer, hasDirectSensitiveEvidence, routeQuestion, verifyGroundedAnswer, type ModelUsage } from "./model-routing.js";
import { shapeCustomerAnswer, type AnswerTone } from "./answer-shaping.js";
import {
  ACTION_TEMPLATES,
  BUSINESS_ACTION_TYPES,
  actionProviderForFlow,
  actionReadiness,
  actionTemplate,
  classifyVisitorRequest,
  createActionState,
  defaultActionFlows,
  detectAction,
  fieldPrompt,
  formFields,
  isPlanSelectionWorkflow,
  nextActionField,
  nextConversationalField,
  normalizeCanonicalEnrollmentWorkflow,
  validateFieldValue,
  type ActionFlow,
  type ActionAttachmentPolicy,
  type ActionExecutionMode,
  type ActionReadiness,
  type ActionLifecycleStatus,
  type ActionOrigin,
  type ActionReviewReason,
  type ActionSourceType,
  type BusinessActionType,
  type ConversationActionState,
} from "./action-flows.js";
import { generateCompletionLink } from "./completion-links.js";
import {
  ACTION_RESOURCE_TYPES,
  normalizeActionResource,
  resolveAction,
  type ActionResource,
  type ActionResourceInput,
  type ActionResourceStatus,
  type ActionResourceType,
} from "./action-registry.js";
import {
  applyWorkflowInput,
  applyWorkflowValues,
  addWorkflowParticipant,
  completeActiveWorkflowParticipant,
  currentWorkflowStep,
  extractWorkflowValues,
  invalidateWorkflowLookups,
  migrateWorkflowState,
  pushWorkflowInterruption,
  replayWorkflowTurn,
  resumeWorkflowInterruption,
  setWorkflowParticipantValue,
  transitionWorkflow,
  workflowField,
  workflowFormFields,
  workflowNextBestAction,
  workflowSummary,
} from "./workflow-engine.js";
import { planRecommendationMessage, recommendPlan, type PlanRecommendation } from "./workflow-plan.js";
import { jackrabbitProviderForToken, type JackrabbitProvider } from "./jackrabbit-provider.js";
import {
  answerabilityDecision,
  citationMatches,
  classifyQuestionIntent,
  rankMatches,
  sourceAllowedForIntent,
  sourceBoost,
  sourceSemanticType,
  type RetrievalIntent,
} from "./retrieval.js";
import {
  knowledgeGapContactAction,
  knowledgeGapMessage,
  knowledgeGapReason,
  type KnowledgeGapReason,
} from "./knowledge-gap-policy.js";
import {
  embeddingReadiness,
  ragMetricsSnapshot,
  recordAnswer,
  recordEmbeddingJobAttempt,
  recordEmbeddingJobFailure,
  recordLowConfidenceFallback,
  recordRetrieval,
} from "./rag-observability.js";
import {
  allowedDocumentTypeList,
  createDocumentDownload,
  createDocumentUpload,
  deleteDocumentObject,
  inspectDocumentObject,
  isAllowedDocumentType,
  maxDocumentBytes,
  organizationDocumentKey,
  readDocumentObject,
  safeDocumentFileName,
  storageConfigured,
  storageConfigurationMessage,
} from "./storage.js";
import { notifySuperAdmins, sendTransactionalEmail, sesConfigured, sesConfigurationMessage, superAdminEmails } from "./email.js";
import {
  emitLifecycleEvent,
  lifecycleTemplatePayload,
  processLifecycleMessagingOutbox,
  retryLifecycleDelivery,
  scheduleLifecycleMessaging,
  scheduleNextLifecycleMessaging,
  renderLifecycleEmail,
  type LifecycleEventType,
} from "./lifecycle-messaging.js";
import { decideConversationRoute } from "./conversation-orchestrator.js";
import {
  providerTrace,
  snapshotConversationWorkflowState,
  workflowFieldChanges,
} from "./conversation-decision-trace.js";
import {
  createActionConnector,
  type ActionConnectorProvider,
  type ActionConnectorSettings,
  type ActionInput,
} from "./action-connectors.js";
import {
  decryptIntegrationCredentials,
  createCrmAdapter,
  encryptIntegrationCredentials,
  integrationEncryptionConfigured,
  sendWebhookEvent,
  validateWebhookUrl,
  type HubSpotCredentials,
  type CrmLeadPayload,
} from "./crm.js";
import {
  buildHubSpotAuthorizationUrl,
  exchangeHubSpotAuthorizationCode,
  hubSpotOAuthConfigured,
  hubSpotOAuthRedirectUri,
  refreshHubSpotAccessToken,
  revokeHubSpotRefreshToken,
  type HubSpotOAuthTokenSet,
} from "./hubspot-oauth.js";
import { createMcpClient, toolPermissions, type McpProvider, type McpTool } from "./mcp.js";
import { primaryActionForBusiness, primaryCtaForAction, primaryCtaForQuestion, primaryCtaIntroduction, type PrimaryCta } from "./conversion-goals.js";
import { credentialHint, decryptSecret, encryptSecret } from "./secrets.js";
import {
  activePlanAfterStripeSync,
  billingPaymentFailureContext,
  billingPlanChangeType,
  type BillingPlanChangeType,
} from "./billing-state.js";
import {
  BUSINESS_FACT_KINDS,
  BUSINESS_FACT_SOURCE_TYPES,
  businessFactSourceLabel,
  normalizeBusinessFact,
  resolveBusinessFacts,
  type BusinessFact,
  type BusinessFactAuthority,
  type BusinessFactInput,
  type BusinessFactKind,
  type BusinessFactSourceType,
} from "./business-knowledge.js";
import { buildWorkflowContext } from "./workflow-context.js";
import { validateWorkflowTenantIsolation, workflowIsolationMessage, type WorkflowIsolationResult } from "./workflow-isolation.js";
import { buildCanonicalBusinessModel, createBusinessContextSnapshot, type BusinessContextSnapshot } from "./business-context.js";

const app = Fastify({ logger: true, trustProxy: true });
await app.register(rawBody, { global: false, encoding: "utf8", runFirst: true });
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const pool = createPoolFromEnv();
const configuredWebOrigins = (process.env.WEB_ORIGIN ?? "*").split(",").map((origin) => origin.trim().replace(/\/$/, "")).filter(Boolean);
const allowedWebOrigins = Array.from(new Set([
  ...configuredWebOrigins,
  ...(configuredWebOrigins.some((origin) => origin.includes("frontdeskwise.com"))
    ? ["https://frontdeskwise.com", "https://www.frontdeskwise.com", "https://app.frontdeskwise.com"]
    : []),
]));
const apiRateLimiter = new FixedWindowRateLimiter(
  Number(process.env.FRONTDESKWISE_RATE_LIMIT_MAX ?? 120),
  Number(process.env.FRONTDESKWISE_RATE_LIMIT_WINDOW_MS ?? 60_000),
);
const demoRateLimiter = new FixedWindowRateLimiter(
  Number(process.env.FRONTDESKWISE_DEMO_RATE_LIMIT_MAX ?? 10),
  Number(process.env.FRONTDESKWISE_DEMO_RATE_LIMIT_WINDOW_MS ?? 3_600_000),
);
const stripe = process.env.STRIPE_SECRET_KEY?.trim() ? new Stripe(process.env.STRIPE_SECRET_KEY.trim()) : null;
const stripeAppMetadata = "frontdeskwise";
const defaultTrialDays = Math.max(1, Number(process.env.FRONTDESKWISE_DEFAULT_TRIAL_DAYS ?? 7));
const renderedPageAdapter = createRenderedPageAdapter();

function crawlConfiguredWebsite(websiteUrl: string) {
  return crawlWebsite(websiteUrl, { renderPage: renderedPageAdapter });
}

function trialEndFromNow(): string {
  return new Date(Date.now() + defaultTrialDays * 24 * 60 * 60 * 1_000).toISOString();
}

function validateProductionConfiguration(): void {
  if ((process.env.NODE_ENV ?? "development").trim().toLowerCase() !== "production") return;
  const missing = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["FRONTDESKWISE_CREDENTIAL_KEY", process.env.FRONTDESKWISE_CREDENTIAL_KEY],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
    ["STRIPE_SECRET_KEY", process.env.STRIPE_SECRET_KEY],
    ["STRIPE_WEBHOOK_SECRET", process.env.STRIPE_WEBHOOK_SECRET],
    ["WEB_ORIGIN", process.env.WEB_ORIGIN],
    ["FRONTDESKWISE_PUBLIC_API_ORIGIN", process.env.FRONTDESKWISE_PUBLIC_API_ORIGIN],
    ["FRONTDESKWISE_WIDGET_ORIGIN", process.env.FRONTDESKWISE_WIDGET_ORIGIN],
    ["FRONTDESKWISE_WIDGET_URL", process.env.FRONTDESKWISE_WIDGET_URL],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  if (missing.length) throw new Error(`Production configuration is missing: ${missing.join(", ")}`);
  if (!pool) throw new Error("Production configuration requires a PostgreSQL DATABASE_URL");
  if (allowedWebOrigins.includes("*")) throw new Error("Production WEB_ORIGIN must be an explicit origin, not *");
  if (process.env.DATABASE_SSL_REJECT_UNAUTHORIZED?.trim().toLowerCase() === "true"
      && !process.env.DATABASE_SSL_CA_FILE?.trim()
      && !process.env.DATABASE_SSL_CA?.trim()
      && !process.env.DATABASE_SSL_CA_BASE64?.trim()) {
    throw new Error("Production certificate validation requires DATABASE_SSL_CA_FILE, DATABASE_SSL_CA, or DATABASE_SSL_CA_BASE64");
  }
}

validateProductionConfiguration();

type WidgetMode = "compact" | "expanded" | "fullscreen";
type ProactiveTrigger = "delay" | "scroll" | "exit" | "returning";
type ProactiveBehavior = "teaser" | "open";
type ProactiveFrequency = "session" | "24h" | "visit";
type CitationVisibility = "always" | "contextual" | "hidden";

type WidgetQuickAction = {
  label: string;
  question: string;
};

type AgentConfig = {
  assistantName: string;
  welcomeMessage: string;
  tone: "friendly" | "professional" | "concise" | "custom";
  customToneInstructions: string;
  primaryLanguage: string;
  fallbackBehavior: "contact_form" | "human" | "unavailable";
  humanHandoffEnabled: boolean;
  widgetColor: string;
  collectLeads: boolean;
  showBookingAction: boolean;
  fallbackMessage: string;
  widgetDefaultMode: WidgetMode;
  widgetAllowExpand: boolean;
  widgetQuickActions: WidgetQuickAction[];
  widgetLogoUrl: string | null;
  widgetTheme: "light" | "dark" | "auto";
  widgetPosition: "bottom-right" | "bottom-left";
  proactiveEnabled: boolean;
  proactiveDelaySeconds: number;
  proactiveMessage: string;
  proactiveTriggers: ProactiveTrigger[];
  proactiveBehavior: ProactiveBehavior;
  proactiveFrequency: ProactiveFrequency;
  requireLeadConsent: boolean;
  privacyNoticeUrl: string | null;
  retentionDays: number;
  showAiDisclosure: boolean;
  citationVisibility: CitationVisibility;
  fallbackContacts: { phone: string | null; email: string | null; url: string | null };
};

type AgentPublishingStatus = "NOT_PUBLISHED" | "LIVE" | "LIVE_WITH_UNPUBLISHED_CHANGES";

type KnowledgeAnswerMode = "knowledge" | "fixed_response";
type KnowledgeIndexStatus = "not_indexed" | "pending" | "ready" | "failed";

type Source = {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  contentType: string;
  pageType: string;
  crawlStatus: "queued" | "crawling" | "ready" | "failed";
  contentHash: string;
  lastCrawledAt: string;
  httpStatus?: number | null;
  rawHtmlBytes?: number | null;
  extractedCharacterCount?: number | null;
  discoveredLinkCount?: number | null;
  crawlMode?: "static" | "rendered";
  renderAttempted?: boolean;
  renderSuccess?: boolean;
  renderDurationMs?: number | null;
  renderDiagnostics?: Record<string, unknown> | null;
  crawlDepth?: number | null;
  discoveryParentUrl?: string | null;
  errorMessage?: string | null;
};

type KnowledgeChunk = {
  id: string;
  sourceId: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
  embeddingModel?: string | null;
  embeddingDimensions?: number | null;
};

type BillingStatus = "trial" | "active" | "grace" | "paused" | "cancelled";
type OwnershipStatus = "pending" | "verified" | "rejected";
type OwnershipVerificationMethod = "email" | "meta_tag" | "file" | "dns_txt" | "manual";

type BillingState = {
  mode: "sandbox" | "live";
  isDemo: boolean;
  status: BillingStatus;
  planKey: string;
  interval: "month" | "year" | null;
  trialEndsAt: string | null;
  currentPeriodEndsAt: string | null;
  graceEndsAt: string | null;
  provider: string | null;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  stripeStatus?: string | null;
  checkoutStatus?: string | null;
  cancelAtPeriodEnd?: boolean;
  lastPaymentStatus?: string | null;
};

type FirebaseAuthUser = {
  identitySubject: string;
  email: string;
  name: string;
};

type AppUser = FirebaseAuthUser & { id: string };

type DemoAccessType = "public" | "admin" | "internal" | "claim";

type DemoAccessOptions = {
  demoRequestId?: string | null;
  createdByUserId?: string | null;
  accessType?: DemoAccessType;
  accessLabel?: string | null;
  email?: string | null;
  name?: string | null;
  expiresAt?: string;
};

type SupportCaseCategory = "general" | "installation" | "knowledge" | "actions" | "integration" | "billing" | "verification" | "widget" | "account";
type SupportCaseStatus = "open" | "in_progress" | "resolved";

type DemoAuditInput = {
  demoRequestId?: string | null;
  sessionId?: string | null;
  businessId?: string | null;
  eventType: string;
  actorType?: "anonymous" | "requester" | "user" | "admin" | "system";
  actorUserId?: string | null;
  actorEmail?: string | null;
  request?: FastifyRequest;
  metadata?: Record<string, unknown>;
};

type ConversationStatus = "AI_ACTIVE" | "HANDOFF_REQUESTED" | "WAITING_FOR_STAFF" | "HUMAN_ACTIVE" | "AI_ASSISTED" | "RESOLVED" | "EXPIRED";
type HandoffNotificationStatus = "sent" | "pending" | "failed" | null;
const CONVERSATION_RESUME_WINDOW_MS = 24 * 60 * 60 * 1_000;
type TeamRole = "owner" | "admin" | "staff" | "viewer";
type ConversationEventType =
  | "AI_HANDOFF_REQUESTED"
  | "STAFF_NOTIFIED"
  | "STAFF_ASSIGNED"
  | "HUMAN_JOINED"
  | "MESSAGE_SENT_BY_HUMAN"
  | "RETURNED_TO_AI"
  | "CONVERSATION_RESOLVED"
  | "CONVERSATION_EXPIRED"
  | "VISITOR_REPLIED"
  | "INTERNAL_NOTE_ADDED"
  | "AI_RESPONSE_SENT"
  | "CONVERSATION_DECISION_TRACE";

type Message = {
  id?: string;
  role: "user" | "assistant" | "human" | "system";
  kind?: "message" | "system" | "internal_note";
  authorUserId?: string;
  authorName?: string;
  content: string;
  grounded?: boolean;
  sourceUrl?: string;
  confidenceScore?: number;
  confidenceBand?: "high" | "medium" | "low";
  citations?: Array<{ title: string; url: string; sourceId?: string; chunkId?: string; pageType?: string }>;
  retrieval?: {
    mode: string;
    intent?: RetrievalIntent;
    candidateCount: number;
    topScore?: number;
    route?: string;
    model?: string | null;
    reason?: string;
    latencyMs?: number;
    rerankLatencyMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    estimatedCostUsd?: number | null;
  };
  createdAt: string;
};

type Conversation = {
  id: string;
  sessionId: string;
  leadCaptured: boolean;
  actionTaken: string | null;
  actionState?: ConversationActionState;
  status: ConversationStatus;
  assignedUserId: string | null;
  assignedAt: string | null;
  handoffReason: string | null;
  handoffRequestedAt: string | null;
  handoffNotificationStatus: HandoffNotificationStatus;
  humanJoinedAt: string | null;
  resolvedAt: string | null;
  unreadCount: number;
  lastActivityAt: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
};

type HandoffNotificationSettings = {
  enabled: boolean;
  defaultRecipientEmail: string | null;
  additionalRecipientEmails: string[];
  handoffDelaySeconds: 0 | 120 | 300;
  repeatEnabled: boolean;
  repeatAfterSeconds: number;
  notifyExplicitHumanRequest: boolean;
  notifyKnowledgeGap: boolean;
  notifyHighValueLead: boolean;
  notifyEveryLead: boolean;
};

const defaultHandoffNotificationSettings: HandoffNotificationSettings = {
  enabled: true,
  defaultRecipientEmail: null,
  additionalRecipientEmails: [],
  handoffDelaySeconds: 0,
  repeatEnabled: false,
  repeatAfterSeconds: 600,
  notifyExplicitHumanRequest: true,
  notifyKnowledgeGap: false,
  notifyHighValueLead: true,
  notifyEveryLead: false,
};

type ConversationEvent = {
  id: string;
  businessId: string;
  conversationId: string;
  eventType: ConversationEventType;
  actorUserId: string | null;
  actorType: "visitor" | "ai" | "staff" | "system";
  metadata: Record<string, unknown>;
  createdAt: string;
};

type ConversionEventType =
  | "FLOW_STARTED"
  | "FIELD_VIEWED"
  | "FIELD_COMPLETED"
  | "FIELD_ABANDONED"
  | "FORM_DISPLAYED"
  | "FORM_SUBMITTED"
  | "ACTION_STARTED"
  | "ACTION_SUCCEEDED"
  | "ACTION_FAILED"
  | "FLOW_COMPLETED"
  | "CTA_SHOWN"
  | "CTA_CLICKED"
  | "DEMO_LINK_OPENED"
  | "HANDOFF_REQUESTED"
  | "LEAD_CAPTURED"
  | "BOOKING_LINK_OPENED"
  | "CONVERSATION_ABANDONED";

type ConversionEvent = {
  id: string;
  organizationId: string | null;
  businessId: string;
  conversationId: string | null;
  flowId: string | null;
  fieldId: string | null;
  event: ConversionEventType;
  timestamp: string;
  sourcePage: string | null;
  device: string | null;
  metadata: Record<string, unknown>;
};

type WidgetPerformanceEvent = {
  id: string;
  organizationId: string | null;
  businessId: string;
  conversationId: string | null;
  requestId: string | null;
  event: string;
  durationMs: number | null;
  occurredAt: string;
  sourcePage: string | null;
  device: string | null;
  metrics: Record<string, string | number | boolean | null>;
};

const conversionEventTypes = new Set<ConversionEventType>([
  "FLOW_STARTED", "FIELD_VIEWED", "FIELD_COMPLETED", "FIELD_ABANDONED",
  "FORM_DISPLAYED", "FORM_SUBMITTED", "ACTION_STARTED", "ACTION_SUCCEEDED",
  "ACTION_FAILED", "FLOW_COMPLETED", "CTA_SHOWN", "CTA_CLICKED", "DEMO_LINK_OPENED", "HANDOFF_REQUESTED",
  "LEAD_CAPTURED", "BOOKING_LINK_OPENED", "CONVERSATION_ABANDONED",
]);

const widgetPerformanceEventTypes = new Set([
  "loader_requested",
  "loader_downloaded",
  "launcher_rendered",
  "proactive_config_available",
  "proactive_config_revalidated",
  "proactive_triggered",
  "teaser_rendered",
  "teaser_clicked",
  "teaser_dismissed",
  "launcher_clicked",
  "full_shell_visible",
  "bootstrap_config_completed",
  "conversation_restored",
  "user_message_sent",
  "first_assistant_content_available",
  "full_response_rendered",
  "response_error",
  "message_backend",
  "bootstrap_config_failed",
  "conversation_restore_failed",
  "message_retry",
  "network_offline",
  "network_restored",
  "connector_delivery_failed",
  "handoff_notification_failed",
]);

type Notification = {
  id: string;
  organizationId: string | null;
  businessId: string;
  userId: string | null;
  type: string;
  conversationId: string | null;
  leadId: string | null;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
};

type InternalNote = {
  id: string;
  businessId: string;
  conversationId: string;
  authorUserId: string;
  authorName?: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type Lead = {
  id: string;
  conversationId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  intent: string | null;
  status: "new" | "qualified" | "booked";
  source: string;
  pageUrl: string | null;
  referrer: string | null;
  consentAt: string | null;
  idempotencyKey: string | null;
  metadata: Record<string, unknown>;
  notes?: string;
  createdAt: string;
};

type ActionSubmission = {
  id: string;
  businessId: string;
  actionId: string;
  conversationId: string;
  idempotencyKey: string;
  values: Record<string, string>;
  sourcePage: string | null;
  status: "received" | "completed" | "failed";
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
};

type KnowledgeGap = {
  question: string;
  occurrenceCount: number;
  status: "open" | "resolved" | "ignored";
  approvedAnswer: string | null;
  answerMode: KnowledgeAnswerMode;
  lastSeenAt: string;
  updatedAt: string;
  indexedAt: string | null;
  indexStatus: KnowledgeIndexStatus;
  indexError: string | null;
  intent: RetrievalIntent | null;
  reason: KnowledgeGapReason | "legacy_unknown";
};

type EvaluationExpectation = "grounded" | "fallback";

type EvaluationCase = {
  category: string;
  question: string;
  expectation: EvaluationExpectation;
  expectedSourceTypes?: string[];
  forbiddenPrimarySourceTypes?: string[];
};

type EvaluationScores = {
  correctness: number;
  relevance: number;
  grounding: number;
  citationQuality: number;
  conciseness: number;
  fallbackCorrectness: number;
  hallucination: "pass" | "fail";
};

type EvaluationResult = {
  category: string;
  question: string;
  expectation: EvaluationExpectation;
  passed: boolean;
  grounded: boolean;
  confidenceScore: number;
  confidenceBand: "high" | "medium" | "low";
  citationCount: number;
  answer: string;
  latencyMs: number;
  retrievalMode: string;
  intent: RetrievalIntent;
  retrievedPages: string[];
  citations: Array<{ title: string; url: string; pageType: string }>;
  topRetrievalScore: number;
  scores: EvaluationScores;
  expectedSourceTypes?: string[];
  primarySourceType?: string;
  forbiddenPrimarySourceTypes?: string[];
};

type Business = {
  id: string;
  organizationId?: string | null;
  name: string;
  slug: string;
  vertical: string;
  websiteUrl: string;
  location: string;
  ownershipStatus: OwnershipStatus;
  ownershipVerificationMethod: OwnershipVerificationMethod | null;
  ownershipVerificationTokenHash: string | null;
  ownershipVerificationExpiresAt: string | null;
  ownershipVerifiedAt: string | null;
  ownershipVerifiedByUserId: string | null;
  agentPublishedAt: string | null;
  primaryActionId: string | null;
  sources: Source[];
  chunks: KnowledgeChunk[];
  facts: BusinessFact[];
  actions: ActionFlow[];
  actionSubmissions: ActionSubmission[];
  actionResources: ActionResource[];
  conversations: Map<string, Conversation>;
  conversationEvents: ConversationEvent[];
  conversionEvents: ConversionEvent[];
  notifications: Notification[];
  internalNotes: InternalNote[];
  leads: Lead[];
  knowledgeGaps: Map<string, KnowledgeGap>;
  businessContextSnapshot?: BusinessContextSnapshot | null;
  agentConfig: AgentConfig;
  publishedAgentConfig: AgentConfig | null;
  publishedAgentConfigHash: string | null;
  billing: BillingState;
  widget: {
    siteKey: string;
    enabled: boolean;
    lastLoadedAt: string | null;
    loadCount: number;
  };
  createdAt: string;
};

const businesses = new Map<string, Business>();
const memoryDemoAccess = new Map<string, { slug: string; businessId: string; expiresAt: string }>();
const DEMO_ACCESS_TTL_MS = 48 * 60 * 60 * 1_000;
const INTERNAL_DEMO_SLUGS = new Set([
  "british-swim-school-tampa-bay",
  "munchkin-town",
  "tampa-bay-family-dental",
]);

function invalidateBusinessRuntimeCache(businessId: string): void {
  for (const [slug, business] of businesses) {
    if (business.id === businessId) businesses.delete(slug);
  }
}

function isInternalDemoSlug(slug: string): boolean {
  return INTERNAL_DEMO_SLUGS.has(slug);
}

function defaultQuickActions(businessName: string): WidgetQuickAction[] {
  return [
    { label: "Explore services", question: `What services does ${businessName} offer?` },
    { label: "Pricing", question: "What does pricing look like?" },
    { label: "Get started", question: "How do I get started?" },
    { label: "Ask a question", question: "" },
  ];
}

function normalizedWidgetMode(value: unknown): WidgetMode {
  return value === "expanded" || value === "fullscreen" ? value : "compact";
}

function normalizedWidgetQuickActions(value: unknown, businessName: string): WidgetQuickAction[] {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = null;
    }
  }
  if (!Array.isArray(candidate)) return defaultQuickActions(businessName);
  const actions = candidate
    .map((item): WidgetQuickAction | null => {
      const record = asRecord(item);
      const label = typeof record.label === "string" ? record.label.trim().slice(0, 48) : "";
      const question = typeof record.question === "string" ? record.question.trim().slice(0, 300) : "";
      return label ? { label, question } : null;
    })
    .filter((item): item is WidgetQuickAction => Boolean(item))
    .slice(0, 4);
  return actions.length ? actions : defaultQuickActions(businessName);
}

function normalizedProactiveTriggers(value: unknown): ProactiveTrigger[] {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = null;
    }
  }
  if (!Array.isArray(candidate)) return ["delay", "scroll", "exit"];
  const allowed = new Set<ProactiveTrigger>(["delay", "scroll", "exit", "returning"]);
  const triggers = candidate.filter((item): item is ProactiveTrigger => typeof item === "string" && allowed.has(item as ProactiveTrigger));
  return [...new Set(triggers)];
}

function normalizedProactiveDelay(value: unknown): number {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(10, Math.min(120, Math.round(seconds))) : 20;
}

function normalizedProactiveBehavior(value: unknown): ProactiveBehavior {
  return value === "open" ? "open" : "teaser";
}

function normalizedProactiveFrequency(value: unknown): ProactiveFrequency {
  return value === "24h" || value === "visit" ? value : "session";
}

function normalizedRetentionDays(value: unknown): number {
  const days = Number(value);
  return [30, 60, 90, 365].includes(days) ? days : 90;
}

function normalizedCitationVisibility(value: unknown, legacyShowSources?: unknown): CitationVisibility {
  if (value === "contextual" || value === "hidden" || value === "always") return value;
  if (legacyShowSources === false) return "hidden";
  return "always";
}

const defaultConfig = (businessName: string): AgentConfig => ({
  assistantName: `${businessName} Assistant`,
  welcomeMessage: `Hi! I’m the ${businessName} assistant. I can answer questions, help you explore features, or get you started.`,
  tone: "friendly",
  customToneInstructions: "",
  primaryLanguage: "English",
  fallbackBehavior: "contact_form",
  humanHandoffEnabled: true,
  widgetColor: "#0d6efd",
  collectLeads: true,
  showBookingAction: true,
  fallbackMessage: "I do not have enough information to answer that confidently. I can take your details and have the team follow up.",
  widgetDefaultMode: "compact",
  widgetAllowExpand: true,
  widgetQuickActions: defaultQuickActions(businessName),
  widgetLogoUrl: null,
  widgetTheme: "auto",
  widgetPosition: "bottom-right",
  proactiveEnabled: false,
  proactiveDelaySeconds: 20,
  proactiveMessage: "Looking for the right service? I can help.",
  proactiveTriggers: ["delay", "scroll", "returning"],
  proactiveBehavior: "teaser",
  proactiveFrequency: "session",
  requireLeadConsent: false,
  privacyNoticeUrl: null,
  retentionDays: 90,
  showAiDisclosure: true,
  citationVisibility: "always",
  fallbackContacts: { phone: null, email: null, url: null },
});

function cloneAgentConfig(config: AgentConfig): AgentConfig {
  return { ...config, widgetQuickActions: config.widgetQuickActions.map((action) => ({ ...action })), proactiveTriggers: [...config.proactiveTriggers] };
}

function agentConfigFromValue(value: unknown, businessName: string): AgentConfig {
  const config = asRecord(value);
  const configuredAssistantName = typeof config.assistantName === "string" ? config.assistantName.trim() : "";
  const assistantBrand = configuredAssistantName.replace(/\s+AI Assistant$/i, "").replace(/\s+Assistant$/i, "").trim() || businessName;
  const fallback = defaultConfig(assistantBrand);
  const fallbackContactConfig = asRecord(config.fallbackContacts);
  const configuredWelcome = typeof config.welcomeMessage === "string" ? config.welcomeMessage.trim() : "";
  const legacyWelcome = /^Hi! I['’]m the .+ assistant\. I can answer questions, help you choose a service, or get you started\.$/i.test(configuredWelcome);
  return {
    assistantName: configuredAssistantName ? configuredAssistantName.slice(0, 120) : fallback.assistantName,
    welcomeMessage: configuredWelcome && !legacyWelcome ? configuredWelcome.slice(0, 1_000) : fallback.welcomeMessage,
    tone: ["friendly", "professional", "concise", "custom"].includes(String(config.tone)) ? config.tone as AgentConfig["tone"] : fallback.tone,
    customToneInstructions: typeof config.customToneInstructions === "string" ? config.customToneInstructions.slice(0, 600) : fallback.customToneInstructions,
    primaryLanguage: typeof config.primaryLanguage === "string" && config.primaryLanguage.trim() ? config.primaryLanguage.trim().slice(0, 80) : fallback.primaryLanguage,
    fallbackBehavior: ["contact_form", "human", "unavailable"].includes(String(config.fallbackBehavior)) ? config.fallbackBehavior as AgentConfig["fallbackBehavior"] : fallback.fallbackBehavior,
    humanHandoffEnabled: config.humanHandoffEnabled !== false,
    widgetColor: typeof config.widgetColor === "string" && /^#[\da-f]{6}$/i.test(config.widgetColor) ? config.widgetColor : fallback.widgetColor,
    collectLeads: config.collectLeads !== false,
    showBookingAction: config.showBookingAction !== false,
    fallbackMessage: typeof config.fallbackMessage === "string" && config.fallbackMessage.trim() ? config.fallbackMessage : fallback.fallbackMessage,
    widgetDefaultMode: normalizedWidgetMode(config.widgetDefaultMode),
    widgetAllowExpand: config.widgetAllowExpand !== false,
    widgetQuickActions: normalizedWidgetQuickActions(config.widgetQuickActions, businessName),
    widgetLogoUrl: typeof config.widgetLogoUrl === "string" && config.widgetLogoUrl.trim() ? config.widgetLogoUrl.trim() : null,
    widgetTheme: ["light", "dark", "auto"].includes(String(config.widgetTheme)) ? config.widgetTheme as AgentConfig["widgetTheme"] : fallback.widgetTheme,
    widgetPosition: ["bottom-right", "bottom-left"].includes(String(config.widgetPosition)) ? config.widgetPosition as AgentConfig["widgetPosition"] : fallback.widgetPosition,
    proactiveEnabled: config.proactiveEnabled === true,
    proactiveDelaySeconds: normalizedProactiveDelay(config.proactiveDelaySeconds),
    proactiveMessage: typeof config.proactiveMessage === "string" && config.proactiveMessage.trim() ? config.proactiveMessage.trim() : fallback.proactiveMessage,
    proactiveTriggers: normalizedProactiveTriggers(config.proactiveTriggers),
    proactiveBehavior: normalizedProactiveBehavior(config.proactiveBehavior),
    proactiveFrequency: normalizedProactiveFrequency(config.proactiveFrequency),
    requireLeadConsent: config.requireLeadConsent === true,
    privacyNoticeUrl: typeof config.privacyNoticeUrl === "string" && config.privacyNoticeUrl.trim() ? config.privacyNoticeUrl.trim() : null,
    retentionDays: normalizedRetentionDays(config.retentionDays),
    showAiDisclosure: config.showAiDisclosure !== false,
    citationVisibility: normalizedCitationVisibility(config.citationVisibility, config.showSources),
    fallbackContacts: {
      phone: typeof (config.fallbackPhone ?? fallbackContactConfig.phone) === "string" && String(config.fallbackPhone ?? fallbackContactConfig.phone).trim() ? String(config.fallbackPhone ?? fallbackContactConfig.phone).trim().slice(0, 80) : fallback.fallbackContacts.phone,
      email: normalizedNotificationEmail(config.fallbackEmail ?? fallbackContactConfig.email) ?? fallback.fallbackContacts.email,
      url: typeof (config.fallbackContactUrl ?? fallbackContactConfig.url) === "string" && /^https?:\/\//i.test(String(config.fallbackContactUrl ?? fallbackContactConfig.url).trim()) ? String(config.fallbackContactUrl ?? fallbackContactConfig.url).trim().slice(0, 2_000) : fallback.fallbackContacts.url,
    },
  };
}

function agentConfigHash(config: AgentConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

function agentPublishingPayload(business: Business): {
  status: AgentPublishingStatus;
  domain: string | null;
  publishedAt: string | null;
} {
  if (!business.publishedAgentConfig) return { status: "NOT_PUBLISHED", domain: null, publishedAt: null };
  const publishedHash = business.publishedAgentConfigHash ?? agentConfigHash(business.publishedAgentConfig);
  let domain: string | null = null;
  try {
    domain = business.websiteUrl ? new URL(business.websiteUrl).hostname.replace(/^www\./i, "") : null;
  } catch {
    domain = null;
  }
  return {
    status: agentConfigHash(business.agentConfig) === publishedHash ? "LIVE" : "LIVE_WITH_UNPUBLISHED_CHANGES",
    domain,
    publishedAt: business.agentPublishedAt,
  };
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function isUniqueConstraintError(value: unknown, constraint: string): boolean {
  const error = asRecord(value);
  return error.code === "23505" && error.constraint === constraint;
}

function requiredString(value: unknown, field: string, maxLength = 500): string {
  if (typeof value !== "string" || !value.trim()) {
    throw httpError(400, `${field} is required`);
  }
  return value.trim().slice(0, maxLength);
}

function contentHash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function oauthStateHash(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
}

function lifecycleAppUrl(path: string): string {
  const origin = process.env.FRONTDESKWISE_APP_URL?.trim() || process.env.WEB_ORIGIN?.split(",")[0]?.trim() || "https://app.frontdeskwise.com";
  return `${origin.replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
}

function normalizedNotificationEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 320) : null;
}

function normalizedNotificationEmails(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[\n,]+/) : [];
  return [...new Set(values.map(normalizedNotificationEmail).filter((email): email is string => Boolean(email)))].slice(0, 20);
}

function handoffNotificationSettingsPayload(row?: Record<string, unknown>): HandoffNotificationSettings {
  const delay = Number(row?.handoff_delay_seconds ?? defaultHandoffNotificationSettings.handoffDelaySeconds);
  const handoffDelaySeconds: 0 | 120 | 300 = delay === 120 || delay === 300 ? delay : 0;
  return {
    enabled: row?.handoff_enabled !== false,
    defaultRecipientEmail: normalizedNotificationEmail(row?.default_recipient_email),
    additionalRecipientEmails: normalizedNotificationEmails(row?.additional_recipient_emails),
    handoffDelaySeconds,
    repeatEnabled: row?.repeat_enabled === true,
    repeatAfterSeconds: Math.max(60, Math.min(86_400, Number(row?.repeat_after_seconds ?? 600))),
    notifyExplicitHumanRequest: row?.notify_explicit_human_request !== false,
    notifyKnowledgeGap: row?.notify_knowledge_gap === true,
    notifyHighValueLead: row?.notify_high_value_lead !== false,
    notifyEveryLead: row?.notify_every_lead === true,
  };
}

async function loadHandoffNotificationSettings(business: Business): Promise<HandoffNotificationSettings> {
  if (!pool) return { ...defaultHandoffNotificationSettings };
  try {
    const result = await pool.query<Record<string, unknown>>(
      "select * from business_notification_settings where business_id = $1",
      [business.id],
    );
    return handoffNotificationSettingsPayload(result.rows[0]);
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    return { ...defaultHandoffNotificationSettings };
  }
}

async function queueLifecycleEvent(input: {
  eventType: LifecycleEventType;
  eventKey: string;
  organizationId?: string | null;
  businessId?: string | null;
  recipientUserId?: string | null;
  recipientUserIds?: string[];
  recipientEmail?: string | null;
  recipientEmails?: string[];
  delaySeconds?: number;
  payload?: Record<string, unknown>;
}): Promise<number> {
  try {
    const queued = await emitLifecycleEvent(pool, input);
    scheduleLifecycleMessaging(250, pool);
    return queued;
  } catch (error) {
    app.log.warn({ eventType: input.eventType, eventKey: input.eventKey, error: error instanceof Error ? error.message : "unknown messaging error" }, "Lifecycle message could not be queued");
    return 0;
  }
}

function safeConsentAt(value: unknown): string | null {
  const candidate = optionalString(value, 80);
  if (!candidate) return null;
  const parsed = Date.parse(candidate);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

function safeLeadMetadata(value: unknown, body: Record<string, unknown>): Record<string, unknown> {
  const source = asRecord(value);
  const metadata: Record<string, unknown> = {};
  const allowedKeys = new Set([
    "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "gclid", "fbclid",
    "landing_page", "form_name", "campaign", "referral_code",
  ]);
  for (const [key, item] of Object.entries({ ...source, ...body })) {
    if (!allowedKeys.has(key) || Object.keys(metadata).length >= 20) continue;
    if (typeof item === "string" && item.trim()) metadata[key] = item.trim().slice(0, 240);
  }
  return metadata;
}

function firebaseProjectId(): string {
  const projectId = process.env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw httpError(503, "Firebase authentication is not configured on this environment");
  return projectId;
}

function firebaseAuthUserFromClaims(claims: Record<string, unknown>): FirebaseAuthUser {
  const identitySubject = typeof claims.sub === "string" ? claims.sub.trim() : "";
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  const nameClaim = typeof claims.name === "string" ? claims.name.trim() : "";
  if (!identitySubject || !email || !email.includes("@")) throw httpError(401, "A verified Firebase email identity is required");
  return {
    identitySubject,
    email,
    name: nameClaim.slice(0, 160) || email.split("@", 1)[0].slice(0, 160) || "FrontDeskWise user",
  };
}

async function requireFirebaseAuth(request: FastifyRequest): Promise<FirebaseAuthUser> {
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const token = bearerToken(request);
  if (!token) throw httpError(401, "A Firebase bearer token is required");
  try {
    const claims = await verifyFirebaseIdToken(token, firebaseProjectId());
    return firebaseAuthUserFromClaims(claims);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode) throw error;
    throw httpError(401, error instanceof Error ? error.message : "Firebase token verification failed");
  }
}

async function ensureAppUser(client: PoolClient, authUser: FirebaseAuthUser): Promise<AppUser> {
  const bySubject = await client.query<Record<string, unknown>>(
    "select id, identity_subject, email, name from app_users where identity_subject = $1 for update",
    [authUser.identitySubject],
  );
  const byEmail = await client.query<Record<string, unknown>>(
    "select id, identity_subject, email, name from app_users where email_normalized = $1 for update",
    [authUser.email],
  );
  if (bySubject.rowCount && byEmail.rowCount && bySubject.rows[0].id !== byEmail.rows[0].id) {
    throw httpError(409, "This Firebase identity and email are linked to different FrontDeskWise accounts");
  }

  const existing = bySubject.rows[0] ?? byEmail.rows[0];
  if (existing) {
    if (existing.identity_subject && existing.identity_subject !== authUser.identitySubject) {
      throw httpError(409, "This email is already linked to another identity");
    }
    const updated = await client.query<Record<string, unknown>>(
      `update app_users
       set identity_subject = $2, email = $3, email_normalized = $3, name = $4, status = 'active', updated_at = now()
       where id = $1
       returning id, identity_subject, email, name`,
      [existing.id, authUser.identitySubject, authUser.email, authUser.name],
    );
    const row = updated.rows[0];
    return { id: String(row.id), identitySubject: String(row.identity_subject), email: String(row.email), name: String(row.name) };
  }

  const created = await client.query<Record<string, unknown>>(
    `insert into app_users (identity_subject, email, email_normalized, name)
     values ($1, $2, $2, $3)
     returning id, identity_subject, email, name`,
    [authUser.identitySubject, authUser.email, authUser.name],
  );
  const row = created.rows[0];
  return { id: String(row.id), identitySubject: String(row.identity_subject), email: String(row.email), name: String(row.name) };
}

function nullableIso(value: unknown): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function organizationBillingAccess(row: Record<string, unknown>): { allowed: boolean; reason: string } {
  const mode = row.billing_mode === "sandbox" ? "sandbox" : "live";
  const status = String(row.billing_status ?? "trial");
  if (mode === "sandbox") return { allowed: true, reason: "sandbox" };
  if (status === "active") return { allowed: true, reason: "active_subscription" };
  if (status === "trial" && (!row.trial_end_at || Date.parse(toIso(row.trial_end_at)) > Date.now())) return { allowed: true, reason: "trial" };
  if (status === "grace" && (!row.grace_end_at || Date.parse(toIso(row.grace_end_at)) > Date.now())) return { allowed: true, reason: "billing_grace" };
  return { allowed: false, reason: status };
}

function requireWritableOrganization(row: Record<string, unknown>): void {
  const access = organizationBillingAccess(row);
  if (!access.allowed) throw httpError(402, "This organization is read-only until billing is restored");
}

function organizationBillingPayload(row: Record<string, unknown>): Record<string, unknown> {
  const planKey = String(row.plan_key ?? "starter");
  const effectiveAmount = row.effective_amount_cents ?? row.billing_amount_cents ?? row.plan_amount_cents;
  const maxBusinesses = row.effective_max_businesses ?? row.max_businesses ?? 1;
  return {
    mode: row.billing_mode === "sandbox" ? "sandbox" : "live",
    status: String(row.billing_status ?? "trial"),
    planKey,
    interval: row.override_interval ?? row.billing_interval ?? "month",
    trialStartAt: nullableIso(row.trial_start_at),
    trialEndAt: nullableIso(row.trial_end_at),
    currentPeriodStartAt: nullableIso(row.current_period_start_at),
    currentPeriodEndAt: nullableIso(row.current_period_end_at),
    graceEndAt: nullableIso(row.grace_end_at),
    provider: typeof row.billing_provider === "string" ? row.billing_provider : null,
    providerCustomerId: typeof row.stripe_customer_id === "string" ? row.stripe_customer_id : null,
    providerSubscriptionId: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
    providerPriceId: typeof row.stripe_price_id === "string" ? row.stripe_price_id : null,
    stripeStatus: typeof row.stripe_subscription_status === "string" ? row.stripe_subscription_status : null,
    checkoutStatus: typeof row.stripe_checkout_status === "string" ? row.stripe_checkout_status : null,
    checkoutSessionId: typeof row.stripe_checkout_session_id === "string" ? row.stripe_checkout_session_id : null,
    pendingPlanKey: typeof row.pending_plan_key === "string" ? row.pending_plan_key : null,
    pendingBillingInterval: typeof row.pending_billing_interval === "string" ? row.pending_billing_interval : null,
    pendingPlanChangeType: typeof row.pending_plan_change_type === "string" ? row.pending_plan_change_type : null,
    pendingPlanChangeAt: nullableIso(row.pending_plan_change_at),
    stripeSubscriptionScheduleId: typeof row.stripe_subscription_schedule_id === "string" ? row.stripe_subscription_schedule_id : null,
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    lastPaymentStatus: typeof row.last_payment_status === "string" ? row.last_payment_status : null,
    activationEmailQueuedAt: nullableIso(row.subscription_activation_email_queued_at),
    amountCents: effectiveAmount === null || effectiveAmount === undefined ? null : Number(effectiveAmount),
    currency: String(row.billing_currency ?? "usd"),
    access: organizationBillingAccess(row),
    plan: {
      key: planKey,
      displayName: String(row.plan_display_name ?? planKey),
      description: String(row.plan_description ?? "FrontDeskWise workspace plan"),
      amountCents: effectiveAmount === null || effectiveAmount === undefined ? null : Number(effectiveAmount),
      currency: String(row.billing_currency ?? "usd"),
      maxBusinesses: Number(maxBusinesses),
    },
    override: row.override_reason ? { reason: String(row.override_reason) } : null,
  };
}

async function authenticatedAppUser(request: FastifyRequest): Promise<{ authUser: FirebaseAuthUser; appUser: AppUser }> {
  const authUser = await requireFirebaseAuth(request);
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    "select id, identity_subject, email, name from app_users where identity_subject = $1 and status = 'active'",
    [authUser.identitySubject],
  );
  if (!result.rowCount) throw httpError(404, "FrontDeskWise account has not been bootstrapped");
  const row = result.rows[0];
  return {
    authUser,
    appUser: { id: String(row.id), identitySubject: String(row.identity_subject), email: String(row.email), name: String(row.name) },
  };
}

async function organizationForUser(userId: string, organizationId: string | null, requiredRoles: string[] = ["owner", "admin"]): Promise<Record<string, unknown>> {
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select o.*, om.role,
            bp.display_name as plan_display_name, bp.description as plan_description,
            bp.monthly_amount_cents as plan_amount_cents, bp.max_businesses,
            coalesce(opo.amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
            coalesce(opo.max_businesses, bp.max_businesses) as effective_max_businesses,
            opo.billing_interval as override_interval, opo.reason as override_reason
     from organizations o
     join organization_members om on om.organization_id = o.id and om.user_id = $1
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     where ($2::uuid is null or o.id = $2::uuid)
       and om.role = any($3::text[])
     order by (om.role = 'owner') desc, om.created_at asc
     limit 1`,
    [userId, organizationId, requiredRoles],
  );
  if (!result.rowCount) throw httpError(403, "You do not have permission to access that organization");
  return result.rows[0];
}

async function organizationBusinessForUser(userId: string, organizationId: string, businessId: string): Promise<void> {
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  const result = await pool.query(
    `select b.id
     from businesses b
     join organization_members om on om.organization_id = b.organization_id and om.user_id = $1
     where b.organization_id = $2 and b.id = $3 and om.role = any($4::text[])
     limit 1`,
    [userId, organizationId, businessId, ["owner", "admin"]],
  );
  if (!result.rowCount) throw httpError(403, "You do not have permission to access that business");
}

function organizationDocumentPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    businessId: row.business_id ? String(row.business_id) : null,
    fileName: String(row.original_file_name),
    contentType: String(row.content_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    etag: typeof row.etag === "string" ? row.etag : null,
    status: String(row.status),
    metadata: asRecord(row.metadata),
    createdAt: nullableIso(row.created_at),
    updatedAt: nullableIso(row.updated_at),
  };
}

async function authSnapshot(userId: string, activeOrganizationId: string | null = null): Promise<Record<string, unknown>> {
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const [userResult, organizationResult, businessResult] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `select u.id, u.email, u.name,
              exists (select 1 from super_admin_users sa where sa.user_id = u.id and sa.status = 'active') as is_super_admin
       from app_users u where u.id = $1 and u.status = 'active'`,
      [userId],
    ),
    pool.query<Record<string, unknown>>(
      `select o.id, o.name, o.slug, om.role,
              o.billing_mode, o.billing_status, o.plan_key, o.billing_interval,
              o.trial_start_at, o.trial_end_at, o.current_period_start_at,
              o.current_period_end_at, o.grace_end_at, o.billing_provider,
              o.stripe_customer_id, o.stripe_subscription_id, o.stripe_price_id,
              o.stripe_checkout_session_id, o.stripe_checkout_status, o.pending_plan_key,
              o.pending_billing_interval, o.pending_plan_change_type, o.pending_plan_change_at,
              o.stripe_subscription_schedule_id, o.stripe_subscription_status, o.cancel_at_period_end,
              o.last_payment_status,
              o.billing_amount_cents, o.billing_currency,
              bp.display_name as plan_display_name, bp.description as plan_description,
              bp.monthly_amount_cents as plan_amount_cents, bp.max_businesses,
              coalesce(opo.amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
              coalesce(opo.max_businesses, bp.max_businesses) as effective_max_businesses,
              opo.billing_interval as override_interval, opo.reason as override_reason,
              (select count(*)::integer from conversations c join businesses b on b.id = c.business_id where b.organization_id = o.id) as conversation_count,
              (select count(*)::integer from leads l join businesses b on b.id = l.business_id where b.organization_id = o.id) as lead_count,
              (select count(*)::integer from conversations c join businesses b on b.id = c.business_id where b.organization_id = o.id and c.action_taken = 'booking') as booking_count
       from organization_members om
       join organizations o on o.id = om.organization_id
       left join billing_plans bp on bp.plan_key = o.plan_key
       left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
       where om.user_id = $1
       order by om.created_at`,
      [userId],
    ),
    pool.query<Record<string, unknown>>(
      `select b.id, b.organization_id, b.name, b.slug, b.website_url, b.website_url_key, b.is_demo,
              o.billing_status, o.plan_key,
              coalesce(bm.role, case when om.role in ('owner', 'admin') then 'admin' else null end) as business_role
       from businesses b
       join organizations o on o.id = b.organization_id
       join organization_members om on om.organization_id = b.organization_id and om.user_id = $1
       left join business_members bm on bm.business_id = b.id and bm.user_id = $1
       where om.role in ('owner', 'admin') or bm.user_id is not null
       order by b.created_at`,
      [userId],
    ),
  ]);
  if (!userResult.rowCount) throw httpError(401, "FrontDeskWise account not found");
  const businessesByOrganization = new Map<string, Array<Record<string, unknown>>>();
  const seenBusinessIdentities = new Set<string>();
  for (const row of businessResult.rows) {
    const organizationId = String(row.organization_id);
    const businessId = String(row.id);
    const websiteValue = typeof row.website_url === "string" && row.website_url.trim()
      ? row.website_url
      : typeof row.website_url_key === "string" && row.website_url_key.trim()
        ? row.website_url_key
        : null;
    let businessIdentity = businessId;
    if (websiteValue) {
      try {
        businessIdentity = websiteIdentityKey(websiteValue);
      } catch {
        // Keep the row addressable by id when legacy website data is malformed.
      }
    }
    const dedupeKey = `${organizationId}:${businessIdentity}`;
    if (seenBusinessIdentities.has(dedupeKey)) continue;
    seenBusinessIdentities.add(dedupeKey);
    const list = businessesByOrganization.get(organizationId) ?? [];
    list.push({
      id: businessId,
      name: String(row.name),
      slug: String(row.slug),
      websiteUrl: typeof row.website_url === "string" ? row.website_url : null,
      isDemo: row.is_demo !== false,
      billingStatus: String(row.billing_status ?? "trial"),
      planKey: String(row.plan_key ?? "demo"),
      role: typeof row.business_role === "string" ? row.business_role : "viewer",
    });
    businessesByOrganization.set(organizationId, list);
  }
  const organizations = organizationResult.rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    role: String(row.role),
    billing: organizationBillingPayload(row),
    businesses: businessesByOrganization.get(String(row.id)) ?? [],
    metrics: {
      conversations: Number(row.conversation_count ?? 0),
      leads: Number(row.lead_count ?? 0),
      bookings: Number(row.booking_count ?? 0),
    },
  }));
  return {
    user: {
      id: String(userResult.rows[0].id), email: String(userResult.rows[0].email), name: String(userResult.rows[0].name),
      isSuperAdmin: Boolean(userResult.rows[0].is_super_admin),
    },
    organizations,
    activeOrganizationId: activeOrganizationId && organizations.some((organization) => organization.id === activeOrganizationId)
      ? activeOrganizationId
      : (organizations[0]?.id ?? null),
  };
}

async function bootstrapAuthenticatedUser(
  authUser: FirebaseAuthUser,
  options: { demoToken?: string | null; organizationName?: string | null },
): Promise<Record<string, unknown>> {
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const user = await ensureAppUser(client, authUser);
    const existingMembership = await client.query<{ organization_id: string }>(
      `select organization_id from organization_members
       where user_id = $1 order by (role = 'owner') desc, created_at asc limit 1`,
      [user.id],
    );
    let organizationId = existingMembership.rows[0]?.organization_id ?? null;
    let activeBusinessId: string | null = null;
    let claimedDemoAudit: DemoAuditInput | null = null;

    if (options.demoToken) {
      const session = await client.query<Record<string, unknown>>(
        `select s.id, s.business_id, s.demo_request_id, b.organization_id, b.is_internal_demo, b.slug
         from demo_access_sessions s
         join businesses b on b.id = s.business_id
         where s.token_hash = $1 and s.revoked_at is null and s.claimable = true
           and s.claimed_at is null and s.expires_at > now()
         for update`,
        [hashAccessToken(options.demoToken)],
      );
      if (!session.rowCount) throw httpError(401, "The demo session is invalid or expired");
      const demo = session.rows[0];
      if (demo.is_internal_demo !== true) {
        if (!organizationId) {
          const organizationName = options.organizationName || `${authUser.name}'s Businesses`;
          const organization = await client.query<{ id: string }>(
            `insert into organizations
               (name, slug, billing_mode, billing_status, plan_key, billing_interval, trial_start_at, trial_end_at)
             values ($1, $2, 'live', 'trial', 'starter', 'month', now(), $3)
             returning id`,
            [organizationName.slice(0, 160), `org-${randomUUID().replace(/-/g, "").slice(0, 24)}`, trialEndFromNow()],
          );
          organizationId = organization.rows[0].id;
        }
        await client.query(
          `insert into organization_members (organization_id, user_id, role)
           values ($1, $2, 'owner')
           on conflict (organization_id, user_id) do update set role = 'owner', updated_at = now()`,
          [organizationId, user.id],
        );
        const claimed = await client.query<{ id: string }>(
          `update businesses
           set organization_id = $2, is_demo = false, billing_mode = 'live', billing_status = 'trial', plan_key = 'starter',
               trial_ends_at = coalesce(trial_ends_at, (select trial_end_at from organizations where id = $2)), updated_at = now()
           where id = $1
           returning id`,
          [demo.business_id, organizationId],
        );
        activeBusinessId = claimed.rows[0]?.id ?? null;
        await client.query(
          `insert into business_members (business_id, user_id, role)
           values ($1, $2, 'admin')
           on conflict (business_id, user_id) do update set role = 'admin', updated_at = now()`,
          [demo.business_id, user.id],
        );
        await client.query(
          `update demo_access_sessions
           set claimable = false, claimed_at = now(), claimed_by_user_id = $2, updated_at = now()
           where id = $1`,
          [demo.id, user.id],
        );
        if (demo.demo_request_id) {
          await client.query(
            `update demo_requests
             set status = case when status in ('received', 'ready', 'sent', 'opened') then 'claimed' else status end,
                 last_claimed_at = now(), updated_at = now()
             where id = $1`,
            [demo.demo_request_id],
          );
          claimedDemoAudit = {
            demoRequestId: String(demo.demo_request_id),
            sessionId: String(demo.id),
            businessId: String(demo.business_id),
            eventType: "claimed",
            actorType: "user",
            actorUserId: user.id,
            actorEmail: authUser.email,
          };
        }
      }
    }

    if (!organizationId) {
      const organizationName = options.organizationName || `${authUser.name}'s Businesses`;
      const organization = await client.query<{ id: string }>(
        `insert into organizations
           (name, slug, billing_mode, billing_status, plan_key, billing_interval, trial_start_at, trial_end_at)
         values ($1, $2, 'live', 'trial', 'starter', 'month', now(), $3)
         returning id`,
        [organizationName.slice(0, 160), `org-${randomUUID().replace(/-/g, "").slice(0, 24)}`, trialEndFromNow()],
      );
      organizationId = organization.rows[0].id;
      await client.query(
        `insert into organization_members (organization_id, user_id, role)
         values ($1, $2, 'owner')`,
        [organizationId, user.id],
      );
    }

    await client.query("commit");
    if (claimedDemoAudit) await recordDemoAudit(claimedDemoAudit);
    await queueLifecycleEvent({
      eventType: "USER_CREATED",
      eventKey: `user.created:${user.id}`,
      organizationId,
      recipientUserId: user.id,
      recipientEmail: authUser.email,
      payload: {
        first_name: authUser.name.split(/\s+/)[0] || authUser.name,
        business_name: "your business",
        dashboard_url: lifecycleAppUrl("/app"),
      },
    });
    return await authSnapshot(user.id, organizationId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function leadFromRow(row: Record<string, unknown>): Lead {
  const metadata = asRecord(row.metadata);
  return {
    id: String(row.id),
    conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null,
    name: typeof row.name === "string" ? row.name : null,
    email: typeof row.email === "string" ? row.email : null,
    phone: typeof row.phone === "string" ? row.phone : null,
    intent: typeof row.intent === "string" ? row.intent : null,
    status: row.status === "qualified" || row.status === "booked" ? row.status : "new",
    source: typeof row.source === "string" ? row.source : "widget",
    pageUrl: typeof row.page_url === "string" ? row.page_url : null,
    referrer: typeof row.referrer === "string" ? row.referrer : null,
    consentAt: row.consent_at ? toIso(row.consent_at) : null,
    idempotencyKey: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
    metadata,
    notes: typeof metadata.notes === "string" ? metadata.notes : undefined,
    createdAt: toIso(row.created_at),
  };
}

function actionSubmissionFromRow(row: Record<string, unknown>): ActionSubmission {
  const values = Object.fromEntries(
    Object.entries(asRecord(row.values))
      .filter(([, value]) => typeof value === "string")
      .slice(0, 100),
  ) as Record<string, string>;
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    actionId: String(row.action_id),
    conversationId: String(row.conversation_id),
    idempotencyKey: String(row.idempotency_key),
    values,
    sourcePage: typeof row.source_page === "string" ? row.source_page : null,
    status: row.status === "completed" || row.status === "failed" ? row.status : "received",
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function actionConnectorFromValue(value: unknown): ActionConnectorSettings | undefined {
  const source = asRecord(value);
  const provider = source.provider;
  if (provider !== "generic_webhook" && provider !== "email" && provider !== "hubspot"
      && provider !== "jackrabbit" && provider !== "square" && provider !== "mindbody" && provider !== "calendly") {
    return undefined;
  }
  const integrationId = optionalString(source.integrationId, 120);
  const recipients = Array.isArray(source.recipients)
    ? source.recipients.filter((item): item is string => typeof item === "string" && item.includes("@")).map((item) => item.trim().toLowerCase()).slice(0, 20)
    : undefined;
  const endpoint = optionalString(source.endpoint, 2_000);
  return {
    provider,
    ...(integrationId ? { integrationId } : {}),
    ...(recipients?.length ? { recipients } : {}),
    ...(endpoint ? { endpoint } : {}),
  };
}

function mcpProviderFromValue(value: unknown): McpProvider | undefined {
  return value === "hubspot" || value === "zapier" || value === "make" || value === "custom" ? value : undefined;
}

function mcpToolsFromValue(value: unknown): McpTool[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is McpTool => {
    const tool = asRecord(item);
    return typeof tool.name === "string" && Boolean(tool.name.trim());
  }).slice(0, 200) as McpTool[];
}

function mcpCredentials(token: string): string {
  return encryptSecret(JSON.stringify({ bearerToken: token }));
}

function mcpBearerToken(payload: string): string {
  const credentials = asRecord(JSON.parse(decryptSecret(payload)));
  const token = optionalString(credentials.bearerToken, 4_000);
  if (!token) throw new Error("MCP credentials are not configured");
  return token;
}

function actionFromRow(row: Record<string, unknown>): ActionFlow {
  const completion = asRecord(row.completion);
  const fields = Array.isArray(row.fields) ? row.fields as ActionFlow["fields"] : [];
  const persistedRequiredFields = Array.isArray(row.required_fields) ? row.required_fields.filter((item): item is string => typeof item === "string") : [];
  const persistedOptionalFields = Array.isArray(row.optional_fields) ? row.optional_fields.filter((item): item is string => typeof item === "string") : [];
  const connector = actionConnectorFromValue(completion.connector);
  const completionModes = new Set(["external_provider", "native_form", "booking_connector", "payment_link", "api_webhook", "human_follow_up"]);
  const linkTemplateSource = asRecord(completion.linkTemplate);
  const linkMappings = asRecord(linkTemplateSource.fieldMappings);
  const linkTemplate = typeof linkTemplateSource.baseUrl === "string"
    ? {
      baseUrl: linkTemplateSource.baseUrl,
      fieldMappings: Object.fromEntries(Object.entries(linkMappings).filter(([, value]) => typeof value === "string")) as Record<string, string>,
      ...(Object.keys(asRecord(linkTemplateSource.staticParams)).length ? { staticParams: Object.fromEntries(Object.entries(asRecord(linkTemplateSource.staticParams)).filter(([, value]) => typeof value === "string")) as Record<string, string> } : {}),
    }
    : undefined;
  const workflowSource = asRecord(completion.workflow);
  const workflowName = optionalString(workflowSource.name, 160);
  const workflowActionId = optionalString(workflowSource.actionId, 120);
  const workflow = workflowName && workflowActionId ? { name: workflowName, actionId: workflowActionId } : undefined;
  const actionKey = String(row.action_key);
  const storedName = String(row.name);
  const legacyDemoName = actionKey === "open_link" && storedName === "Send visitors to a link";
  const legacyDemoCopy = actionKey === "open_link" && (legacyDemoName || completion.linkLabel === "Open link");
  const action: ActionFlow = {
    id: String(row.id),
    key: actionKey,
    actionType: BUSINESS_ACTION_TYPES.includes(String(row.action_type) as BusinessActionType)
      ? String(row.action_type) as BusinessActionType
      : "contact_team",
    businessId: typeof row.business_id === "string" ? row.business_id : undefined,
    name: legacyDemoName ? "Try the demo" : storedName,
    description: String(row.description ?? ""),
    triggerPhrases: Array.isArray(row.trigger_phrases) ? row.trigger_phrases.filter((item): item is string => typeof item === "string") : [],
    triggerIntents: Array.isArray(row.trigger_intents) ? row.trigger_intents.filter((item): item is string => typeof item === "string") : [],
    captureMode: row.capture_mode === "conversational" || row.capture_mode === "form" || row.capture_mode === "hybrid" ? row.capture_mode : "auto",
    fields,
    ...(Array.isArray(row.steps) ? { steps: row.steps as ActionFlow["steps"] } : {}),
    completion: {
      createLead: completion.createLead !== false,
      leadStatus: completion.leadStatus === "qualified" || completion.leadStatus === "booked" ? completion.leadStatus : "new",
      message: legacyDemoCopy && completion.message === "The verified link is ready."
        ? "You can try the demo here."
        : typeof completion.message === "string" ? completion.message : "Thanks — the team has your request.",
      ...(workflow ? { workflow } : {}),
      ...(typeof completion.completionMode === "string" && completionModes.has(completion.completionMode) ? { completionMode: completion.completionMode as ActionFlow["completion"]["completionMode"] } : {}),
      ...(linkTemplate ? { linkTemplate } : {}),
      submitLabel: legacyDemoCopy ? "Try the demo" : typeof completion.submitLabel === "string" ? completion.submitLabel : undefined,
      linkUrl: typeof completion.linkUrl === "string" ? completion.linkUrl : undefined,
      linkLabel: legacyDemoCopy ? "Try the demo" : typeof completion.linkLabel === "string" ? completion.linkLabel : undefined,
      notifyStaff: completion.notifyStaff !== false,
      requiresStaff: completion.requiresStaff === true,
      notifyChannels: Array.isArray(completion.notifyChannels) ? completion.notifyChannels.filter((item): item is "in_app" | "email" => item === "in_app" || item === "email") : ["in_app", "email"],
      notifyTargets: Array.isArray(completion.notifyTargets) ? completion.notifyTargets.filter((item): item is "owner" | "business_team" | "assigned_staff" => item === "owner" || item === "business_team" || item === "assigned_staff") : ["business_team"],
      ...(connector ? { connector } : {}),
    },
    mode: "transactional",
    executionMode: ["DIRECT_LINK", "FORM_FLOW", "PROVIDER_FLOW", "PHONE", "EMAIL", "HANDOFF", "API_ACTION"].includes(String(row.execution_mode))
      ? String(row.execution_mode) as ActionExecutionMode
      : undefined,
    attachmentPolicy: ["always", "sales_intent", "high_intent_only", "explicit_request_only", "never_auto"].includes(String(row.attachment_policy))
      ? String(row.attachment_policy) as ActionAttachmentPolicy
      : undefined,
    trackingKey: typeof row.tracking_key === "string" && row.tracking_key.trim() ? row.tracking_key : String(row.action_key),
    destination: row.destination && typeof row.destination === "object" ? row.destination as ActionFlow["destination"] : null,
    provider: typeof row.provider === "string" && row.provider.trim()
      ? row.provider
      : String(row.action_key ?? "") === "enroll_child" && String(row.action_type ?? "") === "enroll" ? "jackrabbit" : null,
    priority: Number(row.priority ?? 500),
    requiredFields: persistedRequiredFields.length ? persistedRequiredFields : fields.filter((field) => field.required && field.visibility !== "hidden").map((field) => field.key),
    optionalFields: persistedOptionalFields.length ? persistedOptionalFields : fields.filter((field) => !field.required && field.visibility !== "hidden").map((field) => field.key),
    handoffBehavior: asRecord(row.handoff_behavior).mode === "require_staff" || asRecord(row.handoff_behavior).mode === "notify_staff"
      ? {
        mode: asRecord(row.handoff_behavior).mode as "require_staff" | "notify_staff",
        ...(typeof asRecord(row.handoff_behavior).reason === "string" ? { reason: asRecord(row.handoff_behavior).reason as string } : {}),
      }
      : { mode: completion.requiresStaff ? "require_staff" : completion.notifyStaff ? "notify_staff" : "none" },
    version: Number.isInteger(Number(row.version)) ? Number(row.version) : 1,
    conditions: Array.isArray(row.conditions) ? row.conditions.filter((item): item is NonNullable<ActionFlow["conditions"]>[number] => Boolean(item && typeof item === "object")) as ActionFlow["conditions"] : [],
    safetyPolicy: row.safety_policy === "verified_contact" || row.safety_policy === "healthcare_emergency" || row.safety_policy === "manual_review" ? row.safety_policy : "standard",
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    sourceType: row.source_type === "website" || row.source_type === "manual" || row.source_type === "document" || row.source_type === "integration" || row.source_type === "system" ? row.source_type as ActionSourceType : null,
    sourceLabel: typeof row.source_label === "string" ? row.source_label : null,
    classificationReason: typeof row.classification_reason === "string" ? row.classification_reason : null,
    discoveredAt: row.discovered_at ? toIso(row.discovered_at) : null,
    origin: row.origin === "discovered" ? "discovered" as ActionOrigin : "configured" as ActionOrigin,
    lifecycleStatus: ["discovered", "needs_review", "approved", "active", "disabled"].includes(String(row.lifecycle_status)) ? String(row.lifecycle_status) as ActionLifecycleStatus : (row.enabled === false ? "disabled" : "active"),
    reviewReason: ["low_confidence", "unsafe_destination", "duplicate_action", "owner_override", "source_removed"].includes(String(row.review_reason)) ? String(row.review_reason) as ActionReviewReason : null,
    evidence: Array.isArray(row.evidence) ? row.evidence.filter((item): item is NonNullable<ActionFlow["evidence"]>[number] => Boolean(item && typeof item === "object")) as ActionFlow["evidence"] : [],
    confidence: Number(row.confidence ?? 0.5),
    enabled: row.enabled !== false,
    createdAt: row.created_at ? toIso(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? toIso(row.updated_at) : new Date().toISOString(),
  };
  const normalizedAction = normalizeCanonicalEnrollmentWorkflow(action);
  return { ...normalizedAction, readiness: actionReadiness(normalizedAction) };
}

function actionResourceFromRow(row: Record<string, unknown>): ActionResource {
  const type = (ACTION_RESOURCE_TYPES as readonly string[]).includes(String(row.resource_type))
    ? String(row.resource_type) as ActionResourceType
    : "custom";
  const resourceProviders = ["manual", "jackrabbit", "square", "mindbody", "calendly", "greenhouse", "lever", "hubspot", "custom"] as const;
  const rowProvider = typeof row.provider === "string" && resourceProviders.includes(row.provider as typeof resourceProviders[number])
    ? row.provider as typeof resourceProviders[number]
    : "manual";
  const input: ActionResourceInput = {
    id: String(row.id),
    businessId: String(row.business_id),
    type,
    name: String(row.name ?? "Action resource"),
    provider: rowProvider,
    providerObjectId: typeof row.provider_object_id === "string" ? row.provider_object_id : null,
    location: typeof row.location === "string" ? row.location : null,
    program: typeof row.program === "string" ? row.program : null,
    day: typeof row.day === "string" ? row.day : null,
    startTime: typeof row.start_time === "string" ? row.start_time : null,
    endTime: typeof row.end_time === "string" ? row.end_time : null,
    role: typeof row.role === "string" ? row.role : null,
    department: typeof row.department === "string" ? row.department : null,
    service: typeof row.service === "string" ? row.service : null,
    price: typeof row.price === "string" || typeof row.price === "number" ? row.price : null,
    availability: row.availability === null || row.availability === undefined ? null : Number(row.availability),
    metadata: asRecord(row.metadata),
    conditions: Array.isArray(row.conditions) ? row.conditions as ActionResource["conditions"] : [],
    destination: row.destination && typeof row.destination === "object" ? row.destination as ActionResource["destination"] : null,
    status: typeof row.status === "string" ? row.status.toUpperCase() as ActionResourceStatus : "ACTIVE",
    validFrom: row.valid_from ? toIso(row.valid_from) : null,
    validUntil: row.valid_until ? toIso(row.valid_until) : null,
    source: typeof row.source === "string" ? row.source : "manual",
    lastSyncedAt: row.last_synced_at ? toIso(row.last_synced_at) : null,
    version: Number(row.version ?? 1),
    createdAt: row.created_at ? toIso(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? toIso(row.updated_at) : new Date().toISOString(),
  };
  return normalizeActionResource(input);
}

function businessFactFromRow(row: Record<string, unknown>): BusinessFact {
  const kind = (BUSINESS_FACT_KINDS as readonly string[]).includes(String(row.kind))
    ? String(row.kind) as BusinessFactKind
    : "custom";
  const sourceType = (BUSINESS_FACT_SOURCE_TYPES as readonly string[]).includes(String(row.source_type))
    ? String(row.source_type) as BusinessFactSourceType
    : "inferred";
  return normalizeBusinessFact({
    id: String(row.id),
    businessId: String(row.business_id),
    kind,
    subject: String(row.subject ?? "Business"),
    predicate: String(row.predicate ?? "fact"),
    value: row.value === undefined ? null : row.value as BusinessFactInput["value"],
    valueText: typeof row.value_text === "string" ? row.value_text : undefined,
    sourceType,
    authority: typeof row.authority === "string" ? row.authority as BusinessFactAuthority : undefined,
    sourceId: typeof row.source_id === "string" ? row.source_id : null,
    sourceLabel: typeof row.source_label === "string" ? row.source_label : null,
    confidence: row.confidence === null || row.confidence === undefined ? 1 : Number(row.confidence),
    freshnessPolicy: typeof row.freshness_policy === "string" ? row.freshness_policy as BusinessFactInput["freshnessPolicy"] : undefined,
    observedAt: row.observed_at ? toIso(row.observed_at) : new Date().toISOString(),
    expiresAt: row.expires_at ? toIso(row.expires_at) : null,
    active: row.active !== false,
    version: Number(row.version ?? 1),
    createdAt: row.created_at ? toIso(row.created_at) : new Date().toISOString(),
    updatedAt: row.updated_at ? toIso(row.updated_at) : new Date().toISOString(),
  });
}

function crmLeadPayload(business: Business, lead: Lead, eventId: string): CrmLeadPayload {
  return {
    eventId,
    eventType: "lead.created",
    tenant: { id: business.id, slug: business.slug, name: business.name },
    conversationId: lead.conversationId,
    lead: {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      intent: lead.intent,
      status: lead.status,
      source: lead.source,
      pageUrl: lead.pageUrl,
      referrer: lead.referrer,
      consentAt: lead.consentAt,
      createdAt: lead.createdAt,
      metadata: lead.metadata,
    },
  };
}

function leadInput(body: Record<string, unknown>, source: string, request?: FastifyRequest): Lead {
  const email = optionalString(body.email, 240);
  const phone = optionalString(body.phone, 80);
  if (!email && !phone) throw httpError(400, "email or phone is required");
  const conversationId = optionalString(body.conversationId, 120);
  const explicitIdempotencyKey = optionalString(body.idempotencyKey, 240)
    ?? (typeof request?.headers["idempotency-key"] === "string" ? optionalString(request.headers["idempotency-key"], 240) : null);
  const dedupeMaterial = conversationId && (email || phone)
    ? `${source}|${conversationId}|${email?.toLowerCase() ?? ""}|${phone ?? ""}`
    : null;
  return {
    id: randomUUID(),
    conversationId,
    name: optionalString(body.name, 160),
    email,
    phone,
    intent: optionalString(body.intent, 240),
    status: "new",
    source: source === "widget" ? "widget" : (optionalString(body.source, 60) ?? source),
    pageUrl: optionalString(body.pageUrl, 2_000),
    referrer: optionalString(body.referrer, 2_000),
    consentAt: safeConsentAt(body.consentAt),
    idempotencyKey: explicitIdempotencyKey ?? (dedupeMaterial ? `lead:${contentHash(dedupeMaterial)}` : null),
    metadata: safeLeadMetadata(body.metadata, body),
    createdAt: new Date().toISOString(),
  };
}

function slugify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 56) || "business-demo";
}

function businessNameFromTitle(title: string, websiteUrl: string): string {
  const candidate = title.split(/\s+[|–—-]\s+/)[0].trim();
  if (candidate && !/^home|welcome|index$/i.test(candidate)) return candidate.slice(0, 120);
  return new URL(websiteUrl).hostname.replace(/^www\./, "").split(".")[0].replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function makeBusiness(input: {
  name: string;
  slug: string;
  websiteUrl: string;
  pages: CrawledPage[];
  location?: string;
}): Business {
  const now = new Date().toISOString();
  const sources: Source[] = input.pages.map((page) => ({
    id: randomUUID(),
    url: page.url,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    contentType: "web_page",
    pageType: page.pageType,
    crawlStatus: "ready",
    contentHash: page.contentHash,
    lastCrawledAt: page.lastCrawledAt,
    httpStatus: page.httpStatus ?? null,
    rawHtmlBytes: page.rawHtmlBytes ?? null,
    extractedCharacterCount: page.extractedCharacterCount ?? null,
    discoveredLinkCount: page.discoveredLinkCount ?? null,
    crawlMode: page.crawlMode ?? "static",
    renderAttempted: page.renderAttempted ?? false,
    renderSuccess: page.renderSuccess ?? false,
    renderDurationMs: page.renderDurationMs ?? null,
    renderDiagnostics: page.renderDiagnostics ? { ...page.renderDiagnostics } : null,
    crawlDepth: page.crawlDepth ?? null,
    discoveryParentUrl: page.discoveryParentUrl ?? null,
  }));
  const chunks: KnowledgeChunk[] = input.pages.flatMap((page, index) => page.chunks.map((chunk) => ({
    id: randomUUID(),
    sourceId: sources[index].id,
    content: chunk.content,
    contentHash: chunk.contentHash,
    metadata: chunk.metadata,
  })));
  const websiteContent = chunks.map((chunk) => chunk.content).join(" ");
  const websiteActions = input.pages.flatMap((page) => page.actionCandidates ?? []);

  return {
    id: randomUUID(),
    name: input.name,
    slug: input.slug,
    vertical: "local_business",
    websiteUrl: input.websiteUrl,
    location: input.location ?? "Demo workspace",
    ownershipStatus: "pending",
    ownershipVerificationMethod: null,
    ownershipVerificationTokenHash: null,
    ownershipVerificationExpiresAt: null,
    ownershipVerifiedAt: null,
    ownershipVerifiedByUserId: null,
    agentPublishedAt: null,
    primaryActionId: null,
    sources,
    chunks,
    facts: [],
    actions: defaultActionFlows(input.name, websiteContent, (key) => randomUUID(), websiteActions),
    actionSubmissions: [],
    actionResources: [],
    conversations: new Map(),
    conversationEvents: [],
    conversionEvents: [],
    notifications: [],
    internalNotes: [],
    leads: [],
    knowledgeGaps: new Map(),
    agentConfig: defaultConfig(input.name),
    publishedAgentConfig: null,
    publishedAgentConfigHash: null,
    billing: {
      mode: "sandbox",
      isDemo: true,
      status: "trial",
      planKey: "demo",
      interval: null,
      trialEndsAt: null,
      currentPeriodEndsAt: null,
      graceEndsAt: null,
      provider: null,
      providerCustomerId: null,
      providerSubscriptionId: null,
    },
    widget: {
      siteKey: `fdw_${randomBytes(18).toString("hex")}`,
      enabled: true,
      lastLoadedAt: null,
      loadCount: 0,
    },
    createdAt: now,
  };
}

function websiteSourcesFromPages(pages: CrawledPage[]): { sources: Source[]; chunks: KnowledgeChunk[] } {
  const sources: Source[] = pages.map((page) => ({
    id: randomUUID(),
    url: page.url,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    contentType: "web_page",
    pageType: page.pageType,
    crawlStatus: "ready",
    contentHash: page.contentHash,
    lastCrawledAt: page.lastCrawledAt,
    httpStatus: page.httpStatus ?? null,
    rawHtmlBytes: page.rawHtmlBytes ?? null,
    extractedCharacterCount: page.extractedCharacterCount ?? null,
    discoveredLinkCount: page.discoveredLinkCount ?? null,
    crawlMode: page.crawlMode ?? "static",
    renderAttempted: page.renderAttempted ?? false,
    renderSuccess: page.renderSuccess ?? false,
    renderDurationMs: page.renderDurationMs ?? null,
    renderDiagnostics: page.renderDiagnostics ? { ...page.renderDiagnostics } : null,
    crawlDepth: page.crawlDepth ?? null,
    discoveryParentUrl: page.discoveryParentUrl ?? null,
    errorMessage: null,
  }));
  const chunks = pages.flatMap((page, index) => page.chunks.map((chunk) => ({
    id: randomUUID(),
    sourceId: sources[index].id,
    content: chunk.content,
    contentHash: chunk.contentHash,
    metadata: chunk.metadata,
  })));
  return { sources, chunks };
}

async function replaceWebsiteSources(business: Business, pages: CrawledPage[]): Promise<void> {
  const previousWebsiteSourceIds = new Set(
    business.sources.filter((source) => source.contentType === "web_page").map((source) => source.id),
  );
  const website = websiteSourcesFromPages(pages);
  business.sources = business.sources.filter((source) => source.contentType !== "web_page").concat(website.sources);
  business.chunks = business.chunks.filter((chunk) => !previousWebsiteSourceIds.has(chunk.sourceId)).concat(website.chunks);
  const websiteContent = business.chunks.filter((chunk) => chunk.metadata.sourceType !== "knowledge_answer").map((chunk) => chunk.content).join(" ");
  const extractedActions = defaultActionFlows(
    business.name,
    websiteContent,
    (key) => randomUUID(),
    pages.flatMap((page) => page.actionCandidates ?? []),
  ).filter((action) => action.sourceUrl);
  const extractedKeys = new Set(extractedActions.map((action) => action.key));
  for (const extracted of extractedActions) {
    const existing = business.actions.find((action) => action.key === extracted.key);
    if (existing) {
      // A configured action is owner intent. Website recrawls may not mutate it
      // or silently replace its primary-action meaning.
      if (existing.origin === "configured") continue;
      Object.assign(existing, {
        actionType: extracted.actionType,
        destination: extracted.destination,
        provider: extracted.provider,
        priority: extracted.priority,
        requiredFields: extracted.requiredFields,
        conditions: extracted.conditions,
        safetyPolicy: extracted.safetyPolicy,
        sourceUrl: extracted.sourceUrl,
        evidence: extracted.evidence,
        confidence: extracted.confidence,
        sourceType: extracted.sourceType,
        sourceLabel: extracted.sourceLabel,
        classificationReason: extracted.classificationReason,
        discoveredAt: extracted.discoveredAt,
        origin: "discovered" as const,
        lifecycleStatus: existing.lifecycleStatus ?? "needs_review",
        reviewReason: existing.reviewReason === "source_removed" ? extracted.reviewReason : existing.reviewReason,
        // Owner-disabled or previously reviewed actions stay disabled; a
        // recrawl never promotes a candidate into runtime by itself.
        enabled: existing.enabled && extracted.enabled,
        updatedAt: new Date().toISOString(),
      });
      await persistAction(business, existing);
    } else {
      business.actions.push(extracted);
      await persistAction(business, extracted);
      await recordActionRegistryAudit({
        businessId: business.id,
        actionId: extracted.id,
        actorType: "system",
        eventType: "created",
        newValue: {
          origin: extracted.origin,
          lifecycleStatus: extracted.lifecycleStatus,
          sourceUrl: extracted.sourceUrl,
          sourceType: extracted.sourceType,
          sourceLabel: extracted.sourceLabel,
          discoveredAt: extracted.discoveredAt,
          confidence: extracted.confidence,
        },
        reason: extracted.reviewReason,
      });
    }
  }
  for (const existing of business.actions.filter((action) => action.origin === "discovered" && !extractedKeys.has(action.key))) {
    const wasEnabled = existing.enabled;
    const wasLifecycleStatus = existing.lifecycleStatus;
    const wasPrimary = business.primaryActionId === existing.id;
    Object.assign(existing, {
      enabled: false,
      lifecycleStatus: "disabled" as const,
      reviewReason: "source_removed" as const,
      updatedAt: new Date().toISOString(),
    });
    if (wasPrimary) {
      business.primaryActionId = null;
      if (pool) await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2", [business.id, existing.id]);
      await recordActionRegistryAudit({
        businessId: business.id,
        actionId: existing.id,
        actorType: "system",
        eventType: "primary_cleared",
        previousValue: { primaryActionId: existing.id },
        newValue: { primaryActionId: null },
        reason: "source_removed",
      });
    }
    await persistAction(business, existing);
    await recordActionRegistryAudit({
      businessId: business.id,
      actionId: existing.id,
      actorType: "system",
      eventType: "source_removed",
      previousValue: { enabled: wasEnabled, lifecycleStatus: wasLifecycleStatus },
      newValue: { enabled: false, lifecycleStatus: "disabled", reviewReason: "source_removed" },
      reason: "source_removed",
    });
  }
  if (!pool) return;
  await pool.query(
    `delete from knowledge_chunks
     where business_id = $1
       and source_id in (select id from business_sources where business_id = $1 and content_type = 'web_page')`,
    [business.id],
  );
  await pool.query("delete from business_sources where business_id = $1 and content_type = 'web_page'", [business.id]);
  await persistBusiness(business);
}

function seedDefaultBusiness(): Business {
  const text = [
    "British Swim School Tampa Bay offers swim lessons for babies, toddlers, children, teens, and adults.",
    "Families can choose programs by age and swimming ability, including water safety, beginner lessons, and swim assessments.",
    "Visit the Tampa Bay locations page to find classes, schedules, and current enrollment availability.",
    "Parents can request information or start enrollment through the website. A team member can help match each swimmer to the right program.",
  ].join(" ");
  const now = new Date().toISOString();
  const page = {
    url: "https://britishswimschool.com/tampa-bay/",
    canonicalUrl: "https://britishswimschool.com/tampa-bay/",
    title: "British Swim School Tampa Bay",
    contentHash: contentHash(text),
    pageType: "service",
    lastCrawledAt: now,
    chunks: [{
      content: text,
      contentHash: contentHash(text),
      metadata: { headingPath: [], pageType: "service", tokenCount: text.split(/\s+/).length, overlapTokens: 0 },
    }],
  } satisfies CrawledPage;
  const business = makeBusiness({
    name: "British Swim School",
    slug: "british-swim-school-tampa-bay",
    websiteUrl: "https://britishswimschool.com/tampa-bay/",
    pages: [page],
    location: "Tampa Bay",
  });
  businesses.set(business.slug, business);
  return business;
}

function seedInternalBusiness(input: {
  name: string;
  slug: string;
  websiteUrl: string;
  location: string;
  content: string;
}): Business {
  const now = new Date().toISOString();
  const page = {
    url: input.websiteUrl,
    canonicalUrl: input.websiteUrl,
    title: input.name,
    contentHash: contentHash(input.content),
    pageType: "service",
    lastCrawledAt: now,
    chunks: [{
      content: input.content,
      contentHash: contentHash(input.content),
      metadata: { headingPath: [], pageType: "service", tokenCount: input.content.split(/\s+/).length, overlapTokens: 0 },
    }],
  } satisfies CrawledPage;
  const business = makeBusiness({
    name: input.name,
    slug: input.slug,
    websiteUrl: input.websiteUrl,
    pages: [page],
    location: input.location,
  });
  business.ownershipStatus = "verified";
  business.ownershipVerificationMethod = "manual";
  business.ownershipVerifiedAt = now;
  businesses.set(business.slug, business);
  return business;
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}

async function enqueueEmbeddingJob(business: Business): Promise<string | null> {
  if (!pool || !embeddingsConfigured()) return null;
  const active = await pool.query<{ id: string }>(
    `select id
     from embedding_jobs
     where business_id = $1 and status in ('queued', 'running')
     order by created_at desc
     limit 1`,
    [business.id],
  );
  if (active.rowCount) return active.rows[0].id;

  const total = await pool.query<{ count: string }>(
    `select count(*)::text as count
     from knowledge_chunks
     where business_id = $1
       and (embedding is null or embedding_model is distinct from $2 or embedding_dimensions is distinct from $3)`,
    [business.id, embeddingModel(), embeddingDimensions()],
  );
  if (Number(total.rows[0].count) === 0) return null;

  try {
    const created = await pool.query<{ id: string }>(
      `insert into embedding_jobs (business_id, status, model, total_chunks)
       values ($1, 'queued', $2, $3)
       returning id`,
      [business.id, embeddingModel(), Number(total.rows[0].count)],
    );
    return created.rows[0].id;
  } catch (error) {
    if ((error as { code?: string }).code !== "23505") throw error;
    const concurrent = await pool.query<{ id: string }>(
      `select id from embedding_jobs where business_id = $1 and status in ('queued', 'running') order by created_at desc limit 1`,
      [business.id],
    );
    return concurrent.rows[0]?.id ?? null;
  }
}

async function markEmbeddingJobRetry(jobId: string, error: unknown): Promise<number | null> {
  if (!pool) return null;
  const current = await pool.query<{ attempts: number; max_attempts: number }>(
    "select attempts, max_attempts from embedding_jobs where id = $1",
    [jobId],
  );
  if (!current.rowCount) return null;
  const attempts = Number(current.rows[0].attempts);
  const maxAttempts = Number(current.rows[0].max_attempts);
  const message = error instanceof Error ? error.message.slice(0, 1_000) : "Embedding job failed";
  if (attempts >= maxAttempts) {
    await pool.query(
      `update embedding_jobs set status = 'failed', last_error = $2, updated_at = now() where id = $1`,
      [jobId, message],
    );
    return null;
  }
  const delaySeconds = Math.min(300, 2 ** attempts * 10);
  await pool.query(
    `update embedding_jobs
     set status = 'queued', next_attempt_at = now() + ($2 * interval '1 second'), last_error = $3, updated_at = now()
     where id = $1`,
    [jobId, delaySeconds, message],
  );
  return delaySeconds;
}

async function processEmbeddingJob(business: Business, jobId: string): Promise<void> {
  if (!pool || !embeddingsConfigured()) return;
  const claim = await pool.query<{ attempts: number }>(
    `update embedding_jobs
     set status = 'running', attempts = attempts + 1, started_at = coalesce(started_at, now()), updated_at = now()
     where id = $1 and status = 'queued' and next_attempt_at <= now()
     returning attempts`,
    [jobId],
  );
  if (!claim.rowCount) return;
  recordEmbeddingJobAttempt();

  try {
    const pending = await pool.query<{ id: string; content: string }>(
      `select id, content
       from knowledge_chunks
       where business_id = $1
         and (embedding is null or embedding_model is distinct from $2 or embedding_dimensions is distinct from $3)
       order by created_at`,
      [business.id, embeddingModel(), embeddingDimensions()],
    );
    let processed = 0;
    for (let index = 0; index < pending.rows.length; index += 64) {
      const batch = pending.rows.slice(index, index + 64);
      const vectors = await embedTexts(batch.map((item) => item.content));
      if (!vectors) throw new Error("Embedding provider is not configured");
      const client = await pool.connect();
      try {
        await client.query("begin");
        for (let vectorIndex = 0; vectorIndex < batch.length; vectorIndex += 1) {
          await client.query(
            `update knowledge_chunks
             set embedding = $1::vector, embedding_model = $2, embedding_dimensions = $3, embedding_created_at = now()
             where id = $4 and business_id = $5`,
            [vectorLiteral(vectors[vectorIndex]), embeddingModel(), embeddingDimensions(), batch[vectorIndex].id, business.id],
          );
        }
        await client.query("commit");
      } catch (error) {
        await client.query("rollback");
        throw error;
      } finally {
        client.release();
      }
      processed += batch.length;
      await pool.query("update embedding_jobs set embedded_chunks = $2, updated_at = now() where id = $1", [jobId, processed]);
    }
    await pool.query(
      `update embedding_jobs
       set status = 'succeeded', embedded_chunks = total_chunks, completed_at = now(), last_error = null, updated_at = now()
       where id = $1`,
      [jobId],
    );
    // An owner can edit a FAQ while a website/document job is already
    // running. Re-check after this job so the newly changed chunk is never
    // left outside the searchable index just because it missed the worker's
    // initial pending-chunk snapshot.
    const followUpJobId = await enqueueEmbeddingJob(business);
    if (followUpJobId) void processEmbeddingJob(business, followUpJobId);
  } catch (error) {
    recordEmbeddingJobFailure();
    const retryDelaySeconds = await markEmbeddingJobRetry(jobId, error);
    if (retryDelaySeconds !== null) {
      setTimeout(() => void processEmbeddingJob(business, jobId), retryDelaySeconds * 1_000);
    }
    app.log.warn({ error: error instanceof Error ? error.message : "unknown embedding error", businessId: business.id, jobId }, "Embedding job attempt failed");
  }
}

async function enqueueAndRunEmbeddingJob(business: Business): Promise<"queued" | "ready"> {
  const jobId = await enqueueEmbeddingJob(business);
  if (jobId) void processEmbeddingJob(business, jobId);
  return jobId ? "queued" : "ready";
}

async function processOrganizationDocument(documentId: string): Promise<void> {
  if (!pool) return;
  const documentResult = await pool.query<Record<string, unknown>>(
    `select id, organization_id, business_id, object_key, original_file_name, content_type, metadata
     from organization_documents
     where id = $1 and status = 'uploaded'`,
    [documentId],
  );
  if (!documentResult.rowCount) return;
  const document = documentResult.rows[0];
  const businessId = typeof document.business_id === "string" ? document.business_id : null;
  if (!businessId) {
    await pool.query(
      `update organization_documents
       set status = 'failed', metadata = metadata || $2::jsonb, updated_at = now()
       where id = $1`,
      [documentId, JSON.stringify({ error: "Select a business before processing organization knowledge." })],
    );
    return;
  }

  await pool.query(
    `update organization_documents
     set status = 'processing', metadata = metadata || $2::jsonb, updated_at = now()
     where id = $1 and status = 'uploaded'`,
    [documentId, JSON.stringify({ error: null })],
  );

  try {
    const buffer = await readDocumentObject(String(document.object_key));
    const extracted = await extractDocumentText(buffer, String(document.content_type), String(document.original_file_name));
    const chunks = chunkDocumentText(extracted.text);
    if (!chunks.length) throw new Error("No readable text was found in this document");
    const sourceId = randomUUID();
    const sourceHash = contentHash(extracted.text);
    const sourceResult = await pool.query<{ id: string }>(
      `insert into business_sources
         (id, business_id, source_url, canonical_url, title, content_type, page_type, crawl_status, content_hash, last_crawled_at)
       values ($1, $2, $3, $3, $4, $5, 'document', 'ready', $6, now())
       on conflict (business_id, content_hash) do update set
         source_url = excluded.source_url,
         canonical_url = excluded.canonical_url,
         title = excluded.title,
         content_type = excluded.content_type,
         page_type = excluded.page_type,
         crawl_status = excluded.crawl_status,
         last_crawled_at = excluded.last_crawled_at,
         error_message = null
       returning id`,
      [sourceId, businessId, `document:${documentId}`, String(document.original_file_name), String(document.content_type), sourceHash],
    );
    const resolvedSourceId = sourceResult.rows[0].id;
    for (const [index, chunk] of chunks.entries()) {
      await pool.query(
        `insert into knowledge_chunks (id, business_id, source_id, content, content_hash, metadata)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (business_id, content_hash) do update set
           source_id = excluded.source_id,
           content = excluded.content,
           metadata = excluded.metadata`,
        [
          randomUUID(),
          businessId,
          resolvedSourceId,
          chunk,
          contentHash(chunk),
          JSON.stringify({ sourceType: "uploaded_document", documentId, fileName: document.original_file_name, parser: extracted.parser, chunkIndex: index, pageCount: extracted.pageCount }),
        ],
      );
    }
    await pool.query(
      `update organization_documents
       set status = 'ready', metadata = metadata || $2::jsonb, updated_at = now()
       where id = $1`,
      [documentId, JSON.stringify({ error: null, parser: extracted.parser, pageCount: extracted.pageCount, characterCount: extracted.text.length, chunkCount: chunks.length })],
    );
    const businessResult = await pool.query<{ slug: string }>("select slug from businesses where id = $1", [businessId]);
    if (businessResult.rowCount) {
      const business = await getBusiness(businessResult.rows[0].slug);
      await enqueueAndRunEmbeddingJob(business);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1_000) : "Document processing failed";
    await pool.query(
      `update organization_documents
       set status = 'failed', metadata = metadata || $2::jsonb, updated_at = now()
       where id = $1`,
      [documentId, JSON.stringify({ error: message })],
    );
    app.log.warn({ documentId, error: message }, "Organization document processing failed");
  }
}

async function persistBusiness(business: Business, organizationIdOverride?: string): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const isInternalDemo = isInternalDemoSlug(business.slug);
    let organizationId = organizationIdOverride;
    if (organizationId) {
      const organization = await client.query<{ id: string }>("select id from organizations where id = $1", [organizationId]);
      if (!organization.rowCount) throw httpError(404, "Organization not found");
    } else {
      const organizationSlug = isInternalDemo
        ? "frontdeskwise-demo"
        : `business-${contentHash(business.slug).slice(0, 20)}`;
      const organizationResult = await client.query<{ id: string }>(
        `insert into organizations (name, slug)
         values ($1, $2)
         on conflict (slug) do update set name = excluded.name, updated_at = now()
         returning id`,
        [isInternalDemo ? "FrontDeskWise Demo" : `${business.name} Organization`, organizationSlug],
      );
      organizationId = organizationResult.rows[0].id;
    }
    const businessResult = await client.query<{ id: string }>(
      `insert into businesses (id, name, slug, vertical, website_url, website_url_key, timezone, location,
                              organization_id, billing_mode, is_demo, is_internal_demo, billing_status, plan_key, billing_interval,
                              ownership_status, ownership_verification_method, ownership_verification_token_hash,
                              ownership_verification_expires_at, ownership_verified_at, ownership_verified_by_user_id,
                              trial_ends_at, current_period_ends_at, grace_ends_at, billing_provider,
                              provider_customer_id, provider_subscription_id, public_site_key,
                              widget_enabled, widget_last_loaded_at, widget_load_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31)
       on conflict (slug) do update set
         name = excluded.name,
         vertical = excluded.vertical,
         website_url = excluded.website_url,
         website_url_key = excluded.website_url_key,
         location = excluded.location,
         organization_id = coalesce(businesses.organization_id, excluded.organization_id),
         billing_mode = excluded.billing_mode,
         is_demo = excluded.is_demo,
         is_internal_demo = businesses.is_internal_demo or excluded.is_internal_demo,
         billing_status = excluded.billing_status,
         plan_key = excluded.plan_key,
         billing_interval = excluded.billing_interval,
         ownership_status = case when businesses.ownership_status = 'verified' then businesses.ownership_status else excluded.ownership_status end,
         ownership_verification_method = case when businesses.ownership_status = 'verified' then businesses.ownership_verification_method else excluded.ownership_verification_method end,
         ownership_verification_token_hash = case when businesses.ownership_status = 'verified' then businesses.ownership_verification_token_hash else excluded.ownership_verification_token_hash end,
         ownership_verification_expires_at = case when businesses.ownership_status = 'verified' then businesses.ownership_verification_expires_at else excluded.ownership_verification_expires_at end,
         ownership_verified_at = coalesce(businesses.ownership_verified_at, excluded.ownership_verified_at),
         ownership_verified_by_user_id = coalesce(businesses.ownership_verified_by_user_id, excluded.ownership_verified_by_user_id),
         trial_ends_at = excluded.trial_ends_at,
         current_period_ends_at = excluded.current_period_ends_at,
         grace_ends_at = excluded.grace_ends_at,
         billing_provider = excluded.billing_provider,
         provider_customer_id = excluded.provider_customer_id,
         provider_subscription_id = excluded.provider_subscription_id,
         widget_enabled = excluded.widget_enabled,
         widget_last_loaded_at = excluded.widget_last_loaded_at,
         widget_load_count = excluded.widget_load_count,
         updated_at = now()
       returning id`,
      [
        business.id,
        business.name,
        business.slug,
        business.vertical,
        business.websiteUrl,
        websiteIdentityKey(business.websiteUrl),
        "America/New_York",
        business.location,
        organizationId,
        business.billing.mode,
        business.billing.isDemo,
        isInternalDemo,
        business.billing.status,
        business.billing.planKey,
        business.billing.interval,
        isInternalDemo ? "verified" : business.ownershipStatus,
        business.ownershipVerificationMethod,
        business.ownershipVerificationTokenHash,
        business.ownershipVerificationExpiresAt,
        business.ownershipVerifiedAt,
        business.ownershipVerifiedByUserId,
        business.billing.trialEndsAt,
        business.billing.currentPeriodEndsAt,
        business.billing.graceEndsAt,
        business.billing.provider,
        business.billing.providerCustomerId,
        business.billing.providerSubscriptionId,
        business.widget.siteKey,
        business.widget.enabled,
        business.widget.lastLoadedAt,
        business.widget.loadCount,
      ],
    );
    business.id = businessResult.rows[0].id;
    await client.query("update businesses set primary_action_id = $2, updated_at = now() where id = $1", [business.id, business.primaryActionId]);

    if (isInternalDemo) {
      const demoUser = await client.query<{ id: string }>(
        `insert into app_users (email, email_normalized, name, status)
         values ('demo@frontdeskwise.com', 'demo@frontdeskwise.com', 'FrontDeskWise Demo Owner', 'active')
         on conflict (email_normalized) do update set name = excluded.name, status = 'active', updated_at = now()
         returning id`,
      );
      await client.query(
        `insert into organization_members (organization_id, user_id, role)
         values ($1, $2, 'owner')
         on conflict (organization_id, user_id) do update set role = 'owner', updated_at = now()`,
        [organizationId, demoUser.rows[0].id],
      );
      await client.query(
        `insert into business_members (business_id, user_id, role)
         values ($1, $2, 'admin')
         on conflict (business_id, user_id) do update set role = 'admin', updated_at = now()`,
        [business.id, demoUser.rows[0].id],
      );
    }

    for (const source of business.sources) {
      const originalSourceId = source.id;
      const sourceResult = await client.query<{ id: string }>(
        `insert into business_sources
           (id, business_id, source_url, canonical_url, title, content_type, page_type, crawl_status, content_hash, last_crawled_at,
            http_status, raw_html_bytes, extracted_character_count, discovered_link_count, crawl_mode, render_attempted,
            render_success, render_duration_ms, render_diagnostics, crawl_depth, discovery_parent_url, error_message)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
         on conflict (business_id, content_hash) do update set
           source_url = excluded.source_url,
           canonical_url = excluded.canonical_url,
           title = excluded.title,
           page_type = excluded.page_type,
           crawl_status = excluded.crawl_status,
           last_crawled_at = excluded.last_crawled_at,
           http_status = excluded.http_status,
           raw_html_bytes = excluded.raw_html_bytes,
           extracted_character_count = excluded.extracted_character_count,
           discovered_link_count = excluded.discovered_link_count,
           crawl_mode = excluded.crawl_mode,
           render_attempted = excluded.render_attempted,
           render_success = excluded.render_success,
           render_duration_ms = excluded.render_duration_ms,
           render_diagnostics = excluded.render_diagnostics,
           crawl_depth = excluded.crawl_depth,
           discovery_parent_url = excluded.discovery_parent_url,
           error_message = excluded.error_message
         returning id`,
        [
          source.id,
          business.id,
          source.url,
          source.canonicalUrl,
          source.title,
          source.contentType,
          source.pageType,
          source.crawlStatus,
          source.contentHash,
          source.lastCrawledAt,
          source.httpStatus ?? null,
          source.rawHtmlBytes ?? null,
          source.extractedCharacterCount ?? null,
          source.discoveredLinkCount ?? null,
          source.crawlMode ?? "static",
          source.renderAttempted ?? false,
          source.renderSuccess ?? false,
          source.renderDurationMs ?? null,
          source.renderDiagnostics ? JSON.stringify(source.renderDiagnostics) : null,
          source.crawlDepth ?? null,
          source.discoveryParentUrl ?? null,
          source.errorMessage ?? null,
        ],
      );
      source.id = sourceResult.rows[0].id;
      for (const chunk of business.chunks.filter((item) => item.sourceId === originalSourceId)) {
        chunk.sourceId = source.id;
        await client.query(
          `insert into knowledge_chunks (id, business_id, source_id, content, content_hash, metadata)
           values ($1, $2, $3, $4, $5, $6)
           on conflict (business_id, content_hash) do update set
             source_id = excluded.source_id,
             content = excluded.content,
             metadata = excluded.metadata`,
          [chunk.id, business.id, chunk.sourceId, chunk.content, chunk.contentHash, chunk.metadata],
        );
      }
    }

    for (const action of business.actions) {
      await client.query(
        `insert into business_actions
           (id, business_id, action_key, action_type, name, description, trigger_phrases, trigger_intents, capture_mode, fields, steps, completion, mode, execution_mode, attachment_policy, tracking_key, destination, provider, priority, required_fields, optional_fields, handoff_behavior, version, conditions, safety_policy, source_url, source_type, source_label, classification_reason, discovered_at, origin, lifecycle_status, review_reason, evidence, confidence, enabled, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
         on conflict (business_id, action_key) do update set
           action_type = excluded.action_type,
           name = excluded.name,
           description = excluded.description,
           trigger_phrases = excluded.trigger_phrases,
           trigger_intents = excluded.trigger_intents,
           capture_mode = excluded.capture_mode,
           fields = excluded.fields,
           steps = excluded.steps,
           completion = excluded.completion,
           mode = excluded.mode,
           execution_mode = excluded.execution_mode,
           attachment_policy = excluded.attachment_policy,
           tracking_key = excluded.tracking_key,
           destination = excluded.destination,
           provider = excluded.provider,
           priority = excluded.priority,
           required_fields = excluded.required_fields,
           optional_fields = excluded.optional_fields,
           handoff_behavior = excluded.handoff_behavior,
           version = excluded.version,
           conditions = excluded.conditions,
           safety_policy = excluded.safety_policy,
           source_url = excluded.source_url,
           source_type = excluded.source_type,
           source_label = excluded.source_label,
           classification_reason = excluded.classification_reason,
           discovered_at = excluded.discovered_at,
           origin = excluded.origin,
           lifecycle_status = excluded.lifecycle_status,
           review_reason = excluded.review_reason,
           evidence = excluded.evidence,
           confidence = excluded.confidence,
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`,
        [
          action.id,
          business.id,
          action.key,
          action.actionType,
          action.name,
          action.description,
          JSON.stringify(action.triggerPhrases),
          JSON.stringify(action.triggerIntents),
          action.captureMode,
          JSON.stringify(action.fields),
          JSON.stringify(action.steps ?? []),
          JSON.stringify(action.completion),
          action.mode,
          action.executionMode ?? "FORM_FLOW",
          action.attachmentPolicy ?? "explicit_request_only",
          action.trackingKey ?? action.key,
          action.destination ? JSON.stringify(action.destination) : null,
          action.provider,
          action.priority,
          JSON.stringify(action.requiredFields),
          JSON.stringify(action.optionalFields ?? action.fields.filter((field) => !field.required).map((field) => field.key)),
          JSON.stringify(action.handoffBehavior ?? { mode: "none" }),
          action.version ?? 1,
          JSON.stringify(action.conditions),
          action.safetyPolicy,
          action.sourceUrl,
          action.sourceType ?? null,
          action.sourceLabel ?? null,
          action.classificationReason ?? null,
          action.discoveredAt ?? null,
          action.origin ?? "configured",
          action.lifecycleStatus ?? (action.enabled ? "active" : "disabled"),
          action.reviewReason ?? null,
          JSON.stringify(action.evidence),
          action.confidence,
          action.enabled,
          action.createdAt,
          action.updatedAt,
        ],
      );
    }

    for (const resource of business.actionResources) {
      await client.query(
        `insert into business_action_resources
           (id, business_id, resource_type, name, provider, provider_object_id, location, program, day,
            start_time, end_time, role, department, service, price, availability, metadata, conditions,
            destination, status, valid_from, valid_until, source, last_synced_at, version, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
                 $20, $21, $22, $23, $24, $25, $26, $27)
         on conflict (id) do update set
           resource_type = excluded.resource_type,
           name = excluded.name,
           provider = excluded.provider,
           provider_object_id = excluded.provider_object_id,
           location = excluded.location,
           program = excluded.program,
           day = excluded.day,
           start_time = excluded.start_time,
           end_time = excluded.end_time,
           role = excluded.role,
           department = excluded.department,
           service = excluded.service,
           price = excluded.price,
           availability = excluded.availability,
           metadata = excluded.metadata,
           conditions = excluded.conditions,
           destination = excluded.destination,
           status = excluded.status,
           valid_from = excluded.valid_from,
           valid_until = excluded.valid_until,
           source = excluded.source,
           last_synced_at = excluded.last_synced_at,
           version = excluded.version,
           updated_at = excluded.updated_at`,
        [
          resource.id,
          business.id,
          resource.type,
          resource.name,
          resource.provider,
          resource.providerObjectId,
          resource.location,
          resource.program,
          resource.day,
          resource.startTime,
          resource.endTime,
          resource.role,
          resource.department,
          resource.service,
          resource.price === null ? null : String(resource.price),
          resource.availability,
          JSON.stringify(resource.metadata),
          JSON.stringify(resource.conditions),
          resource.destination ? JSON.stringify(resource.destination) : null,
          resource.status,
          resource.validFrom,
          resource.validUntil,
          resource.source,
          resource.lastSyncedAt,
          resource.version,
          resource.createdAt,
          resource.updatedAt,
        ],
      );
    }

    await client.query(
      `insert into agent_configs (business_id, assistant_name, welcome_message, tone, primary_language, fallback_behavior, human_handoff_enabled, widget_color, collect_leads, show_booking_action, fallback_message, widget_default_mode, widget_allow_expand, widget_quick_actions, widget_logo_url, widget_theme, widget_position, proactive_enabled, proactive_delay_seconds, proactive_message, proactive_triggers, proactive_behavior, proactive_frequency, require_lead_consent, privacy_notice_url, retention_days, show_ai_disclosure, citation_visibility, tone_instructions)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29)
       on conflict (business_id) do update set
         assistant_name = excluded.assistant_name,
         welcome_message = excluded.welcome_message,
         tone = excluded.tone,
         primary_language = excluded.primary_language,
         fallback_behavior = excluded.fallback_behavior,
         human_handoff_enabled = excluded.human_handoff_enabled,
         widget_color = excluded.widget_color,
         collect_leads = excluded.collect_leads,
         show_booking_action = excluded.show_booking_action,
         fallback_message = excluded.fallback_message,
         widget_default_mode = excluded.widget_default_mode,
         widget_allow_expand = excluded.widget_allow_expand,
         widget_quick_actions = excluded.widget_quick_actions,
         widget_logo_url = excluded.widget_logo_url,
         widget_theme = excluded.widget_theme,
         widget_position = excluded.widget_position,
         proactive_enabled = excluded.proactive_enabled,
         proactive_delay_seconds = excluded.proactive_delay_seconds,
         proactive_message = excluded.proactive_message,
         proactive_triggers = excluded.proactive_triggers,
         proactive_behavior = excluded.proactive_behavior,
         proactive_frequency = excluded.proactive_frequency,
         require_lead_consent = excluded.require_lead_consent,
         privacy_notice_url = excluded.privacy_notice_url,
         retention_days = excluded.retention_days,
         show_ai_disclosure = excluded.show_ai_disclosure,
         citation_visibility = excluded.citation_visibility,
         tone_instructions = excluded.tone_instructions,
         updated_at = now()`,
      [
        business.id,
        business.agentConfig.assistantName,
        business.agentConfig.welcomeMessage,
        business.agentConfig.tone,
        business.agentConfig.primaryLanguage,
        business.agentConfig.fallbackBehavior,
        business.agentConfig.humanHandoffEnabled,
        business.agentConfig.widgetColor,
        business.agentConfig.collectLeads,
        business.agentConfig.showBookingAction,
        business.agentConfig.fallbackMessage,
        business.agentConfig.widgetDefaultMode,
        business.agentConfig.widgetAllowExpand,
        JSON.stringify(business.agentConfig.widgetQuickActions),
        business.agentConfig.widgetLogoUrl,
        business.agentConfig.widgetTheme,
        business.agentConfig.widgetPosition,
        business.agentConfig.proactiveEnabled,
        business.agentConfig.proactiveDelaySeconds,
        business.agentConfig.proactiveMessage,
        JSON.stringify(business.agentConfig.proactiveTriggers),
        business.agentConfig.proactiveBehavior,
        business.agentConfig.proactiveFrequency,
        business.agentConfig.requireLeadConsent,
        business.agentConfig.privacyNoticeUrl,
        business.agentConfig.retentionDays,
        business.agentConfig.showAiDisclosure,
        business.agentConfig.citationVisibility,
        business.agentConfig.customToneInstructions,
      ],
    );
    await client.query("commit");
    void enqueueAndRunEmbeddingJob(business).catch((error: unknown) => {
      app.log.warn({ error: error instanceof Error ? error.message : "unknown embedding error", businessId: business.id }, "Embedding job enqueue skipped");
    });
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function loadActionResourceRows(businessId: string): Promise<Record<string, unknown>[]> {
  if (!pool) return [];
  try {
    const result = await pool.query<Record<string, unknown>>(
      "select * from business_action_resources where business_id = $1 order by created_at",
      [businessId],
    );
    return result.rows;
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId }, "Action registry table is not available yet");
    return [];
  }
}

async function loadActionSubmissionRows(businessId: string): Promise<Record<string, unknown>[]> {
  if (!pool) return [];
  try {
    const result = await pool.query<Record<string, unknown>>(
      "select * from action_submissions where business_id = $1 order by created_at desc limit 10_000",
      [businessId],
    );
    return result.rows;
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId }, "Action submissions table is not available yet");
    return [];
  }
}

function actionProviderNames(action: ActionFlow): string[] {
  const providers = new Set<string>();
  if (action.provider?.trim()) providers.add(action.provider.trim().toLowerCase());
  for (const step of action.steps ?? []) {
    const provider = step.config?.provider;
    if (typeof provider === "string" && provider.trim()) providers.add(provider.trim().toLowerCase());
  }
  return [...providers];
}

async function loadBusinessFactRows(businessId: string): Promise<Record<string, unknown>[]> {
  if (!pool) return [];
  try {
    const result = await pool.query<Record<string, unknown>>(
      "select * from business_facts where business_id = $1 order by updated_at desc, created_at",
      [businessId],
    );
    return result.rows;
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId }, "Business facts table is not available yet");
    return [];
  }
}

async function loadBusinessContextSnapshot(businessId: string): Promise<BusinessContextSnapshot | null> {
  if (!pool) return null;
  try {
    const result = await pool.query<Record<string, unknown>>(
      "select version, material_fingerprint, summary, generated_at, status from business_context_snapshots where business_id = $1",
      [businessId],
    );
    const row = result.rows[0];
    if (!row) return null;
    return {
      version: Math.max(1, Number(row.version ?? 1)),
      materialFingerprint: String(row.material_fingerprint ?? ""),
      summary: String(row.summary ?? ""),
      generatedAt: toIso(row.generated_at),
      status: row.status === "stale" ? "stale" : "current",
    };
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId }, "Business context snapshot table is not available yet");
    return null;
  }
}

async function loadBusinessFromDatabase(slug: string): Promise<Business | null> {
  if (!pool) return null;
  const businessResult = await pool.query<Record<string, unknown>>(
    `select b.*,
            o.billing_mode as organization_billing_mode, o.billing_status as organization_billing_status,
            o.plan_key as organization_plan_key, o.billing_interval as organization_billing_interval,
            o.trial_end_at as organization_trial_end_at, o.current_period_end_at as organization_current_period_end_at,
            o.grace_end_at as organization_grace_end_at, o.billing_provider as organization_billing_provider,
            o.stripe_customer_id as organization_stripe_customer_id, o.stripe_subscription_id as organization_stripe_subscription_id
     from businesses b
     join organizations o on o.id = b.organization_id
     where b.slug = $1`,
    [slug],
  );
  if (!businessResult.rowCount) return null;
  const row = businessResult.rows[0];
  const businessId = String(row.id);
  const contextSnapshot = await loadBusinessContextSnapshot(businessId);
  const [sourceResult, chunkResult, conversationResult, leadResult, gapResult, actionResult, configResult, actionResourceRows, businessFactRows, actionSubmissionRows] = await Promise.all([
    pool.query<Record<string, unknown>>("select * from business_sources where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from knowledge_chunks where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from conversations where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from leads where business_id = $1 order by created_at desc", [businessId]),
    pool.query<Record<string, unknown>>("select * from knowledge_gaps where business_id = $1 order by occurrence_count desc", [businessId]),
    pool.query<Record<string, unknown>>("select * from business_actions where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from agent_configs where business_id = $1", [businessId]),
    loadActionResourceRows(businessId),
    loadBusinessFactRows(businessId),
    loadActionSubmissionRows(businessId),
  ]);
  const conversationIds = conversationResult.rows.map((item) => String(item.id));
  const messageResult = conversationIds.length
    ? await pool.query<Record<string, unknown>>("select * from conversation_messages where conversation_id = any($1::uuid[]) order by created_at", [conversationIds])
    : { rows: [] as Record<string, unknown>[] };
  const messagesByConversation = new Map<string, Message[]>();
  for (const message of messageResult.rows) {
    const conversationId = String(message.conversation_id);
    const messages = messagesByConversation.get(conversationId) ?? [];
    messages.push({
      id: typeof message.id === "string" ? message.id : undefined,
      role: message.role === "user" ? "user" : message.role === "human" ? "human" : message.role === "system" ? "system" : "assistant",
      kind: message.kind === "system" || message.kind === "internal_note" ? message.kind : "message",
      authorUserId: typeof message.author_user_id === "string" ? message.author_user_id : undefined,
      authorName: typeof message.author_name === "string" ? message.author_name : undefined,
      content: String(message.content),
      grounded: typeof message.grounded === "boolean" ? message.grounded : undefined,
      sourceUrl: typeof message.source_url === "string" ? message.source_url : undefined,
      confidenceScore: message.confidence_score !== null && message.confidence_score !== undefined ? Number(message.confidence_score) : undefined,
      confidenceBand: message.confidence_band === "high" || message.confidence_band === "medium" || message.confidence_band === "low" ? message.confidence_band : undefined,
      citations: Array.isArray(message.citations) ? message.citations as Message["citations"] : undefined,
      retrieval: message.retrieval && typeof message.retrieval === "object" ? asRecord(message.retrieval) as Message["retrieval"] : undefined,
      createdAt: toIso(message.created_at),
    });
    messagesByConversation.set(conversationId, messages);
  }
  let conversionEvents: ConversionEvent[] = [];
  try {
    const eventResult = await pool.query<Record<string, unknown>>(
      "select * from conversion_events where business_id = $1 order by occurred_at desc limit 10_000",
      [businessId],
    );
    conversionEvents = eventResult.rows.map((event) => ({
      id: String(event.id),
      organizationId: typeof event.organization_id === "string" ? event.organization_id : null,
      businessId,
      conversationId: typeof event.conversation_id === "string" ? event.conversation_id : null,
      flowId: typeof event.flow_id === "string" ? event.flow_id : null,
      fieldId: typeof event.field_id === "string" ? event.field_id : null,
      event: conversionEventTypes.has(String(event.event) as ConversionEventType) ? String(event.event) as ConversionEventType : "CTA_CLICKED",
      timestamp: toIso(event.occurred_at),
      sourcePage: typeof event.source_page === "string" ? event.source_page : null,
      device: typeof event.device === "string" ? event.device : null,
      metadata: asRecord(event.metadata),
    }));
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId }, "Conversion events table is not available yet");
  }
  const config = configResult.rows[0];
  const loaded: Business = {
    id: businessId,
    organizationId: typeof row.organization_id === "string" ? row.organization_id : null,
    name: String(row.name),
    slug: String(row.slug),
    vertical: String(row.vertical),
    websiteUrl: String(row.website_url ?? ""),
    location: String(row.location ?? "Demo workspace"),
    ownershipStatus: row.ownership_status === "verified" || row.ownership_status === "rejected" ? row.ownership_status : "pending",
    ownershipVerificationMethod: row.ownership_verification_method === "email"
      || row.ownership_verification_method === "meta_tag"
      || row.ownership_verification_method === "file"
      || row.ownership_verification_method === "dns_txt"
      || row.ownership_verification_method === "manual"
      ? row.ownership_verification_method : null,
    ownershipVerificationTokenHash: typeof row.ownership_verification_token_hash === "string" ? row.ownership_verification_token_hash : null,
    ownershipVerificationExpiresAt: row.ownership_verification_expires_at ? toIso(row.ownership_verification_expires_at) : null,
    ownershipVerifiedAt: row.ownership_verified_at ? toIso(row.ownership_verified_at) : null,
    ownershipVerifiedByUserId: typeof row.ownership_verified_by_user_id === "string" ? row.ownership_verified_by_user_id : null,
    agentPublishedAt: row.agent_published_at ? toIso(row.agent_published_at) : null,
    primaryActionId: typeof row.primary_action_id === "string" ? row.primary_action_id : null,
    sources: sourceResult.rows.map((source) => ({
      id: String(source.id),
      url: String(source.source_url),
      canonicalUrl: String(source.canonical_url ?? source.source_url),
      title: String(source.title ?? "Website source"),
      contentType: String(source.content_type ?? "web_page"),
      pageType: String(source.page_type ?? "web_page"),
      crawlStatus: source.crawl_status === "queued" || source.crawl_status === "crawling" || source.crawl_status === "failed" ? source.crawl_status : "ready",
      contentHash: String(source.content_hash ?? ""),
      lastCrawledAt: source.last_crawled_at ? toIso(source.last_crawled_at) : toIso(source.created_at),
      httpStatus: source.http_status === null || source.http_status === undefined ? null : Number(source.http_status),
      rawHtmlBytes: source.raw_html_bytes === null || source.raw_html_bytes === undefined ? null : Number(source.raw_html_bytes),
      extractedCharacterCount: source.extracted_character_count === null || source.extracted_character_count === undefined ? null : Number(source.extracted_character_count),
      discoveredLinkCount: source.discovered_link_count === null || source.discovered_link_count === undefined ? null : Number(source.discovered_link_count),
      crawlMode: source.crawl_mode === "rendered" ? "rendered" : "static",
      renderAttempted: Boolean(source.render_attempted),
      renderSuccess: Boolean(source.render_success),
      renderDurationMs: source.render_duration_ms === null || source.render_duration_ms === undefined ? null : Number(source.render_duration_ms),
      renderDiagnostics: source.render_diagnostics && typeof source.render_diagnostics === "object" ? asRecord(source.render_diagnostics) : null,
      crawlDepth: source.crawl_depth === null || source.crawl_depth === undefined ? null : Number(source.crawl_depth),
      discoveryParentUrl: typeof source.discovery_parent_url === "string" ? source.discovery_parent_url : null,
      errorMessage: typeof source.error_message === "string" ? source.error_message : null,
    })),
    chunks: chunkResult.rows.map((chunk) => ({
      id: String(chunk.id),
      sourceId: String(chunk.source_id),
      content: String(chunk.content),
      contentHash: String(chunk.content_hash),
      metadata: asRecord(chunk.metadata),
      embeddingModel: typeof chunk.embedding_model === "string" ? chunk.embedding_model : null,
      embeddingDimensions: chunk.embedding_dimensions === null || chunk.embedding_dimensions === undefined ? null : Number(chunk.embedding_dimensions),
    })),
    facts: businessFactRows.map(businessFactFromRow),
    actions: actionResult.rows.length
      ? actionResult.rows.map(actionFromRow)
      : defaultActionFlows(
        String(row.name),
        chunkResult.rows.map((chunk) => String(chunk.content ?? "")).join(" "),
        (key) => randomUUID(),
      ),
    actionSubmissions: actionSubmissionRows.map(actionSubmissionFromRow),
    actionResources: actionResourceRows.map(actionResourceFromRow),
    conversations: new Map(conversationResult.rows.map((conversation) => {
      const id = String(conversation.id);
      return [id, {
        id,
        sessionId: String(conversation.session_id),
        leadCaptured: Boolean(conversation.lead_captured),
        actionTaken: typeof conversation.action_taken === "string" ? conversation.action_taken : null,
        status: conversation.status === "HANDOFF_REQUESTED" || conversation.status === "WAITING_FOR_STAFF"
          || conversation.status === "HUMAN_ACTIVE" || conversation.status === "AI_ASSISTED" || conversation.status === "RESOLVED" || conversation.status === "EXPIRED"
          ? conversation.status : "AI_ACTIVE",
        assignedUserId: typeof conversation.assigned_user_id === "string" ? conversation.assigned_user_id : null,
        assignedAt: conversation.assigned_at ? toIso(conversation.assigned_at) : null,
        handoffReason: typeof conversation.handoff_reason === "string" ? conversation.handoff_reason : null,
        handoffRequestedAt: conversation.handoff_requested_at ? toIso(conversation.handoff_requested_at) : null,
        handoffNotificationStatus: conversation.handoff_notification_status === "sent" || conversation.handoff_notification_status === "pending" || conversation.handoff_notification_status === "failed"
          ? conversation.handoff_notification_status
          : null,
        humanJoinedAt: conversation.human_joined_at ? toIso(conversation.human_joined_at) : null,
        resolvedAt: conversation.resolved_at ? toIso(conversation.resolved_at) : null,
        unreadCount: Number(conversation.unread_count ?? 0),
        lastActivityAt: conversation.last_activity_at ? toIso(conversation.last_activity_at) : toIso(conversation.updated_at),
        actionState: conversation.action_state && typeof conversation.action_state === "object"
          ? asRecord(conversation.action_state) as ConversationActionState
          : undefined,
        messages: messagesByConversation.get(id) ?? [],
        createdAt: toIso(conversation.created_at),
        updatedAt: toIso(conversation.updated_at),
      } satisfies Conversation];
    })),
    conversationEvents: [],
    conversionEvents,
    notifications: [],
    internalNotes: [],
    leads: leadResult.rows.map(leadFromRow),
    businessContextSnapshot: contextSnapshot,
    knowledgeGaps: new Map(gapResult.rows.map((gap) => [
      String(gap.question).toLowerCase().replace(/\s+/g, " ").trim(),
      {
        question: String(gap.question),
        occurrenceCount: Number(gap.occurrence_count),
        status: gap.status === "resolved" ? "resolved" : gap.status === "ignored" ? "ignored" : "open",
        approvedAnswer: typeof gap.approved_answer === "string" ? gap.approved_answer : null,
        answerMode: gap.answer_mode === "fixed_response" ? "fixed_response" : "knowledge",
        lastSeenAt: toIso(gap.last_seen_at),
        updatedAt: gap.updated_at ? toIso(gap.updated_at) : toIso(gap.last_seen_at),
        indexedAt: gap.indexed_at ? toIso(gap.indexed_at) : null,
        indexStatus: ["not_indexed", "pending", "ready", "failed"].includes(String(gap.index_status))
          ? String(gap.index_status) as KnowledgeIndexStatus
          : "not_indexed",
        indexError: typeof gap.index_error === "string" ? gap.index_error : null,
        intent: ["services", "hours", "contact", "pricing", "location", "booking", "reminders", "calendar", "voice", "teams", "permissions", "privacy", "policy", "support", "getting_started", "general", "unsupported"].includes(String(gap.intent))
          ? String(gap.intent) as RetrievalIntent
          : null,
        reason: ["no_authoritative_source", "low_confidence_evidence", "answer_generation_failed", "grounding_check_failed"].includes(String(gap.reason))
          ? String(gap.reason) as KnowledgeGapReason
          : "legacy_unknown",
      } satisfies KnowledgeGap,
    ])),
    agentConfig: config ? agentConfigFromValue({
      assistantName: config.assistant_name,
      welcomeMessage: config.welcome_message,
      tone: config.tone,
      customToneInstructions: config.tone_instructions,
      primaryLanguage: config.primary_language,
      fallbackBehavior: config.fallback_behavior,
      humanHandoffEnabled: config.human_handoff_enabled,
      widgetColor: config.widget_color,
      collectLeads: config.collect_leads,
      showBookingAction: config.show_booking_action,
      fallbackMessage: config.fallback_message,
      widgetDefaultMode: config.widget_default_mode,
      widgetAllowExpand: config.widget_allow_expand,
      widgetQuickActions: config.widget_quick_actions,
      widgetLogoUrl: config.widget_logo_url,
      widgetTheme: config.widget_theme,
      widgetPosition: config.widget_position,
      proactiveEnabled: config.proactive_enabled,
      proactiveDelaySeconds: config.proactive_delay_seconds,
      proactiveMessage: config.proactive_message,
      proactiveTriggers: config.proactive_triggers,
      proactiveBehavior: config.proactive_behavior,
      proactiveFrequency: config.proactive_frequency,
      requireLeadConsent: config.require_lead_consent,
      privacyNoticeUrl: config.privacy_notice_url,
      retentionDays: config.retention_days,
      showAiDisclosure: config.show_ai_disclosure,
      citationVisibility: config.citation_visibility,
      fallbackPhone: config.fallback_phone,
      fallbackEmail: config.fallback_email,
      fallbackContactUrl: config.fallback_contact_url,
    }, String(row.name)) : defaultConfig(String(row.name)),
    publishedAgentConfig: config?.published_config ? agentConfigFromValue(config.published_config, String(row.name)) : null,
    publishedAgentConfigHash: typeof config?.published_config_hash === "string" ? config.published_config_hash : null,
    billing: {
      mode: (row.organization_billing_mode ?? row.billing_mode) === "live" ? "live" : "sandbox",
      isDemo: row.is_demo !== false,
      status: ["active", "grace", "paused", "cancelled"].includes(String(row.organization_billing_status ?? row.billing_status))
        ? String(row.organization_billing_status ?? row.billing_status) as BillingStatus : "trial",
      planKey: String(row.organization_plan_key ?? row.plan_key ?? "demo"),
      interval: row.organization_billing_interval === "month" || row.organization_billing_interval === "year"
        ? row.organization_billing_interval : (row.billing_interval === "month" || row.billing_interval === "year" ? row.billing_interval : null),
      trialEndsAt: row.organization_trial_end_at ? toIso(row.organization_trial_end_at) : (row.trial_ends_at ? toIso(row.trial_ends_at) : null),
      currentPeriodEndsAt: row.organization_current_period_end_at ? toIso(row.organization_current_period_end_at) : (row.current_period_ends_at ? toIso(row.current_period_ends_at) : null),
      graceEndsAt: row.organization_grace_end_at ? toIso(row.organization_grace_end_at) : (row.grace_ends_at ? toIso(row.grace_ends_at) : null),
      provider: typeof row.organization_billing_provider === "string" ? row.organization_billing_provider : (typeof row.billing_provider === "string" ? row.billing_provider : null),
      providerCustomerId: typeof row.organization_stripe_customer_id === "string" ? row.organization_stripe_customer_id : (typeof row.provider_customer_id === "string" ? row.provider_customer_id : null),
      providerSubscriptionId: typeof row.organization_stripe_subscription_id === "string" ? row.organization_stripe_subscription_id : (typeof row.provider_subscription_id === "string" ? row.provider_subscription_id : null),
    },
    widget: {
      siteKey: String(row.public_site_key ?? ""),
      enabled: row.widget_enabled !== false,
      lastLoadedAt: row.widget_last_loaded_at ? toIso(row.widget_last_loaded_at) : null,
      loadCount: Number(row.widget_load_count ?? 0),
    },
    createdAt: toIso(row.created_at),
  };
  // Businesses published by the previous timestamp-only implementation keep
  // their live state until the first explicit publish writes a snapshot.
  if (loaded.agentPublishedAt && !loaded.publishedAgentConfig) {
    loaded.publishedAgentConfig = cloneAgentConfig(loaded.agentConfig);
  }
  for (const gap of loaded.knowledgeGaps.values()) {
    if (gap.status !== "resolved" || !gap.approvedAnswer) continue;
    try {
      await ensureKnowledgeAnswerIndex(loaded, gap);
    } catch (error) {
      app.log.warn({ error, businessId: loaded.id, question: gap.question }, "Resolved knowledge answer index repair deferred");
    }
  }
  return loaded;
}

async function persistConversation(business: Business, conversation: Conversation): Promise<void> {
  if (!pool) return;
  const params = [
    conversation.id,
    business.id,
    conversation.sessionId,
    conversation.leadCaptured,
    conversation.actionTaken,
    conversation.actionState ? JSON.stringify(conversation.actionState) : null,
    conversation.status,
    conversation.assignedUserId,
    conversation.assignedAt,
    conversation.handoffReason,
    conversation.handoffRequestedAt,
    conversation.handoffNotificationStatus,
    conversation.humanJoinedAt,
    conversation.resolvedAt,
    conversation.unreadCount,
    conversation.lastActivityAt,
    conversation.createdAt,
    conversation.updatedAt,
  ];
  try {
    await pool.query(
      `insert into conversations
         (id, business_id, session_id, lead_captured, action_taken, action_state, status, assigned_user_id,
          assigned_at, handoff_reason, handoff_requested_at, handoff_notification_status, human_joined_at, resolved_at, unread_count,
          last_activity_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
       on conflict (id) do update set
         lead_captured = excluded.lead_captured,
         action_taken = excluded.action_taken,
         action_state = excluded.action_state,
         status = excluded.status,
         assigned_user_id = excluded.assigned_user_id,
         assigned_at = excluded.assigned_at,
         handoff_reason = excluded.handoff_reason,
         handoff_requested_at = excluded.handoff_requested_at,
         handoff_notification_status = excluded.handoff_notification_status,
         human_joined_at = excluded.human_joined_at,
         resolved_at = excluded.resolved_at,
         unread_count = excluded.unread_count,
         last_activity_at = excluded.last_activity_at,
         updated_at = excluded.updated_at`,
      params,
    );
  } catch (error) {
    if (!isMissingDatabaseColumn(error)) throw error;
    app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error", conversationId: conversation.id }, "Action state column is not available yet");
    await pool.query(
       `insert into conversations (id, business_id, session_id, lead_captured, action_taken, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $17, $18)
       on conflict (id) do update set
         lead_captured = excluded.lead_captured,
         action_taken = excluded.action_taken,
         updated_at = excluded.updated_at`,
      params,
    );
  }
}

type UsageMetric = "conversations" | "leads" | "bookings" | "llm_requests";

async function recordOrganizationUsage(business: Business, metric: UsageMetric): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into organization_usage_daily (organization_id, usage_date, ${metric})
     select organization_id, current_date, 1 from businesses where id = $1
     on conflict (organization_id, usage_date) do update set ${metric} = organization_usage_daily.${metric} + 1, updated_at = now()`,
    [business.id],
  );
}

async function recordModelUsage(business: Business, usage: ModelUsage): Promise<void> {
  if (!pool || usage.inputTokens <= 0 && usage.outputTokens <= 0 && usage.estimatedCostUsd === null) return;
  try {
    await pool.query(
      `insert into organization_usage_daily (organization_id, usage_date, llm_input_tokens, llm_output_tokens, llm_estimated_cost_usd)
       select organization_id, current_date, $2, $3, coalesce($4, 0) from businesses where id = $1
       on conflict (organization_id, usage_date) do update set
         llm_input_tokens = organization_usage_daily.llm_input_tokens + excluded.llm_input_tokens,
         llm_output_tokens = organization_usage_daily.llm_output_tokens + excluded.llm_output_tokens,
         llm_estimated_cost_usd = organization_usage_daily.llm_estimated_cost_usd + excluded.llm_estimated_cost_usd,
         updated_at = now()`,
      [business.id, usage.inputTokens, usage.outputTokens, usage.estimatedCostUsd],
    );
  } catch (error) {
    // The model-cost columns are optional during a rolling deploy. Do not turn
    // an otherwise successful answer into a 500 while the migration catches up.
    if (!isMissingDatabaseColumn(error)) throw error;
    app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error", businessId: business.id }, "Model usage columns are not available yet");
  }
}

function isMissingDatabaseColumn(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  const code = (error as { code?: unknown }).code;
  return code === "42703";
}

function isMissingDatabaseTable(error: unknown): boolean {
  if (!error || typeof error !== "object" || !("code" in error)) return false;
  return (error as { code?: unknown }).code === "42P01";
}

type ActionRegistryAuditEvent = "created" | "updated" | "approved" | "enabled" | "disabled" | "primary_set" | "primary_cleared" | "source_removed";

async function recordActionRegistryAudit(input: {
  businessId: string;
  actionId?: string | null;
  actorUserId?: string | null;
  actorType: "super_admin" | "owner" | "system";
  eventType: ActionRegistryAuditEvent;
  previousValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `insert into action_registry_audit
         (business_id, action_id, actor_user_id, actor_type, event_type, previous_value, new_value, reason, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        input.businessId,
        input.actionId ?? null,
        input.actorUserId ?? null,
        input.actorType,
        input.eventType,
        input.previousValue === undefined ? null : JSON.stringify(input.previousValue),
        input.newValue === undefined ? null : JSON.stringify(input.newValue),
        input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
  } catch (error) {
    // Keep a rolling deploy safe if the API starts before migration 054.
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: input.businessId, actionId: input.actionId ?? null }, "Action registry audit table is not available yet");
  }
}

async function persistMessage(conversation: Conversation, message: Message): Promise<void> {
  if (!pool) return;
  message.id ??= randomUUID();
  const retrieval = message.retrieval;
  const params = [
    message.id,
    conversation.id,
    message.role,
    message.content,
    message.grounded ?? null,
    message.sourceUrl ?? null,
    message.confidenceScore ?? null,
    message.confidenceBand ?? null,
    JSON.stringify(message.citations ?? []),
    retrieval ?? null,
    retrieval?.route ?? null,
    retrieval?.model ?? null,
    retrieval?.inputTokens ?? 0,
    retrieval?.outputTokens ?? 0,
    retrieval?.estimatedCostUsd ?? null,
    retrieval?.latencyMs ?? null,
    message.authorUserId ?? null,
    message.kind ?? "message",
    message.createdAt,
  ];

  try {
    await pool.query(
      `insert into conversation_messages
         (id, conversation_id, role, content, grounded, source_url, confidence_score, confidence_band, citations, retrieval,
          model_route, model_name, input_tokens, output_tokens, estimated_cost_usd, model_latency_ms, author_user_id, kind, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      params,
    );
    return;
  } catch (error) {
    if (!isMissingDatabaseColumn(error)) throw error;
    app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error", conversationId: conversation.id }, "Conversation observability columns are not available yet");
  }

  // Keep message persistence compatible with a rolling deployment where the
  // API has been updated before migrations 007/018 have reached the database.
  const legacyParams = [...params];
  legacyParams[2] = message.role === "user" ? "user" : "assistant";
  try {
    await pool.query(
      `insert into conversation_messages
         (id, conversation_id, role, content, grounded, source_url, confidence_score, confidence_band, citations, retrieval, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $19)`,
      legacyParams,
    );
    return;
  } catch (error) {
    if (!isMissingDatabaseColumn(error)) throw error;
    app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error", conversationId: conversation.id }, "Grounded-answer columns are not available yet");
  }

  await pool.query(
    `insert into conversation_messages (id, conversation_id, role, content, created_at)
     values ($1, $2, $3, $4, $5)`,
    [message.id, conversation.id, message.role === "user" ? "user" : "assistant", message.content, message.createdAt],
  );
}

async function persistLead(business: Business, lead: Lead): Promise<Lead> {
  if (!pool) {
    const existing = lead.idempotencyKey ? business.leads.find((item) => item.idempotencyKey === lead.idempotencyKey) : undefined;
    return existing ?? lead;
  }

  const client = await pool.connect();
  try {
    await client.query("begin");
    const inserted = await client.query<Record<string, unknown>>(
      `insert into leads
         (id, business_id, conversation_id, name, email, phone, intent, status, source, page_url, referrer, consent_at, idempotency_key, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict do nothing
       returning *`,
      [
        lead.id,
        business.id,
        lead.conversationId,
        lead.name,
        lead.email,
        lead.phone,
        lead.intent,
        lead.status,
        lead.source,
        lead.pageUrl,
        lead.referrer,
        lead.consentAt,
        lead.idempotencyKey,
        JSON.stringify(lead.metadata),
      ],
    );

    if (!inserted.rowCount) {
      const existing = lead.idempotencyKey
        ? await client.query<Record<string, unknown>>(
          "select * from leads where business_id = $1 and idempotency_key = $2 limit 1",
          [business.id, lead.idempotencyKey],
        )
        : await client.query<Record<string, unknown>>("select * from leads where id = $1", [lead.id]);
      if (!existing.rowCount) throw new Error("Lead could not be persisted");
      await client.query("commit");
      return leadFromRow(existing.rows[0]);
    }

    const persisted = leadFromRow(inserted.rows[0]);
    const event = await client.query<{ id: string }>(
      `insert into lead_events (business_id, lead_id, event_type, payload)
       values ($1, $2, 'lead.created', $3)
       returning id`,
      [business.id, persisted.id, JSON.stringify({ leadId: persisted.id, source: persisted.source })],
    );
    const integrations = await client.query<{ id: string }>(
      `select id from crm_integrations where business_id = $1 and provider in ('webhook', 'hubspot') and connection_status = 'active'`,
      [business.id],
    );
    const payload = crmLeadPayload(business, persisted, event.rows[0].id);
    for (const integration of integrations.rows) {
      const idempotencyKey = `lead.created:${persisted.id}`;
      await client.query(
        `insert into integration_outbox
           (business_id, integration_id, event_type, aggregate_type, aggregate_id, idempotency_key, payload)
         values ($1, $2, 'lead.created', 'lead', $3, $4, $5)
         on conflict (integration_id, idempotency_key) do nothing`,
        [business.id, integration.id, persisted.id, idempotencyKey, JSON.stringify(payload)],
      );
      await client.query(
        `insert into crm_sync_records (business_id, integration_id, lead_id)
         values ($1, $2, $3)
         on conflict (integration_id, lead_id) do nothing`,
        [business.id, integration.id, persisted.id],
      );
    }
    await client.query("commit");
    await recordOrganizationUsage(business, "leads");
    void processIntegrationOutbox();
    if (persisted.status === "qualified") {
      const organizationId = await businessOrganizationId(business);
      await queueLifecycleEvent({
        eventType: "QUALIFIED_LEAD",
        eventKey: `lead.qualified:${persisted.id}`,
        organizationId,
        businessId: business.id,
        payload: {
          business_name: business.name,
          lead_name: persisted.name || "A visitor",
          lead_intent: persisted.intent || "customer inquiry",
          lead_contact: persisted.email || persisted.phone || "No direct contact provided",
          leads_url: lifecycleAppUrl(`/app/${business.slug}/leads`),
        },
      });
    }
    return persisted;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function persistGap(business: Business, gap: KnowledgeGap): Promise<void> {
  if (!pool) return;
  try {
    const result = await pool.query<{ occurrence_count: number }>(
      `insert into knowledge_gaps (business_id, question, occurrence_count, status, approved_answer, answer_mode, last_seen_at, intent, reason, updated_at, index_status)
       values ($1, $2, 1, $3, $4, $5, $6, $7, $8, now(), 'not_indexed')
       on conflict (business_id, question) do update set
         occurrence_count = knowledge_gaps.occurrence_count + 1,
         last_seen_at = excluded.last_seen_at,
         updated_at = now(),
         intent = excluded.intent,
         reason = excluded.reason,
         answer_mode = coalesce(knowledge_gaps.answer_mode, excluded.answer_mode)
       returning occurrence_count`,
      [business.id, gap.question, gap.status, gap.approvedAnswer, gap.answerMode, gap.lastSeenAt, gap.intent, gap.reason],
    );
    gap.occurrenceCount = Number(result.rows[0].occurrence_count);
    return;
  } catch (error) {
    if (!isMissingDatabaseColumn(error)) {
      app.log.error({ error, businessId: business.id }, "Knowledge-gap diagnostics could not be persisted");
      return;
    }
    // Keep answer requests compatible with an API rolling out ahead of the
    // diagnostics migration. The repair migration will add these fields, but
    // the legacy write still records the question while that catches up.
    app.log.warn({ businessId: business.id }, "Knowledge-gap diagnostics columns are not available yet; using legacy schema");
  }

  try {
    const legacyResult = await pool.query<{ occurrence_count: number }>(
      `insert into knowledge_gaps (business_id, question, occurrence_count, status, approved_answer, last_seen_at)
       values ($1, $2, 1, $3, $4, $5)
       on conflict (business_id, question) do update set
         occurrence_count = knowledge_gaps.occurrence_count + 1,
         last_seen_at = excluded.last_seen_at
       returning occurrence_count`,
      [business.id, gap.question, gap.status, gap.approvedAnswer, gap.lastSeenAt],
    );
    gap.occurrenceCount = Number(legacyResult.rows[0].occurrence_count);
  } catch (error) {
    // Diagnostics must never turn a valid customer answer into a 500.
    app.log.error({ error, businessId: business.id }, "Legacy knowledge-gap diagnostics could not be persisted");
  }
}

async function setKnowledgeIndexState(
  business: Business,
  gap: KnowledgeGap,
  status: KnowledgeIndexStatus,
  indexedAt: string | null,
  indexError: string | null = null,
): Promise<void> {
  gap.indexStatus = status;
  gap.indexedAt = indexedAt;
  gap.indexError = indexError;
  gap.updatedAt = new Date().toISOString();
  if (!pool) return;
  try {
    await pool.query(
      `update knowledge_gaps
       set index_status = $3, indexed_at = $4, index_error = $5, updated_at = now()
       where business_id = $1 and question = $2`,
      [business.id, gap.question, status, indexedAt, indexError],
    );
  } catch (error) {
    if (!isMissingDatabaseColumn(error)) throw error;
    // Older deployments can still serve the answer; the migration will add
    // the lifecycle fields before the next owner edit.
  }
}

async function replaceKnowledgeAnswerIndex(business: Business, gap: KnowledgeGap): Promise<"queued" | "ready"> {
  const sourceUrl = `faq:${contentHash(gap.question)}`;
  const previousSource = business.sources.find((source) => source.url === sourceUrl);
  const sourceId = previousSource?.id ?? randomUUID();
  const source: Source = {
    id: sourceId,
    url: sourceUrl,
    canonicalUrl: sourceUrl,
    title: `FAQ: ${gap.question}`.slice(0, 240),
    contentType: "faq",
    pageType: "faq",
    crawlStatus: "ready",
    contentHash: contentHash(`${sourceUrl}:${gap.approvedAnswer ?? ""}`),
    lastCrawledAt: new Date().toISOString(),
  };
  const chunk: KnowledgeChunk = {
    id: randomUUID(),
    sourceId,
    content: gap.approvedAnswer ?? "",
    contentHash: contentHash(`${gap.question}\n${gap.approvedAnswer ?? ""}`),
    metadata: {
      sourceType: "knowledge_answer",
      knowledgeGapQuestion: gap.question,
      responseMode: gap.answerMode,
      pageType: "faq",
    },
  };

  try {
    if (pool) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        await client.query("delete from knowledge_chunks where business_id = $1 and source_id = $2", [business.id, sourceId]);
        await client.query("delete from business_sources where business_id = $1 and id = $2", [business.id, sourceId]);
        await client.query(
          `insert into business_sources (id, business_id, source_url, canonical_url, title, content_type, page_type, crawl_status, content_hash, last_crawled_at)
           values ($1, $2, $3, $3, $4, 'faq', 'faq', 'ready', $5, now())`,
          [sourceId, business.id, sourceUrl, source.title, source.contentHash],
        );
        await client.query(
          `insert into knowledge_chunks (id, business_id, source_id, content, content_hash, metadata)
           values ($1, $2, $3, $4, $5, $6)`,
          [chunk.id, business.id, sourceId, chunk.content, chunk.contentHash, JSON.stringify(chunk.metadata)],
        );
        await client.query("commit");
      } catch (error) {
        await client.query("rollback").catch(() => undefined);
        await setKnowledgeIndexState(business, gap, "failed", null, error instanceof Error ? error.message.slice(0, 500) : "Knowledge answer indexing failed");
        throw error;
      } finally {
        client.release();
      }
    }

    business.sources = business.sources.filter((candidate) => candidate.id !== previousSource?.id).concat(source);
    business.chunks = business.chunks.filter((candidate) => candidate.sourceId !== sourceId).concat(chunk);
    const indexingStatus = pool ? await enqueueAndRunEmbeddingJob(business) : "ready";
    const indexStatus: KnowledgeIndexStatus = indexingStatus === "queued" || (pool && !embeddingsConfigured()) ? "pending" : "ready";
    await setKnowledgeIndexState(business, gap, indexStatus, new Date().toISOString());
    return indexStatus === "pending" ? "queued" : "ready";
  } catch (error) {
    if (gap.indexStatus !== "failed") {
      await setKnowledgeIndexState(business, gap, "failed", gap.indexedAt, error instanceof Error ? error.message.slice(0, 500) : "Knowledge answer indexing failed");
    }
    throw error;
  }
}

async function ensureKnowledgeAnswerIndex(business: Business, gap: KnowledgeGap): Promise<void> {
  if (gap.status !== "resolved" || !gap.approvedAnswer) return;
  const expectedContentHash = contentHash(`${gap.question}\n${gap.approvedAnswer}`);
  const indexedChunk = business.chunks.find((chunk) => chunk.metadata.sourceType === "knowledge_answer"
    && chunk.metadata.knowledgeGapQuestion === gap.question
    && chunk.contentHash === expectedContentHash);
  if (!indexedChunk) {
    await replaceKnowledgeAnswerIndex(business, gap);
    return;
  }
  const embeddingReady = indexedChunk.embeddingModel === embeddingModel() && indexedChunk.embeddingDimensions === embeddingDimensions();
  const status = !pool || embeddingReady ? "ready" : "pending";
  if (gap.indexStatus !== status || !gap.indexedAt) {
    await setKnowledgeIndexState(business, gap, status, gap.indexedAt ?? new Date().toISOString());
  }
  if (pool && !embeddingReady) await enqueueAndRunEmbeddingJob(business);
}

async function resolveKnowledgeGap(business: Business, question: string, approvedAnswer: string, answerMode: KnowledgeAnswerMode = "knowledge"): Promise<{ gap: KnowledgeGap; indexingStatus: "queued" | "ready" | "failed" }> {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const gap = business.knowledgeGaps.get(key);
  if (!gap) throw httpError(404, "Knowledge gap not found");
  gap.status = "resolved";
  gap.approvedAnswer = approvedAnswer;
  gap.answerMode = answerMode;
  gap.lastSeenAt = new Date().toISOString();
  gap.updatedAt = gap.lastSeenAt;
  gap.indexStatus = "pending";
  gap.indexError = null;
  if (pool) {
    try {
      await pool.query(
        `update knowledge_gaps
         set status = 'resolved', approved_answer = $3, answer_mode = $4, last_seen_at = $5, updated_at = now(), index_status = 'pending', index_error = null
         where business_id = $1 and question = $2`,
        [business.id, gap.question, approvedAnswer, answerMode, gap.lastSeenAt],
      );
    } catch (error) {
      if (!isMissingDatabaseColumn(error)) throw error;
      await pool.query(
        `update knowledge_gaps
         set status = 'resolved', approved_answer = $3, last_seen_at = $4
         where business_id = $1 and question = $2`,
        [business.id, gap.question, approvedAnswer, gap.lastSeenAt],
      );
    }
  }
  try {
    return { gap, indexingStatus: await replaceKnowledgeAnswerIndex(business, gap) };
  } catch (error) {
    app.log.error({ error, businessId: business.id, question: gap.question }, "Knowledge answer saved but indexing failed");
    return { gap, indexingStatus: "failed" };
  }
}

async function ignoreKnowledgeGap(business: Business, question: string): Promise<KnowledgeGap> {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const gap = business.knowledgeGaps.get(key);
  if (!gap) throw httpError(404, "Knowledge gap not found");
  gap.status = "ignored";
  gap.updatedAt = new Date().toISOString();
  if (pool) {
    try {
      await pool.query(
        `update knowledge_gaps
         set status = 'ignored', updated_at = now()
         where business_id = $1 and question = $2`,
        [business.id, gap.question],
      );
    } catch (error) {
      if (!isMissingDatabaseColumn(error)) throw error;
      await pool.query(
        `update knowledge_gaps
         set status = 'ignored'
         where business_id = $1 and question = $2`,
        [business.id, gap.question],
      );
    }
  }
  return gap;
}

async function persistAgentConfig(business: Business): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into agent_configs (business_id, assistant_name, welcome_message, tone, primary_language, fallback_behavior, human_handoff_enabled, widget_color, collect_leads, show_booking_action, fallback_message, widget_default_mode, widget_allow_expand, widget_quick_actions, widget_logo_url, widget_theme, widget_position, proactive_enabled, proactive_delay_seconds, proactive_message, proactive_triggers, proactive_behavior, proactive_frequency, require_lead_consent, privacy_notice_url, retention_days, show_ai_disclosure, citation_visibility, tone_instructions, fallback_phone, fallback_email, fallback_contact_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32)
     on conflict (business_id) do update set
       assistant_name = excluded.assistant_name,
       welcome_message = excluded.welcome_message,
       tone = excluded.tone,
       primary_language = excluded.primary_language,
       fallback_behavior = excluded.fallback_behavior,
       human_handoff_enabled = excluded.human_handoff_enabled,
       widget_color = excluded.widget_color,
       collect_leads = excluded.collect_leads,
       show_booking_action = excluded.show_booking_action,
       fallback_message = excluded.fallback_message,
       widget_default_mode = excluded.widget_default_mode,
       widget_allow_expand = excluded.widget_allow_expand,
       widget_quick_actions = excluded.widget_quick_actions,
       widget_logo_url = excluded.widget_logo_url,
       widget_theme = excluded.widget_theme,
       widget_position = excluded.widget_position,
       proactive_enabled = excluded.proactive_enabled,
       proactive_delay_seconds = excluded.proactive_delay_seconds,
       proactive_message = excluded.proactive_message,
       proactive_triggers = excluded.proactive_triggers,
       proactive_behavior = excluded.proactive_behavior,
       proactive_frequency = excluded.proactive_frequency,
       require_lead_consent = excluded.require_lead_consent,
       privacy_notice_url = excluded.privacy_notice_url,
       retention_days = excluded.retention_days,
       show_ai_disclosure = excluded.show_ai_disclosure,
       citation_visibility = excluded.citation_visibility,
       tone_instructions = excluded.tone_instructions,
       fallback_phone = excluded.fallback_phone,
       fallback_email = excluded.fallback_email,
       fallback_contact_url = excluded.fallback_contact_url,
       updated_at = now()`,
    [business.id, business.agentConfig.assistantName, business.agentConfig.welcomeMessage, business.agentConfig.tone, business.agentConfig.primaryLanguage, business.agentConfig.fallbackBehavior, business.agentConfig.humanHandoffEnabled, business.agentConfig.widgetColor, business.agentConfig.collectLeads, business.agentConfig.showBookingAction, business.agentConfig.fallbackMessage, business.agentConfig.widgetDefaultMode, business.agentConfig.widgetAllowExpand, JSON.stringify(business.agentConfig.widgetQuickActions), business.agentConfig.widgetLogoUrl, business.agentConfig.widgetTheme, business.agentConfig.widgetPosition, business.agentConfig.proactiveEnabled, business.agentConfig.proactiveDelaySeconds, business.agentConfig.proactiveMessage, JSON.stringify(business.agentConfig.proactiveTriggers), business.agentConfig.proactiveBehavior, business.agentConfig.proactiveFrequency, business.agentConfig.requireLeadConsent, business.agentConfig.privacyNoticeUrl, business.agentConfig.retentionDays, business.agentConfig.showAiDisclosure, business.agentConfig.citationVisibility, business.agentConfig.customToneInstructions, business.agentConfig.fallbackContacts.phone, business.agentConfig.fallbackContacts.email, business.agentConfig.fallbackContacts.url],
  );
}

async function persistPublishedAgentConfig(business: Business): Promise<void> {
  if (!business.publishedAgentConfig) return;
  business.agentPublishedAt = business.agentPublishedAt ?? new Date().toISOString();
  business.publishedAgentConfigHash = agentConfigHash(business.publishedAgentConfig);
  if (!pool) return;
  await pool.query(
    `update agent_configs
     set published_config = $2, published_config_hash = $3, updated_at = now()
     where business_id = $1`,
    [business.id, JSON.stringify(business.publishedAgentConfig), business.publishedAgentConfigHash],
  );
}

function hashAccessToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function auditRequestContext(request?: FastifyRequest): { ipHash: string | null; userAgent: string | null } {
  const ip = request?.ip?.trim();
  const userAgent = typeof request?.headers["user-agent"] === "string" ? request.headers["user-agent"].slice(0, 500) : null;
  return {
    ipHash: ip ? contentHash(`${process.env.FRONTDESKWISE_CREDENTIAL_KEY ?? "frontdeskwise"}:${ip}`) : null,
    userAgent,
  };
}

async function recordDemoAudit(input: DemoAuditInput): Promise<void> {
  if (!pool) return;
  const context = auditRequestContext(input.request);
  await pool.query(
    `insert into demo_access_audit
       (demo_request_id, session_id, business_id, event_type, actor_type, actor_user_id, actor_email, ip_hash, user_agent, metadata)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.demoRequestId ?? null,
      input.sessionId ?? null,
      input.businessId ?? null,
      input.eventType,
      input.actorType ?? "system",
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      context.ipHash,
      context.userAgent,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

async function createDemoRequestRecord(input: {
  requesterName?: string | null;
  requesterEmail?: string | null;
  businessName?: string | null;
  websiteUrl: string;
  templateKey?: string | null;
  source?: string | null;
  createdByUserId?: string | null;
  request?: FastifyRequest;
}): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ id: string }>(
    `insert into demo_requests
       (requester_name, requester_email, business_name, website_url, template_key, source, created_by_user_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      input.requesterName ?? null,
      input.requesterEmail?.toLowerCase() ?? null,
      input.businessName ?? null,
      input.websiteUrl,
      input.templateKey ?? "local_business",
      input.source ?? "landing",
      input.createdByUserId ?? null,
    ],
  );
  const id = result.rows[0].id;
  await recordDemoAudit({
    demoRequestId: id,
    eventType: "requested",
    actorType: input.createdByUserId ? "admin" : input.requesterEmail ? "requester" : "anonymous",
    actorUserId: input.createdByUserId,
    actorEmail: input.requesterEmail,
    request: input.request,
    metadata: { source: input.source ?? "landing", templateKey: input.templateKey ?? "local_business" },
  });
  void notifySuperAdmins({
    subject: `New FrontDeskWise demo request${input.businessName ? ` · ${input.businessName}` : ""}`,
    text: [
      "A new demo request was submitted to FrontDeskWise.",
      `Website: ${input.websiteUrl}`,
      `Name: ${input.requesterName ?? "Not provided"}`,
      `Email: ${input.requesterEmail ?? "Not provided"}`,
      `Request ID: ${id}`,
    ].join("\n"),
  }).catch((error) => app.log.warn({ err: error, demoRequestId: id }, "Could not notify super-admins about demo request"));
  return id;
}

async function updateDemoRequestForAccess(input: {
  demoRequestId: string;
  business: Business;
  sessionId: string;
  status?: "ready" | "sent" | "reset";
}): Promise<void> {
  if (!pool) return;
  const organizationId = await getBusinessOrganizationId(input.business);
  await pool.query(
    `update demo_requests
     set business_id = $2, organization_id = $3, latest_session_id = $4,
         status = case when $5 = 'reset' then 'ready' else $5 end, updated_at = now()
     where id = $1`,
    [input.demoRequestId, input.business.id, organizationId, input.sessionId, input.status ?? "ready"],
  );
}

async function getBusinessOrganizationId(business: Business): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ organization_id: string }>("select organization_id from businesses where id = $1", [business.id]);
  return result.rows[0]?.organization_id ?? null;
}

async function createDemoAccess(business: Business, options: DemoAccessOptions = {}): Promise<{ accessToken: string; expiresAt: string; sessionId: string | null; user: { email: string; name: string; role: string } }> {
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = options.expiresAt ?? new Date(Date.now() + DEMO_ACCESS_TTL_MS).toISOString();
  const email = options.email?.trim().toLowerCase() || `${business.slug}@demo.frontdeskwise.local`;
  const name = options.name?.trim() || `${business.name} Demo Owner`;
  let sessionId: string | null = null;

  if (!pool) {
    memoryDemoAccess.set(hashAccessToken(accessToken), { slug: business.slug, businessId: business.id, expiresAt });
  } else {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const userResult = await client.query<{ id: string }>(
        `insert into workspace_users (business_id, email, name, role, status)
         values ($1, $2, $3, 'owner', 'active')
         on conflict (business_id, email) do update set name = excluded.name, status = 'active', updated_at = now()
         returning id`,
        [business.id, email, name],
      );
      const sessionResult = await client.query<{ id: string }>(
        `insert into demo_access_sessions
           (business_id, user_id, token_hash, expires_at, demo_request_id, created_by_user_id, access_type, access_label)
         values ($1, $2, $3, $4, $5, $6, $7, $8)
         returning id`,
        [
          business.id,
          userResult.rows[0].id,
          hashAccessToken(accessToken),
          expiresAt,
          options.demoRequestId ?? null,
          options.createdByUserId ?? null,
          options.accessType ?? "public",
          options.accessLabel ?? null,
        ],
      );
      sessionId = sessionResult.rows[0].id;
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  if (options.demoRequestId && sessionId) {
    await updateDemoRequestForAccess({ demoRequestId: options.demoRequestId, business, sessionId, status: options.accessType === "admin" ? "sent" : "ready" });
  }
  await recordDemoAudit({
    demoRequestId: options.demoRequestId,
    sessionId,
    businessId: business.id,
    eventType: options.accessType === "admin" ? "sent" : "created",
    actorType: options.createdByUserId ? "admin" : "system",
    actorUserId: options.createdByUserId,
    actorEmail: options.email,
    metadata: { accessType: options.accessType ?? "public", accessLabel: options.accessLabel ?? null, expiresAt },
  });

  return { accessToken, expiresAt, sessionId, user: { email, name, role: "owner" } };
}

async function exchangeDemoAccess(token: string): Promise<{ slug: string; businessId: string; expiresAt: string; user: { email: string; name: string; role: string } }> {
  const tokenHash = hashAccessToken(token);
  if (!pool) {
    const session = memoryDemoAccess.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw httpError(401, "Demo access token is invalid or expired");
    return { ...session, user: { email: `${session.slug}@demo.frontdeskwise.local`, name: "Demo Owner", role: "owner" } };
  }

  const result = await pool.query<Record<string, unknown>>(
    `select s.id, s.business_id, s.demo_request_id, s.expires_at, b.slug, u.email, u.name, u.role
     from demo_access_sessions s
     join businesses b on b.id = s.business_id
     join workspace_users u on u.id = s.user_id
     where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now() and u.status = 'active'`,
    [tokenHash],
  );
  if (!result.rowCount) throw httpError(401, "Demo access token is invalid or expired");
  await pool.query(
    `update demo_access_sessions
     set first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now(), open_count = open_count + 1, updated_at = now()
     where token_hash = $1`,
    [tokenHash],
  );
  const row = result.rows[0];
  const sessionId = String(row.id);
  const demoRequestId = typeof row.demo_request_id === "string" ? row.demo_request_id : null;
  if (demoRequestId) {
    await pool.query(
      `update demo_requests
       set status = case when status in ('received', 'ready', 'sent') then 'opened' else status end,
           last_opened_at = now(), access_count = access_count + 1, updated_at = now()
       where id = $1`,
      [demoRequestId],
    );
  }
  await recordDemoAudit({
    demoRequestId,
    sessionId,
    businessId: String(row.business_id),
    eventType: "opened",
    actorType: "requester",
    actorEmail: String(row.email),
  });
  return {
    slug: String(row.slug),
    businessId: String(row.business_id),
    expiresAt: toIso(row.expires_at),
    user: { email: String(row.email), name: String(row.name), role: String(row.role) },
  };
}

function bearerToken(request: FastifyRequest): string | null {
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) return authorization.slice(7).trim() || null;
  const demoToken = request.headers["x-frontdeskwise-demo-token"];
  return typeof demoToken === "string" && demoToken.trim() ? demoToken.trim() : null;
}

async function requireDemoOwner(business: Business, request: FastifyRequest): Promise<string | null> {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "A demo owner access token is required");
  const tokenHash = hashAccessToken(token);

  if (!pool) {
    const session = memoryDemoAccess.get(tokenHash);
    if (!session || session.slug !== business.slug || session.businessId !== business.id || Date.parse(session.expiresAt) <= Date.now()) {
      throw httpError(401, "Demo owner access token is invalid or expired");
    }
    return null;
  }

  const demoResult = await pool.query(
    `select u.id
     from demo_access_sessions s
     join workspace_users u on u.id = s.user_id
     where s.token_hash = $1 and s.business_id = $2 and s.revoked_at is null
       and s.expires_at > now() and u.status = 'active' and u.role in ('owner', 'admin')`,
    [tokenHash, business.id],
  );
  if (demoResult.rowCount) return String(demoResult.rows[0].id);

  let authUser: FirebaseAuthUser;
  try {
    authUser = await requireFirebaseAuth(request);
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 503) {
      throw httpError(401, "Demo owner access token is invalid or expired");
    }
    throw error;
  }
  const result = await pool.query(
    `select u.id
     from app_users u
     join business_members bm on bm.user_id = u.id and bm.business_id = $2
     join businesses b on b.id = bm.business_id
     join organization_members om on om.organization_id = b.organization_id and om.user_id = u.id
     where u.identity_subject = $1 and u.status = 'active'
       and (bm.role = 'admin' or om.role in ('owner', 'admin'))`,
    [authUser.identitySubject, business.id],
  );
  if (!result.rowCount) throw httpError(403, "Your account does not have owner access to this business");
  return String(result.rows[0].id);
}

async function requireAuthenticatedBusinessOwner(business: Business, request: FastifyRequest): Promise<void> {
  if (!pool) throw httpError(503, "Authenticated business access requires PostgreSQL storage");
  const authUser = await requireFirebaseAuth(request);
  const result = await pool.query(
    `select 1
     from app_users u
     join business_members bm on bm.user_id = u.id and bm.business_id = $2
     join businesses b on b.id = bm.business_id
     join organization_members om on om.organization_id = b.organization_id and om.user_id = u.id
     where u.identity_subject = $1 and u.status = 'active'
       and (bm.role = 'admin' or om.role in ('owner', 'admin'))`,
    [authUser.identitySubject, business.id],
  );
  if (!result.rowCount) throw httpError(403, "Your account does not have owner access to this business");
}

const teamRoleRank: Record<TeamRole, number> = { viewer: 1, staff: 2, admin: 3, owner: 4 };

async function requireBusinessTeamAccess(
  business: Business,
  request: FastifyRequest,
  minimumRole: TeamRole = "viewer",
): Promise<{ id: string; email: string; name: string; role: TeamRole; organizationId: string | null; legacyDemo?: boolean }> {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "A team member access token is required");
  const tokenHash = hashAccessToken(token);

  if (!pool) {
    const session = memoryDemoAccess.get(tokenHash);
    if (!session || session.slug !== business.slug || session.businessId !== business.id || Date.parse(session.expiresAt) <= Date.now()) {
      throw httpError(401, "Team member access is invalid or expired");
    }
    if (teamRoleRank.owner < teamRoleRank[minimumRole]) throw httpError(403, "You do not have permission to access this business");
    return { id: "demo-owner", email: "owner@demo.frontdeskwise.local", name: "Demo Owner", role: "owner", organizationId: null, legacyDemo: true };
  }

  // Demo links are owner-scoped and remain useful for the internal seeded UI.
  const demoResult = await pool.query<Record<string, unknown>>(
    `select u.id, u.email, u.name, u.role, b.organization_id
     from demo_access_sessions s
     join workspace_users u on u.id = s.user_id
     join businesses b on b.id = s.business_id
     where s.token_hash = $1 and s.business_id = $2 and s.revoked_at is null
       and s.expires_at > now() and u.status = 'active' and u.role in ('owner', 'admin')`,
    [tokenHash, business.id],
  );
  if (demoResult.rowCount) {
    return {
      id: String(demoResult.rows[0].id),
      email: String(demoResult.rows[0].email),
      name: String(demoResult.rows[0].name),
      role: String(demoResult.rows[0].role ?? "owner") === "admin" ? "admin" : "owner",
      organizationId: typeof demoResult.rows[0].organization_id === "string" ? demoResult.rows[0].organization_id : null,
      legacyDemo: true,
    };
  }

  const authUser = await requireFirebaseAuth(request);
  const result = await pool.query<Record<string, unknown>>(
    `select u.id, u.email, u.name, b.organization_id,
            case when om.role = 'owner' then 'owner'
                 when om.role = 'admin' then 'admin'
                 else coalesce(bm.role, 'viewer') end as effective_role
     from app_users u
     join businesses b on b.id = $2
     left join organization_members om on om.organization_id = b.organization_id and om.user_id = u.id
     left join business_members bm on bm.business_id = b.id and bm.user_id = u.id
     where u.identity_subject = $1 and u.status = 'active'
       and (om.role in ('owner', 'admin') or bm.role in ('staff', 'viewer', 'admin'))
     limit 1`,
    [authUser.identitySubject, business.id],
  );
  if (!result.rowCount) throw httpError(403, "Your account does not have access to this business");
  const row = result.rows[0];
  const role = (row.effective_role === "owner" || row.effective_role === "admin" || row.effective_role === "staff") ? row.effective_role : "viewer";
  if (teamRoleRank[role] < teamRoleRank[minimumRole]) throw httpError(403, "Your team role does not allow this action");
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name ?? authUser.name),
    role,
    organizationId: typeof row.organization_id === "string" ? row.organization_id : null,
    legacyDemo: false,
  };
}

function requireWritableBusiness(business: Business): void {
  const access = billingAccess(business.billing);
  if (!access.allowed) throw httpError(402, "This workspace is read-only until billing is restored");
}

function normalizedAction(input: unknown, existing?: ActionFlow): ActionFlow {
  const body = asRecord(input);
  const template = typeof body.templateKey === "string" ? actionTemplate(body.templateKey.trim()) : null;
  const isNewOpenLinkAction = !existing && template?.key === "open_link";
  const base = existing ?? (template ? {
    ...template,
    ...(isNewOpenLinkAction ? {
      name: "Try the demo",
      completion: { ...template.completion, submitLabel: "Try the demo", linkLabel: "Try the demo" },
    } : {}),
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  } : null);
  if (!base) {
    const key = optionalString(body.key, 80);
    if (!key) throw httpError(400, "action key is required");
    const now = new Date().toISOString();
    return normalizedAction({
      ...body,
      name: body.name ?? key.replace(/[_-]+/g, " "),
      fields: Array.isArray(body.fields) ? body.fields : [],
      completion: asRecord(body.completion),
    }, {
      id: randomUUID(),
      key,
      actionType: "contact_team",
      name: key,
      description: "",
      triggerPhrases: [],
      triggerIntents: [],
      captureMode: "auto",
      fields: [],
      mode: "transactional",
      executionMode: "FORM_FLOW",
      attachmentPolicy: "explicit_request_only",
      trackingKey: key,
      destination: null,
      provider: null,
      priority: 500,
      requiredFields: [],
      conditions: [],
      safetyPolicy: "standard",
      sourceUrl: null,
      sourceType: "manual",
      sourceLabel: key,
      classificationReason: null,
      discoveredAt: null,
      origin: "configured",
      lifecycleStatus: "active",
      reviewReason: null,
      evidence: [],
      confidence: 0.5,
      completion: { createLead: true, leadStatus: "new", message: "Thanks — the team has your request.", notifyStaff: true, notifyChannels: ["in_app", "email"], notifyTargets: ["business_team"] },
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  }

  const allowedTypes = new Set(["text", "email", "phone", "select", "date", "number"]);
  const fieldsProvided = Array.isArray(body.fields);
  const sourceFields: unknown[] = fieldsProvided && Array.isArray(body.fields) ? body.fields : base.fields;
  const fields: ActionFlow["fields"] = sourceFields.map((value: unknown, index: number) => {
    const source = asRecord(value);
    const type = typeof source.type === "string" && allowedTypes.has(source.type) ? source.type : "text";
    const key = (optionalString(source.key, 80) ?? ("field_" + (index + 1))).replace(/[^a-zA-Z0-9_-]/g, "_");
    const options = Array.isArray(source.options)
      ? source.options.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 120)).slice(0, 30)
      : undefined;
    const conditionSource = asRecord(source.condition);
    const conditionField = optionalString(conditionSource.field, 80);
    const condition = conditionField ? {
      field: conditionField,
      ...(optionalString(conditionSource.equals, 120) ? { equals: optionalString(conditionSource.equals, 120) as string } : {}),
      ...(optionalString(conditionSource.notEquals, 120) ? { notEquals: optionalString(conditionSource.notEquals, 120) as string } : {}),
    } : undefined;
    return {
      id: optionalString(source.id, 120) ?? key,
      key,
      label: optionalString(source.label, 160) ?? key,
      type: type as ActionFlow["fields"][number]["type"],
      required: source.required !== false,
      visibility: source.visibility === "hidden" ? "hidden" as const : "visible" as const,
      question: optionalString(source.question, 500) ?? ("What is your " + key.replace(/[_-]+/g, " ") + "?"),
      ...(options?.length ? { options } : {}),
      ...(condition ? { condition } : {}),
    };
  });
  const allowedStepTypes = new Set([
    "ask", "capture", "form", "condition", "decision", "lookup", "recommend", "select", "confirm",
    "api_action", "create_lead", "book", "generate_link", "redirect", "notify", "handoff", "complete",
  ]);
  const sourceSteps = Array.isArray(body.steps) ? body.steps : (base.steps ?? []);
  const steps = sourceSteps.map((value, index) => {
    const source = asRecord(value);
    const type = typeof source.type === "string" && allowedStepTypes.has(source.type) ? source.type : "ask";
    const id = (optionalString(source.id, 120) ?? `step_${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, "_");
    const branches = Array.isArray(source.branches) ? source.branches.map((branchValue) => {
      const branch = asRecord(branchValue);
      const when = asRecord(branch.when);
      const field = optionalString(when.field, 120);
      const nextStepId = optionalString(branch.nextStepId, 120);
      return field && nextStepId ? {
        when: {
          field,
          ...(optionalString(when.equals, 160) ? { equals: optionalString(when.equals, 160) as string } : {}),
          ...(optionalString(when.notEquals, 160) ? { notEquals: optionalString(when.notEquals, 160) as string } : {}),
        },
        nextStepId,
      } : null;
    }).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 20) : undefined;
    const configSource = asRecord(source.config);
    const config: Record<string, unknown> = {};
    for (const [key, configValue] of Object.entries(configSource).slice(0, 30)) {
      if (!/^[a-zA-Z0-9_.-]{1,120}$/.test(key)) continue;
      if (typeof configValue === "string" || typeof configValue === "number" || typeof configValue === "boolean") config[key] = typeof configValue === "string" ? configValue.slice(0, 2_000) : configValue;
      else if (Array.isArray(configValue)) config[key] = configValue.filter((item) => typeof item === "string").slice(0, 50);
    }
    return {
      id,
      type: type as NonNullable<ActionFlow["steps"]>[number]["type"],
      ...(optionalString(source.label, 160) ? { label: optionalString(source.label, 160) as string } : {}),
      ...(optionalString(source.fieldKey, 120) ? { fieldKey: optionalString(source.fieldKey, 120) as string } : {}),
      ...(optionalString(source.question, 500) ? { question: optionalString(source.question, 500) as string } : {}),
      ...(typeof source.required === "boolean" ? { required: source.required } : {}),
      ...(Array.isArray(source.options) ? { options: source.options.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 120)).slice(0, 30) } : {}),
      ...(optionalString(source.nextStepId, 120) ? { nextStepId: optionalString(source.nextStepId, 120) as string } : {}),
      ...(branches?.length ? { branches } : {}),
      ...(Object.keys(config).length ? { config } : {}),
    };
  });
  const sourceCompletion = asRecord(body.completion);
  const workflowSource = asRecord(sourceCompletion.workflow);
  const workflowName = optionalString(workflowSource.name, 160);
  const workflow = workflowName
    ? { name: workflowName, actionId: existing?.id ?? base.id }
    : base.completion.workflow;
  const leadStatus = sourceCompletion.leadStatus === "qualified" || sourceCompletion.leadStatus === "booked" ? sourceCompletion.leadStatus : base.completion.leadStatus;
  const submitLabel = optionalString(sourceCompletion.submitLabel, 160) ?? base.completion.submitLabel;
  const linkUrl = optionalString(sourceCompletion.linkUrl, 2_000) ?? base.completion.linkUrl;
  const linkLabel = optionalString(sourceCompletion.linkLabel, 160) ?? base.completion.linkLabel;
  const connector = actionConnectorFromValue(sourceCompletion.connector) ?? base.completion.connector;
  const hasCompletionMode = Object.prototype.hasOwnProperty.call(sourceCompletion, "completionMode");
  const completionMode = ["external_provider", "native_form", "booking_connector", "payment_link", "api_webhook", "human_follow_up"].includes(String(sourceCompletion.completionMode))
    ? sourceCompletion.completionMode as ActionFlow["completion"]["completionMode"]
    : hasCompletionMode ? undefined : base.completion.completionMode;
  const linkTemplateSource = asRecord(sourceCompletion.linkTemplate);
  const linkMappings = asRecord(linkTemplateSource.fieldMappings);
  const linkTemplate = typeof linkTemplateSource.baseUrl === "string"
    ? {
      baseUrl: linkTemplateSource.baseUrl.slice(0, 2_000),
      fieldMappings: Object.fromEntries(Object.entries(linkMappings).filter(([key, value]) => /^[a-zA-Z0-9_.-]{1,120}$/.test(key) && typeof value === "string").slice(0, 50)) as Record<string, string>,
      ...(Object.keys(asRecord(linkTemplateSource.staticParams)).length ? { staticParams: Object.fromEntries(Object.entries(asRecord(linkTemplateSource.staticParams)).filter(([key, value]) => /^[a-zA-Z0-9_.-]{1,120}$/.test(key) && typeof value === "string").slice(0, 50)) as Record<string, string> } : {}),
    }
    : base.completion.linkTemplate;
  const actionType = BUSINESS_ACTION_TYPES.includes(String(body.actionType ?? base.actionType) as BusinessActionType)
    ? String(body.actionType ?? base.actionType) as BusinessActionType
    : (base.actionType ?? "contact_team");
  const destinationSource = body.destination === null ? null : asRecord(body.destination ?? base.destination);
  const destination = destinationSource && typeof destinationSource.url === "string"
    ? { url: destinationSource.url.slice(0, 2_000), ...(typeof destinationSource.label === "string" ? { label: destinationSource.label.slice(0, 160) } : {}) }
    : (base.destination ?? null);
  const conditions = Array.isArray(body.conditions) ? body.conditions.map((item) => {
    const condition = asRecord(item);
    const field = optionalString(condition.field, 120);
    return field ? {
      field,
      ...(optionalString(condition.contains, 240) ? { contains: optionalString(condition.contains, 240) as string } : {}),
      ...(optionalString(condition.equals, 240) ? { equals: optionalString(condition.equals, 240) as string } : {}),
    } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 30) : (base.conditions ?? []);
  const evidence = Array.isArray(body.evidence) ? body.evidence.map((item) => {
    const source = asRecord(item);
    const sourceUrl = optionalString(source.sourceUrl, 2_000);
    const quote = optionalString(source.quote, 500);
    const confidence = Number(source.confidence);
    return sourceUrl && quote ? { sourceUrl, quote, confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5 } : null;
  }).filter((item): item is NonNullable<typeof item> => Boolean(item)).slice(0, 20) : (base.evidence ?? []);
  const confidenceValue = Number(body.confidence ?? base.confidence ?? 0.5);
  const now = new Date().toISOString();
  const origin = base.origin ?? "configured";
  const enabled = typeof body.enabled === "boolean" ? body.enabled : base.enabled;
  const lifecycleStatus = origin === "discovered"
    ? (base.lifecycleStatus ?? (enabled ? "needs_review" : "disabled"))
    : (enabled ? "active" : "disabled");
  const requiredFields = fieldsProvided
    ? fields.filter((field) => field.required && field.visibility !== "hidden").map((field) => field.key)
    : (Array.isArray(body.requiredFields)
      ? body.requiredFields.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 120)).slice(0, 50)
      : (base.requiredFields ?? fields.map((field) => field.key)));
  const optionalFields = fieldsProvided
    ? fields.filter((field) => !field.required && field.visibility !== "hidden").map((field) => field.key)
    : (base.optionalFields ?? fields.filter((field) => !field.required && field.visibility !== "hidden").map((field) => field.key));
  const completion = {
    createLead: typeof sourceCompletion.createLead === "boolean" ? sourceCompletion.createLead : base.completion.createLead,
    leadStatus,
    message: optionalString(sourceCompletion.message, 1_000) ?? base.completion.message,
    ...(workflow ? { workflow } : {}),
    ...(completionMode ? { completionMode } : {}),
    ...(linkTemplate ? { linkTemplate } : {}),
    ...(submitLabel ? { submitLabel } : {}),
    ...(linkUrl ? { linkUrl } : {}),
    ...(linkLabel ? { linkLabel } : {}),
    notifyStaff: typeof sourceCompletion.notifyStaff === "boolean" ? sourceCompletion.notifyStaff : base.completion.notifyStaff,
    requiresStaff: typeof sourceCompletion.requiresStaff === "boolean" ? sourceCompletion.requiresStaff : base.completion.requiresStaff,
    notifyChannels: Array.isArray(sourceCompletion.notifyChannels) ? sourceCompletion.notifyChannels.filter((item): item is "in_app" | "email" => item === "in_app" || item === "email") : base.completion.notifyChannels,
    notifyTargets: Array.isArray(sourceCompletion.notifyTargets) ? sourceCompletion.notifyTargets.filter((item): item is "owner" | "business_team" | "assigned_staff" => item === "owner" || item === "business_team" || item === "assigned_staff") : base.completion.notifyTargets,
    ...(connector ? { connector } : {}),
  };
  return {
    id: existing?.id ?? base.id,
    key: (optionalString(body.key, 80) ?? base.key).replace(/[^a-zA-Z0-9_-]/g, "_"),
    actionType,
    businessId: base.businessId,
    name: optionalString(body.name, 160) ?? base.name,
    description: optionalString(body.description, 1_000) ?? base.description,
    triggerPhrases: (Array.isArray(body.triggerPhrases) ? body.triggerPhrases : base.triggerPhrases)
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 200)).slice(0, 30),
    triggerIntents: (Array.isArray(body.triggerIntents) ? body.triggerIntents : base.triggerIntents)
      .filter((item): item is string => typeof item === "string" && Boolean(item.trim())).map((item) => item.trim().slice(0, 100)).slice(0, 20),
    captureMode: body.captureMode === "conversational" || body.captureMode === "form" || body.captureMode === "hybrid"
      ? body.captureMode
      : base.captureMode,
    fields,
    ...(steps.length ? { steps } : {}),
    completion,
    mode: "transactional",
    executionMode: ["DIRECT_LINK", "FORM_FLOW", "PROVIDER_FLOW", "PHONE", "EMAIL", "HANDOFF", "API_ACTION"].includes(String(body.executionMode))
      ? String(body.executionMode) as ActionExecutionMode
      : (base.executionMode ?? (destination?.url || completion.linkUrl ? "DIRECT_LINK" : completion.connector ? "API_ACTION" : completion.completionMode === "external_provider" || completion.completionMode === "booking_connector" ? "PROVIDER_FLOW" : "FORM_FLOW")),
    attachmentPolicy: ["always", "sales_intent", "high_intent_only", "explicit_request_only", "never_auto"].includes(String(body.attachmentPolicy))
      ? String(body.attachmentPolicy) as ActionAttachmentPolicy
      : (base.attachmentPolicy ?? (actionType === "call_emergency" || ["request_demo", "contact_team"].includes(String(body.key ?? base.key)) ? "explicit_request_only" : "sales_intent")),
    trackingKey: optionalString(body.trackingKey, 120) ?? base.trackingKey ?? (optionalString(body.key, 80) ?? base.key),
    destination,
    provider: optionalString(body.provider, 160)
      ?? (base.provider ?? (actionType === "enroll" && (optionalString(body.key, 80) ?? base.key) === "enroll_child" ? "jackrabbit" : null)),
    priority: Number.isFinite(Number(body.priority ?? base.priority)) ? Math.max(0, Math.min(10_000, Number(body.priority ?? base.priority))) : (base.priority ?? 500),
    requiredFields,
    optionalFields,
    handoffBehavior: completion.requiresStaff
      ? { mode: "require_staff", reason: `Action requires staff: ${base.name}` }
      : completion.notifyStaff ? { mode: "notify_staff" } : { mode: "none" },
    conditions,
    safetyPolicy: body.safetyPolicy === "verified_contact" || body.safetyPolicy === "healthcare_emergency" || body.safetyPolicy === "manual_review" ? body.safetyPolicy : (base.safetyPolicy ?? "standard"),
    sourceUrl: optionalString(body.sourceUrl, 2_000) ?? (base.sourceUrl ?? null),
    sourceType: body.sourceType === "website" || body.sourceType === "manual" || body.sourceType === "document" || body.sourceType === "integration" || body.sourceType === "system" ? body.sourceType as ActionSourceType : (base.sourceType ?? (origin === "discovered" ? "website" : "manual")),
    sourceLabel: optionalString(body.sourceLabel, 240) ?? (base.sourceLabel ?? null),
    classificationReason: optionalString(body.classificationReason, 1_000) ?? (base.classificationReason ?? null),
    discoveredAt: optionalString(body.discoveredAt, 80) ?? (base.discoveredAt ?? null),
    origin,
    lifecycleStatus,
    reviewReason: body.reviewReason === "low_confidence" || body.reviewReason === "unsafe_destination" || body.reviewReason === "duplicate_action" || body.reviewReason === "owner_override" || body.reviewReason === "source_removed" ? body.reviewReason : (base.reviewReason ?? null),
    evidence,
    confidence: Number.isFinite(confidenceValue) ? Math.max(0, Math.min(1, confidenceValue)) : (base.confidence ?? 0.5),
    enabled,
    version: existing ? Math.max(1, (existing.version ?? 1) + 1) : Math.max(1, base.version ?? 1),
    createdAt: existing?.createdAt ?? base.createdAt,
    updatedAt: now,
  };
}

function normalizedActionResource(input: unknown, businessId: string, existing?: ActionResource): ActionResource {
  const body = asRecord(input);
  const source = existing ? { ...existing, ...body } : body;
  const destination = body.destination ?? body.url ?? (existing?.destination ?? null);
  const typeValue = body.type ?? existing?.type;
  const nameValue = body.name ?? existing?.name;
  if (typeof typeValue !== "string" || !(ACTION_RESOURCE_TYPES as readonly string[]).includes(typeValue)) {
    throw httpError(400, "Unsupported action resource type");
  }
  if (typeof nameValue !== "string" || !nameValue.trim()) throw httpError(400, "Action resource name is required");
  try {
    return normalizeActionResource({
      ...(source as Partial<ActionResource>),
      businessId,
      type: typeValue as ActionResourceType,
      name: nameValue,
      destination,
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString(),
    } as ActionResourceInput);
  } catch (error) {
    throw httpError(400, error instanceof Error ? error.message : "Invalid action resource");
  }
}

function normalizedBusinessFact(input: unknown, businessId: string, existing?: BusinessFact): BusinessFact {
  const body = asRecord(input);
  const source = existing ? { ...existing, ...body } : body;
  const kind = body.kind ?? existing?.kind;
  if (typeof kind !== "string" || !(BUSINESS_FACT_KINDS as readonly string[]).includes(kind)) {
    throw httpError(400, "Unsupported business fact kind");
  }
  const sourceType = body.sourceType ?? existing?.sourceType ?? "owner_structured";
  if (sourceType !== "owner_structured" && sourceType !== "owner_knowledge") {
    throw httpError(400, "Owner-authored business facts must use owner_structured or owner_knowledge source type");
  }
  const authority = sourceType === "owner_structured" ? "owner_verified" : "owner_knowledge";
  try {
    return normalizeBusinessFact({
      ...(source as Partial<BusinessFact>),
      businessId,
      kind: kind as BusinessFactKind,
      sourceType: sourceType as BusinessFactSourceType,
      authority,
      id: existing?.id ?? (typeof body.id === "string" ? body.id : randomUUID()),
      createdAt: existing?.createdAt,
      updatedAt: new Date().toISOString(),
    } as BusinessFactInput);
  } catch (error) {
    throw httpError(400, error instanceof Error ? error.message : "Invalid business fact");
  }
}

async function persistAction(business: Business, action: ActionFlow): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into business_actions
       (id, business_id, action_key, action_type, name, description, trigger_phrases, trigger_intents, capture_mode, fields, steps, completion, mode, execution_mode, attachment_policy, tracking_key, destination, provider, priority, required_fields, optional_fields, handoff_behavior, version, conditions, safety_policy, source_url, source_type, source_label, classification_reason, discovered_at, origin, lifecycle_status, review_reason, evidence, confidence, enabled, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37, $38)
     on conflict (business_id, action_key) do update set
       action_type = excluded.action_type,
       name = excluded.name,
       description = excluded.description,
       trigger_phrases = excluded.trigger_phrases,
       trigger_intents = excluded.trigger_intents,
       capture_mode = excluded.capture_mode,
       fields = excluded.fields,
       steps = excluded.steps,
       completion = excluded.completion,
       mode = excluded.mode,
       execution_mode = excluded.execution_mode,
       attachment_policy = excluded.attachment_policy,
       tracking_key = excluded.tracking_key,
       destination = excluded.destination,
       provider = excluded.provider,
       priority = excluded.priority,
       required_fields = excluded.required_fields,
       optional_fields = excluded.optional_fields,
       handoff_behavior = excluded.handoff_behavior,
       version = excluded.version,
       conditions = excluded.conditions,
       safety_policy = excluded.safety_policy,
       source_url = excluded.source_url,
       source_type = excluded.source_type,
       source_label = excluded.source_label,
       classification_reason = excluded.classification_reason,
       discovered_at = excluded.discovered_at,
       origin = excluded.origin,
       lifecycle_status = excluded.lifecycle_status,
       review_reason = excluded.review_reason,
       evidence = excluded.evidence,
       confidence = excluded.confidence,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`,
    [
      action.id,
      business.id,
      action.key,
      action.actionType,
      action.name,
      action.description,
      JSON.stringify(action.triggerPhrases),
      JSON.stringify(action.triggerIntents),
      action.captureMode,
      JSON.stringify(action.fields),
      JSON.stringify(action.steps ?? []),
      JSON.stringify(action.completion),
      action.mode,
      action.executionMode ?? "FORM_FLOW",
      action.attachmentPolicy ?? "explicit_request_only",
      action.trackingKey ?? action.key,
      action.destination ? JSON.stringify(action.destination) : null,
      action.provider,
      action.priority,
      JSON.stringify(action.requiredFields),
      JSON.stringify(action.optionalFields ?? action.fields.filter((field) => !field.required).map((field) => field.key)),
      JSON.stringify(action.handoffBehavior ?? { mode: "none" }),
      action.version ?? 1,
      JSON.stringify(action.conditions),
      action.safetyPolicy,
      action.sourceUrl,
      action.sourceType ?? null,
      action.sourceLabel ?? null,
      action.classificationReason ?? null,
      action.discoveredAt ?? null,
      action.origin ?? "configured",
      action.lifecycleStatus ?? (action.enabled ? "active" : "disabled"),
      action.reviewReason ?? null,
      JSON.stringify(action.evidence),
      action.confidence,
      action.enabled,
      action.createdAt,
      action.updatedAt,
    ],
  );
}

async function persistActionSubmission(
  business: Business,
  action: ActionFlow,
  conversation: Conversation,
  values: Record<string, string>,
  sourcePage: string | null,
): Promise<ActionSubmission> {
  const idempotencyKey = `action.submission:${conversation.id}:${action.id}`;
  const existing = business.actionSubmissions.find((item) => item.idempotencyKey === idempotencyKey);
  if (existing) return existing;
  const now = new Date().toISOString();
  const submission: ActionSubmission = {
    id: randomUUID(),
    businessId: business.id,
    actionId: action.id,
    conversationId: conversation.id,
    idempotencyKey,
    values: { ...values },
    sourcePage,
    status: "received",
    leadId: null,
    createdAt: now,
    updatedAt: now,
  };
  // The in-memory record is intentionally written before any connector or lead
  // work. It gives retries a stable local submission even during a DB outage.
  business.actionSubmissions.unshift(submission);
  if (!pool) return submission;
  try {
    const inserted = await pool.query<Record<string, unknown>>(
      `insert into action_submissions
         (id, business_id, action_id, conversation_id, idempotency_key, values, source_page, status, lead_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       on conflict (business_id, idempotency_key) do nothing
       returning *`,
      [submission.id, business.id, action.id, conversation.id, idempotencyKey, JSON.stringify(values), sourcePage, submission.status, null, now, now],
    );
    if (!inserted.rowCount) {
      const existingResult = await pool.query<Record<string, unknown>>(
        "select * from action_submissions where business_id = $1 and idempotency_key = $2 limit 1",
        [business.id, idempotencyKey],
      );
      if (existingResult.rowCount) {
        const persisted = actionSubmissionFromRow(existingResult.rows[0]);
        business.actionSubmissions = business.actionSubmissions.filter((item) => item.idempotencyKey !== idempotencyKey);
        business.actionSubmissions.unshift(persisted);
        return persisted;
      }
    } else {
      const persisted = actionSubmissionFromRow(inserted.rows[0]);
      business.actionSubmissions[0] = persisted;
      return persisted;
    }
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: business.id }, "Action submissions table is not available; retained submission in memory");
  }
  return submission;
}

async function updateActionSubmission(
  business: Business,
  submission: ActionSubmission,
  patch: { status?: ActionSubmission["status"]; leadId?: string | null },
): Promise<void> {
  Object.assign(submission, patch, { updatedAt: new Date().toISOString() });
  if (!pool) return;
  try {
    await pool.query(
      `update action_submissions
       set status = $3, lead_id = $4, updated_at = $5
       where business_id = $1 and id = $2`,
      [business.id, submission.id, submission.status, submission.leadId, submission.updatedAt],
    );
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: business.id }, "Action submissions table is not available; retained update in memory");
  }
}

async function persistActionResource(business: Business, resource: ActionResource): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into business_action_resources
       (id, business_id, resource_type, name, provider, provider_object_id, location, program, day,
        start_time, end_time, role, department, service, price, availability, metadata, conditions,
        destination, status, valid_from, valid_until, source, last_synced_at, version, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
             $20, $21, $22, $23, $24, $25, $26, $27)
     on conflict (id) do update set
       resource_type = excluded.resource_type,
       name = excluded.name,
       provider = excluded.provider,
       provider_object_id = excluded.provider_object_id,
       location = excluded.location,
       program = excluded.program,
       day = excluded.day,
       start_time = excluded.start_time,
       end_time = excluded.end_time,
       role = excluded.role,
       department = excluded.department,
       service = excluded.service,
       price = excluded.price,
       availability = excluded.availability,
       metadata = excluded.metadata,
       conditions = excluded.conditions,
       destination = excluded.destination,
       status = excluded.status,
       valid_from = excluded.valid_from,
       valid_until = excluded.valid_until,
       source = excluded.source,
       last_synced_at = excluded.last_synced_at,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [
      resource.id,
      business.id,
      resource.type,
      resource.name,
      resource.provider,
      resource.providerObjectId,
      resource.location,
      resource.program,
      resource.day,
      resource.startTime,
      resource.endTime,
      resource.role,
      resource.department,
      resource.service,
      resource.price === null ? null : String(resource.price),
      resource.availability,
      JSON.stringify(resource.metadata),
      JSON.stringify(resource.conditions),
      resource.destination ? JSON.stringify(resource.destination) : null,
      resource.status,
      resource.validFrom,
      resource.validUntil,
      resource.source,
      resource.lastSyncedAt,
      resource.version,
      resource.createdAt,
      resource.updatedAt,
    ],
  );
}

async function persistBusinessFact(business: Business, fact: BusinessFact): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into business_facts
       (id, business_id, kind, subject, predicate, value, value_text, source_type, authority, source_id, source_label,
        confidence, freshness_policy, observed_at, expires_at, active, version, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
     on conflict (id) do update set
       kind = excluded.kind,
       subject = excluded.subject,
       predicate = excluded.predicate,
       value = excluded.value,
       value_text = excluded.value_text,
       source_type = excluded.source_type,
       authority = excluded.authority,
       source_id = excluded.source_id,
       source_label = excluded.source_label,
       confidence = excluded.confidence,
       freshness_policy = excluded.freshness_policy,
       observed_at = excluded.observed_at,
       expires_at = excluded.expires_at,
       active = excluded.active,
       version = excluded.version,
       updated_at = excluded.updated_at`,
    [
      fact.id,
      business.id,
      fact.kind,
      fact.subject,
      fact.predicate,
      JSON.stringify(fact.value),
      fact.valueText,
      fact.sourceType,
      fact.authority,
      fact.sourceId,
      fact.sourceLabel,
      fact.confidence,
      fact.freshnessPolicy,
      fact.observedAt,
      fact.expiresAt,
      fact.active,
      fact.version,
      fact.createdAt,
      fact.updatedAt,
    ],
  );
}

async function persistBusinessContextSnapshot(business: Business, snapshot: BusinessContextSnapshot, model: ReturnType<typeof buildCanonicalBusinessModel>): Promise<void> {
  business.businessContextSnapshot = snapshot;
  if (!pool) return;
  try {
    await pool.query(
      `insert into business_context_snapshots
         (business_id, version, material_fingerprint, summary, model, generated_at, status, updated_at)
       values ($1, $2, $3, $4, $5::jsonb, $6, $7, now())
       on conflict (business_id) do update set
         version = excluded.version,
         material_fingerprint = excluded.material_fingerprint,
         summary = excluded.summary,
         model = excluded.model,
         generated_at = excluded.generated_at,
         status = excluded.status,
         updated_at = now()`,
      [business.id, snapshot.version, snapshot.materialFingerprint, snapshot.summary, JSON.stringify(model), snapshot.generatedAt, snapshot.status],
    );
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: business.id }, "Business context snapshot persistence deferred until the latest schema is available");
  }
}

function requireVerifiedBusiness(business: Business): void {
  if (business.billing.isDemo && business.billing.mode === "sandbox") return;
  if (business.ownershipStatus !== "verified") {
    throw httpError(403, "Verify ownership of this business before publishing the live widget or collecting production leads");
  }
}

function verificationHostname(business: Business): string {
  return new URL(business.websiteUrl).hostname.replace(/^www\./i, "").toLowerCase();
}

function verificationInstructions(method: OwnershipVerificationMethod, hostname: string, token: string): string {
  if (method === "meta_tag") return `Add <meta name="frontdeskwise-verification" content="${token}"> inside the public homepage <head>, then click Verify.`;
  if (method === "file") return `Publish this exact file at https://${hostname}/.well-known/frontdeskwise-verification.txt with this single line: ${token}`;
  if (method === "dns_txt") return `Create a DNS TXT record for ${hostname} with this value: frontdeskwise-verification=${token}`;
  if (method === "email") return `Sign in with a verified business email whose domain matches ${hostname}.`;
  return "A FrontDeskWise super-admin will review this ownership request manually.";
}

async function fetchVerificationPage(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: "follow", headers: { accept: "text/html,text/plain" } });
    if (!response.ok) throw new Error(`Verification fetch returned ${response.status}`);
    return (await response.text()).slice(0, 2_000_000);
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyBusinessOwnership(business: Business, method: OwnershipVerificationMethod, token: string, authUser: FirebaseAuthUser): Promise<boolean> {
  if (method === "email") {
    return authUser.email.split("@").pop()?.toLowerCase() === verificationHostname(business);
  }
  if (method === "meta_tag") {
    const html = await fetchVerificationPage(business.websiteUrl);
    return new RegExp(`<meta[^>]+name=["']frontdeskwise-verification["'][^>]+content=["']${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])`, "i").test(html)
      || new RegExp(`<meta[^>]+content=["']${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(["'])[^>]+name=["']frontdeskwise-verification["']`, "i").test(html);
  }
  if (method === "file") {
    const origin = new URL(business.websiteUrl).origin;
    const content = await fetchVerificationPage(`${origin}/.well-known/frontdeskwise-verification.txt`);
    return content.trim() === token;
  }
  if (method === "dns_txt") {
    const records = await resolveTxt(verificationHostname(business));
    return records.flat().some((record) => record.trim() === `frontdeskwise-verification=${token}`);
  }
  return false;
}

function ownershipPayload(business: Business): Record<string, unknown> {
  return {
    status: business.ownershipStatus,
    method: business.ownershipVerificationMethod,
    verifiedAt: business.ownershipVerifiedAt,
    hostname: verificationHostname(business),
  };
}

function billingAccess(billing: BillingState): { allowed: boolean; reason: string } {
  if (billing.isDemo && billing.mode === "sandbox") return { allowed: true, reason: "demo" };
  if (billing.status === "active") return { allowed: true, reason: "active_subscription" };
  if (billing.status === "trial" && (!billing.trialEndsAt || Date.parse(billing.trialEndsAt) > Date.now())) return { allowed: true, reason: "trial" };
  if (billing.status === "grace" && (!billing.graceEndsAt || Date.parse(billing.graceEndsAt) > Date.now())) return { allowed: true, reason: "billing_grace" };
  return { allowed: false, reason: billing.status };
}

function billingReturnUrl(kind: "success" | "cancel" | "portal"): string {
  const configured = kind === "success"
    ? process.env.FRONTDESKWISE_STRIPE_SUCCESS_URL
    : kind === "cancel"
      ? process.env.FRONTDESKWISE_STRIPE_CANCEL_URL
      : process.env.FRONTDESKWISE_STRIPE_PORTAL_RETURN_URL;
  if (configured?.trim()) {
    const value = configured.trim();
    return kind === "success" && !value.includes("CHECKOUT_SESSION_ID")
      ? `${value}${value.includes("?") ? "&" : "?"}session_id={CHECKOUT_SESSION_ID}`
      : value;
  }
  const origin = (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  return kind === "success" ? `${origin}/app/settings/billing/success?session_id={CHECKOUT_SESSION_ID}` : `${origin}/app/settings/billing?billing=${kind}`;
}

function requireStripe(): Stripe {
  if (!stripe) throw httpError(503, "Stripe billing is not configured on this environment");
  return stripe;
}

function frontDeskWiseStripeMetadata(
  organizationId: string,
  planKey?: string,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    app: stripeAppMetadata,
    billing_model: "subscription",
    organization_id: organizationId,
    organizationId,
    ...(planKey ? { plan_key: planKey, planKey } : {}),
    ...extra,
  };
}

function stripeMetadataString(metadata: Record<string, unknown>, snakeCaseKey: string, camelCaseKey?: string): string {
  const snakeCaseValue = metadata[snakeCaseKey];
  if (typeof snakeCaseValue === "string" && snakeCaseValue.trim()) return snakeCaseValue;
  const camelCaseValue = camelCaseKey ? metadata[camelCaseKey] : undefined;
  return typeof camelCaseValue === "string" && camelCaseValue.trim() ? camelCaseValue : "";
}

function stripeObjectId(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") return String((value as { id: string }).id);
  return null;
}

function stripeTimestamp(value: unknown): string | null {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1_000).toISOString() : null;
}

function stripeBillingStatus(status: string): { status: BillingStatus; graceEndAt: string | null } {
  if (status === "active") return { status: "active", graceEndAt: null };
  if (status === "trialing") return { status: "trial", graceEndAt: null };
  if (status === "past_due" || status === "incomplete") {
    return { status: "grace", graceEndAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString() };
  }
  if (status === "paused" || status === "unpaid") return { status: "paused", graceEndAt: null };
  if (status === "canceled" || status === "incomplete_expired") return { status: "cancelled", graceEndAt: null };
  return { status: "grace", graceEndAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString() };
}

async function syncOrganizationBillingToBusinesses(client: PoolClient, organizationId: string): Promise<void> {
  await client.query(
    `update businesses b
     set billing_mode = o.billing_mode,
         billing_status = o.billing_status,
         plan_key = o.plan_key,
         billing_interval = o.billing_interval,
         trial_ends_at = o.trial_end_at,
         current_period_ends_at = o.current_period_end_at,
         grace_ends_at = o.grace_end_at,
         billing_provider = o.billing_provider,
         provider_customer_id = o.stripe_customer_id,
         provider_subscription_id = o.stripe_subscription_id,
         updated_at = now()
     from organizations o
     where b.organization_id = o.id and o.id = $1`,
    [organizationId],
  );
}

async function syncStripePlanPrices(): Promise<void> {
  if (!pool) return;
  const plans = ["starter", "growth", "multi_business", "portfolio"] as const;
  for (const planKey of plans) {
    const envPrefix = planKey.toUpperCase();
    const monthly = process.env[`STRIPE_PRICE_${envPrefix}_MONTHLY`]?.trim();
    const yearly = process.env[`STRIPE_PRICE_${envPrefix}_YEARLY`]?.trim();
    if (!monthly && !yearly) continue;
    await pool.query(
      `update billing_plans
       set stripe_monthly_price_id = coalesce($2, stripe_monthly_price_id),
           stripe_yearly_price_id = coalesce($3, stripe_yearly_price_id),
           updated_at = now()
       where plan_key = $1`,
      [planKey, monthly || null, yearly || null],
    );
  }
}

async function billingSnapshotForUser(userId: string, organizationId: string | null): Promise<Record<string, unknown>> {
  const organization = await organizationForUser(userId, organizationId);
  if (!pool) throw httpError(503, "Billing requires PostgreSQL storage");
  const [plans, usage] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `select bp.plan_key, bp.display_name, bp.description, bp.monthly_amount_cents,
              bp.currency, bp.max_businesses, bp.stripe_monthly_price_id, bp.stripe_yearly_price_id,
              coalesce(opo.amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
              coalesce(opo.max_businesses, bp.max_businesses) as effective_max_businesses,
              coalesce((select jsonb_object_agg(e.entitlement_key, e.entitlement_value)
                        from billing_plan_entitlements e where e.plan_key = bp.plan_key), '{}'::jsonb) as entitlements
       from billing_plans bp
       left join organization_plan_overrides opo
         on opo.organization_id = $1 and opo.plan_key = bp.plan_key and (opo.ends_at is null or opo.ends_at > now())
       where bp.public = true and bp.active = true
       order by bp.monthly_amount_cents`,
      [organization.id],
    ),
    pool.query<Record<string, unknown>>(
      `select coalesce(sum(conversations), 0)::integer as conversations,
              coalesce(sum(leads), 0)::integer as leads,
              coalesce(sum(bookings), 0)::integer as bookings,
              coalesce(sum(llm_requests), 0)::integer as llm_requests,
              coalesce(sum(llm_input_tokens), 0)::bigint as llm_input_tokens,
              coalesce(sum(llm_output_tokens), 0)::bigint as llm_output_tokens,
              coalesce(sum(llm_estimated_cost_usd), 0)::numeric as llm_estimated_cost_usd
       from organization_usage_daily
       where organization_id = $1 and usage_date >= current_date - 30`,
      [organization.id],
    ).catch(async (error) => {
      if (!isMissingDatabaseColumn(error)) throw error;
      // Migration 018 adds the cost column. Keep billing readable during a
      // rolling deploy where the API is ahead of the database migration.
      return pool.query<Record<string, unknown>>(
        `select coalesce(sum(conversations), 0)::integer as conversations,
                coalesce(sum(leads), 0)::integer as leads,
                coalesce(sum(bookings), 0)::integer as bookings,
                coalesce(sum(llm_requests), 0)::integer as llm_requests,
                coalesce(sum(llm_input_tokens), 0)::bigint as llm_input_tokens,
                coalesce(sum(llm_output_tokens), 0)::bigint as llm_output_tokens
         from organization_usage_daily
         where organization_id = $1 and usage_date >= current_date - 30`,
        [organization.id],
      );
    }),
  ]);
  return {
    organization: { id: String(organization.id), name: String(organization.name), slug: String(organization.slug), role: String(organization.role) },
    billing: organizationBillingPayload(organization),
    plans: plans.rows.map((plan) => ({
      key: String(plan.plan_key),
      displayName: String(plan.display_name),
      description: String(plan.description),
      amountCents: plan.effective_amount_cents === null ? null : Number(plan.effective_amount_cents),
      currency: String(plan.currency),
      maxBusinesses: Number(plan.effective_max_businesses ?? plan.max_businesses ?? 1),
      entitlements: plan.entitlements && typeof plan.entitlements === "object" ? plan.entitlements : {},
      checkoutReady: Boolean(plan.stripe_monthly_price_id || plan.stripe_yearly_price_id),
    })),
    usageLast30Days: {
      conversations: Number(usage.rows[0]?.conversations ?? 0),
      leads: Number(usage.rows[0]?.leads ?? 0),
      bookings: Number(usage.rows[0]?.bookings ?? 0),
      llmRequests: Number(usage.rows[0]?.llm_requests ?? 0),
      llmInputTokens: Number(usage.rows[0]?.llm_input_tokens ?? 0),
      llmOutputTokens: Number(usage.rows[0]?.llm_output_tokens ?? 0),
      llmEstimatedCostUsd: Number(usage.rows[0]?.llm_estimated_cost_usd ?? 0),
    },
    stripeConfigured: Boolean(stripe),
  };
}

async function resolveStripePrice(organizationId: string, planKey: string, interval: "month" | "year"): Promise<{ priceId: string; amountCents: number | null; currency: string }> {
  if (!pool) throw httpError(503, "Billing requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select bp.monthly_amount_cents, bp.currency, bp.stripe_monthly_price_id, bp.stripe_yearly_price_id,
            opo.stripe_price_id as override_price_id, opo.amount_cents as override_amount_cents,
            opo.currency as override_currency
     from billing_plans bp
     left join organization_plan_overrides opo on opo.organization_id = $1 and opo.plan_key = bp.plan_key and (opo.ends_at is null or opo.ends_at > now())
     where bp.plan_key = $2 and bp.active = true and bp.public = true`,
    [organizationId, planKey],
  );
  if (!result.rowCount) throw httpError(404, "That billing plan is not available");
  const row = result.rows[0];
  const priceId = typeof row.override_price_id === "string" && row.override_price_id.trim()
    ? row.override_price_id
    : (interval === "year" ? row.stripe_yearly_price_id : row.stripe_monthly_price_id);
  if (typeof priceId !== "string" || !priceId.trim()) throw httpError(503, "This plan is not connected to a Stripe price yet");
  return {
    priceId: priceId.trim(),
    amountCents: row.override_amount_cents === null || row.override_amount_cents === undefined
      ? (row.monthly_amount_cents === null || row.monthly_amount_cents === undefined ? null : Number(row.monthly_amount_cents))
      : Number(row.override_amount_cents),
    currency: String(row.override_currency ?? row.currency ?? "usd"),
  };
}

function billingPlanDisplayName(planKey: string): string {
  const labels: Record<string, string> = {
    demo: "Demo",
    starter: "Starter",
    growth: "Growth",
    multi_business: "Multi-Business",
    portfolio: "Portfolio",
  };
  return labels[planKey] ?? planKey.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function stripeUnixTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : null;
}

type StripeSchedulePhase = Stripe.SubscriptionScheduleCreateParams.Phase;

function schedulePhaseItems(phase: Record<string, unknown>, fallbackPriceId: string): StripeSchedulePhase["items"] {
  const items = Array.isArray(phase.items) ? phase.items : [];
  return items.map((item) => {
    const record = asRecord(item);
    return {
      price: stripeObjectId(record.price) ?? fallbackPriceId,
      quantity: typeof record.quantity === "number" && Number.isFinite(record.quantity) ? record.quantity : 1,
    };
  });
}

async function releaseStripeSubscriptionSchedule(client: Stripe, scheduleId: string | null): Promise<void> {
  if (!scheduleId) return;
  const schedule = await client.subscriptionSchedules.retrieve(scheduleId);
  if (["active", "not_started"].includes(schedule.status)) await client.subscriptionSchedules.release(schedule.id);
}

async function scheduleStripeDowngrade(
  client: Stripe,
  subscription: Stripe.Subscription,
  organizationId: string,
  targetPriceId: string,
  targetPlanKey: string,
): Promise<{ scheduleId: string; effectiveAt: string }> {
  const subscriptionRecord = subscription as unknown as Record<string, unknown>;
  const currentItem = subscription.items.data[0];
  if (!currentItem) throw httpError(409, "The current Stripe subscription has no billable item");
  const currentPriceId = currentItem.price.id;
  const existingScheduleId = stripeObjectId(subscription.schedule);
  const schedule = existingScheduleId
    ? await client.subscriptionSchedules.retrieve(existingScheduleId)
    : await client.subscriptionSchedules.create({ from_subscription: subscription.id });
  const scheduleRecord = schedule as unknown as Record<string, unknown>;
  const phases = Array.isArray(scheduleRecord.phases) ? scheduleRecord.phases as unknown[] : [];
  const currentPhase = asRecord(phases[0]);
  const effectiveAtUnix = stripeUnixTimestamp(currentPhase.end_date) ?? stripeUnixTimestamp(subscriptionRecord.current_period_end);
  if (!effectiveAtUnix) throw httpError(409, "The current subscription has no billing-period end date");
  const currentStartAt = stripeUnixTimestamp(currentPhase.start_date)
    ?? stripeUnixTimestamp(subscriptionRecord.current_period_start)
    ?? Math.floor(Date.now() / 1_000);
  const currentItems = schedulePhaseItems(currentPhase, currentPriceId);
  const items = currentItems.length ? currentItems : [{ price: currentPriceId, quantity: currentItem.quantity ?? 1 }];
  const targetItems = [{ price: targetPriceId, quantity: currentItem.quantity ?? 1 }];
  await client.subscriptionSchedules.update(schedule.id, {
    end_behavior: "release",
    proration_behavior: "none",
    phases: [
      { start_date: currentStartAt, end_date: effectiveAtUnix, items },
      {
        start_date: effectiveAtUnix,
        items: targetItems,
        proration_behavior: "none",
        metadata: frontDeskWiseStripeMetadata(organizationId, targetPlanKey),
      },
    ],
    metadata: frontDeskWiseStripeMetadata(organizationId, targetPlanKey, { change_type: "downgrade" }),
  });
  return { scheduleId: schedule.id, effectiveAt: new Date(effectiveAtUnix * 1_000).toISOString() };
}

type StripeSubscriptionSyncResult = {
  previousStatus: BillingStatus;
  status: BillingStatus;
  previousPlanKey: string;
  planKey: string;
  subscriptionId: string | null;
  stripeStatus: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEndAt: string | null;
  changed: boolean;
  ignoredAsStale: boolean;
};

async function updateOrganizationFromStripeSubscription(
  organizationId: string,
  subscription: Record<string, unknown>,
  eventCreatedAt?: number,
  eventId?: string,
  options: { allowPlanChange?: boolean; paymentConfirmed?: boolean } = {},
): Promise<StripeSubscriptionSyncResult | null> {
  if (!pool) return null;
  const price = asRecord(asRecord(subscription.items).data instanceof Array ? (asRecord(subscription.items).data as unknown[])[0] : null);
  const priceObject = asRecord(price.price);
  const metadata = asRecord(subscription.metadata);
  const stripeStatus = String(subscription.status ?? "active");
  const statusResult = stripeBillingStatus(stripeStatus);
  const hasPendingUpdate = Object.keys(asRecord(subscription.pending_update)).length > 0;
  const allowPlanChange = options.allowPlanChange === true;
  const paymentConfirmed = options.paymentConfirmed === true;
  const interval = priceObject.recurring && typeof priceObject.recurring === "object"
    && (priceObject.recurring as { interval?: unknown }).interval === "year" ? "year" : "month";
  const subscriptionId = stripeObjectId(subscription.id);
  const client = await pool.connect();
  try {
    await client.query("begin");
    const current = await client.query<Record<string, unknown>>(
      `select billing_status, plan_key, stripe_subscription_id, stripe_subscription_event_created_at,
              stripe_subscription_status, cancel_at_period_end, last_payment_status, grace_end_at,
              pending_plan_key
       from organizations where id = $1 for update`,
      [organizationId],
    );
    if (!current.rowCount) {
      await client.query("commit");
      return null;
    }
    const currentRow = current.rows[0];
    const currentEventCreatedAt = currentRow.stripe_subscription_event_created_at === null || currentRow.stripe_subscription_event_created_at === undefined
      ? null : Number(currentRow.stripe_subscription_event_created_at);
    if (eventCreatedAt !== undefined
      && currentEventCreatedAt !== null
      && eventCreatedAt < currentEventCreatedAt
      && String(currentRow.stripe_subscription_id ?? "") === String(subscriptionId ?? "")) {
      await client.query("commit");
      return {
        previousStatus: String(currentRow.billing_status ?? "trial") as BillingStatus,
        status: String(currentRow.billing_status ?? "trial") as BillingStatus,
        previousPlanKey: String(currentRow.plan_key ?? "starter"),
        planKey: String(currentRow.plan_key ?? "starter"),
        subscriptionId,
        stripeStatus: String(currentRow.stripe_subscription_status ?? stripeStatus),
        cancelAtPeriodEnd: currentRow.cancel_at_period_end === true,
        currentPeriodEndAt: null,
        changed: false,
        ignoredAsStale: true,
      };
    }

    let planKey = "";
    if (priceObject.id) {
      const plan = await client.query<{ plan_key: string }>(
        `select plan_key from billing_plans
         where stripe_monthly_price_id = $1 or stripe_yearly_price_id = $1 limit 1`,
        [stripeObjectId(priceObject.id)],
      );
      planKey = plan.rows[0]?.plan_key ?? "";
      if (!planKey) {
        const override = await client.query<{ plan_key: string }>(
          `select plan_key from organization_plan_overrides
           where organization_id = $1 and stripe_price_id = $2
             and (ends_at is null or ends_at > now()) limit 1`,
          [organizationId, stripeObjectId(priceObject.id)],
        );
        planKey = override.rows[0]?.plan_key ?? "";
      }
    }
    if (!planKey) planKey = stripeMetadataString(metadata, "plan_key", "planKey");
    const previousStatus = String(currentRow.billing_status ?? "trial") as BillingStatus;
    const previousPlanKey = String(currentRow.plan_key ?? "starter");
    const activePlanKey = activePlanAfterStripeSync({
      currentPlanKey: previousPlanKey,
      observedPlanKey: planKey || null,
      allowPlanChange,
      paymentConfirmed,
      stripeStatus,
      hasPendingUpdate,
    });
    const cancelAtPeriodEnd = subscription.cancel_at_period_end === true;
    const scheduleCurrentPhase = asRecord(asRecord(subscription.schedule).current_phase);
    const currentPeriodEndAt = stripeTimestamp(subscription.current_period_end) ?? stripeTimestamp(scheduleCurrentPhase.end_date);
    const paymentStillFailed = currentRow.last_payment_status === "failed"
      && String(currentRow.stripe_subscription_id ?? "") === String(subscriptionId ?? "")
      && statusResult.status === "active"
      && !paymentConfirmed;
    const effectiveStatusResult = paymentStillFailed
      ? { status: "grace" as BillingStatus, graceEndAt: currentRow.grace_end_at ? toIso(currentRow.grace_end_at) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString() }
      : statusResult;
    await client.query(
      `update organizations
       set billing_mode = 'live', billing_status = $2, plan_key = coalesce(nullif($3, ''), plan_key),
           billing_interval = $4, trial_start_at = coalesce(trial_start_at, $5), trial_end_at = $6,
           current_period_start_at = $7, current_period_end_at = $8, grace_end_at = $9,
           billing_provider = 'stripe', stripe_customer_id = $10, stripe_subscription_id = $11,
           stripe_price_id = $12, billing_amount_cents = $13, billing_currency = $14,
           stripe_subscription_status = $15, stripe_subscription_event_created_at = coalesce($16, stripe_subscription_event_created_at),
           stripe_last_event_id = coalesce($17, stripe_last_event_id), cancel_at_period_end = $18,
           stripe_subscription_schedule_id = $19,
           stripe_checkout_status = case when stripe_checkout_status = 'open' then 'complete' else stripe_checkout_status end,
           subscription_activated_at = case when $2 = 'active' and billing_status <> 'active' then coalesce(subscription_activated_at, now()) else subscription_activated_at end,
           pending_plan_key = case when nullif($3, '') is not null and pending_plan_key = nullif($3, '') then null else pending_plan_key end,
           pending_billing_interval = case when nullif($3, '') is not null and pending_plan_key = nullif($3, '') then null else pending_billing_interval end,
           pending_plan_change_type = case when nullif($3, '') is not null and pending_plan_key = nullif($3, '') then null else pending_plan_change_type end,
           pending_plan_change_at = case when nullif($3, '') is not null and pending_plan_key = nullif($3, '') then null else pending_plan_change_at end,
           updated_at = now()
       where id = $1`,
      [
        organizationId,
        effectiveStatusResult.status,
        activePlanKey,
        interval,
        stripeTimestamp(subscription.trial_start),
        stripeTimestamp(subscription.trial_end),
        stripeTimestamp(subscription.current_period_start),
        currentPeriodEndAt,
        effectiveStatusResult.graceEndAt,
        stripeObjectId(subscription.customer),
        subscriptionId,
        stripeObjectId(priceObject.id),
        priceObject.unit_amount === null || priceObject.unit_amount === undefined ? null : Number(priceObject.unit_amount),
        typeof priceObject.currency === "string" ? priceObject.currency : "usd",
        stripeStatus,
        eventCreatedAt ?? null,
        eventId ?? null,
        cancelAtPeriodEnd,
        stripeObjectId(subscription.schedule),
      ],
    );
    await syncOrganizationBillingToBusinesses(client, organizationId);
    await client.query("commit");
    return {
      previousStatus,
      status: effectiveStatusResult.status,
      previousPlanKey,
      planKey: activePlanKey,
      subscriptionId,
      stripeStatus,
      cancelAtPeriodEnd,
      currentPeriodEndAt,
      changed: previousStatus !== effectiveStatusResult.status || previousPlanKey !== activePlanKey,
      ignoredAsStale: false,
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function getBusiness(slug: unknown): Promise<Business> {
  const value = requiredString(slug, "slug", 120);
  const loaded = await loadBusinessFromDatabase(value);
  if (loaded) {
    businesses.set(value, loaded);
    return loaded;
  }
  const business = businesses.get(value);
  if (!business) throw httpError(404, "Demo workspace not found");
  return business;
}

async function getBusinessBySiteKey(siteKey: unknown): Promise<Business> {
  const value = requiredString(siteKey, "siteKey", 120);
  if (pool) {
    const result = await pool.query<{ slug: string }>("select slug from businesses where public_site_key = $1", [value]);
    if (result.rowCount) {
      const business = await getBusiness(result.rows[0].slug);
      if (!business.publishedAgentConfig) throw httpError(404, "AI front desk is not published");
      return { ...business, agentConfig: cloneAgentConfig(business.publishedAgentConfig) };
    }
  }
  const business = [...businesses.values()].find((item) => item.widget.siteKey === value);
  if (!business) throw httpError(404, "Widget site key not found");
  if (!business.publishedAgentConfig) throw httpError(404, "AI front desk is not published");
  return { ...business, agentConfig: cloneAgentConfig(business.publishedAgentConfig) };
}

async function recordWidgetLoad(business: Business): Promise<void> {
  business.widget.lastLoadedAt = new Date().toISOString();
  business.widget.loadCount += 1;
  if (!pool) return;
  await pool.query(
    `update businesses
     set widget_last_loaded_at = $2, widget_load_count = widget_load_count + 1, updated_at = now()
     where id = $1`,
    [business.id, business.widget.lastLoadedAt],
  );
}

async function resumeEmbeddingJobs(): Promise<void> {
  if (!pool || !embeddingsConfigured()) return;
  const jobs = await pool.query<{ id: string; business_id: string }>(
    `select id, business_id
     from embedding_jobs
     where status = 'queued' and next_attempt_at <= now()
     order by created_at`,
  );
  for (const job of jobs.rows) {
    const result = await pool.query<{ slug: string }>("select slug from businesses where id = $1", [job.business_id]);
    if (!result.rowCount) continue;
    const business = await getBusiness(result.rows[0].slug);
    void processEmbeddingJob(business, job.id);
  }
}

let integrationOutboxRunning = false;
let integrationOutboxTimer: NodeJS.Timeout | null = null;

function integrationErrorMessage(error: unknown): string {
  return (error instanceof Error ? error.message : "CRM integration delivery failed").replace(/\s+/g, " ").slice(0, 1_000);
}

async function queueLeadsForIntegration(business: Business, integrationId: string): Promise<number> {
  if (!pool) return 0;
  const leads = await pool.query<Record<string, unknown>>(
    "select * from leads where business_id = $1 order by created_at",
    [business.id],
  );
  let queued = 0;
  for (const row of leads.rows) {
    const lead = leadFromRow(row);
    const payload = crmLeadPayload(business, lead, lead.id);
    const outbox = await pool.query(
      `insert into integration_outbox
         (business_id, integration_id, event_type, aggregate_type, aggregate_id, idempotency_key, payload)
       values ($1, $2, 'lead.created', 'lead', $3, $4, $5)
       on conflict (integration_id, idempotency_key) do nothing`,
      [business.id, integrationId, lead.id, `lead.created:${lead.id}`, JSON.stringify(payload)],
    );
    await pool.query(
      `insert into crm_sync_records (business_id, integration_id, lead_id)
       values ($1, $2, $3)
       on conflict (integration_id, lead_id) do nothing`,
      [business.id, integrationId, lead.id],
    );
    queued += outbox.rowCount ?? 0;
  }
  return queued;
}

function scheduleIntegrationOutbox(delayMs: number): void {
  if (integrationOutboxTimer) return;
  integrationOutboxTimer = setTimeout(() => {
    integrationOutboxTimer = null;
    void processIntegrationOutbox();
  }, Math.max(250, Math.min(delayMs, 60_000)));
}

async function scheduleNextIntegrationOutbox(): Promise<void> {
  if (!pool || integrationOutboxTimer) return;
  const next = await pool.query<{ delay_ms: string | null }>(
    `select extract(epoch from (min(next_attempt_at) - now())) * 1000 as delay_ms
     from integration_outbox where status in ('queued', 'retrying')`,
  );
  const delayMs = next.rows[0]?.delay_ms === null || next.rows[0]?.delay_ms === undefined
    ? null
    : Number(next.rows[0].delay_ms);
  if (delayMs !== null && Number.isFinite(delayMs)) scheduleIntegrationOutbox(Math.max(250, delayMs));
}

async function processIntegrationOutbox(): Promise<void> {
  if (!pool || integrationOutboxRunning) return;
  integrationOutboxRunning = true;
  try {
    while (true) {
      const claim = await pool.query<Record<string, unknown>>(
        `with candidate as (
           select id
           from integration_outbox
           where ((status in ('queued', 'retrying') and next_attempt_at <= now())
              or (status = 'running' and coalesce(last_attempt_at, created_at) < now() - interval '15 minutes'))
           order by created_at
           for update skip locked
           limit 1
         )
         update integration_outbox outbox
         set status = 'running', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
         from candidate
         where outbox.id = candidate.id
         returning outbox.*`,
      );
      if (!claim.rowCount) break;
      const outbox = claim.rows[0];
      const integrationResult = await pool.query<Record<string, unknown>>(
        `select id, provider, auth_type, encrypted_credentials
         from crm_integrations where id = $1 and business_id = $2`,
        [outbox.integration_id, outbox.business_id],
      );
      if (!integrationResult.rowCount || !["webhook", "hubspot"].includes(String(integrationResult.rows[0].provider))) {
        await pool.query(
          `update integration_outbox set status = 'failed', last_error = $2, updated_at = now() where id = $1`,
          [outbox.id, "CRM provider is no longer available"],
        );
        await pool.query(
          `update crm_sync_records set sync_status = 'failed', attempts = $2, last_attempt_at = now(), last_error = $3, updated_at = now()
           where integration_id = $1 and lead_id = $4`,
          [outbox.integration_id, Number(outbox.attempts), "CRM provider is no longer available", outbox.aggregate_id],
        );
        continue;
      }

      try {
        const encryptedCredentials = integrationResult.rows[0].encrypted_credentials;
        if (typeof encryptedCredentials !== "string" || !encryptedCredentials) throw new Error("CRM credentials are not configured");
        const payload = asRecord(outbox.payload) as CrmLeadPayload;
        const credentials = decryptIntegrationCredentials(encryptedCredentials);
        let delivery: { remoteObjectId?: string; remoteUrl?: string };
        if (integrationResult.rows[0].provider === "webhook") {
          delivery = await sendWebhookEvent(credentials, payload, String(outbox.idempotency_key));
        } else {
          if (!credentials.accessToken || !payload.lead) throw new Error("HubSpot credentials or lead payload are missing");
          const accessToken = await hubSpotAccessTokenForIntegration(String(outbox.integration_id), {
            ...credentials,
            accessToken: credentials.accessToken,
          });
          const adapter = createCrmAdapter("hubspot", accessToken);
          const contact = await adapter.upsertContact({
            email: payload.lead.email,
            phone: payload.lead.phone,
            name: payload.lead.name,
            intent: payload.lead.intent,
          });
          if (payload.lead.intent || payload.lead.source) {
            try {
              await adapter.logActivity({
                contactId: contact.externalId,
                body: `FrontDeskWise lead captured${payload.lead.intent ? ` for ${payload.lead.intent}` : ""}. Source: ${payload.lead.source}.`,
              });
            } catch (activityError) {
              app.log.warn({ integrationId: outbox.integration_id, error: integrationErrorMessage(activityError) }, "CRM contact synced but activity logging failed");
            }
          }
          delivery = { remoteObjectId: contact.externalId };
        }
        await pool.query(
          `update integration_outbox
           set status = 'succeeded', delivered_at = now(), last_error = null, updated_at = now()
           where id = $1`,
          [outbox.id],
        );
        await pool.query(
          `update crm_sync_records
           set sync_status = 'synced', attempts = $2, last_attempt_at = now(), synced_at = now(),
               remote_object_id = $3, remote_url = $4, last_error = null, updated_at = now()
           where integration_id = $1 and lead_id = $5`,
          [outbox.integration_id, Number(outbox.attempts), delivery.remoteObjectId ?? null, delivery.remoteUrl ?? null, outbox.aggregate_id],
        );
        await pool.query(
          `update crm_integrations set connection_status = 'active', last_error = null, updated_at = now() where id = $1`,
          [outbox.integration_id],
        );
      } catch (error) {
        const message = integrationErrorMessage(error);
        const attempts = Number(outbox.attempts);
        const maxAttempts = Number(outbox.max_attempts);
        const retry = attempts < maxAttempts;
        const delaySeconds = Math.min(900, 2 ** Math.max(0, attempts - 1) * 10);
        await pool.query(
          `update integration_outbox
           set status = $2, next_attempt_at = now() + ($3 * interval '1 second'), last_error = $4, updated_at = now()
           where id = $1`,
          [outbox.id, retry ? "retrying" : "failed", retry ? delaySeconds : 0, message],
        );
        await pool.query(
          `update crm_sync_records
           set sync_status = $2, attempts = $3, last_attempt_at = now(), last_error = $4, updated_at = now()
           where integration_id = $1 and lead_id = $5`,
          [outbox.integration_id, retry ? "retrying" : "failed", attempts, message, outbox.aggregate_id],
        );
        if (!retry) {
          await pool.query(
            `update crm_integrations set connection_status = 'error', last_error = $2, updated_at = now() where id = $1`,
            [outbox.integration_id, message],
          );
          const context = await pool.query<{ business_name: string; business_slug: string; organization_id: string; integration_name: string }>(
            `select b.name as business_name, b.slug as business_slug, b.organization_id,
                    coalesce(ci.display_name, ci.provider) as integration_name
             from businesses b
             left join crm_integrations ci on ci.id = $2
             where b.id = $1`,
            [outbox.business_id, outbox.integration_id],
          );
          const row = context.rows[0];
          if (row) {
            await queueLifecycleEvent({
              eventType: "INTEGRATION_FAILURE",
              eventKey: `integration.failed:${outbox.id}`,
              organizationId: row.organization_id,
              businessId: String(outbox.business_id),
              payload: {
                business_name: row.business_name,
                integration_name: row.integration_name,
                failure_reason: message,
                integrations_url: lifecycleAppUrl(`/app/${row.business_slug}/connections`),
              },
            });
          }
        }
        app.log.warn({ integrationId: outbox.integration_id, outboxId: outbox.id, attempts, retry, error: message }, "CRM delivery attempt failed");
      }
    }
  } finally {
    integrationOutboxRunning = false;
    void scheduleNextIntegrationOutbox().catch((error: unknown) => {
      app.log.warn({ error: error instanceof Error ? error.message : "unknown outbox scheduling error" }, "CRM outbox scheduling failed");
    });
  }
}

function actionInputFromCompletion(
  business: Business,
  action: ActionFlow,
  conversation: Conversation,
  state: ConversationActionState,
  lead: Lead | null,
): ActionInput {
  return {
    idempotencyKey: `action.completed:${conversation.id}:${action.id}`,
    tenant: { id: business.id, slug: business.slug, name: business.name },
    conversationId: conversation.id,
    flow: { id: action.id, key: action.key, name: action.name },
    values: state.values,
    lead: lead ? {
      id: lead.id,
      name: lead.name,
      email: lead.email,
      phone: lead.phone,
      intent: lead.intent,
      status: lead.status,
    } : null,
    completedAt: state.completedAt ?? new Date().toISOString(),
  };
}

async function enqueueActionExecution(
  business: Business,
  action: ActionFlow,
  conversation: Conversation,
  state: ConversationActionState,
  lead: Lead | null,
): Promise<void> {
  const settings = action.completion.connector;
  if (!settings) return;
  const input = actionInputFromCompletion(business, action, conversation, state, lead);
  const emailRecipients = settings.provider === "email" && (!settings.recipients || settings.recipients.length === 0)
    ? (await staffRecipients(business)).map((recipient) => recipient.email)
    : settings.recipients;
  const connectorConfig: Record<string, unknown> = {
    ...(emailRecipients ? { recipients: emailRecipients } : {}),
    ...(settings.endpoint ? { endpoint: settings.endpoint } : {}),
    ...(settings.accessToken ? { accessToken: settings.accessToken } : {}),
    ...(settings.apiKey ? { apiKey: settings.apiKey } : {}),
  };
  const integrationId = settings.integrationId ?? null;
  if (settings.provider === "generic_webhook" || settings.provider === "hubspot") {
    if (!integrationId) throw new Error(`${settings.provider} action connector requires a connected integration`);
    if (pool) {
      const integration = await pool.query<{ provider: string; connection_status: string }>(
        "select provider, connection_status from crm_integrations where id = $1 and business_id = $2",
        [integrationId, business.id],
      );
      const expectedProvider = settings.provider === "generic_webhook" ? "webhook" : "hubspot";
      if (!integration.rowCount || integration.rows[0].provider !== expectedProvider) throw new Error("Action connector integration does not match the selected provider");
      if (integration.rows[0].connection_status !== "active") throw new Error("Action connector integration is not active");
    }
  }
  if (!pool) {
    // In-memory mode is for local UI work. Execute only when the connector has
    // enough non-secret configuration to do so; connected integrations are a
    // PostgreSQL feature and are intentionally not emulated in memory.
    if (settings.provider === "email" || settings.endpoint) {
      await createActionConnector(settings.provider, connectorConfig).execute(input);
    }
    await recordConversionEvent(business, {
      event: "ACTION_SUCCEEDED",
      conversationId: conversation.id,
      flowId: action.id,
      metadata: { provider: settings.provider, inMemory: true },
    });
    return;
  }
  await pool.query(
    `insert into action_outbox
       (business_id, action_id, conversation_id, lead_id, integration_id, connector_provider, connector_config, idempotency_key, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (business_id, idempotency_key) do nothing`,
    [business.id, action.id, conversation.id, lead?.id ?? null, integrationId, settings.provider, JSON.stringify(connectorConfig), input.idempotencyKey, JSON.stringify(input)],
  );
  void processActionOutbox();
}

let actionOutboxRunning = false;
let actionOutboxTimer: NodeJS.Timeout | null = null;

function scheduleActionOutbox(delayMs: number): void {
  if (actionOutboxTimer) return;
  actionOutboxTimer = setTimeout(() => {
    actionOutboxTimer = null;
    void processActionOutbox();
  }, Math.max(250, Math.min(delayMs, 60_000)));
}

async function scheduleNextActionOutbox(): Promise<void> {
  if (!pool || actionOutboxTimer) return;
  const next = await pool.query<{ delay_ms: string | null }>(
    `select extract(epoch from (min(next_attempt_at) - now())) * 1000 as delay_ms
     from action_outbox where status in ('queued', 'retrying')`,
  );
  const delayMs = next.rows[0]?.delay_ms === null || next.rows[0]?.delay_ms === undefined ? null : Number(next.rows[0].delay_ms);
  if (delayMs !== null && Number.isFinite(delayMs)) scheduleActionOutbox(Math.max(250, delayMs));
}

async function actionBusinessForId(businessId: string): Promise<Business | null> {
  if (!pool) return null;
  const result = await pool.query<{ slug: string }>("select slug from businesses where id = $1", [businessId]);
  return result.rows[0] ? getBusiness(result.rows[0].slug) : null;
}

async function processActionOutbox(): Promise<void> {
  if (!pool || actionOutboxRunning) return;
  actionOutboxRunning = true;
  try {
    while (true) {
      const claim = await pool.query<Record<string, unknown>>(
        `with candidate as (
           select id from action_outbox
           where ((status in ('queued', 'retrying') and next_attempt_at <= now())
              or (status = 'running' and coalesce(last_attempt_at, created_at) < now() - interval '15 minutes'))
           order by created_at for update skip locked limit 1
         )
         update action_outbox outbox
         set status = 'running', attempts = attempts + 1, last_attempt_at = now(), updated_at = now()
         from candidate where outbox.id = candidate.id returning outbox.*`,
      );
      if (!claim.rowCount) break;
      const outbox = claim.rows[0];
      const provider = String(outbox.connector_provider) as ActionConnectorProvider;
      const businessId = String(outbox.business_id);
      const business = await actionBusinessForId(businessId);
      try {
        const config = asRecord(outbox.connector_config);
        const integrationId = typeof outbox.integration_id === "string" ? outbox.integration_id : null;
        if (integrationId) {
          const integration = await pool.query<Record<string, unknown>>(
            "select provider, auth_type, encrypted_credentials from crm_integrations where id = $1 and business_id = $2",
            [integrationId, businessId],
          );
          if (!integration.rowCount) throw new Error("Action connector integration is no longer available");
          const encryptedCredentials = integration.rows[0].encrypted_credentials;
          if (typeof encryptedCredentials !== "string" || !encryptedCredentials) throw new Error("Action connector credentials are not configured");
          const credentials = decryptIntegrationCredentials(encryptedCredentials);
          if (provider === "generic_webhook") {
            config.endpoint = credentials.webhookUrl;
            config.signingSecret = credentials.signingSecret;
          } else if (provider === "hubspot") {
            if (!credentials.accessToken) throw new Error("HubSpot credentials are not configured");
            config.accessToken = await hubSpotAccessTokenForIntegration(integrationId, {
              ...credentials,
              accessToken: credentials.accessToken,
            });
          }
        }
        const connector = createActionConnector(provider, config as Omit<ActionConnectorSettings, "provider">);
        const input = asRecord(outbox.payload) as unknown as ActionInput;
        const delivery = await connector.execute(input);
        await pool.query(
          `update action_outbox
           set status = 'succeeded', delivered_at = now(), remote_object_id = $2, remote_url = $3, last_error = null, updated_at = now()
           where id = $1`,
          [outbox.id, delivery.remoteObjectId ?? null, delivery.remoteUrl ?? null],
        );
        if (business) await recordConversionEvent(business, {
          event: "ACTION_SUCCEEDED",
          conversationId: String(outbox.conversation_id),
          flowId: String(outbox.action_id),
          metadata: { provider, attempts: Number(outbox.attempts), remoteObjectId: delivery.remoteObjectId ?? null },
        });
      } catch (error) {
        const message = integrationErrorMessage(error);
        const attempts = Number(outbox.attempts);
        const maxAttempts = Number(outbox.max_attempts);
        const retry = attempts < maxAttempts;
        const delaySeconds = Math.min(900, 2 ** Math.max(0, attempts - 1) * 10);
        await pool.query(
          `update action_outbox
           set status = $2, next_attempt_at = now() + ($3 * interval '1 second'), last_error = $4, updated_at = now()
           where id = $1`,
          [outbox.id, retry ? "retrying" : "failed", retry ? delaySeconds : 0, message],
        );
        if (business) await recordConversionEvent(business, {
          event: "ACTION_FAILED",
          conversationId: String(outbox.conversation_id),
          flowId: String(outbox.action_id),
          metadata: { provider, attempts, retrying: retry, error: message },
        });
        app.log.warn({ actionOutboxId: outbox.id, businessId, attempts, retry, error: message }, "Action connector delivery failed");
      }
    }
  } finally {
    actionOutboxRunning = false;
    void scheduleNextActionOutbox().catch((error: unknown) => {
      app.log.warn({ error: error instanceof Error ? error.message : "unknown action outbox scheduling error" }, "Action outbox scheduling failed");
    });
  }
}

function integrationPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    provider: String(row.provider),
    displayName: String(row.display_name),
    authType: row.auth_type === "oauth" ? "oauth" : "pat",
    accountId: typeof row.provider_account_id === "string" ? row.provider_account_id : null,
    accountName: typeof row.provider_account_name === "string" ? row.provider_account_name : null,
    credentialHint: typeof row.credential_hint === "string" ? row.credential_hint : null,
    connectionStatus: String(row.connection_status),
    lastTestedAt: row.last_tested_at ? toIso(row.last_tested_at) : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    sync: {
      total: Number(row.sync_total ?? 0),
      synced: Number(row.sync_synced ?? 0),
      pending: Number(row.sync_pending ?? 0),
      failed: Number(row.sync_failed ?? 0),
    },
  };
}

type ResolvedJackrabbitCredentials = {
  apiToken: string;
  source: "database" | "environment";
  integrationId: string | null;
};

function jackrabbitEnvironmentFallbackAllowed(): boolean {
  return process.env.NODE_ENV !== "production";
}

/** Resolve stored credentials first; the environment fallback is for local certification only. */
async function resolveJackrabbitCredentials(businessId: string, preferredIntegrationId?: string): Promise<ResolvedJackrabbitCredentials> {
  if (pool) {
    const result = preferredIntegrationId
      ? await pool.query<{ id: string; encrypted_credentials: string | null }>(
        `select id, encrypted_credentials
         from crm_integrations
         where id = $1 and business_id = $2 and provider = 'jackrabbit'`,
        [preferredIntegrationId, businessId],
      )
      : await pool.query<{ id: string; encrypted_credentials: string | null }>(
        `select id, encrypted_credentials
         from crm_integrations
         where business_id = $1 and provider = 'jackrabbit'
         order by case when connection_status = 'active' then 0 else 1 end, updated_at desc
         limit 1`,
        [businessId],
      );
    const row = result.rows[0];
    if (row?.encrypted_credentials) {
      try {
        const credentials = decryptIntegrationCredentials(row.encrypted_credentials);
        if (credentials.apiToken?.trim()) return { apiToken: credentials.apiToken, source: "database", integrationId: row.id };
      } catch {
        // Fall through to the explicitly allowed local environment fallback.
      }
    }
  }
  const environmentToken = process.env.FRONTDESKWISE_JACKRABBIT_API_TOKEN?.trim();
  if (jackrabbitEnvironmentFallbackAllowed() && environmentToken) {
    return { apiToken: environmentToken, source: "environment", integrationId: null };
  }
  throw new Error("Jackrabbit is not connected for this business");
}

function hubSpotCredentialsFromTokenSet(tokenSet: HubSpotOAuthTokenSet, existing?: HubSpotCredentials): HubSpotCredentials {
  return {
    authType: "oauth",
    accessToken: tokenSet.accessToken,
    refreshToken: tokenSet.refreshToken,
    expiresAt: tokenSet.expiresAt,
    scopes: tokenSet.scopes.length ? tokenSet.scopes : existing?.scopes ?? [],
    portalId: tokenSet.portalId ?? existing?.portalId ?? null,
  };
}

async function hubSpotAccessTokenForIntegration(integrationId: string, credentials: HubSpotCredentials): Promise<string> {
  if (!credentials.accessToken?.trim()) throw new Error("HubSpot credentials are not configured");
  if (credentials.authType !== "oauth") return credentials.accessToken;
  const expiresAt = credentials.expiresAt ? Date.parse(credentials.expiresAt) : Number.NaN;
  const refreshNeeded = !Number.isFinite(expiresAt) || expiresAt - Date.now() <= 120_000;
  if (!refreshNeeded) return credentials.accessToken;
  if (!credentials.refreshToken) throw new Error("HubSpot authorization has expired; reconnect the integration");
  const refreshed = await refreshHubSpotAccessToken(credentials.refreshToken);
  const updated = hubSpotCredentialsFromTokenSet(refreshed, credentials);
  if (pool) {
    await pool.query(
      `update crm_integrations
       set encrypted_credentials = $2,
           access_token_expires_at = $3,
           provider_scopes = $4,
           provider_account_id = coalesce($5, provider_account_id),
           updated_at = now()
       where id = $1`,
      [integrationId, encryptIntegrationCredentials(updated), updated.expiresAt, updated.scopes, updated.portalId],
    );
  }
  return updated.accessToken;
}

function mcpConnectionPayload(row: Record<string, unknown>) {
  const tools = mcpToolsFromValue(row.tool_catalog);
  const allowedTools = Array.isArray(row.allowed_tools)
    ? row.allowed_tools.filter((item): item is string => typeof item === "string").slice(0, 200)
    : [];
  return {
    id: String(row.id),
    provider: String(row.provider),
    displayName: String(row.display_name),
    serverUrl: String(row.server_url),
    connectionStatus: String(row.connection_status),
    protocolVersion: String(row.protocol_version ?? "2025-06-18"),
    lastTestedAt: row.last_tested_at ? toIso(row.last_tested_at) : null,
    lastSuccessfulCallAt: row.last_successful_call_at ? toIso(row.last_successful_call_at) : null,
    lastError: typeof row.last_error === "string" ? row.last_error : null,
    tools: toolPermissions(tools, allowedTools),
  };
}

function conversionFunnelPayload(business: Business) {
  const flows = new Map<string, {
    flowId: string;
    flowKey: string;
    name: string;
    started: number;
    formDisplayed: number;
    submitted: number;
    actionSucceeded: number;
    completed: number;
    abandoned: number;
    fields: Map<string, { viewed: number; completed: number; abandoned: number }>;
  }>();
  for (const event of business.conversionEvents) {
    if (!event.flowId) continue;
    const action = business.actions.find((candidate) => candidate.id === event.flowId);
    const flow = flows.get(event.flowId) ?? {
      flowId: event.flowId,
      flowKey: action?.key ?? event.flowId,
      name: action?.name ?? "Conversation flow",
      started: 0,
      formDisplayed: 0,
      submitted: 0,
      actionSucceeded: 0,
      completed: 0,
      abandoned: 0,
      fields: new Map(),
    };
    if (event.event === "FLOW_STARTED") flow.started += 1;
    if (event.event === "FORM_DISPLAYED") flow.formDisplayed += 1;
    if (event.event === "FORM_SUBMITTED") flow.submitted += 1;
    if (event.event === "ACTION_SUCCEEDED") flow.actionSucceeded += 1;
    if (event.event === "FLOW_COMPLETED") flow.completed += 1;
    if (event.event === "CONVERSATION_ABANDONED") flow.abandoned += 1;
    if (event.fieldId && ["FIELD_VIEWED", "FIELD_COMPLETED", "FIELD_ABANDONED"].includes(event.event)) {
      const field = flow.fields.get(event.fieldId) ?? { viewed: 0, completed: 0, abandoned: 0 };
      if (event.event === "FIELD_VIEWED") field.viewed += 1;
      if (event.event === "FIELD_COMPLETED") field.completed += 1;
      if (event.event === "FIELD_ABANDONED") field.abandoned += 1;
      flow.fields.set(event.fieldId, field);
    }
    flows.set(event.flowId, flow);
  }
  return [...flows.values()].map((flow) => ({
    flowId: flow.flowId,
    flowKey: flow.flowKey,
    name: flow.name,
    started: flow.started,
    formDisplayed: flow.formDisplayed,
    submitted: flow.submitted,
    actionSucceeded: flow.actionSucceeded,
    completed: flow.completed,
    abandoned: flow.abandoned,
    completionRate: flow.started ? Math.round((flow.completed / flow.started) * 100) : 0,
    dropOffs: [...flow.fields.entries()]
      .map(([fieldId, field]) => ({
        fieldId,
        label: business.actions.find((candidate) => candidate.id === flow.flowId)?.fields.find((candidate) => candidate.key === fieldId || candidate.id === fieldId)?.label ?? fieldId,
        count: Math.max(field.abandoned, field.viewed - field.completed),
      }))
      .filter((field) => field.count > 0)
      .sort((left, right) => right.count - left.count)
      .slice(0, 5),
  }));
}

async function embeddingReadinessForBusiness(business: Business) {
  const provider = embeddingProviderHealth();
  if (!pool) {
    const embeddedChunks = business.chunks.filter((chunk) => chunk.embeddingModel === embeddingModel() && chunk.embeddingDimensions === embeddingDimensions()).length;
    return embeddingReadiness({
      configured: embeddingsConfigured(),
      providerStatus: provider.status,
      providerReason: provider.reason,
      model: embeddingModel(),
      dimensions: embeddingDimensions(),
      totalChunks: business.chunks.length,
      embeddedChunks,
    });
  }

  const [counts, latest] = await Promise.all([
    pool.query<{ total: string; embedded: string }>(
      `select count(*)::text as total,
              count(*) filter (where embedding is not null and embedding_model = $2 and embedding_dimensions = $3)::text as embedded
       from knowledge_chunks where business_id = $1`,
      [business.id, embeddingModel(), embeddingDimensions()],
    ),
    pool.query<Record<string, unknown>>(
      `select id, status, model, attempts, max_attempts, total_chunks, embedded_chunks, next_attempt_at, started_at, completed_at, last_error
       from embedding_jobs where business_id = $1 order by created_at desc limit 1`,
      [business.id],
    ),
  ]);
  const job = latest.rows[0];
  const latestJob = job ? {
    id: String(job.id),
    status: String(job.status),
    model: String(job.model),
    attempts: Number(job.attempts),
    maxAttempts: Number(job.max_attempts),
    totalChunks: Number(job.total_chunks),
    embeddedChunks: Number(job.embedded_chunks),
    nextAttemptAt: job.next_attempt_at ? toIso(job.next_attempt_at) : null,
    startedAt: job.started_at ? toIso(job.started_at) : null,
    completedAt: job.completed_at ? toIso(job.completed_at) : null,
    lastError: typeof job.last_error === "string" ? job.last_error : null,
  } : null;
  return embeddingReadiness({
    configured: embeddingsConfigured(),
    providerStatus: provider.status,
    providerReason: provider.reason,
    model: embeddingModel(),
    dimensions: embeddingDimensions(),
    totalChunks: Number(counts.rows[0]?.total ?? 0),
    embeddedChunks: Number(counts.rows[0]?.embedded ?? 0),
    latestJob,
  });
}

function websiteBrandColors(business: Business): string[] {
  const colors = business.chunks.flatMap((chunk) => {
    const value = chunk.metadata.brandColors;
    return Array.isArray(value) ? value.filter((color): color is string => typeof color === "string" && /^#[\da-f]{6}$/i.test(color)) : [];
  });
  return [...new Set(colors.map((color) => color.toUpperCase()))].slice(0, 6);
}

function isLowQualityWebChunk(business: Business, chunk: KnowledgeChunk): boolean {
  const source = business.sources.find((candidate) => candidate.id === chunk.sourceId);
  const tokenCount = typeof chunk.metadata.tokenCount === "number" ? chunk.metadata.tokenCount : null;
  return source?.contentType === "web_page"
    && tokenCount !== null
    && tokenCount <= 8
    && chunk.content.trim().length < 120;
}

async function workspacePayload(business: Business) {
  const conversations = [...business.conversations.values()];
  const leadCount = business.leads.length;
  const gapList = [...business.knowledgeGaps.values()];
  const gapCount = gapList.filter((gap) => gap.status === "open").length;
  const readySources = business.sources.filter((source) => source.crawlStatus === "ready");
  const readySourceIds = new Set(readySources.map((source) => source.id));
  const sourceCount = readySources.length;
  const pendingSourceCount = business.sources.filter((source) => source.crawlStatus === "queued" || source.crawlStatus === "crawling").length;
  const failedSourceCount = business.sources.filter((source) => source.crawlStatus === "failed").length;
  const chunkCount = business.chunks.filter((chunk) => readySourceIds.has(chunk.sourceId)).length;
  const meaningfulChunkCount = business.chunks.filter((chunk) => readySourceIds.has(chunk.sourceId) && !isLowQualityWebChunk(business, chunk)).length;
  const factConflicts = resolveBusinessFacts(business.facts, {}).conflicts;
  const contentQualityIssue = chunkCount > 0 && meaningfulChunkCount === 0;
  const semantic = await embeddingReadinessForBusiness(business);
  const readinessScore = sourceCount === 0
    ? 0
    : Math.max(0, Math.min(100, (sourceCount > 0 ? 40 : 0) + (meaningfulChunkCount > 0 ? 30 : 0) + (semantic.status === "SEMANTIC_SEARCH_HEALTHY" && !contentQualityIssue ? 20 : 0) + Math.max(0, 10 - gapCount * 2)));
  const readinessStatus = sourceCount === 0
    ? "needs_website"
    : chunkCount === 0 || pendingSourceCount > 0
      ? "indexing"
      : contentQualityIssue || gapCount > 0 || failedSourceCount > 0
        ? "review_recommended"
        : "ready";
  const knowledgeStatus = sourceCount === 0 || chunkCount === 0 || pendingSourceCount > 0
    ? readinessStatus
    : contentQualityIssue
      ? "review_recommended"
      : semantic.status;
  const businessContextInput = {
    businessId: business.id,
    businessName: business.name,
    businessType: business.vertical,
    location: business.location,
    primaryAction: business.actions.find((action) => action.id === business.primaryActionId) ?? null,
    actions: business.actions,
    actionResources: business.actionResources,
    facts: business.facts,
    chunks: business.chunks,
    sources: business.sources.map((source) => ({ id: source.id, title: source.title, url: source.url, crawlStatus: source.crawlStatus, lastCrawledAt: source.lastCrawledAt })),
    knowledgeGaps: gapList,
    conversationQuestions: conversations.flatMap((conversation) => conversation.messages.filter((message) => message.role === "user").map((message) => message.content)),
    privacyNoticeUrl: business.agentConfig.privacyNoticeUrl,
  };
  const businessModel = buildCanonicalBusinessModel(businessContextInput);
  const contextSnapshot = createBusinessContextSnapshot(businessModel, business.businessContextSnapshot);
  if (!business.businessContextSnapshot || business.businessContextSnapshot.materialFingerprint !== contextSnapshot.materialFingerprint) {
    await persistBusinessContextSnapshot(business, contextSnapshot, businessModel);
  } else {
    business.businessContextSnapshot = contextSnapshot;
  }
  const workflowContext = {
    ...buildWorkflowContext(businessContextInput),
    organizationId: business.organizationId ?? undefined,
    businessId: business.id,
    contextVersion: contextSnapshot.version,
  };
  const setupSteps = [
    { id: "domain_verified", label: "Verify website", complete: business.ownershipStatus === "verified" },
    { id: "knowledge_ready", label: "Review knowledge", complete: sourceCount > 0 && meaningfulChunkCount > 0 && pendingSourceCount === 0 && failedSourceCount === 0 },
    { id: "agent_tested", label: "Test assistant", complete: [...business.conversations.values()].some((conversation) => conversation.sessionId.startsWith("dashboard-") && conversation.messages.some((message) => message.role === "user" && message.content.trim())) },
    { id: "widget_installed", label: "Install widget", complete: business.widget.loadCount > 0 },
    { id: "agent_published", label: "Publish", complete: Boolean(business.agentPublishedAt || business.publishedAgentConfig) },
  ];
  const nextRequiredStep = setupSteps.find((step) => !step.complete)?.id ?? null;
  const businessTerms = [...new Set(
    tokenise(business.chunks[0]?.content ?? "")
      .filter((term) => !tokenise(business.name).includes(term)),
  )].slice(0, 2);
  const questionCounts = new Map<string, { question: string; count: number }>();
  for (const conversation of conversations) {
    for (const message of conversation.messages) {
      if (message.role !== "user" || !message.content.trim()) continue;
      const key = message.content.toLowerCase().replace(/\s+/g, " ").trim();
      const existing = questionCounts.get(key);
      if (existing) existing.count += 1;
      else questionCounts.set(key, { question: message.content.trim(), count: 1 });
    }
  }
  const topQuestions = [...questionCounts.values()]
    .sort((left, right) => right.count - left.count || left.question.localeCompare(right.question))
    .slice(0, 5);
  const today = new Date();
  const trend = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (29 - index)));
    const day = date.toISOString().slice(0, 10);
    return {
      label: date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
      conversations: conversations.filter((conversation) => conversation.createdAt.slice(0, 10) === day).length,
      leads: business.leads.filter((lead) => lead.createdAt.slice(0, 10) === day).length,
    };
  });
  return {
    slug: business.slug,
    status: business.billing.mode,
    business: {
      id: business.id,
      name: business.name,
      location: business.location,
      vertical: business.vertical,
      websiteUrl: business.websiteUrl,
    },
    agent: business.agentConfig,
    branding: {
      colors: websiteBrandColors(business),
      source: "website",
    },
    suggestedQuestions: [
      `What services does ${business.name} offer?`,
      businessTerms.length ? `What should I know about ${businessTerms.join(" ")}?` : "How do I get started?",
      `How can I contact ${business.name}?`,
    ],
    ownership: {
      status: business.ownershipStatus,
      method: business.ownershipVerificationMethod,
      verifiedAt: business.ownershipVerifiedAt,
    },
    publishing: agentPublishingPayload(business),
    publishedAt: business.agentPublishedAt,
    billing: {
      ...business.billing,
      access: billingAccess(business.billing),
    },
    widget: {
      siteKey: business.widget.siteKey,
      enabled: business.widget.enabled,
      lastLoadedAt: business.widget.lastLoadedAt,
      loadCount: business.widget.loadCount,
    },
    knowledge: {
      sourceCount,
      chunkCount,
      meaningfulChunkCount,
      contentQualityIssue,
      openGaps: gapCount,
      pendingSources: pendingSourceCount,
      failedSources: failedSourceCount,
      structuredFactCount: business.facts.filter((fact) => fact.active).length,
      factConflictCount: factConflicts.length,
      status: knowledgeStatus,
      indexed: sourceCount > 0 && meaningfulChunkCount > 0,
      semantic,
      sources: business.sources.map((source) => ({
        id: source.id,
        title: source.title,
        url: source.url,
        contentType: source.contentType,
        pageType: source.pageType,
        crawlStatus: source.crawlStatus,
        lastCrawledAt: source.lastCrawledAt,
        httpStatus: source.httpStatus ?? null,
        rawHtmlBytes: source.rawHtmlBytes ?? null,
        extractedCharacterCount: source.extractedCharacterCount ?? null,
        discoveredLinkCount: source.discoveredLinkCount ?? null,
        crawlMode: source.crawlMode ?? "static",
        renderAttempted: source.renderAttempted ?? false,
        renderSuccess: source.renderSuccess ?? false,
        renderDurationMs: source.renderDurationMs ?? null,
        renderDiagnostics: source.renderDiagnostics ?? null,
        crawlDepth: source.crawlDepth ?? null,
        discoveryParentUrl: source.discoveryParentUrl ?? null,
      })),
      readiness: {
        score: readinessScore,
        sources: sourceCount,
        chunks: chunkCount,
        meaningfulChunks: meaningfulChunkCount,
        contentQualityIssue,
        embeddedChunks: semantic.embeddedChunks,
        embeddingCoveragePercent: semantic.coveragePercent,
        semanticSearchStatus: semantic.status,
        openGaps: gapCount,
        pendingSources: pendingSourceCount,
        failedSources: failedSourceCount,
      },
    },
    workflowContext,
    businessContext: {
      schemaVersion: businessModel.schemaVersion,
      summary: contextSnapshot.summary,
      version: contextSnapshot.version,
      generatedAt: contextSnapshot.generatedAt,
      materialFingerprint: contextSnapshot.materialFingerprint,
      status: contextSnapshot.status,
      factStatusCounts: businessModel.knowledge.facts.reduce<Record<string, number>>((counts, fact) => {
        counts[fact.status] = (counts[fact.status] ?? 0) + 1;
        return counts;
      }, {}),
      conflictCount: businessModel.conflicts.length,
      openKnowledgeGaps: businessModel.knowledge.gaps.length,
    },
    stats: {
      conversations: conversations.length,
      leads: leadCount,
      bookingClicks: conversations.filter((conversation) => conversation.actionTaken === "booking").length,
      unansweredQuestions: gapCount,
      widgetLoads: business.widget.loadCount,
      conversionFunnels: conversionFunnelPayload(business),
      trend,
      topQuestions,
      actions: gapList.filter((gap) => gap.status === "open").sort((left, right) => right.occurrenceCount - left.occurrenceCount).slice(0, 5).map((gap) => ({
        question: gap.question,
        count: gap.occurrenceCount,
        status: gap.status,
      })),
      handoffs: conversations.filter((conversation) => conversation.status !== "AI_ACTIVE").length,
      humanActive: conversations.filter((conversation) => conversation.status === "HUMAN_ACTIVE" || conversation.status === "AI_ASSISTED").length,
      setup: {
        completed: setupSteps.filter((step) => step.complete).length,
        total: setupSteps.length,
        percent: Math.round(setupSteps.filter((step) => step.complete).length / setupSteps.length * 100),
        steps: setupSteps,
        nextRequiredStep,
      },
    },
  };
}

async function publicWorkspacePayload(business: Business) {
  const payload = await workspacePayload(business);
  return {
    slug: payload.slug,
    status: payload.status,
    business: payload.business,
    agent: payload.agent,
    branding: payload.branding,
    suggestedQuestions: payload.suggestedQuestions,
    knowledge: payload.knowledge,
    stats: payload.stats,
  };
}

function inboxMessagePayload(message: Message) {
  return {
    id: message.id ?? (message.id = randomUUID()),
    role: message.role,
    kind: message.kind ?? "message",
    authorUserId: message.authorUserId ?? null,
    authorName: message.authorName ?? null,
    content: message.content,
    grounded: message.grounded ?? null,
    citations: message.citations ?? [],
    createdAt: message.createdAt,
  };
}

function inboxConversationPayload(business: Business, conversation: Conversation) {
  const lead = business.leads.find((item) => item.conversationId === conversation.id) ?? null;
  const actionState = conversation.actionState;
  const action = actionState ? business.actions.find((item) => item.id === actionState.actionId) : null;
  const visibleMessages = conversation.messages.filter((message) => message.kind !== "internal_note");
  const latestMessage = visibleMessages.at(-1);
  return {
    ...conversationStatusPayload(conversation),
    sessionId: conversation.sessionId,
    leadCaptured: conversation.leadCaptured,
    actionTaken: conversation.actionTaken,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    lead,
    action: actionState && action ? {
      id: action.id,
      type: action.actionType,
      key: action.key,
      name: action.name,
      status: actionState.status,
      startedAt: actionState.startedAt,
      completedAt: actionState.completedAt ?? null,
      values: Object.fromEntries(Object.entries(actionState.values).filter(([, value]) => typeof value === "string").slice(0, 50)),
      handoffRequired: action.completion.requiresStaff,
      handoffState: conversation.status === "WAITING_FOR_STAFF" || conversation.status === "HUMAN_ACTIVE" ? conversation.status : null,
      ...(action.steps?.length ? { workflow: workflowSummary(action, actionState) } : {}),
    } : null,
    lastMessage: latestMessage ? inboxMessagePayload(latestMessage) : null,
  };
}

function tokenise(value: string): string[] {
  // Keep business vocabulary searchable. Removing terms such as "school",
  // "program", or "lesson" makes ordinary customer questions look empty for
  // verticals where those words carry the meaning of the request.
  const stopWords = new Set(["a", "an", "and", "are", "can", "do", "does", "for", "how", "i", "in", "is", "it", "my", "of", "on", "or", "the", "to", "we", "what", "when", "where", "you", "this", "with", "use", "using"]);
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token));
}

function rememberGap(business: Business, question: string, intent: RetrievalIntent, reason: KnowledgeGapReason): KnowledgeGap {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const existing = business.knowledgeGaps.get(key);
  const now = new Date().toISOString();
  if (existing) {
    existing.occurrenceCount += 1;
    existing.lastSeenAt = now;
    existing.updatedAt = now;
    existing.intent = intent;
    existing.reason = reason;
    return existing;
  }
  const gap: KnowledgeGap = {
    question,
    occurrenceCount: 1,
    status: "open",
    approvedAnswer: null,
    answerMode: "knowledge",
    lastSeenAt: now,
    updatedAt: now,
    indexedAt: null,
    indexStatus: "not_indexed",
    indexError: null,
    intent,
    reason,
  };
  business.knowledgeGaps.set(key, gap);
  return gap;
}

type RetrievalCandidateDiagnostic = {
  rank: number;
  chunkId: string;
  sourceId: string;
  source: string;
  url: string;
  headingPath: string[];
  lexicalScore: number | null;
  vectorScore: number | null;
  fusionScore: number;
  evidenceScore: number;
  sourceType: string;
  sourceBoost: number;
  rerankScore: number | null;
  selected: boolean;
  rejectionReason: string | null;
};

type RetrievalMatch = {
  chunk: KnowledgeChunk;
  score: number;
  evidenceScore: number;
  lexicalScore?: number | null;
  vectorScore?: number | null;
  lexicalRank?: number | null;
  vectorRank?: number | null;
  fusionScore?: number;
};
type RetrievalResult = {
  matches: RetrievalMatch[];
  mode: string;
  latencyMs: number;
  rerankLatencyMs: number;
  normalizedQuery: string;
  expandedQuery: string;
  candidates: RetrievalCandidateDiagnostic[];
};

type RetrievalContext = {
  normalizedQuery: string;
  expandedQuery: string;
  intent: RetrievalIntent;
};

type ActiveWorkflowAnswerContext = {
  action: ActionFlow;
  state: ConversationActionState;
};

function workflowAudienceTerms(workflow?: ActiveWorkflowAnswerContext): { target: RegExp; competing: RegExp } | null {
  if (!workflow || !isPlanSelectionWorkflow(workflow.action)) return null;
  const usageType = workflow.state.values.usage_type?.toLowerCase() ?? "";
  if (/team|group|multiple/.test(usageType)) {
    return {
      target: /\b(team|teams|workspace|workspaces|seat|seats|business|organization|multiple users?)\b/i,
      competing: /\b(solo|individual|personal|single user|one user)\b/i,
    };
  }
  if (/solo|individual|personal|one/.test(usageType)) {
    return {
      target: /\b(solo|individual|personal|single user|one user)\b/i,
      competing: /\b(team|teams|workspace|workspaces|seat|seats|business|organization|multiple users?)\b/i,
    };
  }
  return null;
}

function workflowScopedFacts(business: Business, workflow?: ActiveWorkflowAnswerContext): BusinessFact[] {
  const audience = workflowAudienceTerms(workflow);
  if (!audience) return business.facts;
  return business.facts.filter((fact) => {
    if (fact.kind !== "pricing") return true;
    const text = `${fact.subject} ${fact.predicate} ${fact.valueText}`;
    return !(audience.competing.test(text) && !audience.target.test(text));
  });
}

type StructuredFactAnswer = {
  answer: string;
  fact: BusinessFact;
  confidenceScore: number;
  citations: Array<{ title: string; url: string; sourceId?: string; pageType: string }>;
  conflicts: number;
};

function workflowPricingAnswer(
  business: Business,
  workflow: ActiveWorkflowAnswerContext | undefined,
): StructuredFactAnswer | null {
  const audience = workflowAudienceTerms(workflow);
  if (!workflow || !audience || !workflow.state.values.usage_type) return null;

  const plans = workflowScopedFacts(business, workflow)
    .filter((fact) => fact.active && fact.kind === "pricing")
    .filter((fact) => /\b(free|solo|individual|personal|starter|pro|premium|plan|tier|subscription)\b/i.test(`${fact.subject} ${fact.predicate} ${fact.valueText}`))
    .filter((fact) => /\$|€|£|\/month|per month|monthly|free/i.test(fact.valueText))
    .filter((fact, index, facts) => facts.findIndex((candidate) => `${candidate.subject}|${candidate.valueText}`.toLowerCase() === `${fact.subject}|${fact.valueText}`.toLowerCase()) === index)
    .sort((left, right) => {
      const leftFree = /\bfree\b/i.test(`${left.subject} ${left.valueText}`) ? 1 : 0;
      const rightFree = /\bfree\b/i.test(`${right.subject} ${right.valueText}`) ? 1 : 0;
      return rightFree - leftFree;
    })
    .slice(0, 8);
  if (!plans.length) return null;

  const audienceLabel = /team|group|multiple/i.test(workflow.state.values.usage_type) ? "For team use" : "For individual use";
  const summary = plans.map((fact) => `${fact.subject} at ${fact.valueText}`).join("; ");
  const citations = plans
    .map((fact) => {
      const source = fact.sourceId ? business.sources.find((item) => item.id === fact.sourceId) : null;
      return source ? { title: source.title, url: source.url, sourceId: source.id, pageType: source.pageType } : null;
    })
    .filter((citation): citation is NonNullable<typeof citation> => Boolean(citation))
    .filter((citation, index, list) => list.findIndex((item) => item.sourceId === citation.sourceId) === index)
    .slice(0, 2);
  const fact = plans[0];
  return {
    answer: `${audienceLabel}, ${summary}.`,
    fact,
    confidenceScore: Math.min(0.99, 0.72 + fact.confidence * 0.2 + (fact.authority === "owner_verified" || fact.authority === "system_of_record" ? 0.06 : 0)),
    citations,
    conflicts: 0,
  };
}

function workflowScopedMatches(matches: RetrievalMatch[], workflow: ActiveWorkflowAnswerContext | undefined, intent: RetrievalIntent): RetrievalMatch[] {
  const audience = workflowAudienceTerms(workflow);
  if (!audience || intent !== "pricing") return matches;
  return matches.filter(({ chunk }) => {
    const text = chunk.content;
    return !(audience.competing.test(text) && !audience.target.test(text));
  });
}

function workflowContextTerms(workflow?: ActiveWorkflowAnswerContext): string[] {
  if (!workflow) return [];
  const values = Object.entries(workflow.state.values)
    .filter(([key, value]) => value && !/email|phone|name|address|token|secret/i.test(key))
    .map(([key, value]) => `${key.replace(/[_-]+/g, " ")}: ${value}`);
  return [`active workflow ${workflow.action.name}`, ...values].slice(0, 12);
}

function retrievalContext(
  business: Business,
  question: string,
  conversation?: Conversation,
  currentPage?: string | null,
  workflow?: ActiveWorkflowAnswerContext,
): RetrievalContext {
  const normalizedQuery = question.trim().replace(/\s+/g, " ");
  const intent = classifyQuestionIntent(normalizedQuery);
  const parts = [normalizedQuery];
  if (intent === "getting_started") {
    parts.push(`${business.name} onboarding`, "start using the product", "first steps", "create a first task", "try signup free trial");
  }
  const recentConversationContext = conversation?.messages
    .filter((message) => ["user", "assistant", "human"].includes(message.role) && message.content.trim() && message.content.trim() !== question.trim())
    .slice(-10)
    .map((message) => `${message.role}: ${message.content.trim().slice(0, 240)}`);
  if (recentConversationContext?.length) parts.push(`conversation context ${recentConversationContext.join(" ")}`);
  if (currentPage) {
    try {
      parts.push(`current page ${new URL(currentPage).pathname}`);
    } catch {
      // Ignore an invalid page hint; the visitor's question remains usable.
    }
  }
  const workflowTerms = workflowContextTerms(workflow);
  if (workflowTerms.length) parts.push(`workflow context ${workflowTerms.join(" ")}`);
  return { normalizedQuery, expandedQuery: parts.join(" "), intent };
}

function retrievalTokens(question: string, intent: RetrievalIntent): string[] {
  const intentTerms: Record<RetrievalIntent, string[]> = {
    services: ["service", "solution", "product", "feature", "capability", "automation", "development", "integration", "task", "reminder", "calendar", "planning", "schedule", "voice", "workflow", "workspace"],
    hours: ["hours", "open", "schedule", "availability"],
    contact: ["contact", "email", "phone", "call"],
    pricing: ["price", "pricing", "cost", "rate", "fee", "quote", "plan", "plans", "free", "month", "seat", "subscription"],
    location: ["location", "address", "directions", "area"],
    booking: ["book", "booking", "appointment", "reserve", "enroll", "schedule"],
    permissions: ["permission", "permissions", "access", "role", "roles", "admin", "authorization"],
    privacy: ["privacy", "private", "personal", "data", "security", "stored", "oauth", "token"],
    support: ["support", "help", "technical", "login", "sign", "issue"],
    policy: ["terms", "privacy", "cookie", "cancellation", "refund", "policy", "permission", "security", "data"],
    reminders: ["reminder", "reminders", "unfinished", "recap", "task", "tasks", "planning"],
    calendar: ["calendar", "calendars", "scheduling", "schedule", "sync", "outlook", "google"],
    voice: ["voice", "dictation", "spoken", "speak", "audio"],
    teams: ["team", "teams", "workspace", "collaboration", "collaborate", "users"],
    getting_started: ["onboarding", "onboard", "start", "started", "begin", "first", "steps", "try", "signup", "sign", "free", "task", "planning", "reminder", "calendar", "feature", "product"],
    unsupported: [],
    general: [],
  };
  return [...new Set([...tokenise(question), ...intentTerms[intent]])];
}

function contentEvidenceScore(
  content: string,
  question: string,
  intent: RetrievalIntent,
  lexicalScore: number | null,
  vectorScore: number | null,
  metadata: Record<string, unknown> = {},
): number {
  const terms = retrievalTokens(question, intent).filter((term) => term !== "plancraftai");
  const lower = content.toLowerCase();
  const coverage = terms.length ? terms.filter((term) => lower.includes(term)).length / terms.length : 0;
  const lexicalSignal = lexicalScore === null || !Number.isFinite(lexicalScore)
    ? 0
    : Math.min(1, 0.2 + lexicalScore * 0.35);
  const lexicalEvidence = Math.max(coverage, lexicalSignal);
  const semanticEvidence = vectorScore === null || !Number.isFinite(vectorScore)
    ? lexicalEvidence
    : lexicalEvidence * 0.45 + Math.max(0, Math.min(1, vectorScore)) * 0.55;

  // A title/metadata shell can score well from a single business-name token or
  // a broad embedding while containing no answerable evidence. Keep this
  // generic: short uploaded documents remain valid, but short web chunks with
  // no section structure are treated as low-quality evidence.
  const tokenCount = typeof metadata.tokenCount === "number" ? metadata.tokenCount : null;
  const shellLike = (metadata.sourceType === "web_page" || metadata.pageType === "web_page")
    && tokenCount !== null
    && tokenCount <= 8
    && content.length < 120;
  if (shellLike) return 0;
  const quality = tokenCount !== null && tokenCount < 20 && content.length < 180 ? 0.55 : 1;
  return Math.max(0, Math.min(1, semanticEvidence * quality));
}

function memoryRetrieval(business: Business, question: string, expandedQuery = question, intent = classifyQuestionIntent(question)): RetrievalResult {
  const startedAt = Date.now();
  const tokens = retrievalTokens(expandedQuery, intent);
  const matches = business.chunks.map((chunk) => {
    const lower = chunk.content.toLowerCase();
    const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
    return { chunk, score, evidenceScore: contentEvidenceScore(chunk.content, expandedQuery, intent, null, null, chunk.metadata) };
  }).filter((item) => item.score > 0);
  const rerankStartedAt = performance.now();
  const ranked = rankMatches(matches, business.sources, intent, 10);
  const rerankLatencyMs = performance.now() - rerankStartedAt;
  return {
    matches: ranked,
    mode: "memory_lexical",
    latencyMs: Date.now() - startedAt,
    rerankLatencyMs,
    normalizedQuery: question,
    expandedQuery,
    candidates: ranked.map((match, index) => {
      const source = business.sources.find((item) => item.id === match.chunk.sourceId);
      return {
        rank: index + 1,
        chunkId: match.chunk.id,
        sourceId: match.chunk.sourceId,
        source: source?.title ?? "Business source",
        url: source?.url ?? "",
        headingPath: Array.isArray(match.chunk.metadata.headingPath) ? match.chunk.metadata.headingPath.filter((item): item is string => typeof item === "string") : [],
        lexicalScore: null,
        vectorScore: null,
        fusionScore: match.score,
        evidenceScore: match.evidenceScore,
        sourceType: match.sourceType ?? "web_page",
        sourceBoost: match.sourceBoost ?? 0,
        rerankScore: match.score,
        selected: index < 4,
        rejectionReason: null,
      };
    }),
  };
}

async function databaseRetrieval(business: Business, question: string, expandedQuery = question, intent = classifyQuestionIntent(question)): Promise<RetrievalResult | null> {
  if (!pool) return null;
  const startedAt = Date.now();
  try {
    const lexicalQuery = retrievalTokens(expandedQuery, intent).map((token) => `${token}:*`).join(" | ");
    const lexicalResult = await pool.query<Record<string, unknown>>(
      `select id, source_id, content, content_hash, metadata,
              ts_rank_cd(search_vector, to_tsquery('simple', $2)) as lexical_score
       from knowledge_chunks
       where business_id = $1
         and search_vector @@ to_tsquery('simple', $2)
       order by lexical_score desc
       limit 20`,
      [business.id, lexicalQuery || "frontdeskwise-never-match"],
    );

    let queryVector: number[] | null = null;
    if (embeddingsConfigured()) {
      try {
        queryVector = (await embedTexts([expandedQuery]))?.[0] ?? null;
      } catch (error) {
        app.log.warn({ error: error instanceof Error ? error.message : "unknown embedding error" }, "Query embedding skipped");
      }
    }

    const vectorResult = queryVector
      ? await pool.query<Record<string, unknown>>(
        `select id, source_id, content, content_hash, metadata,
                1 - (embedding <=> $2::vector) as vector_score
         from knowledge_chunks
         where business_id = $1
           and embedding is not null
           and embedding_model = $3
           and embedding_dimensions = $4
         order by embedding <=> $2::vector
         limit 20`,
        [business.id, vectorLiteral(queryVector), embeddingModel(), embeddingDimensions()],
      )
      : { rows: [] as Record<string, unknown>[], rowCount: 0 };

    const records = new Map<string, { row: Record<string, unknown>; lexicalRank?: number; vectorRank?: number }>();
    lexicalResult.rows.forEach((row, index) => records.set(String(row.id), { row, lexicalRank: index + 1 }));
    vectorResult.rows.forEach((row, index) => {
      const id = String(row.id);
      const existing = records.get(id);
      if (existing) {
        existing.vectorRank = index + 1;
        existing.row.vector_score = row.vector_score;
      }
      else records.set(id, { row, vectorRank: index + 1 });
    });

    const matches: RetrievalMatch[] = [...records.values()].map(({ row, lexicalRank, vectorRank }) => ({
      chunk: {
        id: String(row.id),
        sourceId: String(row.source_id),
        content: String(row.content),
        contentHash: String(row.content_hash),
        metadata: asRecord(row.metadata),
      },
      score: (lexicalRank ? 1 / (60 + lexicalRank) : 0) + (vectorRank ? 1 / (60 + vectorRank) : 0),
      fusionScore: (lexicalRank ? 1 / (60 + lexicalRank) : 0) + (vectorRank ? 1 / (60 + vectorRank) : 0),
      lexicalScore: row.lexical_score === undefined || row.lexical_score === null ? null : Number(row.lexical_score),
      vectorScore: row.vector_score === undefined || row.vector_score === null ? null : Number(row.vector_score),
      lexicalRank: lexicalRank ?? null,
      vectorRank: vectorRank ?? null,
      evidenceScore: contentEvidenceScore(
        String(row.content),
        expandedQuery,
        intent,
        row.lexical_score === undefined || row.lexical_score === null ? null : Number(row.lexical_score),
        row.vector_score === undefined || row.vector_score === null ? null : Number(row.vector_score),
        asRecord(row.metadata),
      ),
    }));

    const rerankStartedAt = performance.now();
    const ranked = rankMatches(matches, business.sources, intent, 10);
    const rerankLatencyMs = performance.now() - rerankStartedAt;
    const selectedByChunk = new Map(ranked.map((match) => [match.chunk.id, match]));
    const sourceById = new Map(business.sources.map((source) => [source.id, source]));
    const candidates = [...records.values()].map(({ row, lexicalRank, vectorRank }) => {
      const chunkId = String(row.id);
      const match = matches.find((candidate) => candidate.chunk.id === chunkId);
      const selected = selectedByChunk.get(chunkId);
      const source = sourceById.get(String(row.source_id));
      const metadata = asRecord(row.metadata);
      const allowed = !source || sourceAllowedForIntent(intent, source);
      return {
        rank: 0,
        chunkId,
        sourceId: String(row.source_id),
        source: source?.title ?? "Business source",
        url: source?.url ?? "",
        headingPath: Array.isArray(metadata.headingPath) ? metadata.headingPath.filter((item): item is string => typeof item === "string") : [],
        lexicalScore: row.lexical_score === undefined || row.lexical_score === null ? null : Number(row.lexical_score),
        vectorScore: row.vector_score === undefined || row.vector_score === null ? null : Number(row.vector_score),
        fusionScore: match?.score ?? 0,
        evidenceScore: match?.evidenceScore ?? 0,
        sourceType: source ? sourceSemanticType(source) : "web_page",
        sourceBoost: source ? sourceBoost(intent, source) : 0,
        rerankScore: selected?.score ?? null,
        selected: Boolean(selected),
        rejectionReason: !allowed ? "irrelevant_source_type" : selected ? null : "reranked_below_top_10",
      } satisfies RetrievalCandidateDiagnostic;
    }).sort((left, right) => right.fusionScore - left.fusionScore || right.evidenceScore - left.evidenceScore)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    return {
      matches: ranked,
      mode: vectorResult.rowCount ? "hybrid_rrf" : "postgres_full_text",
      latencyMs: Date.now() - startedAt,
      rerankLatencyMs,
      normalizedQuery: question,
      expandedQuery,
      candidates: candidates.slice(0, 10),
    };
  } catch (error) {
    app.log.warn({ error: error instanceof Error ? error.message : "unknown retrieval error", businessId: business.id }, "Database retrieval fell back to memory");
    return null;
  }
}

function extractiveAnswer(
  business: Business,
  matches: RetrievalMatch[],
  intent: RetrievalIntent,
  tone: AnswerTone = business.agentConfig.tone,
): string {
  const candidates = matches.flatMap(({ chunk }) => chunk.content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 35)
    .filter((sentence) => !/^(home|about|contact|pricing|features?|services?|blog|menu|learn more|read more)\b/i.test(sentence)));
  const useful = candidates.filter((sentence) => !/terms of service|privacy policy|cookie policy|acceptance of terms|govern your use/i.test(sentence));
  const answerSignals: Record<RetrievalIntent, RegExp> = {
    services: /\b(service|solution|product|feature|capabilit|offer|provide|task|reminder|calendar|planning|schedule|voice|workflow|workspace|team)\b/i,
    hours: /\b(hour|open|close|schedule|available)\b/i,
    contact: /\b(contact|email|phone|call|reach|message|visit)\b/i,
    pricing: /\b(price|pricing|cost|rate|fee|quote|budget)\b/i,
    location: /\b(location|located|address|direction|area|serve|visit)\b/i,
    booking: /\b(book|booking|appointment|reserve|enroll|schedule)\b/i,
    permissions: /\b(permission|access|role|admin|authorization)\b/i,
    privacy: /\b(privacy|private|personal data|security|stored|oauth|token)\b/i,
    support: /\b(support|help|technical|login|issue)\b/i,
    policy: /\b(privacy|permission|security|data|terms|cookie|cancel|refund|policy)\b/i,
    reminders: /\b(reminder|unfinished|recap|task|planning|daily plan)\b/i,
    calendar: /\b(calendar|scheduling|schedule|sync|outlook|google)\b/i,
    voice: /\b(voice|dictat|spoken|speak|audio)\b/i,
    teams: /\b(team|workspace|collaborat|users|multiple people)\b/i,
    getting_started: /\b(start|get started|begin|first|try|signup|sign up|task|planning|reminder|calendar|feature|product|voice|use)\b/i,
    unsupported: /$^/i,
    general: /.+/i,
  };
  const selected = useful.filter((sentence) => answerSignals[intent].test(sentence)).slice(0, 3);
  const excerpt = shapeCustomerAnswer((selected.length ? selected : useful).join(" ").slice(0, 1_200).trim(), tone);
  if (!selected.length && ["pricing", "permissions", "privacy", "support", "policy", "contact", "location", "hours", "calendar", "reminders", "voice", "teams", "unsupported"].includes(intent)) return business.agentConfig.fallbackMessage;
  if (!excerpt) return business.agentConfig.fallbackMessage;
  if (intent === "services" && !/\b(offer|offers|provide|provides|services?|solutions?|products?)\b/i.test(excerpt)) {
    return `${business.name} offers the services described on its website: ${excerpt}`;
  }
  if (intent === "services" && !/\b(if you|tell me|help)\b/i.test(excerpt)) {
    return `${excerpt} If you tell me what you’re trying to automate or build, I can point you to the most relevant service.`;
  }
  return excerpt;
}

function answerWithGettingStartedCta(answer: string, intent: RetrievalIntent, primaryCta: PrimaryCta | null): string {
  // Conversion destinations are now returned as structured primaryCta data.
  // Never turn the business homepage into an unverified sales link in answer copy.
  const introduction = primaryCtaIntroduction(primaryCta, intent);
  if (!introduction || answer.includes(introduction)) return answer;
  return `${answer}\n\n${introduction}`;
}

const serviceWordsForAnswer = /\b(offer|offers|provide|provides|service|services|solution|solutions|product|products|feature|features|capabilit|automation|development|application|integration|tool|tools|task|reminder|calendar|planning|schedule|voice|workflow|workspace|team|build|software)\b/i;

function resolvedKnowledgeAnswer(business: Business, question: string, intent: RetrievalIntent): KnowledgeGap | null {
  const normalized = question.toLowerCase().replace(/\s+/g, " ").trim();
  const exact = business.knowledgeGaps.get(normalized);
  if (exact?.status === "resolved" && exact.approvedAnswer) return exact;
  const questionTokens = new Set(tokenise(normalized));
  if (!questionTokens.size) return null;
  return [...business.knowledgeGaps.values()]
    .filter((gap) => gap.status === "resolved" && Boolean(gap.approvedAnswer))
    .filter((gap) => {
      const gapIntent = !gap.intent || gap.intent === "general" ? classifyQuestionIntent(gap.question) : gap.intent;
      if (gapIntent !== intent) return false;
      const gapTokens = new Set(tokenise(gap.question));
      const overlap = [...questionTokens].filter((token) => gapTokens.has(token)).length / questionTokens.size;
      return overlap >= 0.5;
    })
    .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt))[0] ?? null;
}

function structuredFactAnswer(
  business: Business,
  question: string,
  intent: RetrievalIntent,
  facts = business.facts,
): StructuredFactAnswer | null {
  const kindByIntent: Partial<Record<RetrievalIntent, BusinessFact["kind"]>> = {
    hours: "hours",
    location: "location",
    contact: "contact",
    pricing: "pricing",
    policy: "policy",
    services: "service",
  };
  const kind = kindByIntent[intent];
  if (!kind || !facts.length) return null;
  const queryAliases: Record<string, string[]> = {
    hours: ["hour", "hours", "open", "opening", "close", "closing"],
    location: ["location", "located", "address", "direction"],
    contact: ["contact", "phone", "email", "call"],
    pricing: ["price", "pricing", "cost", "fee", "rate"],
    policy: ["policy", "policies", "cancel", "refund"],
    services: ["service", "services", "offer", "offers"],
  };
  const resolution = resolveBusinessFacts(facts, {
    kind,
    terms: [...tokenise(question), ...(queryAliases[intent] ?? [])],
  });
  const match = resolution.matches[0];
  if (!match || !match.matchedTerms.length || match.score <= 0) return null;
  const hasSpecificSubject = resolution.matches.some((candidate) => {
    const subjectTerms = tokenise(candidate.fact.subject);
    return subjectTerms.some((term) => match.matchedTerms.includes(term));
  });
  if (resolution.matches.length > 1 && !hasSpecificSubject) return null;
  const fact = match.fact;
  const value = fact.valueText;
  const answer = fact.kind === "hours"
    ? `${business.name}'s hours for ${fact.subject} are ${value}.`
    : fact.kind === "pricing"
      ? `${fact.subject} costs ${value}.`
      : fact.kind === "contact"
        ? `${fact.subject}: ${value}.`
        : fact.kind === "location"
          ? `${fact.subject} is located at ${value}.`
          : `${fact.subject}: ${value}.`;
  const source = fact.sourceId ? business.sources.find((item) => item.id === fact.sourceId) : null;
  return {
    answer,
    fact,
    confidenceScore: Math.min(0.99, 0.72 + fact.confidence * 0.2 + (match.authorityRank >= 400 ? 0.06 : 0)),
    citations: source ? [{ title: source.title, url: source.url, sourceId: source.id, pageType: source.pageType }] : [],
    conflicts: resolution.conflicts.length,
  };
}

async function answerQuestion(
  business: Business,
  question: string,
  options: { recordGap?: boolean; conversation?: Conversation; currentPage?: string | null; workflow?: ActiveWorkflowAnswerContext } = {},
) {
  const answerStartedAt = performance.now();
  const performanceTiming = {
    retrievalMs: 0,
    rerankMs: 0,
    modelRequestStartedMs: null as number | null,
    llmFirstTokenMs: null as number | null,
    llmTotalMs: 0,
  };
  const initialIntent = classifyQuestionIntent(question);
  const existingGap = business.knowledgeGaps.get(question.toLowerCase().replace(/\s+/g, " ").trim());
  const approvedGap = resolvedKnowledgeAnswer(business, question, initialIntent);
  if (/^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you)\b[.!? ]*$/i.test(question.trim())) {
    const modelUsage: ModelUsage = {
      route: "tier0",
      model: null,
      reason: "deterministic_greeting",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
    };
    return {
      answer: business.agentConfig.welcomeMessage,
      grounded: false,
      citations: [],
      knowledgeGap: null,
      confidenceScore: 1,
      confidenceBand: "high" as const,
      retrieval: { mode: "tier0_greeting", candidateCount: 0, topScore: 1, ...modelUsage },
      modelUsage,
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }
  if (approvedGap?.approvedAnswer && approvedGap.answerMode === "fixed_response") {
    const modelUsage: ModelUsage = {
      route: "tier0",
      model: null,
      reason: "approved_answer",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
    };
    return {
      answer: approvedGap.approvedAnswer,
      grounded: true,
      citations: [],
      knowledgeGap: null,
      confidenceScore: 0.99,
      confidenceBand: "high" as const,
      retrieval: { mode: "approved_answer", candidateCount: 0, topScore: 1, ...modelUsage },
      modelUsage,
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }
  const scopedFacts = workflowScopedFacts(business, options.workflow);
  const primaryCtaForAnswer = options.workflow ? null : primaryCtaForQuestion(business, question, initialIntent);
  const structured = initialIntent === "pricing"
    ? workflowPricingAnswer(business, options.workflow) ?? structuredFactAnswer(business, question, initialIntent, scopedFacts)
    : structuredFactAnswer(business, question, initialIntent, scopedFacts);
  if (structured) {
    const modelUsage: ModelUsage = {
      route: "tier0",
      model: null,
      reason: "structured_business_fact",
      inputTokens: 0,
      outputTokens: 0,
      estimatedCostUsd: 0,
      latencyMs: 0,
    };
    return {
      answer: answerWithGettingStartedCta(structured.answer, initialIntent, primaryCtaForAnswer),
      grounded: true,
      citations: structured.citations,
      knowledgeGap: null,
      confidenceScore: structured.confidenceScore,
      confidenceBand: structured.confidenceScore >= 0.78 ? "high" as const : "medium" as const,
      retrieval: {
        mode: "business_fact_resolver",
        intent: initialIntent,
        candidateCount: business.facts.length,
        topScore: structured.confidenceScore,
        sourceType: structured.fact.sourceType,
        sourceLabel: businessFactSourceLabel(structured.fact),
        factId: structured.fact.id,
        conflictCount: structured.conflicts,
        ...modelUsage,
      },
      modelUsage,
      primaryCta: primaryCtaForAnswer ?? undefined,
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }
  const queryContext = retrievalContext(business, question, options.conversation, options.currentPage, options.workflow);
  const intent = queryContext.intent;
  const retrieval = await databaseRetrieval(business, queryContext.normalizedQuery, queryContext.expandedQuery, intent)
    ?? memoryRetrieval(business, queryContext.normalizedQuery, queryContext.expandedQuery, intent);
  retrieval.matches = workflowScopedMatches(retrieval.matches, options.workflow, intent);
  performanceTiming.retrievalMs = retrieval.latencyMs;
  performanceTiming.rerankMs = retrieval.rerankLatencyMs;
  recordRetrieval(retrieval.mode, retrieval.latencyMs);
  const match = retrieval.matches[0];
  const secondMatch = retrieval.matches[1];
  const answerability = answerabilityDecision(retrieval.matches, business.sources, intent);
  const directSensitiveEvidence = hasDirectSensitiveEvidence(
    question,
    retrieval.matches.slice(0, 4).map(({ chunk }) => chunk.content.slice(0, 1_200)).join("\n\n"),
  );
  const materiallyRelevant = answerability.answerable && directSensitiveEvidence;
  const margin = secondMatch ? Math.min(0.12, Math.max(0, (match?.score ?? 0) - secondMatch.score) * 50) : 0.12;
  const confidenceScore = materiallyRelevant && match
    ? Math.min(0.98, 0.35 + (match.evidenceScore * 0.5) + (retrieval.mode === "hybrid_rrf" ? 0.12 : 0.05) + margin)
    : 0;
  const confidenceBand: "high" | "medium" | "low" = confidenceScore >= 0.78 ? "high" : confidenceScore >= 0.55 ? "medium" : "low";
  const retrievalContract = {
    mode: retrieval.mode,
    latencyMs: retrieval.latencyMs,
    rerankLatencyMs: retrieval.rerankLatencyMs,
    normalizedQuery: retrieval.normalizedQuery,
    expandedQuery: retrieval.expandedQuery,
    intent,
    candidateCount: retrieval.matches.length,
    topScore: answerability.score,
    answerabilityThreshold: answerability.threshold,
    answerability: directSensitiveEvidence ? answerability.reason : "insufficient_sensitive_claim_evidence",
    candidates: retrieval.candidates,
  };

  const decision = routeQuestion({
    question,
    hasMatch: materiallyRelevant,
    confidenceScore,
    candidateCount: retrieval.matches.length,
  });
  const context = retrieval.matches.slice(0, 4).map(({ chunk }) => {
    const source = business.sources.find((item) => item.id === chunk.sourceId);
    return `[${source?.title ?? "Business source"}] ${chunk.content.slice(0, 1_200)}`;
  }).join("\n\n");
  let generated: Awaited<ReturnType<typeof generateGroundedAnswer>> = null;
  let generationUsage: ModelUsage | null = null;
  let groundingCheckUsage: ModelUsage | null = null;
  let groundingCheckStatus: "not_run" | "passed" | "rejected" | "failed" = "not_run";
  if (materiallyRelevant && match && confidenceBand !== "low" && decision.model) {
    try {
      performanceTiming.modelRequestStartedMs = performance.now() - answerStartedAt;
      generated = await generateGroundedAnswer({
        question,
        context,
        decision,
        intent,
        tone: business.agentConfig.tone,
        customToneInstructions: business.agentConfig.customToneInstructions,
      });
      if (generated) generated.answer = shapeCustomerAnswer(generated.answer, business.agentConfig.tone);
      generationUsage = generated?.usage ?? null;
      performanceTiming.llmFirstTokenMs = generated?.usage.latencyMs ?? null;
      performanceTiming.llmTotalMs += generated?.usage.latencyMs ?? 0;
      if (generated) {
        const groundingCheck = await verifyGroundedAnswer({ question, answer: generated.answer, context });
        groundingCheckUsage = groundingCheck.usage;
        performanceTiming.llmTotalMs += groundingCheck.usage.latencyMs;
        groundingCheckStatus = groundingCheck.grounded ? "passed" : "rejected";
        if (!groundingCheck.grounded) generated = null;
      }
    } catch (error) {
      groundingCheckStatus = "failed";
      generated = null;
      app.log.warn({ error: error instanceof Error ? error.message : "unknown model error", businessId: business.id, route: decision.route }, "Grounded synthesis or verification failed; refusing to answer from unverified evidence");
    }
  }
  const fallbackUsage: ModelUsage = {
    route: decision.route,
    model: decision.model,
    reason: "extractive_fallback_or_unconfigured",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: decision.route === "tier0" ? 0 : null,
    latencyMs: 0,
  };
  const baseUsage = generationUsage ?? fallbackUsage;
  const modelUsage: ModelUsage = {
    ...baseUsage,
    reason: groundingCheckStatus === "rejected"
      ? "grounding_check_rejected"
      : groundingCheckStatus === "failed"
        ? "grounding_check_failed"
        : generationUsage
          ? generationUsage.reason
          : decision.model
            ? "extractive_fallback_or_unconfigured"
            : "llm_not_configured",
    inputTokens: baseUsage.inputTokens + (groundingCheckUsage?.inputTokens ?? 0),
    outputTokens: baseUsage.outputTokens + (groundingCheckUsage?.outputTokens ?? 0),
    estimatedCostUsd: baseUsage.estimatedCostUsd === null || groundingCheckUsage?.estimatedCostUsd === null
      ? null
      : (baseUsage.estimatedCostUsd ?? 0) + (groundingCheckUsage?.estimatedCostUsd ?? 0),
    latencyMs: baseUsage.latencyMs + (groundingCheckUsage?.latencyMs ?? 0),
  };
  const modelGenerationFailed = Boolean(decision.model && (!generated || groundingCheckStatus !== "passed"));
  const enrichedRetrieval = {
    ...retrievalContract,
    groundingCheckStatus,
    finalDecision: modelGenerationFailed
      ? "fallback_model_generation_or_grounding_failure"
      : materiallyRelevant && match && confidenceBand !== "low"
        ? "grounded_answer"
        : "knowledge_gap",
    ...modelUsage,
  };

  const citations = citationMatches(retrieval.matches, business.sources, intent, 2).map(({ chunk }) => {
    const source = business.sources.find((item) => item.id === chunk.sourceId);
    return source ? {
      title: source.title,
      url: source.url,
      sourceId: source.id,
      chunkId: chunk.id,
      pageType: source.pageType,
    } : null;
  }).filter((citation): citation is NonNullable<typeof citation> => Boolean(citation)).filter((citation, index, list) => list.findIndex((item) => item.sourceId === citation.sourceId) === index);

  if (modelGenerationFailed && materiallyRelevant && match) {
    return {
      answer: "I found relevant information, but I’m having trouble formatting the answer right now.",
      grounded: false,
      citations,
      knowledgeGap: null,
      quickActions: [{ label: "Try again", question }, knowledgeGapContactAction],
      confidenceScore,
      confidenceBand,
      retrieval: enrichedRetrieval,
      modelUsage,
      primaryCta: options.workflow ? undefined : primaryCtaForQuestion(business, question, intent) ?? undefined,
      failure: { kind: "temporary_ai" as const, retryable: true, retrievedEvidence: true },
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }

  if (!materiallyRelevant || !match || confidenceBand === "low" || modelGenerationFailed) {
    const gapReason = knowledgeGapReason({
      answerable: materiallyRelevant,
      hasMatch: Boolean(match),
      modelGenerationFailed,
      groundingCheckStatus,
    });
    const gap = options.recordGap === false ? (existingGap?.status === "open" ? existingGap : null) : rememberGap(business, question, intent, gapReason);
    return {
      answer: knowledgeGapMessage(business.name, intent),
      grounded: false,
      citations: [],
      knowledgeGap: gap,
      quickActions: [knowledgeGapContactAction],
      confidenceScore,
      confidenceBand,
      retrieval: enrichedRetrieval,
      modelUsage,
      primaryCta: options.workflow ? undefined : primaryCtaForQuestion(business, question, intent) ?? undefined,
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }

  if (generated) {
    return {
      answer: answerWithGettingStartedCta(generated.answer, intent, options.workflow ? null : primaryCtaForQuestion(business, question, intent)),
      grounded: true,
      citations,
      knowledgeGap: null,
      confidenceScore,
      confidenceBand,
      retrieval: enrichedRetrieval,
      modelUsage,
      primaryCta: options.workflow ? undefined : primaryCtaForQuestion(business, question, intent) ?? undefined,
      performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
    };
  }

  return {
    answer: answerWithGettingStartedCta(extractiveAnswer(business, retrieval.matches.slice(0, 4), intent, business.agentConfig.tone), intent, options.workflow ? null : primaryCtaForQuestion(business, question, intent)),
    grounded: true,
    citations,
    knowledgeGap: null,
    confidenceScore,
    confidenceBand,
    retrieval: enrichedRetrieval,
    modelUsage,
    primaryCta: options.workflow ? undefined : primaryCtaForQuestion(business, question, intent) ?? undefined,
    performance: { ...performanceTiming, backendTotalMs: performance.now() - answerStartedAt },
  };
}

type WidgetAnswerTiming = {
  retrievalMs: number;
  rerankMs: number;
  modelRequestStartedMs: number | null;
  llmFirstTokenMs: number | null;
  llmTotalMs: number;
  backendTotalMs: number;
};

type AnswerResult = Omit<Awaited<ReturnType<typeof answerQuestion>>, "performance"> & { performance?: WidgetAnswerTiming; primaryCta?: PrimaryCta };

type ActionFormSchema = {
  submitLabel: string;
  fields: Array<ActionFlow["fields"][number] & { value?: string }>;
};

type ConversationAnswerResult = Omit<AnswerResult, "failure"> & {
  quickActions?: Array<{ label: string; question: string }>;
  failure?: {
    kind: "temporary_ai" | "retrieval" | "backend";
    retryable: boolean;
    retrievedEvidence?: boolean;
  };
  actionDelivery?: {
    status: "saved" | "queued" | "failed";
    provider?: string;
  };
  handoff?: {
    status: ConversationStatus;
    reason: string;
    notificationStatus?: Exclude<HandoffNotificationStatus, null>;
  };
  silent?: boolean;
  action?: {
    id: string;
    key: string;
    status: "active" | "completed";
    captureMode: ConversationActionState["captureMode"];
    nextField?: string;
    linkUrl?: string;
    linkLabel?: string;
    lookup?: Record<string, unknown>;
    form?: ActionFormSchema;
    workflow?: ReturnType<typeof workflowSummary>;
  };
};

type ConversationDecisionTraceContext = {
  turnId: string;
  startedAt: number;
  orchestration: ReturnType<typeof decideConversationRoute>;
  actionBefore: ActionFlow | null;
  stateBefore: ConversationActionState | null;
};

function cloneConversationActionState(state: ConversationActionState | null | undefined): ConversationActionState | null {
  return state ? JSON.parse(JSON.stringify(state)) as ConversationActionState : null;
}

function temporaryConversationAnswer(
  question: string,
  kind: "temporary_ai" | "retrieval" | "backend" = "backend",
  citations: ConversationAnswerResult["citations"] = [],
  retrievedEvidence = false,
): ConversationAnswerResult {
  const modelUsage: ModelUsage = {
    route: "tier0",
    model: null,
    reason: kind === "temporary_ai" ? "temporary_ai_failure" : kind === "retrieval" ? "retrieval_failure" : "temporary_backend_failure",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: 0,
  };
  return {
    answer: retrievedEvidence
      ? "I found relevant information, but I’m having trouble formatting the answer right now."
      : "I’m having trouble responding right now.",
    grounded: false,
    citations,
    knowledgeGap: null,
    confidenceScore: 0,
    confidenceBand: "low",
    retrieval: { mode: kind === "retrieval" ? "retrieval_failure" : "temporary_failure", intent: classifyQuestionIntent(question), candidateCount: 0, topScore: 0, ...modelUsage },
    modelUsage,
    quickActions: [{ label: "Try again", question }, knowledgeGapContactAction],
    failure: { kind, retryable: true, retrievedEvidence },
  };
}

function actionFormSchema(action: ActionFlow, state: ConversationActionState): ActionFormSchema {
  return {
    submitLabel: action.completion.submitLabel ?? action.completion.linkLabel ?? "Submit request",
    fields: (action.steps?.length ? workflowFormFields(action, state) : formFields(action, state)).map((field) => ({ ...field, value: state.values[field.key] ?? "" })),
  };
}

function actionStatePayload(action: ActionFlow, state: ConversationActionState): ConversationAnswerResult["action"] {
  const workflow = action.steps?.length ? currentWorkflowStep(action, state) : null;
  const workflowState = action.steps?.length ? workflowSummary(action, state) : null;
  const next = workflow?.fieldKey
    ? action.fields.find((field) => field.key === workflow.fieldKey || field.id === workflow.fieldKey) ?? null
    : nextConversationalField(action, state);
  const showForm = state.status === "active" && (Boolean(state.formShown) || state.captureMode === "form" || workflow?.type === "form");
  const completionUrl = state.completionUrl ?? action.completion.linkUrl;
  const lookup = Object.fromEntries(Object.entries(state.lookupResults ?? {}).flatMap(([key, value]) => {
    if (!value || typeof value !== "object" || !Array.isArray((value as Record<string, unknown>).matches)) return [];
    const record = value as Record<string, unknown>;
    return [[key, { status: record.status, matches: (record.matches as unknown[]).slice(0, 20) }]];
  }));
  return {
    id: action.id,
    key: action.key,
    status: state.status,
    captureMode: state.captureMode,
    ...(next ? { nextField: next.key } : {}),
    ...(state.status === "completed" && completionUrl
      ? { linkUrl: completionUrl, linkLabel: action.completion.linkLabel ?? action.completion.submitLabel ?? "Continue" }
      : {}),
    ...(Object.keys(lookup).length ? { lookup } : {}),
    ...(showForm ? { form: actionFormSchema(action, state) } : {}),
    ...(workflowState ? {
      workflow: {
        ...workflowState,
        collected: Object.fromEntries(Object.entries(workflowState.collected).filter(([key]) => !/^(email|phone|name|parent_name)$/i.test(key))),
      },
    } : {}),
  };
}

function actionAnswer(action: ActionFlow, state: ConversationActionState, answer: string, primaryCta?: PrimaryCta | null): ConversationAnswerResult {
  const modelUsage: ModelUsage = {
    route: "tier0",
    model: null,
    reason: "deterministic_action_flow",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: 0,
  };
  return {
    answer,
    grounded: false,
    citations: [],
    knowledgeGap: null,
    confidenceScore: 1,
    confidenceBand: "high",
    retrieval: { mode: "action_flow", candidateCount: 0, topScore: 1, ...modelUsage },
    modelUsage,
    action: actionStatePayload(action, state),
    ...(primaryCta ? { primaryCta } : {}),
  };
}

function actionAnswerWithKnowledge(
  result: AnswerResult,
  action: ActionFlow,
  state: ConversationActionState,
  prompt: string,
): ConversationAnswerResult {
  // An interruption is still inside the active journey. Knowledge answers
  // must not smuggle the global primary CTA or a generic lead form into it.
  const { primaryCta: _primaryCta, quickActions: _quickActions, ...knowledgeAnswer } = result;
  return {
    ...knowledgeAnswer,
    answer: `${result.answer}\n\nBack to ${isPlanSelectionWorkflow(action) ? "your plan" : "the workflow"}: ${prompt}`,
    action: actionStatePayload(action, state),
  };
}

function assistantBrandName(business: Business): string {
  const configured = business.agentConfig.assistantName.trim();
  return configured.replace(/\s+AI Assistant$/i, "").replace(/\s+Assistant$/i, "").trim() || business.name;
}

function directLinkCustomerMessage(business: Business, action: ActionFlow): string {
  const configured = action.completion.message?.trim() ?? "";
  const genericMessages = new Set([
    "The verified link is ready.",
    "You can try the demo here.",
    "Here's the verified link.",
    "Here’s the verified link.",
  ]);
  if (configured && !genericMessages.has(configured)) return configured;
  const label = action.completion.linkLabel ?? action.name;
  if (/\bdemo\b/i.test(`${action.name} ${label}`)) return `Absolutely — you can try ${assistantBrandName(business)} here.`;
  return `Absolutely — ${label.toLowerCase()} is ready here.`;
}

const actionKnowledgeIntents = new Set<RetrievalIntent>(["services", "hours", "contact", "location", "pricing", "permissions", "privacy", "support", "policy", "reminders", "calendar", "voice", "teams"]);

function workflowPrompt(action: ActionFlow, state: ConversationActionState, step: NonNullable<ReturnType<typeof currentWorkflowStep>>): string {
  if (step.type === "confirm") return workflowLookupPrompt(state) ?? step.question ?? "Would you like to continue?";
  const field = workflowField(action, step.fieldKey);
  if (field) return fieldPrompt(field);
  return step.question ?? step.label ?? `Let's continue with ${action.name.toLowerCase()}.`;
}

function actionConfigString(config: Record<string, unknown>, key: string): string | null {
  const value = config[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function configuredActionProvider(action: ActionFlow): string | null {
  return actionProviderForFlow(action);
}

async function providerIntegrationConnected(businessId: string, provider: string | null): Promise<boolean> {
  if (!provider) return false;
  if (!pool) return provider === "jackrabbit" && jackrabbitEnvironmentFallbackAllowed() && Boolean(process.env.FRONTDESKWISE_JACKRABBIT_API_TOKEN?.trim());
  const result = await pool.query(
    `select 1 from crm_integrations
     where business_id = $1 and provider = $2 and connection_status = 'active'
     limit 1`,
    [businessId, provider],
  );
  return Boolean(result.rowCount);
}

async function actionReadinessForBusiness(business: Pick<Business, "id">, action: ActionFlow): Promise<ActionReadiness> {
  const readiness = actionReadiness(action);
  if (!readiness.ready || action.executionMode !== "PROVIDER_FLOW") return readiness;
  const provider = configuredActionProvider(action);
  if (!provider) return { ready: false, reason: "missing_configuration" };
  if (!(await providerIntegrationConnected(business.id, provider))) {
    return { ready: false, reason: "missing_provider_connection" };
  }
  return readiness;
}

function actionConfigValue(config: Record<string, unknown>, state: ConversationActionState, key: string, defaultField: string): string | null {
  const configuredField = actionConfigString(config, key);
  const value = state.values[configuredField ?? defaultField];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

type WorkflowLookupMatch = {
  id: string;
  providerObjectId?: string | null;
  name: string;
  location: string | null;
  day: string | null;
  startTime: string | null;
  price: string | number | null;
  availability: number | null;
  destination?: { url: string } | null;
};

type WorkflowLookupResolution = { status?: string; matches: WorkflowLookupMatch[] };

function workflowLookupResolutions(state: ConversationActionState): WorkflowLookupResolution[] {
  return Object.values(state.lookupResults ?? {}).filter((value): value is WorkflowLookupResolution => Boolean(
    value && typeof value === "object" && Array.isArray((value as Record<string, unknown>).matches),
  ));
}

function workflowLookupPrompt(state: ConversationActionState): string | null {
  const resolution = workflowLookupResolutions(state).at(-1);
  if (!resolution) return null;
  if (!resolution.matches.length) return "I couldn’t find a live option matching those details. Would you like the team to help you find the right option?";
  if (resolution.matches.length === 1) {
    const match = resolution.matches[0];
    const schedule = [match.day, match.startTime].filter(Boolean).join(" at ");
    return `I found ${match.name}${match.location ? ` in ${match.location}` : ""}${schedule ? `, ${schedule}` : ""}. Shall I prepare the registration link?`;
  }
  const options = resolution.matches.slice(0, 5).map((match, index) => {
    const schedule = [match.day, match.startTime].filter(Boolean).join(" at ");
    const availability = match.availability === null ? "" : ` (${match.availability} openings)`;
    return `${index + 1}. ${match.name}${schedule ? ` — ${schedule}` : ""}${availability}`;
  });
  return `I found ${resolution.matches.length} matching options. Reply with the number you want:\n${options.join("\n")}`;
}

function verifiedPlanFactsForWorkflow(business: Business) {
  return business.facts
    .filter((fact) => fact.active)
    .map((fact) => ({
      subject: fact.subject,
      predicate: fact.predicate,
      valueText: fact.valueText,
      verified: fact.sourceType === "owner_structured"
        || fact.sourceType === "live_system"
        || fact.authority === "owner_verified"
        || fact.authority === "system_of_record",
    }));
}

function planRecommendationFromState(business: Business, action: ActionFlow, state: ConversationActionState): PlanRecommendation | null {
  if (!isPlanSelectionWorkflow(action)) return null;
  return recommendPlan(state.values, verifiedPlanFactsForWorkflow(business));
}

function planRecommendationInState(state: ConversationActionState): PlanRecommendation | null {
  const result = state.lookupResults?.["recommend-plan"];
  if (!result || typeof result !== "object") return null;
  const recommendation = (result as Record<string, unknown>).recommendation;
  return recommendation && typeof recommendation === "object" ? recommendation as PlanRecommendation : null;
}

function workflowCtaForStep(business: Business, action: ActionFlow, step: NonNullable<ReturnType<typeof currentWorkflowStep>>): PrimaryCta | null {
  if (step.type !== "redirect") return null;
  const configured = primaryActionForBusiness(business);
  return primaryCtaForAction(configured ?? action);
}

async function resolveWorkflowActionResources(
  business: Business,
  action: ActionFlow,
  step: NonNullable<ReturnType<typeof currentWorkflowStep>>,
  state: ConversationActionState,
): Promise<ReturnType<typeof resolveAction>> {
  const config = step.config ?? {};
  const typeValue = actionConfigString(config, "resourceType") ?? "registration";
  const type = (ACTION_RESOURCE_TYPES as readonly string[]).includes(typeValue) ? typeValue as ActionResourceType : "registration";
  const filters: Record<string, unknown> = {};
  const configuredFilters = config.filters && typeof config.filters === "object" && !Array.isArray(config.filters) ? asRecord(config.filters) : {};
  Object.assign(filters, configuredFilters);
  const filterFields: Array<[string, string]> = [
    ["program", "programField"],
    ["location", "locationField"],
    ["day", "dayField"],
    ["role", "roleField"],
    ["department", "departmentField"],
    ["service", "serviceField"],
  ];
  for (const [field, configKey] of filterFields) {
    const constant = actionConfigString(config, field);
    const fromState = actionConfigValue(config, state, configKey, field);
    if (constant ?? fromState) filters[field] = constant ?? fromState;
  }
  const provider = actionConfigString(config, "provider") ?? configuredActionProvider(action);
  if (provider === "jackrabbit") {
    const program = typeof filters.program === "string" ? filters.program : "";
    if (!program) return { status: "not_found", matches: [] };
    try {
      const credentials = await resolveJackrabbitCredentials(business.id, actionConfigString(config, "integrationId") ?? undefined);
      const registrationBaseUrl = actionConfigString(config, "registrationBaseUrl");
      const providerInstance = jackrabbitProviderForToken(credentials.apiToken);
      const resources = await providerInstance.findRegistrationResources(
        business.id,
        {
          name: program,
          ...(typeof filters.location === "string" ? { location: filters.location } : {}),
          ...(typeof filters.day === "string" ? { day: filters.day } : {}),
        },
        registrationBaseUrl ? { baseUrl: registrationBaseUrl, classIdParam: actionConfigString(config, "classIdParam") ?? "classId", fieldMappings: {} } : undefined,
        state.values,
      );
      return resolveAction(resources, {
        type,
        filters,
        includeWaitlist: config.includeWaitlist === true,
      });
    } catch (error) {
      app.log.warn({ businessId: business.id, error: error instanceof Error ? error.message : "provider lookup failed" }, "Action provider lookup failed");
      return { status: "not_found", matches: [] };
    }
  }
  return resolveAction(business.actionResources, {
    type,
    filters,
    includeWaitlist: config.includeWaitlist === true,
  });
}

async function advanceWorkflowAutomation(
  business: Business,
  action: ActionFlow,
  state: ConversationActionState,
): Promise<NonNullable<ReturnType<typeof currentWorkflowStep>> | null> {
  let step = currentWorkflowStep(action, state);
  const visited = new Set<string>();
  while (step && !visited.has(step.id) && ["lookup", "recommend", "generate_link", "create_lead", "book", "api_action", "notify", "handoff", "complete"].includes(step.type)) {
    visited.add(step.id);
    if (step.type === "lookup" || step.type === "recommend") {
        const cachedResult = state.lookupResults?.[step.id];
        const result = cachedResult !== undefined
          ? cachedResult
          : step.type === "recommend" && isPlanSelectionWorkflow(action)
            ? (() => {
              const recommendation = planRecommendationFromState(business, action, state);
              return recommendation ? { status: "matched", matches: [], recommendation } : undefined;
            })()
          : step.config?.provider || step.config?.resourceType || step.config?.filters || configuredActionProvider(action)
            ? await resolveWorkflowActionResources(business, action, step, state)
            : step.config?.result;
      if (result !== undefined) state.lookupResults = { ...(state.lookupResults ?? {}), [step.id]: result };
      if (step.type === "recommend" && isPlanSelectionWorkflow(action) && result === undefined) break;
    }
    if (step.type === "generate_link") {
      const resolutions = workflowLookupResolutions(state);
      const candidates = resolutions.flatMap((resolution) => resolution.matches);
      const selected = state.selectedActionResourceId
        ? candidates.find((match) => match.id === state.selectedActionResourceId)
        : resolutions.every((resolution) => resolution.matches.length === 1) ? candidates[0] : undefined;
      if (selected?.destination?.url) state.completionUrl = selected.destination.url;
    }
    const transition = transitionWorkflow(action, state, step.id);
    step = transition.step;
  }
  return step;
}

function repeatableWorkflowConfig(action: ActionFlow): { entityType: string; entityLabel: string; fieldKeys: string[]; maxParticipants: number } | null {
  const config = action.steps?.[0]?.config;
  if (!config || config.repeatableEntity !== true) return null;
  return {
    entityType: typeof config.entityType === "string" ? config.entityType : "participant",
    entityLabel: typeof config.entityLabel === "string" ? config.entityLabel : "participant",
    fieldKeys: Array.isArray(config.participantFieldKeys) ? config.participantFieldKeys.filter((value): value is string => typeof value === "string") : [],
    maxParticipants: typeof config.maxParticipants === "number" && Number.isInteger(config.maxParticipants) ? Math.max(1, Math.min(20, config.maxParticipants)) : 8,
  };
}

function wantsAnotherParticipant(question: string): boolean {
  return /\b(another|add|different)\b.{0,24}\b(child|student|participant|person|guest|member)\b|\b(i have|we have)\s+(another|one more)\b/i.test(question);
}

function startAnotherWorkflowParticipant(state: ConversationActionState, config: ReturnType<typeof repeatableWorkflowConfig>, action: ActionFlow): boolean {
  if (!config || !action.steps?.length) return false;
  const participants = state.participants ?? [];
  if (participants.length >= config.maxParticipants) return false;
  completeActiveWorkflowParticipant(state);
  addWorkflowParticipant(state, config.entityType);
  for (const key of config.fieldKeys) delete state.values[key];
  state.skipped = (state.skipped ?? []).filter((key) => !config.fieldKeys.includes(key));
  state.currentStepId = action.steps[0].id;
  state.formShown = false;
  return true;
}

async function continueWorkflowActionConversation(
  business: Business,
  conversation: Conversation,
  action: ActionFlow,
  question: string,
  starting = false,
): Promise<ConversationAnswerResult> {
  const state = conversation.actionState ?? createActionState(action);
  conversation.actionState = state;
  migrateWorkflowState(action, state);
  if (!state.currentStepId) state.currentStepId = action.steps?.[0]?.id;
  const repeatable = repeatableWorkflowConfig(action);
  if (repeatable && !state.participants?.length) addWorkflowParticipant(state, repeatable.entityType);

  // Decide whether this is a side question before extracting values. A pricing
  // question can mention a competing audience (for example, "what does the
  // team plan cost?") without being an answer to the paused field.
  const initialOrchestration = decideConversationRoute({ message: question, activeAction: action, actionState: state });
  const preserveWorkflowState = initialOrchestration.route === "INTERRUPTION"
    || initialOrchestration.route === "EXPLICIT_ACTION"
    || initialOrchestration.route === "HUMAN_HANDOFF";

  // A visitor can answer several questions in one sentence, or correct an
  // earlier answer while the workflow is waiting on a different field. Apply
  // only values declared by the action; the cursor still advances
  // deterministically from the current step.
  const extractedValues = preserveWorkflowState ? {} : extractWorkflowValues(action, question);
  const extracted = applyWorkflowValues(action, state, extractedValues);
  invalidateWorkflowLookups(action, state, extracted.updated);
  for (const fieldKey of extracted.updated) {
    const field = workflowField(action, fieldKey);
    if (repeatable && field && repeatable.fieldKeys.includes(field.key)) setWorkflowParticipantValue(state, field.key, state.values[field.key]);
    await recordConversionEvent(business, {
      event: "FIELD_COMPLETED",
      conversationId: conversation.id,
      flowId: action.id,
      fieldId: fieldKey,
      metadata: { extracted: true },
    });
  }
  const currentAfterExtraction = currentWorkflowStep(action, state);
  const orchestration = preserveWorkflowState
    ? initialOrchestration
    : decideConversationRoute({ message: question, activeAction: action, actionState: state });
  const isSideQuestion = orchestration.route === "INTERRUPTION";
  if (orchestration.route === "EXPLICIT_ACTION") {
    return actionAnswer(action, state, `You’re currently working on ${action.name.toLowerCase()}. We can continue that journey, or I can switch to ${orchestration.actionIntent.replace(/_/g, " ")} if you prefer. ${currentAfterExtraction ? workflowPrompt(action, state, currentAfterExtraction) : "What would you like to do?"}`);
  }
  if (isSideQuestion) {
    pushWorkflowInterruption(state, {
      intent: orchestration.interruptionIntent ?? classifyQuestionIntent(question),
      question,
      returnStepId: currentAfterExtraction?.id ?? state.currentStepId ?? null,
    });
    const knowledge = await answerQuestion(business, question, { conversation, workflow: { action, state } });
    return actionAnswerWithKnowledge(knowledge, action, state, currentAfterExtraction ? workflowPrompt(action, state, currentAfterExtraction) : "The workflow is ready to continue.");
  }

  if (repeatable && wantsAnotherParticipant(question) && startAnotherWorkflowParticipant(state, repeatable, action)) {
    return actionAnswer(action, state, `Absolutely — let’s add another ${repeatable.entityLabel}. ${workflowPrompt(action, state, currentWorkflowStep(action, state) ?? action.steps![0])}`);
  }

  if (!extracted.updated.length && actionKnowledgeIntents.has(classifyQuestionIntent(question))) {
    const current = currentWorkflowStep(action, state);
    pushWorkflowInterruption(state, {
      intent: classifyQuestionIntent(question),
      question,
      returnStepId: current?.id ?? state.currentStepId ?? null,
    });
    const knowledge = await answerQuestion(business, question, { conversation, workflow: { action, state } });
    return actionAnswerWithKnowledge(knowledge, action, state, current ? workflowPrompt(action, state, current) : "The workflow is ready to continue.");
  }
  if (state.interruptionStack?.length) resumeWorkflowInterruption(state);

  let step = await advanceWorkflowAutomation(business, action, state);
  if (!step || (state.status as ConversationActionState["status"]) === "completed") return completeActionConversation(business, conversation, action, state);
  state.currentStepId = step.id;

  if (isPlanSelectionWorkflow(action)) {
    const recommendation = planRecommendationInState(state);
    if (step.id === "recommend-plan" && !recommendation) {
      return actionAnswer(action, state, "I have your answers. I’m still waiting for verified plan information before I recommend a plan.");
    }
    if (recommendation && (step.id === "explain-plan" || step.id === "get-started")) {
      if (step.id === "explain-plan") {
        transitionWorkflow(action, state, step.id);
        const pricingStep = currentWorkflowStep(action, state);
        if (pricingStep?.id === "show-pricing") transitionWorkflow(action, state, pricingStep.id);
        step = currentWorkflowStep(action, state);
        if (step) state.currentStepId = step.id;
      }
      const readyStep = currentWorkflowStep(action, state);
      const cta = readyStep ? workflowCtaForStep(business, action, readyStep) : null;
      return actionAnswer(action, state, `${planRecommendationMessage(recommendation)}\n\nReady to get started?`, cta);
    }
  }

  if (starting) {
    if (step.type === "form") {
      state.formShown = true;
      await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
      return actionAnswer(action, state, "Great — just complete these details below and I’ll prepare the next step.");
    }
    await recordConversionEvent(business, { event: "FIELD_VIEWED", conversationId: conversation.id, flowId: action.id, fieldId: step.fieldKey ?? step.id });
    return actionAnswer(action, state, "Sure — I can help with " + action.name.toLowerCase() + ". " + workflowPrompt(action, state, step));
  }

  if (state.formShown || step.type === "form") {
    state.formShown = true;
    return actionAnswer(action, state, "Please complete the details below to continue.");
  }

  if (step.type === "confirm") {
    const resolution = workflowLookupResolutions(state).at(-1);
    if (resolution && resolution.matches.length > 1) {
      const selectedIndex = /^(?:option\s*)?(\d+)$/i.exec(question.trim());
      if (selectedIndex) {
        const candidate = resolution.matches[Number(selectedIndex[1]) - 1];
        if (candidate) {
          state.selectedActionResourceId = candidate.id;
          transitionWorkflow(action, state, step.id);
        } else {
          return actionAnswer(action, state, "That option is not available. " + workflowPrompt(action, state, step));
        }
      } else {
        return actionAnswer(action, state, workflowPrompt(action, state, step));
      }
    } else {
      if (!/^(yes|y|sure|ok|okay|please|continue|do it|go ahead)\b/i.test(question.trim())) {
        return actionAnswer(action, state, "No problem. " + workflowPrompt(action, state, step));
      }
      transitionWorkflow(action, state, step.id);
    }
  } else {
    const field = workflowField(action, step.fieldKey);
    if (!field && !step.fieldKey) {
      transitionWorkflow(action, state, step.id);
    } else {
      const alreadyExtracted = field?.key ? extracted.updated.includes(field.key) : false;
      if (!alreadyExtracted) {
        if (extracted.updated.length) {
          return actionAnswer(action, state, `Thanks — ${workflowPrompt(action, state, step)}`);
        }
        const input = applyWorkflowInput(action, state, question);
        if (!input.ok) return actionAnswer(action, state, `${input.error ?? "Please check that value."} ${workflowPrompt(action, state, step)}`);
        if (repeatable && input.value && repeatable.fieldKeys.includes(field?.key ?? step.fieldKey ?? "")) setWorkflowParticipantValue(state, field?.key ?? step.fieldKey ?? "", input.value);
        await recordConversionEvent(business, {
          event: "FIELD_COMPLETED",
          conversationId: conversation.id,
          flowId: action.id,
          fieldId: field?.key ?? step.fieldKey ?? step.id,
        });
      }
    }
  }

  step = await advanceWorkflowAutomation(business, action, state);
  if (!step || state.status === "completed") return completeActionConversation(business, conversation, action, state);
  state.currentStepId = step.id;
  if (step.type === "form") {
    state.formShown = true;
    await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
    return actionAnswer(action, state, "Almost done — just leave the remaining details below.");
  }
  await recordConversionEvent(business, { event: "FIELD_VIEWED", conversationId: conversation.id, flowId: action.id, fieldId: step.fieldKey ?? step.id });
  return actionAnswer(action, state, "Thanks — " + workflowPrompt(action, state, step));
}

async function continueActionConversation(
  business: Business,
  conversation: Conversation,
  question: string,
  options: { sourcePage?: string | null } = {},
): Promise<ConversationAnswerResult | null> {
  let action = conversation.actionState
    ? business.actions.find((candidate) => candidate.id === conversation.actionState?.actionId) ?? null
    : null;

  if (!action || conversation.actionState?.status === "completed") {
    action = detectAction(business.actions, question, business.primaryActionId);
    if (!action) return null;
    const readiness = await actionReadinessForBusiness(business, action);
    if (!readiness.ready) {
      // Provider-backed actions must fail closed. The ordinary knowledge path
      // can still answer the visitor or offer a safe human follow-up, but a
      // missing connection must never start a flow that cannot verify live
      // availability or produce a trusted destination.
      return null;
    }
    const state = createActionState(action);
    state.sourcePage = options.sourcePage ?? null;
    conversation.actionState = state;
    await recordConversionEvent(business, {
      event: "FLOW_STARTED",
      conversationId: conversation.id,
      flowId: action.id,
      metadata: { flowKey: action.key },
    });
    const directCta = primaryCtaForAction(action);
    if (action.executionMode === "DIRECT_LINK" && directCta?.url) {
      state.status = "completed";
      state.completedAt = new Date().toISOString();
      conversation.actionTaken = action.key;
      await recordConversionEvent(business, {
        event: "FLOW_COMPLETED",
        conversationId: conversation.id,
        flowId: action.id,
        metadata: { executionMode: action.executionMode, destination: directCta.url },
      });
      const directAnswer = actionAnswer(action, state, directLinkCustomerMessage(business, action));
      const { action: _action, ...answerWithoutAction } = directAnswer;
      return { ...answerWithoutAction, primaryCta: directCta };
    }
    if (action.steps?.length) return continueWorkflowActionConversation(business, conversation, action, question, true);
    const next = nextConversationalField(action, state);
    if (state.captureMode === "form" || !next) {
      state.formShown = true;
      await recordConversionEvent(business, {
        event: "FORM_DISPLAYED",
        conversationId: conversation.id,
        flowId: action.id,
      });
      const formMessage = "Absolutely — I can help with that. Just leave your details and the team can take it from here.";
      if (actionKnowledgeIntents.has(classifyQuestionIntent(question))) {
        const knowledge = await answerQuestion(business, question);
        return actionAnswerWithKnowledge(knowledge, action, state, formMessage);
      }
      return actionAnswer(action, state, formMessage);
    }
    await recordConversionEvent(business, {
      event: "FIELD_VIEWED",
      conversationId: conversation.id,
      flowId: action.id,
      fieldId: next.key,
    });
    if (actionKnowledgeIntents.has(classifyQuestionIntent(question))) {
      const knowledge = await answerQuestion(business, question);
      return actionAnswerWithKnowledge(knowledge, action, state, fieldPrompt(next));
    }
    return actionAnswer(action, state, "Sure — I can help with " + action.name.toLowerCase() + ". " + fieldPrompt(next));
  }

  const activeReadiness = await actionReadinessForBusiness(business, action);
  if (!activeReadiness.ready) return null;

  if (action.steps?.length) return continueWorkflowActionConversation(business, conversation, action, question);

  const state = conversation.actionState ?? createActionState(action);
  conversation.actionState = state;
  if (options.sourcePage) state.sourcePage = options.sourcePage;
  if (!state.captureMode || !Array.isArray(state.conversationalKeys)) {
    const defaults = createActionState(action, state.startedAt);
    state.captureMode = defaults.captureMode;
    state.conversationalKeys = defaults.conversationalKeys;
  }
  if (classifyVisitorRequest(question).mode === "informational") {
    const knowledge = await answerQuestion(business, question);
    const current = nextConversationalField(action, state);
    return actionAnswerWithKnowledge(knowledge, action, state, state.formShown ? "The form is ready below." : current ? fieldPrompt(current) : "The form is ready below.");
  }
  if (actionKnowledgeIntents.has(classifyQuestionIntent(question))) {
    const knowledge = await answerQuestion(business, question);
    const current = nextConversationalField(action, state);
    if (state.formShown) {
      await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
    } else if (current) {
      await recordConversionEvent(business, { event: "FIELD_VIEWED", conversationId: conversation.id, flowId: action.id, fieldId: current.key });
    }
    return actionAnswerWithKnowledge(knowledge, action, state, state.formShown ? "The form is ready below." : current ? fieldPrompt(current) : "The form is ready below.");
  }
  if (state.formShown) {
    return actionAnswer(action, state, "Please complete the form below to continue.");
  }

  const current = nextConversationalField(action, state);
  if (!current) {
    if (state.captureMode === "hybrid") {
      state.formShown = true;
      await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
      return actionAnswer(action, state, "Almost done — just leave your details below.");
    }
    return completeActionConversation(business, conversation, action, state);
  }

  const skipOptional = !current.required && /^(skip|no thanks|none|not now|prefer not to say)$/i.test(question.trim());
  if (skipOptional) {
    state.skipped = [...new Set([...(state.skipped ?? []), current.key])];
  } else {
    const validation = validateFieldValue(current, question);
    if (!validation.value) {
      return actionAnswer(action, state, (validation.error ?? ("Please share your " + current.label.toLowerCase() + ".")) + " " + fieldPrompt(current));
    }
    state.values[current.key] = validation.value;
    await recordConversionEvent(business, {
      event: "FIELD_COMPLETED",
      conversationId: conversation.id,
      flowId: action.id,
      fieldId: current.key,
    });
  }
  const next = nextConversationalField(action, state);
  if (next) {
    await recordConversionEvent(business, { event: "FIELD_VIEWED", conversationId: conversation.id, flowId: action.id, fieldId: next.key });
    return actionAnswer(action, state, "Thanks — " + fieldPrompt(next));
  }

  if (state.captureMode === "hybrid") {
    state.formShown = true;
    await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
    return actionAnswer(action, state, "Almost done — just leave your details below.");
  }

  return completeActionConversation(business, conversation, action, state);
}

async function completeActionConversation(
  business: Business,
  conversation: Conversation,
  action: ActionFlow,
  state: ConversationActionState,
): Promise<ConversationAnswerResult> {
  const summary = action.steps?.length ? workflowSummary(action, state) : null;
  const resolutions = workflowLookupResolutions(state);
  const candidates = resolutions.flatMap((resolution) => resolution.matches);
  const selectedResource = state.selectedActionResourceId
    ? candidates.find((match) => match.id === state.selectedActionResourceId)
    : candidates.length === 1 ? candidates[0] : undefined;
  const qualification = Object.fromEntries(Object.entries(state.values).filter(([key]) => !/^(email|phone|name|parent_name)$/i.test(key)));
  const structuredWorkflowMetadata = {
    workflow: action.key,
    workflowState: summary?.currentState ?? (state.status === "completed" ? "completed" : "collecting"),
    nextBestAction: summary?.nextBestAction ?? "CAPTURE_DETAILS",
    workflowProgressPercent: summary?.progressPercent ?? null,
    workflowMissing: summary?.missing ?? [],
    qualification,
    selectedService: selectedResource?.name ?? state.values.program ?? null,
    selectedLocation: selectedResource?.location ?? state.values.location ?? null,
    schedulePreference: state.values.schedule_preference ?? null,
    providerObjectId: selectedResource?.providerObjectId ?? state.selectedActionResourceId ?? null,
    conversionStage: state.completionUrl ? "registration_link_sent" : state.status === "completed" ? "qualified" : "in_progress",
  };
  const submission = await persistActionSubmission(business, action, conversation, state.values, state.sourcePage ?? null);
  if (submission.status === "completed") {
    state.status = "completed";
    state.formShown = false;
    return actionAnswer(action, state, action.completion.message);
  }
  state.status = "completed";
  state.completedAt = new Date().toISOString();
  state.formShown = false;
  if (state.participants?.length) completeActiveWorkflowParticipant(state);
  conversation.actionTaken = action.key;
  let answer = action.completion.message;
  if (action.completion.linkTemplate && action.completion.completionMode !== "native_form" && action.completion.completionMode !== "human_follow_up") {
    try {
      const generated = generateCompletionLink(action.completion.linkTemplate, state.values);
      state.completionUrl = generated.url;
      if (generated.missingFields.length) {
        app.log.info({ businessId: business.id, actionId: action.id, missingFields: generated.missingFields }, "Completion link generated with partial prefill");
      }
    } catch (error) {
      app.log.warn({ businessId: business.id, actionId: action.id, error: error instanceof Error ? error.message : "invalid completion link" }, "Completion link generation failed");
    }
  }
  let persistedLead: Lead | null = null;
  let actionDelivery: ConversationAnswerResult["actionDelivery"];
  if (action.completion.createLead) {
    const values = state.values;
    const email = values.email ?? null;
    const phone = values.phone ?? null;
    if (email || phone) {
      const lead: Lead = {
        id: randomUUID(),
        conversationId: conversation.id,
        name: values.name ?? values.parent_name ?? null,
        email,
        phone,
        intent: action.name,
        status: action.completion.leadStatus,
        source: "action_flow",
        pageUrl: state.sourcePage ?? null,
        referrer: null,
        consentAt: null,
        idempotencyKey: "action:" + conversation.id + ":" + action.id,
        metadata: {
          actionKey: action.key,
          actionId: action.id,
          fields: values,
          participants: state.participants ?? [],
          ...structuredWorkflowMetadata,
          conversionStage: state.completionUrl ? "registration_link_sent" : structuredWorkflowMetadata.conversionStage,
        },
        createdAt: new Date().toISOString(),
      };
      const persisted = await persistLead(business, lead);
      persistedLead = persisted;
      const existingIndex = business.leads.findIndex((item) => item.id === persisted.id || item.idempotencyKey === persisted.idempotencyKey);
      if (existingIndex >= 0) business.leads.splice(existingIndex, 1);
      business.leads.unshift(persisted);
      conversation.leadCaptured = true;
      await recordConversionEvent(business, {
        event: "LEAD_CAPTURED",
        conversationId: conversation.id,
        flowId: action.id,
        metadata: { leadId: persisted.id, actionKey: action.key },
      });
    }
  }
  const completionUrl = state.completionUrl ?? action.completion.linkUrl;
  if (completionUrl) {
    answer += "\n\n" + (action.completion.linkLabel ?? "Continue") + ": " + completionUrl;
  }
  if (action.completion.notifyStaff || action.completion.requiresStaff) {
    let staffNotificationFailed = false;
    const now = new Date().toISOString();
    if (action.completion.requiresStaff) {
      conversation.status = "WAITING_FOR_STAFF";
      conversation.handoffReason = `Action requires staff: ${action.name}`;
      conversation.handoffRequestedAt = now;
      conversation.lastActivityAt = now;
      await recordConversionEvent(business, {
        event: "HANDOFF_REQUESTED",
        conversationId: conversation.id,
        flowId: action.id,
        metadata: { reason: conversation.handoffReason },
      });
      await recordConversationEvent(business, conversation, "AI_HANDOFF_REQUESTED", "ai", null, { actionId: action.id, actionKey: action.key });
    }
    try {
      const notificationStatus = await notifyStaff(business, conversation, {
        type: action.completion.requiresStaff ? "action_staff_required" : "lead_created",
        title: action.completion.requiresStaff ? `${action.name} needs staff` : `New ${action.name} request`,
        body: `${business.name} received a completed ${action.name.toLowerCase()} flow.`,
        leadId: business.leads.find((lead) => lead.conversationId === conversation.id)?.id ?? null,
        channels: action.completion.notifyChannels,
        targets: action.completion.notifyTargets,
      });
      conversation.handoffNotificationStatus = notificationStatus;
      if (notificationStatus !== "failed") await recordConversationEvent(business, conversation, "STAFF_NOTIFIED", "system", null, { actionId: action.id, actionKey: action.key, delivery: notificationStatus });
      else staffNotificationFailed = true;
    } catch (error) {
      staffNotificationFailed = true;
      conversation.handoffNotificationStatus = "failed";
      app.log.warn({ error: error instanceof Error ? error.message : "unknown action notification failure", businessId: business.id, conversationId: conversation.id }, "Action saved but staff notification failed");
    }
    if (staffNotificationFailed) answer = "We saved your request. The team can follow up, but the automatic notification is temporarily unavailable.";
  }
  await recordConversionEvent(business, {
    event: "FLOW_COMPLETED",
    conversationId: conversation.id,
    flowId: action.id,
    metadata: { flowKey: action.key, leadCaptured: Boolean(persistedLead) },
  });
  if (action.completion.connector) {
    await recordConversionEvent(business, {
      event: "ACTION_STARTED",
      conversationId: conversation.id,
      flowId: action.id,
      metadata: { provider: action.completion.connector.provider },
    });
    try {
      await enqueueActionExecution(business, action, conversation, state, persistedLead);
      actionDelivery = { status: "queued", provider: action.completion.connector.provider };
    } catch (error) {
      const message = integrationErrorMessage(error);
      await recordConversionEvent(business, {
        event: "ACTION_FAILED",
        conversationId: conversation.id,
        flowId: action.id,
        metadata: { provider: action.completion.connector.provider, error: message, queued: false },
      });
      app.log.warn({ businessId: business.id, actionId: action.id, error: message }, "Action connector could not be queued; lead remains persisted");
      actionDelivery = { status: "failed", provider: action.completion.connector.provider };
    }
  } else {
    await recordConversionEvent(business, {
      event: "ACTION_STARTED",
      conversationId: conversation.id,
      flowId: action.id,
      metadata: { provider: "frontdeskwise" },
    });
    await recordConversionEvent(business, {
      event: "ACTION_SUCCEEDED",
      conversationId: conversation.id,
      flowId: action.id,
      metadata: { provider: "frontdeskwise" },
    });
  }
  if (action.completion.leadStatus === "booked") await recordOrganizationUsage(business, "bookings");
  await updateActionSubmission(business, submission, { status: "completed", leadId: persistedLead?.id ?? null });
  if (actionDelivery?.status === "failed") {
    answer = "We saved your request. We couldn’t complete it automatically, but the team has your details and can follow up.";
  } else if (actionDelivery?.status === "queued") {
    answer = "We saved your request and are sending it to the team now. If the connected service is unavailable, the team can still follow up.";
  }
  return { ...actionAnswer(action, state, answer), ...(actionDelivery ? { actionDelivery } : {}) };
}

async function submitActionForm(
  business: Business,
  conversation: Conversation,
  actionId: string,
  rawValues: Record<string, unknown>,
): Promise<ConversationAnswerResult> {
  const state = conversation.actionState;
  const action = business.actions.find((candidate) => candidate.id === actionId);
  if (!action || !state || state.actionId !== actionId) {
    throw httpError(400, "This action form is no longer active");
  }
  migrateWorkflowState(action, state);
  if (conversationIsTerminal(conversation)) throw httpError(409, "Conversation is closed; start a new conversation");
  if (state.status === "completed") {
    const submission = business.actionSubmissions.find((item) => item.conversationId === conversation.id && item.actionId === action.id);
    if (submission?.status === "completed") return actionAnswer(action, state, action.completion.message);
    return completeActionConversation(business, conversation, action, state);
  }
  await recordConversionEvent(business, {
    event: "FORM_SUBMITTED",
    conversationId: conversation.id,
    flowId: action.id,
  });
  const visibleFormFields = action.steps?.length ? workflowFormFields(action, state) : formFields(action, state);
  const repeatable = repeatableWorkflowConfig(action);
  for (const field of visibleFormFields) {
    const raw = rawValues[field.key];
    const supplied = typeof raw === "string" ? raw : raw === null || raw === undefined ? "" : String(raw);
    if (!supplied.trim()) {
      if (field.required) return actionAnswer(action, state, "Please complete " + field.label.toLowerCase() + " below.");
      state.skipped = [...new Set([...(state.skipped ?? []), field.key])];
      continue;
    }
    const validation = validateFieldValue(field, supplied);
    if (!validation.value) return actionAnswer(action, state, validation.error ?? ("Please check " + field.label.toLowerCase() + "."));
    state.values[field.key] = validation.value;
    if (repeatable && repeatable.fieldKeys.includes(field.key)) setWorkflowParticipantValue(state, field.key, validation.value);
    await recordConversionEvent(business, {
      event: "FIELD_COMPLETED",
      conversationId: conversation.id,
      flowId: action.id,
      fieldId: field.key,
    });
  }
  if (action.steps?.length) {
    state.formShown = false;
    const formStep = currentWorkflowStep(action, state);
    if (formStep?.type === "form") transitionWorkflow(action, state, formStep.id);
    const next = await advanceWorkflowAutomation(business, action, state);
    if (!next || (state.status as ConversationActionState["status"]) === "completed") return completeActionConversation(business, conversation, action, state);
    state.currentStepId = next.id;
    if (next.type === "form") {
      state.formShown = true;
      await recordConversionEvent(business, { event: "FORM_DISPLAYED", conversationId: conversation.id, flowId: action.id });
      return actionAnswer(action, state, "One more detail is needed below.");
    }
    return actionAnswer(action, state, workflowPrompt(action, state, next));
  }
  const remaining = nextActionField(action, state);
  if (remaining) {
    state.formShown = true;
    return actionAnswer(action, state, "One more detail is needed below.");
  }
  return completeActionConversation(business, conversation, action, state);
}

function customerAnswerPayload(result: ConversationAnswerResult) {
  return {
    answer: result.answer,
    grounded: result.grounded,
    citations: result.citations,
    ...(result.primaryCta ? { primaryCta: result.primaryCta } : {}),
    ...(result.quickActions?.length ? { quickActions: result.quickActions } : {}),
    ...(result.handoff ? { handoff: result.handoff } : {}),
    ...(result.failure ? { failure: result.failure } : {}),
    ...(result.actionDelivery ? { actionDelivery: result.actionDelivery } : {}),
    ...(result.action ? { action: result.action } : {}),
  };
}

function evaluationCases(business: Business, requestedLimit: number): EvaluationCase[] {
  const limit = Math.max(12, Math.min(20, requestedLimit));
  const cases: EvaluationCase[] = [];
  const seen = new Set<string>();
  const readySources = business.sources.filter((source) => source.crawlStatus === "ready");
  if (!readySources.length) return cases;

  const contentFor = (sourceId: string) => business.chunks
    .filter((chunk) => chunk.sourceId === sourceId)
    .map((chunk) => chunk.content)
    .join(" ")
    .toLowerCase();
  const hasEvidence = (types: string[], keywords: RegExp) => readySources.some((source) => {
    const type = sourceSemanticType(source);
    return types.includes(type) && keywords.test(`${source.title} ${source.url} ${contentFor(source.id)}`);
  });
  const serviceSources = ["service", "solution", "product", "homepage", "case_study", "blog", "web_page"];
  const regressionCases: EvaluationCase[] = [
    {
      category: "services",
      question: `What services does ${business.name} offer?`,
      expectation: hasEvidence(serviceSources, /\b(offer|provide|service|solution|product|feature|capabilit|automation|development|software|program|class|treatment)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "reminders",
      question: `Does ${business.name} support reminders?`,
      expectation: hasEvidence(["service", "solution", "product", "faq", "homepage", "web_page"], /\b(reminder|unfinished|recap|task)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["service", "solution", "product", "faq", "homepage", "web_page"],
    },
    {
      category: "voice_task_capture",
      question: "Can I create tasks using voice?",
      expectation: hasEvidence(["service", "solution", "product", "faq", "homepage", "web_page"], /\b(voice|dictat|spoken|speak)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["service", "solution", "product", "faq", "homepage", "web_page"],
    },
    {
      category: "calendar",
      question: `Does ${business.name} work with calendars?`,
      expectation: hasEvidence(["service", "solution", "product", "faq", "homepage", "web_page"], /\b(calendar|scheduling|schedule|sync|outlook|google)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["service", "solution", "product", "faq", "homepage", "web_page"],
    },
    {
      category: "contact",
      question: `How can I contact ${business.name}?`,
      expectation: hasEvidence(["contact", "homepage", "about", "faq"], /\b(contact|email|phone|call|reach|message|visit)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["contact", "homepage", "about", "faq"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "pricing",
      question: `What's the pricing for ${business.name}?`,
      expectation: hasEvidence(["pricing", "service", "product", "faq", "homepage"], /\b(price|pricing|cost|rate|fee|quote|budget)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["pricing", "service", "product", "faq", "homepage"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "permissions",
      question: `What permissions does ${business.name} use?`,
      expectation: hasEvidence(["permissions", "privacy", "policy", "faq", "document"], /\b(permission|privacy|security|personal data|data usage|data protection)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["permissions", "privacy", "policy", "faq", "document"],
    },
    {
      category: "daily_planning",
      question: `Can ${business.name} plan my day?`,
      expectation: hasEvidence(serviceSources, /\b(daily plan|daily planning|plan your day|planning|schedule)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
    },
    {
      category: "unfinished_reminders",
      question: `Does ${business.name} help with unfinished reminders?`,
      expectation: hasEvidence(serviceSources, /\b(unfinished|reminder|recap)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
    },
    {
      category: "teams",
      question: `Can teams use ${business.name}?`,
      expectation: hasEvidence(serviceSources, /\b(team|teams|workspace|collaborat|multiple users)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
    },
    {
      category: "unsupported_food_order",
      question: `Can ${business.name} order food for me?`,
      expectation: hasEvidence(serviceSources, /\border(?:s|ing)? food\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
    },
    {
      category: "unsupported_salesforce",
      question: `Does ${business.name} integrate with Salesforce?`,
      expectation: hasEvidence(serviceSources, /\bsalesforce\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
    },
  ];
  const standardCases: EvaluationCase[] = [
    {
      category: "services",
      question: `What services does ${business.name} offer?`,
      expectation: hasEvidence(serviceSources, /\b(offer|provide|service|solution|product|automation|development|software|program|class|treatment)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "hours",
      question: `What are ${business.name}'s hours?`,
      expectation: hasEvidence(["contact", "homepage", "faq"], /\b(hours?|open|opening|close|schedule)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["contact", "homepage", "faq"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "contact",
      question: `How do I contact ${business.name}?`,
      expectation: hasEvidence(["contact", "homepage", "about", "faq"], /\b(contact|email|phone|call|reach|message|visit)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["contact", "homepage", "about", "faq"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "pricing",
      question: "How much does a service cost?",
      expectation: hasEvidence(["pricing", "service", "faq"], /\b(price|pricing|cost|rate|fee|quote|budget)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["pricing", "service", "faq"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "location",
      question: `Where is ${business.name} located?`,
      expectation: hasEvidence(["contact", "homepage", "about"], /\b(location|located|address|directions|area|serve|visit)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["contact", "homepage", "about"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "booking",
      question: `How do I book with ${business.name}?`,
      expectation: hasEvidence(["service", "contact", "homepage", "faq"], /\b(book|booking|appointment|reserve|enroll|schedule|sign up)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["service", "contact", "homepage", "faq"],
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "offer_check",
      question: `Does ${business.name} offer this service?`,
      expectation: hasEvidence(serviceSources, /\b(offer|provide|service|solution|product|program|class|treatment)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: serviceSources,
      forbiddenPrimarySourceTypes: ["policy"],
    },
    {
      category: "cancellation_policy",
      question: `What is ${business.name}'s cancellation policy?`,
      expectation: hasEvidence(["policy", "faq", "pricing"], /\b(cancel|cancellation|refund|return|policy)\b/i) ? "grounded" : "fallback",
      expectedSourceTypes: ["policy", "faq", "pricing"],
    },
  ];

  for (const evaluationCase of [...regressionCases, ...standardCases]) {
    if (seen.has(evaluationCase.question.toLowerCase())) continue;
    seen.add(evaluationCase.question.toLowerCase());
    cases.push(evaluationCase);
    if (cases.length >= limit) break;
  }

  for (const source of readySources) {
    if (cases.length >= limit) break;
    const chunk = business.chunks.find((item) => item.sourceId === source.id);
    if (!chunk) continue;
    const terms = tokenise(chunk.content).slice(0, 5);
    if (terms.length < 2) continue;
    const question = `What does ${business.name} say about ${terms.join(" ")}?`;
    const key = question.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cases.push({ category: source.pageType || "website_content", question, expectation: "grounded", expectedSourceTypes: [sourceSemanticType(source)] });
  }

  // Every readiness run includes one deliberately unsupported prompt. A safe
  // front desk should refuse to invent an answer and create no false citation.
  if (cases.length < limit) {
    cases.push({
      category: "unsupported_question",
      question: "What is the exact moonbase launch date and private jet policy for this business?",
      expectation: "fallback",
    });
  }
  return cases.slice(0, limit);
}

async function evaluateBusiness(business: Business, requestedLimit: number) {
  const cases = evaluationCases(business, requestedLimit);
  const results: EvaluationResult[] = [];
  for (const evaluationCase of cases) {
    const startedAt = Date.now();
    const answer = await answerQuestion(business, evaluationCase.question, { recordGap: false });
    const latencyMs = Date.now() - startedAt;
    const citationTypes = answer.citations.map((citation) => {
      const source = business.sources.find((item) => item.id === citation.sourceId);
      return source ? sourceSemanticType(source) : undefined;
    }).filter((type): type is string => Boolean(type));
    const primarySourceType = citationTypes[0];
    const sourceTypePass = !evaluationCase.expectedSourceTypes?.length
      || (primarySourceType ? evaluationCase.expectedSourceTypes.includes(primarySourceType) : false);
    const forbiddenSourcePass = !primarySourceType || !evaluationCase.forbiddenPrimarySourceTypes?.includes(primarySourceType);
    const answerStylePass = answer.answer.split(/\s+/).filter(Boolean).length <= 120 && !/^based on\b/i.test(answer.answer.trim());
    const intent = classifyQuestionIntent(evaluationCase.question);
    const passed = evaluationCase.expectation === "grounded"
      ? answer.grounded && answer.citations.length > 0 && answer.confidenceScore >= 0.55 && sourceTypePass && forbiddenSourcePass && answerStylePass
      : !answer.grounded && answer.citations.length === 0 && answer.confidenceBand === "low";
    const scores: EvaluationScores = {
      correctness: evaluationCase.expectation === "grounded"
        ? answer.grounded && sourceTypePass ? 3 : answer.grounded ? 1 : 0
        : !answer.grounded ? 3 : 0,
      relevance: sourceTypePass && (evaluationCase.expectation === "grounded" ? answer.grounded : !answer.grounded) ? 3 : answer.grounded ? 1 : 0,
      grounding: answer.grounded ? (answer.citations.length ? 3 : 1) : evaluationCase.expectation === "fallback" ? 3 : 1,
      citationQuality: evaluationCase.expectation === "grounded"
        ? answer.citations.length > 0 && sourceTypePass && forbiddenSourcePass ? 3 : answer.citations.length > 0 ? 1 : 0
        : answer.citations.length === 0 ? 3 : 0,
      conciseness: answerStylePass ? 3 : answer.answer.split(/\s+/).filter(Boolean).length <= 180 ? 2 : 1,
      fallbackCorrectness: evaluationCase.expectation === "fallback"
        ? !answer.grounded && answer.citations.length === 0 ? 3 : 0
        : answer.grounded ? 3 : 0,
      hallucination: evaluationCase.expectation === "fallback" && answer.grounded ? "fail" : "pass",
    };
    results.push({
      category: evaluationCase.category,
      question: evaluationCase.question,
      expectation: evaluationCase.expectation,
      passed,
      grounded: answer.grounded,
      confidenceScore: answer.confidenceScore,
      confidenceBand: answer.confidenceBand,
      citationCount: answer.citations.length,
      answer: answer.answer,
      latencyMs,
      retrievalMode: String(answer.retrieval?.mode ?? "unknown"),
      intent,
      retrievedPages: answer.citations.map((citation) => citation.title || citation.url),
      citations: answer.citations.map((citation) => ({ title: citation.title, url: citation.url, pageType: citation.pageType })),
      topRetrievalScore: Number(answer.retrieval?.topScore ?? 0),
      scores,
      expectedSourceTypes: evaluationCase.expectedSourceTypes,
      primarySourceType,
      forbiddenPrimarySourceTypes: evaluationCase.forbiddenPrimarySourceTypes,
    });
  }

  const passCount = results.filter((item) => item.passed).length;
  const latencies = results.map((item) => item.latencyMs).sort((left, right) => left - right);
  const p95Index = latencies.length ? Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1) : 0;
  const groundedCases = results.filter((item) => item.expectation === "grounded");
  const fallbackCases = results.filter((item) => item.expectation === "fallback");
  const openGaps = [...business.knowledgeGaps.values()].filter((gap) => gap.status === "open").length;

  return {
    generatedAt: new Date().toISOString(),
    score: results.length ? Math.round((passCount / results.length) * 100) : 0,
    passed: passCount,
    total: results.length,
    groundedQuestions: groundedCases.length,
    groundedWithCitations: groundedCases.filter((item) => item.grounded && item.citationCount > 0).length,
    fallbackQuestions: fallbackCases.length,
    fallbackPassed: fallbackCases.filter((item) => item.passed).length,
    openGaps,
    averageLatencyMs: latencies.length ? Math.round(latencies.reduce((total, value) => total + value, 0) / latencies.length) : 0,
    p95LatencyMs: latencies[p95Index] ?? 0,
    citationCoverage: groundedCases.length ? Math.round((groundedCases.filter((item) => item.citationCount > 0).length / groundedCases.length) * 100) : 0,
    needsReview: results.filter((item) => !item.passed && item.expectation === "grounded").length,
    cases: results,
  };
}

function maybeConversation(business: Business, conversationId: string): Conversation {
  const conversation = business.conversations.get(conversationId);
  if (!conversation) throw httpError(404, "Conversation not found");
  return conversation;
}

function conversationStatusPayload(conversation: Conversation) {
  return {
    id: conversation.id,
    status: conversation.status,
    leadCaptured: conversation.leadCaptured,
    assignedUserId: conversation.assignedUserId,
    handoffReason: conversation.handoffReason,
    handoffNotificationStatus: conversation.handoffNotificationStatus,
    unreadCount: conversation.unreadCount,
    lastActivityAt: conversation.lastActivityAt,
    updatedAt: conversation.updatedAt,
  };
}

async function businessOrganizationId(business: Business): Promise<string | null> {
  if (!pool) return null;
  const result = await pool.query<{ organization_id: string }>("select organization_id from businesses where id = $1", [business.id]);
  return result.rows[0]?.organization_id ?? null;
}

async function recordConversationEvent(
  business: Business,
  conversation: Conversation,
  eventType: ConversationEventType,
  actorType: ConversationEvent["actorType"],
  actorUserId: string | null = null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const event: ConversationEvent = {
    id: randomUUID(),
    businessId: business.id,
    conversationId: conversation.id,
    eventType,
    actorUserId,
    actorType,
    metadata,
    createdAt: new Date().toISOString(),
  };
  business.conversationEvents.unshift(event);
  if (!pool) return;
  try {
    await pool.query(
      `insert into conversation_events
         (id, business_id, conversation_id, event_type, actor_user_id, actor_type, metadata, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [event.id, business.id, conversation.id, event.eventType, actorUserId, actorType, JSON.stringify(metadata), event.createdAt],
    );
  } catch (error) {
    const errorCode = asRecord(error).code;
    const rollingTraceSchema = eventType === "CONVERSATION_DECISION_TRACE" && errorCode === "23514";
    if (!isMissingDatabaseTable(error) && !rollingTraceSchema) throw error;
    app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error" }, "Conversation event table is not available yet");
  }
}

async function cancelPendingHandoffReminders(conversationId: string): Promise<void> {
  if (!pool) return;
  await pool.query(
    `update message_deliveries
     set status = 'canceled', updated_at = now()
     where event_type = 'HUMAN_HANDOFF'
       and event_key like '%:reminder'
       and status in ('queued', 'deferred')
       and payload->>'conversation_id' = $1`,
    [conversationId],
  ).catch((error) => {
    if (!isMissingDatabaseTable(error)) throw error;
  });
}

function normalizeTelemetryDevice(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "mobile" || normalized === "tablet" || normalized === "desktop" ? normalized : null;
}

async function recordConversionEvent(
  business: Business,
  input: {
    event: ConversionEventType;
    conversationId?: string | null;
    flowId?: string | null;
    fieldId?: string | null;
    sourcePage?: string | null;
    device?: string | null;
    metadata?: Record<string, unknown>;
    timestamp?: string | null;
  },
): Promise<void> {
  if (!conversionEventTypes.has(input.event)) return;
  const timestampCandidate = input.timestamp ? Date.parse(input.timestamp) : NaN;
  const timestamp = Number.isNaN(timestampCandidate) ? new Date().toISOString() : new Date(timestampCandidate).toISOString();
  const event: ConversionEvent = {
    id: randomUUID(),
    organizationId: null,
    businessId: business.id,
    conversationId: input.conversationId ?? null,
    flowId: input.flowId ?? null,
    fieldId: input.fieldId ?? null,
    event: input.event,
    timestamp,
    sourcePage: input.sourcePage?.slice(0, 2_000) ?? null,
    device: normalizeTelemetryDevice(input.device),
    metadata: input.metadata ?? {},
  };
  business.conversionEvents.unshift(event);
  if (business.conversionEvents.length > 10_000) business.conversionEvents.length = 10_000;
  if (!pool) return;
  try {
    const organizationId = await businessOrganizationId(business);
    event.organizationId = organizationId;
    if (!organizationId) return;
    await pool.query(
      `insert into conversion_events
         (id, organization_id, business_id, conversation_id, flow_id, field_id, event, occurred_at, source_page, device, metadata)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [event.id, organizationId, business.id, event.conversationId, event.flowId, event.fieldId, event.event, event.timestamp, event.sourcePage, event.device, JSON.stringify(event.metadata)],
    );
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: business.id }, "Conversion events table is not available yet");
  }
}

function boundedPerformanceMetrics(value: unknown): Record<string, string | number | boolean | null> {
  const source = asRecord(value);
  const metrics: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(source).slice(0, 20)) {
    if (typeof item === "string") metrics[key.slice(0, 80)] = item.slice(0, 240);
    else if (typeof item === "number" && Number.isFinite(item)) metrics[key.slice(0, 80)] = Math.round(item * 100) / 100;
    else if (typeof item === "boolean" || item === null) metrics[key.slice(0, 80)] = item;
  }
  return metrics;
}

async function recordWidgetPerformance(
  business: Business,
  input: {
    event: string;
    organizationId?: string | null;
    conversationId?: string | null;
    requestId?: string | null;
    durationMs?: number | null;
    occurredAt?: string | null;
    sourcePage?: string | null;
    device?: string | null;
    metrics?: Record<string, string | number | boolean | null>;
  },
): Promise<void> {
  if (!widgetPerformanceEventTypes.has(input.event) || !pool) return;
  const event: WidgetPerformanceEvent = {
    id: randomUUID(),
    organizationId: input.organizationId ?? await businessOrganizationId(business),
    businessId: business.id,
    conversationId: input.conversationId ?? null,
    requestId: input.requestId?.slice(0, 160) ?? null,
    event: input.event,
    durationMs: typeof input.durationMs === "number" && Number.isFinite(input.durationMs) ? Math.max(0, Math.round(input.durationMs)) : null,
    occurredAt: input.occurredAt && !Number.isNaN(Date.parse(input.occurredAt)) ? new Date(input.occurredAt).toISOString() : new Date().toISOString(),
    sourcePage: input.sourcePage?.slice(0, 2_000) ?? null,
    device: normalizeTelemetryDevice(input.device),
    metrics: boundedPerformanceMetrics(input.metrics ?? {}),
  };
  if (!event.organizationId) return;
  try {
    await pool.query(
      `insert into widget_performance_events
         (id, organization_id, business_id, conversation_id, request_id, event_type, duration_ms, occurred_at, source_page, device, metrics)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [event.id, event.organizationId, event.businessId, event.conversationId, event.requestId, event.event, event.durationMs, event.occurredAt, event.sourcePage, event.device, JSON.stringify(event.metrics)],
    );
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ businessId: business.id }, "Widget performance table is not available yet");
  }
}

async function staffRecipients(business: Business): Promise<Array<{ id: string; email: string; name: string; role: "owner" | "admin" | "staff" }>> {
  if (!pool) return [];
  const result = await pool.query<Record<string, unknown>>(
    `select distinct u.id, u.email, u.name,
            case when om.role = 'owner' then 'owner' when om.role = 'admin' or bm.role = 'admin' then 'admin' else 'staff' end as effective_role
     from app_users u
     join businesses b on b.id = $1
     left join organization_members om on om.organization_id = b.organization_id and om.user_id = u.id
     left join business_members bm on bm.business_id = b.id and bm.user_id = u.id
     where u.status = 'active'
       and (om.role in ('owner', 'admin') or bm.role in ('admin', 'staff'))
     order by u.email`,
    [business.id],
  );
  return result.rows.map((row) => ({ id: String(row.id), email: String(row.email), name: String(row.name ?? "Team member"), role: row.effective_role === "owner" ? "owner" : row.effective_role === "admin" ? "admin" : "staff" }));
}

async function notifyStaff(
  business: Business,
  conversation: Conversation,
  input: { type: string; title: string; body: string; leadId?: string | null; intent?: string | null; channels?: Array<"in_app" | "email">; targets?: Array<"owner" | "business_team" | "assigned_staff">; handoffTrigger?: "explicit_human_request" | "knowledge_gap" | "high_value_lead"; lastMessage?: string },
): Promise<Exclude<HandoffNotificationStatus, null>> {
  const recipients = await staffRecipients(business);
  const channels = input.channels?.length ? input.channels : ["in_app", "email"];
  const targets = input.targets?.length ? input.targets : ["business_team"];
  const filteredRecipients = recipients.filter((recipient) => {
    if (targets.includes("business_team")) return true;
    if (targets.includes("owner") && recipient.role === "owner") return true;
    if (targets.includes("assigned_staff") && conversation.assignedUserId === recipient.id) return true;
    return false;
  });
  let configuredEmails: string[] = [];
  let emailDeliveryQueued = false;
  const organizationId = await businessOrganizationId(business);
  const createdAt = new Date().toISOString();
  for (const recipient of filteredRecipients) {
    const notification: Notification = {
      id: randomUUID(),
      organizationId,
      businessId: business.id,
      userId: recipient.id,
      type: input.type,
      conversationId: conversation.id,
      leadId: input.leadId ?? null,
      title: input.title,
      body: input.body,
      readAt: null,
      createdAt,
    };
    if (channels.includes("in_app")) business.notifications.unshift(notification);
    if (pool && channels.includes("in_app")) {
      try {
        await pool.query(
          `insert into notifications
             (id, organization_id, business_id, user_id, type, conversation_id, lead_id, title, body, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [notification.id, organizationId, business.id, recipient.id, input.type, conversation.id, input.leadId ?? null, input.title, input.body, createdAt],
        );
      } catch (error) {
        if (!isMissingDatabaseTable(error)) throw error;
        app.log.warn({ error: error instanceof Error ? error.message : "unknown schema error" }, "Notification table is not available yet");
      }
    }
  }
  if (channels.includes("email")) {
    const eventType: LifecycleEventType | null = input.type === "handoff_requested"
      ? "HUMAN_HANDOFF"
      : input.type === "knowledge_gap"
        ? "KNOWLEDGE_GAP"
      : input.type === "lead_created"
        ? "QUALIFIED_LEAD"
        : input.type === "action_staff_required" ? "HUMAN_HANDOFF" : null;
    const handoffSettings = eventType === "HUMAN_HANDOFF" || eventType === "KNOWLEDGE_GAP" ? await loadHandoffNotificationSettings(business) : null;
    const trigger = input.handoffTrigger ?? (input.type === "action_staff_required" ? "high_value_lead" : "explicit_human_request");
    const handoffTriggerEnabled = !handoffSettings
      || (handoffSettings.enabled && (trigger === "explicit_human_request"
        ? handoffSettings.notifyExplicitHumanRequest
        : trigger === "knowledge_gap" ? handoffSettings.notifyKnowledgeGap : handoffSettings.notifyHighValueLead));
    configuredEmails = handoffSettings && handoffTriggerEnabled
      ? [handoffSettings.defaultRecipientEmail, ...handoffSettings.additionalRecipientEmails].filter((email): email is string => Boolean(email))
      : [];
    const hasRecipients = filteredRecipients.length > 0 || configuredEmails.length > 0;
    if (eventType && handoffTriggerEnabled && hasRecipients) {
      const lead = input.leadId ? business.leads.find((item) => item.id === input.leadId) : null;
      const latestVisitorMessage = [...conversation.messages].reverse().find((message) => message.role === "user");
      const notificationPayload = eventType === "QUALIFIED_LEAD"
        ? {
          business_name: business.name,
          lead_name: lead?.name || "A visitor",
          lead_intent: lead?.intent || "customer inquiry",
          lead_contact: lead?.email || lead?.phone || "No direct contact provided",
          leads_url: lifecycleAppUrl(`/app/${business.slug}/leads`),
        }
        : {
          business_name: business.name,
          visitor_name: lead?.name || "Unknown visitor",
          visitor_intent: lead?.intent || input.intent || latestVisitorMessage?.retrieval?.intent || "General inquiry",
          waiting_since: conversation.handoffRequestedAt || conversation.lastActivityAt,
          last_message: input.lastMessage || latestVisitorMessage?.content || input.body,
          handoff_status: conversation.status === "HANDOFF_REQUESTED" ? "WAITING_FOR_STAFF" : conversation.status,
          handoff_reason: conversation.handoffReason || input.body,
          conversation_id: conversation.id,
          inbox_url: lifecycleAppUrl(`/app/${business.slug}/inbox?conversation=${encodeURIComponent(conversation.id)}`),
        };
      const lifecycleEvent = {
        eventType,
        eventKey: `business.notification:${business.id}:${conversation.id}:${input.type}:${input.leadId ?? "none"}`,
        organizationId,
        businessId: business.id,
        recipientUserIds: configuredEmails.length ? undefined : filteredRecipients.map((recipient) => recipient.id),
        recipientEmails: configuredEmails.length ? configuredEmails : undefined,
        delaySeconds: handoffSettings?.handoffDelaySeconds,
        payload: notificationPayload,
      } satisfies Parameters<typeof queueLifecycleEvent>[0];
      await queueLifecycleEvent(lifecycleEvent);
      emailDeliveryQueued = true;
      if (eventType === "HUMAN_HANDOFF" && handoffSettings?.repeatEnabled) {
        await queueLifecycleEvent({
          ...lifecycleEvent,
          eventKey: `${lifecycleEvent.eventKey}:reminder`,
          delaySeconds: handoffSettings.repeatAfterSeconds,
          payload: { ...notificationPayload, handoff_reminder: true },
        });
      }
    }
  }
  if (!filteredRecipients.length && !configuredEmails.length) return "failed";
  if (emailDeliveryQueued) return "pending";
  return filteredRecipients.length ? "sent" : "failed";
}

function handoffAnswer(business: Business, reason: string, notificationStatus: Exclude<HandoffNotificationStatus, null> = "sent"): ConversationAnswerResult {
  const modelUsage: ModelUsage = {
    route: "tier0",
    model: null,
    reason: "deterministic_handoff",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    latencyMs: 0,
  };
  return {
    answer: notificationStatus === "sent"
      ? "Your message has been sent to the team. A team member will reply here shortly."
      : "Your message has been saved for the team. A team member will reply here shortly.",
    grounded: false,
    citations: [],
    knowledgeGap: null,
    confidenceScore: 1,
    confidenceBand: "high",
    retrieval: { mode: "handoff", candidateCount: 0, topScore: 1, ...modelUsage },
    modelUsage,
    handoff: { status: "WAITING_FOR_STAFF", reason, notificationStatus },
  };
}

async function requestHandoff(business: Business, conversation: Conversation, reason: string, lastMessage?: string): Promise<ConversationAnswerResult> {
  const now = new Date().toISOString();
  conversation.status = "HANDOFF_REQUESTED";
  conversation.handoffReason = reason;
  conversation.handoffRequestedAt = now;
  conversation.lastActivityAt = now;
  await recordConversionEvent(business, {
    event: "HANDOFF_REQUESTED",
    conversationId: conversation.id,
    metadata: { reason },
  });
  await recordConversationEvent(business, conversation, "AI_HANDOFF_REQUESTED", "visitor", null, { reason });
  await persistConversation(business, conversation);
  let notificationStatus: Exclude<HandoffNotificationStatus, null> = "sent";
  try {
    notificationStatus = await notifyStaff(business, conversation, {
      type: "handoff_requested",
      title: "Human help requested",
      body: `${business.name} has a visitor waiting for a team member. Reason: ${reason}`,
      handoffTrigger: "explicit_human_request",
      lastMessage,
    });
    if (notificationStatus !== "failed") await recordConversationEvent(business, conversation, "STAFF_NOTIFIED", "system", null, { reason, delivery: notificationStatus });
  } catch (error) {
    notificationStatus = "failed";
    app.log.warn({ error: error instanceof Error ? error.message : "unknown handoff notification failure", businessId: business.id, conversationId: conversation.id }, "Handoff saved but staff notification failed");
  }
  conversation.handoffNotificationStatus = notificationStatus;
  conversation.status = "WAITING_FOR_STAFF";
  conversation.lastActivityAt = new Date().toISOString();
  await persistConversation(business, conversation);
  return handoffAnswer(business, reason, notificationStatus);
}

function conversationIsTerminal(conversation: Conversation): boolean {
  return conversation.status === "RESOLVED" || conversation.status === "EXPIRED";
}

function conversationIsWithinResumeWindow(conversation: Conversation, now = Date.now()): boolean {
  const lastActivity = Date.parse(conversation.lastActivityAt);
  return Number.isFinite(lastActivity) && lastActivity >= now - CONVERSATION_RESUME_WINDOW_MS;
}

async function expireConversation(business: Business, conversation: Conversation): Promise<void> {
  if (conversationIsTerminal(conversation)) return;
  const now = new Date().toISOString();
  conversation.status = "EXPIRED";
  conversation.unreadCount = 0;
  conversation.lastActivityAt = now;
  conversation.updatedAt = now;
  await cancelPendingHandoffReminders(conversation.id);
  await persistConversation(business, conversation);
  await recordConversationEvent(business, conversation, "CONVERSATION_EXPIRED", "system", null, { resumeWindowMs: CONVERSATION_RESUME_WINDOW_MS });
}

async function startConversation(business: Business, sessionId: string | null, options: { forceNew?: boolean } = {}): Promise<Conversation> {
  const now = new Date().toISOString();
  const normalizedSessionId = sessionId?.trim() ? sessionId.trim().slice(0, 160) : null;
  if (normalizedSessionId && !options.forceNew) {
    const sessionConversations = [...business.conversations.values()]
      .filter((conversation) => conversation.sessionId === normalizedSessionId && !conversationIsTerminal(conversation))
      .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
    for (const conversation of sessionConversations) {
      if (!conversationIsWithinResumeWindow(conversation)) await expireConversation(business, conversation);
    }
    const recentConversation = sessionConversations.find((conversation) => conversation.status !== "EXPIRED" && conversationIsWithinResumeWindow(conversation));
    if (recentConversation) return recentConversation;
  }
  const conversation: Conversation = {
    id: randomUUID(),
    sessionId: normalizedSessionId ?? randomUUID(),
    leadCaptured: false,
    actionTaken: null,
    status: "AI_ACTIVE",
    assignedUserId: null,
    assignedAt: null,
    handoffReason: null,
    handoffRequestedAt: null,
    handoffNotificationStatus: null,
    humanJoinedAt: null,
    resolvedAt: null,
    unreadCount: 0,
    lastActivityAt: now,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  business.conversations.set(conversation.id, conversation);
  await persistConversation(business, conversation);
  await recordOrganizationUsage(business, "conversations");
  return conversation;
}

async function conversationForIncomingMessage(
  business: Business,
  conversation: Conversation,
  sessionId?: string | null,
): Promise<Conversation> {
  if (conversationIsTerminal(conversation)) {
    return startConversation(business, sessionId?.trim() ? sessionId : conversation.sessionId, { forceNew: true });
  }
  if (!conversationIsWithinResumeWindow(conversation)) {
    await expireConversation(business, conversation);
    return startConversation(business, sessionId?.trim() ? sessionId : conversation.sessionId, { forceNew: true });
  }
  return conversation;
}

async function purgeExpiredCustomerData(): Promise<void> {
  for (const business of businesses.values()) {
    const cutoff = Date.now() - business.agentConfig.retentionDays * 24 * 60 * 60 * 1_000;
    for (const [conversationId, conversation] of business.conversations) {
      if (Date.parse(conversation.lastActivityAt) < cutoff) business.conversations.delete(conversationId);
    }
    business.leads = business.leads.filter((lead) => Date.parse(lead.createdAt) >= cutoff);
    if (!pool) continue;
    try {
      await pool.query("delete from conversations where business_id = $1 and last_activity_at < $2", [business.id, new Date(cutoff).toISOString()]);
      await pool.query("delete from leads where business_id = $1 and created_at < $2", [business.id, new Date(cutoff).toISOString()]);
    } catch (error) {
      if (!isMissingDatabaseColumn(error) && !isMissingDatabaseTable(error)) throw error;
      app.log.warn({ businessId: business.id }, "Retention cleanup skipped until the latest schema is available");
    }
  }
}

async function recordConversationDecisionTrace(
  business: Business,
  conversation: Conversation,
  context: ConversationDecisionTraceContext,
  result: ConversationAnswerResult,
): Promise<void> {
  const actionAfter = conversation.actionState
    ? business.actions.find((candidate) => candidate.id === conversation.actionState?.actionId) ?? null
    : null;
  const stateAfter = conversation.actionState ?? null;
  const provider = providerTrace(actionAfter ?? context.actionBefore, stateAfter, result.actionDelivery);
  const ctaActionSelected = result.primaryCta
    ? {
        actionId: result.primaryCta.actionId,
        key: result.primaryCta.key,
        label: result.primaryCta.label,
        executionMode: result.primaryCta.executionMode,
        trackingKey: result.primaryCta.trackingKey,
        url: result.primaryCta.url ?? null,
      }
    : result.action
      ? { actionId: result.action.id, key: result.action.key, status: result.action.status }
      : null;
  await recordConversationEvent(business, conversation, "CONVERSATION_DECISION_TRACE", "system", null, {
    trace_version: 1,
    turn_id: context.turnId,
    route: context.orchestration.route,
    confidence: context.orchestration.confidence,
    conversational_intent: context.orchestration.conversationalIntent,
    action_intent: context.orchestration.actionIntent,
    request_mode: context.orchestration.requestMode,
    reason: context.orchestration.reason,
    business_context_version: business.businessContextSnapshot?.version ?? null,
    workflow_action_before: context.actionBefore ? { id: context.actionBefore.id, key: context.actionBefore.key, version: context.actionBefore.version ?? 1 } : null,
    workflow_action_after: actionAfter ? { id: actionAfter.id, key: actionAfter.key, version: actionAfter.version ?? 1 } : null,
    workflow_state_before: snapshotConversationWorkflowState(context.stateBefore),
    extracted_fields: workflowFieldChanges(context.stateBefore, stateAfter),
    next_best_action: result.action?.workflow?.nextBestAction ?? context.orchestration.nextBestAction,
    provider_call: provider
      ? { provider: provider.provider, operations: provider.operations, lookup_steps: provider.lookupSteps.map((lookup) => lookup.stepId), action_delivery_provider: provider.actionDelivery?.provider ?? null }
      : null,
    provider_result: provider
      ? { lookup_steps: provider.lookupSteps, action_delivery: provider.actionDelivery }
      : null,
    workflow_state_after: snapshotConversationWorkflowState(stateAfter),
    cta_action_selected: ctaActionSelected,
    response: {
      grounded: result.grounded,
      confidence_band: result.confidenceBand,
      handoff: result.handoff?.status ?? null,
      action_delivery: result.actionDelivery?.status ?? null,
    },
    latency_ms: Math.max(0, Math.round(performance.now() - context.startedAt)),
  });
}

async function persistConversationExchange(
  business: Business,
  conversation: Conversation,
  userContent: string,
  result: ConversationAnswerResult,
  clientMessageId?: string,
  traceContext?: ConversationDecisionTraceContext,
): Promise<ConversationAnswerResult> {
  recordAnswer(result.modelUsage.latencyMs);
  if (!result.grounded && result.retrieval.mode !== "tier0_greeting" && result.retrieval.mode !== "approved_answer") recordLowConfidenceFallback();
  const now = new Date().toISOString();
  const userMessage: Message = { id: clientMessageId ?? randomUUID(), role: "user", content: userContent, createdAt: now };
  const assistantMessage: Message | null = result.silent ? null : {
    id: randomUUID(),
    role: "assistant",
    content: result.answer,
    grounded: result.grounded,
    sourceUrl: result.citations[0]?.url,
    confidenceScore: result.confidenceScore,
    confidenceBand: result.confidenceBand,
    citations: result.citations,
    retrieval: result.retrieval,
    createdAt: now,
  };
  conversation.messages.push(userMessage);
  if (assistantMessage) conversation.messages.push(assistantMessage);
  conversation.updatedAt = now;
  conversation.lastActivityAt = now;
  if (conversation.status === "HUMAN_ACTIVE" || conversation.status === "AI_ASSISTED" || conversation.status === "WAITING_FOR_STAFF") {
    conversation.unreadCount += 1;
    await recordConversationEvent(business, conversation, "VISITOR_REPLIED", "visitor", null, { contentLength: userContent.length });
    if (conversation.status === "HUMAN_ACTIVE" && conversation.assignedUserId) {
      await notifyStaff(business, conversation, {
        type: "visitor_replied",
        title: "Visitor replied",
        body: `${business.name} has a new visitor message in an active conversation.`,
      });
    }
  }
  await persistMessage(conversation, userMessage);
  if (assistantMessage) await persistMessage(conversation, assistantMessage);
  await persistConversation(business, conversation);
  if (!result.handoff && conversation.status === "AI_ACTIVE") {
    await recordConversationEvent(business, conversation, "AI_RESPONSE_SENT", "ai", null, { grounded: result.grounded });
  }
  if (traceContext) {
    try {
      await recordConversationDecisionTrace(business, conversation, traceContext, result);
    } catch (error) {
      // Decision traces are diagnostic metadata. They must never turn a
      // successful customer response into a failed request.
      app.log.warn({ error: error instanceof Error ? error.message : "unknown trace error", businessId: business.id, conversationId: conversation.id }, "Conversation decision trace failed");
    }
  }
  await recordOrganizationUsage(business, "llm_requests");
  await recordModelUsage(business, result.modelUsage);
  if (result.knowledgeGap) {
    try {
      await persistGap(business, result.knowledgeGap);
      const handoffSettings = await loadHandoffNotificationSettings(business);
      if (handoffSettings.notifyKnowledgeGap) {
        await notifyStaff(business, conversation, {
          type: "knowledge_gap",
          title: "Answer gap needs review",
          body: `${business.name} received a question without enough verified information.`,
          handoffTrigger: "knowledge_gap",
          intent: result.knowledgeGap.intent,
          lastMessage: userContent,
        });
      }
    } catch (error) {
      // Gap tracking and optional alerts are observability work; they must not
      // make the visitor-facing answer fail when a schema or mail provider is
      // temporarily unavailable.
      app.log.error({ error, businessId: business.id }, "Knowledge-gap follow-up failed after answer was generated");
    }
  }
  return result;
}

async function recordConversationQuestion(business: Business, conversation: Conversation, question: string, options: { currentPage?: string | null; clientMessageId?: string } = {}) {
  if (conversationIsTerminal(conversation)) throw httpError(409, "Conversation is closed; start a new conversation");
  const activeAction = conversation.actionState ? business.actions.find((candidate) => candidate.id === conversation.actionState?.actionId) ?? null : null;
  const orchestration = decideConversationRoute({ message: question, activeAction, actionState: conversation.actionState });
  const traceContext: ConversationDecisionTraceContext = {
    turnId: options.clientMessageId ?? randomUUID(),
    startedAt: performance.now(),
    orchestration,
    actionBefore: activeAction,
    stateBefore: cloneConversationActionState(conversation.actionState),
  };
  const persistTurn = (result: ConversationAnswerResult) => persistConversationExchange(
    business,
    conversation,
    question,
    result,
    options.clientMessageId,
    traceContext,
  );
  if (orchestration.route === "HUMAN_HANDOFF" && !["HUMAN_ACTIVE", "WAITING_FOR_STAFF", "HANDOFF_REQUESTED"].includes(conversation.status)) {
    const result = await requestHandoff(business, conversation, "Visitor explicitly requested a team member", question);
    return persistTurn(result);
  }
  if (conversation.status === "HUMAN_ACTIVE") {
    // The initial handoff response is emitted by requestHandoff. Follow-up
    // visitor messages stay in the same thread without another acknowledgement.
    const result = {
      ...handoffAnswer(business, "Human takeover is active"),
      answer: "",
      silent: true,
      handoff: { status: "HUMAN_ACTIVE" as const, reason: "Human takeover is active" },
    };
    return persistTurn(result);
  }
  if (conversation.status === "WAITING_FOR_STAFF" || conversation.status === "HANDOFF_REQUESTED") {
    const requestedAction = detectAction(business.actions, question, business.primaryActionId);
    const currentActionId = conversation.actionState?.actionId;
    if (requestedAction && requestedAction.id !== currentActionId) {
      conversation.status = "AI_ACTIVE";
      conversation.handoffReason = null;
      conversation.handoffRequestedAt = null;
      conversation.assignedUserId = null;
      conversation.assignedAt = null;
      conversation.actionState = undefined;
      conversation.actionTaken = null;
      await persistConversation(business, conversation);
    } else {
      const result = {
        ...handoffAnswer(business, conversation.handoffReason ?? "A team member has been requested"),
        answer: "",
        silent: true,
      };
      return persistTurn(result);
    }
  }
  let result: ConversationAnswerResult;
  try {
    result = await continueActionConversation(business, conversation, question, { sourcePage: options.currentPage })
      ?? await answerQuestion(business, question, { conversation, currentPage: options.currentPage });
  } catch (error) {
    app.log.warn({ error: error instanceof Error ? error.message : "unknown widget answer failure", businessId: business.id, conversationId: conversation.id }, "Widget answer degraded after backend failure");
    result = temporaryConversationAnswer(question, "backend");
  }
  return persistTurn(result);
}

async function recordActionFormSubmission(
  business: Business,
  conversation: Conversation,
  actionId: string,
  values: Record<string, unknown>,
  sourcePage: string | null = null,
) {
  const actionBefore = business.actions.find((candidate) => candidate.id === actionId) ?? null;
  const stateBefore = cloneConversationActionState(conversation.actionState);
  const traceContext: ConversationDecisionTraceContext = {
    turnId: randomUUID(),
    startedAt: performance.now(),
    orchestration: decideConversationRoute({
      message: "Submitted action details.",
      activeAction: actionBefore,
      actionState: conversation.actionState,
    }),
    actionBefore,
    stateBefore,
  };
  if (conversation.actionState?.actionId === actionId && sourcePage) conversation.actionState.sourcePage = sourcePage;
  const result = await submitActionForm(business, conversation, actionId, values);
  const action = business.actions.find((candidate) => candidate.id === actionId);
  return persistConversationExchange(
    business,
    conversation,
    action ? "Submitted " + action.name + " details." : "Submitted action details.",
    result,
    undefined,
    traceContext,
  );
}

const seededBusinesses = [
  seedDefaultBusiness(),
  seedInternalBusiness({
    name: "Munchkin Town",
    slug: "munchkin-town",
    websiteUrl: "https://munchkintown.com/",
    location: "Tampa Bay",
    content: "Munchkin Town offers indoor play, birthday parties, camps, and family activities for young children. Families can review play sessions, party packages, safety policies, and current availability on the website. Contact the team to reserve a visit or ask about private events.",
  }),
  seedInternalBusiness({
    name: "Tampa Bay Family Dental",
    slug: "tampa-bay-family-dental",
    websiteUrl: "https://tampabayfamilydental.com/",
    location: "Tampa Bay",
    content: "Tampa Bay Family Dental provides preventive care, cleanings, exams, emergency visits, and cosmetic dental consultations for families. New patients can request an appointment, review accepted insurance information, and ask the office about current availability and payment options.",
  }),
];
if (pool) {
  for (const seededBusiness of seededBusinesses) {
    const persistedSeed = await loadBusinessFromDatabase(seededBusiness.slug);
    if (persistedSeed) businesses.set(seededBusiness.slug, persistedSeed);
    else await persistBusiness(seededBusiness);
  }
}
await syncStripePlanPrices();
void probeEmbeddingProvider().then((health) => {
  if (health.status === "healthy") {
    app.log.info({ provider: "OpenAI", model: embeddingModel(), dimensions: embeddingDimensions() }, "Embedding provider readiness probe passed");
  } else {
    app.log.warn({ provider: "OpenAI", model: embeddingModel(), dimensions: embeddingDimensions(), status: health.status, reason: health.reason, httpStatus: health.httpStatus }, "Embedding provider readiness probe failed; semantic search is not healthy");
  }
}).catch((error: unknown) => {
  app.log.warn({ provider: "OpenAI", model: embeddingModel(), dimensions: embeddingDimensions(), error: error instanceof Error ? error.message : "unknown embedding probe error" }, "Embedding provider readiness probe could not complete");
});
await resumeEmbeddingJobs();
void processIntegrationOutbox();
void processActionOutbox();
void processLifecycleMessagingOutbox(pool);
void scheduleNextLifecycleMessaging(pool);
void reconcileLifecycleBillingEvents();
void purgeExpiredCustomerData();
const retentionCleanupTimer = setInterval(() => { void purgeExpiredCustomerData(); }, 60 * 60 * 1_000);
retentionCleanupTimer.unref?.();
const lifecycleBillingTimer = setInterval(() => { void reconcileLifecycleBillingEvents(); }, 60 * 60 * 1_000);
lifecycleBillingTimer.unref?.();

async function requireSuperAdmin(request: FastifyRequest): Promise<AppUser> {
  const { authUser, appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const existing = await pool.query("select 1 from super_admin_users where user_id = $1 and status = 'active'", [appUser.id]);
  if (existing.rowCount) return appUser;
  const allowlisted = superAdminEmails().includes(authUser.email);
  if (!allowlisted) throw httpError(403, "Super-admin access is not enabled for this account");
  await pool.query(
    `insert into super_admin_users (user_id, role, status)
     values ($1, 'super_admin', 'active')
     on conflict (user_id) do update set role = 'super_admin', status = 'active', updated_at = now()`,
    [appUser.id],
  );
  return appUser;
}

async function findOrganizationIdForStripeEvent(object: Record<string, unknown>): Promise<string | null> {
  if (!pool) return null;
  const metadata = asRecord(object.metadata);
  const metadataOrganizationId = stripeMetadataString(metadata, "organization_id", "organizationId") || null;
  const customerId = stripeObjectId(object.customer);
  const subscriptionId = stripeObjectId(object.subscription) ?? stripeObjectId(object.id);
  if (metadataOrganizationId) {
    const scoped = await pool.query<{ id: string; stripe_customer_id: string | null; stripe_subscription_id: string | null }>(
      "select id, stripe_customer_id, stripe_subscription_id from organizations where id = $1",
      [metadataOrganizationId],
    );
    if (!scoped.rowCount) return null;
    const row = scoped.rows[0];
    if ((row.stripe_customer_id && customerId && row.stripe_customer_id !== customerId)
      || (row.stripe_subscription_id && subscriptionId && row.stripe_subscription_id !== subscriptionId)) {
      app.log.warn({ organizationId: metadataOrganizationId, customerId, subscriptionId }, "Ignoring Stripe event with mismatched organization mapping");
      return null;
    }
    return metadataOrganizationId;
  }
  const result = await pool.query<{ id: string }>(
    `select id from organizations
     where ($1::text is not null and stripe_customer_id = $1)
        or ($2::text is not null and stripe_subscription_id = $2)
     order by created_at limit 1`,
    [customerId, subscriptionId],
  );
  return result.rows[0]?.id ?? null;
}

async function authoritativeStripeSubscription(object: Record<string, unknown>): Promise<Record<string, unknown>> {
  const subscriptionId = stripeObjectId(object.id) ?? stripeObjectId(object.subscription);
  if (!subscriptionId || !stripe) return object;
  try {
    const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["schedule.current_phase"],
    });
    return subscription as unknown as Record<string, unknown>;
  } catch (error) {
    // A deleted subscription may no longer be retrievable. The signed event
    // payload is still authoritative for the deletion transition.
    app.log.warn({ subscriptionId, error: error instanceof Error ? error.message : "unknown error" }, "Stripe subscription could not be reloaded; using webhook payload");
    return object;
  }
}

async function queueOrganizationLifecycleEvent(input: {
  organizationId: string;
  eventType: LifecycleEventType;
  eventKey: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  if (!pool) return;
  if (input.eventType === "SUBSCRIPTION_ACTIVATED") {
    await pool.query(
      `update message_deliveries
       set status = 'canceled', updated_at = now()
       where organization_id = $1 and template_key = 'trial_midpoint' and status in ('queued', 'deferred')`,
      [input.organizationId],
    );
  }
  const organization = await pool.query<Record<string, unknown>>(
    `select o.name, o.billing_amount_cents, o.billing_currency, o.current_period_end_at,
            bp.display_name as plan_display_name, bp.monthly_amount_cents, bp.max_businesses,
            coalesce(opo.amount_cents, o.billing_amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
            coalesce(opo.max_businesses, bp.max_businesses, 1) as effective_max_businesses,
            owner.id as owner_id, owner.name as owner_name, owner.email as owner_email
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     left join lateral (
       select u.id, u.name, u.email from organization_members om join app_users u on u.id = om.user_id
       where om.organization_id = o.id and om.role = 'owner' order by om.created_at limit 1
     ) owner on true
     where o.id = $1`,
    [input.organizationId],
  );
  const organizationRow = organization.rows[0] ?? {};
  const business = await pool.query<{ id: string; name: string; slug: string }>(
    `select id, name, slug from businesses where organization_id = $1 order by created_at limit 1`,
    [input.organizationId],
  );
  const row = business.rows[0];
  const ownerId = typeof organizationRow.owner_id === "string" ? organizationRow.owner_id : null;
  const ownerEmail = typeof organizationRow.owner_email === "string" ? organizationRow.owner_email : null;
  if (!row && !ownerEmail) return;
  const amount = organizationRow.effective_amount_cents === null || organizationRow.effective_amount_cents === undefined
    ? null : Number(organizationRow.effective_amount_cents);
  const interval = String(input.payload.billing_interval ?? "month") === "year" ? "year" : "month";
  const nextRenewalDate = input.payload.next_renewal_date
    ?? (organizationRow.current_period_end_at ? new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(toIso(organizationRow.current_period_end_at))) : "Not scheduled");
  const formatLifecycleDate = (value: unknown): string | null => {
    if (typeof value !== "string" || !value.trim()) return null;
    const timestamp = Date.parse(value);
    return Number.isNaN(timestamp) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "long" }).format(new Date(timestamp));
  };
  const enrichedPayload = {
    business_name: row?.name ?? String(organizationRow.name ?? "FrontDeskWise"),
    organization_name: String(organizationRow.name ?? row?.name ?? "FrontDeskWise"),
    customer_name: String(organizationRow.owner_name ?? "there"),
    billing_email: String(organizationRow.owner_email ?? "your billing email"),
    plan_name: String(organizationRow.plan_display_name ?? input.payload.plan_name ?? "FrontDeskWise"),
    current_plan_name: String(organizationRow.plan_display_name ?? input.payload.current_plan_name ?? "FrontDeskWise"),
    price_display: input.payload.price_display ?? (amount === null ? "Contact support" : `$${(amount / 100).toFixed(0)}/${interval}`),
    businesses_included: input.payload.businesses_included ?? String(organizationRow.effective_max_businesses ?? organizationRow.max_businesses ?? 1),
    next_renewal_date: nextRenewalDate,
    status: input.payload.status ?? "Active",
    effective_date: input.payload.effective_date ?? nextRenewalDate,
    dashboard_url: lifecycleAppUrl("/app"),
    billing_url: lifecycleAppUrl("/app/settings/billing"),
    support_url: process.env.FRONTDESKWISE_SUPPORT_URL?.trim() || "mailto:support@frontdeskwise.com",
    ...input.payload,
    ...(formatLifecycleDate(input.payload.access_end_at) ? { access_end_at: formatLifecycleDate(input.payload.access_end_at) } : {}),
    ...(formatLifecycleDate(input.payload.grace_end_at) ? { grace_end_at: formatLifecycleDate(input.payload.grace_end_at) } : {}),
  };
  const queued = await queueLifecycleEvent({
    eventType: input.eventType,
    eventKey: input.eventKey,
    organizationId: input.organizationId,
    businessId: row?.id ?? null,
    recipientUserId: ownerId,
    recipientEmail: ownerEmail,
    payload: enrichedPayload,
  });
  if (input.eventType === "SUBSCRIPTION_ACTIVATED" && queued > 0) {
    await pool.query(
      `update organizations
       set subscription_activation_email_queued_at = coalesce(subscription_activation_email_queued_at, now()), updated_at = now()
       where id = $1`,
      [input.organizationId],
    );
  }
}

async function recordBillingTimeline(input: {
  organizationId: string | null;
  eventKey: string;
  eventName: string;
  providerEventId?: string | null;
  status?: "recorded" | "queued" | "sent" | "failed";
  metadata?: Record<string, unknown>;
}): Promise<void> {
  if (!pool || !input.organizationId) return;
  try {
    await pool.query(
      `insert into billing_timeline_events
         (organization_id, event_key, event_name, provider_event_id, status, metadata)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (organization_id, event_key) do update set
         status = excluded.status,
         provider_event_id = coalesce(excluded.provider_event_id, billing_timeline_events.provider_event_id),
         metadata = billing_timeline_events.metadata || excluded.metadata`,
      [input.organizationId, input.eventKey, input.eventName, input.providerEventId ?? null, input.status ?? "recorded", JSON.stringify(input.metadata ?? {})],
    );
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    app.log.warn({ organizationId: input.organizationId, eventName: input.eventName }, "Billing timeline migration is not available yet");
  }
}

async function reconcileLifecycleBillingEvents(): Promise<void> {
  if (!pool) return;
  const result = await pool.query<{ id: string; trial_end_at: string | null }>(
    `select id, trial_end_at
     from organizations
     where billing_status = 'trial' and trial_end_at is not null`,
  );
  const now = Date.now();
  for (const row of result.rows) {
    if (!row.trial_end_at) continue;
    const trialEnd = Date.parse(toIso(row.trial_end_at));
    if (Number.isNaN(trialEnd)) continue;
    if (trialEnd <= now) {
      await queueOrganizationLifecycleEvent({
        organizationId: row.id,
        eventType: "TRIAL_EXPIRED",
        eventKey: `trial.expired:${row.id}:${row.trial_end_at}`,
        payload: { billing_url: lifecycleAppUrl("/app/settings/billing") },
      });
    } else if (trialEnd <= now + 3 * 24 * 60 * 60 * 1_000) {
      await queueOrganizationLifecycleEvent({
        organizationId: row.id,
        eventType: "TRIAL_ENDING_SOON",
        eventKey: `trial.ending_soon:${row.id}:${row.trial_end_at}`,
        payload: { trial_days_remaining: Math.max(1, Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1_000))), billing_url: lifecycleAppUrl("/app/settings/billing") },
      });
    }
  }
}

async function handleStripeEvent(event: Stripe.Event): Promise<void> {
  if (!pool) throw httpError(503, "Stripe webhooks require PostgreSQL storage");
  const object = asRecord(event.data.object);
  const eventMetadata = asRecord(object.metadata);
  const eventApp = optionalString(eventMetadata.app, 80);
  // A Stripe account can host multiple Sudo Programmer products. Ignore events
  // explicitly tagged for another product before recording them locally.
  if (eventApp && eventApp !== stripeAppMetadata) return;
  const organizationId = await findOrganizationIdForStripeEvent(object);
  await pool.query(
    `insert into billing_events (organization_id, provider, event_id, event_type, livemode, payload)
     values ($1, 'stripe', $2, $3, $4, $5)
     on conflict (provider, event_id) do nothing`,
    [organizationId, event.id, event.type, event.livemode, JSON.stringify(event)],
  );
  const claimed = await pool.query(
    `update billing_events
     set processing_started_at = now(), processing_attempts = processing_attempts + 1, last_error = null
     where provider = 'stripe' and event_id = $1 and processed_at is null
       and (processing_started_at is null or processing_started_at < now() - interval '15 minutes')
     returning id`,
    [event.id],
  );
  if (!claimed.rowCount) return;

  let resolvedOrganizationId = organizationId;
  try {
    if (event.type === "checkout.session.completed") {
      const customerId = stripeObjectId(object.customer);
      const subscriptionId = stripeObjectId(object.subscription);
      const metadata = asRecord(object.metadata);
      if (resolvedOrganizationId) {
        await pool.query(
          `update organizations
           set billing_provider = 'stripe', stripe_customer_id = coalesce($2, stripe_customer_id),
               stripe_subscription_id = coalesce($3, stripe_subscription_id),
               stripe_checkout_session_id = $4, stripe_checkout_status = 'complete',
               updated_at = now()
           where id = $1`,
          [resolvedOrganizationId, customerId, subscriptionId, stripeObjectId(object.id)],
        );
        await recordBillingTimeline({
          organizationId: resolvedOrganizationId,
          eventKey: `checkout.completed:${stripeObjectId(object.id) ?? event.id}`,
          eventName: "checkout_completed",
          providerEventId: event.id,
          metadata: { subscriptionId, planKey: stripeMetadataString(metadata, "plan_key", "planKey") },
        });
      }
      if (subscriptionId && resolvedOrganizationId) {
        const subscription = await authoritativeStripeSubscription({ id: subscriptionId, customer: customerId });
        const checkoutPaymentStatus = String(object.payment_status ?? "");
        const paymentConfirmed = checkoutPaymentStatus === "paid" || checkoutPaymentStatus === "no_payment_required";
        const sync = await updateOrganizationFromStripeSubscription(resolvedOrganizationId, subscription, event.created, event.id, {
          allowPlanChange: paymentConfirmed,
          paymentConfirmed,
        });
        if (sync?.status === "active" && sync.previousStatus !== "active") {
          const activationKey = `stripe.subscription_activated:${sync.subscriptionId ?? subscriptionId}`;
          await queueOrganizationLifecycleEvent({ organizationId: resolvedOrganizationId, eventType: "SUBSCRIPTION_ACTIVATED", eventKey: activationKey, payload: { status: "Active" } });
          await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: activationKey, eventName: "subscription_activated", providerEventId: event.id, status: "queued", metadata: { planKey: sync.planKey } });
        }
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      if (resolvedOrganizationId) {
        const subscription = await authoritativeStripeSubscription(object);
        const sync = await updateOrganizationFromStripeSubscription(resolvedOrganizationId, subscription, event.created, event.id);
        if (sync && !sync.ignoredAsStale && sync.status === "active" && sync.previousStatus !== "active") {
          const activationKey = `stripe.subscription_activated:${sync.subscriptionId ?? stripeObjectId(object.id) ?? event.id}`;
          await queueOrganizationLifecycleEvent({ organizationId: resolvedOrganizationId, eventType: "SUBSCRIPTION_ACTIVATED", eventKey: activationKey, payload: { status: "Active" } });
          await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: activationKey, eventName: "subscription_activated", providerEventId: event.id, status: "queued", metadata: { planKey: sync.planKey } });
        } else if (sync && !sync.ignoredAsStale && event.type === "customer.subscription.updated" && sync.previousStatus === "active" && sync.status === "active" && sync.previousPlanKey !== sync.planKey) {
          const updateKey = `stripe.subscription_updated:${sync.subscriptionId ?? stripeObjectId(object.id) ?? event.id}:${sync.planKey}`;
          await queueOrganizationLifecycleEvent({ organizationId: resolvedOrganizationId, eventType: "SUBSCRIPTION_UPDATED", eventKey: updateKey, payload: { status: "Active" } });
          await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: updateKey, eventName: "subscription_updated", providerEventId: event.id, status: "queued", metadata: { fromPlanKey: sync.previousPlanKey, planKey: sync.planKey } });
        }
        if (sync && event.type === "customer.subscription.deleted") {
          await queueOrganizationLifecycleEvent({
            organizationId: resolvedOrganizationId,
            eventType: "SUBSCRIPTION_CANCELED",
            eventKey: `stripe.subscription_canceled:${sync.subscriptionId ?? stripeObjectId(object.id) ?? event.id}`,
            payload: { access_end_at: sync.currentPeriodEndAt || "the end of your current billing period" },
          });
          await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: `subscription.canceled:${sync.subscriptionId ?? event.id}`, eventName: "subscription_canceled", providerEventId: event.id, metadata: { accessEndAt: sync.currentPeriodEndAt } });
        }
      }
    } else if (event.type === "invoice.paid") {
      const subscriptionId = stripeObjectId(object.subscription);
      if (subscriptionId && stripe) {
        const subscription = await authoritativeStripeSubscription({ id: subscriptionId, customer: object.customer });
        resolvedOrganizationId ??= await findOrganizationIdForStripeEvent(subscription);
        if (resolvedOrganizationId) {
          let sync: StripeSubscriptionSyncResult | null = null;
          if (Array.isArray(asRecord(subscription.items).data)) {
            sync = await updateOrganizationFromStripeSubscription(resolvedOrganizationId, subscription, event.created, event.id, {
              allowPlanChange: true,
              paymentConfirmed: true,
            });
          }
          await pool.query(
            "update organizations set billing_status = 'active', last_payment_status = 'paid', grace_end_at = null, updated_at = now() where id = $1",
            [resolvedOrganizationId],
          );
          if (sync && sync.previousStatus === "active" && sync.status === "active" && sync.previousPlanKey !== sync.planKey) {
            const updateKey = `stripe.subscription_updated:${sync.subscriptionId ?? subscriptionId}:${sync.planKey}`;
            await queueOrganizationLifecycleEvent({
              organizationId: resolvedOrganizationId,
              eventType: "SUBSCRIPTION_UPDATED",
              eventKey: updateKey,
              payload: {
                status: "Active",
                current_plan_name: billingPlanDisplayName(sync.previousPlanKey),
                plan_name: billingPlanDisplayName(sync.planKey),
                effective_date: new Date().toISOString(),
              },
            });
            await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: updateKey, eventName: "subscription_updated", providerEventId: event.id, status: "queued", metadata: { fromPlanKey: sync.previousPlanKey, planKey: sync.planKey } });
          }
          await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: `invoice.paid:${stripeObjectId(object.id) ?? event.id}`, eventName: "invoice_paid", providerEventId: event.id, metadata: { subscriptionId } });
        }
      } else if (resolvedOrganizationId) {
        await pool.query("update organizations set billing_status = 'active', last_payment_status = 'paid', grace_end_at = null, updated_at = now() where id = $1", [resolvedOrganizationId]);
        const client = await pool.connect();
        try {
          await syncOrganizationBillingToBusinesses(client, resolvedOrganizationId);
        } finally {
          client.release();
        }
      }
    } else if (event.type === "invoice.payment_failed" && resolvedOrganizationId) {
      const billingState = await pool.query<{ billing_status: string; pending_plan_change_type: string | null; plan_key: string; pending_plan_key: string | null }>(
        `select billing_status, pending_plan_change_type, plan_key, pending_plan_key
         from organizations where id = $1`,
        [resolvedOrganizationId],
      );
      const billingRow = billingState.rows[0];
      const failureContext = billingPaymentFailureContext({
        billingReason: typeof object.billing_reason === "string" ? object.billing_reason : null,
        pendingPlanChangeType: billingRow?.pending_plan_change_type ?? null,
      });
      const invoiceId = stripeObjectId(object.id) ?? event.id;
      if (failureContext === "upgrade") {
        await pool.query(
          `update organizations
           set billing_status = case when billing_status in ('cancelled', 'paused', 'grace', 'trial') then billing_status else 'active' end,
               billing_provider = 'stripe', last_payment_status = 'failed', updated_at = now()
           where id = $1`,
          [resolvedOrganizationId],
        );
        const client = await pool.connect();
        try {
          await syncOrganizationBillingToBusinesses(client, resolvedOrganizationId);
        } finally {
          client.release();
        }
        await queueOrganizationLifecycleEvent({
          organizationId: resolvedOrganizationId,
          eventType: "SUBSCRIPTION_UPGRADE_PAYMENT_FAILED",
          eventKey: `stripe.upgrade_payment_failed:${invoiceId}`,
          payload: {
            current_plan_name: billingPlanDisplayName(billingRow?.plan_key ?? "starter"),
            plan_name: billingPlanDisplayName(billingRow?.pending_plan_key ?? "requested plan"),
            status: "Payment action required",
          },
        });
        await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: `invoice.upgrade_failed:${invoiceId}`, eventName: "subscription_upgrade_payment_failed", providerEventId: event.id, metadata: { pendingPlanKey: billingRow?.pending_plan_key ?? null } });
      } else {
        const graceEndAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
        await pool.query(
          `update organizations
           set billing_status = case when billing_status in ('cancelled', 'paused') then billing_status else 'grace' end,
               grace_end_at = case when billing_status in ('cancelled', 'paused') then grace_end_at else $2 end,
               billing_provider = 'stripe', last_payment_status = 'failed', updated_at = now()
           where id = $1`,
          [resolvedOrganizationId, graceEndAt],
        );
        const client = await pool.connect();
        try {
          await syncOrganizationBillingToBusinesses(client, resolvedOrganizationId);
        } finally {
          client.release();
        }
        await queueOrganizationLifecycleEvent({
          organizationId: resolvedOrganizationId,
          eventType: "PAYMENT_FAILED",
          eventKey: `stripe.payment_failed:${invoiceId}`,
          payload: { grace_end_at: graceEndAt },
        });
        await recordBillingTimeline({ organizationId: resolvedOrganizationId, eventKey: `invoice.failed:${invoiceId}`, eventName: "invoice_failed", providerEventId: event.id, metadata: { graceEndAt } });
      }
    }

    await pool.query(
      `update billing_events
       set organization_id = coalesce(organization_id, $2), processed_at = now(), processing_started_at = null, last_error = null
       where provider = 'stripe' and event_id = $1`,
      [event.id, resolvedOrganizationId],
    );
  } catch (error) {
    if (resolvedOrganizationId && (event.type === "checkout.session.completed" || event.type.startsWith("customer.subscription."))) {
      await recordBillingTimeline({
        organizationId: resolvedOrganizationId,
        eventKey: `subscription.activation_failed:${event.id}`,
        eventName: "subscription_activation_failed",
        providerEventId: event.id,
        status: "failed",
        metadata: { error: error instanceof Error ? error.message : "Stripe subscription processing failed" },
      }).catch(() => undefined);
    }
    await pool.query(
      `update billing_events
       set organization_id = coalesce(organization_id, $2), processing_started_at = null,
           last_error = $3
       where provider = 'stripe' and event_id = $1`,
      [event.id, resolvedOrganizationId, (error instanceof Error ? error.message : "Stripe event processing failed").slice(0, 1_000)],
    );
    throw error;
  }
}

app.addHook("onRequest", async (request, reply) => {
  const requestOrigin = typeof request.headers.origin === "string" ? request.headers.origin : null;
  const path = request.url.split("?", 1)[0];
  const isPublicWidgetRoute = path.startsWith("/api/v1/widget/");
  const allowOrigin = isPublicWidgetRoute || allowedWebOrigins.includes("*")
    ? "*"
    : (requestOrigin && allowedWebOrigins.includes(requestOrigin) ? requestOrigin : allowedWebOrigins[0] ?? "null");
  reply.header("Access-Control-Allow-Origin", allowOrigin);
  reply.header("Vary", "Origin");
  reply.header("Access-Control-Allow-Headers", "content-type, authorization, idempotency-key, x-frontdeskwise-demo-token");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  reply.header("Access-Control-Expose-Headers", "X-Request-Id, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset");
  reply.header("Access-Control-Max-Age", "600");
  reply.header("X-Request-Id", request.id);
  reply.header("X-Content-Type-Options", "nosniff");
  if (request.method === "OPTIONS") return reply.code(204).send();

  if (!path.startsWith("/api/")) return;
  const limiter = request.method === "POST" && path === "/api/v1/demos" ? demoRateLimiter : apiRateLimiter;
  const result = limiter.consume(`${request.ip}:${request.method}:${path}`);
  reply.header("X-RateLimit-Limit", result.limit);
  reply.header("X-RateLimit-Remaining", result.remaining);
  reply.header("X-RateLimit-Reset", Math.ceil(result.resetAt / 1_000));
  if (!result.allowed) {
    reply.header("Retry-After", Math.max(1, Math.ceil((result.resetAt - Date.now()) / 1_000)));
    return reply.code(429).send({ error: "Too many requests", requestId: request.id });
  }
});

app.get("/health", async () => ({
  ok: true,
  service: "frontdeskwise-api",
  databaseConfigured: Boolean(pool),
  storage: pool ? "postgres" : "memory",
  embeddingProvider: "openai",
  embeddingModel: embeddingModel(),
  embeddingDimensions: embeddingDimensions(),
  embeddingConfigured: embeddingsConfigured(),
  embeddingProviderStatus: embeddingProviderHealth().status,
  objectStorageConfigured: storageConfigured(),
  emailConfigured: sesConfigured(),
  stripeConfigured: Boolean(stripe),
}));

app.get("/ready", async (_request, reply) => {
  if (!pool) return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_not_configured" });
  try {
    await pool.query("select 1");
    return {
      ok: true,
      service: "frontdeskwise-api",
      database: "ready",
      semanticSearch: {
        provider: "openai",
        model: embeddingModel(),
        dimensions: embeddingDimensions(),
        configured: embeddingsConfigured(),
        providerStatus: embeddingProviderHealth().status,
        providerReason: embeddingProviderHealth().reason,
      },
      objectStorageConfigured: storageConfigured(),
      emailConfigured: sesConfigured(),
      stripeConfigured: Boolean(stripe),
    };
  } catch {
    return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_unavailable" });
  }
});

app.get("/api/v1/admin/rag/metrics", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "RAG metrics require PostgreSQL storage");
  const [businessesResult, jobsResult, jobMetricsResult] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `select b.id, b.name, b.slug,
              count(kc.id)::text as total_chunks,
              count(kc.id) filter (where kc.embedding is not null and kc.embedding_model = $1 and kc.embedding_dimensions = $2)::text as embedded_chunks
       from businesses b
       left join knowledge_chunks kc on kc.business_id = b.id
       group by b.id, b.name, b.slug
       order by b.name, b.slug`,
      [embeddingModel(), embeddingDimensions()],
    ),
    pool.query<Record<string, unknown>>(
      `select distinct on (business_id)
              business_id, id, status, model, attempts, max_attempts, total_chunks, embedded_chunks,
              next_attempt_at, started_at, completed_at, last_error
       from embedding_jobs
       order by business_id, created_at desc`,
    ),
    pool.query<{ attempted: string; failed: string }>(
      `select coalesce(sum(attempts), 0)::text as attempted,
              count(*) filter (where status = 'failed')::text as failed
       from embedding_jobs`,
    ),
  ]);
  const provider = embeddingProviderHealth();
  const jobsByBusiness = new Map(jobsResult.rows.map((job) => [String(job.business_id), job]));
  const statuses = businessesResult.rows.map((business) => {
    const job = jobsByBusiness.get(String(business.id));
    const readiness = embeddingReadiness({
      configured: embeddingsConfigured(),
      providerStatus: provider.status,
      providerReason: provider.reason,
      model: embeddingModel(),
      dimensions: embeddingDimensions(),
      totalChunks: Number(business.total_chunks ?? 0),
      embeddedChunks: Number(business.embedded_chunks ?? 0),
      latestJob: job ? {
        id: String(job.id),
        status: String(job.status),
        model: String(job.model),
        attempts: Number(job.attempts),
        maxAttempts: Number(job.max_attempts),
        totalChunks: Number(job.total_chunks),
        embeddedChunks: Number(job.embedded_chunks),
        nextAttemptAt: job.next_attempt_at ? toIso(job.next_attempt_at) : null,
        startedAt: job.started_at ? toIso(job.started_at) : null,
        completedAt: job.completed_at ? toIso(job.completed_at) : null,
        lastError: typeof job.last_error === "string" ? job.last_error : null,
      } : null,
    });
    return { id: String(business.id), name: String(business.name), slug: String(business.slug), readiness };
  });
  return {
    provider: { name: "OpenAI", model: embeddingModel(), dimensions: embeddingDimensions(), ...provider },
    metrics: {
      ...ragMetricsSnapshot(),
      durableEmbeddingJobsAttempted: Number(jobMetricsResult.rows[0]?.attempted ?? 0),
      durableEmbeddingJobsFailed: Number(jobMetricsResult.rows[0]?.failed ?? 0),
    },
    businesses: statuses,
  };
});

app.get("/api/v1/admin/widget-performance", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Widget performance observability requires PostgreSQL storage");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const businessId = optionalString(query.businessId, 80);
  const siteKey = optionalString(query.siteKey, 160);
  const requestedLimit = Number(query.limit ?? 200);
  const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200));
  const [summaryResult, eventsResult] = await Promise.all([
    pool.query<Record<string, unknown>>(
      `select wpe.event_type,
              count(*)::integer as samples,
              round(avg(wpe.duration_ms))::integer as average_duration_ms,
              (percentile_cont(0.50) within group (order by wpe.duration_ms) filter (where wpe.duration_ms is not null))::integer as p50_duration_ms,
              (percentile_cont(0.95) within group (order by wpe.duration_ms) filter (where wpe.duration_ms is not null))::integer as p95_duration_ms
       from widget_performance_events wpe
       join businesses b on b.id = wpe.business_id
       where ($1::uuid is null or wpe.business_id = $1::uuid)
         and ($2::text is null or b.public_site_key = $2)
       group by wpe.event_type
       order by wpe.event_type`,
      [businessId, siteKey],
    ),
    pool.query<Record<string, unknown>>(
      `select wpe.id, wpe.event_type, wpe.duration_ms, wpe.occurred_at, wpe.request_id,
              wpe.conversation_id, wpe.source_page, wpe.device, wpe.metrics,
              b.id as business_id, b.name as business_name, b.slug
       from widget_performance_events wpe
       join businesses b on b.id = wpe.business_id
       where ($1::uuid is null or wpe.business_id = $1::uuid)
         and ($2::text is null or b.public_site_key = $2)
       order by wpe.occurred_at desc
       limit $3`,
      [businessId, siteKey, limit],
    ),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    summary: summaryResult.rows.map((row) => ({
      event: String(row.event_type),
      samples: Number(row.samples ?? 0),
      averageDurationMs: row.average_duration_ms === null ? null : Number(row.average_duration_ms),
      p50DurationMs: row.p50_duration_ms === null ? null : Number(row.p50_duration_ms),
      p95DurationMs: row.p95_duration_ms === null ? null : Number(row.p95_duration_ms),
    })),
    events: eventsResult.rows.map((row) => ({
      id: String(row.id),
      event: String(row.event_type),
      durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
      occurredAt: nullableIso(row.occurred_at),
      requestId: row.request_id ? String(row.request_id) : null,
      conversationId: row.conversation_id ? String(row.conversation_id) : null,
      sourcePage: row.source_page ? String(row.source_page) : null,
      device: row.device ? String(row.device) : null,
      metrics: boundedPerformanceMetrics(row.metrics),
      business: { id: String(row.business_id), name: String(row.business_name), slug: String(row.slug) },
    })),
  };
});

app.get("/api/v1/storage/documents", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  if (!storageConfigured()) throw httpError(503, storageConfigurationMessage());
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const organizationId = requiredString(query.organizationId, "organizationId", 80);
  const businessId = optionalString(query.businessId, 80);
  await organizationForUser(appUser.id, organizationId);
  if (businessId) await organizationBusinessForUser(appUser.id, organizationId, businessId);
  const result = await pool.query<Record<string, unknown>>(
    `select id, organization_id, business_id, original_file_name, content_type,
            size_bytes, etag, status, metadata, created_at, updated_at
     from organization_documents
     where organization_id = $1 and status <> 'deleted'
       and ($2::uuid is null or business_id = $2::uuid)
     order by created_at desc`,
    [organizationId, businessId],
  );
  return { documents: result.rows.map(organizationDocumentPayload), maxDocumentBytes: maxDocumentBytes(), allowedContentTypes: allowedDocumentTypeList() };
});

app.post("/api/v1/storage/documents/presign", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  if (!storageConfigured()) throw httpError(503, storageConfigurationMessage());
  const body = asRecord(request.body);
  const organizationId = requiredString(body.organizationId, "organizationId", 80);
  const businessId = optionalString(body.businessId, 80);
  const fileName = requiredString(body.fileName, "fileName", 240);
  const contentType = requiredString(body.contentType, "contentType", 160).toLowerCase();
  const sizeBytes = Number(body.sizeBytes);
  const organization = await organizationForUser(appUser.id, organizationId);
  requireWritableOrganization(organization);
  if (businessId) await organizationBusinessForUser(appUser.id, organizationId, businessId);
  if (!isAllowedDocumentType(contentType)) throw httpError(400, `Unsupported document type. Allowed types: ${allowedDocumentTypeList().join(", ")}`);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) throw httpError(400, "sizeBytes must be a positive integer");
  if (sizeBytes > maxDocumentBytes()) throw httpError(413, `Document exceeds the ${Math.round(maxDocumentBytes() / 1024 / 1024)} MB upload limit`);
  const documentId = randomUUID();
  const objectKey = organizationDocumentKey({ organizationId, businessId, documentId, fileName });
  const result = await pool.query<Record<string, unknown>>(
    `insert into organization_documents
       (id, organization_id, business_id, uploaded_by_user_id, object_key, original_file_name, content_type, size_bytes, status)
     values ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
     returning id, organization_id, business_id, original_file_name, content_type,
               size_bytes, etag, status, metadata, created_at, updated_at`,
    [documentId, organizationId, businessId, appUser.id, objectKey, safeDocumentFileName(fileName), contentType, sizeBytes],
  );
  let upload;
  try {
    upload = await createDocumentUpload({ key: objectKey, contentType, contentLength: sizeBytes });
  } catch (error) {
    await pool.query("delete from organization_documents where id = $1", [documentId]);
    throw error;
  }
  return { document: organizationDocumentPayload(result.rows[0]), upload: { ...upload, method: "PUT" } };
});

app.post("/api/v1/storage/documents/:documentId/complete", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  if (!storageConfigured()) throw httpError(503, storageConfigurationMessage());
  const params = request.params as { documentId?: string };
  const documentId = requiredString(params.documentId, "documentId", 80);
  const result = await pool.query<Record<string, unknown>>(
    `select id, organization_id, business_id, object_key, original_file_name, content_type,
            size_bytes, etag, status, metadata, created_at, updated_at
     from organization_documents d
     where d.id = $1 and d.status <> 'deleted'
       and exists (select 1 from organization_members om where om.organization_id = d.organization_id and om.user_id = $2 and om.role = any($3::text[]))`,
    [documentId, appUser.id, ["owner", "admin"]],
  );
  if (!result.rowCount) throw httpError(404, "Document not found");
  const row = result.rows[0];
  const organization = await organizationForUser(appUser.id, String(row.organization_id));
  requireWritableOrganization(organization);
  const object = await inspectDocumentObject(String(row.object_key));
  if (object.ContentLength !== undefined && object.ContentLength !== Number(row.size_bytes)) {
    await deleteDocumentObject(String(row.object_key));
    await pool.query("update organization_documents set status = 'failed', updated_at = now() where id = $1", [documentId]);
    throw httpError(400, "Uploaded document size does not match the presigned upload request");
  }
  const updated = await pool.query<Record<string, unknown>>(
    `update organization_documents
     set status = 'uploaded', size_bytes = coalesce($2, size_bytes), etag = $3, updated_at = now()
     where id = $1
     returning id, organization_id, business_id, original_file_name, content_type,
               size_bytes, etag, status, metadata, created_at, updated_at`,
    [documentId, object.ContentLength ?? null, object.ETag?.replace(/^"|"$/g, "") ?? null],
  );
  void processOrganizationDocument(documentId).catch((error: unknown) => {
    app.log.warn({ documentId, error: error instanceof Error ? error.message : "unknown error" }, "Organization document processing could not start");
  });
  return { document: organizationDocumentPayload(updated.rows[0]) };
});

app.get("/api/v1/storage/documents/:documentId/download", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  if (!storageConfigured()) throw httpError(503, storageConfigurationMessage());
  const params = request.params as { documentId?: string };
  const documentId = requiredString(params.documentId, "documentId", 80);
  const result = await pool.query<Record<string, unknown>>(
    `select id, organization_id, object_key, original_file_name
     from organization_documents d
     where d.id = $1 and d.status <> 'deleted'
       and exists (select 1 from organization_members om where om.organization_id = d.organization_id and om.user_id = $2 and om.role = any($3::text[]))`,
    [documentId, appUser.id, ["owner", "admin"]],
  );
  if (!result.rowCount) throw httpError(404, "Document not found");
  const row = result.rows[0];
  const download = await createDocumentDownload(String(row.object_key), String(row.original_file_name));
  return { documentId, ...download };
});

app.delete("/api/v1/storage/documents/:documentId", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Document storage requires PostgreSQL storage");
  if (!storageConfigured()) throw httpError(503, storageConfigurationMessage());
  const params = request.params as { documentId?: string };
  const documentId = requiredString(params.documentId, "documentId", 80);
  const result = await pool.query<Record<string, unknown>>(
    `select id, organization_id, object_key
     from organization_documents d
     where d.id = $1 and d.status <> 'deleted'
       and exists (select 1 from organization_members om where om.organization_id = d.organization_id and om.user_id = $2 and om.role = any($3::text[]))`,
    [documentId, appUser.id, ["owner", "admin"]],
  );
  if (!result.rowCount) throw httpError(404, "Document not found");
  const organization = await organizationForUser(appUser.id, String(result.rows[0].organization_id));
  requireWritableOrganization(organization);
  await deleteDocumentObject(String(result.rows[0].object_key));
  await pool.query("update organization_documents set status = 'deleted', updated_at = now() where id = $1", [documentId]);
  return { ok: true, documentId };
});

app.get("/api/v1/billing", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  const organizationId = optionalString((request.query as Record<string, unknown> | undefined)?.organizationId, 80);
  return billingSnapshotForUser(appUser.id, organizationId);
});

app.post("/api/v1/billing/events", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  const body = asRecord(request.body);
  const organization = await organizationForUser(appUser.id, optionalString(body.organizationId, 80));
  const event = optionalString(body.event, 80);
  const allowedEvents = new Set([
    "checkout_returned",
    "subscription_pending",
    "subscription_activated",
    "subscription_success_screen_viewed",
    "subscription_success_continue_clicked",
  ]);
  if (!event || !allowedEvents.has(event)) throw httpError(400, "Unsupported billing event");
  const requestedSessionId = optionalString(body.sessionId, 255);
  const sessionId = requestedSessionId && requestedSessionId === String(organization.stripe_checkout_session_id ?? "") ? requestedSessionId : null;
  const planKey = optionalString(body.planKey, 80) ?? String(organization.plan_key ?? "starter");
  const eventKey = `frontend:${event}:${sessionId ?? String(organization.id)}:${planKey}`;
  await recordBillingTimeline({
    organizationId: String(organization.id),
    eventKey,
    eventName: event,
    metadata: { sessionId, planKey },
  });
  return { ok: true };
});

app.post("/api/v1/billing/checkout-session", async (request) => {
  const client = requireStripe();
  const { appUser } = await authenticatedAppUser(request);
  const body = asRecord(request.body);
  const organizationId = optionalString(body.organizationId, 80);
  const organization = await organizationForUser(appUser.id, organizationId);
  const planKey = optionalString(body.planKey, 80) ?? String(organization.plan_key ?? "starter");
  const interval = body.interval === "year" ? "year" : "month";
  const price = await resolveStripePrice(String(organization.id), planKey, interval);
  let customerId = typeof organization.stripe_customer_id === "string" ? organization.stripe_customer_id : null;
  const customerMetadata = frontDeskWiseStripeMetadata(String(organization.id), planKey);
  if (!customerId) {
    const customer = await client.customers.create({
      email: appUser.email,
      name: appUser.name,
      metadata: customerMetadata,
    });
    customerId = customer.id;
    await pool?.query("update organizations set stripe_customer_id = $2, billing_provider = 'stripe', updated_at = now() where id = $1", [organization.id, customerId]);
  } else {
    await client.customers.update(customerId, { metadata: customerMetadata });
  }

  // One organization owns one subscription. A second Checkout Session for an
  // existing paid organization would create duplicate subscriptions, so plan
  // changes update the existing Stripe subscription and still wait for the
  // signed webhook before changing FrontDeskWise state.
  let existingSubscriptionId = typeof organization.stripe_subscription_id === "string" ? organization.stripe_subscription_id : null;
  let existingSubscription: Stripe.Subscription | null = null;
  if (existingSubscriptionId) {
    try {
      existingSubscription = await client.subscriptions.retrieve(existingSubscriptionId);
      if (["canceled", "incomplete_expired"].includes(existingSubscription.status)) {
        existingSubscription = null;
        existingSubscriptionId = null;
      }
    } catch {
      existingSubscription = null;
      existingSubscriptionId = null;
    }
  }
  if (!existingSubscription && customerId) {
    const subscriptions = await client.subscriptions.list({ customer: customerId, status: "all", limit: 20 });
    existingSubscription = subscriptions.data.find((candidate) => {
      if (["canceled", "incomplete_expired"].includes(candidate.status)) return false;
      const metadata = candidate.metadata ?? {};
      return metadata.app === stripeAppMetadata && metadata.organization_id === String(organization.id);
    }) ?? null;
    existingSubscriptionId = existingSubscription?.id ?? null;
  }
  if (existingSubscription && existingSubscriptionId) {
    const item = existingSubscription.items.data[0];
    if (!item) throw httpError(409, "The current Stripe subscription has no billable item");
    const currentPlanKey = String(organization.plan_key ?? "starter");
    const changeType: BillingPlanChangeType = billingPlanChangeType(currentPlanKey, planKey);
    const pendingPlanKey = typeof organization.pending_plan_key === "string" ? organization.pending_plan_key : null;
    if (pendingPlanKey === planKey && changeType !== "none") {
      throw httpError(409, `A ${billingPlanDisplayName(planKey)} change is already pending`);
    }
    if (item.price.id === price.priceId && existingSubscription.cancel_at_period_end !== true && !pendingPlanKey) {
      throw httpError(409, "This organization is already on that plan");
    }
    if (existingSubscription.status !== "active" && changeType !== "none") {
      throw httpError(409, "Resolve the current subscription payment before changing plans");
    }

    let effectiveAt: string | null = null;
    let scheduleId: string | null = null;
    if (changeType === "downgrade") {
      if (existingSubscription.cancel_at_period_end === true) {
        existingSubscription = await client.subscriptions.update(existingSubscriptionId, {
          cancel_at_period_end: false,
          metadata: frontDeskWiseStripeMetadata(String(organization.id), currentPlanKey),
        });
      }
      const scheduled = await scheduleStripeDowngrade(client, existingSubscription, String(organization.id), price.priceId, planKey);
      effectiveAt = scheduled.effectiveAt;
      scheduleId = scheduled.scheduleId;
      await pool?.query(
        `update organizations
         set stripe_customer_id = $2, stripe_subscription_id = $3, billing_provider = 'stripe',
             stripe_subscription_schedule_id = $4, pending_plan_key = $5, pending_billing_interval = $6,
             pending_plan_change_type = 'downgrade', pending_plan_change_at = $7,
             updated_at = now()
         where id = $1`,
        [organization.id, customerId, existingSubscriptionId, scheduleId, planKey, interval, effectiveAt],
      );
    } else if (changeType === "upgrade") {
      await releaseStripeSubscriptionSchedule(client, stripeObjectId(existingSubscription.schedule) ?? (typeof organization.stripe_subscription_schedule_id === "string" ? organization.stripe_subscription_schedule_id : null));
      await client.subscriptions.update(existingSubscriptionId, {
        items: [{ id: item.id, price: price.priceId }],
        proration_behavior: "always_invoice",
        payment_behavior: "pending_if_incomplete",
        cancel_at_period_end: false,
        metadata: frontDeskWiseStripeMetadata(String(organization.id), planKey),
      });
      await pool?.query(
        `update organizations
         set stripe_customer_id = $2, stripe_subscription_id = $3, billing_provider = 'stripe',
             stripe_subscription_schedule_id = null, pending_plan_key = $4, pending_billing_interval = $5,
             pending_plan_change_type = 'upgrade', pending_plan_change_at = now(),
             updated_at = now()
         where id = $1`,
        [organization.id, customerId, existingSubscriptionId, planKey, interval],
      );
    } else {
      await releaseStripeSubscriptionSchedule(client, stripeObjectId(existingSubscription.schedule) ?? (typeof organization.stripe_subscription_schedule_id === "string" ? organization.stripe_subscription_schedule_id : null));
      if (existingSubscription.cancel_at_period_end === true) {
        await client.subscriptions.update(existingSubscriptionId, {
          cancel_at_period_end: false,
          metadata: frontDeskWiseStripeMetadata(String(organization.id), currentPlanKey),
        });
      }
      await pool?.query(
        `update organizations
         set stripe_customer_id = $2, stripe_subscription_id = $3, billing_provider = 'stripe',
             stripe_subscription_schedule_id = null, pending_plan_key = null, pending_billing_interval = null,
             pending_plan_change_type = null, pending_plan_change_at = null, updated_at = now()
         where id = $1`,
        [organization.id, customerId, existingSubscriptionId],
      );
    }
    await recordBillingTimeline({
      organizationId: String(organization.id),
      eventKey: `subscription.change_requested:${existingSubscriptionId}:${planKey}`,
      eventName: changeType === "none" ? "subscription_reactivation_requested" : changeType === "downgrade" ? "subscription_downgrade_scheduled" : "subscription_upgrade_requested",
      metadata: { planKey, interval, priceId: price.priceId, changeType, effectiveAt, scheduleId },
    });
    if (changeType === "downgrade") {
      await queueOrganizationLifecycleEvent({
        organizationId: String(organization.id),
        eventType: "SUBSCRIPTION_CHANGE_SCHEDULED",
        eventKey: `subscription.change_scheduled:${existingSubscriptionId}:${planKey}:${effectiveAt}`,
        payload: {
          current_plan_name: billingPlanDisplayName(currentPlanKey),
          plan_name: billingPlanDisplayName(planKey),
          effective_date: effectiveAt,
          status: "Scheduled",
          price_display: price.amountCents === null ? "Contact support" : `$${(price.amountCents / 100).toFixed(0)}/${interval}`,
          businesses_included: planKey === "portfolio" ? "5" : planKey === "multi_business" ? "2" : "1",
        },
      });
    }
    return {
      sessionId: null,
      url: null,
      subscriptionUpdated: true,
      subscriptionId: existingSubscriptionId,
      planKey,
      changeType,
      effectiveAt,
      interval,
      amountCents: price.amountCents,
      currency: price.currency,
    };
  }

  const checkoutMetadata = frontDeskWiseStripeMetadata(String(organization.id), planKey, { appUserId: appUser.id });
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: price.priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: String(organization.id),
    success_url: billingReturnUrl("success"),
    cancel_url: billingReturnUrl("cancel"),
    metadata: checkoutMetadata,
    subscription_data: { metadata: frontDeskWiseStripeMetadata(String(organization.id), planKey) },
  });
  await pool?.query(
    `update organizations
     set stripe_customer_id = $2, billing_provider = 'stripe',
         stripe_checkout_session_id = $3, stripe_checkout_status = 'open', stripe_checkout_created_at = now(),
         pending_plan_key = $4, pending_billing_interval = $5, pending_plan_change_type = 'upgrade',
         pending_plan_change_at = now(), updated_at = now()
     where id = $1`,
    [organization.id, customerId, session.id, planKey, interval],
  );
  await recordBillingTimeline({
    organizationId: String(organization.id),
    eventKey: `checkout.started:${session.id}`,
    eventName: "checkout_started",
    metadata: { planKey, interval, priceId: price.priceId },
  });
  return { sessionId: session.id, url: session.url, planKey, interval, amountCents: price.amountCents, currency: price.currency };
});

app.post("/api/v1/billing/portal-session", async (request) => {
  const client = requireStripe();
  const { appUser } = await authenticatedAppUser(request);
  const body = asRecord(request.body);
  const organization = await organizationForUser(appUser.id, optionalString(body.organizationId, 80));
  if (typeof organization.stripe_customer_id !== "string" || !organization.stripe_customer_id) {
    throw httpError(409, "This organization does not have a Stripe customer yet");
  }
  const session = await client.billingPortal.sessions.create({
    customer: organization.stripe_customer_id,
    return_url: billingReturnUrl("portal"),
  });
  await recordBillingTimeline({ organizationId: String(organization.id), eventKey: `portal.opened:${session.id}`, eventName: "portal_opened", metadata: { customerId: organization.stripe_customer_id } });
  return { url: session.url };
});

app.post("/api/v1/billing/resume", async (request) => {
  const client = requireStripe();
  const { appUser } = await authenticatedAppUser(request);
  const body = asRecord(request.body);
  const organization = await organizationForUser(appUser.id, optionalString(body.organizationId, 80));
  const subscriptionId = typeof organization.stripe_subscription_id === "string" ? organization.stripe_subscription_id : null;
  if (!subscriptionId) throw httpError(409, "This organization does not have an active Stripe subscription");
  const subscription = await client.subscriptions.retrieve(subscriptionId);
  await releaseStripeSubscriptionSchedule(client, stripeObjectId(subscription.schedule) ?? (typeof organization.stripe_subscription_schedule_id === "string" ? organization.stripe_subscription_schedule_id : null));
  if (subscription.cancel_at_period_end === true) {
    await client.subscriptions.update(subscriptionId, {
      cancel_at_period_end: false,
      metadata: frontDeskWiseStripeMetadata(String(organization.id), String(organization.plan_key ?? "starter")),
    });
  }
  await pool?.query(
    `update organizations
     set stripe_subscription_schedule_id = null, pending_plan_key = null, pending_billing_interval = null,
         pending_plan_change_type = null, pending_plan_change_at = null, cancel_at_period_end = false, updated_at = now()
     where id = $1`,
    [organization.id],
  );
  await recordBillingTimeline({
    organizationId: String(organization.id),
    eventKey: `subscription.resume_requested:${subscriptionId}:${Date.now()}`,
    eventName: "subscription_resume_requested",
    metadata: { planKey: organization.plan_key },
  });
  return { ok: true, subscriptionId, planKey: organization.plan_key };
});

app.post("/api/v1/stripe/webhook", { config: { rawBody: true } }, async (request, reply) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return reply.code(503).send({ error: "Stripe webhook signing secret is not configured" });
  const signature = request.headers["stripe-signature"];
  if (typeof signature !== "string") return reply.code(400).send({ error: "Stripe-Signature header is required" });
  const raw = typeof request.rawBody === "string" ? request.rawBody : Buffer.isBuffer(request.rawBody) ? request.rawBody.toString("utf8") : null;
  if (!raw) return reply.code(400).send({ error: "Raw Stripe webhook body is required" });
  let event: Stripe.Event;
  try {
    event = requireStripe().webhooks.constructEvent(raw, signature, secret);
  } catch {
    return reply.code(400).send({ error: "Invalid Stripe webhook signature" });
  }
  await handleStripeEvent(event);
  return { received: true };
});

app.post("/api/v1/webhooks/email/ses", async (request, reply) => {
  if (!pool) return reply.code(503).send({ error: "Email webhooks require PostgreSQL storage" });
  const expectedSecret = process.env.FRONTDESKWISE_EMAIL_WEBHOOK_SECRET?.trim();
  if (!expectedSecret) return reply.code(503).send({ error: "Email webhook secret is not configured" });
  const receivedSecret = request.headers["x-frontdeskwise-email-secret"];
  if (typeof receivedSecret !== "string" || receivedSecret !== expectedSecret) return reply.code(401).send({ error: "Invalid email webhook secret" });
  const body = asRecord(request.body);
  const notificationType = optionalString(body.eventType ?? body.notificationType ?? body.type, 80) ?? "unknown";
  const mail = asRecord(body.mail);
  const providerMessageId = optionalString(body.messageId ?? body.providerMessageId ?? mail.messageId, 320);
  const providerEventId = optionalString(body.eventId ?? body.providerEventId, 320) ?? `${providerMessageId ?? "unknown"}:${notificationType}:${Date.now()}`;
  const normalizedType = notificationType.toLowerCase();
  const delivery = providerMessageId
    ? await pool.query<{ id: string }>("select id from message_deliveries where provider = 'ses' and provider_message_id = $1 limit 1", [providerMessageId])
    : { rows: [] } as { rows: Array<{ id: string }> };
  const inserted = await pool.query(
    `insert into message_provider_events (provider, provider_event_id, delivery_id, event_type, payload)
     values ('ses', $1, $2, $3, $4)
     on conflict (provider, provider_event_id) do nothing`,
    [providerEventId, delivery.rows[0]?.id ?? null, notificationType, JSON.stringify(body)],
  );
  if (inserted.rowCount && delivery.rows[0]?.id) {
    const deliveryId = delivery.rows[0].id;
    if (normalizedType === "delivery") {
      await pool.query("update message_deliveries set status = 'delivered', delivered_at = coalesce(delivered_at, now()), updated_at = now() where id = $1", [deliveryId]);
    } else if (normalizedType === "open") {
      await pool.query("update message_deliveries set opened_at = coalesce(opened_at, now()), updated_at = now() where id = $1", [deliveryId]);
    } else if (normalizedType === "click") {
      await pool.query("update message_deliveries set clicked_at = coalesce(clicked_at, now()), updated_at = now() where id = $1", [deliveryId]);
    } else if (normalizedType === "bounce" || normalizedType === "complaint" || normalizedType.includes("failure")) {
      await pool.query("update message_deliveries set status = 'failed', failed_at = coalesce(failed_at, now()), failure_reason = $2, updated_at = now() where id = $1", [deliveryId, notificationType]);
    }
  }
  return { received: true, duplicate: !inserted.rowCount, providerMessageId };
});

app.post("/api/v1/admin/email/test", async (request) => {
  const admin = await requireSuperAdmin(request);
  if (!sesConfigured()) throw httpError(503, sesConfigurationMessage());
  const body = asRecord(request.body);
  const recipient = optionalString(body.recipient, 320) ?? admin.email;
  await sendTransactionalEmail({
    to: [recipient],
    subject: "FrontDeskWise SES test",
    text: `This is a FrontDeskWise SES delivery test. Sent by ${admin.email} at ${new Date().toISOString()}.`,
    replyTo: process.env.FRONTDESKWISE_SES_REPLY_TO,
  });
  return { ok: true, recipient };
});

app.get("/api/v1/admin/messaging/summary", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select count(*) filter (where created_at >= now() - interval '24 hours')::integer as queued,
            count(*) filter (where status in ('sent', 'delivered') and sent_at >= now() - interval '24 hours')::integer as sent,
            count(*) filter (where status = 'deferred' and created_at >= now() - interval '24 hours')::integer as deferred,
            count(*) filter (where status = 'failed' and created_at >= now() - interval '24 hours')::integer as failed
     from message_deliveries`,
  );
  const row = result.rows[0] ?? {};
  const templates = await pool.query<{ active: string; total: string }>(
    `select count(*) filter (where status = 'active')::text as active, count(*)::text as total from message_templates`,
  );
  return {
    last24Hours: {
      queued: Number(row.queued ?? 0),
      sent: Number(row.sent ?? 0),
      deferred: Number(row.deferred ?? 0),
      failed: Number(row.failed ?? 0),
    },
    templates: { active: Number(templates.rows[0]?.active ?? 0), total: Number(templates.rows[0]?.total ?? 0) },
    provider: { name: "ses", configured: sesConfigured() },
  };
});

app.get("/api/v1/admin/messaging/templates", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    "select * from message_templates order by name",
  );
  return { templates: result.rows.map(lifecycleTemplatePayload) };
});

app.patch("/api/v1/admin/messaging/templates/:templateKey", async (request) => {
  const admin = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const templateKey = requiredString((request.params as { templateKey?: string }).templateKey, "templateKey", 120);
  const body = asRecord(request.body);
  const current = await pool.query<Record<string, unknown>>("select * from message_templates where template_key = $1", [templateKey]);
  if (!current.rowCount) throw httpError(404, "Message template not found");
  const currentRow = current.rows[0];
  const status = body.status === "draft" || body.status === "active" || body.status === "disabled" ? body.status : String(currentRow.status);
  const mandatoryAutomation = await pool.query("select 1 from message_automations where template_key = $1 and mandatory = true limit 1", [templateKey]);
  if (mandatoryAutomation.rowCount && status !== "active") throw httpError(400, "Mandatory account and billing templates must remain active");
  const category = body.category === "transactional" || body.category === "operational" || body.category === "account" ? body.category : String(currentRow.category);
  const textField = (key: string, fallback: string, max: number): string => typeof body[key] === "string" ? String(body[key]).trim().slice(0, max) : fallback;
  const variables = Array.isArray(body.variables)
    ? body.variables.filter((item): item is string => typeof item === "string" && /^[a-zA-Z0-9_.-]+$/.test(item)).slice(0, 80)
    : (Array.isArray(currentRow.variables) ? currentRow.variables : []);
  const updated = await pool.query<Record<string, unknown>>(
    `update message_templates
     set name = $2, description = $3, category = $4, subject = $5, preview_text = $6,
         heading = $7, body = $8, cta_label = $9, cta_url = $10, footer = $11,
         variables = $12, status = $13, version = version + 1, updated_by_user_id = $14, updated_at = now()
     where template_key = $1
     returning *`,
    [
      templateKey,
      textField("name", String(currentRow.name), 160),
      textField("description", String(currentRow.description ?? ""), 500),
      category,
      textField("subject", String(currentRow.subject), 240),
      textField("previewText", String(currentRow.preview_text ?? ""), 240),
      textField("heading", String(currentRow.heading), 240),
      textField("body", String(currentRow.body), 20_000),
      body.ctaLabel === null ? null : textField("ctaLabel", typeof currentRow.cta_label === "string" ? currentRow.cta_label : "", 120) || null,
      body.ctaUrl === null ? null : textField("ctaUrl", typeof currentRow.cta_url === "string" ? currentRow.cta_url : "", 1_000) || null,
      textField("footer", String(currentRow.footer ?? ""), 1_000),
      JSON.stringify(variables),
      status,
      admin.id,
    ],
  );
  return { template: lifecycleTemplatePayload(updated.rows[0]) };
});

app.post("/api/v1/admin/messaging/templates/:templateKey/test", async (request) => {
  const admin = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  if (!sesConfigured()) throw httpError(503, sesConfigurationMessage());
  const templateKey = requiredString((request.params as { templateKey?: string }).templateKey, "templateKey", 120);
  const result = await pool.query<Record<string, unknown>>("select * from message_templates where template_key = $1", [templateKey]);
  if (!result.rowCount) throw httpError(404, "Message template not found");
  const body = asRecord(request.body);
  const template = lifecycleTemplatePayload(result.rows[0]);
  const supplied = asRecord(body.variables);
  const variables: Record<string, unknown> = {};
  for (const variable of template.variables) variables[variable] = typeof supplied[variable] === "string" ? supplied[variable] : variable === "first_name" ? admin.name.split(/\s+/)[0] : variable === "dashboard_url" ? lifecycleAppUrl("/app") : `Sample ${variable.replace(/[_-]/g, " ")}`;
  const rendered = renderLifecycleEmail(template, variables);
  const recipient = optionalString(body.recipient, 320) ?? admin.email;
  const sendResult = await sendTransactionalEmail({ to: [recipient], ...rendered, replyTo: process.env.FRONTDESKWISE_SES_REPLY_TO });
  return { ok: true, recipient, provider: sendResult.provider, providerMessageId: sendResult.providerMessageId };
});

app.get("/api/v1/admin/messaging/automations", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select a.*, t.name as template_name
     from message_automations a join message_templates t on t.template_key = a.template_key
     order by a.created_at`,
  );
  return { automations: result.rows.map((row) => ({
    id: String(row.id), automationKey: String(row.automation_key), templateKey: String(row.template_key), templateName: String(row.template_name),
    eventType: String(row.event_type), delaySeconds: Number(row.delay_seconds ?? 0), recipientScope: String(row.recipient_scope),
    conditions: asRecord(row.conditions), mandatory: Boolean(row.mandatory), enabled: Boolean(row.enabled), updatedAt: nullableIso(row.updated_at),
  })) };
});

app.patch("/api/v1/admin/messaging/automations/:automationKey", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const automationKey = requiredString((request.params as { automationKey?: string }).automationKey, "automationKey", 120);
  const body = asRecord(request.body);
  const delaySeconds = body.delaySeconds === undefined ? null : Number(body.delaySeconds);
  if (delaySeconds !== null && (!Number.isInteger(delaySeconds) || delaySeconds < 0 || delaySeconds > 2_592_000)) throw httpError(400, "delaySeconds must be a whole number from 0 to 2592000");
  const current = await pool.query<{ mandatory: boolean }>("select mandatory from message_automations where automation_key = $1", [automationKey]);
  if (!current.rowCount) throw httpError(404, "Message automation not found");
  if (current.rows[0].mandatory && body.enabled === false) throw httpError(400, "Mandatory account and billing automations cannot be disabled");
  const updated = await pool.query<Record<string, unknown>>(
    `update message_automations
     set enabled = coalesce($2, enabled), delay_seconds = coalesce($3, delay_seconds),
         conditions = coalesce($4, conditions), updated_at = now()
     where automation_key = $1
     returning *`,
    [automationKey, typeof body.enabled === "boolean" ? body.enabled : null, delaySeconds, body.conditions && typeof body.conditions === "object" ? JSON.stringify(body.conditions) : null],
  );
  return { automation: updated.rows[0] };
});

app.get("/api/v1/admin/messaging/deliveries", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const status = typeof query.status === "string" && ["queued", "running", "sent", "delivered", "deferred", "failed", "canceled"].includes(query.status) ? query.status : null;
  const requestedLimit = Number(query.limit ?? 100);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
  const result = await pool.query<Record<string, unknown>>(
    `select d.*, t.name as template_name, b.name as business_name
     from message_deliveries d
     join message_templates t on t.template_key = d.template_key
     left join businesses b on b.id = d.business_id
     where ($1::text is null or d.status = $1)
     order by d.created_at desc limit $2`,
    [status, limit],
  );
  return { deliveries: result.rows.map((row) => ({
    id: String(row.id), templateKey: String(row.template_key), templateName: String(row.template_name), eventType: String(row.event_type),
    businessName: row.business_name ? String(row.business_name) : null, recipientEmail: String(row.recipient_email), status: String(row.status),
    conversationId: typeof asRecord(row.payload).conversation_id === "string" ? String(asRecord(row.payload).conversation_id) : null,
    attempts: Number(row.attempts ?? 0), scheduledAt: nullableIso(row.scheduled_at), sentAt: nullableIso(row.sent_at), deliveredAt: nullableIso(row.delivered_at),
    failedAt: nullableIso(row.failed_at), failureReason: typeof row.failure_reason === "string" ? row.failure_reason : null, providerMessageId: row.provider_message_id ? String(row.provider_message_id) : null,
  })) };
});

app.post("/api/v1/admin/messaging/deliveries/:deliveryId/retry", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Messaging administration requires PostgreSQL storage");
  const deliveryId = requiredString((request.params as { deliveryId?: string }).deliveryId, "deliveryId", 80);
  try {
    await retryLifecycleDelivery(pool, deliveryId);
  } catch (error) {
    throw httpError(404, error instanceof Error ? error.message : "Delivery is not retryable");
  }
  return { ok: true, deliveryId };
});

app.get("/api/v1/messaging/preferences", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Notification preferences require PostgreSQL storage");
  const businessId = optionalString((request.query as Record<string, unknown> | undefined)?.businessId, 80);
  if (businessId) {
    const business = await pool.query<{ organization_id: string }>("select organization_id from businesses where id = $1", [businessId]);
    if (!business.rowCount) throw httpError(404, "Business not found");
    await organizationBusinessForUser(appUser.id, business.rows[0].organization_id, businessId);
  }
  const result = await pool.query<{ preference_key: string; enabled: boolean }>(
    `select preference_key, enabled from message_preferences
     where user_id = $1 and ($2::uuid is null or business_id = $2::uuid)`,
    [appUser.id, businessId],
  );
  const values = { newLead: true, humanHandoff: true, integrationFailure: true };
  for (const row of result.rows) {
    if (row.preference_key === "new_lead") values.newLead = row.enabled;
    if (row.preference_key === "human_handoff") values.humanHandoff = row.enabled;
    if (row.preference_key === "integration_failure") values.integrationFailure = row.enabled;
  }
  return { preferences: values, mandatory: ["billing", "security"] };
});

app.patch("/api/v1/messaging/preferences", async (request) => {
  const { appUser } = await authenticatedAppUser(request);
  if (!pool) throw httpError(503, "Notification preferences require PostgreSQL storage");
  const body = asRecord(request.body);
  const businessId = requiredString(body.businessId, "businessId", 80);
  const business = await pool.query<{ organization_id: string }>("select organization_id from businesses where id = $1", [businessId]);
  if (!business.rowCount) throw httpError(404, "Business not found");
  await organizationBusinessForUser(appUser.id, business.rows[0].organization_id, businessId);
  const values: Array<[string, unknown]> = [["new_lead", body.newLead], ["human_handoff", body.humanHandoff], ["integration_failure", body.integrationFailure]];
  for (const [key, value] of values) {
    if (typeof value !== "boolean") continue;
    await pool.query(
      `insert into message_preferences (user_id, organization_id, business_id, preference_key, enabled)
       values ($1, $2, $3, $4, $5)
       on conflict (user_id, organization_id, business_id, preference_key)
       do update set enabled = excluded.enabled, updated_at = now()`,
      [appUser.id, business.rows[0].organization_id, businessId, key, value],
    );
  }
  return { ok: true, preferences: { newLead: body.newLead !== false, humanHandoff: body.humanHandoff !== false, integrationFailure: body.integrationFailure !== false } };
});

app.get("/api/v1/demo/:slug/notification-settings", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireBusinessTeamAccess(business, request, "admin");
  return { settings: await loadHandoffNotificationSettings(business) };
});

app.patch("/api/v1/demo/:slug/notification-settings", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireBusinessTeamAccess(business, request, "admin");
  if (!pool) throw httpError(503, "Handoff notification settings require PostgreSQL storage");
  const body = asRecord(request.body);
  const defaultRecipientEmail = body.defaultRecipientEmail === null || body.defaultRecipientEmail === ""
    ? null
    : normalizedNotificationEmail(body.defaultRecipientEmail);
  if (body.defaultRecipientEmail !== undefined && body.defaultRecipientEmail !== null && body.defaultRecipientEmail !== "" && !defaultRecipientEmail) {
    throw httpError(400, "Enter a valid default recipient email");
  }
  const rawDelay = body.handoffDelaySeconds === undefined ? 0 : Number(body.handoffDelaySeconds);
  if (![0, 120, 300].includes(rawDelay)) throw httpError(400, "handoffDelaySeconds must be 0, 120, or 300");
  const rawRepeatAfter = body.repeatAfterSeconds === undefined ? 600 : Number(body.repeatAfterSeconds);
  if (!Number.isInteger(rawRepeatAfter) || rawRepeatAfter < 60 || rawRepeatAfter > 86_400) throw httpError(400, "repeatAfterSeconds must be between 60 and 86400");
  const settings = {
    enabled: body.enabled !== false,
    defaultRecipientEmail,
    additionalRecipientEmails: normalizedNotificationEmails(body.additionalRecipientEmails),
    handoffDelaySeconds: rawDelay as 0 | 120 | 300,
    repeatEnabled: body.repeatEnabled === true,
    repeatAfterSeconds: rawRepeatAfter,
    notifyExplicitHumanRequest: body.notifyExplicitHumanRequest !== false,
    notifyKnowledgeGap: body.notifyKnowledgeGap === true,
    notifyHighValueLead: body.notifyHighValueLead !== false,
    notifyEveryLead: body.notifyEveryLead === true,
  } satisfies HandoffNotificationSettings;
  await pool.query(
    `insert into business_notification_settings
       (business_id, handoff_enabled, default_recipient_email, additional_recipient_emails,
        handoff_delay_seconds, repeat_enabled, repeat_after_seconds,
        notify_explicit_human_request, notify_knowledge_gap, notify_high_value_lead, notify_every_lead, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (business_id) do update set
       handoff_enabled = excluded.handoff_enabled,
       default_recipient_email = excluded.default_recipient_email,
       additional_recipient_emails = excluded.additional_recipient_emails,
       handoff_delay_seconds = excluded.handoff_delay_seconds,
       repeat_enabled = excluded.repeat_enabled,
       repeat_after_seconds = excluded.repeat_after_seconds,
       notify_explicit_human_request = excluded.notify_explicit_human_request,
       notify_knowledge_gap = excluded.notify_knowledge_gap,
       notify_high_value_lead = excluded.notify_high_value_lead,
       notify_every_lead = excluded.notify_every_lead,
       updated_at = now()`,
    [business.id, settings.enabled, settings.defaultRecipientEmail, JSON.stringify(settings.additionalRecipientEmails), settings.handoffDelaySeconds, settings.repeatEnabled, settings.repeatAfterSeconds, settings.notifyExplicitHumanRequest, settings.notifyKnowledgeGap, settings.notifyHighValueLead, settings.notifyEveryLead],
  );
  return { ok: true, settings };
});

app.get("/api/v1/admin/organizations", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select o.id, o.name, o.slug, o.billing_mode, o.billing_status, o.plan_key,
            o.trial_end_at, o.current_period_end_at, o.billing_amount_cents, o.billing_currency,
            o.stripe_customer_id, o.stripe_subscription_id, o.stripe_subscription_status,
            o.last_payment_status, o.cancel_at_period_end,
            bp.display_name as plan_display_name, bp.monthly_amount_cents as plan_amount_cents,
            coalesce(opo.amount_cents, o.billing_amount_cents, bp.monthly_amount_cents) as mrr_amount_cents,
            (select string_agg(u.email, ', ' order by u.email)
             from organization_members om2 join app_users u on u.id = om2.user_id
             where om2.organization_id = o.id and om2.role = 'owner') as owner_email,
            (select count(*) from businesses b where b.organization_id = o.id)::integer as business_count,
            (select count(*) from conversations c join businesses b on b.id = c.business_id where b.organization_id = o.id)::integer as conversation_count,
            (select count(*) from leads l join businesses b on b.id = l.business_id where b.organization_id = o.id)::integer as lead_count,
            (select max(b.updated_at) from businesses b where b.organization_id = o.id) as last_active_at
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     order by o.created_at desc`,
  );
  return {
    organizations: result.rows.map((row) => ({
      id: String(row.id), name: String(row.name), slug: String(row.slug),
      ownerEmail: row.owner_email ?? null, businessCount: Number(row.business_count ?? 0),
      planKey: String(row.plan_key), planName: String(row.plan_display_name ?? row.plan_key),
      status: String(row.billing_status), mode: String(row.billing_mode),
      mrrAmountCents: row.mrr_amount_cents === null ? null : Number(row.mrr_amount_cents),
      currency: String(row.billing_currency ?? "usd"),
      stripeCustomerId: typeof row.stripe_customer_id === "string" ? row.stripe_customer_id : null,
      stripeSubscriptionId: typeof row.stripe_subscription_id === "string" ? row.stripe_subscription_id : null,
      stripeSubscriptionStatus: typeof row.stripe_subscription_status === "string" ? row.stripe_subscription_status : null,
      lastPaymentStatus: typeof row.last_payment_status === "string" ? row.last_payment_status : null,
      cancelAtPeriodEnd: row.cancel_at_period_end === true,
      trialEndAt: nullableIso(row.trial_end_at), currentPeriodEndAt: nullableIso(row.current_period_end_at),
      conversationCount: Number(row.conversation_count ?? 0), leadCount: Number(row.lead_count ?? 0),
      lastActiveAt: nullableIso(row.last_active_at),
    })),
  };
});

app.get("/api/v1/admin/installation-support", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Installation support administration requires PostgreSQL storage");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const requestedStatus = typeof query.status === "string" ? query.status : null;
  const status = requestedStatus && ["new", "in_progress", "resolved"].includes(requestedStatus) ? requestedStatus : null;
  const requestedLimit = Number(query.limit ?? 100);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 100));
  const result = await pool.query<Record<string, unknown>>(
    `select r.*, b.name as business_name, b.website_url, b.ownership_status,
            o.name as organization_name, u.name as assigned_user_name, u.email as assigned_user_email
     from installation_support_requests r
     join businesses b on b.id = r.business_id
     left join organizations o on o.id = r.organization_id
     left join app_users u on u.id = r.assigned_user_id
     where ($1::text is null or r.status = $1)
     order by case when r.status = 'new' then 0 when r.status = 'in_progress' then 1 else 2 end, r.created_at desc
     limit $2`,
    [status, limit],
  );
  const summary = await pool.query<{ new_count: string; in_progress_count: string; resolved_count: string }>(
    `select count(*) filter (where status = 'new')::text as new_count,
            count(*) filter (where status = 'in_progress')::text as in_progress_count,
            count(*) filter (where status = 'resolved')::text as resolved_count
     from installation_support_requests`,
  );
  const assignees = await pool.query<{ id: string; name: string; email: string }>(
    `select u.id, u.name, u.email
     from app_users u
     where u.status = 'active'
       and (exists (select 1 from super_admin_users sa where sa.user_id = u.id and sa.status = 'active')
         or exists (select 1 from organization_members om where om.user_id = u.id and om.role in ('owner', 'admin'))
         or exists (select 1 from business_members bm where bm.user_id = u.id and bm.role in ('admin', 'staff')))
     order by u.name, u.email`,
  );
  return {
    requests: result.rows.map(installationSupportRequestPayload),
    summary: {
      new: Number(summary.rows[0]?.new_count ?? 0),
      inProgress: Number(summary.rows[0]?.in_progress_count ?? 0),
      resolved: Number(summary.rows[0]?.resolved_count ?? 0),
    },
    assignees: assignees.rows,
  };
});

app.patch("/api/v1/admin/installation-support/:requestId", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Installation support administration requires PostgreSQL storage");
  const params = request.params as { requestId?: string };
  const requestId = requiredString(params.requestId, "requestId", 80);
  const body = asRecord(request.body);
  const status = body.status === "new" || body.status === "in_progress" || body.status === "resolved" ? body.status : null;
  const assignedUserId = body.assignedUserId === null || body.assignedUserId === "" ? null : optionalString(body.assignedUserId, 80);
  if (!status && body.assignedUserId === undefined) throw httpError(400, "Provide a valid status or assignedUserId");
  if (assignedUserId) {
    const assignee = await pool.query("select 1 from app_users where id = $1 and status = 'active'", [assignedUserId]);
    if (!assignee.rowCount) throw httpError(400, "That assignee is not an active application user");
  }
  const result = await pool.query<Record<string, unknown>>(
    `update installation_support_requests
     set status = coalesce($2, status),
         assigned_user_id = case when $3::boolean then $4 else assigned_user_id end,
         resolved_at = case when coalesce($2, status) = 'resolved' then coalesce(resolved_at, now()) else null end,
         updated_at = now()
     where id = $1
     returning *`,
    [requestId, status, body.assignedUserId !== undefined, assignedUserId],
  );
  if (!result.rowCount) throw httpError(404, "Installation support request not found");
  const enriched = await pool.query<Record<string, unknown>>(
    `select r.*, b.name as business_name, b.website_url, o.name as organization_name,
            u.name as assigned_user_name, u.email as assigned_user_email
     from installation_support_requests r
     join businesses b on b.id = r.business_id
     left join organizations o on o.id = r.organization_id
     left join app_users u on u.id = r.assigned_user_id
     where r.id = $1`,
    [requestId],
  );
  return { request: installationSupportRequestPayload(enriched.rows[0]) };
});

app.get("/api/v1/admin/support-cases", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Support administration requires PostgreSQL storage");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const requestedStatus = typeof query.status === "string" ? query.status : null;
  const status = requestedStatus && ["open", "in_progress", "resolved"].includes(requestedStatus) ? requestedStatus : null;
  const requestedLimit = Number(query.limit ?? 200);
  const limit = Math.min(500, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200));
  const result = await pool.query<Record<string, unknown>>(
    `select c.*, b.name as business_name, b.website_url, o.name as organization_name,
            u.name as assigned_user_name, u.email as assigned_user_email
     from support_cases c
     join businesses b on b.id = c.business_id
     left join organizations o on o.id = c.organization_id
     left join app_users u on u.id = c.assigned_user_id
     where ($1::text is null or c.status = $1)
     order by case when c.status = 'open' then 0 when c.status = 'in_progress' then 1 else 2 end, c.created_at desc
     limit $2`,
    [status, limit],
  );
  const eventsByCase = await loadSupportCaseEvents(result.rows.map((row) => String(row.id)));
  const summary = await pool.query<{ open_count: string; in_progress_count: string; resolved_count: string }>(
    `select count(*) filter (where status = 'open')::text as open_count,
            count(*) filter (where status = 'in_progress')::text as in_progress_count,
            count(*) filter (where status = 'resolved')::text as resolved_count
     from support_cases`,
  );
  const assignees = await pool.query<{ id: string; name: string; email: string }>(
    `select u.id, u.name, u.email
     from app_users u
     where u.status = 'active'
       and (exists (select 1 from super_admin_users sa where sa.user_id = u.id and sa.status = 'active')
         or exists (select 1 from organization_members om where om.user_id = u.id and om.role in ('owner', 'admin')))
     order by u.name, u.email`,
  );
  return {
    cases: result.rows.map((row) => supportCasePayload(row, eventsByCase.get(String(row.id)) ?? [])),
    summary: {
      open: Number(summary.rows[0]?.open_count ?? 0),
      inProgress: Number(summary.rows[0]?.in_progress_count ?? 0),
      resolved: Number(summary.rows[0]?.resolved_count ?? 0),
    },
    assignees: assignees.rows,
  };
});

app.patch("/api/v1/admin/support-cases/:caseId", async (request) => {
  const actor = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Support administration requires PostgreSQL storage");
  const params = request.params as { caseId?: string };
  const caseId = requiredString(params.caseId, "caseId", 80);
  const body = asRecord(request.body);
  const status = body.status === "open" || body.status === "in_progress" || body.status === "resolved" ? body.status as SupportCaseStatus : null;
  const assignedUserId = body.assignedUserId === null || body.assignedUserId === "" ? null : optionalString(body.assignedUserId, 80);
  const note = optionalString(body.note, 4_000);
  if (!status && body.assignedUserId === undefined && !note) throw httpError(400, "Provide a valid status, assignee, or note");
  if (assignedUserId) {
    const assignee = await pool.query("select 1 from app_users where id = $1 and status = 'active'", [assignedUserId]);
    if (!assignee.rowCount) throw httpError(400, "That assignee is not an active application user");
  }
  const previous = await pool.query<{ status: SupportCaseStatus; assigned_user_id: string | null }>(
    "select status, assigned_user_id from support_cases where id = $1",
    [caseId],
  );
  if (!previous.rowCount) throw httpError(404, "Support case not found");
  const current = previous.rows[0];
  const result = await pool.query<Record<string, unknown>>(
    `update support_cases
     set status = coalesce($2, status),
         assigned_user_id = case when $3::boolean then $4 else assigned_user_id end,
         resolved_at = case when coalesce($2, status) = 'resolved' then coalesce(resolved_at, now()) else null end,
         updated_at = now()
     where id = $1
     returning *`,
    [caseId, status, body.assignedUserId !== undefined, assignedUserId],
  );
  const changedStatus = status && status !== current.status;
  const changedAssignment = body.assignedUserId !== undefined && assignedUserId !== current.assigned_user_id;
  if (changedStatus) {
    await pool.query(
      `insert into support_case_events (case_id, event_type, actor_user_id, body, metadata)
       values ($1, 'status_changed', $2, $3, $4)`,
      [caseId, actor.id, `Status changed to ${status}`, JSON.stringify({ from: current.status, to: status })],
    );
  }
  if (changedAssignment) {
    await pool.query(
      `insert into support_case_events (case_id, event_type, actor_user_id, body, metadata)
       values ($1, 'assignment_changed', $2, $3, $4)`,
      [caseId, actor.id, assignedUserId ? "Support case assigned" : "Support case unassigned", JSON.stringify({ assignedUserId })],
    );
  }
  if (note) {
    await pool.query(
      `insert into support_case_events (case_id, event_type, actor_user_id, body)
       values ($1, 'note', $2, $3)`,
      [caseId, actor.id, note],
    );
  }
  const enriched = await pool.query<Record<string, unknown>>(
    `select c.*, b.name as business_name, b.website_url, o.name as organization_name,
            u.name as assigned_user_name, u.email as assigned_user_email
     from support_cases c
     join businesses b on b.id = c.business_id
     left join organizations o on o.id = c.organization_id
     left join app_users u on u.id = c.assigned_user_id
     where c.id = $1`,
    [caseId],
  );
  const events = await loadSupportCaseEvents([caseId]);
  return { case: supportCasePayload(enriched.rows[0], events.get(caseId) ?? []) };
});

app.post("/api/v1/admin/support-cases/:caseId/view", async (request, reply) => {
  const admin = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Support viewing requires PostgreSQL storage");
  const params = request.params as { caseId?: string };
  const caseId = requiredString(params.caseId, "caseId", 80);
  const result = await pool.query<{ business_id: string; business_slug: string; business_name: string }>(
    `select c.business_id, b.slug as business_slug, b.name as business_name
     from support_cases c
     join businesses b on b.id = c.business_id
     where c.id = $1`,
    [caseId],
  );
  if (!result.rowCount) throw httpError(404, "Support case not found");
  const row = result.rows[0];
  const business = await getBusiness(row.business_slug);
  const expiresAt = new Date(Date.now() + 30 * 60 * 1_000).toISOString();
  const access = await createDemoAccess(business, {
    createdByUserId: admin.id,
    accessType: "admin",
    accessLabel: `Support view · case ${caseId}`,
    email: admin.email,
    name: `${business.name} support view`,
    expiresAt,
  });
  await pool.query(
    `insert into support_case_events (case_id, event_type, actor_user_id, body, metadata)
     values ($1, 'note', $2, $3, $4)`,
    [caseId, admin.id, "Support view opened", JSON.stringify({ accessType: "support_view", sessionId: access.sessionId, expiresAt })],
  );
  const { sessionId, ...publicAccess } = access;
  return reply.send({
    ...publicAccess,
    sessionId,
    businessId: row.business_id,
    businessSlug: row.business_slug,
    viewUrl: `${demoAccessLink(access.accessToken)}&support_view=1&support_case=${encodeURIComponent(caseId)}`,
  });
});

app.get("/api/v1/admin/users", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const requestedLimit = Number((request.query as Record<string, unknown> | undefined)?.limit ?? 200);
  const limit = Math.min(200, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 200));
  const result = await pool.query<Record<string, unknown>>(
    `select u.id, u.email, u.name, u.status, u.created_at, u.updated_at,
            (select string_agg(o.name || ' · ' || om.role, ', ' order by o.name)
             from organization_members om join organizations o on o.id = om.organization_id
             where om.user_id = u.id) as organization_summary,
            (select count(*) from organization_members om where om.user_id = u.id)::integer as organization_count,
            exists (select 1 from super_admin_users sa where sa.user_id = u.id and sa.status = 'active') as is_super_admin
     from app_users u
     order by u.created_at desc
     limit $1`,
    [limit],
  );
  return {
    users: result.rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: String(row.name ?? ""),
      status: String(row.status),
      createdAt: nullableIso(row.created_at),
      updatedAt: nullableIso(row.updated_at),
      organizationSummary: row.organization_summary ? String(row.organization_summary) : "No organization",
      organizationCount: Number(row.organization_count ?? 0),
      isSuperAdmin: Boolean(row.is_super_admin),
    })),
  };
});

app.post("/api/v1/admin/users/:userId/status", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { userId?: string };
  const userId = requiredString(params.userId, "userId", 80);
  const body = asRecord(request.body);
  const status = body.status === "disabled" ? "disabled" : body.status === "active" ? "active" : null;
  if (!status) throw httpError(400, "status must be active or disabled");
  if (userId === admin.id) throw httpError(400, "You cannot disable the current super-admin account");
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<{ id: string }>(
    "update app_users set status = $2, updated_at = now() where id = $1 returning id",
    [userId, status],
  );
  if (!result.rowCount) throw httpError(404, "User not found");
  if (status === "disabled") {
    await pool.query("update super_admin_users set status = 'disabled', updated_at = now() where user_id = $1", [userId]);
  }
  return { ok: true, userId, status };
});

app.get("/api/v1/admin/organizations/:organizationId", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { organizationId?: string };
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const organizationId = requiredString(params.organizationId, "organizationId", 80);
  const result = await pool.query<Record<string, unknown>>(
    `select o.*, bp.display_name as plan_display_name, bp.description as plan_description,
            bp.max_businesses, coalesce(opo.amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
            coalesce(opo.max_businesses, bp.max_businesses) as effective_max_businesses,
            opo.billing_interval as override_interval, opo.reason as override_reason
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     where o.id = $1`,
    [organizationId],
  );
  if (!result.rowCount) throw httpError(404, "Organization not found");
  const businessesResult = await pool.query<Record<string, unknown>>(
    `select b.id, b.name, b.slug, b.website_url, b.ownership_status, b.billing_status, b.plan_key, b.updated_at,
            (select count(*) from business_sources bs where bs.business_id = b.id)::integer as source_count,
            (select count(*) from conversations c where c.business_id = b.id)::integer as conversation_count,
            (select count(*) from leads l where l.business_id = b.id)::integer as lead_count
     from businesses b where b.organization_id = $1 order by b.created_at`,
    [organizationId],
  );
  const owners = await pool.query<{ email: string; name: string; role: string }>(
    `select u.email, u.name, om.role from organization_members om join app_users u on u.id = om.user_id where om.organization_id = $1 order by om.role, u.email`,
    [organizationId],
  );
  const timeline = await pool.query<Record<string, unknown>>(
    `select event_key, event_name, provider_event_id, status, metadata, occurred_at
     from billing_timeline_events where organization_id = $1 order by occurred_at desc limit 100`,
    [organizationId],
  );
  return {
    organization: { id: organizationId, name: String(result.rows[0].name), slug: String(result.rows[0].slug), billing: organizationBillingPayload(result.rows[0]) },
    owners: owners.rows,
    billingTimeline: timeline.rows.map((event) => ({
      eventKey: String(event.event_key), eventName: String(event.event_name), providerEventId: event.provider_event_id ? String(event.provider_event_id) : null,
      status: String(event.status), metadata: asRecord(event.metadata), occurredAt: nullableIso(event.occurred_at),
    })),
    businesses: businessesResult.rows.map((business) => ({
      id: String(business.id), name: String(business.name), slug: String(business.slug), websiteUrl: String(business.website_url),
      ownershipStatus: String(business.ownership_status ?? "pending"), billingStatus: String(business.billing_status ?? "trial"),
      planKey: String(business.plan_key ?? "starter"), sourceCount: Number(business.source_count ?? 0),
      conversationCount: Number(business.conversation_count ?? 0), leadCount: Number(business.lead_count ?? 0), updatedAt: nullableIso(business.updated_at),
    })),
  };
});

app.get("/api/v1/admin/businesses/:businessId", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { businessId?: string };
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const businessId = requiredString(params.businessId, "businessId", 80);
  const businessResult = await pool.query<Record<string, unknown>>(
    `select b.id, b.name, b.slug, b.website_url, b.location, b.ownership_status, b.billing_status, b.plan_key, b.updated_at,
            (select count(*) from business_sources bs where bs.business_id = b.id)::integer as source_count,
            (select count(*) from knowledge_chunks kc where kc.business_id = b.id)::integer as chunk_count,
            (select count(*) from conversations c where c.business_id = b.id)::integer as conversation_count,
            (select count(*) from leads l where l.business_id = b.id)::integer as lead_count,
            o.id as organization_id, o.name as organization_name, o.slug as organization_slug
     from businesses b
     join organizations o on o.id = b.organization_id
     where b.id = $1`,
    [businessId],
  );
  if (!businessResult.rowCount) throw httpError(404, "Business not found");

  const business = businessResult.rows[0];
  const organizationResult = await pool.query<Record<string, unknown>>(
    `select o.*, bp.display_name as plan_display_name, bp.description as plan_description,
            bp.max_businesses, coalesce(opo.amount_cents, bp.monthly_amount_cents) as effective_amount_cents,
            coalesce(opo.max_businesses, bp.max_businesses) as effective_max_businesses,
            opo.billing_interval as override_interval, opo.reason as override_reason
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     where o.id = $1`,
    [business.organization_id],
  );
  const owners = await pool.query<{ email: string; name: string; role: string }>(
    `select u.email, u.name, om.role
     from organization_members om
     join app_users u on u.id = om.user_id
     where om.organization_id = $1
     order by om.role, u.email`,
    [business.organization_id],
  );
  if (!organizationResult.rowCount) throw httpError(404, "Organization not found");

  return {
    organization: {
      id: String(business.organization_id),
      name: String(business.organization_name),
      slug: String(business.organization_slug),
      billing: organizationBillingPayload(organizationResult.rows[0]),
    },
    business: {
      id: String(business.id),
      name: String(business.name),
      slug: String(business.slug),
      websiteUrl: String(business.website_url),
      location: String(business.location ?? ""),
      ownershipStatus: String(business.ownership_status ?? "pending"),
      billingStatus: String(business.billing_status ?? "trial"),
      planKey: String(business.plan_key ?? "starter"),
      sourceCount: Number(business.source_count ?? 0),
      chunkCount: Number(business.chunk_count ?? 0),
      conversationCount: Number(business.conversation_count ?? 0),
      leadCount: Number(business.lead_count ?? 0),
      updatedAt: nullableIso(business.updated_at),
    },
    owners: owners.rows,
  };
});

app.get("/api/v1/admin/action-registry", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const businessId = optionalString(query.businessId, 80) ?? null;
  if (businessId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(businessId)) {
    throw httpError(400, "businessId must be a UUID");
  }
  const result = await pool.query<Record<string, unknown>>(
    `select a.*, b.name as business_name, b.slug as business_slug, b.website_url,
            b.primary_action_id
     from business_actions a
     join businesses b on b.id = a.business_id
     where ($1::uuid is null or b.id = $1::uuid)
     order by b.name, a.priority desc, a.confidence desc nulls last, a.updated_at desc
     limit 500`,
    [businessId],
  );
  const actions = await Promise.all(result.rows.map(async (row) => {
      const parsedAction = actionFromRow(row);
      const readiness = await actionReadinessForBusiness({ id: String(row.business_id) }, parsedAction);
      return {
      id: String(row.id),
      businessId: String(row.business_id),
      businessName: String(row.business_name),
      businessSlug: String(row.business_slug),
      websiteUrl: String(row.website_url ?? ""),
      actionKey: String(row.action_key),
      actionType: String(row.action_type ?? "contact_team"),
      name: parsedAction.name,
      description: String(row.description ?? ""),
      mode: String(row.mode ?? "transactional"),
      destination: row.destination && typeof row.destination === "object" ? asRecord(row.destination) : null,
      provider: parsedAction.provider,
      priority: Number(row.priority ?? 0),
      requiredFields: Array.isArray(row.required_fields) ? row.required_fields : [],
      conditions: Array.isArray(row.conditions) ? row.conditions : [],
      steps: parsedAction.steps ?? [],
      workflowVersion: parsedAction.version ?? 1,
      safetyPolicy: String(row.safety_policy ?? "standard"),
      sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
      sourceType: typeof row.source_type === "string" ? row.source_type : null,
      sourceLabel: typeof row.source_label === "string" ? row.source_label : null,
      classificationReason: typeof row.classification_reason === "string" ? row.classification_reason : null,
      discoveredAt: row.discovered_at ? toIso(row.discovered_at) : null,
      origin: row.origin === "discovered" ? "discovered" : "configured",
      lifecycleStatus: ["discovered", "needs_review", "approved", "active", "disabled"].includes(String(row.lifecycle_status)) ? String(row.lifecycle_status) : (row.enabled === true ? "active" : "disabled"),
      reviewReason: ["low_confidence", "unsafe_destination", "duplicate_action", "owner_override", "source_removed"].includes(String(row.review_reason)) ? String(row.review_reason) : null,
      evidence: Array.isArray(row.evidence) ? row.evidence : [],
      confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
      enabled: row.enabled === true,
      readiness,
      isPrimary: String(row.id) === String(row.primary_action_id ?? "") && readiness.ready,
      updatedAt: toIso(row.updated_at),
      };
    }));
  return { actions };
});

app.patch("/api/v1/admin/action-registry/:actionId", async (request) => {
  const admin = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const params = request.params as { actionId?: string };
  const actionId = requiredString(params.actionId, "actionId", 80);
  const body = asRecord(request.body);
  const lifecycleStatuses: ActionLifecycleStatus[] = ["discovered", "needs_review", "approved", "active", "disabled"];
  const requestedStatus = body.status === undefined ? null : String(body.status) as ActionLifecycleStatus;
  if (requestedStatus && !lifecycleStatuses.includes(requestedStatus)) throw httpError(400, "Unsupported action lifecycle status");
  if (typeof body.enabled !== "boolean" && !requestedStatus) throw httpError(400, "enabled or status is required");
  const actionResult = await pool.query<Record<string, unknown>>(
    `select a.id, a.business_id, a.action_type, a.destination, a.safety_policy, a.confidence,
            a.origin, a.enabled, a.lifecycle_status, a.review_reason, a.source_type, a.source_url, a.evidence,
            b.ownership_status, b.primary_action_id
     from business_actions a
     join businesses b on b.id = a.business_id
     where a.id = $1`,
    [actionId],
  );
  if (!actionResult.rowCount) throw httpError(404, "Action not found");
  const action = actionResult.rows[0];
  const origin = action.origin === "discovered" ? "discovered" : "configured";
  const enabled = requestedStatus
    ? requestedStatus === "approved" || requestedStatus === "active"
    : body.enabled as boolean;
  const lifecycleStatus: ActionLifecycleStatus = requestedStatus
    ?? (enabled ? (origin === "discovered" ? "approved" : "active") : "disabled");
  if (enabled) {
    const confidence = action.confidence === null || action.confidence === undefined ? 0 : Number(action.confidence);
    const destination = action.destination && typeof action.destination === "object" ? asRecord(action.destination) : null;
    const destinationUrl = typeof destination?.url === "string" ? destination.url : "";
    if (confidence < 0.88) throw httpError(400, "Low-confidence actions require stronger website evidence before they can be enabled");
    if (String(action.safety_policy ?? "standard") === "manual_review") throw httpError(400, "This action requires manual safety review");
    if (String(action.action_type) === "call_emergency") {
      const evidence = Array.isArray(action.evidence) ? action.evidence : [];
      if (String(action.ownership_status) !== "verified" || String(action.source_type) !== "website" || !action.source_url || !evidence.length || !destinationUrl.startsWith("tel:")) {
        throw httpError(400, "Emergency actions require a verified source, source evidence, and a verified telephone destination");
      }
    }
  }
  const validReasons = ["low_confidence", "unsafe_destination", "duplicate_action", "owner_override", "source_removed"];
  const suppliedReason: ActionReviewReason = typeof body.reason === "string" && validReasons.includes(body.reason)
    ? body.reason as ActionReviewReason
    : null;
  const existingReviewReason: ActionReviewReason = typeof action.review_reason === "string" && validReasons.includes(action.review_reason)
    ? action.review_reason as ActionReviewReason
    : null;
  const reviewReason = enabled || lifecycleStatus === "approved" || lifecycleStatus === "active"
    ? null
    : suppliedReason ?? (lifecycleStatus === "disabled" ? "owner_override" : existingReviewReason);
  const previousValue = {
    enabled: action.enabled === true,
    lifecycleStatus: action.lifecycle_status,
    reviewReason: action.review_reason ?? null,
    primaryActionId: action.primary_action_id ?? null,
  };
  await pool.query(
    `update business_actions
     set enabled = $2, lifecycle_status = $3, review_reason = $4, updated_at = now()
     where id = $1`,
    [actionId, enabled, lifecycleStatus, reviewReason],
  );
  if (!enabled && String(action.primary_action_id ?? "") === actionId) {
    await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2", [action.business_id, actionId]);
    await recordActionRegistryAudit({
      businessId: String(action.business_id),
      actionId,
      actorUserId: admin.id,
      actorType: "super_admin",
      eventType: "primary_cleared",
      previousValue: { primaryActionId: actionId },
      newValue: { primaryActionId: null },
      reason: reviewReason,
    });
  }
  const eventType: ActionRegistryAuditEvent = lifecycleStatus === "approved" ? "approved" : enabled ? "enabled" : lifecycleStatus === "disabled" ? "disabled" : "updated";
  await recordActionRegistryAudit({
    businessId: String(action.business_id),
    actionId,
    actorUserId: admin.id,
    actorType: "super_admin",
    eventType,
    previousValue,
    newValue: { enabled, lifecycleStatus, reviewReason },
    reason: reviewReason,
  });
  invalidateBusinessRuntimeCache(String(action.business_id));
  return { actionId, businessId: String(action.business_id), enabled, lifecycleStatus, reviewReason };
});

app.patch("/api/v1/admin/businesses/:businessId/primary-action", async (request) => {
  const admin = await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const params = request.params as { businessId?: string };
  const businessId = requiredString(params.businessId, "businessId", 80);
  const body = asRecord(request.body);
  const actionId = body.actionId === null ? null : requiredString(body.actionId, "actionId", 80);
  const businessResult = await pool.query<{ id: string; primary_action_id: string | null }>("select id, primary_action_id from businesses where id = $1", [businessId]);
  if (!businessResult.rowCount) throw httpError(404, "Business not found");
  const previousActionId = businessResult.rows[0].primary_action_id;
  if (actionId) {
    const actionResult = await pool.query<Record<string, unknown>>(
      "select * from business_actions where id = $1 and business_id = $2",
      [actionId, businessId],
    );
    if (!actionResult.rowCount) throw httpError(400, "Primary action must be an approved, enabled action belonging to this business");
    const readiness = await actionReadinessForBusiness({ id: businessId }, actionFromRow(actionResult.rows[0]));
    if (!readiness.ready) {
      throw httpError(400, readiness.reason === "missing_provider_connection"
        ? "Connect and verify the provider before making this action primary"
        : "Primary action must be an enabled, approved, ready action with complete conversion settings");
    }
  }
  await pool.query("update businesses set primary_action_id = $2, updated_at = now() where id = $1", [businessId, actionId]);
  if (actionId) {
    await recordActionRegistryAudit({
      businessId,
      actionId,
      actorUserId: admin.id,
      actorType: "super_admin",
      eventType: "primary_set",
      previousValue: { primaryActionId: previousActionId },
      newValue: { primaryActionId: actionId },
      reason: "owner_override",
    });
  } else if (previousActionId) {
    await recordActionRegistryAudit({
      businessId,
      actionId: previousActionId,
      actorUserId: admin.id,
      actorType: "super_admin",
      eventType: "primary_cleared",
      previousValue: { primaryActionId: previousActionId },
      newValue: { primaryActionId: null },
      reason: "owner_override",
    });
  }
  invalidateBusinessRuntimeCache(businessId);
  return { businessId, primaryActionId: actionId };
});

app.get("/api/v1/admin/action-registry/:actionId/audit", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const params = request.params as { actionId?: string };
  const actionId = requiredString(params.actionId, "actionId", 80);
  try {
    const result = await pool.query<Record<string, unknown>>(
      `select ara.id, ara.business_id, ara.action_id, ara.actor_type, ara.event_type,
              ara.previous_value, ara.new_value, ara.reason, ara.metadata, ara.created_at,
              u.email as actor_email, u.name as actor_name
       from action_registry_audit ara
       left join app_users u on u.id = ara.actor_user_id
       where ara.action_id = $1
       order by ara.created_at desc
       limit 100`,
      [actionId],
    );
    return {
      audit: result.rows.map((row) => ({
        id: String(row.id),
        businessId: String(row.business_id),
        actionId: row.action_id ? String(row.action_id) : null,
        actorType: String(row.actor_type),
        actorEmail: typeof row.actor_email === "string" ? row.actor_email : null,
        actorName: typeof row.actor_name === "string" ? row.actor_name : null,
        eventType: String(row.event_type),
        previousValue: asRecord(row.previous_value),
        newValue: asRecord(row.new_value),
        reason: typeof row.reason === "string" ? row.reason : null,
        metadata: asRecord(row.metadata),
        createdAt: toIso(row.created_at),
      })),
    };
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    return { audit: [] };
  }
});

app.post("/api/v1/admin/workflow-replay", async (request) => {
  await requireSuperAdmin(request);
  const body = asRecord(request.body);
  const businessSlug = requiredString(body.businessSlug, "businessSlug", 120);
  const conversationId = requiredString(body.conversationId, "conversationId", 120);
  const question = requiredString(body.question, "question", 4_000);
  const business = await getBusiness(businessSlug);
  const conversation = maybeConversation(business, conversationId);
  const requestedActionId = optionalString(body.actionId, 120);
  const actionId = requestedActionId ?? conversation.actionState?.actionId;
  const action = actionId ? business.actions.find((candidate) => candidate.id === actionId) : null;
  if (!action) throw httpError(404, "The conversation workflow could not be found");
  if (!action.steps?.length) throw httpError(400, "Replay is available only for versioned workflows");

  const inputState = conversation.actionState ?? createActionState(action);
  const replay = replayWorkflowTurn(action, inputState, question);
  const simulatedState = replay.stateAfter;
  const providerStep = currentWorkflowStep(action, simulatedState);
  let providerCall: Record<string, unknown> | null = null;
  let providerResult: unknown = null;
  if (providerStep && ["lookup", "recommend", "generate_link"].includes(providerStep.type)) {
    providerCall = {
      stepId: providerStep.id,
      type: providerStep.type,
      provider: actionConfigString(providerStep.config ?? {}, "provider") ?? configuredActionProvider(action),
      operation: actionConfigString(providerStep.config ?? {}, "operation") ?? (providerStep.type === "generate_link" ? "build_registration_link" : "lookup"),
      input: { ...simulatedState.values },
    };
    await advanceWorkflowAutomation(business, action, simulatedState);
    providerResult = simulatedState.lookupResults?.[providerStep.id] ?? (simulatedState.completionUrl ? { completionUrl: simulatedState.completionUrl } : null);
  }
  const afterStep = currentWorkflowStep(action, simulatedState);
  return {
    replayed: true,
    productionDataChanged: false,
    conversationId: conversation.id,
    actionId: action.id,
    workflowVersion: action.version ?? 1,
    stateBefore: replay.stateBefore,
    extractedFields: replay.extracted,
    updatedFields: replay.updated,
    nextBestActionBefore: replay.nextBestActionBefore,
    providerCall,
    providerResult,
    stateAfter: simulatedState,
    nextBestActionAfter: workflowNextBestAction(action, afterStep),
  };
});

app.get("/api/v1/admin/businesses/:businessId/conversations/:conversationId/decision-traces", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const params = request.params as { businessId?: string; conversationId?: string };
  const businessId = requiredString(params.businessId, "businessId", 80);
  const conversationId = requiredString(params.conversationId, "conversationId", 80);
  const conversation = await pool.query(
    "select id from conversations where id = $1 and business_id = $2",
    [conversationId, businessId],
  );
  if (!conversation.rowCount) throw httpError(404, "Conversation not found");
  try {
    const result = await pool.query<Record<string, unknown>>(
      `select id, created_at, metadata
       from conversation_events
       where business_id = $1 and conversation_id = $2 and event_type = 'CONVERSATION_DECISION_TRACE'
       order by created_at desc
       limit 200`,
      [businessId, conversationId],
    );
    return {
      businessId,
      conversationId,
      traces: result.rows.map((row) => ({
        id: String(row.id),
        createdAt: toIso(row.created_at),
        trace: asRecord(row.metadata),
      })),
    };
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
    return { businessId, conversationId, traces: [] };
  }
});

app.post("/api/v1/admin/businesses/:businessId/verification/approve", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { businessId?: string };
  const businessId = requiredString(params.businessId, "businessId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<{ slug: string }>("select slug from businesses where id = $1", [businessId]);
  if (!result.rowCount) throw httpError(404, "Business not found");
  await pool.query(
    `update businesses
     set ownership_status = 'verified', ownership_verification_method = 'manual',
         ownership_verification_token_hash = null, ownership_verification_expires_at = null,
         ownership_verified_at = now(), ownership_verified_by_user_id = $2, updated_at = now()
     where id = $1`,
    [businessId, admin.id],
  );
  const business = await getBusiness(result.rows[0].slug);
  business.ownershipStatus = "verified";
  business.ownershipVerificationMethod = "manual";
  business.ownershipVerificationTokenHash = null;
  business.ownershipVerificationExpiresAt = null;
  business.ownershipVerifiedAt = new Date().toISOString();
  business.ownershipVerifiedByUserId = admin.id;
  return { ok: true, businessId, verification: ownershipPayload(business) };
});

app.post("/api/v1/admin/organizations/:organizationId/trial", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { organizationId?: string };
  const body = asRecord(request.body);
  const days = Math.min(365, Math.max(1, Number(body.days ?? defaultTrialDays)));
  const organizationId = requiredString(params.organizationId, "organizationId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<{ id: string }>(
    `update organizations
     set billing_mode = 'live', billing_status = 'trial', trial_start_at = now(),
         trial_end_at = now() + ($2::text || ' days')::interval, grace_end_at = null, updated_at = now()
     where id = $1 returning id`,
    [organizationId, days],
  );
  if (!result.rowCount) throw httpError(404, "Organization not found");
  const client = await pool.connect();
  try { await syncOrganizationBillingToBusinesses(client, organizationId); } finally { client.release(); }
  return { ok: true, organizationId, trialDays: days };
});

app.post("/api/v1/admin/organizations/:organizationId/suspend", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { organizationId?: string };
  const organizationId = requiredString(params.organizationId, "organizationId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<{ id: string }>("update organizations set billing_status = 'paused', updated_at = now() where id = $1 returning id", [organizationId]);
  if (!result.rowCount) throw httpError(404, "Organization not found");
  const client = await pool.connect();
  try { await syncOrganizationBillingToBusinesses(client, organizationId); } finally { client.release(); }
  return { ok: true, organizationId, status: "paused" };
});

app.post("/api/v1/admin/organizations/:organizationId/plan-override", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { organizationId?: string };
  const organizationId = requiredString(params.organizationId, "organizationId", 80);
  const body = asRecord(request.body);
  const planKey = requiredString(body.planKey, "planKey", 80);
  const interval = body.interval === "year" ? "year" : "month";
  const amountCents = Number(body.amountCents);
  const maxBusinesses = body.maxBusinesses === undefined ? null : Number(body.maxBusinesses);
  const stripePriceId = optionalString(body.stripePriceId, 120);
  const reason = requiredString(body.reason, "reason", 500);
  if (!Number.isInteger(amountCents) || amountCents < 0) throw httpError(400, "amountCents must be a non-negative integer");
  if (maxBusinesses !== null && (!Number.isInteger(maxBusinesses) || maxBusinesses < 1)) throw httpError(400, "maxBusinesses must be a positive integer");
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const [organizationResult, planResult] = await Promise.all([
    pool.query("select 1 from organizations where id = $1", [organizationId]),
    pool.query("select 1 from billing_plans where plan_key = $1 and active = true", [planKey]),
  ]);
  if (!organizationResult.rowCount) throw httpError(404, "Organization not found");
  if (!planResult.rowCount) throw httpError(404, "Billing plan not found");
  const result = await pool.query<{ id: string }>(
    `insert into organization_plan_overrides
       (organization_id, plan_key, billing_interval, amount_cents, currency, stripe_price_id, max_businesses, reason, created_by_user_id)
     values ($1, $2, $3, $4, 'usd', $5, $6, $7, $8)
     on conflict (organization_id) do update set
       plan_key = excluded.plan_key, billing_interval = excluded.billing_interval,
       amount_cents = excluded.amount_cents, currency = excluded.currency,
       stripe_price_id = excluded.stripe_price_id, max_businesses = excluded.max_businesses,
       reason = excluded.reason, updated_at = now()
     returning id`,
    [organizationId, planKey, interval, amountCents, stripePriceId, maxBusinesses, reason, admin.id],
  );
  if (!result.rowCount) throw httpError(404, "Organization not found");
  await pool.query(
    `update organizations
     set plan_key = $2, billing_interval = $3, billing_amount_cents = $4, stripe_price_id = $5, updated_at = now()
     where id = $1`,
    [organizationId, planKey, interval, amountCents, stripePriceId],
  );
  const client = await pool.connect();
  try { await syncOrganizationBillingToBusinesses(client, organizationId); } finally { client.release(); }
  return { ok: true, organizationId, planKey, interval, amountCents, maxBusinesses, stripePriceId, reason };
});

app.delete("/api/v1/admin/organizations/:organizationId/plan-override", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { organizationId?: string };
  const organizationId = requiredString(params.organizationId, "organizationId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  await pool.query("delete from organization_plan_overrides where organization_id = $1", [organizationId]);
  await pool.query("update organizations set billing_amount_cents = null, stripe_price_id = null, updated_at = now() where id = $1", [organizationId]);
  return { ok: true, organizationId };
});

function publicWebOrigin(): string {
  return (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
}

function demoAccessLink(accessToken: string): string {
  return `${publicWebOrigin()}/?demo=${encodeURIComponent(accessToken)}`;
}

async function adminDemoRequestRow(demoRequestId: string): Promise<Record<string, unknown>> {
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select dr.*, b.name as resolved_business_name, b.slug as business_slug, b.website_url as resolved_website_url,
            o.name as organization_name,
            s.id as session_id, s.expires_at as session_expires_at, s.open_count, s.first_opened_at,
            s.last_opened_at as session_last_opened_at, s.revoked_at as session_revoked_at, s.access_type,
            (select max(a.created_at) from demo_access_audit a where a.demo_request_id = dr.id and a.event_type = 'validation_passed') as last_validation_passed_at,
            (select max(a.created_at) from demo_access_audit a where a.demo_request_id = dr.id and a.event_type = 'validation_failed') as last_validation_failed_at
     from demo_requests dr
     left join businesses b on b.id = dr.business_id
     left join organizations o on o.id = dr.organization_id
     left join demo_access_sessions s on s.id = dr.latest_session_id
     where dr.id = $1`,
    [demoRequestId],
  );
  if (!result.rowCount) throw httpError(404, "Demo request not found");
  return result.rows[0];
}

function adminDemoRequestPayload(row: Record<string, unknown>): Record<string, unknown> {
  const expiresAt = nullableIso(row.session_expires_at);
  const sessionExpired = Boolean(expiresAt && Date.parse(expiresAt) <= Date.now());
  const status = sessionExpired && ["ready", "sent", "opened"].includes(String(row.status)) ? "expired" : String(row.status);
  return {
    id: String(row.id),
    requesterName: row.requester_name ?? null,
    requesterEmail: row.requester_email ?? null,
    businessName: row.resolved_business_name ?? row.business_name ?? null,
    websiteUrl: row.resolved_website_url ?? row.website_url,
    templateKey: String(row.template_key),
    source: String(row.source),
    status,
    organizationName: row.organization_name ?? null,
    businessId: row.business_id ?? null,
    businessSlug: row.business_slug ?? null,
    requestedAt: nullableIso(row.requested_at),
    lastOpenedAt: nullableIso(row.last_opened_at ?? row.session_last_opened_at),
    lastClaimedAt: nullableIso(row.last_claimed_at),
    accessCount: Number(row.access_count ?? 0),
    session: row.session_id ? {
      id: String(row.session_id),
      expiresAt,
      openCount: Number(row.open_count ?? 0),
      firstOpenedAt: nullableIso(row.first_opened_at),
      lastOpenedAt: nullableIso(row.session_last_opened_at),
      revokedAt: nullableIso(row.session_revoked_at),
      accessType: String(row.access_type ?? "public"),
      active: !row.session_revoked_at && !sessionExpired,
    } : null,
    lastValidationPassedAt: nullableIso(row.last_validation_passed_at),
    lastValidationFailedAt: nullableIso(row.last_validation_failed_at),
  };
}

async function businessForAdminRequest(row: Record<string, unknown>): Promise<Business> {
  const slug = typeof row.business_slug === "string" ? row.business_slug : null;
  if (!slug) throw httpError(409, "This demo request has not produced a business yet");
  return getBusiness(slug);
}

app.get("/api/v1/admin/demo-requests", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const query = request.query as { status?: string; limit?: string };
  const limit = Math.min(200, Math.max(1, Number(query.limit ?? 100)));
  const status = optionalString(query.status, 40);
  const result = await pool.query<Record<string, unknown>>(
    `select dr.*, b.name as resolved_business_name, b.slug as business_slug, b.website_url as resolved_website_url,
            o.name as organization_name,
            s.id as session_id, s.expires_at as session_expires_at, s.open_count, s.first_opened_at,
            s.last_opened_at as session_last_opened_at, s.revoked_at as session_revoked_at, s.access_type,
            (select max(a.created_at) from demo_access_audit a where a.demo_request_id = dr.id and a.event_type = 'validation_passed') as last_validation_passed_at,
            (select max(a.created_at) from demo_access_audit a where a.demo_request_id = dr.id and a.event_type = 'validation_failed') as last_validation_failed_at
     from demo_requests dr
     left join businesses b on b.id = dr.business_id
     left join organizations o on o.id = dr.organization_id
     left join demo_access_sessions s on s.id = dr.latest_session_id
     where ($1::text is null or dr.status = $1)
     order by dr.requested_at desc
     limit $2`,
    [status, limit],
  );
  const summary = await pool.query<{ total: string; ready: string; requested: string; converted: string }>(
    `select count(*)::text as total,
            count(*) filter (where status in ('ready', 'sent', 'opened'))::text as ready,
            count(*) filter (where status in ('received', 'failed'))::text as requested,
            count(*) filter (where status in ('claimed', 'converted'))::text as converted
     from demo_requests`,
  );
  return {
    requests: result.rows.map(adminDemoRequestPayload),
    summary: {
      total: Number(summary.rows[0]?.total ?? 0),
      ready: Number(summary.rows[0]?.ready ?? 0),
      requested: Number(summary.rows[0]?.requested ?? 0),
      converted: Number(summary.rows[0]?.converted ?? 0),
    },
  };
});

app.get("/api/v1/admin/demo-requests/:demoRequestId", async (request) => {
  await requireSuperAdmin(request);
  const params = request.params as { demoRequestId?: string };
  const demoRequestId = requiredString(params.demoRequestId, "demoRequestId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const row = await adminDemoRequestRow(demoRequestId);
  const audit = await pool.query<Record<string, unknown>>(
    `select id, event_type, actor_type, actor_email, metadata, created_at
     from demo_access_audit where demo_request_id = $1 order by created_at desc limit 100`,
    [demoRequestId],
  );
  return {
    request: adminDemoRequestPayload(row),
    audit: audit.rows.map((event) => ({
      id: String(event.id), eventType: String(event.event_type), actorType: String(event.actor_type),
      actorEmail: event.actor_email ?? null, metadata: event.metadata ?? {}, createdAt: toIso(event.created_at),
    })),
  };
});

app.post("/api/v1/admin/demo-requests", async (request, reply) => {
  const admin = await requireSuperAdmin(request);
  const body = asRecord(request.body);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const businessId = optionalString(body.businessId, 80);
  const businessSlug = optionalString(body.businessSlug, 120);
  const result = await pool.query<Record<string, unknown>>(
    `select b.id, b.slug, b.name, b.website_url, b.organization_id
     from businesses b
     where ($1::uuid is not null and b.id = $1::uuid) or ($2::text is not null and b.slug = $2)
     limit 1`,
    [businessId, businessSlug],
  );
  if (!result.rowCount) throw httpError(404, "Business not found");
  const business = await getBusiness(String(result.rows[0].slug));
  const requesterName = optionalString(body.requesterName ?? body.name, 160);
  const requesterEmail = optionalString(body.requesterEmail ?? body.email, 240)?.toLowerCase() ?? null;
  const demoRequestId = optionalString(body.demoRequestId, 80) ?? await createDemoRequestRecord({
    requesterName,
    requesterEmail,
    businessName: business.name,
    websiteUrl: business.websiteUrl,
    templateKey: optionalString(body.templateKey, 80),
    source: "super_admin",
    createdByUserId: admin.id,
    request,
  });
  if (!demoRequestId) throw httpError(503, "Demo requests require PostgreSQL storage");
  const access = await createDemoAccess(business, {
    demoRequestId,
    createdByUserId: admin.id,
    accessType: "admin",
    accessLabel: optionalString(body.accessLabel, 160) ?? "Super-admin test access",
    email: requesterEmail,
    name: requesterName,
  });
  const { sessionId, ...publicAccess } = access;
  return reply.code(201).send({
    ok: true,
    demoRequestId,
    sessionId,
    ...publicAccess,
    url: demoAccessLink(access.accessToken),
  });
});

app.post("/api/v1/admin/demo-requests/:demoRequestId/extend", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { demoRequestId?: string };
  const demoRequestId = requiredString(params.demoRequestId, "demoRequestId", 80);
  const body = asRecord(request.body);
  const days = Math.min(90, Math.max(1, Number(body.days ?? 7)));
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const row = await adminDemoRequestRow(demoRequestId);
  if (!row.session_id || !row.business_id) throw httpError(409, "This demo request does not have an active business link");
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1_000).toISOString();
  await pool.query(
    `update demo_access_sessions set expires_at = $2, revoked_at = null, updated_at = now()
     where id = $1`,
    [row.session_id, expiresAt],
  );
  await pool.query("update demo_requests set status = 'ready', updated_at = now() where id = $1", [demoRequestId]);
  await recordDemoAudit({
    demoRequestId,
    sessionId: String(row.session_id),
    businessId: String(row.business_id),
    eventType: "extended",
    actorType: "admin",
    actorUserId: admin.id,
    actorEmail: admin.email,
    request,
    metadata: { days, expiresAt },
  });
  return { ok: true, demoRequestId, expiresAt };
});

app.post("/api/v1/admin/demo-requests/:demoRequestId/reset", async (request, reply) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { demoRequestId?: string };
  const demoRequestId = requiredString(params.demoRequestId, "demoRequestId", 80);
  const body = asRecord(request.body);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const row = await adminDemoRequestRow(demoRequestId);
  const business = await businessForAdminRequest(row);
  await pool.query("update demo_access_sessions set revoked_at = now(), updated_at = now() where demo_request_id = $1 and revoked_at is null", [demoRequestId]);
  const access = await createDemoAccess(business, {
    demoRequestId,
    createdByUserId: admin.id,
    accessType: "admin",
    accessLabel: optionalString(body.accessLabel, 160) ?? "Reset super-admin test access",
    email: typeof row.requester_email === "string" ? row.requester_email : null,
    name: typeof row.requester_name === "string" ? row.requester_name : null,
  });
  await recordDemoAudit({
    demoRequestId,
    sessionId: access.sessionId,
    businessId: business.id,
    eventType: "reset",
    actorType: "admin",
    actorUserId: admin.id,
    actorEmail: admin.email,
    request,
  });
  const { sessionId, ...publicAccess } = access;
  return reply.send({ ok: true, demoRequestId, sessionId, ...publicAccess, url: demoAccessLink(access.accessToken) });
});

app.post("/api/v1/admin/demo-requests/:demoRequestId/revoke", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { demoRequestId?: string };
  const demoRequestId = requiredString(params.demoRequestId, "demoRequestId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const row = await adminDemoRequestRow(demoRequestId);
  await pool.query("update demo_access_sessions set revoked_at = now(), updated_at = now() where demo_request_id = $1 and revoked_at is null", [demoRequestId]);
  await pool.query("update demo_requests set status = 'revoked', updated_at = now() where id = $1", [demoRequestId]);
  await recordDemoAudit({
    demoRequestId,
    sessionId: row.session_id ? String(row.session_id) : null,
    businessId: row.business_id ? String(row.business_id) : null,
    eventType: "revoked",
    actorType: "admin",
    actorUserId: admin.id,
    actorEmail: admin.email,
    request,
  });
  return { ok: true, demoRequestId, status: "revoked" };
});

app.post("/api/v1/admin/demo-requests/:demoRequestId/validate", async (request) => {
  const admin = await requireSuperAdmin(request);
  const params = request.params as { demoRequestId?: string };
  const demoRequestId = requiredString(params.demoRequestId, "demoRequestId", 80);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const row = await adminDemoRequestRow(demoRequestId);
  const business = await businessForAdminRequest(row);
  await recordDemoAudit({
    demoRequestId,
    sessionId: row.session_id ? String(row.session_id) : null,
    businessId: business.id,
    eventType: "validation_started",
    actorType: "admin",
    actorUserId: admin.id,
    actorEmail: admin.email,
    request,
  });
  const [sourceResult, chunkResult, configResult, sessionResult] = await Promise.all([
    pool.query<{ count: string }>("select count(*)::text as count from business_sources where business_id = $1 and crawl_status = 'ready'", [business.id]),
    pool.query<{ count: string }>("select count(*)::text as count from knowledge_chunks where business_id = $1", [business.id]),
    pool.query<{ count: string }>("select count(*)::text as count from agent_configs where business_id = $1", [business.id]),
    pool.query<{ count: string }>("select count(*)::text as count from demo_access_sessions where demo_request_id = $1 and revoked_at is null and expires_at > now()", [demoRequestId]),
  ]);
  const checks = {
    business: true,
    readySources: Number(sourceResult.rows[0]?.count ?? 0),
    knowledgeChunks: Number(chunkResult.rows[0]?.count ?? 0),
    agentConfig: Number(configResult.rows[0]?.count ?? 0) > 0,
    activeAccess: Number(sessionResult.rows[0]?.count ?? 0) > 0,
  };
  const passed = checks.readySources > 0 && checks.knowledgeChunks > 0 && checks.agentConfig && checks.activeAccess;
  await recordDemoAudit({
    demoRequestId,
    sessionId: row.session_id ? String(row.session_id) : null,
    businessId: business.id,
    eventType: passed ? "validation_passed" : "validation_failed",
    actorType: "admin",
    actorUserId: admin.id,
    actorEmail: admin.email,
    request,
    metadata: checks,
  });
  return { ok: passed, demoRequestId, checks };
});

app.get("/api/v1/auth/me", async (request) => {
  const authUser = await requireFirebaseAuth(request);
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const result = await pool.query<{ id: string }>(
    "select id from app_users where identity_subject = $1 and status = 'active'",
    [authUser.identitySubject],
  );
  if (!result.rowCount) throw httpError(404, "FrontDeskWise account has not been bootstrapped");
  return authSnapshot(result.rows[0].id);
});

app.post("/api/v1/auth/bootstrap", async (request) => {
  const authUser = await requireFirebaseAuth(request);
  const body = asRecord(request.body);
  return bootstrapAuthenticatedUser(authUser, {
    demoToken: optionalString(body.demoToken, 512),
    organizationName: optionalString(body.organizationName, 160),
  });
});

app.post("/api/v1/auth/businesses", async (request, reply) => {
  const authUser = await requireFirebaseAuth(request);
  if (!pool) throw httpError(503, "Adding a business requires PostgreSQL storage");
  const body = asRecord(request.body);
  const websiteUrl = normalisePublicUrl(body.websiteUrl);
  const userResult = await pool.query<{ id: string }>(
    "select id from app_users where identity_subject = $1 and status = 'active'",
    [authUser.identitySubject],
  );
  if (!userResult.rowCount) throw httpError(404, "FrontDeskWise account has not been bootstrapped");
  const organizationResult = await pool.query<{ id: string }>(
    `select o.id
     from organizations o
     join organization_members om on om.organization_id = o.id
     where om.user_id = $1 and ($2::uuid is null or o.id = $2::uuid) and om.role in ('owner', 'admin')
     order by (om.role = 'owner') desc, om.created_at asc
     limit 1`,
    [userResult.rows[0].id, optionalString(body.organizationId, 80)],
  );
  if (!organizationResult.rowCount) throw httpError(403, "You do not have permission to add a business to that organization");
  const businessLimit = await pool.query<{ max_businesses: number; billing_status: BillingStatus; trial_end_at: string | null }>(
    `select coalesce(opo.max_businesses, bp.max_businesses, 1)::integer as max_businesses,
            o.billing_status, o.trial_end_at
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     where o.id = $1`,
    [organizationResult.rows[0].id],
  );
  if (!businessLimit.rowCount) throw httpError(404, "Organization not found");
  const organizationBilling = businessLimit.rows[0];
  const access = organizationBilling.billing_status === "active"
    || organizationBilling.billing_status === "grace"
    || (organizationBilling.billing_status === "trial" && (!organizationBilling.trial_end_at || Date.parse(toIso(organizationBilling.trial_end_at)) > Date.now()));
  if (!access) throw httpError(402, "This organization needs an active subscription before adding another business");
  const duplicateBusiness = await pool.query<{ name: string; slug: string }>(
    `select name, slug
     from businesses
     where organization_id = $1
       and coalesce(
         website_url_key,
         nullif(
           regexp_replace(
             regexp_replace(
               regexp_replace(website_url, '^https?://', '', 'i'),
               '^www\\.', '', 'i'
             ),
             '/+$', ''
           ),
           ''
         )
       ) = $2
     limit 1`,
    [organizationResult.rows[0].id, websiteIdentityKey(websiteUrl)],
  );
  if (duplicateBusiness.rowCount) {
    throw httpError(409, `This website is already registered as ${duplicateBusiness.rows[0].name}. Open the existing business instead.`);
  }
  const businessCount = await pool.query<{ count: string }>(
    `select count(distinct coalesce(
       website_url_key,
       nullif(
         regexp_replace(
           regexp_replace(
             regexp_replace(website_url, '^https?://', '', 'i'),
             '^www\\.', '', 'i'
           ),
           '/+$', ''
         ),
         ''
       ),
       id::text
     ))::text as count
     from businesses
     where organization_id = $1`,
    [organizationResult.rows[0].id],
  );
  if (Number(businessCount.rows[0].count) >= Number(organizationBilling.max_businesses ?? 1)) {
    throw httpError(402, "Your current plan has reached its business limit. Upgrade to add another business.");
  }

  const crawled = await crawlConfiguredWebsite(websiteUrl);
  const firstPage = crawled.pages[0];
  const name = businessNameFromTitle(firstPage.title, websiteUrl);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  while (businesses.has(slug) || (pool && await loadBusinessFromDatabase(slug))) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
  const business = makeBusiness({ name, slug, websiteUrl, pages: crawled.pages });
  business.billing = { ...business.billing, mode: "live", isDemo: false, status: "trial", planKey: "starter", trialEndsAt: trialEndFromNow() };
  try {
    await persistBusiness(business, organizationResult.rows[0].id);
  } catch (error) {
    if (isUniqueConstraintError(error, "businesses_organization_website_key_idx")) {
      throw httpError(409, "This website was registered by another request. Open the existing business instead.");
    }
    throw error;
  }
  businesses.set(slug, business);
  await pool.query(
    `insert into business_members (business_id, user_id, role)
     values ($1, $2, 'admin')
     on conflict (business_id, user_id) do update set role = 'admin', updated_at = now()`,
    [business.id, userResult.rows[0].id],
  );
  await queueLifecycleEvent({
    eventType: "TRIAL_STARTED",
    eventKey: `trial.started:${organizationResult.rows[0].id}`,
    organizationId: organizationResult.rows[0].id,
    businessId: business.id,
    payload: {
      business_name: business.name,
      trial_days: defaultTrialDays,
      dashboard_url: lifecycleAppUrl(`/app/${business.slug}`),
      billing_url: lifecycleAppUrl("/app/settings/billing"),
    },
  });
  await queueLifecycleEvent({
    eventType: "BUSINESS_VERIFICATION_NEEDED",
    eventKey: `business.verification_needed:${business.id}`,
    organizationId: organizationResult.rows[0].id,
    businessId: business.id,
    payload: {
      business_name: business.name,
      verification_url: lifecycleAppUrl(`/app/${business.slug}/settings/verification`),
    },
  });
  return reply.code(201).send({ business: await workspacePayload(business), auth: await authSnapshot(userResult.rows[0].id, organizationResult.rows[0].id) });
});

async function generateDemoFromRequest(request: FastifyRequest): Promise<Record<string, unknown>> {
  const body = asRecord(request.body);
  const websiteUrl = normalisePublicUrl(body.websiteUrl);
  const requesterName = optionalString(body.requesterName ?? body.name, 160);
  const requesterEmail = optionalString(body.requesterEmail ?? body.email, 240)?.toLowerCase() ?? null;
  if (requesterEmail && (!requesterEmail.includes("@") || requesterEmail.length < 5)) {
    throw httpError(400, "requesterEmail must be a valid email address");
  }
  const requestId = await createDemoRequestRecord({
    requesterName,
    requesterEmail,
    businessName: optionalString(body.businessName, 160),
    websiteUrl,
    templateKey: optionalString(body.templateKey, 80),
    source: optionalString(body.source, 80) ?? "landing",
    request,
  });

  try {
    const crawled = await crawlConfiguredWebsite(websiteUrl);
    const firstPage = crawled.pages[0];
    const name = businessNameFromTitle(firstPage.title, websiteUrl);
    const baseSlug = slugify(name);
    let slug = baseSlug;
    while (businesses.has(slug) || (pool && await loadBusinessFromDatabase(slug))) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

    const business = makeBusiness({ name, slug, websiteUrl, pages: crawled.pages });
    businesses.set(slug, business);
    await persistBusiness(business);
    const access = await createDemoAccess(business, {
      demoRequestId: requestId,
      email: requesterEmail,
      name: requesterName,
      accessType: "public",
    });
    if (requesterEmail) {
      await queueLifecycleEvent({
        eventType: "DEMO_READY",
        eventKey: `demo.ready:${business.id}:${requestId ?? requesterEmail}`,
        organizationId: await businessOrganizationId(business),
        businessId: business.id,
        recipientEmail: requesterEmail,
        payload: {
          first_name: requesterName?.split(/\s+/)[0] || "there",
          business_name: business.name,
          demo_url: lifecycleAppUrl(`/demo/${business.slug}`),
        },
      });
    }
    const { sessionId: _sessionId, ...publicAccess } = access;
    return {
      ...(await workspacePayload(business)),
      access: publicAccess,
      demoRequest: requestId ? { id: requestId, status: "ready" } : null,
    };
  } catch (error) {
    if (requestId && pool) {
      await pool.query("update demo_requests set status = 'failed', updated_at = now() where id = $1", [requestId]);
      await recordDemoAudit({
        demoRequestId: requestId,
        eventType: "validation_failed",
        actorType: requesterEmail ? "requester" : "anonymous",
        actorEmail: requesterEmail,
        request,
        metadata: { stage: "crawl_or_provision", error: error instanceof Error ? error.message.slice(0, 240) : "unknown" },
      });
    }
    throw error;
  }
}

app.post("/api/v1/demos", async (request, reply) => reply.code(201).send(await generateDemoFromRequest(request)));
app.post("/api/v1/demo-requests", async (request, reply) => reply.code(201).send(await generateDemoFromRequest(request)));

app.post("/api/v1/demo-access/exchange", async (request) => {
  const token = requiredString(asRecord(request.body).accessToken, "accessToken", 512);
  const session = await exchangeDemoAccess(token);
  const business = await getBusiness(session.slug);
  return {
    accessToken: token,
    expiresAt: session.expiresAt,
    user: session.user,
    workspace: await workspacePayload(business),
  };
});

app.get("/api/v1/demo-catalog", async () => ({
  demos: await Promise.all([...businesses.values()]
    .filter((business) => isInternalDemoSlug(business.slug))
    .map((business) => publicWorkspacePayload(business))),
}));

app.get("/api/v1/demo/:slug/public", async (request) => {
  const params = request.params as { slug?: string };
  const slug = requiredString(params.slug, "slug", 120);
  const business = await getBusiness(slug);
  // Landing-page demos are created on demand and are public only to the
  // visitor holding the short-lived demo access token. Seeded examples remain
  // open without a token.
  if (!isInternalDemoSlug(slug)) await requireDemoOwner(business, request);
  return publicWorkspacePayload(business);
});

app.post("/api/v1/demo/:slug/public/test", async (request) => {
  const params = request.params as { slug?: string };
  const slug = requiredString(params.slug, "slug", 120);
  if (!isInternalDemoSlug(slug)) throw httpError(404, "Public demo assistant not found");
  const business = await getBusiness(slug);
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  // Public samples are intentionally read-only: prospects can test the agent,
  // but their questions do not mutate the seeded demo's conversations or gaps.
  return { ...customerAnswerPayload(await answerQuestion(business, question, { recordGap: false })), businessName: business.name };
});

app.get("/api/v1/demo/:slug", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return workspacePayload(business);
});

app.post("/api/v1/demo/:slug/evaluation", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  if (!isInternalDemoSlug(business.slug)) await requireDemoOwner(business, request);
  const requestedLimit = Number(asRecord(request.body).limit ?? 10);
  return evaluateBusiness(business, Number.isFinite(requestedLimit) ? requestedLimit : 10);
});

app.get("/api/v1/demo/:slug/knowledge/embedding-status", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return embeddingReadinessForBusiness(business);
});

app.post("/api/v1/demo/:slug/knowledge/reindex", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  if (!pool || !embeddingsConfigured()) throw httpError(503, "Embedding jobs require OPENAI_API_KEY in the API environment");
  const provider = embeddingProviderHealth().status === "unknown" ? await probeEmbeddingProvider() : embeddingProviderHealth();
  if (provider.status !== "healthy") throw httpError(503, `Embedding provider is not ready (${provider.reason ?? provider.status})`);
  const jobId = await enqueueEmbeddingJob(business);
  if (!jobId) return { status: "succeeded", message: "All knowledge chunks already have embeddings" };
  void processEmbeddingJob(business, jobId);
  return { status: "queued", jobId, model: embeddingModel() };
});

app.post("/api/v1/demo/:slug/knowledge/sources/:sourceId/recrawl", async (request) => {
  const params = request.params as { slug?: string; sourceId?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  const sourceId = requiredString(params.sourceId, "sourceId", 120);
  const source = business.sources.find((item) => item.id === sourceId);
  if (!source) throw httpError(404, "Knowledge source not found");
  if (source.contentType !== "web_page") throw httpError(400, "Uploaded documents cannot be re-crawled from their source URL");
  source.crawlStatus = "crawling";
  await persistBusiness(business);
  try {
    const crawled = await crawlConfiguredWebsite(normalisePublicUrl(business.websiteUrl));
    await replaceWebsiteSources(business, crawled.pages);
    await enqueueAndRunEmbeddingJob(business);
    return { status: "ready", sourceCount: business.sources.filter((item) => item.contentType === "web_page").length };
  } catch (error) {
    const current = business.sources.find((item) => item.id === sourceId);
    if (current) {
      current.crawlStatus = "failed";
      current.errorMessage = error instanceof Error ? error.message.slice(0, 1_000) : "Website recrawl failed";
      if (error instanceof CrawlError && error.audit) {
        const route = error.audit.routes[0];
        current.httpStatus = route?.status ?? error.audit.responseStatus;
        current.rawHtmlBytes = error.audit.rawHtmlBytes || null;
        current.extractedCharacterCount = route?.extractedCharacters ?? error.audit.extractedVisibleTextSize;
        current.discoveredLinkCount = route?.discoveredLinks.length ?? error.audit.discoveredInternalLinks.length;
        current.crawlMode = route?.crawlMode ?? (error.audit.renderedCrawl.attempted ? "rendered" : "static");
        current.renderAttempted = route?.renderAttempted ?? error.audit.renderedCrawl.attempted;
        current.renderSuccess = route?.renderSuccess ?? false;
        current.renderDurationMs = route?.renderDurationMs ?? null;
      }
      await persistBusiness(business);
    }
    throw error instanceof CrawlError ? error : httpError(422, "The website could not be re-crawled yet");
  }
});

app.delete("/api/v1/demo/:slug/knowledge/sources/:sourceId", async (request) => {
  const params = request.params as { slug?: string; sourceId?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  const sourceId = requiredString(params.sourceId, "sourceId", 120);
  const sourceIndex = business.sources.findIndex((item) => item.id === sourceId);
  if (sourceIndex < 0) throw httpError(404, "Knowledge source not found");
  const [source] = business.sources.splice(sourceIndex, 1);
  business.chunks = business.chunks.filter((chunk) => chunk.sourceId !== sourceId);
  if (pool) {
    await pool.query("delete from knowledge_chunks where business_id = $1 and source_id = $2", [business.id, sourceId]);
    await pool.query("delete from business_sources where business_id = $1 and id = $2", [business.id, sourceId]);
  }
  return { ok: true, sourceId: source.id };
});

app.get("/api/v1/demo/:slug/verification", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  return { verification: ownershipPayload(business), methods: ["email", "meta_tag", "file", "dns_txt", "manual"] };
});

app.post("/api/v1/demo/:slug/verification/request", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const authUser = await requireFirebaseAuth(request);
  await requireAuthenticatedBusinessOwner(business, request);
  const body = asRecord(request.body);
  const method = body.method as OwnershipVerificationMethod;
  if (!["email", "meta_tag", "file", "dns_txt", "manual"].includes(method)) throw httpError(400, "Unsupported ownership verification method");
  const token = randomBytes(24).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
  if (method === "email" && authUser.email.split("@").pop()?.toLowerCase() !== verificationHostname(business)) {
    throw httpError(400, `Your signed-in email must use the ${verificationHostname(business)} domain for email verification`);
  }
  if (method === "email") {
    business.ownershipStatus = "verified";
    business.ownershipVerificationMethod = "email";
    business.ownershipVerificationTokenHash = null;
    business.ownershipVerificationExpiresAt = null;
    business.ownershipVerifiedAt = new Date().toISOString();
    business.ownershipVerifiedByUserId = null;
  } else {
    business.ownershipStatus = "pending";
    business.ownershipVerificationMethod = method;
    business.ownershipVerificationTokenHash = hashAccessToken(token);
    business.ownershipVerificationExpiresAt = expiresAt;
    business.ownershipVerifiedAt = null;
    business.ownershipVerifiedByUserId = null;
  }
  await persistBusiness(business);
  return {
    verification: ownershipPayload(business),
    token: method === "email" || method === "manual" ? null : token,
    instructions: verificationInstructions(method, verificationHostname(business), token),
    expiresAt: method === "email" || method === "manual" ? null : expiresAt,
  };
});

app.post("/api/v1/demo/:slug/verification/check", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const authUser = await requireFirebaseAuth(request);
  await requireAuthenticatedBusinessOwner(business, request);
  if (business.ownershipVerificationMethod === "manual") return { verified: false, verification: ownershipPayload(business), message: "Manual verification is waiting for a super-admin review." };
  const token = requiredString(asRecord(request.body).token, "token", 200);
  if (!business.ownershipVerificationTokenHash || business.ownershipVerificationTokenHash !== hashAccessToken(token)) {
    return { verified: false, verification: ownershipPayload(business), message: "That verification token does not match the current request." };
  }
  if (!business.ownershipVerificationExpiresAt || Date.parse(business.ownershipVerificationExpiresAt) <= Date.now()) {
    return { verified: false, verification: ownershipPayload(business), message: "That verification request has expired. Start a new verification request." };
  }
  let verified = false;
  try {
    verified = await verifyBusinessOwnership(business, business.ownershipVerificationMethod ?? "manual", token, authUser);
  } catch (error) {
    return { verified: false, verification: ownershipPayload(business), message: error instanceof Error ? error.message : "The website could not be checked yet." };
  }
  if (!verified) return { verified: false, verification: ownershipPayload(business), message: "The verification proof was not found yet." };
  business.ownershipStatus = "verified";
  business.ownershipVerificationTokenHash = null;
  business.ownershipVerificationExpiresAt = null;
  business.ownershipVerifiedAt = new Date().toISOString();
  business.ownershipVerifiedByUserId = null;
  await persistBusiness(business);
  return { verified: true, verification: ownershipPayload(business), message: "Business ownership verified. Live publishing is enabled." };
});

function installationSupportRequestPayload(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    businessName: String(row.business_name ?? ""),
    websiteUrl: String(row.website_url ?? ""),
    organizationName: row.organization_name ? String(row.organization_name) : null,
    requesterName: String(row.requester_name ?? ""),
    requesterEmail: String(row.requester_email ?? ""),
    platform: String(row.platform),
    helpRequest: String(row.help_request),
    preferredContactMethod: String(row.preferred_contact_method),
    contactValue: String(row.contact_value),
    message: typeof row.message === "string" ? row.message : null,
    screenshotUrl: typeof row.screenshot_url === "string" ? row.screenshot_url : null,
    ownershipStatus: String(row.ownership_status ?? "pending"),
    widgetDetected: Boolean(row.widget_detected),
    widgetLastLoadedAt: nullableIso(row.widget_last_loaded_at),
    widgetLoadCount: Number(row.widget_load_count ?? 0),
    assignedUserId: typeof row.assigned_user_id === "string" ? row.assigned_user_id : null,
    assignedUserName: typeof row.assigned_user_name === "string" ? row.assigned_user_name : null,
    assignedUserEmail: typeof row.assigned_user_email === "string" ? row.assigned_user_email : null,
    status: String(row.status),
    resolvedAt: nullableIso(row.resolved_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function supportCasePayload(row: Record<string, unknown>, events: Array<Record<string, unknown>> = []): Record<string, unknown> {
  const category = String(row.category ?? "general");
  const status = String(row.status ?? "open");
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    businessName: String(row.business_name ?? ""),
    websiteUrl: String(row.website_url ?? ""),
    organizationName: row.organization_name ? String(row.organization_name) : null,
    requesterName: String(row.requester_name ?? ""),
    requesterEmail: String(row.requester_email ?? ""),
    subject: String(row.subject ?? ""),
    category: ["general", "installation", "knowledge", "actions", "integration", "billing", "verification", "widget", "account"].includes(category) ? category : "general",
    provider: typeof row.provider === "string" ? row.provider : null,
    connectionId: typeof row.connection_id === "string" ? row.connection_id : null,
    sourcePage: typeof row.source_page === "string" ? row.source_page : null,
    sourceUrl: typeof row.source_url === "string" ? row.source_url : null,
    severity: row.severity === "urgent" ? "urgent" : "normal",
    description: String(row.description ?? ""),
    diagnostics: row.diagnostics && typeof row.diagnostics === "object" ? asRecord(row.diagnostics) : {},
    correlationId: String(row.correlation_id ?? ""),
    assignedUserId: typeof row.assigned_user_id === "string" ? row.assigned_user_id : null,
    assignedUserName: typeof row.assigned_user_name === "string" ? row.assigned_user_name : null,
    assignedUserEmail: typeof row.assigned_user_email === "string" ? row.assigned_user_email : null,
    status: status === "in_progress" || status === "resolved" ? status : "open",
    resolvedAt: nullableIso(row.resolved_at),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    events: events.map((event) => ({
      id: String(event.id),
      eventType: String(event.event_type),
      actorName: typeof event.actor_name === "string" ? event.actor_name : null,
      body: typeof event.body === "string" ? event.body : null,
      createdAt: toIso(event.created_at),
    })),
  };
}

function supportDiagnosticsForBusiness(business: Business, sourcePage: string | null = null): Record<string, unknown> {
  const failedSources = business.sources.filter((source) => source.crawlStatus === "failed");
  const pendingSources = business.sources.filter((source) => source.crawlStatus === "queued" || source.crawlStatus === "crawling");
  const lastRefresh = business.sources
    .map((source) => Date.parse(source.lastCrawledAt))
    .filter((value) => Number.isFinite(value))
    .sort((left, right) => right - left)[0];
  return {
    business: business.name,
    businessId: business.id,
    page: sourcePage ?? "Support",
    source: business.websiteUrl,
    lastRefresh: lastRefresh ? new Date(lastRefresh).toISOString() : null,
    crawlerStatus: failedSources.length ? "render_failed" : pendingSources.length ? "refreshing" : "ready",
    failedSources: failedSources.slice(0, 5).map((source) => ({ url: source.url, error: source.errorMessage ?? null })),
    pendingSourceCount: pendingSources.length,
    integrationErrors: [],
    widget: {
      detected: business.widget.loadCount > 0,
      lastLoadedAt: business.widget.lastLoadedAt,
      loadCount: business.widget.loadCount,
    },
  };
}

async function loadSupportCaseEvents(caseIds: string[]): Promise<Map<string, Record<string, unknown>[]>> {
  const eventsByCase = new Map<string, Record<string, unknown>[]>();
  if (!pool || !caseIds.length) return eventsByCase;
  const result = await pool.query<Record<string, unknown>>(
    `select e.id, e.case_id, e.event_type, e.body, e.created_at, u.name as actor_name
     from support_case_events e
     left join app_users u on u.id = e.actor_user_id
     where e.case_id = any($1::uuid[])
     order by e.created_at desc`,
    [caseIds],
  );
  for (const row of result.rows) {
    const caseId = String(row.case_id);
    const events = eventsByCase.get(caseId) ?? [];
    events.push(row);
    eventsByCase.set(caseId, events);
  }
  return eventsByCase;
}

app.get("/api/v1/demo/:slug/support", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const access = await requireBusinessTeamAccess(business, request, "viewer");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const sourcePage = optionalString(query.page, 180);
  if (!pool) {
    return { context: { diagnostics: supportDiagnosticsForBusiness(business, sourcePage), systemStatus: { api: "operational" } }, cases: [] };
  }
  const result = await pool.query<Record<string, unknown>>(
    `select c.*, b.name as business_name, b.website_url, o.name as organization_name,
            u.name as assigned_user_name, u.email as assigned_user_email
     from support_cases c
     join businesses b on b.id = c.business_id
     left join organizations o on o.id = c.organization_id
     left join app_users u on u.id = c.assigned_user_id
     where c.business_id = $1
     order by c.created_at desc
     limit 100`,
    [business.id],
  );
  const eventsByCase = await loadSupportCaseEvents(result.rows.map((row) => String(row.id)));
  return {
    context: {
      diagnostics: supportDiagnosticsForBusiness(business, sourcePage),
      systemStatus: {
        api: "operational",
        knowledge: business.sources.some((source) => source.crawlStatus === "failed") ? "needs_attention" : "healthy",
        widget: business.widget.loadCount > 0 ? "detected" : "not_detected",
        integrations: "available_on_request",
      },
    },
    cases: result.rows.map((row) => supportCasePayload(row, eventsByCase.get(String(row.id)) ?? [])),
    viewer: { id: access.id, name: access.name, email: access.email },
  };
});

app.post("/api/v1/demo/:slug/support/cases", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const access = await requireBusinessTeamAccess(business, request, "viewer");
  if (!pool) throw httpError(503, "Support cases require PostgreSQL storage");
  const body = asRecord(request.body);
  const category = typeof body.category === "string" && ["general", "installation", "knowledge", "actions", "integration", "billing", "verification", "widget", "account"].includes(body.category)
    ? body.category as SupportCaseCategory : "general";
  const subject = requiredString(body.subject, "subject", 180);
  const description = requiredString(body.description, "description", 8_000);
  const sourcePage = optionalString(body.sourcePage, 180);
  const sourceUrl = optionalString(body.sourceUrl, 1_000);
  const provider = optionalString(body.provider, 120);
  const connectionId = optionalString(body.connectionId, 160);
  const severity = body.severity === "urgent" ? "urgent" : "normal";
  const diagnostics = asRecord(body.diagnostics);
  const correlationId = optionalString(body.correlationId, 160) ?? `fdw-${request.id}`;
  const organizationId = access.organizationId ?? await businessOrganizationId(business);
  if (!organizationId) throw httpError(409, "This business is not connected to an organization yet");
  const requesterUserId = access.legacyDemo || access.id === "demo-owner" ? null : access.id;
  const inserted = await pool.query<Record<string, unknown>>(
    `insert into support_cases
       (organization_id, business_id, requester_user_id, requester_name, requester_email, subject, category,
        provider, connection_id, source_page, source_url, severity, description, diagnostics, correlation_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     returning *`,
    [organizationId, business.id, requesterUserId, access.name, access.email, subject, category, provider, connectionId, sourcePage, sourceUrl, severity, description, JSON.stringify(diagnostics), correlationId],
  );
  const row = inserted.rows[0];
  await pool.query(
    `insert into support_case_events (case_id, event_type, actor_user_id, body, metadata)
     values ($1, 'case_created', $2, $3, $4)`,
    [row.id, requesterUserId, "Support case created", JSON.stringify({ category, sourcePage, correlationId })],
  );
  const supportCase = { ...row, business_name: business.name, website_url: business.websiteUrl, organization_name: null };
  void notifySuperAdmins({
    subject: `Support case · ${business.name} · ${subject}`,
    text: [
      `A ${severity} support case was opened for ${business.name}.`,
      `Category: ${category}${provider ? ` · ${provider}` : ""}`,
      `Requester: ${access.name} <${access.email}>`,
      `Page: ${sourcePage ?? "Support"}`,
      `Correlation ID: ${correlationId}`,
      `Description: ${description}`,
      `Open the support queue: ${lifecycleAppUrl("/platform/support")}`,
    ].join("\n"),
  }).catch((error) => app.log.warn({ error: error instanceof Error ? error.message : "unknown notification error", businessId: business.id }, "Could not notify super-admins about support case"));
  return reply.code(201).send({ case: supportCasePayload(supportCase, [{ id: randomUUID(), event_type: "case_created", actor_name: access.name, body: "Support case created", created_at: new Date().toISOString() }]) });
});

app.post("/api/v1/demo/:slug/installation-support", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const authUser = await requireFirebaseAuth(request);
  await requireAuthenticatedBusinessOwner(business, request);
  if (!pool) throw httpError(503, "Installation support requires PostgreSQL storage");

  const body = asRecord(request.body);
  const platform = body.platform === "html" ? "custom" : body.platform;
  if (!["wordpress", "wix", "shopify", "squarespace", "custom", "not_sure"].includes(String(platform))) {
    throw httpError(400, "Choose a supported website platform");
  }
  const preferredContactMethod = body.preferredContactMethod === "phone" ? "phone" : body.preferredContactMethod === "email" ? "email" : null;
  if (!preferredContactMethod) throw httpError(400, "preferredContactMethod must be email or phone");
  const requesterName = requiredString(body.name, "name", 120);
  const helpRequest = requiredString(body.helpRequest, "helpRequest", 240);
  const contactValue = requiredString(body.contactValue, "contactValue", 240);
  const message = optionalString(body.message, 4_000);
  const screenshotUrl = optionalString(body.screenshotUrl, 2_000);
  if (screenshotUrl) {
    try {
      const parsed = new URL(screenshotUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      throw httpError(400, "screenshotUrl must be an HTTP or HTTPS URL");
    }
  }

  const organizationId = await businessOrganizationId(business);
  if (!organizationId) throw httpError(409, "This business is not connected to an organization yet");
  const appUser = await pool.query<{ id: string }>("select id from app_users where identity_subject = $1 and status = 'active'", [authUser.identitySubject]);
  const inserted = await pool.query<Record<string, unknown>>(
    `insert into installation_support_requests
       (organization_id, business_id, requester_user_id, requester_name, requester_email, business_name, website_url,
        platform, help_request, preferred_contact_method, contact_value, message, screenshot_url, ownership_status,
        widget_detected, widget_last_loaded_at, widget_load_count)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     returning *`,
    [
      organizationId,
      business.id,
      appUser.rows[0]?.id ?? null,
      requesterName,
      authUser.email,
      business.name,
      business.websiteUrl,
      platform,
      helpRequest,
      preferredContactMethod,
      contactValue,
      message,
      screenshotUrl,
      business.ownershipStatus,
      business.widget.loadCount > 0,
      business.widget.lastLoadedAt,
      business.widget.loadCount,
    ],
  );
  const supportRequest = { ...inserted.rows[0], business_name: business.name, website_url: business.websiteUrl, organization_name: null };
  void notifySuperAdmins({
    subject: `Installation help requested · ${business.name}`,
    text: [
      `A customer requested help installing FrontDeskWise for ${business.name}.`,
      `Website: ${business.websiteUrl}`,
      `Platform: ${platform}`,
      `Requester: ${requesterName} <${authUser.email}>`,
      `Preferred contact: ${preferredContactMethod} · ${contactValue}`,
      `Help needed: ${helpRequest}`,
      message ? `Message: ${message}` : "",
      screenshotUrl ? `Screenshot: ${screenshotUrl}` : "",
      `Open the installation support queue: ${lifecycleAppUrl("/platform/installation-support")}`,
    ].filter(Boolean).join("\n"),
  }).catch((error) => app.log.warn({ error: error instanceof Error ? error.message : "unknown notification error", businessId: business.id }, "Could not notify super-admins about installation support request"));

  return reply.code(201).send({ request: installationSupportRequestPayload(supportRequest) });
});

app.get("/api/v1/demo/:slug/widget/install", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const apiOrigin = (
    process.env.FRONTDESKWISE_PUBLIC_API_ORIGIN
    ?? (process.env.NODE_ENV === "production" ? "https://api.frontdeskwise.com" : `http://localhost:${port}`)
  ).replace(/\/$/, "");
  const widgetOrigin = process.env.FRONTDESKWISE_WIDGET_ORIGIN ?? process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const scriptUrl = process.env.FRONTDESKWISE_WIDGET_URL ?? `${widgetOrigin.replace(/\/$/, "")}/widget.js`;
  const shellUrl = process.env.FRONTDESKWISE_WIDGET_SHELL_URL ?? scriptUrl.replace(/\/widget\.js(?:\?.*)?$/i, "/widget-shell.js");
  const apiAttribute = apiOrigin ? ` data-api="${apiOrigin}"` : "";
  const shellAttribute = shellUrl ? ` data-shell="${shellUrl}"` : "";
  return {
    siteKey: business.widget.siteKey,
    enabled: business.widget.enabled,
    scriptUrl,
    snippet: `<script async src="${scriptUrl}" data-site="${business.widget.siteKey}"${apiAttribute}${shellAttribute}></script>`,
    verification: { lastLoadedAt: business.widget.lastLoadedAt, loadCount: business.widget.loadCount },
  };
});

app.post("/api/v1/demo/:slug/widget/verify", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const detected = Boolean(business.widget.lastLoadedAt && business.widget.loadCount > 0);
  if (detected) {
    const organizationId = await businessOrganizationId(business);
    await queueLifecycleEvent({
      eventType: "WIDGET_INSTALLED",
      eventKey: `widget.installed:${business.id}`,
      organizationId,
      businessId: business.id,
      payload: {
        business_name: business.name,
        dashboard_url: lifecycleAppUrl(`/app/${business.slug}`),
      },
    });
  }
  return {
    verified: detected,
    message: detected
      ? "Widget detected on the website. Installation is live."
      : "No widget load detected yet. Add the snippet to the published website, then try again.",
    verification: { lastLoadedAt: business.widget.lastLoadedAt, loadCount: business.widget.loadCount },
  };
});

app.get("/api/v1/demo/:slug/integrations", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  if (!pool) return { integrations: [] };
  const result = await pool.query<Record<string, unknown>>(
    `select i.id, i.provider, i.display_name, i.connection_status, i.auth_type, i.provider_account_id,
            i.provider_account_name, i.credential_hint, i.last_tested_at, i.last_error,
            count(sr.id)::int as sync_total,
            count(sr.id) filter (where sr.sync_status = 'synced')::int as sync_synced,
            count(sr.id) filter (where sr.sync_status in ('pending', 'retrying'))::int as sync_pending,
            count(sr.id) filter (where sr.sync_status = 'failed')::int as sync_failed
     from crm_integrations i
     left join crm_sync_records sr on sr.integration_id = i.id
     where i.business_id = $1
     group by i.id
     order by i.created_at`,
    [business.id],
  );
  return { integrations: result.rows.map(integrationPayload) };
});

app.post("/api/v1/demo/:slug/integrations/hubspot/connect", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "admin");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "HubSpot OAuth requires PostgreSQL storage");
  if (!hubSpotOAuthConfigured()) throw httpError(503, "HubSpot OAuth is not configured on this environment yet");

  const state = randomBytes(32).toString("base64url");
  const redirectUri = hubSpotOAuthRedirectUri();
  await pool.query("delete from hubspot_oauth_states where expires_at < now() or consumed_at is not null");
  await pool.query(
    `insert into hubspot_oauth_states
       (state_hash, business_id, organization_id, initiating_user_id, initiating_user_type, redirect_uri, expires_at)
     values ($1, $2, $3, $4, $5, $6, now() + interval '10 minutes')`,
    [oauthStateHash(state), business.id, actor.organizationId, actor.id, actor.legacyDemo ? "workspace_user" : "app_user", redirectUri],
  );
  return { authorizationUrl: buildHubSpotAuthorizationUrl(state, redirectUri) };
});

app.get("/api/v1/integrations/hubspot/callback", async (request, reply) => {
  const query = asRecord(request.query);
  const state = optionalString(query.state, 500);
  const code = optionalString(query.code, 4_000);
  if (!pool) throw httpError(503, "HubSpot OAuth requires PostgreSQL storage");
  if (!state) throw httpError(400, "HubSpot OAuth state is missing");

  const client = await pool.connect();
  let stateRow: { business_id: string; business_slug: string; redirect_uri: string } | null = null;
  try {
    await client.query("begin");
    const result = await client.query<{ business_id: string; business_slug: string; redirect_uri: string }>(
      `select hos.business_id, b.slug as business_slug, hos.redirect_uri
       from hubspot_oauth_states hos
       join businesses b on b.id = hos.business_id
       where hos.state_hash = $1 and hos.consumed_at is null and hos.expires_at > now()
       for update`,
      [oauthStateHash(state)],
    );
    if (!result.rowCount) {
      await client.query("rollback");
      throw httpError(400, "HubSpot OAuth state is invalid or expired");
    }
    stateRow = result.rows[0];
    await client.query("update hubspot_oauth_states set consumed_at = now() where state_hash = $1", [oauthStateHash(state)]);
    await client.query("commit");
  } catch (error) {
    try { await client.query("rollback"); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }

  const appRedirect = (status: string) => `${lifecycleAppUrl(`/app/${stateRow!.business_slug}/connections`)}?hubspot=${encodeURIComponent(status)}`;
  const oauthError = optionalString(query.error_description, 300) ?? optionalString(query.error, 120);
  if (oauthError) return reply.redirect(appRedirect("error"));
  if (!code) return reply.redirect(appRedirect("error"));

  try {
    const tokenSet = await exchangeHubSpotAuthorizationCode(code, stateRow.redirect_uri);
    const connection = await createCrmAdapter("hubspot", tokenSet.accessToken).testConnection();
    const credentials = hubSpotCredentialsFromTokenSet(tokenSet);
    const result = await pool.query<Record<string, unknown>>(
      `insert into crm_integrations
         (business_id, provider, display_name, connection_status, auth_type, provider_account_id,
          provider_account_name, provider_scopes, access_token_expires_at, encrypted_credentials, config, last_tested_at, last_error)
       values ($1, 'hubspot', 'HubSpot', 'active', 'oauth', $2, $3, $4, $5, $6, $7, now(), null)
       on conflict (business_id, provider) do update set
         display_name = excluded.display_name,
         connection_status = 'active',
         auth_type = 'oauth',
         provider_account_id = excluded.provider_account_id,
         provider_account_name = excluded.provider_account_name,
         provider_scopes = excluded.provider_scopes,
         access_token_expires_at = excluded.access_token_expires_at,
         encrypted_credentials = excluded.encrypted_credentials,
         config = excluded.config,
         last_tested_at = now(),
         last_error = null,
         updated_at = now()
       returning id`,
      [
        stateRow.business_id,
        connection.portalId,
        connection.accountName,
        credentials.scopes,
        credentials.expiresAt,
        encryptIntegrationCredentials(credentials),
        JSON.stringify({ delivery: "hubspot", idempotency: true, auth: "oauth" }),
      ],
    );
    await queueLeadsForIntegration(await getBusiness(stateRow.business_slug), String(result.rows[0].id));
    void processIntegrationOutbox();
    return reply.redirect(appRedirect("connected"));
  } catch (error) {
    app.log.warn({ businessId: stateRow.business_id, error: integrationErrorMessage(error) }, "HubSpot OAuth callback failed");
    return reply.redirect(appRedirect("error"));
  }
});

app.post("/api/v1/demo/:slug/integrations", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "CRM integrations require PostgreSQL storage");
  if (!integrationEncryptionConfigured()) throw httpError(503, "CRM integrations are not configured on this environment yet");
  const body = asRecord(request.body);
  const provider = optionalString(body.provider, 40) ?? "webhook";
  if (provider !== "webhook" && provider !== "hubspot" && provider !== "jackrabbit") throw httpError(400, "Supported CRM providers are hubspot, jackrabbit, and webhook");
  let encryptedCredentials: string;
  let config: Record<string, unknown>;
  let displayName: string;
  let connectionStatus: "pending" | "active" = "pending";
  let providerAccountId: string | null = null;
  let providerAccountName: string | null = null;
  let storedCredentialHint: string | null = null;
  if (provider === "hubspot") {
    const accessToken = requiredString(body.accessToken, "accessToken", 2_000);
    displayName = optionalString(body.displayName, 120) ?? "HubSpot";
    try {
      await createCrmAdapter("hubspot", accessToken).testConnection();
    } catch {
      throw httpError(502, "HubSpot connection test failed. Check the private app or service key and try again.");
    }
    encryptedCredentials = encryptIntegrationCredentials({ accessToken, authType: "pat" });
    config = { delivery: "hubspot", idempotency: true };
  } else if (provider === "jackrabbit") {
    const apiToken = requiredString(body.apiToken, "apiToken", 4_000);
    displayName = optionalString(body.displayName, 120) ?? "Jackrabbit";
    let connection: Awaited<ReturnType<JackrabbitProvider["verifyConnection"]>>;
    try {
      connection = await jackrabbitProviderForToken(apiToken).verifyConnection();
    } catch {
      throw httpError(502, "Jackrabbit connection failed. Check the Customer API token and try again.");
    }
    if (!connection.id && !connection.name) throw httpError(502, "Jackrabbit connection did not return organization metadata.");
    connectionStatus = "active";
    providerAccountId = connection.id;
    providerAccountName = connection.name;
    storedCredentialHint = credentialHint(apiToken);
    encryptedCredentials = encryptIntegrationCredentials({ apiToken });
    config = { delivery: "jackrabbit", apiVersion: "v1", readOnly: true };
  } else {
    let webhookUrl: string;
    try {
      webhookUrl = validateWebhookUrl(body.webhookUrl);
    } catch (error) {
      throw httpError(400, error instanceof Error ? error.message : "webhookUrl is invalid");
    }
    const signingSecret = optionalString(body.signingSecret, 500) ?? undefined;
    displayName = optionalString(body.displayName, 120) ?? "CRM webhook";
    encryptedCredentials = encryptIntegrationCredentials({ webhookUrl, signingSecret });
    config = { delivery: "webhook", idempotency: true };
  }
  const result = await pool.query<Record<string, unknown>>(
    `insert into crm_integrations
       (business_id, provider, display_name, connection_status, auth_type, provider_account_id,
        provider_account_name, encrypted_credentials, credential_hint, config)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (business_id, provider) do update set
       display_name = excluded.display_name,
       connection_status = excluded.connection_status,
       auth_type = excluded.auth_type,
       provider_account_id = coalesce(excluded.provider_account_id, crm_integrations.provider_account_id),
       provider_account_name = coalesce(excluded.provider_account_name, crm_integrations.provider_account_name),
       encrypted_credentials = excluded.encrypted_credentials,
       credential_hint = coalesce(excluded.credential_hint, crm_integrations.credential_hint),
       config = excluded.config,
       last_error = null,
       last_tested_at = case when excluded.connection_status = 'active' then now() else crm_integrations.last_tested_at end,
       updated_at = now()
     returning id, provider, display_name, connection_status, auth_type, provider_account_id, provider_account_name,
       credential_hint, last_tested_at, last_error,
       0::int as sync_total, 0::int as sync_synced, 0::int as sync_pending, 0::int as sync_failed`,
    [business.id, provider, displayName, connectionStatus, "pat", providerAccountId, providerAccountName, encryptedCredentials, storedCredentialHint, JSON.stringify(config)],
  );
  return reply.code(201).send({ integration: integrationPayload(result.rows[0]), next: connectionStatus === "active" ? "Jackrabbit is connected" : "Test the connection to activate delivery" });
});

app.post("/api/v1/demo/:slug/integrations/:integrationId/test", async (request) => {
  const params = request.params as { slug?: string; integrationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "CRM integrations require PostgreSQL storage");
  const integration = await pool.query<Record<string, unknown>>(
    `select id, provider, auth_type, encrypted_credentials from crm_integrations where id = $1 and business_id = $2`,
    [requiredString(params.integrationId, "integrationId", 80), business.id],
  );
  if (!integration.rowCount) throw httpError(404, "CRM integration not found");
  if (integration.rows[0].provider !== "webhook" && integration.rows[0].provider !== "hubspot" && integration.rows[0].provider !== "jackrabbit") throw httpError(400, "CRM provider is not supported");
  try {
    const encryptedCredentials = integration.rows[0].encrypted_credentials;
    if (typeof encryptedCredentials !== "string" || !encryptedCredentials) throw new Error("CRM credentials are not configured");
    const credentials = decryptIntegrationCredentials(encryptedCredentials);
    let hubSpotConnection: { portalId: string | null; accountName: string | null } | null = null;
    let jackrabbitConnection: { id: string | null; name: string | null } | null = null;
    if (integration.rows[0].provider === "webhook") {
      await sendWebhookEvent(
        credentials,
        { eventId: randomUUID(), eventType: "integration.test", tenant: { id: business.id, slug: business.slug, name: business.name } },
        `integration.test:${integration.rows[0].id}:${Date.now()}`,
      );
    } else if (integration.rows[0].provider === "hubspot") {
      if (!credentials.accessToken) throw new Error("HubSpot credentials are not configured");
      const hubSpotCredentials: HubSpotCredentials = { ...credentials, accessToken: credentials.accessToken };
      const accessToken = await hubSpotAccessTokenForIntegration(String(integration.rows[0].id), hubSpotCredentials);
      hubSpotConnection = await createCrmAdapter("hubspot", accessToken).testConnection();
    } else {
      const resolved = await resolveJackrabbitCredentials(business.id, String(integration.rows[0].id));
      const connection = await jackrabbitProviderForToken(resolved.apiToken).verifyConnection();
      jackrabbitConnection = { id: connection.id, name: connection.name };
    }
    await pool.query(
      `update crm_integrations
       set connection_status = 'active',
           provider_account_id = coalesce($2, provider_account_id),
           provider_account_name = coalesce($3, provider_account_name),
           last_tested_at = now(), last_error = null, updated_at = now()
       where id = $1`,
      [integration.rows[0].id, hubSpotConnection?.portalId ?? jackrabbitConnection?.id ?? null, hubSpotConnection?.accountName ?? jackrabbitConnection?.name ?? null],
    );
    if (integration.rows[0].provider !== "jackrabbit") {
      await pool.query(
        `update integration_outbox
         set status = 'retrying', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
         where integration_id = $1 and status = 'failed'`,
        [integration.rows[0].id],
      );
      await pool.query(
        `update crm_sync_records
         set sync_status = 'retrying', attempts = 0, last_error = null, updated_at = now()
         where integration_id = $1 and sync_status = 'failed'`,
        [integration.rows[0].id],
      );
      await queueLeadsForIntegration(business, String(integration.rows[0].id));
      void processIntegrationOutbox();
    }
  } catch (error) {
    const message = integrationErrorMessage(error);
    await pool.query(
      `update crm_integrations set connection_status = 'error', last_tested_at = now(), last_error = $2, updated_at = now() where id = $1`,
      [integration.rows[0].id, message],
    );
    if (integration.rows[0].provider === "jackrabbit") {
      const primaryAction = business.actions.find((action) => business.primaryActionId === action.id && configuredActionProvider(action) === "jackrabbit");
      if (primaryAction) {
        business.primaryActionId = null;
        await pool.query(
          "update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2",
          [business.id, primaryAction.id],
        );
      }
    }
    throw httpError(502, "CRM connection test failed. Check the endpoint and try again.");
  }
  return { ok: true, status: "active" };
});

app.post("/api/v1/demo/:slug/integrations/:integrationId/retry", async (request) => {
  const params = request.params as { slug?: string; integrationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "CRM integrations require PostgreSQL storage");
  const integrationId = requiredString(params.integrationId, "integrationId", 80);
  const integration = await pool.query("select id from crm_integrations where id = $1 and business_id = $2", [integrationId, business.id]);
  if (!integration.rowCount) throw httpError(404, "CRM integration not found");
  const result = await pool.query(
    `update integration_outbox
     set status = 'retrying', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
     where integration_id = $1 and status in ('failed', 'retrying')`,
    [integrationId],
  );
  await pool.query(
    `update crm_sync_records set sync_status = 'retrying', attempts = 0, last_error = null, updated_at = now()
     where integration_id = $1 and sync_status = 'failed'`,
    [integrationId],
  );
  void processIntegrationOutbox();
  return { ok: true, queued: result.rowCount ?? 0 };
});

app.delete("/api/v1/demo/:slug/integrations/:integrationId", async (request) => {
  const params = request.params as { slug?: string; integrationId?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "CRM integrations require PostgreSQL storage");
  const integrationId = requiredString(params.integrationId, "integrationId", 80);
  const existing = await pool.query<{ provider: string; auth_type: string; encrypted_credentials: string | null }>(
    "select provider, auth_type, encrypted_credentials from crm_integrations where id = $1 and business_id = $2",
    [integrationId, business.id],
  );
  if (!existing.rowCount) throw httpError(404, "CRM integration not found");
  if (existing.rows[0].provider === "hubspot" && existing.rows[0].auth_type === "oauth" && existing.rows[0].encrypted_credentials) {
    try {
      const credentials = decryptIntegrationCredentials(existing.rows[0].encrypted_credentials);
      if (credentials.refreshToken) await revokeHubSpotRefreshToken(credentials.refreshToken);
    } catch (error) {
      app.log.warn({ integrationId, error: integrationErrorMessage(error) }, "HubSpot token revocation failed during disconnect");
    }
  }
  const result = await pool.query(
    "delete from crm_integrations where id = $1 and business_id = $2 returning id",
    [integrationId, business.id],
  );
  if (!result.rowCount) throw httpError(404, "CRM integration not found");
  if (existing.rows[0].provider === "jackrabbit") {
    const primaryAction = business.actions.find((action) => business.primaryActionId === action.id && configuredActionProvider(action) === "jackrabbit");
    if (primaryAction) {
      business.primaryActionId = null;
      await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2", [business.id, primaryAction.id]);
    }
  }
  return { ok: true, integrationId };
});

app.get("/api/v1/demo/:slug/mcp-connections", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  if (!pool) return { connections: [] };
  const result = await pool.query<Record<string, unknown>>(
    `select id, provider, display_name, server_url, protocol_version, connection_status,
            tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error
     from mcp_connections
     where business_id = $1
     order by created_at`,
    [business.id],
  );
  return { connections: result.rows.map(mcpConnectionPayload) };
});

app.post("/api/v1/demo/:slug/mcp-connections", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "MCP connections require PostgreSQL storage");
  if (!integrationEncryptionConfigured()) throw httpError(503, "Secure connection storage is not configured on this environment yet");
  const body = asRecord(request.body);
  const provider = mcpProviderFromValue(body.provider);
  if (!provider) throw httpError(400, "Choose a supported MCP provider");
  const displayName = optionalString(body.displayName, 120) ?? `${provider === "hubspot" ? "HubSpot" : provider === "zapier" ? "Zapier" : provider === "make" ? "Make" : "Custom"} MCP`;
  const serverUrl = requiredString(body.serverUrl, "serverUrl", 2_000);
  const bearerToken = requiredString(body.bearerToken, "bearerToken", 4_000);
  const protocolVersion = optionalString(body.protocolVersion, 40) ?? "2025-06-18";
  let tools: McpTool[];
  try {
    tools = await createMcpClient({ serverUrl, bearerToken, protocolVersion }).listTools();
  } catch (error) {
    throw httpError(502, `Could not connect to this MCP server. ${integrationErrorMessage(error)}`);
  }
  const defaultAllowedTools = toolPermissions(tools)
    .filter((tool) => tool.readOnly && !tool.destructive)
    .map((tool) => tool.name);
  const result = await pool.query<Record<string, unknown>>(
    `insert into mcp_connections
       (business_id, provider, display_name, server_url, encrypted_credentials, protocol_version,
        connection_status, tool_catalog, allowed_tools, last_tested_at, last_error)
     values ($1, $2, $3, $4, $5, $6, 'active', $7, $8, now(), null)
     on conflict (business_id, provider, server_url) do update set
       display_name = excluded.display_name,
       encrypted_credentials = excluded.encrypted_credentials,
       protocol_version = excluded.protocol_version,
       connection_status = 'active',
       tool_catalog = excluded.tool_catalog,
       allowed_tools = excluded.allowed_tools,
       last_tested_at = now(),
       last_error = null,
       updated_at = now()
     returning id, provider, display_name, server_url, protocol_version, connection_status,
       tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error`,
    [business.id, provider, displayName, serverUrl, mcpCredentials(bearerToken), protocolVersion, JSON.stringify(tools), JSON.stringify(defaultAllowedTools)],
  );
  return reply.code(201).send({ connection: mcpConnectionPayload(result.rows[0]), message: "Connected. Read-only tools are enabled; review permissions before using anything else." });
});

app.post("/api/v1/demo/:slug/mcp-connections/:connectionId/test", async (request) => {
  const params = request.params as { slug?: string; connectionId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "MCP connections require PostgreSQL storage");
  const connection = await pool.query<Record<string, unknown>>(
    `select id, provider, display_name, server_url, encrypted_credentials, protocol_version,
            connection_status, tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error
     from mcp_connections where id = $1 and business_id = $2`,
    [requiredString(params.connectionId, "connectionId", 80), business.id],
  );
  if (!connection.rowCount) throw httpError(404, "MCP connection not found");
  const row = connection.rows[0];
  try {
    const tools = await createMcpClient({
      serverUrl: String(row.server_url),
      bearerToken: mcpBearerToken(String(row.encrypted_credentials)),
      protocolVersion: String(row.protocol_version ?? "2025-06-18"),
    }).listTools();
    const names = new Set(tools.map((tool) => tool.name));
    const allowedTools = Array.isArray(row.allowed_tools)
      ? row.allowed_tools.filter((item): item is string => typeof item === "string" && names.has(item))
      : toolPermissions(tools).filter((tool) => tool.readOnly && !tool.destructive).map((tool) => tool.name);
    const updated = await pool.query<Record<string, unknown>>(
      `update mcp_connections
       set connection_status = 'active', tool_catalog = $2, allowed_tools = $3,
           last_tested_at = now(), last_error = null, updated_at = now()
       where id = $1
       returning id, provider, display_name, server_url, protocol_version, connection_status,
         tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error`,
      [row.id, JSON.stringify(tools), JSON.stringify(allowedTools)],
    );
    return { connection: mcpConnectionPayload(updated.rows[0]), message: "Connection is healthy and the tool list is up to date." };
  } catch (error) {
    const message = integrationErrorMessage(error);
    await pool.query(
      `update mcp_connections set connection_status = 'error', last_tested_at = now(), last_error = $2, updated_at = now() where id = $1`,
      [row.id, message],
    );
    throw httpError(502, "MCP connection test failed. Check the server URL and access token.");
  }
});

app.patch("/api/v1/demo/:slug/mcp-connections/:connectionId/tools", async (request) => {
  const params = request.params as { slug?: string; connectionId?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "MCP connections require PostgreSQL storage");
  const body = asRecord(request.body);
  if (!Array.isArray(body.allowedTools)) throw httpError(400, "allowedTools must be an array");
  const requested = body.allowedTools.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean).slice(0, 200);
  const connection = await pool.query<Record<string, unknown>>(
    `select id, provider, display_name, server_url, protocol_version, connection_status,
            tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error
     from mcp_connections where id = $1 and business_id = $2`,
    [requiredString(params.connectionId, "connectionId", 80), business.id],
  );
  if (!connection.rowCount) throw httpError(404, "MCP connection not found");
  const available = new Set(mcpToolsFromValue(connection.rows[0].tool_catalog).map((tool) => tool.name));
  const allowedTools = requested.filter((tool) => available.has(tool));
  const updated = await pool.query<Record<string, unknown>>(
    `update mcp_connections set allowed_tools = $2, updated_at = now()
     where id = $1
     returning id, provider, display_name, server_url, protocol_version, connection_status,
       tool_catalog, allowed_tools, last_tested_at, last_successful_call_at, last_error`,
    [connection.rows[0].id, JSON.stringify(allowedTools)],
  );
  return { connection: mcpConnectionPayload(updated.rows[0]), message: "Tool permissions saved." };
});

app.delete("/api/v1/demo/:slug/mcp-connections/:connectionId", async (request) => {
  const params = request.params as { slug?: string; connectionId?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "MCP connections require PostgreSQL storage");
  const result = await pool.query(
    "delete from mcp_connections where id = $1 and business_id = $2 returning id",
    [requiredString(params.connectionId, "connectionId", 80), business.id],
  );
  if (!result.rowCount) throw httpError(404, "MCP connection not found");
  return { ok: true, connectionId: String(result.rows[0].id) };
});

app.get("/api/v1/demo/:slug/integrations/:integrationId/syncs", async (request) => {
  const params = request.params as { slug?: string; integrationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  if (!pool) return { syncs: [] };
  const result = await pool.query<Record<string, unknown>>(
    `select sr.id, sr.lead_id, sr.sync_status, sr.remote_object_type, sr.remote_object_id, sr.remote_url,
            sr.attempts, sr.last_attempt_at, sr.synced_at, sr.last_error, sr.updated_at,
            l.name, l.email, l.phone, l.intent
     from crm_sync_records sr
     join leads l on l.id = sr.lead_id
     where sr.business_id = $1 and sr.integration_id = $2
     order by sr.updated_at desc limit 100`,
    [business.id, requiredString(params.integrationId, "integrationId", 80)],
  );
  return {
    syncs: result.rows.map((row) => ({
      id: String(row.id),
      leadId: String(row.lead_id),
      status: String(row.sync_status),
      remoteObjectType: String(row.remote_object_type),
      remoteObjectId: typeof row.remote_object_id === "string" ? row.remote_object_id : null,
      remoteUrl: typeof row.remote_url === "string" ? row.remote_url : null,
      attempts: Number(row.attempts),
      lastAttemptAt: row.last_attempt_at ? toIso(row.last_attempt_at) : null,
      syncedAt: row.synced_at ? toIso(row.synced_at) : null,
      lastError: typeof row.last_error === "string" ? row.last_error : null,
      updatedAt: toIso(row.updated_at),
      lead: { id: String(row.lead_id), name: row.name, email: row.email, phone: row.phone, intent: row.intent },
    })),
  };
});

app.get("/api/v1/demo/:slug/team", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireBusinessTeamAccess(business, request, "admin");
  if (!pool) return { members: [], businesses: [{ id: business.id, name: business.name, slug: business.slug }] };
  const organizationId = await businessOrganizationId(business);
  const members = await pool.query<Record<string, unknown>>(
    `select u.id, u.email, u.name, u.status, u.created_at, u.updated_at,
            coalesce(om.role, 'member') as organization_role,
            bm.role as business_role,
            bm.created_at as business_joined_at,
            (select max(created_at) from conversation_events ce where ce.actor_user_id = u.id and ce.business_id = $2) as last_active_at
     from app_users u
     left join organization_members om on om.organization_id = $1 and om.user_id = u.id
     left join business_members bm on bm.business_id = $2 and bm.user_id = u.id
     where om.user_id is not null or bm.user_id is not null
     order by case when om.role = 'owner' then 0 when om.role = 'admin' then 1 else 2 end, u.email`,
    [organizationId, business.id],
  );
  const businessesResult = await pool.query<{ id: string; name: string; slug: string }>(
    "select id, name, slug from businesses where organization_id = $1 order by created_at",
    [organizationId],
  );
  return {
    members: members.rows.map((row) => ({
      id: String(row.id),
      email: String(row.email),
      name: String(row.name ?? ""),
      status: String(row.status),
      role: row.organization_role === "owner" ? "owner" : row.organization_role === "admin" || row.business_role === "admin" ? "admin" : row.business_role === "viewer" || row.organization_role === "viewer" ? "viewer" : "staff",
      businessIds: row.organization_role === "owner" || row.organization_role === "admin" ? businessesResult.rows.map((item) => String(item.id)) : [business.id],
      createdAt: nullableIso(row.created_at),
      updatedAt: nullableIso(row.updated_at),
      lastActiveAt: nullableIso(row.last_active_at),
    })),
    businesses: businessesResult.rows.map((item) => ({ id: String(item.id), name: String(item.name), slug: String(item.slug) })),
  };
});

app.post("/api/v1/demo/:slug/team/invite", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "admin");
  if (!pool) throw httpError(503, "Team invitations require PostgreSQL storage");
  const body = asRecord(request.body);
  const email = optionalString(body.email, 240)?.toLowerCase();
  if (!email || !email.includes("@")) throw httpError(400, "A valid team member email is required");
  const name = optionalString(body.name, 160) ?? email.split("@", 1)[0];
  const role = body.role === "admin" || body.role === "staff" || body.role === "viewer" ? body.role : "staff";
  const organizationId = await businessOrganizationId(business);
  const requestedBusinessIds = Array.isArray(body.businessIds) ? body.businessIds.filter((item): item is string => typeof item === "string") : [business.id];
  const client = await pool.connect();
  let userId = "";
  try {
    await client.query("begin");
    const userResult = await client.query<{ id: string }>(
      `insert into app_users (email, email_normalized, name, status)
       values ($1, $1, $2, 'invited')
       on conflict (email_normalized) do update set name = excluded.name, status = case when app_users.status = 'disabled' then 'invited' else app_users.status end, updated_at = now()
       returning id`,
      [email, name],
    );
    userId = userResult.rows[0].id;
    const validBusinesses = await client.query<{ id: string }>(
      "select id from businesses where organization_id = $1 and id = any($2::uuid[])",
      [organizationId, requestedBusinessIds.length ? requestedBusinessIds : [business.id]],
    );
    if (!validBusinesses.rowCount) throw httpError(400, "Select at least one business for this team member");
    const organizationRole = role === "admin" ? "admin" : role === "viewer" ? "viewer" : "member";
    await client.query(
      `insert into organization_members (organization_id, user_id, role)
       values ($1, $2, $3)
       on conflict (organization_id, user_id) do update set role = excluded.role, updated_at = now()`,
      [organizationId, userId, organizationRole],
    );
    for (const item of validBusinesses.rows) {
      await client.query(
        `insert into business_members (business_id, user_id, role)
         values ($1, $2, $3)
         on conflict (business_id, user_id) do update set role = excluded.role, updated_at = now()`,
        [item.id, userId, role === "admin" ? "admin" : role],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
  await queueLifecycleEvent({
    eventType: "TEAM_INVITED",
    eventKey: `team.invited:${organizationId}:${userId}:${role}`,
    organizationId,
    businessId: business.id,
    recipientUserId: userId,
    recipientEmail: email,
    payload: {
      inviter_name: actor.name,
      business_name: business.name,
      dashboard_url: lifecycleAppUrl(`/app/${business.slug}`),
    },
  });
  return reply.code(201).send({ member: { id: userId, email, name, role, status: "invited", businessIds: requestedBusinessIds }, emailQueued: true });
});

app.patch("/api/v1/demo/:slug/team/:userId", async (request) => {
  const params = request.params as { slug?: string; userId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "admin");
  if (!pool) throw httpError(503, "Team management requires PostgreSQL storage");
  const userId = requiredString(params.userId, "userId", 80);
  const body = asRecord(request.body);
  const role = body.role === "admin" || body.role === "staff" || body.role === "viewer" ? body.role : null;
  if (!role) throw httpError(400, "role must be admin, staff, or viewer");
  const organizationId = await businessOrganizationId(business);
  const target = await pool.query<{ role: string }>(
    "select role from organization_members where organization_id = $1 and user_id = $2",
    [organizationId, userId],
  );
  if (target.rows[0]?.role === "owner") throw httpError(403, "The organization owner cannot be changed here");
  const businessIds = Array.isArray(body.businessIds) ? body.businessIds.filter((item): item is string => typeof item === "string") : [business.id];
  if (actor.role !== "owner" && actor.role !== "admin") throw httpError(403, "Only organization admins can update team access");
  await pool.query("update organization_members set role = $3, updated_at = now() where organization_id = $1 and user_id = $2", [organizationId, userId, role === "admin" ? "admin" : role === "viewer" ? "viewer" : "member"]);
  await pool.query("delete from business_members where user_id = $1 and business_id in (select id from businesses where organization_id = $2)", [userId, organizationId]);
  for (const businessId of businessIds) {
    await pool.query(
      `insert into business_members (business_id, user_id, role)
       select id, $2, $3 from businesses where id = $1 and organization_id = $4
       on conflict (business_id, user_id) do update set role = excluded.role, updated_at = now()`,
      [businessId, userId, role === "admin" ? "admin" : role, organizationId],
    );
  }
  return { ok: true, userId, role, businessIds };
});

app.get("/api/v1/demo/:slug/inbox", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "viewer");
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const status = optionalString(query.status, 40) as ConversationStatus | null;
  const allowedStatuses = new Set<ConversationStatus>(["AI_ACTIVE", "HANDOFF_REQUESTED", "WAITING_FOR_STAFF", "HUMAN_ACTIVE", "AI_ASSISTED", "RESOLVED", "EXPIRED"]);
  if (status && !allowedStatuses.has(status)) throw httpError(400, "Unsupported conversation status filter");
  const assignedTo = optionalString(query.assignedTo, 80);
  const search = optionalString(query.q, 160)?.toLowerCase();
  const requestedPage = Number(query.page ?? 1);
  const requestedLimit = Number(query.limit ?? 50);
  const requestedPageNumber = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1);
  const limit = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 50));
  const filteredConversations = [...business.conversations.values()]
    .filter((conversation) => !status || conversation.status === status)
    .filter((conversation) => !assignedTo || (assignedTo === "unassigned" ? !conversation.assignedUserId : conversation.assignedUserId === assignedTo))
    .filter((conversation) => !search || conversation.messages.some((message) => message.content.toLowerCase().includes(search)) || business.leads.some((lead) => lead.conversationId === conversation.id && [lead.name, lead.email, lead.intent].some((value) => value?.toLowerCase().includes(search))))
    .sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));
  const total = filteredConversations.length;
  const page = Math.min(requestedPageNumber, Math.max(1, Math.ceil(total / limit)));
  const start = (page - 1) * limit;
  const conversations = filteredConversations.slice(start, start + limit);
  const summary = filteredConversations.reduce((result, conversation) => {
    if (conversation.status === "HANDOFF_REQUESTED" || conversation.status === "WAITING_FOR_STAFF") result.needsResponse += 1;
    if (conversation.status === "AI_ACTIVE" || conversation.status === "AI_ASSISTED") result.ai += 1;
    if (conversation.status === "RESOLVED") result.resolved += 1;
    result.unread += conversation.unreadCount ?? 0;
    return result;
  }, { needsResponse: 0, unread: 0, ai: 0, resolved: 0 });
  return {
    actor: { id: actor.id, name: actor.name, role: actor.role },
    conversations: conversations.map((conversation) => inboxConversationPayload(business, conversation)),
    summary,
    pagination: { page, pageSize: limit, total, hasNext: start + conversations.length < total, hasPrevious: page > 1 },
  };
});

app.get("/api/v1/demo/:slug/conversations/:conversationId", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  await requireBusinessTeamAccess(business, request, "viewer");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  let events = business.conversationEvents.filter((event) => event.conversationId === conversation.id);
  let notes = business.internalNotes.filter((note) => note.conversationId === conversation.id);
  if (pool) {
    const [eventResult, noteResult] = await Promise.all([
      pool.query<Record<string, unknown>>("select * from conversation_events where business_id = $1 and conversation_id = $2 order by created_at desc", [business.id, conversation.id]).catch(() => ({ rows: [] as Record<string, unknown>[] })),
      pool.query<Record<string, unknown>>("select n.*, u.name as author_name from internal_notes n join app_users u on u.id = n.author_user_id where n.business_id = $1 and n.conversation_id = $2 order by n.created_at desc", [business.id, conversation.id]).catch(() => ({ rows: [] as Record<string, unknown>[] })),
    ]);
    if (eventResult.rows.length) events = eventResult.rows.map((row) => ({ id: String(row.id), businessId: business.id, conversationId: conversation.id, eventType: String(row.event_type) as ConversationEventType, actorUserId: typeof row.actor_user_id === "string" ? row.actor_user_id : null, actorType: String(row.actor_type) as ConversationEvent["actorType"], metadata: asRecord(row.metadata), createdAt: toIso(row.created_at) }));
    if (noteResult.rows.length) notes = noteResult.rows.map((row) => ({ id: String(row.id), businessId: business.id, conversationId: conversation.id, authorUserId: String(row.author_user_id), authorName: String(row.author_name ?? ""), content: String(row.content), createdAt: toIso(row.created_at), updatedAt: toIso(row.updated_at) }));
  }
  return { conversation: { ...inboxConversationPayload(business, conversation), messages: conversation.messages.filter((message) => message.kind !== "internal_note").map(inboxMessagePayload) }, events, notes };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/read", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  await requireBusinessTeamAccess(business, request, "viewer");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  conversation.unreadCount = 0;
  conversation.updatedAt = new Date().toISOString();
  if (pool) {
    await pool.query(
      "update conversations set unread_count = 0, updated_at = $3 where id = $1 and business_id = $2",
      [conversation.id, business.id, conversation.updatedAt],
    );
  }
  return { ok: true, conversation: conversationStatusPayload(conversation) };
});

app.get("/api/v1/demo/:slug/notifications", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "viewer");
  const limit = Math.max(1, Math.min(100, Number((request.query as Record<string, unknown> | undefined)?.limit ?? 50)));
  if (pool && !actor.legacyDemo) {
    const result = await pool.query<Record<string, unknown>>("select * from notifications where business_id = $1 and user_id = $2 order by created_at desc limit $3", [business.id, actor.id, limit]);
    const unread = await pool.query<{ count: string }>("select count(*)::text as count from notifications where business_id = $1 and user_id = $2 and read_at is null", [business.id, actor.id]);
    return { unreadCount: Number(unread.rows[0]?.count ?? 0), notifications: result.rows.map((row) => ({ id: String(row.id), type: String(row.type), conversationId: typeof row.conversation_id === "string" ? row.conversation_id : null, title: String(row.title), body: String(row.body), readAt: nullableIso(row.read_at), createdAt: toIso(row.created_at) })) };
  }
  const notifications = business.notifications.filter((item) => !item.userId || item.userId === actor.id).slice(0, limit);
  return { unreadCount: notifications.filter((item) => !item.readAt).length, notifications };
});

app.post("/api/v1/demo/:slug/notifications/:notificationId/read", async (request) => {
  const params = request.params as { slug?: string; notificationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "viewer");
  const notificationId = requiredString(params.notificationId, "notificationId", 120);
  if (pool && !actor.legacyDemo) await pool.query("update notifications set read_at = coalesce(read_at, now()) where id = $1 and business_id = $2 and user_id = $3", [notificationId, business.id, actor.id]);
  const notification = business.notifications.find((item) => item.id === notificationId);
  if (notification) notification.readAt = notification.readAt ?? new Date().toISOString();
  return { ok: true };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/takeover", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is closed");
  const now = new Date().toISOString();
  const persistedActorId = actor.legacyDemo ? null : actor.id;
  if ((!pool || actor.legacyDemo)
    && conversation.assignedUserId
    && conversation.assignedUserId !== actor.id
    && actor.role !== "admin"
    && actor.role !== "owner") {
    throw httpError(409, "This conversation is already assigned to another team member");
  }
  if (conversation.status === "HUMAN_ACTIVE" && conversation.assignedUserId === persistedActorId) {
    return { conversation: conversationStatusPayload(conversation), actor: { id: actor.id, name: actor.name, role: actor.role } };
  }
  if (pool && persistedActorId) {
    const client = await pool.connect();
    let alreadyActive = false;
    try {
      await client.query("begin");
      const update = await client.query(
        `update conversations set status = 'HUMAN_ACTIVE', assigned_user_id = $3, assigned_at = $4, human_joined_at = $4, unread_count = 0, last_activity_at = $4, updated_at = $4
         where id = $1 and business_id = $2 and status in ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'WAITING_FOR_STAFF', 'AI_ASSISTED')
           and (assigned_user_id is null or assigned_user_id = $3 or $5 = true)
         returning id`,
        [conversation.id, business.id, persistedActorId, now, actor.role === "admin" || actor.role === "owner"],
      );
      if (!update.rowCount) {
        const current = await client.query<{ status: string; assigned_user_id: string | null }>(
          "select status, assigned_user_id from conversations where id = $1 and business_id = $2 for update",
          [conversation.id, business.id],
        );
        if (current.rows[0]?.status === "HUMAN_ACTIVE" && current.rows[0].assigned_user_id === persistedActorId) alreadyActive = true;
        else throw httpError(409, "The conversation changed before takeover could be completed");
      }
      if (!alreadyActive) {
        await client.query("insert into conversation_assignments (business_id, conversation_id, user_id, assigned_by_user_id) values ($1, $2, $3, $3) on conflict (conversation_id) where status = 'active' do update set user_id = excluded.user_id, assigned_by_user_id = excluded.assigned_by_user_id, assigned_at = now()", [business.id, conversation.id, persistedActorId]);
      }
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    if (alreadyActive) {
      conversation.status = "HUMAN_ACTIVE";
      conversation.assignedUserId = persistedActorId;
      conversation.assignedAt = conversation.assignedAt ?? now;
      conversation.humanJoinedAt = conversation.humanJoinedAt ?? now;
      conversation.unreadCount = 0;
      conversation.updatedAt = now;
      await cancelPendingHandoffReminders(conversation.id);
      return { conversation: conversationStatusPayload(conversation), actor: { id: actor.id, name: actor.name, role: actor.role } };
    }
  }
  conversation.status = "HUMAN_ACTIVE";
  conversation.assignedUserId = persistedActorId;
  conversation.assignedAt = now;
  conversation.humanJoinedAt = now;
  conversation.unreadCount = 0;
  conversation.lastActivityAt = now;
  conversation.updatedAt = now;
  await cancelPendingHandoffReminders(conversation.id);
  await recordConversationEvent(business, conversation, "HUMAN_JOINED", "staff", persistedActorId, { name: actor.name });
  await recordConversationEvent(business, conversation, "STAFF_ASSIGNED", "staff", persistedActorId, { name: actor.name });
  if (!pool || actor.legacyDemo) await persistConversation(business, conversation);
  return { conversation: conversationStatusPayload(conversation), actor: { id: actor.id, name: actor.name, role: actor.role } };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/assign", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "admin");
  if (!pool || actor.legacyDemo) throw httpError(503, "Assignment requires a signed-in team account");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is closed");
  const body = asRecord(request.body);
  const assigneeId = requiredString(body.userId, "userId", 80);
  const member = await pool.query("select 1 from business_members where business_id = $1 and user_id = $2 and role in ('admin', 'staff')", [business.id, assigneeId]);
  if (!member.rowCount) throw httpError(400, "That user is not an active staff member for this business");
  const now = new Date().toISOString();
  await pool.query("update conversation_assignments set status = 'released', released_at = now() where conversation_id = $1 and status = 'active'", [conversation.id]);
  await pool.query("insert into conversation_assignments (business_id, conversation_id, user_id, assigned_by_user_id) values ($1, $2, $3, $4)", [business.id, conversation.id, assigneeId, actor.id]);
  conversation.assignedUserId = assigneeId;
  conversation.assignedAt = now;
  conversation.lastActivityAt = now;
  await persistConversation(business, conversation);
  await recordConversationEvent(business, conversation, "STAFF_ASSIGNED", "staff", actor.id, { assigneeId });
  return { conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/return-to-ai", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is closed");
  if (conversation.status !== "HUMAN_ACTIVE" && conversation.status !== "AI_ASSISTED") throw httpError(409, "This conversation is not in a staff-assisted state");
  if (conversation.assignedUserId && conversation.assignedUserId !== actor.id && actor.role !== "admin" && actor.role !== "owner") throw httpError(403, "Only the assigned team member can return this conversation to AI");
  const now = new Date().toISOString();
  if (pool && !actor.legacyDemo) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const update = await client.query(
        `update conversations
         set status = 'AI_ACTIVE', assigned_user_id = null, assigned_at = null,
             handoff_reason = null, handoff_requested_at = null, handoff_notification_status = null,
             human_joined_at = null, unread_count = 0, last_activity_at = $3, updated_at = $3
         where id = $1 and business_id = $2 and status in ('HUMAN_ACTIVE', 'AI_ASSISTED')
           and (assigned_user_id is null or assigned_user_id = $4 or $5 = true)
         returning id`,
        [conversation.id, business.id, now, actor.id, actor.role === "admin" || actor.role === "owner"],
      );
      if (!update.rowCount) throw httpError(409, "The conversation changed before it could be returned to AI");
      await client.query("update conversation_assignments set status = 'released', released_at = $2 where conversation_id = $1 and status = 'active'", [conversation.id, now]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }
  conversation.status = "AI_ACTIVE";
  conversation.assignedUserId = null;
  conversation.assignedAt = null;
  conversation.handoffReason = null;
  conversation.handoffRequestedAt = null;
  conversation.handoffNotificationStatus = null;
  conversation.humanJoinedAt = null;
  conversation.unreadCount = 0;
  conversation.lastActivityAt = now;
  conversation.updatedAt = now;
  await cancelPendingHandoffReminders(conversation.id);
  if (!pool || actor.legacyDemo) {
    await persistConversation(business, conversation);
  }
  await recordConversationEvent(business, conversation, "RETURNED_TO_AI", "staff", actor.legacyDemo ? null : actor.id);
  return { conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/resolve", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is already closed");
  conversation.status = "RESOLVED";
  conversation.assignedUserId = null;
  conversation.assignedAt = null;
  conversation.resolvedAt = new Date().toISOString();
  conversation.unreadCount = 0;
  conversation.lastActivityAt = conversation.resolvedAt;
  conversation.updatedAt = conversation.resolvedAt;
  await cancelPendingHandoffReminders(conversation.id);
  if (pool && !actor.legacyDemo) await pool.query("update conversation_assignments set status = 'released', released_at = now() where conversation_id = $1 and status = 'active'", [conversation.id]);
  await recordConversationEvent(business, conversation, "CONVERSATION_RESOLVED", "staff", actor.legacyDemo ? null : actor.id);
  await persistConversation(business, conversation);
  return { conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/messages/human", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is closed");
  if (conversation.status !== "HUMAN_ACTIVE") throw httpError(409, "Take over this conversation before replying");
  if (conversation.assignedUserId && conversation.assignedUserId !== actor.id && actor.role !== "admin" && actor.role !== "owner") throw httpError(403, "Only the assigned team member can reply here");
  const body = asRecord(request.body);
  const content = requiredString(body.content, "content", 4_000);
  const clientMessageId = typeof body.clientMessageId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientMessageId.trim()) ? body.clientMessageId.trim() : undefined;
  if (clientMessageId) {
    const existing = conversation.messages.find((message) => message.id === clientMessageId && message.role === "human");
    if (existing) return { message: inboxMessagePayload(existing), conversation: conversationStatusPayload(conversation) };
  }
  const now = new Date().toISOString();
  const message: Message = { id: clientMessageId ?? randomUUID(), role: "human", kind: "message", authorUserId: actor.legacyDemo ? undefined : actor.id, authorName: actor.name, content, createdAt: now };
  conversation.messages.push(message);
  conversation.status = "HUMAN_ACTIVE";
  conversation.unreadCount = 0;
  conversation.lastActivityAt = now;
  conversation.updatedAt = now;
  await persistMessage(conversation, message);
  await persistConversation(business, conversation);
  await recordConversationEvent(business, conversation, "MESSAGE_SENT_BY_HUMAN", "staff", actor.legacyDemo ? null : actor.id, { contentLength: content.length });
  return { message: inboxMessagePayload(message), conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/ai-assist", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  if (conversationIsTerminal(conversation)) throw httpError(409, "This conversation is closed");
  if (conversation.assignedUserId && conversation.assignedUserId !== actor.id && actor.role !== "admin" && actor.role !== "owner") throw httpError(403, "Only the assigned team member can request an AI suggestion");
  const latestVisitorMessage = [...conversation.messages].reverse().find((message) => message.role === "user");
  if (!latestVisitorMessage) throw httpError(400, "There is no visitor question to assist with yet");
  const result = await answerQuestion(business, latestVisitorMessage.content, { recordGap: false });
  conversation.status = "AI_ASSISTED";
  conversation.lastActivityAt = new Date().toISOString();
  await persistConversation(business, conversation);
  return { suggestion: result.answer, grounded: result.grounded, citations: result.citations, conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/notes", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  const actor = await requireBusinessTeamAccess(business, request, "staff");
  if (actor.legacyDemo) throw httpError(503, "Internal notes require a signed-in team account");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const content = requiredString(asRecord(request.body).content, "content", 4_000);
  const note: InternalNote = { id: randomUUID(), businessId: business.id, conversationId: conversation.id, authorUserId: actor.id, authorName: actor.name, content, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  business.internalNotes.unshift(note);
  if (pool) {
    await pool.query("insert into internal_notes (id, business_id, conversation_id, author_user_id, content, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7)", [note.id, business.id, conversation.id, actor.id, content, note.createdAt, note.updatedAt]);
  }
  await recordConversationEvent(business, conversation, "INTERNAL_NOTE_ADDED", "staff", actor.id);
  return { note };
});

app.get("/api/v1/widget/:siteKey/config", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  await recordWidgetLoad(business);
  const publicConfig = {
    siteKey: business.widget.siteKey,
    slug: business.slug,
    business: { name: business.name, location: business.location, websiteUrl: business.websiteUrl },
    agent: business.agentConfig,
  };
  const configVersion = createHash("sha256").update(JSON.stringify(publicConfig.agent)).digest("hex").slice(0, 16);
  const entityTag = `"${configVersion}"`;
  reply.header("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
  reply.header("ETag", entityTag);
  reply.header("X-FrontDeskWise-Config-Version", configVersion);
  if (request.headers["if-none-match"] === entityTag) return reply.code(304).send();
  return reply.send(publicConfig);
});

app.post("/api/v1/widget/:siteKey/telemetry", async (request) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  const event = body.event;
  if (typeof event !== "string" || !conversionEventTypes.has(event as ConversionEventType)) {
    throw httpError(400, "Unsupported conversion event");
  }
  const conversationId = optionalString(body.conversationId, 120);
  if (conversationId) maybeConversation(business, conversationId);
  const flowId = optionalString(body.flowId, 120);
  if (flowId && !business.actions.some((action) => action.id === flowId)) throw httpError(400, "flowId does not belong to this business");
  const metadata = asRecord(body.metadata);
  const boundedMetadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata).slice(0, 20)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") boundedMetadata[key.slice(0, 80)] = typeof value === "string" ? value.slice(0, 240) : value;
  }
  await recordConversionEvent(business, {
    event: event as ConversionEventType,
    conversationId,
    flowId,
    fieldId: optionalString(body.fieldId, 120),
    sourcePage: optionalString(body.sourcePage, 2_000),
    device: optionalString(body.device, 40),
    metadata: boundedMetadata,
    timestamp: optionalString(body.timestamp, 80),
  });
  return { accepted: true };
});

app.post("/api/v1/widget/:siteKey/performance", async (request) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  const events = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
  const sourcePage = optionalString(body.sourcePage, 2_000);
  const device = normalizeTelemetryDevice(body.device);
  const organizationId = await businessOrganizationId(business);
  let accepted = 0;
  await Promise.all(events.map(async (value) => {
    const event = asRecord(value);
    const eventType = typeof event.event === "string" ? event.event : "";
    if (!widgetPerformanceEventTypes.has(eventType)) return;
    const conversationId = optionalString(event.conversationId, 120);
    if (conversationId) maybeConversation(business, conversationId);
    const requestId = optionalString(event.requestId, 160);
    const atMs = typeof event.atMs === "number" && Number.isFinite(event.atMs) ? event.atMs : null;
    const durationMs = typeof event.durationMs === "number" && Number.isFinite(event.durationMs) ? event.durationMs : null;
    const metadata = boundedPerformanceMetrics(event.metadata);
    if (atMs !== null) metadata.atMs = atMs;
    await recordWidgetPerformance(business, {
      event: eventType,
      organizationId,
      conversationId,
      requestId,
      durationMs,
      sourcePage,
      device,
      metrics: metadata,
    });
    accepted += 1;
  }));
  return { accepted };
});

app.post("/api/v1/widget/:siteKey/conversations", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  const conversation = await startConversation(
    business,
    typeof body.sessionId === "string" ? body.sessionId : null,
    { forceNew: body.newConversation === true },
  );
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId, resumed: conversation.messages.length > 0 });
});

app.post("/api/v1/widget/:siteKey/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  let conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  conversation = await conversationForIncomingMessage(business, conversation, optionalString(body.sessionId, 160));
  const question = requiredString(body.question, "question", 1_000);
  const clientMessageId = typeof body.clientMessageId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.clientMessageId.trim())
    ? body.clientMessageId.trim()
    : undefined;
  if (clientMessageId) {
    const existingIndex = conversation.messages.findIndex((message) => message.id === clientMessageId && message.role === "user");
    if (existingIndex >= 0) {
      const existingAnswer = conversation.messages.slice(existingIndex + 1).find((message) => message.role === "assistant");
      const existingFailure = Boolean(existingAnswer && /I found relevant information|I’m having trouble responding right now/i.test(existingAnswer.content));
      return {
        conversationId: conversation.id,
        messageId: clientMessageId,
        assistantMessageId: existingAnswer?.id,
        conversation: conversationStatusPayload(conversation),
        answer: existingAnswer?.content ?? "",
        grounded: existingAnswer?.grounded ?? false,
        citations: existingAnswer?.citations ?? [],
        ...(existingFailure ? {
          quickActions: [{ label: "Try again", question }, knowledgeGapContactAction],
          failure: { kind: "temporary_ai" as const, retryable: true, retrievedEvidence: Boolean(existingAnswer?.citations?.length) },
        } : {}),
      };
    }
  }
  const currentPage = optionalString(body.pageUrl, 2_000) ?? optionalString(body.sourcePage, 2_000);
  const requestReceivedAt = new Date().toISOString();
  const requestStartedAt = performance.now();
  const result = await recordConversationQuestion(business, conversation, question, { currentPage, clientMessageId });
  const userMessageIndex = clientMessageId
    ? conversation.messages.findIndex((message) => message.id === clientMessageId && message.role === "user")
    : -1;
  const assistantMessage = userMessageIndex >= 0
    ? conversation.messages.slice(userMessageIndex + 1).find((message) => message.role === "assistant")
    : undefined;
  void recordWidgetPerformance(business, {
    event: "message_backend",
    conversationId: conversation.id,
    requestId: request.id,
    durationMs: performance.now() - requestStartedAt,
    sourcePage: currentPage,
    metrics: {
      retrieval_ms: result.performance?.retrievalMs ?? null,
      rerank_ms: result.performance?.rerankMs ?? null,
      model_request_started_ms: result.performance?.modelRequestStartedMs ?? null,
      llm_first_token_ms: result.performance?.llmFirstTokenMs ?? null,
      llm_total_ms: result.performance?.llmTotalMs ?? null,
      backend_total_ms: result.performance?.backendTotalMs ?? null,
      request_received_at: requestReceivedAt,
    },
  }).catch((error) => app.log.warn({ error: error instanceof Error ? error.message : "unknown performance telemetry error", requestId: request.id }, "Widget performance telemetry failed"));
  return {
    conversationId: conversation.id,
    messageId: clientMessageId,
    assistantMessageId: assistantMessage?.id,
    conversation: conversationStatusPayload(conversation),
    ...customerAnswerPayload(result),
  };
});

app.get("/api/v1/widget/:siteKey/conversations/:conversationId", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  return {
    conversation: conversationStatusPayload(conversation),
    messages: conversation.messages.filter((message) => message.kind !== "internal_note").map(inboxMessagePayload),
  };
});

app.get("/api/v1/widget/:siteKey/conversations/:conversationId/status", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  return { conversation: conversationStatusPayload(conversation) };
});

app.post("/api/v1/widget/:siteKey/conversations/:conversationId/actions/:actionId/submit", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string; actionId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const body = asRecord(request.body);
  if (business.agentConfig.requireLeadConsent && body.consent !== true) {
    throw httpError(400, "Consent is required before sending your details.");
  }
  const result = await recordActionFormSubmission(
    business,
    conversation,
    requiredString(params.actionId, "actionId", 120),
    asRecord(body.values),
    optionalString(body.pageUrl, 2_000) ?? optionalString(body.sourcePage, 2_000),
  );
  return { conversationId: conversation.id, conversation: conversationStatusPayload(conversation), ...customerAnswerPayload(result) };
});

app.post("/api/v1/widget/:siteKey/leads", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  if (business.agentConfig.requireLeadConsent && body.consent !== true) {
    throw httpError(400, "Consent is required before sending your details.");
  }
  const leadInputValue = leadInput(body, "widget", request);
  const conversation = leadInputValue.conversationId ? maybeConversation(business, leadInputValue.conversationId) : null;
  const lead = await persistLead(business, leadInputValue);
  const created = lead.id === leadInputValue.id;
  const existingIndex = business.leads.findIndex((item) => item.id === lead.id || (lead.idempotencyKey && item.idempotencyKey === lead.idempotencyKey));
  if (existingIndex >= 0) business.leads.splice(existingIndex, 1);
  business.leads.unshift(lead);
  if (conversation && created) {
    conversation.leadCaptured = true;
    conversation.actionTaken = "lead_capture";
    conversation.updatedAt = lead.createdAt;
    await persistConversation(business, conversation);
    await recordConversionEvent(business, {
      event: "LEAD_CAPTURED",
      conversationId: conversation.id,
      metadata: { leadId: lead.id, source: lead.source },
    });
  }
  return reply.code(created ? 201 : 200).send({ lead, deduplicated: !created });
});

app.get("/api/v1/demo/:slug/knowledge-gaps", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const gaps = [...business.knowledgeGaps.values()].sort((left, right) => right.occurrenceCount - left.occurrenceCount);
  // Keep the first clustering pass deterministic and cheap. Intent-aware
  // normalization collapses common wording variants without requiring an
  // embedding request for every row in the owner workspace.
  const synonymMap: Record<string, string> = {
    cost: "pricing",
    costs: "pricing",
    fee: "pricing",
    fees: "pricing",
    price: "pricing",
    prices: "pricing",
    pricing: "pricing",
    amount: "pricing",
    charge: "pricing",
    charges: "pricing",
    much: "pricing",
    appointment: "booking",
    appointments: "booking",
    reserve: "booking",
    reservation: "booking",
    reservations: "booking",
  };
  const clusterKey = (gap: KnowledgeGap): string => {
    const intent = gap.intent ?? classifyQuestionIntent(gap.question);
    const terms = tokenise(gap.question).map((term) => synonymMap[term] ?? term);
    const intentTerms = new Set([intent, "pricing", "booking", "hours", "contact", "location", "services"]);
    const specificTerms = terms.filter((term) => !intentTerms.has(term)).sort();
    // Generic questions in the same intent are usually wording variants
    // ("price?", "what's pricing", "how much does it cost?").
    return `${intent}:${specificTerms.length <= 1 ? "generic" : specificTerms.slice(0, 3).join("|")}`;
  };
  const clusters = new Map<string, KnowledgeGap & { variants: string[] }>();
  for (const gap of gaps) {
    const key = clusterKey(gap);
    const existing = clusters.get(key);
    if (!existing) {
      clusters.set(key, { ...gap, variants: [gap.question] });
      continue;
    }
    existing.occurrenceCount += gap.occurrenceCount;
    existing.lastSeenAt = existing.lastSeenAt > gap.lastSeenAt ? existing.lastSeenAt : gap.lastSeenAt;
    existing.variants.push(gap.question);
    // An unresolved variant keeps the cluster actionable. Resolved and
    // ignored variants only make the cluster complete when every variant is
    // in that same state.
    if (gap.status === "open") existing.status = "open";
  }
  return { gaps: [...clusters.values()].sort((left, right) => right.occurrenceCount - left.occurrenceCount) };
});

app.post("/api/v1/demo/:slug/knowledge-gaps/resolve", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const question = requiredString(body.question, "question", 1_000);
  const approvedAnswer = requiredString(body.approvedAnswer, "approvedAnswer", 4_000);
  const answerMode = body.answerMode === "fixed_response" ? "fixed_response" : "knowledge";
  const questions = Array.isArray(body.questions)
    ? body.questions.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 25)
    : [];
  const targetQuestions = [...new Set([question, ...questions])];
  let result: Awaited<ReturnType<typeof resolveKnowledgeGap>> | null = null;
  for (const targetQuestion of targetQuestions) {
    result = await resolveKnowledgeGap(business, targetQuestion, approvedAnswer, answerMode);
  }
  return result;
});

app.post("/api/v1/demo/:slug/knowledge-gaps/ignore", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const question = requiredString(body.question, "question", 1_000);
  const questions = Array.isArray(body.questions)
    ? body.questions.filter((item): item is string => typeof item === "string" && Boolean(item.trim())).slice(0, 25)
    : [];
  const targetQuestions = [...new Set([question, ...questions])];
  let gap: KnowledgeGap | null = null;
  for (const targetQuestion of targetQuestions) gap = await ignoreKnowledgeGap(business, targetQuestion);
  return { gap };
});

function isKnowledgeEvaluationMessage(message: Message): boolean {
  if (message.role !== "assistant" || !message.retrieval) return false;
  // These are conversation/system events, not evidence about knowledge
  // quality. They intentionally carry deterministic retrieval metadata for
  // observability, but must never enter the owner-facing Quality queue.
  if (["tier0_greeting", "handoff", "action_flow"].includes(message.retrieval.mode)) return false;
  if (["deterministic_greeting", "deterministic_handoff", "deterministic_action_flow"].includes(message.retrieval.reason ?? "")) return false;
  return true;
}

app.get("/api/v1/demo/:slug/retrieval-diagnostics", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const requestedPage = Number(query.page ?? 1);
  const requestedLimit = Number(query.limit ?? 25);
  const pageSize = Math.min(100, Math.max(1, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 25));
  const requestedPageNumber = Math.max(1, Number.isFinite(requestedPage) ? Math.floor(requestedPage) : 1);
  const windowValue = optionalString(query.window, 10) ?? "30";
  const windowDays = windowValue === "7" || windowValue === "30" ? Number(windowValue) : null;
  const cutoff = windowDays === null ? null : Date.now() - windowDays * 24 * 60 * 60 * 1_000;
  const search = optionalString(query.q, 200)?.toLowerCase();
  const status = optionalString(query.status, 40);
  const diagnostics = [...business.conversations.values()]
    .flatMap((conversation) => conversation.messages.map((message, index) => ({ conversation, message, question: conversation.messages[index - 1]?.content })))
    .filter((item) => isKnowledgeEvaluationMessage(item.message) && Boolean(item.question?.trim()))
    .filter((item) => cutoff === null || Date.parse(item.message.createdAt) >= cutoff)
    .filter((item) => !search || item.question?.toLowerCase().includes(search) || item.message.content.toLowerCase().includes(search))
    .filter((item) => status === "grounded" ? item.message.grounded === true
      : status === "fallback" ? item.message.grounded !== true
        : status === "needs_review" ? item.message.grounded !== true || item.message.confidenceBand === "low"
          : true)
    .sort((left, right) => right.message.createdAt.localeCompare(left.message.createdAt))
    .map((item) => ({
      conversationId: item.conversation.id,
      question: item.question ?? "",
      answer: item.message.content,
      grounded: item.message.grounded ?? false,
      confidenceScore: item.message.confidenceScore ?? 0,
      confidenceBand: item.message.confidenceBand ?? "low",
      citations: item.message.citations ?? [],
      retrieval: item.message.retrieval,
      createdAt: item.message.createdAt,
    }));
  const total = diagnostics.length;
  const page = Math.min(requestedPageNumber, Math.max(1, Math.ceil(total / pageSize)));
  const start = (page - 1) * pageSize;
  return {
    diagnostics: diagnostics.slice(start, start + pageSize),
    pagination: { page, pageSize, total, hasNext: start + pageSize < total, hasPrevious: page > 1 },
    windowDays,
  };
});

app.get("/api/v1/demo/:slug/leads", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const query = (request.query as Record<string, unknown> | undefined) ?? {};
  const status = optionalString(query.status, 40)?.toLowerCase();
  if (status && !["new", "qualified", "booked"].includes(status)) throw httpError(400, "Unsupported lead status filter");
  const search = optionalString(query.q, 160)?.toLowerCase();
  const limitValue = Number(query.limit ?? 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitValue) ? limitValue : 100));
  const leads = business.leads
    .filter((lead) => !status || lead.status === status)
    .filter((lead) => !search || [lead.name, lead.email, lead.phone, lead.intent, lead.source].some((value) => value?.toLowerCase().includes(search)))
    .slice(0, limit);
  return { leads };
});

app.patch("/api/v1/demo/:slug/leads/:leadId", async (request) => {
  const params = request.params as { slug?: string; leadId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const leadId = requiredString(params.leadId, "leadId", 120);
  const lead = business.leads.find((item) => item.id === leadId);
  if (!lead) throw httpError(404, "Lead not found");
  const body = asRecord(request.body);
  const statusValue = optionalString(body.status, 40)?.toLowerCase();
  if (statusValue && !["new", "qualified", "booked"].includes(statusValue)) throw httpError(400, "Unsupported lead status");
  const notes = body.notes === null ? "" : optionalString(body.notes, 4_000);
  if (statusValue) lead.status = statusValue as Lead["status"];
  if (body.notes !== undefined) {
    lead.notes = notes ?? "";
    lead.metadata = { ...lead.metadata, notes: lead.notes };
  }
  if (pool) {
    await pool.query(
      `update leads
       set status = $3, metadata = $4::jsonb
       where business_id = $1 and id = $2`,
      [business.id, leadId, lead.status, JSON.stringify(lead.metadata)],
    );
    await pool.query(
      `insert into lead_events (business_id, lead_id, event_type, payload)
       values ($1, $2, 'lead.updated', $3)`,
      [business.id, leadId, JSON.stringify({ status: lead.status, notes: lead.metadata.notes ?? null })],
    );
  }
  return { lead };
});

app.delete("/api/v1/demo/:slug/leads/:leadId", async (request) => {
  const params = request.params as { slug?: string; leadId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const leadId = requiredString(params.leadId, "leadId", 120);
  const index = business.leads.findIndex((item) => item.id === leadId);
  if (index < 0) throw httpError(404, "Lead not found");
  const [lead] = business.leads.splice(index, 1);
  if (pool) await pool.query("delete from leads where id = $1 and business_id = $2", [lead.id, business.id]);
  return { ok: true, leadId: lead.id };
});

async function workflowIsolationForAction(
  business: Business,
  action: ActionFlow,
  rawBody?: Record<string, unknown>,
): Promise<WorkflowIsolationResult> {
  const context = asRecord(rawBody?.workflowContext);
  const requestedContextBusinessId = optionalString(rawBody?.workflowContextBusinessId, 120)
    ?? optionalString(context.businessId, 120)
    ?? null;
  const contextVersionValue = rawBody?.workflowContextVersion ?? context.contextVersion;
  const requestedContextVersion = contextVersionValue === null || contextVersionValue === undefined || contextVersionValue === ""
    ? null
    : Number(contextVersionValue);
  const requestedBusinessId = optionalString(rawBody?.businessId, 120);
  const organizationId = business.organizationId ?? await getBusinessOrganizationId(business);
  const currentProviders = business.actions
    .filter((candidate) => candidate.id !== action.id)
    .flatMap(actionProviderNames);
  currentProviders.push(...business.actionResources.map((resource) => resource.provider));

  let foreignBusinessNames: string[] = [];
  let foreignActionIdentifiers: string[] = [];
  let foreignProviders: string[] = [];
  if (pool && organizationId) {
    try {
      const result = await pool.query<{ business_name: string; action_key: string | null; action_name: string | null; provider: string | null; steps: unknown }>(
        `select b.name as business_name, ba.action_key, ba.name as action_name, ba.provider, ba.steps
         from businesses b
         left join business_actions ba on ba.business_id = b.id
         where b.organization_id = $1 and b.id <> $2`,
        [organizationId, business.id],
      );
      foreignBusinessNames = [...new Set(result.rows.map((row) => row.business_name).filter(Boolean))];
      foreignActionIdentifiers = [...new Set(result.rows.flatMap((row) => [row.action_key, row.action_name].filter((value): value is string => Boolean(value?.trim()))))];
      foreignProviders = [...new Set(result.rows.flatMap((row) => {
        const providers = row.provider ? [row.provider] : [];
        const steps = Array.isArray(row.steps) ? row.steps : [];
        return [...providers, ...steps.flatMap((step) => {
          const config = asRecord(asRecord(step).config);
          return typeof config.provider === "string" ? [config.provider] : [];
        })];
      }))];
    } catch (error) {
      if (!isMissingDatabaseTable(error)) throw error;
      app.log.warn({ businessId: business.id }, "Workflow isolation lookup deferred until the action schema is available");
    }
  }
  return validateWorkflowTenantIsolation(action, {
    businessId: business.id,
    businessName: business.name,
    currentProviders,
    foreignBusinessNames,
    foreignActionIdentifiers,
    foreignProviders,
    requestedBusinessId,
    requestedContextBusinessId,
    requestedContextVersion: Number.isFinite(requestedContextVersion) ? requestedContextVersion : null,
    currentContextVersion: business.businessContextSnapshot?.version ?? null,
  });
}

app.get("/api/v1/demo/:slug/actions", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  // Keep disabled/archived definitions visible to owners so they can restore
  // them; detectAction and the widget runtime still exclude them.
  const configuredActions = business.actions;
  const actions = await Promise.all(configuredActions.map(async (action) => {
    const readiness = await actionReadinessForBusiness(business, action);
    const workflowIsolation = action.steps?.length ? await workflowIsolationForAction(business, action) : { ok: true } as const;
    return {
      ...action,
      readiness,
      isPrimary: business.primaryActionId === action.id && readiness.ready,
      ...(workflowIsolation.ok
        ? {}
        : {
          workflowSafety: { status: "blocked", code: workflowIsolation.code, identifier: workflowIsolation.identifier },
          // Do not expose a known-contaminated workflow. Owners can regenerate
          // it from the active business context and save the clean definition.
          name: `${business.name} workflow`,
          description: "This workflow was blocked because it referenced a different business context. Regenerate it from the active Business Brain.",
          triggerPhrases: [],
          triggerIntents: [],
          provider: null,
          destination: null,
          steps: [],
          fields: [],
          completion: { createLead: false, leadStatus: "new", message: "Regenerate this workflow from the active business context.", notifyStaff: false },
          executionMode: "FORM_FLOW",
        }),
    };
  }));
  if (!pool) return { actions, resources: business.actionResources, templates: ACTION_TEMPLATES, deliveries: [] };
  let deliveries: Array<Record<string, unknown>> = [];
  try {
    const result = await pool.query<Record<string, unknown>>(
      `select ao.id, ao.action_id, ao.connector_provider, ao.status, ao.attempts, ao.last_error, ao.updated_at,
              a.name as action_name
       from action_outbox ao
       join business_actions a on a.id = ao.action_id
       where ao.business_id = $1
       order by ao.updated_at desc limit 100`,
      [business.id],
    );
    deliveries = result.rows;
  } catch (error) {
    if (!isMissingDatabaseTable(error)) throw error;
  }
  return {
    actions,
    resources: business.actionResources,
    templates: ACTION_TEMPLATES,
    deliveries: deliveries.map((row) => ({
      id: String(row.id),
      actionId: String(row.action_id),
      actionName: String(row.action_name),
      provider: String(row.connector_provider),
      status: String(row.status),
      attempts: Number(row.attempts ?? 0),
      lastError: typeof row.last_error === "string" ? row.last_error : null,
      updatedAt: toIso(row.updated_at),
    })),
  };
});

app.post("/api/v1/demo/:slug/action-deliveries/:deliveryId/retry", async (request) => {
  const params = request.params as { slug?: string; deliveryId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  if (!pool) throw httpError(503, "Action delivery retries require PostgreSQL storage");
  const result = await pool.query(
    `update action_outbox
     set status = 'retrying', attempts = 0, next_attempt_at = now(), last_error = null, updated_at = now()
     where id = $1 and business_id = $2 and status in ('failed', 'retrying')
     returning id`,
    [requiredString(params.deliveryId, "deliveryId", 120), business.id],
  );
  if (!result.rowCount) throw httpError(404, "Action delivery not found or already completed");
  void processActionOutbox();
  return { ok: true, deliveryId: String(result.rows[0].id) };
});

app.post("/api/v1/demo/:slug/actions", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  const actorUserId = await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const action = normalizedAction(body);
  const workflowIsolation = action.steps?.length ? await workflowIsolationForAction(business, action, body) : { ok: true } as const;
  if (!workflowIsolation.ok) throw httpError(409, workflowIsolationMessage(workflowIsolation));
  if (business.actions.some((item) => item.key === action.key)) throw httpError(409, "An action with this key already exists");
  business.actions.push(action);
  await persistAction(business, action);
  await recordActionRegistryAudit({
    businessId: business.id,
    actionId: action.id,
    actorUserId,
    actorType: "owner",
    eventType: "created",
    newValue: { origin: action.origin, lifecycleStatus: action.lifecycleStatus, enabled: action.enabled },
  });
  return reply.code(201).send({ action });
});

app.put("/api/v1/demo/:slug/actions/:actionId", async (request) => {
  const params = request.params as { slug?: string; actionId?: string };
  const business = await getBusiness(params.slug);
  const actorUserId = await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const actionIndex = business.actions.findIndex((item) => item.id === requiredString(params.actionId, "actionId", 120));
  if (actionIndex < 0) throw httpError(404, "Action not found");
  const previousAction = business.actions[actionIndex];
  const body = asRecord(request.body);
  const action = normalizedAction(body, previousAction);
  const workflowIsolation = action.steps?.length ? await workflowIsolationForAction(business, action, body) : { ok: true } as const;
  if (!workflowIsolation.ok) throw httpError(409, workflowIsolationMessage(workflowIsolation));
  if (action.origin === "discovered" && action.enabled && action.lifecycleStatus === "needs_review") {
    if (action.confidence < 0.88) throw httpError(400, "This discovered action needs stronger website evidence before it can be enabled");
    if (action.safetyPolicy === "manual_review") throw httpError(400, "This discovered action requires manual review before it can be enabled");
    action.lifecycleStatus = "active";
    action.reviewReason = null;
  }
  const duplicate = business.actions.find((item, index) => index !== actionIndex && item.key === action.key);
  if (duplicate) throw httpError(409, "An action with this key already exists");
  business.actions[actionIndex] = action;
  const readiness = await actionReadinessForBusiness(business, action);
  const primaryActionCleared = business.primaryActionId === action.id && !readiness.ready;
  if (primaryActionCleared) {
    business.primaryActionId = null;
    if (pool) {
      await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2", [business.id, action.id]);
    }
    await recordActionRegistryAudit({
      businessId: business.id,
      actionId: action.id,
      actorUserId,
      actorType: "owner",
      eventType: "primary_cleared",
      previousValue: { primaryActionId: action.id },
      newValue: { primaryActionId: null, readiness },
      reason: "owner_override",
    });
  }
  await persistAction(business, action);
  if (pool && previousAction.key !== action.key) {
    await pool.query("delete from business_actions where business_id = $1 and action_key = $2", [business.id, previousAction.key]);
  }
  await recordActionRegistryAudit({
    businessId: business.id,
    actionId: action.id,
    actorUserId,
    actorType: "owner",
    eventType: "updated",
    previousValue: { enabled: previousAction.enabled, lifecycleStatus: previousAction.lifecycleStatus, primaryActionId: business.primaryActionId },
    newValue: { enabled: action.enabled, lifecycleStatus: action.lifecycleStatus, primaryActionId: business.primaryActionId },
    reason: action.reviewReason,
  });
  return { action, primaryActionCleared };
});

app.post("/api/v1/demo/:slug/actions/:actionId/primary", async (request) => {
  const params = request.params as { slug?: string; actionId?: string };
  const business = await getBusiness(params.slug);
  const actorUserId = await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const actionId = requiredString(params.actionId, "actionId", 120);
  const action = business.actions.find((candidate) => candidate.id === actionId);
  if (!action) throw httpError(404, "Action not found");
  const readiness = await actionReadinessForBusiness(business, action);
  if (!readiness.ready) {
    const message = readiness.reason === "missing_destination"
      ? "Direct-link actions need a destination URL before they can be the primary conversion goal"
      : readiness.reason === "invalid_destination"
        ? "Direct-link actions need a valid http(s) destination URL before they can be the primary conversion goal"
        : readiness.reason === "missing_tracking_key"
          ? "Actions need a tracking key before they can be the primary conversion goal"
          : readiness.reason === "missing_provider_connection"
            ? "Connect and verify the provider before making this provider flow the primary conversion goal"
          : "Only an enabled, approved, ready action can be the primary conversion goal";
    throw httpError(400, message);
  }
  if (action.executionMode === "PROVIDER_FLOW" && configuredActionProvider(action) === "jackrabbit") {
    try {
      await resolveJackrabbitCredentials(business.id);
    } catch {
      throw httpError(400, "Connect and verify Jackrabbit before making this provider flow the primary conversion goal");
    }
  }
  const previousActionId = business.primaryActionId;
  business.primaryActionId = action.id;
  if (pool) await pool.query("update businesses set primary_action_id = $2, updated_at = now() where id = $1", [business.id, action.id]);
  await recordActionRegistryAudit({
    businessId: business.id,
    actionId: action.id,
    actorUserId,
    actorType: "owner",
    eventType: "primary_set",
    previousValue: { primaryActionId: previousActionId },
    newValue: { primaryActionId: action.id, trackingKey: action.trackingKey ?? action.key },
    reason: "owner_override",
  });
  return { businessId: business.id, primaryActionId: action.id };
});

app.delete("/api/v1/demo/:slug/actions/:actionId/primary", async (request) => {
  const params = request.params as { slug?: string; actionId?: string };
  const business = await getBusiness(params.slug);
  const actorUserId = await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const actionId = requiredString(params.actionId, "actionId", 120);
  if (business.primaryActionId !== actionId) return { businessId: business.id, primaryActionId: business.primaryActionId };
  business.primaryActionId = null;
  if (pool) await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1 and primary_action_id = $2", [business.id, actionId]);
  await recordActionRegistryAudit({
    businessId: business.id,
    actionId,
    actorUserId,
    actorType: "owner",
    eventType: "primary_cleared",
    previousValue: { primaryActionId: actionId },
    newValue: { primaryActionId: null },
    reason: "owner_override",
  });
  return { businessId: business.id, primaryActionId: null };
});

app.delete("/api/v1/demo/:slug/actions/:actionId", async (request) => {
  const params = request.params as { slug?: string; actionId?: string };
  const business = await getBusiness(params.slug);
  const actorUserId = await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const actionId = requiredString(params.actionId, "actionId", 120);
  const actionIndex = business.actions.findIndex((item) => item.id === actionId);
  if (actionIndex < 0) throw httpError(404, "Action not found");
  const action = business.actions[actionIndex];
  const archived: ActionFlow = {
    ...action,
    enabled: false,
    lifecycleStatus: "disabled",
    reviewReason: "owner_override",
    version: Math.max(1, (action.version ?? 1) + 1),
    updatedAt: new Date().toISOString(),
  };
  business.actions[actionIndex] = archived;
  if (business.primaryActionId === action.id) {
    business.primaryActionId = null;
    if (pool) await pool.query("update businesses set primary_action_id = null, updated_at = now() where id = $1", [business.id]);
    await recordActionRegistryAudit({
      businessId: business.id,
      actionId: action.id,
      actorUserId,
      actorType: "owner",
      eventType: "primary_cleared",
      previousValue: { primaryActionId: action.id },
      newValue: { primaryActionId: null },
      reason: "owner_override",
    });
  }
  await persistAction(business, archived);
  await recordActionRegistryAudit({
    businessId: business.id,
    actionId: action.id,
    actorUserId,
    actorType: "owner",
    eventType: "disabled",
    previousValue: { enabled: action.enabled, lifecycleStatus: action.lifecycleStatus },
    newValue: { enabled: false, lifecycleStatus: "disabled", reviewReason: "owner_override" },
    reason: "owner_override",
  });
  return { ok: true, actionId, archived: true };
});

app.get("/api/v1/demo/:slug/action-resources", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return { resources: business.actionResources };
});

app.post("/api/v1/demo/:slug/action-resources/resolve", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const body = asRecord(request.body);
  const type = typeof body.type === "string" && (ACTION_RESOURCE_TYPES as readonly string[]).includes(body.type)
    ? body.type as ActionResourceType
    : null;
  if (!type) throw httpError(400, "A supported action resource type is required");
  return resolveAction(business.actionResources, {
    type,
    filters: asRecord(body.filters),
    includeWaitlist: body.includeWaitlist === true,
  });
});

app.post("/api/v1/demo/:slug/action-resources", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const resource = normalizedActionResource(request.body, business.id);
  if (resource.provider === "manual" && !resource.destination?.url) throw httpError(400, "A manual action resource requires a destination URL");
  if (business.actionResources.some((candidate) => candidate.id === resource.id)) throw httpError(409, "An action resource with this id already exists");
  if (resource.providerObjectId && business.actionResources.some((candidate) => candidate.provider === resource.provider && candidate.providerObjectId === resource.providerObjectId)) {
    throw httpError(409, "An action resource with this provider object already exists");
  }
  business.actionResources.push(resource);
  await persistActionResource(business, resource);
  return reply.code(201).send({ resource });
});

app.put("/api/v1/demo/:slug/action-resources/:resourceId", async (request) => {
  const params = request.params as { slug?: string; resourceId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const index = business.actionResources.findIndex((candidate) => candidate.id === requiredString(params.resourceId, "resourceId", 120));
  if (index < 0) throw httpError(404, "Action resource not found");
  const resource = normalizedActionResource(request.body, business.id, business.actionResources[index]);
  if (resource.provider === "manual" && !resource.destination?.url) throw httpError(400, "A manual action resource requires a destination URL");
  const duplicate = business.actionResources.find((candidate, candidateIndex) => candidateIndex !== index
    && resource.providerObjectId
    && candidate.provider === resource.provider
    && candidate.providerObjectId === resource.providerObjectId);
  if (duplicate) throw httpError(409, "An action resource with this provider object already exists");
  business.actionResources[index] = resource;
  await persistActionResource(business, resource);
  return { resource };
});

app.delete("/api/v1/demo/:slug/action-resources/:resourceId", async (request) => {
  const params = request.params as { slug?: string; resourceId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const resourceId = requiredString(params.resourceId, "resourceId", 120);
  const index = business.actionResources.findIndex((candidate) => candidate.id === resourceId);
  if (index < 0) throw httpError(404, "Action resource not found");
  business.actionResources.splice(index, 1);
  if (pool) await pool.query("delete from business_action_resources where business_id = $1 and id = $2", [business.id, resourceId]);
  return { ok: true, resourceId };
});

app.get("/api/v1/demo/:slug/business-facts", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return {
    facts: business.facts,
    conflicts: resolveBusinessFacts(business.facts, {}).conflicts,
  };
});

app.post("/api/v1/demo/:slug/business-facts", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const fact = normalizedBusinessFact(request.body, business.id);
  const duplicate = business.facts.find((candidate) => candidate.kind === fact.kind
    && candidate.subject.toLowerCase() === fact.subject.toLowerCase()
    && candidate.predicate.toLowerCase() === fact.predicate.toLowerCase()
    && candidate.sourceType === fact.sourceType
    && candidate.sourceId === fact.sourceId);
  if (duplicate) throw httpError(409, "A business fact with this source already exists; update it instead");
  business.facts.push(fact);
  await persistBusinessFact(business, fact);
  return reply.code(201).send({ fact, conflicts: resolveBusinessFacts(business.facts, {}).conflicts });
});

app.put("/api/v1/demo/:slug/business-facts/:factId", async (request) => {
  const params = request.params as { slug?: string; factId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const factId = requiredString(params.factId, "factId", 120);
  const index = business.facts.findIndex((candidate) => candidate.id === factId);
  if (index < 0) throw httpError(404, "Business fact not found");
  const fact = normalizedBusinessFact(request.body, business.id, business.facts[index]);
  const duplicate = business.facts.find((candidate, candidateIndex) => candidateIndex !== index
    && candidate.kind === fact.kind
    && candidate.subject.toLowerCase() === fact.subject.toLowerCase()
    && candidate.predicate.toLowerCase() === fact.predicate.toLowerCase()
    && candidate.sourceType === fact.sourceType
    && candidate.sourceId === fact.sourceId);
  if (duplicate) throw httpError(409, "A business fact with this source already exists");
  business.facts[index] = fact;
  await persistBusinessFact(business, fact);
  return { fact, conflicts: resolveBusinessFacts(business.facts, {}).conflicts };
});

app.delete("/api/v1/demo/:slug/business-facts/:factId", async (request) => {
  const params = request.params as { slug?: string; factId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const factId = requiredString(params.factId, "factId", 120);
  const index = business.facts.findIndex((candidate) => candidate.id === factId);
  if (index < 0) throw httpError(404, "Business fact not found");
  business.facts.splice(index, 1);
  if (pool) await pool.query("delete from business_facts where business_id = $1 and id = $2", [business.id, factId]);
  return { ok: true, factId };
});

app.post("/api/v1/demo/:slug/agent-config", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const publish = body.publish === true;
  if (publish) {
    requireVerifiedBusiness(business);
    if (business.widget.loadCount < 1) {
      throw httpError(409, "Install the widget before publishing your AI front desk");
    }
  }
  if (typeof body.assistantName === "string" && body.assistantName.trim()) business.agentConfig.assistantName = body.assistantName.trim().slice(0, 120);
  if (typeof body.welcomeMessage === "string" && body.welcomeMessage.trim()) business.agentConfig.welcomeMessage = body.welcomeMessage.trim().slice(0, 1_000);
  if (["friendly", "professional", "concise", "custom"].includes(String(body.tone))) business.agentConfig.tone = body.tone as AgentConfig["tone"];
  if (typeof body.customToneInstructions === "string") business.agentConfig.customToneInstructions = body.customToneInstructions.trim().slice(0, 600);
  if (typeof body.primaryLanguage === "string" && body.primaryLanguage.trim()) business.agentConfig.primaryLanguage = body.primaryLanguage.trim().slice(0, 80);
  if (["contact_form", "human", "unavailable"].includes(String(body.fallbackBehavior))) business.agentConfig.fallbackBehavior = body.fallbackBehavior as AgentConfig["fallbackBehavior"];
  if (typeof body.humanHandoffEnabled === "boolean") business.agentConfig.humanHandoffEnabled = body.humanHandoffEnabled;
  if (typeof body.widgetColor === "string" && /^#[\da-f]{6}$/i.test(body.widgetColor)) business.agentConfig.widgetColor = body.widgetColor;
  if (typeof body.collectLeads === "boolean") business.agentConfig.collectLeads = body.collectLeads;
  if (typeof body.showBookingAction === "boolean") business.agentConfig.showBookingAction = body.showBookingAction;
  if (typeof body.widgetDefaultMode === "string") business.agentConfig.widgetDefaultMode = normalizedWidgetMode(body.widgetDefaultMode);
  if (typeof body.widgetAllowExpand === "boolean") business.agentConfig.widgetAllowExpand = body.widgetAllowExpand;
  if (Array.isArray(body.widgetQuickActions)) business.agentConfig.widgetQuickActions = normalizedWidgetQuickActions(body.widgetQuickActions, business.name);
  if (body.widgetLogoUrl === null) business.agentConfig.widgetLogoUrl = null;
  if (typeof body.widgetLogoUrl === "string") {
    const logoUrl = body.widgetLogoUrl.trim();
    if (!logoUrl || /^https:\/\//i.test(logoUrl)) business.agentConfig.widgetLogoUrl = logoUrl || null;
  }
  if (["light", "dark", "auto"].includes(String(body.widgetTheme))) business.agentConfig.widgetTheme = body.widgetTheme as AgentConfig["widgetTheme"];
  if (["bottom-right", "bottom-left"].includes(String(body.widgetPosition))) business.agentConfig.widgetPosition = body.widgetPosition as AgentConfig["widgetPosition"];
  if (typeof body.proactiveEnabled === "boolean") business.agentConfig.proactiveEnabled = body.proactiveEnabled;
  if (body.proactiveDelaySeconds !== undefined) business.agentConfig.proactiveDelaySeconds = normalizedProactiveDelay(body.proactiveDelaySeconds);
  if (typeof body.proactiveMessage === "string" && body.proactiveMessage.trim()) business.agentConfig.proactiveMessage = body.proactiveMessage.trim().slice(0, 240);
  if (Array.isArray(body.proactiveTriggers)) business.agentConfig.proactiveTriggers = normalizedProactiveTriggers(body.proactiveTriggers);
  if (body.proactiveBehavior !== undefined) business.agentConfig.proactiveBehavior = normalizedProactiveBehavior(body.proactiveBehavior);
  if (body.proactiveFrequency !== undefined) business.agentConfig.proactiveFrequency = normalizedProactiveFrequency(body.proactiveFrequency);
  if (typeof body.requireLeadConsent === "boolean") business.agentConfig.requireLeadConsent = body.requireLeadConsent;
  if (body.privacyNoticeUrl === null) business.agentConfig.privacyNoticeUrl = null;
  if (typeof body.privacyNoticeUrl === "string") {
    const privacyUrl = body.privacyNoticeUrl.trim();
    if (!privacyUrl || /^https:\/\//i.test(privacyUrl)) business.agentConfig.privacyNoticeUrl = privacyUrl || null;
  }
  if (body.retentionDays !== undefined) business.agentConfig.retentionDays = normalizedRetentionDays(body.retentionDays);
  if (typeof body.showAiDisclosure === "boolean") business.agentConfig.showAiDisclosure = body.showAiDisclosure;
  if (body.citationVisibility !== undefined) business.agentConfig.citationVisibility = normalizedCitationVisibility(body.citationVisibility);
  await persistAgentConfig(business);
  if (publish) {
    business.agentPublishedAt = new Date().toISOString();
    business.publishedAgentConfig = cloneAgentConfig(business.agentConfig);
    await persistPublishedAgentConfig(business);
    if (pool) {
      await pool.query("update businesses set agent_published_at = $2, updated_at = now() where id = $1", [business.id, business.agentPublishedAt]);
    }
  }
  return { agent: business.agentConfig, publishing: agentPublishingPayload(business), publishedAt: business.agentPublishedAt };
});

app.post("/api/v1/demo/:slug/conversations", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const conversation = await startConversation(
    business,
    typeof body.sessionId === "string" ? body.sessionId : null,
    { forceNew: body.newConversation === true },
  );
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  let conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  conversation = await conversationForIncomingMessage(business, conversation, optionalString(body.sessionId, 160));
  const question = requiredString(body.question, "question", 1_000);
  const result = await recordConversationQuestion(business, conversation, question);
  return { conversationId: conversation.id, conversation: conversationStatusPayload(conversation), ...result };
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/actions/:actionId/submit", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string; actionId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const body = asRecord(request.body);
  const result = await recordActionFormSubmission(
    business,
    conversation,
    requiredString(params.actionId, "actionId", 120),
    asRecord(body.values),
    optionalString(body.pageUrl, 2_000) ?? optionalString(body.sourcePage, 2_000),
  );
  return { conversationId: conversation.id, conversation: conversationStatusPayload(conversation), ...result };
});

app.post("/api/v1/demo/:slug/leads", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  const leadInputValue = leadInput(body, "dashboard", request);
  const conversation = leadInputValue.conversationId ? maybeConversation(business, leadInputValue.conversationId) : null;
  const lead = await persistLead(business, leadInputValue);
  const created = lead.id === leadInputValue.id;
  const existingIndex = business.leads.findIndex((item) => item.id === lead.id || (lead.idempotencyKey && item.idempotencyKey === lead.idempotencyKey));
  if (existingIndex >= 0) business.leads.splice(existingIndex, 1);
  business.leads.unshift(lead);
  if (conversation && created) {
    conversation.leadCaptured = true;
    conversation.actionTaken = "lead_capture";
    conversation.updatedAt = lead.createdAt;
    await persistConversation(business, conversation);
    await recordConversionEvent(business, {
      event: "LEAD_CAPTURED",
      conversationId: conversation.id,
      metadata: { leadId: lead.id, source: lead.source },
    });
  }
  return reply.code(created ? 201 : 200).send({ lead, deduplicated: !created });
});

app.post("/api/v1/demo/:slug/actions/booking", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const conversationId = requiredString(asRecord(request.body).conversationId, "conversationId", 120);
  const conversation = maybeConversation(business, conversationId);
  conversation.actionTaken = "booking";
  conversation.updatedAt = new Date().toISOString();
  await persistConversation(business, conversation);
  await recordConversionEvent(business, {
    event: "BOOKING_LINK_OPENED",
    conversationId: conversation.id,
    metadata: { action: "booking" },
  });
  await recordOrganizationUsage(business, "bookings");
  return { ok: true, action: "booking", conversationId };
});

app.setErrorHandler((error, request: FastifyRequest, reply: FastifyReply) => {
  const typedError = error as Error & { statusCode?: unknown };
  const statusCode = typeof typedError.statusCode === "number" ? typedError.statusCode : 500;
  if (statusCode >= 500) app.log.error({ err: error, requestId: request.id }, "Request failed");
  return reply.code(statusCode).send({
    error: statusCode >= 500 ? "Internal server error" : typedError.message,
    requestId: request.id,
  });
});

app.addHook("onClose", async () => {
  clearInterval(retentionCleanupTimer);
  clearInterval(lifecycleBillingTimer);
  await renderedPageAdapter.close();
  await pool?.end();
});

await app.listen({ host, port });
