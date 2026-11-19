import "dotenv/config";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { createPoolFromEnv } from "./database.js";
import { crawlWebsite, normalisePublicUrl, type CrawledPage } from "./crawler.js";
import { embedTexts, embeddingDimensions, embeddingModel, embeddingsConfigured, vectorLiteral } from "./embeddings.js";
import { verifyFirebaseIdToken } from "./firebase-auth.js";
import { FixedWindowRateLimiter } from "./rate-limit.js";
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
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";
const pool = createPoolFromEnv();
const allowedWebOrigins = (process.env.WEB_ORIGIN ?? "*").split(",").map((origin) => origin.trim()).filter(Boolean);
const apiRateLimiter = new FixedWindowRateLimiter(
  Number(process.env.FRONTDESKWISE_RATE_LIMIT_MAX ?? 120),
  Number(process.env.FRONTDESKWISE_RATE_LIMIT_WINDOW_MS ?? 60_000),
);
const demoRateLimiter = new FixedWindowRateLimiter(
  Number(process.env.FRONTDESKWISE_DEMO_RATE_LIMIT_MAX ?? 10),
  Number(process.env.FRONTDESKWISE_DEMO_RATE_LIMIT_WINDOW_MS ?? 3_600_000),
);

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

type Message = {
  role: "user" | "assistant";
  content: string;
  grounded?: boolean;
  sourceUrl?: string;
  confidenceScore?: number;
  confidenceBand?: "high" | "medium" | "low";
  citations?: Array<{ title: string; url: string; sourceId?: string; chunkId?: string; pageType?: string }>;
  retrieval?: { mode: string; candidateCount: number; topScore?: number };
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

async function authSnapshot(userId: string, activeOrganizationId: string | null = null): Promise<Record<string, unknown>> {
  if (!pool) throw httpError(503, "Account authentication requires PostgreSQL storage");
  const [userResult, organizationResult, businessResult] = await Promise.all([
    pool.query<Record<string, unknown>>("select id, email, name from app_users where id = $1 and status = 'active'", [userId]),
    pool.query<Record<string, unknown>>(
      `select o.id, o.name, o.slug, om.role
       from organization_members om
       join organizations o on o.id = om.organization_id
       where om.user_id = $1
       order by om.created_at`,
      [userId],
    ),
    pool.query<Record<string, unknown>>(
      `select b.id, b.organization_id, b.name, b.slug, b.website_url, b.is_demo, b.billing_status, b.plan_key,
              coalesce(bm.role, case when om.role in ('owner', 'admin') then 'admin' else null end) as business_role
       from businesses b
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
    businesses: businessesByOrganization.get(String(row.id)) ?? [],
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

    if (options.demoToken) {
      const session = await client.query<Record<string, unknown>>(
        `select s.id, s.business_id, b.organization_id, b.is_internal_demo, b.slug
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
            `insert into organizations (name, slug)
             values ($1, $2)
             returning id`,
            [organizationName.slice(0, 160), `org-${randomUUID().replace(/-/g, "").slice(0, 24)}`],
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
           set organization_id = $2, is_demo = false, billing_mode = 'sandbox', billing_status = 'trial', plan_key = 'starter',
               trial_ends_at = coalesce(trial_ends_at, now() + interval '14 days'), updated_at = now()
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
      }
    }

    if (!organizationId) {
      const organizationName = options.organizationName || `${authUser.name}'s Businesses`;
      const organization = await client.query<{ id: string }>(
        `insert into organizations (name, slug)
         values ($1, $2)
         returning id`,
        [organizationName.slice(0, 160), `org-${randomUUID().replace(/-/g, "").slice(0, 24)}`],
      );
      organizationId = organization.rows[0].id;
      await client.query(
        `insert into organization_members (organization_id, user_id, role)
         values ($1, $2, 'owner')`,
        [organizationId, user.id],
      );
    }

    await client.query("commit");
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

async function persistBusiness(business: Business, organizationIdOverride?: string): Promise<void> {
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("begin");
    const isInternalDemo = business.slug === "british-swim-school-tampa-bay";
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
                              trial_ends_at, current_period_ends_at, grace_ends_at, billing_provider,
                              provider_customer_id, provider_subscription_id, public_site_key,
                              widget_enabled, widget_last_loaded_at, widget_load_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)
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
  const businessResult = await pool.query<Record<string, unknown>>("select * from businesses where slug = $1", [slug]);
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
      mode: row.billing_mode === "live" ? "live" : "sandbox",
      isDemo: row.is_demo !== false,
      status: row.billing_status === "active" || row.billing_status === "grace" || row.billing_status === "paused" || row.billing_status === "cancelled" ? row.billing_status : "trial",
      planKey: String(row.plan_key ?? "demo"),
      interval: row.billing_interval === "month" || row.billing_interval === "year" ? row.billing_interval : null,
      trialEndsAt: row.trial_ends_at ? toIso(row.trial_ends_at) : null,
      currentPeriodEndsAt: row.current_period_ends_at ? toIso(row.current_period_ends_at) : null,
      graceEndsAt: row.grace_ends_at ? toIso(row.grace_ends_at) : null,
      provider: typeof row.billing_provider === "string" ? row.billing_provider : null,
      providerCustomerId: typeof row.provider_customer_id === "string" ? row.provider_customer_id : null,
      providerSubscriptionId: typeof row.provider_subscription_id === "string" ? row.provider_subscription_id : null,
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

async function persistMessage(conversation: Conversation, message: Message): Promise<void> {
  if (!pool) return;
  await pool.query(
    `insert into conversation_messages
       (conversation_id, role, content, grounded, source_url, confidence_score, confidence_band, citations, retrieval, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      conversation.id,
      message.role,
      message.content,
      message.grounded ?? null,
      message.sourceUrl ?? null,
      message.confidenceScore ?? null,
      message.confidenceBand ?? null,
      JSON.stringify(message.citations ?? []),
      message.retrieval ?? null,
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

async function createDemoAccess(business: Business): Promise<{ accessToken: string; expiresAt: string; user: { email: string; name: string; role: string } }> {
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + DEMO_ACCESS_TTL_MS).toISOString();
  const email = `${business.slug}@demo.frontdeskwise.local`;
  const name = `${business.name} Demo Owner`;

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
      await client.query(
        `insert into demo_access_sessions (business_id, user_id, token_hash, expires_at)
         values ($1, $2, $3, $4)`,
        [business.id, userResult.rows[0].id, hashAccessToken(accessToken), expiresAt],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  return { accessToken, expiresAt, user: { email, name, role: "owner" } };
}

async function exchangeDemoAccess(token: string): Promise<{ slug: string; businessId: string; expiresAt: string; user: { email: string; name: string; role: string } }> {
  const tokenHash = hashAccessToken(token);
  if (!pool) {
    const session = memoryDemoAccess.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now()) throw httpError(401, "Demo access token is invalid or expired");
    return { ...session, user: { email: `${session.slug}@demo.frontdeskwise.local`, name: "Demo Owner", role: "owner" } };
  }

  const result = await pool.query<Record<string, unknown>>(
    `select s.business_id, s.expires_at, b.slug, u.email, u.name, u.role
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

function billingAccess(billing: BillingState): { allowed: boolean; reason: string } {
  if (billing.isDemo && billing.mode === "sandbox") return { allowed: true, reason: "demo" };
  if (billing.status === "active") return { allowed: true, reason: "active_subscription" };
  if (billing.status === "trial" && (!billing.trialEndsAt || Date.parse(billing.trialEndsAt) > Date.now())) return { allowed: true, reason: "trial" };
  if (billing.status === "grace" && (!billing.graceEndsAt || Date.parse(billing.graceEndsAt) > Date.now())) return { allowed: true, reason: "billing_grace" };
  return { allowed: false, reason: billing.status };
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
  const leadCount = business.leads.length;
  const gapCount = [...business.knowledgeGaps.values()].filter((gap) => gap.status === "open").length;
  return {
    slug: business.slug,
    status: "sandbox",
    business: {
      id: business.id,
      name: business.name,
      location: business.location,
      vertical: business.vertical,
      websiteUrl: business.websiteUrl,
    },
    agent: business.agentConfig,
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
      sourceCount: business.sources.length,
      chunkCount: business.chunks.length,
      openGaps: gapCount,
    },
    stats: {
      conversations: business.conversations.size,
      leads: leadCount,
      bookingClicks: [...business.conversations.values()].filter((conversation) => conversation.actionTaken === "booking").length,
    },
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
  if (existingGap?.status === "resolved" && existingGap.approvedAnswer) {
    return {
      answer: existingGap.approvedAnswer,
      grounded: true,
      citations: [],
      knowledgeGap: null,
      confidenceScore: 0.99,
      confidenceBand: "high" as const,
      retrieval: { mode: "approved_answer", candidateCount: 0, topScore: 1 },
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

  if (!match || confidenceBand === "low") {
    const gap = rememberGap(business, question);
    return {
      answer: business.agentConfig.fallbackMessage,
      grounded: false,
      citations: [],
      knowledgeGap: gap,
      confidenceScore,
      confidenceBand,
      retrieval: retrievalContract,
    };
  }

  const source = business.sources.find((item) => item.id === match.chunk.sourceId);
  const excerpt = match.chunk.content.length > 420 ? `${match.chunk.content.slice(0, 417).trim()}…` : match.chunk.content;
  const citations = source ? [{
    title: source.title,
    url: source.url,
    sourceId: source.id,
    chunkId: match.chunk.id,
    pageType: source.pageType,
  }] : [];
  return {
    answer: `Based on ${source?.title ?? "the business website"}: ${excerpt}`,
    grounded: true,
    citations,
    knowledgeGap: null,
    confidenceScore,
    confidenceBand,
    retrieval: retrievalContract,
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
  if (result.knowledgeGap) await persistGap(business, result.knowledgeGap);
  return result;
}

const seededBusiness = seedDefaultBusiness();
if (pool) {
  const persistedSeed = await loadBusinessFromDatabase(seededBusiness.slug);
  if (persistedSeed) businesses.set(seededBusiness.slug, persistedSeed);
  else await persistBusiness(seededBusiness);
}
await resumeEmbeddingJobs();
void processIntegrationOutbox();

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
  reply.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
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
}));

app.get("/ready", async (_request, reply) => {
  if (!pool) return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_not_configured" });
  try {
    await pool.query("select 1");
    return { ok: true, service: "frontdeskwise-api", database: "ready" };
  } catch {
    return reply.code(503).send({ ok: false, service: "frontdeskwise-api", reason: "database_unavailable" });
  }
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

  const crawled = await crawlWebsite(websiteUrl);
  const firstPage = crawled.pages[0];
  const name = businessNameFromTitle(firstPage.title, websiteUrl);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  while (businesses.has(slug) || (pool && await loadBusinessFromDatabase(slug))) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;
  const business = makeBusiness({ name, slug, websiteUrl, pages: crawled.pages });
  business.billing = { ...business.billing, isDemo: false, planKey: "starter", trialEndsAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1_000).toISOString() };
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

app.post("/api/v1/demos", async (request, reply) => {
  const body = asRecord(request.body);
  const websiteUrl = normalisePublicUrl(body.websiteUrl);
  const crawled = await crawlWebsite(websiteUrl);
  const firstPage = crawled.pages[0];
  const name = businessNameFromTitle(firstPage.title, websiteUrl);
  const baseSlug = slugify(name);
  let slug = baseSlug;
  while (businesses.has(slug) || (pool && await loadBusinessFromDatabase(slug))) slug = `${baseSlug}-${Math.random().toString(36).slice(2, 7)}`;

  const business = makeBusiness({ name, slug, websiteUrl, pages: crawled.pages });
  businesses.set(slug, business);
  await persistBusiness(business);
  const access = await createDemoAccess(business);
  return reply.code(201).send({ ...workspacePayload(business), access });
});

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
  if (!pool || !embeddingsConfigured()) throw httpError(503, "Embedding jobs require OPENAI_API_KEY in the API environment");
  const jobId = await enqueueEmbeddingJob(business);
  if (!jobId) return { status: "succeeded", message: "All knowledge chunks already have embeddings" };
  void processEmbeddingJob(business, jobId);
  return { status: "queued", jobId, model: embeddingModel() };
});

app.get("/api/v1/demo/:slug/widget/install", async (request) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireAuthenticatedBusinessOwner(business, request);
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
  const body = asRecord(request.body);
  const conversation = await startConversation(business, typeof body.sessionId === "string" ? body.sessionId : null);
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/widget/:siteKey/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { siteKey?: string; conversationId?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  const result = await recordConversationQuestion(business, conversation, question);
  return { conversationId: conversation.id, ...result };
});

app.post("/api/v1/widget/:siteKey/leads", async (request, reply) => {
  const params = request.params as { siteKey?: string };
  const business = await getBusinessBySiteKey(params.siteKey);
  if (!business.widget.enabled) throw httpError(404, "Widget is disabled");
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
  const body = asRecord(request.body);
  const conversation = await startConversation(business, typeof body.sessionId === "string" ? body.sessionId : null);
  return reply.code(201).send({ conversationId: conversation.id, sessionId: conversation.sessionId });
});

app.post("/api/v1/demo/:slug/conversations/:conversationId/messages", async (request) => {
  const params = request.params as { slug?: string; conversationId?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
  const conversation = maybeConversation(business, requiredString(params.conversationId, "conversationId", 120));
  const question = requiredString(asRecord(request.body).question, "question", 1_000);
  const result = await recordConversationQuestion(business, conversation, question);
  return { conversationId: conversation.id, ...result };
});

app.post("/api/v1/demo/:slug/leads", async (request, reply) => {
  const params = request.params as { slug?: string };
  const business = await getBusiness(params.slug);
  await requireDemoOwner(business, request);
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
  const conversationId = requiredString(asRecord(request.body).conversationId, "conversationId", 120);
  const conversation = maybeConversation(business, conversationId);
  conversation.actionTaken = "booking";
  conversation.updatedAt = new Date().toISOString();
  await persistConversation(business, conversation);
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
