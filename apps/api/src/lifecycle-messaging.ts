import type { Pool } from "pg";
import { sesConfigured, sendTransactionalEmail } from "./email.js";

export type LifecycleEventType =
  | "USER_CREATED"
  | "DEMO_READY"
  | "TRIAL_STARTED"
  | "BUSINESS_VERIFICATION_NEEDED"
  | "WIDGET_INSTALLED"
  | "TRIAL_ENDING_SOON"
  | "TRIAL_EXPIRED"
  | "SUBSCRIPTION_ACTIVATED"
  | "SUBSCRIPTION_UPDATED"
  | "SUBSCRIPTION_CHANGE_SCHEDULED"
  | "SUBSCRIPTION_UPGRADE_PAYMENT_FAILED"
  | "PAYMENT_FAILED"
  | "SUBSCRIPTION_CANCELED"
  | "TEAM_INVITED"
  | "HUMAN_HANDOFF"
  | "KNOWLEDGE_GAP"
  | "QUALIFIED_LEAD"
  | "INTEGRATION_FAILURE";

export type LifecycleEvent = {
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
};

export type LifecycleTemplate = {
  templateKey: string;
  name: string;
  description: string;
  category: "transactional" | "operational" | "account";
  subject: string;
  previewText: string;
  heading: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  secondaryCtas: Array<{ label: string; url: string }>;
  footer: string;
  variables: string[];
  status: "draft" | "active" | "disabled";
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};

type MessageAutomation = {
  id: string;
  automation_key: string;
  template_key: string;
  event_type: LifecycleEventType;
  delay_seconds: number;
  recipient_scope: "event_recipient" | "business_owners" | "business_team";
  conditions: Record<string, unknown>;
  mandatory: boolean;
};

type DeliveryRecipient = { id: string | null; email: string };

function uniqueRecipients(recipients: DeliveryRecipient[]): DeliveryRecipient[] {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const key = recipient.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email && email.includes("@") ? email.slice(0, 320) : null;
}

function preferenceKey(eventType: LifecycleEventType): string | null {
  if (eventType === "HUMAN_HANDOFF") return "human_handoff";
  if (eventType === "KNOWLEDGE_GAP") return "knowledge_gap";
  if (eventType === "QUALIFIED_LEAD") return "new_lead";
  if (eventType === "INTEGRATION_FAILURE") return "integration_failure";
  return null;
}

