import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import rawBody from "fastify-raw-body";
import type { PoolClient } from "pg";
import Stripe from "stripe";
import { createPoolFromEnv } from "./database.js";
import { crawlWebsite, normalisePublicUrl, type CrawledPage } from "./crawler.js";
import { chunkDocumentText, extractDocumentText } from "./document-ingestion.js";
import { embedTexts, embeddingDimensions, embeddingModel, embeddingsConfigured, vectorLiteral } from "./embeddings.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
import { generateGroundedAnswer, routeQuestion, type ModelUsage } from "./model-routing.js";
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
  decryptIntegrationCredentials,
  createCrmAdapter,
  encryptIntegrationCredentials,
  integrationEncryptionConfigured,
  sendWebhookEvent,
  validateWebhookUrl,
  type CrmLeadPayload,
} from "./crm.js";

const app = Fastify({ logger: true, trustProxy: true });
app.register(rawBody, { global: false, encoding: "utf8", runFirst: true });
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

function trialEndFromNow(): string {
  return new Date(Date.now() + defaultTrialDays * 24 * 60 * 60 * 1_000).toISOString();
}

function validateProductionConfiguration(): void {
  if ((process.env.NODE_ENV ?? "development").trim().toLowerCase() !== "production") return;
  const missing = [
    ["DATABASE_URL", process.env.DATABASE_URL],
    ["FRONTDESKWISE_CREDENTIAL_KEY", process.env.FRONTDESKWISE_CREDENTIAL_KEY],
    ["OPENAI_API_KEY", process.env.OPENAI_API_KEY],
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

type AgentConfig = {
  assistantName: string;
  welcomeMessage: string;
  widgetColor: string;
  collectLeads: boolean;
  showBookingAction: boolean;
  fallbackMessage: string;
};

type Source = {
  id: string;
  url: string;
  canonicalUrl: string;
  title: string;
  pageType: string;
  contentHash: string;
  lastCrawledAt: string;
};

type KnowledgeChunk = {
  id: string;
  sourceId: string;
  content: string;
  contentHash: string;
  metadata: Record<string, unknown>;
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

type Message = {
  role: "user" | "assistant";
  content: string;
  grounded?: boolean;
  sourceUrl?: string;
  confidenceScore?: number;
  confidenceBand?: "high" | "medium" | "low";
  citations?: Array<{ title: string; url: string; sourceId?: string; chunkId?: string; pageType?: string }>;
  retrieval?: {
    mode: string;
    candidateCount: number;
    topScore?: number;
    route?: string;
    model?: string | null;
    reason?: string;
    latencyMs?: number;
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
  messages: Message[];
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
  createdAt: string;
};

type KnowledgeGap = {
  question: string;
  occurrenceCount: number;
  status: "open" | "resolved";
  approvedAnswer: string | null;
  lastSeenAt: string;
};

type Business = {
  id: string;
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
  sources: Source[];
  chunks: KnowledgeChunk[];
  conversations: Map<string, Conversation>;
  leads: Lead[];
  knowledgeGaps: Map<string, KnowledgeGap>;
  agentConfig: AgentConfig;
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

function isInternalDemoSlug(slug: string): boolean {
  return INTERNAL_DEMO_SLUGS.has(slug);
}

const defaultConfig = (businessName: string): AgentConfig => ({
  assistantName: `${businessName} Assistant`,
  welcomeMessage: "Hi! 👋 I can answer questions from this business's website and help you get started.",
  widgetColor: "#0d6efd",
  collectLeads: true,
  showBookingAction: true,
  fallbackMessage: "I do not have enough information to answer that confidently. I can take your details and have the team follow up.",
});

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number };
  error.statusCode = statusCode;
  return error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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

function optionalString(value: unknown, maxLength: number): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, maxLength) : null;
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
    pool.query<Record<string, unknown>>("select id, email, name from app_users where id = $1 and status = 'active'", [userId]),
    pool.query<Record<string, unknown>>(
      `select o.id, o.name, o.slug, om.role,
              o.billing_mode, o.billing_status, o.plan_key, o.billing_interval,
              o.trial_start_at, o.trial_end_at, o.current_period_start_at,
              o.current_period_end_at, o.grace_end_at, o.billing_provider,
              o.stripe_customer_id, o.stripe_subscription_id, o.stripe_price_id,
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
      `select b.id, b.organization_id, b.name, b.slug, b.website_url, b.is_demo,
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
  for (const row of businessResult.rows) {
    const organizationId = String(row.organization_id);
    const list = businessesByOrganization.get(organizationId) ?? [];
    list.push({
      id: String(row.id),
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
    user: { id: String(userResult.rows[0].id), email: String(userResult.rows[0].email), name: String(userResult.rows[0].name) },
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
    return await authSnapshot(user.id, organizationId);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function leadFromRow(row: Record<string, unknown>): Lead {
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
    metadata: asRecord(row.metadata),
    createdAt: toIso(row.created_at),
  };
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
    pageType: page.pageType,
    contentHash: page.contentHash,
    lastCrawledAt: page.lastCrawledAt,
  }));
  const chunks: KnowledgeChunk[] = input.pages.flatMap((page, index) => page.chunks.map((chunk) => ({
    id: randomUUID(),
    sourceId: sources[index].id,
    content: chunk.content,
    contentHash: chunk.contentHash,
    metadata: chunk.metadata,
  })));

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
    sources,
    chunks,
    conversations: new Map(),
    leads: [],
    knowledgeGaps: new Map(),
    agentConfig: defaultConfig(input.name),
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
    "select count(*)::text as count from knowledge_chunks where business_id = $1 and embedding is null",
    [business.id],
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

  try {
    const pending = await pool.query<{ id: string; content: string }>(
      `select id, content
       from knowledge_chunks
       where business_id = $1 and embedding is null
       order by created_at`,
      [business.id],
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
  } catch (error) {
    const retryDelaySeconds = await markEmbeddingJobRetry(jobId, error);
    if (retryDelaySeconds !== null) {
      setTimeout(() => void processEmbeddingJob(business, jobId), retryDelaySeconds * 1_000);
    }
    app.log.warn({ error: error instanceof Error ? error.message : "unknown embedding error", businessId: business.id, jobId }, "Embedding job attempt failed");
  }
}

async function enqueueAndRunEmbeddingJob(business: Business): Promise<void> {
  const jobId = await enqueueEmbeddingJob(business);
  if (jobId) void processEmbeddingJob(business, jobId);
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
      `insert into businesses (id, name, slug, vertical, website_url, timezone, location,
                              organization_id, billing_mode, is_demo, is_internal_demo, billing_status, plan_key, billing_interval,
                              ownership_status, ownership_verification_method, ownership_verification_token_hash,
                              ownership_verification_expires_at, ownership_verified_at, ownership_verified_by_user_id,
                              trial_ends_at, current_period_ends_at, grace_ends_at, billing_provider,
                              provider_customer_id, provider_subscription_id, public_site_key,
                              widget_enabled, widget_last_loaded_at, widget_load_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
       on conflict (slug) do update set
         name = excluded.name,
         vertical = excluded.vertical,
         website_url = excluded.website_url,
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
        `insert into business_sources (id, business_id, source_url, canonical_url, title, content_type, page_type, crawl_status, content_hash, last_crawled_at)
         values ($1, $2, $3, $4, $5, 'web_page', $6, 'ready', $7, $8)
         on conflict (business_id, content_hash) do update set
           source_url = excluded.source_url,
           canonical_url = excluded.canonical_url,
           title = excluded.title,
           page_type = excluded.page_type,
           crawl_status = excluded.crawl_status,
           last_crawled_at = excluded.last_crawled_at,
           error_message = null
         returning id`,
        [source.id, business.id, source.url, source.canonicalUrl, source.title, source.pageType, source.contentHash, source.lastCrawledAt],
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

    await client.query(
      `insert into agent_configs (business_id, assistant_name, welcome_message, widget_color, collect_leads, show_booking_action, fallback_message)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (business_id) do update set
         assistant_name = excluded.assistant_name,
         welcome_message = excluded.welcome_message,
         widget_color = excluded.widget_color,
         collect_leads = excluded.collect_leads,
         show_booking_action = excluded.show_booking_action,
         fallback_message = excluded.fallback_message,
         updated_at = now()`,
      [
        business.id,
        business.agentConfig.assistantName,
        business.agentConfig.welcomeMessage,
        business.agentConfig.widgetColor,
        business.agentConfig.collectLeads,
        business.agentConfig.showBookingAction,
        business.agentConfig.fallbackMessage,
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
  const [sourceResult, chunkResult, conversationResult, leadResult, gapResult, configResult] = await Promise.all([
    pool.query<Record<string, unknown>>("select * from business_sources where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from knowledge_chunks where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from conversations where business_id = $1 order by created_at", [businessId]),
    pool.query<Record<string, unknown>>("select * from leads where business_id = $1 order by created_at desc", [businessId]),
    pool.query<Record<string, unknown>>("select * from knowledge_gaps where business_id = $1 order by occurrence_count desc", [businessId]),
    pool.query<Record<string, unknown>>("select * from agent_configs where business_id = $1", [businessId]),
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
      role: message.role === "user" ? "user" : "assistant",
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
  const config = configResult.rows[0];
  const loaded: Business = {
    id: businessId,
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
    sources: sourceResult.rows.map((source) => ({
      id: String(source.id),
      url: String(source.source_url),
      canonicalUrl: String(source.canonical_url ?? source.source_url),
      title: String(source.title ?? "Website source"),
      pageType: String(source.page_type ?? "web_page"),
      contentHash: String(source.content_hash ?? ""),
      lastCrawledAt: source.last_crawled_at ? toIso(source.last_crawled_at) : toIso(source.created_at),
    })),
    chunks: chunkResult.rows.map((chunk) => ({
      id: String(chunk.id),
      sourceId: String(chunk.source_id),
      content: String(chunk.content),
      contentHash: String(chunk.content_hash),
      metadata: asRecord(chunk.metadata),
    })),
    conversations: new Map(conversationResult.rows.map((conversation) => {
      const id = String(conversation.id);
      return [id, {
        id,
        sessionId: String(conversation.session_id),
        leadCaptured: Boolean(conversation.lead_captured),
        actionTaken: typeof conversation.action_taken === "string" ? conversation.action_taken : null,
        messages: messagesByConversation.get(id) ?? [],
        createdAt: toIso(conversation.created_at),
        updatedAt: toIso(conversation.updated_at),
      } satisfies Conversation];
    })),
    leads: leadResult.rows.map(leadFromRow),
    knowledgeGaps: new Map(gapResult.rows.map((gap) => [
      String(gap.question).toLowerCase().replace(/\s+/g, " ").trim(),
      {
        question: String(gap.question),
        occurrenceCount: Number(gap.occurrence_count),
        status: gap.status === "resolved" ? "resolved" : "open",
        approvedAnswer: typeof gap.approved_answer === "string" ? gap.approved_answer : null,
        lastSeenAt: toIso(gap.last_seen_at),
      } satisfies KnowledgeGap,
    ])),
    agentConfig: config ? {
      assistantName: String(config.assistant_name),
      welcomeMessage: String(config.welcome_message),
      widgetColor: String(config.widget_color),
      collectLeads: Boolean(config.collect_leads),
      showBookingAction: Boolean(config.show_booking_action),
      fallbackMessage: String(config.fallback_message),
    } : defaultConfig(String(row.name)),
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
  return loaded;
}

async function persistConversation(business: Business, conversation: Conversation): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into conversations (id, business_id, session_id, lead_captured, action_taken, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (id) do update set lead_captured = excluded.lead_captured, action_taken = excluded.action_taken, updated_at = excluded.updated_at`,
    [conversation.id, business.id, conversation.sessionId, conversation.leadCaptured, conversation.actionTaken, conversation.createdAt, conversation.updatedAt],
  );
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
}

async function persistMessage(conversation: Conversation, message: Message): Promise<void> {
  if (!pool) return;
  const retrieval = message.retrieval;
  await pool.query(
    `insert into conversation_messages
       (conversation_id, role, content, grounded, source_url, confidence_score, confidence_band, citations, retrieval,
        model_route, model_name, input_tokens, output_tokens, estimated_cost_usd, model_latency_ms, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
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
      message.createdAt,
    ],
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
  const result = await pool.query<{ occurrence_count: number }>(
    `insert into knowledge_gaps (business_id, question, occurrence_count, status, approved_answer, last_seen_at)
     values ($1, $2, 1, $3, $4, $5)
     on conflict (business_id, question) do update set
       occurrence_count = knowledge_gaps.occurrence_count + 1,
       last_seen_at = excluded.last_seen_at
     returning occurrence_count`,
    [business.id, gap.question, gap.status, gap.approvedAnswer, gap.lastSeenAt],
  );
  gap.occurrenceCount = Number(result.rows[0].occurrence_count);
}

async function resolveKnowledgeGap(business: Business, question: string, approvedAnswer: string): Promise<KnowledgeGap> {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const gap = business.knowledgeGaps.get(key);
  if (!gap) throw httpError(404, "Knowledge gap not found");
  gap.status = "resolved";
  gap.approvedAnswer = approvedAnswer;
  gap.lastSeenAt = new Date().toISOString();
  if (pool) {
    await pool.query(
      `update knowledge_gaps
       set status = 'resolved', approved_answer = $3, last_seen_at = $4
       where business_id = $1 and question = $2`,
      [business.id, gap.question, approvedAnswer, gap.lastSeenAt],
    );
  }
  return gap;
}

async function persistAgentConfig(business: Business): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into agent_configs (business_id, assistant_name, welcome_message, widget_color, collect_leads, show_booking_action, fallback_message)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (business_id) do update set
       assistant_name = excluded.assistant_name,
       welcome_message = excluded.welcome_message,
       widget_color = excluded.widget_color,
       collect_leads = excluded.collect_leads,
       show_booking_action = excluded.show_booking_action,
       fallback_message = excluded.fallback_message,
       updated_at = now()`,
    [business.id, business.agentConfig.assistantName, business.agentConfig.welcomeMessage, business.agentConfig.widgetColor, business.agentConfig.collectLeads, business.agentConfig.showBookingAction, business.agentConfig.fallbackMessage],
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

async function requireDemoOwner(business: Business, request: FastifyRequest): Promise<void> {
  const token = bearerToken(request);
  if (!token) throw httpError(401, "A demo owner access token is required");
  const tokenHash = hashAccessToken(token);

  if (!pool) {
    const session = memoryDemoAccess.get(tokenHash);
    if (!session || session.slug !== business.slug || session.businessId !== business.id || Date.parse(session.expiresAt) <= Date.now()) {
      throw httpError(401, "Demo owner access token is invalid or expired");
    }
    return;
  }

  const demoResult = await pool.query(
    `select 1
     from demo_access_sessions s
     join workspace_users u on u.id = s.user_id
     where s.token_hash = $1 and s.business_id = $2 and s.revoked_at is null
       and s.expires_at > now() and u.status = 'active' and u.role in ('owner', 'admin')`,
    [tokenHash, business.id],
  );
  if (demoResult.rowCount) return;

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

function requireWritableBusiness(business: Business): void {
  const access = billingAccess(business.billing);
  if (!access.allowed) throw httpError(402, "This workspace is read-only until billing is restored");
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
  if (configured?.trim()) return configured.trim();
  const origin = (process.env.WEB_ORIGIN ?? "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");
  return `${origin}/?billing=${kind}`;
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
  if (status === "paused" || status === "unpaid" || status === "canceled") return { status: status === "paused" ? "paused" : "cancelled", graceEndAt: null };
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
    ),
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
     where bp.plan_key = $2 and bp.active = true`,
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

async function updateOrganizationFromStripeSubscription(organizationId: string, subscription: Record<string, unknown>): Promise<void> {
  if (!pool) return;
  const price = asRecord(asRecord(subscription.items).data instanceof Array ? (asRecord(subscription.items).data as unknown[])[0] : null);
  const priceObject = asRecord(price.price);
  const metadata = asRecord(subscription.metadata);
  const statusResult = stripeBillingStatus(String(subscription.status ?? "active"));
  const interval = priceObject.recurring && typeof priceObject.recurring === "object"
    && (priceObject.recurring as { interval?: unknown }).interval === "year" ? "year" : "month";
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `update organizations
       set billing_mode = 'live', billing_status = $2, plan_key = coalesce(nullif($3, ''), plan_key),
           billing_interval = $4, trial_start_at = coalesce(trial_start_at, $5), trial_end_at = $6,
           current_period_start_at = $7, current_period_end_at = $8, grace_end_at = $9,
           billing_provider = 'stripe', stripe_customer_id = $10, stripe_subscription_id = $11,
           stripe_price_id = $12, billing_amount_cents = $13, billing_currency = $14, updated_at = now()
       where id = $1`,
      [
        organizationId,
        statusResult.status,
        stripeMetadataString(metadata, "plan_key", "planKey"),
        interval,
        stripeTimestamp(subscription.trial_start),
        stripeTimestamp(subscription.trial_end),
        stripeTimestamp(subscription.current_period_start),
        stripeTimestamp(subscription.current_period_end),
        statusResult.graceEndAt,
        stripeObjectId(subscription.customer),
        stripeObjectId(subscription.id),
        stripeObjectId(priceObject.id),
        priceObject.unit_amount === null || priceObject.unit_amount === undefined ? null : Number(priceObject.unit_amount),
        typeof priceObject.currency === "string" ? priceObject.currency : "usd",
      ],
    );
    await syncOrganizationBillingToBusinesses(client, organizationId);
    await client.query("commit");
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
    if (result.rowCount) return getBusiness(result.rows[0].slug);
  }
  const business = [...businesses.values()].find((item) => item.widget.siteKey === value);
  if (!business) throw httpError(404, "Widget site key not found");
  return business;
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
        `select id, provider, encrypted_credentials
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
          const adapter = createCrmAdapter("hubspot", credentials.accessToken);
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

function integrationPayload(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    provider: String(row.provider),
    displayName: String(row.display_name),
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

function workspacePayload(business: Business) {
  const conversations = [...business.conversations.values()];
  const leadCount = business.leads.length;
  const gapList = [...business.knowledgeGaps.values()];
  const gapCount = gapList.filter((gap) => gap.status === "open").length;
  const sourceCount = business.sources.length;
  const chunkCount = business.chunks.length;
  const readinessScore = sourceCount === 0
    ? 0
    : Math.max(0, Math.min(100, (sourceCount > 0 ? 40 : 0) + (chunkCount > 0 ? 30 : 0) + Math.max(0, 30 - gapCount * 5)));
  const setupSteps = [
    sourceCount > 0,
    chunkCount > 0,
    Boolean(business.agentConfig.assistantName && business.agentConfig.welcomeMessage),
    Boolean(business.widget.enabled && business.widget.siteKey),
  ];
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
    ownership: {
      status: business.ownershipStatus,
      method: business.ownershipVerificationMethod,
      verifiedAt: business.ownershipVerifiedAt,
    },
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
      openGaps: gapCount,
      readiness: {
        score: readinessScore,
        sources: sourceCount,
        chunks: chunkCount,
        openGaps: gapCount,
      },
    },
    stats: {
      conversations: conversations.length,
      leads: leadCount,
      bookingClicks: conversations.filter((conversation) => conversation.actionTaken === "booking").length,
      unansweredQuestions: gapCount,
      widgetLoads: business.widget.loadCount,
      trend,
      topQuestions,
      actions: gapList.filter((gap) => gap.status === "open").sort((left, right) => right.occurrenceCount - left.occurrenceCount).slice(0, 5).map((gap) => ({
        question: gap.question,
        count: gap.occurrenceCount,
        status: gap.status,
      })),
      setup: {
        completed: setupSteps.filter(Boolean).length,
        total: setupSteps.length,
        percent: Math.round(setupSteps.filter(Boolean).length / setupSteps.length * 100),
      },
    },
  };
}

function publicWorkspacePayload(business: Business) {
  const payload = workspacePayload(business);
  return {
    slug: payload.slug,
    status: payload.status,
    business: payload.business,
    agent: payload.agent,
    knowledge: payload.knowledge,
    stats: payload.stats,
  };
}

function tokenise(value: string): string[] {
  const stopWords = new Set(["a", "an", "and", "are", "can", "class", "classes", "do", "for", "how", "i", "in", "is", "it", "lesson", "lessons", "my", "offer", "offers", "of", "on", "or", "program", "programs", "school", "swim", "swimming", "the", "to", "we", "what", "when", "where", "you"]);
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((token) => token.length > 2 && !stopWords.has(token));
}

function rememberGap(business: Business, question: string): KnowledgeGap {
  const key = question.toLowerCase().replace(/\s+/g, " ").trim();
  const existing = business.knowledgeGaps.get(key);
  const now = new Date().toISOString();
  if (existing) {
    existing.occurrenceCount += 1;
    existing.lastSeenAt = now;
    return existing;
  }
  const gap: KnowledgeGap = { question, occurrenceCount: 1, status: "open", approvedAnswer: null, lastSeenAt: now };
  business.knowledgeGaps.set(key, gap);
  return gap;
}

type RetrievalMatch = { chunk: KnowledgeChunk; score: number; evidenceScore: number };

function memoryRetrieval(business: Business, question: string): { matches: RetrievalMatch[]; mode: string } {
  const tokens = tokenise(question);
  const matches = business.chunks.map((chunk) => {
    const lower = chunk.content.toLowerCase();
    const score = tokens.reduce((total, token) => total + (lower.includes(token) ? 1 : 0), 0);
    return { chunk, score, evidenceScore: tokens.length ? score / tokens.length : 0 };
  }).filter((item) => item.score > 0).sort((left, right) => right.score - left.score).slice(0, 8);
  return { matches, mode: "memory_lexical" };
}

async function databaseRetrieval(business: Business, question: string): Promise<{ matches: RetrievalMatch[]; mode: string } | null> {
  if (!pool) return null;
  try {
    const lexicalQuery = tokenise(question).map((token) => `${token}:*`).join(" | ");
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
        queryVector = (await embedTexts([question]))?.[0] ?? null;
      } catch (error) {
        app.log.warn({ error: error instanceof Error ? error.message : "unknown embedding error" }, "Query embedding skipped");
      }
    }

    const vectorResult = queryVector
      ? await pool.query<Record<string, unknown>>(
        `select id, source_id, content, content_hash, metadata,
                1 - (embedding <=> $2::vector) as vector_score
         from knowledge_chunks
         where business_id = $1 and embedding is not null
         order by embedding <=> $2::vector
         limit 20`,
        [business.id, vectorLiteral(queryVector)],
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

    const matches = [...records.values()].map(({ row, lexicalRank, vectorRank }) => ({
      chunk: {
        id: String(row.id),
        sourceId: String(row.source_id),
        content: String(row.content),
        contentHash: String(row.content_hash),
        metadata: asRecord(row.metadata),
      },
      score: (lexicalRank ? 1 / (60 + lexicalRank) : 0) + (vectorRank ? 1 / (60 + vectorRank) : 0),
      evidenceScore: Math.max(
        Math.min(1, Number(row.lexical_score ?? 0) * 4),
        Math.max(0, Math.min(1, Number(row.vector_score ?? 0))),
      ),
    })).sort((left, right) => right.score - left.score).slice(0, 8);

    return {
      matches,
      mode: vectorResult.rowCount ? "hybrid_rrf" : "postgres_full_text",
    };
  } catch (error) {
    app.log.warn({ error: error instanceof Error ? error.message : "unknown retrieval error", businessId: business.id }, "Database retrieval fell back to memory");
    return null;
  }
}

async function answerQuestion(business: Business, question: string) {
  const existingGap = business.knowledgeGaps.get(question.toLowerCase().replace(/\s+/g, " ").trim());
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
    };
  }
  if (existingGap?.status === "resolved" && existingGap.approvedAnswer) {
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
      answer: existingGap.approvedAnswer,
      grounded: true,
      citations: [],
      knowledgeGap: null,
      confidenceScore: 0.99,
      confidenceBand: "high" as const,
      retrieval: { mode: "approved_answer", candidateCount: 0, topScore: 1, ...modelUsage },
      modelUsage,
    };
  }
  const retrieval = await databaseRetrieval(business, question) ?? memoryRetrieval(business, question);
  const match = retrieval.matches[0];
  const secondMatch = retrieval.matches[1];
  const margin = secondMatch ? Math.min(0.12, Math.max(0, (match?.score ?? 0) - secondMatch.score) * 50) : 0.12;
  const confidenceScore = match
    ? Math.min(0.98, 0.35 + (match.evidenceScore * 0.5) + (retrieval.mode === "hybrid_rrf" ? 0.12 : 0.05) + margin)
    : 0;
  const confidenceBand: "high" | "medium" | "low" = confidenceScore >= 0.78 ? "high" : confidenceScore >= 0.55 ? "medium" : "low";
  const retrievalContract = {
    mode: retrieval.mode,
    candidateCount: retrieval.matches.length,
    topScore: match?.score ?? 0,
  };

  const decision = routeQuestion({
    question,
    hasMatch: Boolean(match),
    confidenceScore,
    candidateCount: retrieval.matches.length,
  });
  const context = retrieval.matches.slice(0, 4).map(({ chunk }) => {
    const source = business.sources.find((item) => item.id === chunk.sourceId);
    return `[${source?.title ?? "Business source"}] ${chunk.content.slice(0, 1_200)}`;
  }).join("\n\n");
  let generated: Awaited<ReturnType<typeof generateGroundedAnswer>> = null;
  if (match && confidenceBand !== "low" && decision.model) {
    try {
      generated = await generateGroundedAnswer({ question, context, decision });
    } catch (error) {
      app.log.warn({ error: error instanceof Error ? error.message : "unknown model error", businessId: business.id, route: decision.route }, "Grounded model answer failed; using extractive fallback");
    }
  }
  const modelUsage: ModelUsage = generated?.usage ?? {
    route: decision.route,
    model: decision.model,
    reason: decision.model ? "extractive_fallback_or_unconfigured" : "llm_not_configured",
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: decision.route === "tier0" ? 0 : null,
    latencyMs: 0,
  };
  const enrichedRetrieval = { ...retrievalContract, ...modelUsage };

  if (!match || confidenceBand === "low") {
    const gap = rememberGap(business, question);
    return {
      answer: business.agentConfig.fallbackMessage,
      grounded: false,
      citations: [],
      knowledgeGap: gap,
      confidenceScore,
      confidenceBand,
      retrieval: enrichedRetrieval,
      modelUsage,
    };
  }

  const citations = retrieval.matches.slice(0, 3).map(({ chunk }) => {
    const source = business.sources.find((item) => item.id === chunk.sourceId);
    return source ? {
      title: source.title,
      url: source.url,
      sourceId: source.id,
      chunkId: chunk.id,
      pageType: source.pageType,
    } : null;
  }).filter((citation): citation is NonNullable<typeof citation> => Boolean(citation)).filter((citation, index, list) => list.findIndex((item) => item.sourceId === citation.sourceId) === index);
  if (generated) {
    return {
      answer: generated.answer,
      grounded: true,
      citations,
      knowledgeGap: null,
      confidenceScore,
      confidenceBand,
      retrieval: enrichedRetrieval,
      modelUsage,
    };
  }

  const source = business.sources.find((item) => item.id === match.chunk.sourceId);
  const excerpt = match.chunk.content.length > 420 ? `${match.chunk.content.slice(0, 417).trim()}…` : match.chunk.content;
  return {
    answer: `Based on ${source?.title ?? "the business website"}: ${excerpt}`,
    grounded: true,
    citations,
    knowledgeGap: null,
    confidenceScore,
    confidenceBand,
    retrieval: enrichedRetrieval,
    modelUsage,
  };
}

function maybeConversation(business: Business, conversationId: string): Conversation {
  const conversation = business.conversations.get(conversationId);
  if (!conversation) throw httpError(404, "Conversation not found");
  return conversation;
}

async function startConversation(business: Business, sessionId: string | null): Promise<Conversation> {
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: randomUUID(),
    sessionId: sessionId?.trim() ? sessionId.trim().slice(0, 160) : randomUUID(),
    leadCaptured: false,
    actionTaken: null,
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  business.conversations.set(conversation.id, conversation);
  await persistConversation(business, conversation);
  await recordOrganizationUsage(business, "conversations");
  return conversation;
}

async function recordConversationQuestion(business: Business, conversation: Conversation, question: string) {
  const result = await answerQuestion(business, question);
  const now = new Date().toISOString();
  const userMessage: Message = { role: "user", content: question, createdAt: now };
  const assistantMessage: Message = {
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
  conversation.messages.push(userMessage, assistantMessage);
  conversation.updatedAt = now;
  await persistMessage(conversation, userMessage);
  await persistMessage(conversation, assistantMessage);
  await persistConversation(business, conversation);
  await recordOrganizationUsage(business, "llm_requests");
  await recordModelUsage(business, result.modelUsage);
  if (result.knowledgeGap) await persistGap(business, result.knowledgeGap);
  return result;
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
await resumeEmbeddingJobs();
void processIntegrationOutbox();

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
  if (metadataOrganizationId) return metadataOrganizationId;
  const customerId = stripeObjectId(object.customer);
  const subscriptionId = stripeObjectId(object.subscription) ?? stripeObjectId(object.id);
  const result = await pool.query<{ id: string }>(
    `select id from organizations
     where ($1::text is not null and stripe_customer_id = $1)
        or ($2::text is not null and stripe_subscription_id = $2)
     order by created_at limit 1`,
    [customerId, subscriptionId],
  );
  return result.rows[0]?.id ?? null;
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
  const inserted = await pool.query<{ id: string }>(
    `insert into billing_events (organization_id, provider, event_id, event_type, livemode, payload)
     values ($1, 'stripe', $2, $3, $4, $5)
     on conflict (provider, event_id) do nothing
     returning id`,
    [organizationId, event.id, event.type, event.livemode, JSON.stringify(event)],
  );
  if (!inserted.rowCount) {
    const existing = await pool.query<{ processed_at: string | null }>(
      "select processed_at from billing_events where provider = 'stripe' and event_id = $1",
      [event.id],
    );
    if (existing.rows[0]?.processed_at) return;
  }

  let resolvedOrganizationId = organizationId;
  if (event.type === "checkout.session.completed") {
    const customerId = stripeObjectId(object.customer);
    const subscriptionId = stripeObjectId(object.subscription);
    const metadata = asRecord(object.metadata);
    if (resolvedOrganizationId && customerId) {
      await pool.query(
        `update organizations
         set billing_mode = 'live', billing_status = 'active', billing_provider = 'stripe',
             stripe_customer_id = $2, stripe_subscription_id = $3,
             plan_key = coalesce(nullif($4, ''), plan_key), updated_at = now()
         where id = $1`,
        [resolvedOrganizationId, customerId, subscriptionId, stripeMetadataString(metadata, "plan_key", "planKey")],
      );
    }
    if (subscriptionId && stripe) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (resolvedOrganizationId) await updateOrganizationFromStripeSubscription(resolvedOrganizationId, subscription as unknown as Record<string, unknown>);
    }
  } else if (event.type.startsWith("customer.subscription.")) {
    if (resolvedOrganizationId) await updateOrganizationFromStripeSubscription(resolvedOrganizationId, object);
  } else if (event.type === "invoice.paid") {
    const subscriptionId = stripeObjectId(object.subscription);
    if (subscriptionId && stripe) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      resolvedOrganizationId ??= await findOrganizationIdForStripeEvent(subscription as unknown as Record<string, unknown>);
      if (resolvedOrganizationId) await updateOrganizationFromStripeSubscription(resolvedOrganizationId, subscription as unknown as Record<string, unknown>);
    } else if (resolvedOrganizationId) {
      await pool.query("update organizations set billing_status = 'active', grace_end_at = null, updated_at = now() where id = $1", [resolvedOrganizationId]);
    }
  } else if (event.type === "invoice.payment_failed" && resolvedOrganizationId) {
    await pool.query(
      `update organizations
       set billing_status = 'grace', grace_end_at = $2, billing_provider = 'stripe', updated_at = now()
       where id = $1`,
      [resolvedOrganizationId, new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString()],
    );
    const client = await pool.connect();
    try {
      await syncOrganizationBillingToBusinesses(client, resolvedOrganizationId);
    } finally {
      client.release();
    }
  }

  await pool.query("update billing_events set organization_id = coalesce(organization_id, $2), processed_at = now() where provider = 'stripe' and event_id = $1", [event.id, resolvedOrganizationId]);
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
  reply.header("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
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
  objectStorageConfigured: storageConfigured(),
  emailConfigured: sesConfigured(),
}));

