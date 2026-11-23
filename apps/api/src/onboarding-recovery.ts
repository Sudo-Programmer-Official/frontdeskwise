import type { Pool } from "pg";
import { createHash, createHmac } from "node:crypto";
import { emitLifecycleEvent, scheduleLifecycleMessaging, type LifecycleEventType } from "./lifecycle-messaging.js";

export type OnboardingRecoveryStage = "website" | "knowledge" | "agent" | "install" | "publish" | "complete";
export type OnboardingRecoveryIntent = "low" | "medium" | "high";
export type OnboardingRecoveryAction = "light" | "nearly_ready" | "rescue" | "recovery" | "nurture" | "dormant" | null;

export type OnboardingRecoveryInput = {
  businessId: string;
  businessName: string;
  businessSlug: string;
  organizationId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  websiteUrl: string | null;
  onboardingValid: boolean;
  onboardingMessage: string | null;
  onboardingFailureCode: string | null;
  readinessScore: number;
  sourceCount: number;
  chunkCount: number;
  pendingSourceCount: number;
  failedSourceCount: number;
  agentTested: boolean;
  widgetInstalled: boolean;
  published: boolean;
  lastActivityAt: string;
  createdAt: string;
  reminderCount: number;
  lastReminderAt: string | null;
  lastReminderType: OnboardingRecoveryAction;
  lastReminderCompletionPercent: number | null;
  emailOpened: boolean;
  returnedAfterEmail: boolean;
  unsubscribed: boolean;
  dormant: boolean;
  unsubscribeTokenHash: string | null;
};

export type OnboardingRecoverySnapshot = {
  businessId: string;
  businessName: string;
  businessSlug: string;
  organizationId: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string;
  stage: OnboardingRecoveryStage;
  intent: OnboardingRecoveryIntent;
  completionPercent: number;
  completedSummary: string;
  lastSuccessfulStep: string | null;
  nextStep: string;
  currentBlocker: string | null;
  lastError: string | null;
  lastActivityAt: string;
  createdAt: string;
  reminderCount: number;
  lastReminderAt: string | null;
  lastReminderType: OnboardingRecoveryAction;
  lastReminderCompletionPercent: number | null;
  emailOpened: boolean;
  returnedAfterEmail: boolean;
  unsubscribed: boolean;
  dormant: boolean;
  unsubscribeTokenHash: string | null;
  published: boolean;
};

type RecoveryStep = { id: string; label: string; complete: boolean; weight: number };

const RECOVERY_EVENT_TYPES: Record<Exclude<OnboardingRecoveryAction, null | "dormant">, LifecycleEventType> = {
  light: "ONBOARDING_RECOVERY_LIGHT",
  nearly_ready: "ONBOARDING_RECOVERY_NEARLY_READY",
  rescue: "ONBOARDING_RECOVERY_RESCUE",
  recovery: "ONBOARDING_RECOVERY_3_DAY",
  nurture: "ONBOARDING_RECOVERY_7_DAY",
};