function conditionsMatch(conditions: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = payload[key];
    if (expected && typeof expected === "object") {
      const rule = record(expected);
      if ("equals" in rule && actual !== rule.equals) return false;
      if ("notEquals" in rule && actual === rule.notEquals) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function normalizeTemplateLineBreaks(value: string): string {
  return value
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\n")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

export function interpolateTemplate(source: string, variables: Record<string, unknown>): string {
  return source.replace(/\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    const value = variables[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

export function renderLifecycleEmail(template: Pick<LifecycleTemplate, "subject" | "previewText" | "heading" | "body" | "ctaLabel" | "ctaUrl" | "footer"> & Partial<Pick<LifecycleTemplate, "secondaryCtas">>, variables: Record<string, unknown>): { subject: string; text: string; html: string } {
  const subject = interpolateTemplate(template.subject, variables).trim();
  const previewText = interpolateTemplate(template.previewText, variables).trim();
  const heading = interpolateTemplate(template.heading, variables).trim();
  const body = normalizeTemplateLineBreaks(interpolateTemplate(template.body, variables)).trim();
  const ctaLabel = template.ctaLabel ? interpolateTemplate(template.ctaLabel, variables).trim() : "";
  const ctaUrl = template.ctaUrl ? interpolateTemplate(template.ctaUrl, variables).trim() : "";
  const secondaryCtas = (template.secondaryCtas ?? [])
    .map((cta) => ({ label: interpolateTemplate(cta.label, variables).trim(), url: interpolateTemplate(cta.url, variables).trim() }))
    .filter((cta) => cta.label && cta.url);
  const footer = interpolateTemplate(template.footer, variables).trim();
  const textParts = [heading, body, ctaLabel && ctaUrl ? `${ctaLabel}: ${ctaUrl}` : "", ...secondaryCtas.map((cta) => `${cta.label}: ${cta.url}`), footer].filter(Boolean);
  const htmlBody = body.split(/\n+/).map((line) => `<p style="margin:0 0 16px">${htmlEscape(line)}</p>`).join("");
  const htmlCta = ctaLabel && ctaUrl
    ? `<p style="margin:24px 0"><a href="${htmlEscape(ctaUrl)}" style="display:inline-block;background:#173b35;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${htmlEscape(ctaLabel)}</a></p>`
    : "";
  const htmlSecondaryCtas = secondaryCtas.length
    ? `<p style="margin:18px 0 0">${secondaryCtas.map((cta) => `<a href="${htmlEscape(cta.url)}" style="display:inline-block;color:#173b35;margin:0 16px 10px 0;font-weight:600">${htmlEscape(cta.label)} →</a>`).join("")}</p>`
    : "";
  const brandHeader = `<div style="margin:0 0 24px;color:#173b35;font-size:18px;font-weight:700;letter-spacing:-.03em">FrontDesk<span style="color:#2b8a78">Wise</span></div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f7f6;color:#15211e;font-family:Arial,sans-serif"><div style="max-width:600px;margin:32px auto;padding:32px;background:#fff;border:1px solid #e4eae7;border-radius:16px">${brandHeader}<p style="color:#6c7974;font-size:12px;margin:0 0 20px">${htmlEscape(previewText)}</p><h1 style="font-size:26px;line-height:1.2;margin:0 0 20px">${htmlEscape(heading)}</h1>${htmlBody}${htmlCta}${htmlSecondaryCtas}<p style="color:#6c7974;font-size:12px;line-height:1.5;border-top:1px solid #e4eae7;padding-top:20px;margin-top:28px">${htmlEscape(footer)}</p></div></body></html>`;
  return { subject, text: textParts.join("\n\n"), html };
}

function templatePayload(row: Record<string, unknown>): LifecycleTemplate {
  const variables = Array.isArray(row.variables)
    ? row.variables.filter((value): value is string => typeof value === "string")
    : [];
  const category = row.category === "operational" || row.category === "account" ? row.category : "transactional";
  const status = row.status === "draft" || row.status === "disabled" ? row.status : "active";
  const secondaryCtas = Array.isArray(row.secondary_ctas)
    ? row.secondary_ctas
      .map((value) => record(value))
      .filter((value) => typeof value.label === "string" && typeof value.url === "string")
      .map((value) => ({ label: String(value.label), url: String(value.url) }))
    : [];
  return {
    templateKey: String(row.template_key),
    name: String(row.name),
    description: String(row.description ?? ""),
    category,
    subject: String(row.subject),
    previewText: String(row.preview_text ?? ""),
    heading: String(row.heading),
    body: String(row.body),
    ctaLabel: typeof row.cta_label === "string" ? row.cta_label : null,
    ctaUrl: typeof row.cta_url === "string" ? row.cta_url : null,
    secondaryCtas,
    footer: String(row.footer ?? ""),
    variables,
    status,
    version: Number(row.version ?? 1),
    updatedByUserId: typeof row.updated_by_user_id === "string" ? row.updated_by_user_id : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export function lifecycleTemplatePayload(row: Record<string, unknown>): LifecycleTemplate {
  return templatePayload(row);
}

async function recipientsForAutomation(pool: Pool, automation: MessageAutomation, event: LifecycleEvent): Promise<DeliveryRecipient[]> {
  if (automation.recipient_scope === "event_recipient") {
    const recipients: DeliveryRecipient[] = [];
    if (event.recipientUserId) {
      const result = await pool.query<{ id: string; email: string }>(
        "select id, email from app_users where id = $1 and status <> 'disabled'",
        [event.recipientUserId],
      );
      recipients.push(...result.rows.map((row) => ({ id: row.id, email: row.email.toLowerCase() })));
    }
    const email = normalizedEmail(event.recipientEmail);
    if (email) recipients.push({ id: null, email });
    for (const candidate of event.recipientEmails ?? []) {
      const normalized = normalizedEmail(candidate);
      if (normalized) recipients.push({ id: null, email: normalized });
    }
    return uniqueRecipients(recipients);
  }

  if (!event.businessId) return [];
  const explicitRecipients: DeliveryRecipient[] = [];
  if (event.recipientUserIds?.length) {
    const explicit = await pool.query<{ id: string; email: string }>(
      "select id, email from app_users where id = any($1::uuid[]) and status = 'active' order by email",
      [event.recipientUserIds],
    );
    explicitRecipients.push(...explicit.rows.map((row) => ({ id: row.id, email: row.email.toLowerCase() })));
  }
  for (const candidate of event.recipientEmails ?? []) {
    const normalized = normalizedEmail(candidate);
    if (normalized) explicitRecipients.push({ id: null, email: normalized });
  }
  if (explicitRecipients.length) return uniqueRecipients(explicitRecipients);
  const roles = automation.recipient_scope === "business_owners"
    ? ["owner", "admin"]
    : ["owner", "admin", "staff"];
  const result = await pool.query<{ id: string; email: string }>(
    `select distinct u.id, u.email
     from app_users u
     join businesses b on b.id = $1
     left join organization_members om on om.organization_id = b.organization_id and om.user_id = u.id
     left join business_members bm on bm.business_id = b.id and bm.user_id = u.id
     where u.status = 'active'
       and (om.role = any($2::text[]) or bm.role = any($3::text[]))
     order by u.email`,
    [event.businessId, roles, roles.filter((role) => role !== "owner")],
  );
  return uniqueRecipients(result.rows.map((row) => ({ id: row.id, email: row.email.toLowerCase() })));
}

async function recipientEnabled(pool: Pool, recipient: DeliveryRecipient, event: LifecycleEvent, automation: MessageAutomation): Promise<boolean> {
  if (automation.mandatory) return true;
  const key = preferenceKey(event.eventType);
  if (!key || !recipient.id) return true;
  const result = await pool.query<{ enabled: boolean }>(
    `select enabled
     from message_preferences
     where user_id = $1 and preference_key = $2
       and (business_id = $3 or business_id is null)
     order by (business_id is null), updated_at desc
     limit 1`,
    [recipient.id, key, event.businessId ?? null],
  );
  return result.rows[0]?.enabled !== false;
}

export async function emitLifecycleEvent(pool: Pool | null, event: LifecycleEvent): Promise<number> {
  if (!pool) return 0;
  const payload = event.payload ?? {};
  const automations = await pool.query<Record<string, unknown>>(
    `select id, automation_key, template_key, event_type, delay_seconds, recipient_scope, conditions, mandatory
     from message_automations
     where event_type = $1 and enabled = true`,
    [event.eventType],
  );
  let queued = 0;
  for (const raw of automations.rows) {
    const automation: MessageAutomation = {
      id: String(raw.id),
      automation_key: String(raw.automation_key),
      template_key: String(raw.template_key),
      event_type: event.eventType,
      delay_seconds: Number(raw.delay_seconds ?? 0),
      recipient_scope: raw.recipient_scope === "business_team" || raw.recipient_scope === "business_owners" ? raw.recipient_scope : "event_recipient",
      conditions: record(raw.conditions),
      mandatory: Boolean(raw.mandatory),
    };
    if (!conditionsMatch(automation.conditions, payload)) continue;
    const recipients = await recipientsForAutomation(pool, automation, event);
    for (const recipient of recipients) {
      if (!(await recipientEnabled(pool, recipient, event, automation))) continue;
      const result = await pool.query(
        `insert into message_deliveries
           (automation_id, template_key, event_type, event_key, organization_id, business_id, recipient_user_id, recipient_email, payload, scheduled_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now() + ($10 * interval '1 second'))
         on conflict (automation_id, event_key, recipient_email) do nothing`,
        [
          automation.id,
          automation.template_key,
          event.eventType,
          event.eventKey,
          event.organizationId ?? null,
          event.businessId ?? null,
          recipient.id,
          recipient.email,
          JSON.stringify(payload),
          event.delaySeconds ?? automation.delay_seconds,
        ],
      );
      queued += result.rowCount ?? 0;
    }
  }
  return queued;
}

function deliveryError(error: unknown): string {
  return (error instanceof Error ? error.message : "Lifecycle email delivery failed").replace(/\s+/g, " ").slice(0, 1_000);
}

let lifecycleOutboxRunning = false;
let lifecycleOutboxTimer: NodeJS.Timeout | null = null;
let lifecycleOutboxPool: Pool | null = null;

export function scheduleLifecycleMessaging(delayMs = 250, pool: Pool | null = null): void {
  if (pool) lifecycleOutboxPool = pool;
  if (lifecycleOutboxTimer) return;
  lifecycleOutboxTimer = setTimeout(() => {
    lifecycleOutboxTimer = null;
    void processLifecycleMessagingOutbox(lifecycleOutboxPool).catch(() => undefined);
  }, Math.max(250, Math.min(delayMs, 60_000)));
}

export async function scheduleNextLifecycleMessaging(pool: Pool | null): Promise<void> {
  if (!pool || lifecycleOutboxTimer) return;
  const result = await pool.query<{ delay_ms: string | null }>(
    `select extract(epoch from (min(scheduled_at) - now())) * 1000 as delay_ms
     from message_deliveries where status in ('queued', 'deferred')`,
  );
  const delayMs = result.rows[0]?.delay_ms === null || result.rows[0]?.delay_ms === undefined ? null : Number(result.rows[0].delay_ms);
  if (delayMs !== null && Number.isFinite(delayMs)) scheduleLifecycleMessaging(Math.max(250, delayMs));
}

export async function processLifecycleMessagingOutbox(pool: Pool | null = null): Promise<void> {
  if (pool) lifecycleOutboxPool = pool;
  pool = pool ?? lifecycleOutboxPool;
  if (!pool || lifecycleOutboxRunning) return;
  lifecycleOutboxRunning = true;
  try {
    while (true) {
      const claim = await pool.query<Record<string, unknown>>(
        `with candidate as (
           select d.id
           from message_deliveries d
           where ((d.status in ('queued', 'deferred') and d.scheduled_at <= now())
              or (d.status = 'running' and coalesce(d.last_attempt_at, d.created_at) < now() - interval '15 minutes'))
           order by d.scheduled_at, d.created_at
           for update skip locked limit 1
         ), claimed as (
           update message_deliveries d
           set status = 'running', attempts = d.attempts + 1, last_attempt_at = now(), updated_at = now()
           from candidate
           where d.id = candidate.id
           returning d.*
         )
         select claimed.*, t.subject, t.preview_text, t.heading, t.body, t.cta_label, t.cta_url, t.secondary_ctas, t.footer, t.status as template_status
         from claimed join message_templates t on t.template_key = claimed.template_key`,
      );
      if (!claim.rowCount) break;
      const delivery = claim.rows[0];
      const deliveryPayload = record(delivery.payload);
      if (delivery.event_type === "HUMAN_HANDOFF" && deliveryPayload.handoff_reminder === true && deliveryPayload.conversation_id && delivery.business_id) {
        const conversation = await pool.query<{ status: string }>(
          "select status from conversations where id = $1 and business_id = $2",
          [String(deliveryPayload.conversation_id), String(delivery.business_id)],
        );
        if (!conversation.rows[0] || !["HANDOFF_REQUESTED", "WAITING_FOR_STAFF"].includes(conversation.rows[0].status)) {
          await pool.query("update message_deliveries set status = 'canceled', updated_at = now() where id = $1", [delivery.id]);
          continue;
        }
      }
      try {
        if (delivery.template_status !== "active") throw new Error("Message template is not active");
        if (!sesConfigured()) throw new Error("Email delivery is not configured");
        const rendered = renderLifecycleEmail({
          subject: String(delivery.subject),
          previewText: String(delivery.preview_text ?? ""),
          heading: String(delivery.heading),
          body: String(delivery.body),
          ctaLabel: typeof delivery.cta_label === "string" ? delivery.cta_label : null,
          ctaUrl: typeof delivery.cta_url === "string" ? delivery.cta_url : null,
          secondaryCtas: Array.isArray(delivery.secondary_ctas) ? delivery.secondary_ctas
            .map((value) => record(value))
            .filter((value) => typeof value.label === "string" && typeof value.url === "string")
            .map((value) => ({ label: String(value.label), url: String(value.url) })) : [],
          footer: String(delivery.footer ?? ""),
        }, record(delivery.payload));
        const sendResult = await sendTransactionalEmail({
          to: [String(delivery.recipient_email)],
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
          replyTo: process.env.FRONTDESKWISE_SES_REPLY_TO,
        });
        await pool.query(
          `update message_deliveries
           set status = 'sent', sent_at = now(), provider = $2, provider_message_id = $3,
               failure_reason = null, updated_at = now()
           where id = $1`,
          [delivery.id, sendResult.provider, sendResult.providerMessageId],
        );
        if (delivery.event_type === "SUBSCRIPTION_ACTIVATED" || delivery.event_type === "SUBSCRIPTION_UPDATED") {
          await pool.query(
            `update billing_timeline_events set status = 'sent'
             where organization_id = $1 and event_key = $2`,
            [delivery.organization_id ?? null, delivery.event_key],
          ).catch(() => undefined);
        }
      } catch (error) {
        const message = deliveryError(error);
        const attempts = Number(delivery.attempts);
        const maxAttempts = Number(delivery.max_attempts);
        const retry = attempts < maxAttempts;
        const delaySeconds = Math.min(900, 2 ** Math.max(0, attempts - 1) * 10);
        await pool.query(
          `update message_deliveries
           set status = $2, scheduled_at = now() + ($3 * interval '1 second'),
               failure_reason = $4, failed_at = case when $2 = 'failed' then now() else failed_at end, updated_at = now()
           where id = $1`,
          [delivery.id, retry ? "deferred" : "failed", retry ? delaySeconds : 0, message],
        );
        if (!retry && (delivery.event_type === "SUBSCRIPTION_ACTIVATED" || delivery.event_type === "SUBSCRIPTION_UPDATED")) {
          await pool.query(
            `update billing_timeline_events set status = 'failed', metadata = metadata || $3::jsonb
             where organization_id = $1 and event_key = $2`,
            [delivery.organization_id ?? null, delivery.event_key, JSON.stringify({ failureReason: message })],
          ).catch(() => undefined);
        }
      }
    }
  } finally {
    lifecycleOutboxRunning = false;
    void scheduleNextLifecycleMessaging(pool).catch(() => undefined);
  }
}

export async function retryLifecycleDelivery(pool: Pool | null, deliveryId: string): Promise<void> {
  if (!pool) return;
  const result = await pool.query(
    `update message_deliveries
     set status = 'queued', scheduled_at = now(), failure_reason = null, failed_at = null, updated_at = now()
     where id = $1 and status in ('failed', 'deferred')`,
    [deliveryId],
  );
  if (!result.rowCount) throw new Error("Delivery not found or is not retryable");
  void processLifecycleMessagingOutbox(pool);
}

export async function seedLifecycleUserEvent(pool: Pool | null, input: { userId: string; email: string; firstName: string; organizationId?: string | null; businessName?: string | null; dashboardUrl?: string | null }): Promise<void> {
  await emitLifecycleEvent(pool, {
    eventType: "USER_CREATED",
    eventKey: `user.created:${input.userId}`,
    organizationId: input.organizationId ?? null,
    recipientUserId: input.userId,
    recipientEmail: input.email,
    payload: {
      first_name: input.firstName,
      business_name: input.businessName ?? "your business",
      dashboard_url: input.dashboardUrl ?? process.env.FRONTDESKWISE_APP_URL ?? "https://app.frontdeskwise.com",
    },
  });
}