app.get("/ready", async (_request, reply) => {
  if (!pool) return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_not_configured" });
  try {
    await pool.query("select 1");
    return {
      ok: true,
      service: "frontdeskwise-api",
      database: "ready",
      objectStorageConfigured: storageConfigured(),
      emailConfigured: sesConfigured(),
    };
  } catch {
    return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_unavailable" });
  }
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
  return { url: session.url };
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

app.get("/api/v1/admin/organizations", async (request) => {
  await requireSuperAdmin(request);
  if (!pool) throw httpError(503, "Admin access requires PostgreSQL storage");
  const result = await pool.query<Record<string, unknown>>(
    `select o.id, o.name, o.slug, o.billing_mode, o.billing_status, o.plan_key,
            o.trial_end_at, o.current_period_end_at, o.billing_amount_cents, o.billing_currency,
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
      trialEndAt: nullableIso(row.trial_end_at), currentPeriodEndAt: nullableIso(row.current_period_end_at),
      conversationCount: Number(row.conversation_count ?? 0), leadCount: Number(row.lead_count ?? 0),
      lastActiveAt: nullableIso(row.last_active_at),
    })),
  };
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
            opo.reason as override_reason
     from organizations o
     left join billing_plans bp on bp.plan_key = o.plan_key
     left join organization_plan_overrides opo on opo.organization_id = o.id and (opo.ends_at is null or opo.ends_at > now())
     where o.id = $1`,
    [organizationId],
  );
  if (!result.rowCount) throw httpError(404, "Organization not found");
  const businessesResult = await pool.query<Record<string, unknown>>("select id, name, slug, website_url, updated_at from businesses where organization_id = $1 order by created_at", [organizationId]);
  const owners = await pool.query<{ email: string; name: string; role: string }>(
    `select u.email, u.name, om.role from organization_members om join app_users u on u.id = om.user_id where om.organization_id = $1 order by om.role, u.email`,
    [organizationId],
  );
  return {
    organization: { id: organizationId, name: String(result.rows[0].name), slug: String(result.rows[0].slug), billing: organizationBillingPayload(result.rows[0]) },
    owners: owners.rows,
    businesses: businessesResult.rows.map((business) => ({ id: String(business.id), name: String(business.name), slug: String(business.slug), websiteUrl: String(business.website_url), updatedAt: nullableIso(business.updated_at) })),
  };
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
  const businessCount = await pool.query<{ count: string }>("select count(*)::text as count from businesses where organization_id = $1", [organizationResult.rows[0].id]);
  if (Number(businessCount.rows[0].count) >= Number(organizationBilling.max_businesses ?? 1)) {
    throw httpError(402, "Your current plan has reached its business limit. Upgrade to add another business.");
  }

  const crawled = await crawlWebsite(websiteUrl);
  const firstPage = crawled.pages[0];
  const name = businessNameFromTitle(firstPage.title, websiteUrl);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  while (businesses.has(slug) || (pool && await loadBusinessFromDatabase(slug))) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
  const business = makeBusiness({ name, slug, websiteUrl, pages: crawled.pages });
  business.billing = { ...business.billing, mode: "live", isDemo: false, status: "trial", planKey: "starter", trialEndsAt: trialEndFromNow() };
  businesses.set(slug, business);
  await persistBusiness(business, organizationResult.rows[0].id);
  await pool.query(
    `insert into business_members (business_id, user_id, role)
     values ($1, $2, 'admin')
     on conflict (business_id, user_id) do update set role = 'admin', updated_at = now()`,
    [business.id, userResult.rows[0].id],
  );
  return reply.code(201).send({ business: workspacePayload(business), auth: await authSnapshot(userResult.rows[0].id, organizationResult.rows[0].id) });
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
    const crawled = await crawlWebsite(websiteUrl);
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
    const { sessionId: _sessionId, ...publicAccess } = access;
    return {
      ...workspacePayload(business),
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
    workspace: workspacePayload(business),
  };
});

app.get("/api/v1/demo-catalog", async () => ({
  demos: [...businesses.values()]
    .filter((business) => isInternalDemoSlug(business.slug))
    .map(publicWorkspacePayload),
}));

app.get("/api/v1/demo/:slug/public", async (request) => {
  const params = request.params as { slug?: string };
  const slug = requiredString(params.slug, "slug", 120);
  if (!isInternalDemoSlug(slug)) throw httpError(404, "Public demo workspace not found");
  const business = await getBusiness(slug);
  return publicWorkspacePayload(business);
});

app.get("/api/v1/demo/:slug", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return workspacePayload(business);
});

app.get("/api/v1/demo/:slug/knowledge/embedding-status", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  if (!pool) return { configured: false, status: "memory", embeddedChunks: 0, totalChunks: business.chunks.length, job: null };
  const [counts, latest] = await Promise.all([
    pool.query<{ total: string; embedded: string }>(
      `select count(*)::text as total, count(*) filter (where embedding is not null)::text as embedded
       from knowledge_chunks where business_id = $1`,
      [business.id],
    ),
    pool.query<Record<string, unknown>>(
      `select id, status, model, attempts, max_attempts, total_chunks, embedded_chunks, next_attempt_at, started_at, completed_at, last_error
       from embedding_jobs where business_id = $1 order by created_at desc limit 1`,
      [business.id],
    ),
  ]);
  return {
    configured: embeddingsConfigured(),
    status: embeddingsConfigured() ? "available" : "not_configured",
    totalChunks: Number(counts.rows[0].total),
    embeddedChunks: Number(counts.rows[0].embedded),
    job: latest.rows[0] ? {
      id: String(latest.rows[0].id),
      status: String(latest.rows[0].status),
      model: String(latest.rows[0].model),
      attempts: Number(latest.rows[0].attempts),
      maxAttempts: Number(latest.rows[0].max_attempts),
      totalChunks: Number(latest.rows[0].total_chunks),
      embeddedChunks: Number(latest.rows[0].embedded_chunks),
      nextAttemptAt: latest.rows[0].next_attempt_at ? toIso(latest.rows[0].next_attempt_at) : null,
      startedAt: latest.rows[0].started_at ? toIso(latest.rows[0].started_at) : null,
      completedAt: latest.rows[0].completed_at ? toIso(latest.rows[0].completed_at) : null,
      lastError: typeof latest.rows[0].last_error === "string" ? latest.rows[0].last_error : null,
    } : null,
  };
});