const RECOVERY_TEMPLATE_KEYS: Record<Exclude<OnboardingRecoveryAction, null | "dormant">, string> = {
  light: "onboarding_recovery_light",
  nearly_ready: "onboarding_recovery_nearly_ready",
  rescue: "onboarding_recovery_rescue",
  recovery: "onboarding_recovery_3_day",
  nurture: "onboarding_recovery_7_day",
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function titleCase(value: string): string {
  return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function hoursSince(value: string, now: Date): number {
  return Math.max(0, (now.getTime() - Date.parse(value)) / 3_600_000);
}

export function recoverySteps(input: Pick<OnboardingRecoveryInput, "websiteUrl" | "onboardingValid" | "readinessScore" | "sourceCount" | "chunkCount" | "pendingSourceCount" | "failedSourceCount" | "agentTested" | "widgetInstalled" | "published">): RecoveryStep[] {
  const knowledgeReady = input.onboardingValid
    && input.sourceCount > 0
    && input.chunkCount > 0
    && input.pendingSourceCount === 0
    && input.failedSourceCount === 0;
  return [
    { id: "website_verified", label: "Connect and verify your website", complete: input.websiteUrl !== null, weight: 15 },
    { id: "knowledge_ready", label: "Build your business knowledge", complete: knowledgeReady, weight: 25 },
    { id: "agent_tested", label: "Test your assistant", complete: input.agentTested, weight: 20 },
    { id: "widget_installed", label: "Install the widget", complete: input.widgetInstalled, weight: 20 },
    { id: "agent_published", label: "Publish your AI front desk", complete: input.published, weight: 20 },
  ];
}

export function deriveOnboardingRecovery(input: OnboardingRecoveryInput): OnboardingRecoverySnapshot {
  const steps = recoverySteps(input);
  const knowledgeStep = steps.find((step) => step.id === "knowledge_ready");
  const weightedProgress = steps.reduce((total, step) => {
    if (step.complete) return total + step.weight;
    if (step.id === "knowledge_ready") return total + Math.round(clamp(input.readinessScore, 0, 100) * 0.25);
    return total;
  }, 0);
  const completionPercent = clamp(weightedProgress, 0, 100);
  const firstIncomplete = steps.find((step) => !step.complete);
  const completeLabels = steps.filter((step) => step.complete).map((step) => step.label.replace(/^Connect and verify your /, "verified your "));
  let currentBlocker: string | null = null;
  let lastError: string | null = input.onboardingMessage;
  if (!input.onboardingValid) {
    currentBlocker = input.onboardingMessage || (input.onboardingFailureCode ? titleCase(input.onboardingFailureCode) : "Your website needs attention");
    lastError = input.onboardingMessage || input.onboardingFailureCode;
  } else if (!knowledgeStep?.complete) {
    currentBlocker = input.failedSourceCount > 0 ? "One or more knowledge sources failed to load" : "Your business knowledge is not ready yet";
    lastError = input.failedSourceCount > 0 ? "One or more knowledge sources failed to load" : null;
  } else if (firstIncomplete?.id === "agent_tested") {
    currentBlocker = "The assistant has not been tested yet";
    lastError = null;
  } else if (firstIncomplete?.id === "widget_installed") {
    currentBlocker = "The FrontDeskWise widget has not been detected on your website";
    lastError = null;
  } else if (firstIncomplete?.id === "agent_published") {
    currentBlocker = "Your assistant is configured but has not been published";
    lastError = null;
  } else {
    lastError = null;
  }
  const stage: OnboardingRecoveryStage = input.published
    ? "complete"
    : firstIncomplete?.id === "website_verified"
      ? "website"
      : firstIncomplete?.id === "knowledge_ready"
        ? "knowledge"
        : firstIncomplete?.id === "agent_tested"
          ? "agent"
          : firstIncomplete?.id === "widget_installed"
            ? "install"
            : "publish";
  const intent: OnboardingRecoveryIntent = input.published || input.widgetInstalled || input.agentTested
    ? "high"
    : completionPercent >= 40 || input.sourceCount > 0
      ? "medium"
      : "low";
  const nextStep = firstIncomplete?.label ?? "Keep your AI front desk serving visitors";
  return {
    businessId: input.businessId,
    businessName: input.businessName,
    businessSlug: input.businessSlug,
    organizationId: input.organizationId,
    ownerUserId: input.ownerUserId,
    ownerEmail: input.ownerEmail,
    ownerName: input.ownerName,
    stage,
    intent,
    completionPercent,
    completedSummary: completeLabels.length ? completeLabels.join(", ") : "started your FrontDeskWise setup",
    lastSuccessfulStep: completeLabels.at(-1) ?? null,
    nextStep,
    currentBlocker,
    lastError,
    lastActivityAt: input.lastActivityAt,
    createdAt: input.createdAt,
    reminderCount: input.reminderCount,
    lastReminderAt: input.lastReminderAt,
    lastReminderType: input.lastReminderType,
    lastReminderCompletionPercent: input.lastReminderCompletionPercent,
    emailOpened: input.emailOpened,
    returnedAfterEmail: input.returnedAfterEmail,
    unsubscribed: input.unsubscribed,
    dormant: input.dormant,
    unsubscribeTokenHash: input.unsubscribeTokenHash,
    published: input.published,
  };
}

export function nextOnboardingRecoveryAction(snapshot: Pick<OnboardingRecoverySnapshot, "completionPercent" | "currentBlocker" | "lastActivityAt" | "reminderCount" | "published" | "unsubscribed" | "dormant"> & Partial<Pick<OnboardingRecoverySnapshot, "lastReminderCompletionPercent" | "returnedAfterEmail">>, now = new Date()): OnboardingRecoveryAction {
  if (snapshot.published || snapshot.unsubscribed || snapshot.dormant) return null;
  if (snapshot.returnedAfterEmail === true && snapshot.lastReminderCompletionPercent !== null && snapshot.lastReminderCompletionPercent !== undefined && snapshot.completionPercent > snapshot.lastReminderCompletionPercent) return null;
  const inactiveHours = hoursSince(snapshot.lastActivityAt, now);
  if (snapshot.reminderCount >= 5) return "dormant";
  if (inactiveHours >= 24 * 7 && snapshot.reminderCount < 5) return "nurture";
  if (inactiveHours >= 24 * 3 && snapshot.reminderCount < 4) return "recovery";
  if (inactiveHours >= 24 && snapshot.completionPercent >= 80 && Boolean(snapshot.currentBlocker) && snapshot.reminderCount < 3) return "rescue";
  if (inactiveHours >= 12 && snapshot.completionPercent >= 50 && snapshot.completionPercent <= 70 && snapshot.reminderCount < 2) return "nearly_ready";
  if (inactiveHours >= 2 && snapshot.completionPercent >= 20 && snapshot.completionPercent <= 30 && snapshot.reminderCount < 1) return "light";
  return null;
}

function firstName(name: string, email: string): string {
  return name.trim().split(/\s+/)[0] || email.split("@", 1)[0] || "there";
}

function unsubscribeTokenForBusiness(businessId: string): string {
  const secret = process.env.FRONTDESKWISE_CREDENTIAL_KEY?.trim() || "frontdeskwise-recovery-development-key";
  return createHmac("sha256", secret).update(`onboarding-recovery:${businessId}`).digest("base64url");
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function recoveryPayload(snapshot: OnboardingRecoverySnapshot, unsubscribeUrl: string, dashboardUrl: string): Record<string, unknown> {
  return {
    first_name: firstName(snapshot.ownerName, snapshot.ownerEmail),
    business_name: snapshot.businessName,
    completion_percent: snapshot.completionPercent,
    completed_summary: snapshot.completedSummary,
    last_successful_step: snapshot.lastSuccessfulStep || "your first setup step",
    next_step: snapshot.nextStep,
    current_blocker: snapshot.currentBlocker || snapshot.nextStep,
    last_error: snapshot.lastError || "No technical error was recorded.",
    recovery_stage: snapshot.stage,
    intent: snapshot.intent,
    dashboard_url: dashboardUrl,
    unsubscribe_url: unsubscribeUrl,
  };
}

function recoveryEventKey(snapshot: OnboardingRecoverySnapshot, action: Exclude<OnboardingRecoveryAction, null | "dormant">): string {
  return `onboarding.recovery:${snapshot.businessId}:${action}:${snapshot.reminderCount + 1}`;
}

async function ownerRows(pool: Pool): Promise<Array<Record<string, unknown>>> {
  const result = await pool.query<Record<string, unknown>>(
    `select b.id as business_id, b.organization_id, b.name as business_name, b.slug as business_slug,
            b.website_url, b.onboarding_status, b.onboarding_failure_code, b.onboarding_validation,
            b.agent_published_at, b.current_published_config_version, b.updated_at, b.created_at,
            b.widget_load_count,
            (select count(*) from business_sources s where s.business_id = b.id and s.crawl_status = 'ready')::integer as source_count,
            (select count(*) from knowledge_chunks c where c.business_id = b.id)::integer as chunk_count,
            (select count(*) from business_sources s where s.business_id = b.id and s.crawl_status in ('queued', 'crawling'))::integer as pending_source_count,
            (select count(*) from business_sources s where s.business_id = b.id and s.crawl_status = 'failed')::integer as failed_source_count,
            exists (
              select 1 from conversations c
              join conversation_messages m on m.conversation_id = c.id
              where c.business_id = b.id and c.session_id like 'dashboard-%' and m.role = 'user'
            ) as agent_tested,
            u.id as owner_user_id, u.email as owner_email, u.name as owner_name,
            greatest(coalesce(r.last_activity_at, b.created_at), coalesce(b.updated_at, b.created_at)) as last_activity_at,
            r.reminder_count, r.last_reminder_at, r.last_reminder_type, r.last_reminder_completion_percent, r.email_opened,
            r.returned_after_email, r.unsubscribed, r.dormant, r.unsubscribe_token_hash
     from businesses b
     join organization_members om on om.organization_id = b.organization_id and om.role in ('owner', 'admin')
     join app_users u on u.id = om.user_id and u.status = 'active' and u.email_verified = true
     left join onboarding_recovery r on r.business_id = b.id
     where b.is_internal_demo is not true
       and b.agent_published_at is null
       and b.current_published_config_version is null
     order by b.updated_at desc, u.email
     limit 2_000`,
  );
  return result.rows;
}

function snapshotFromRow(row: Record<string, unknown>): OnboardingRecoverySnapshot {
  const validation = row.onboarding_validation && typeof row.onboarding_validation === "object" ? row.onboarding_validation as Record<string, unknown> : {};
  return deriveOnboardingRecovery({
    businessId: String(row.business_id),
    businessName: String(row.business_name),
    businessSlug: String(row.business_slug),
    organizationId: String(row.organization_id),
    ownerUserId: String(row.owner_user_id),
    ownerEmail: String(row.owner_email),
    ownerName: String(row.owner_name ?? ""),
    websiteUrl: typeof row.website_url === "string" && row.website_url.trim() ? row.website_url : null,
    onboardingValid: String(row.onboarding_status ?? validation.status ?? "needs_attention") === "valid" && validation.knowledgeReady !== false,
    onboardingMessage: typeof validation.message === "string" ? validation.message : null,
    onboardingFailureCode: typeof row.onboarding_failure_code === "string" ? row.onboarding_failure_code : typeof validation.code === "string" ? validation.code : null,
    readinessScore: Number(validation.readinessScore ?? 0),
    sourceCount: Number(row.source_count ?? 0),
    chunkCount: Number(row.chunk_count ?? 0),
    pendingSourceCount: Number(row.pending_source_count ?? 0),
    failedSourceCount: Number(row.failed_source_count ?? 0),
    agentTested: row.agent_tested === true,
    widgetInstalled: Number(row.widget_load_count ?? 0) > 0,
    published: Boolean(row.agent_published_at || row.current_published_config_version),
    lastActivityAt: row.last_activity_at ? new Date(String(row.last_activity_at)).toISOString() : new Date(String(row.updated_at ?? row.created_at)).toISOString(),
    createdAt: new Date(String(row.created_at)).toISOString(),
    reminderCount: Number(row.reminder_count ?? 0),
    lastReminderAt: row.last_reminder_at ? new Date(String(row.last_reminder_at)).toISOString() : null,
    lastReminderType: typeof row.last_reminder_type === "string" ? row.last_reminder_type as OnboardingRecoveryAction : null,
    lastReminderCompletionPercent: row.last_reminder_completion_percent === null || row.last_reminder_completion_percent === undefined ? null : Number(row.last_reminder_completion_percent),
    emailOpened: row.email_opened === true,
    returnedAfterEmail: row.returned_after_email === true,
    unsubscribed: row.unsubscribed === true,
    dormant: row.dormant === true,
    unsubscribeTokenHash: typeof row.unsubscribe_token_hash === "string" ? row.unsubscribe_token_hash : null,
  });
}

export async function syncOnboardingRecovery(pool: Pool | null, options: { now?: Date; appUrl?: string; apiUrl?: string; adminUrl?: string; superAdminEmails?: string[] } = {}): Promise<{ scanned: number; queued: number }> {
  if (!pool) return { scanned: 0, queued: 0 };
  const now = options.now ?? new Date();
  const rows = await ownerRows(pool);
  let queued = 0;
  const seenBusinesses = new Set<string>();
  for (const row of rows) {
    const snapshot = snapshotFromRow(row);
    if (seenBusinesses.has(snapshot.businessId)) continue;
    seenBusinesses.add(snapshot.businessId);
    let token = snapshot.unsubscribeTokenHash;
    if (!token) {
      token = hashToken(unsubscribeTokenForBusiness(snapshot.businessId));
      await pool.query(
        `insert into onboarding_recovery (business_id, organization_id, unsubscribe_token_hash)
         values ($1, $2, $3)
         on conflict (business_id) do update set unsubscribe_token_hash = coalesce(onboarding_recovery.unsubscribe_token_hash, excluded.unsubscribe_token_hash), updated_at = now()`,
        [snapshot.businessId, snapshot.organizationId, token],
      );
    }
    const lastActivityMoved = snapshot.lastReminderAt && Date.parse(snapshot.lastActivityAt) > Date.parse(snapshot.lastReminderAt);
    await pool.query(
      `insert into onboarding_recovery
         (business_id, organization_id, onboarding_stage, completion_percent, last_activity_at,
          last_successful_step, current_blocker, last_error, reminder_count, last_reminder_at,
          last_reminder_type, last_reminder_completion_percent, email_opened, returned_after_email, unsubscribed, dormant, unsubscribe_token_hash)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       on conflict (business_id) do update set
         organization_id = excluded.organization_id,
         onboarding_stage = excluded.onboarding_stage,
         completion_percent = excluded.completion_percent,
         last_activity_at = excluded.last_activity_at,
         last_successful_step = excluded.last_successful_step,
         current_blocker = excluded.current_blocker,
         last_error = excluded.last_error,
         returned_after_email = onboarding_recovery.returned_after_email or excluded.returned_after_email,
         unsubscribe_token_hash = coalesce(onboarding_recovery.unsubscribe_token_hash, excluded.unsubscribe_token_hash),
         updated_at = now()`,
      [snapshot.businessId, snapshot.organizationId, snapshot.stage, snapshot.completionPercent, snapshot.lastActivityAt,
        snapshot.lastSuccessfulStep, snapshot.currentBlocker, snapshot.lastError, snapshot.reminderCount, snapshot.lastReminderAt,
        snapshot.lastReminderType, snapshot.lastReminderCompletionPercent, snapshot.emailOpened, Boolean(snapshot.returnedAfterEmail || lastActivityMoved), snapshot.unsubscribed,
        snapshot.dormant, token],
    );
    const refreshed = await pool.query<Record<string, unknown>>(
      "select * from onboarding_recovery where business_id = $1",
      [snapshot.businessId],
    );
    const stored = refreshed.rows[0] ? snapshotFromRow({ ...row, ...refreshed.rows[0], onboarding_status: row.onboarding_status, onboarding_validation: row.onboarding_validation, source_count: row.source_count, chunk_count: row.chunk_count, pending_source_count: row.pending_source_count, failed_source_count: row.failed_source_count, agent_tested: row.agent_tested, widget_load_count: row.widget_load_count }) : snapshot;
    const action = nextOnboardingRecoveryAction(stored, now);
    if (!action || action === "dormant") {
      if (action === "dormant") await pool.query("update onboarding_recovery set dormant = true, updated_at = now() where business_id = $1", [snapshot.businessId]);
      continue;
    }
    const unsubscribeUrl = `${options.apiUrl ?? process.env.FRONTDESKWISE_PUBLIC_API_ORIGIN ?? "http://localhost:8787"}/api/v1/onboarding-recovery/unsubscribe?token=${encodeURIComponent(unsubscribeTokenForBusiness(stored.businessId))}`;
    const appOrigin = (options.appUrl ?? process.env.FRONTDESKWISE_APP_URL ?? "https://app.frontdeskwise.com").replace(/\/$/, "");
    const dashboardUrl = `${appOrigin}/app/${encodeURIComponent(stored.businessSlug)}`;
    const payload = recoveryPayload(stored, unsubscribeUrl, dashboardUrl);
    const eventType = RECOVERY_EVENT_TYPES[action];
    await emitLifecycleEvent(pool, {
      eventType,
      eventKey: recoveryEventKey(stored, action),
      organizationId: stored.organizationId,
      businessId: stored.businessId,
      recipientUserId: stored.ownerUserId,
      recipientEmail: stored.ownerEmail,
      payload,
    });
    if (action === "rescue") {
      await emitLifecycleEvent(pool, {
        eventType: "ONBOARDING_RECOVERY_RESCUE_ALERT",
        eventKey: `${recoveryEventKey(stored, action)}:internal`,
        organizationId: stored.organizationId,
        businessId: stored.businessId,
        recipientEmails: options.superAdminEmails ?? [],
        payload: { ...payload, admin_url: `${options.adminUrl ?? options.appUrl ?? process.env.FRONTDESKWISE_APP_URL ?? "https://app.frontdeskwise.com"}/platform/businesses/${encodeURIComponent(stored.businessId)}` },
      });
    }
    await pool.query(
      `update onboarding_recovery
       set reminder_count = reminder_count + 1, last_reminder_at = now(), last_reminder_type = $2,
           last_reminder_completion_percent = $3,
           dormant = case when $2 = 'nurture' then true else dormant end, updated_at = now()
       where business_id = $1`,
      [stored.businessId, action, stored.completionPercent],
    );
    queued += 1;
  }
  if (queued) scheduleLifecycleMessaging(250, pool);
  return { scanned: seenBusinesses.size, queued };
}

export function recoveryTemplateKey(action: Exclude<OnboardingRecoveryAction, null | "dormant">): string {
  return RECOVERY_TEMPLATE_KEYS[action];
}

export function recoveryEventType(action: Exclude<OnboardingRecoveryAction, null | "dormant">): LifecycleEventType {
  return RECOVERY_EVENT_TYPES[action];
}
