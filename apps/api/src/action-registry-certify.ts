import "dotenv/config";
import { randomUUID } from "node:crypto";

type Json = Record<string, any>;

const baseUrl = process.env.FDW_CERTIFY_BASE_URL?.replace(/\/$/, "");
const slug = process.env.FDW_CERTIFY_SLUG;
const ownerToken = process.env.FDW_CERTIFY_OWNER_TOKEN;
const adminToken = process.env.FDW_CERTIFY_ADMIN_TOKEN;
const question = process.env.FDW_CERTIFY_QUESTION;

if (!baseUrl || !slug || !ownerToken || !adminToken) {
  throw new Error("Set FDW_CERTIFY_BASE_URL, FDW_CERTIFY_SLUG, FDW_CERTIFY_OWNER_TOKEN, and FDW_CERTIFY_ADMIN_TOKEN");
}

async function request<T extends Json>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${payload.error ?? JSON.stringify(payload)}`);
  return payload;
}

const workspace = await request<Json>(`/api/v1/demo/${encodeURIComponent(slug)}`, ownerToken);
const source = (workspace.knowledge?.sources ?? []).find((candidate: Json) => candidate.contentType === "web_page");
if (!source?.id) throw new Error("Certification tenant has no website source to recrawl");

await request(`/api/v1/demo/${encodeURIComponent(slug)}/knowledge/sources/${encodeURIComponent(source.id)}/recrawl`, ownerToken, { method: "POST", body: "{}" });
const registry = await request<Json>("/api/v1/admin/action-registry", adminToken);
const discovered = (registry.actions ?? []).find((candidate: Json) => candidate.businessId === workspace.business?.id && candidate.origin === "discovered" && ["discovered", "needs_review"].includes(candidate.lifecycleStatus));
if (!discovered) throw new Error("Recrawl completed but no discovered action entered the registry");
for (const field of ["sourceUrl", "sourceType", "sourceLabel", "discoveredAt", "classificationReason", "confidence"]) {
  if (discovered[field] === null || discovered[field] === undefined || discovered[field] === "") throw new Error(`Discovered action is missing provenance field: ${field}`);
}

await request(`/api/v1/admin/action-registry/${encodeURIComponent(discovered.id)}`, adminToken, {
  method: "PATCH",
  body: JSON.stringify({ status: "approved" }),
});
await request(`/api/v1/admin/businesses/${encodeURIComponent(workspace.business.id)}/primary-action`, adminToken, {
  method: "PATCH",
  body: JSON.stringify({ actionId: discovered.id }),
});

const siteKey = workspace.widget?.siteKey;
if (!siteKey) throw new Error("Certification tenant has no public widget site key");
await request<Json>(`/api/v1/widget/${encodeURIComponent(siteKey)}/config`, ownerToken);
const sessionId = `action-registry-certify-${randomUUID()}`;
const started = await request<Json>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations`, ownerToken, {
  method: "POST",
  body: JSON.stringify({ sessionId, newConversation: true }),
});
const visitorQuestion = question ?? `I want to ${String(discovered.name).toLowerCase()}`;
const approvedAnswer = await request<Json>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(started.conversationId)}/messages`, ownerToken, {
  method: "POST",
  body: JSON.stringify({ question: visitorQuestion, sessionId, pageUrl: workspace.business.websiteUrl }),
});
if (approvedAnswer.action?.id !== discovered.id) throw new Error("Approved primary action did not appear in the widget response; set FDW_CERTIFY_QUESTION to a known transactional CTA phrase");

await request(`/api/v1/admin/action-registry/${encodeURIComponent(discovered.id)}`, adminToken, {
  method: "PATCH",
  body: JSON.stringify({ status: "disabled", reason: "owner_override" }),
});
const disabledSessionId = `action-registry-certify-disabled-${randomUUID()}`;
const disabledStarted = await request<Json>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations`, ownerToken, {
  method: "POST",
  body: JSON.stringify({ sessionId: disabledSessionId, newConversation: true }),
});
const disabledAnswer = await request<Json>(`/api/v1/widget/${encodeURIComponent(siteKey)}/conversations/${encodeURIComponent(disabledStarted.conversationId)}/messages`, ownerToken, {
  method: "POST",
  body: JSON.stringify({ question: visitorQuestion, sessionId: disabledSessionId, pageUrl: workspace.business.websiteUrl }),
});
if (disabledAnswer.action) throw new Error("Disabled action still appeared in the widget response");

const audit = await request<Json>(`/api/v1/admin/action-registry/${encodeURIComponent(discovered.id)}/audit`, adminToken);
const events = new Set((audit.audit ?? []).map((entry: Json) => entry.eventType));
for (const required of ["approved", "primary_set", "disabled", "primary_cleared"]) {
  if (!events.has(required)) throw new Error(`Action audit is missing ${required}`);
}

console.log(JSON.stringify({
  ok: true,
  businessId: workspace.business.id,
  actionId: discovered.id,
  actionName: discovered.name,
  question: visitorQuestion,
  lifecycle: ["discovered", "approved", "primary_set", "disabled", "primary_cleared"],
  auditEvents: [...events],
}, null, 2));