app.post("/api/v1/demo/:slug/knowledge/reindex", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  if (!pool || !embeddingsConfigured()) throw httpError(503, "Embedding jobs require OPENAI_API_KEY in the API environment");
  const jobId = await enqueueEmbeddingJob(business);
  if (!jobId) return { status: "succeeded", message: "All knowledge chunks already have embeddings" };
  void processEmbeddingJob(business, jobId);
  return { status: "queued", jobId, model: embeddingModel() };
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

app.get("/api/v1/demo/:slug/widget/install", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const apiOrigin = (process.env.FRONTDESKWISE_PUBLIC_API_ORIGIN ?? `http://localhost:${port}`).replace(/\/$/, "");
  const widgetOrigin = process.env.FRONTDESKWISE_WIDGET_ORIGIN ?? process.env.WEB_ORIGIN ?? "http://localhost:5173";
  const scriptUrl = process.env.FRONTDESKWISE_WIDGET_URL ?? `${widgetOrigin.replace(/\/$/, "")}/widget.js`;
  const apiAttribute = apiOrigin ? ` data-api="${apiOrigin}"` : "";
  return {
    siteKey: business.widget.siteKey,
    enabled: business.widget.enabled,
    scriptUrl,
    snippet: `<script async src="${scriptUrl}" data-site="${business.widget.siteKey}"${apiAttribute}></script>`,
    verification: { lastLoadedAt: business.widget.lastLoadedAt, loadCount: business.widget.loadCount },
  };
});

app.get("/api/v1/demo/:slug/integrations", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  if (!pool) return { integrations: [] };
  const result = await pool.query<Record<string, unknown>>(
    `select i.id, i.provider, i.display_name, i.connection_status, i.last_tested_at, i.last_error,
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
  if (provider !== "webhook" && provider !== "hubspot") throw httpError(400, "Supported CRM providers are hubspot and webhook");
  let encryptedCredentials: string;
  let config: Record<string, unknown>;
  let displayName: string;
  if (provider === "hubspot") {
    const accessToken = requiredString(body.accessToken, "accessToken", 2_000);
    displayName = optionalString(body.displayName, 120) ?? "HubSpot";
    try {
      await createCrmAdapter("hubspot", accessToken).testConnection();
    } catch {
      throw httpError(502, "HubSpot connection test failed. Check the private app or service key and try again.");
    }
    encryptedCredentials = encryptIntegrationCredentials({ accessToken });
    config = { delivery: "hubspot", idempotency: true };
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
    `insert into crm_integrations (business_id, provider, display_name, connection_status, encrypted_credentials, config)
     values ($1, $2, $3, 'pending', $4, $5)
     on conflict (business_id, provider) do update set
       display_name = excluded.display_name,
       connection_status = 'pending',
       encrypted_credentials = excluded.encrypted_credentials,
       config = excluded.config,
       last_error = null,
       updated_at = now()
     returning id, provider, display_name, connection_status, last_tested_at, last_error,
       0::int as sync_total, 0::int as sync_synced, 0::int as sync_pending, 0::int as sync_failed`,
    [business.id, provider, displayName, encryptedCredentials, JSON.stringify(config)],
  );
  return reply.code(201).send({ integration: integrationPayload(result.rows[0]), next: "Test the connection to activate delivery" });
});

app.post("/api/v1/demo/:slug/integrations/:integrationId/test", async (request) => {
  const params = request.params as { slug?: string; integrationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  if (!pool) throw httpError(503, "CRM integrations require PostgreSQL storage");
  const integration = await pool.query<Record<string, unknown>>(
    `select id, provider, encrypted_credentials from crm_integrations where id = $1 and business_id = $2`,
    [requiredString(params.integrationId, "integrationId", 80), business.id],
  );
  if (!integration.rowCount) throw httpError(404, "CRM integration not found");
  if (integration.rows[0].provider !== "webhook" && integration.rows[0].provider !== "hubspot") throw httpError(400, "CRM provider is not supported");
  try {
    const encryptedCredentials = integration.rows[0].encrypted_credentials;
    if (typeof encryptedCredentials !== "string" || !encryptedCredentials) throw new Error("CRM credentials are not configured");
    const credentials = decryptIntegrationCredentials(encryptedCredentials);
    if (integration.rows[0].provider === "webhook") {
      await sendWebhookEvent(
        credentials,
        { eventId: randomUUID(), eventType: "integration.test", tenant: { id: business.id, slug: business.slug, name: business.name } },
        `integration.test:${integration.rows[0].id}:${Date.now()}`,
      );
    } else {
      if (!credentials.accessToken) throw new Error("HubSpot credentials are not configured");
      await createCrmAdapter("hubspot", credentials.accessToken).testConnection();
    }
    await pool.query(
      `update crm_integrations set connection_status = 'active', last_tested_at = now(), last_error = null, updated_at = now() where id = $1`,
      [integration.rows[0].id],
    );
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
  } catch (error) {
    const message = integrationErrorMessage(error);
    await pool.query(
      `update crm_integrations set connection_status = 'error', last_tested_at = now(), last_error = $2, updated_at = now() where id = $1`,
      [integration.rows[0].id, message],
    );
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

app.get("/api/v1/widget/:siteKey/config", async (request) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  await recordWidgetLoad(business);
  return {
    siteKey: business.widget.siteKey,
    slug: business.slug,
    business: { name: business.name, location: business.location, websiteUrl: business.websiteUrl },
    agent: business.agentConfig,
  };
});

app.post("/api/v1/widget/:siteKey/conversations", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
  const conversation = await startConversation(business, typeof body.sessionId === "string" ? body.sessionId : null);
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/widget/:siteKey/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  const result = await recordConversationQuestion(business, conversation, question);
  return { conversationId: conversation.id, ...result };
});

app.post("/api/v1/widget/:siteKey/leads", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  requireWritableBusiness(business);
  requireVerifiedBusiness(business);
  const body = asRecord(request.body);
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
  }
  return reply.code(created ? 201 : 200).send({ lead, deduplicated: !created });
});

app.get("/api/v1/demo/:slug/knowledge-gaps", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return { gaps: [...business.knowledgeGaps.values()].sort((left, right) => right.occurrenceCount - left.occurrenceCount) };
});

app.post("/api/v1/demo/:slug/knowledge-gaps/resolve", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const question = requiredString(body.question, "question", 1_000);
  const approvedAnswer = requiredString(body.approvedAnswer, "approvedAnswer", 4_000);
  return { gap: await resolveKnowledgeGap(business, question, approvedAnswer) };
});

app.get("/api/v1/demo/:slug/retrieval-diagnostics", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const diagnostics = [...business.conversations.values()]
    .flatMap((conversation) => conversation.messages.map((message, index) => ({ conversation, message, question: conversation.messages[index - 1]?.content })))
    .filter((item) => item.message.role === "assistant" && item.message.retrieval)
    .sort((left, right) => right.message.createdAt.localeCompare(left.message.createdAt))
    .slice(0, 100)
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
  return { diagnostics };
});

app.get("/api/v1/demo/:slug/leads", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  return { leads: business.leads };
});

app.post("/api/v1/demo/:slug/agent-config", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  if (typeof body.assistantName === "string" && body.assistantName.trim()) business.agentConfig.assistantName = body.assistantName.trim().slice(0, 120);
  if (typeof body.welcomeMessage === "string" && body.welcomeMessage.trim()) business.agentConfig.welcomeMessage = body.welcomeMessage.trim().slice(0, 1_000);
  if (typeof body.widgetColor === "string" && /^#[\da-f]{6}$/i.test(body.widgetColor)) business.agentConfig.widgetColor = body.widgetColor;
  if (typeof body.collectLeads === "boolean") business.agentConfig.collectLeads = body.collectLeads;
  if (typeof body.showBookingAction === "boolean") business.agentConfig.showBookingAction = body.showBookingAction;
  await persistAgentConfig(business);
  return { agent: business.agentConfig };
});

app.post("/api/v1/demo/:slug/conversations", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const body = asRecord(request.body);
  const conversation = await startConversation(business, typeof body.sessionId === "string" ? body.sessionId : null);
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  requireWritableBusiness(business);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  const result = await recordConversationQuestion(business, conversation, question);
  return { conversationId: conversation.id, ...result };
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
  await pool?.end();
});

await app.listen({ host, port });
