import { createHmac } from "node:crypto";
import { credentialsConfigured, decryptSecret, encryptSecret } from "./secrets.js";

export type CrmProvider = "hubspot" | "webhook";

export type CrmLeadPayload = {
  eventId: string;
  eventType: "lead.created" | "integration.test";
  tenant: { id: string; slug: string; name: string };
  conversationId?: string | null;
  lead?: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    intent: string | null;
    status: string;
    source: string;
    pageUrl: string | null;
    referrer: string | null;
    consentAt: string | null;
    createdAt: string;
    metadata: Record<string, unknown>;
  };
};

export type WebhookCredentials = { webhookUrl: string; signingSecret?: string };

export type CrmConnectionTest = {
  ok: true;
  provider: CrmProvider;
  portalId: string | null;
  accountName: string | null;
};

export type CrmContactInput = {
  email: string | null;
  phone: string | null;
  name: string | null;
  intent: string | null;
};

export type CrmContactResult = {
  externalId: string;
  created: boolean;
};

export interface CrmAdapter {
  testConnection(): Promise<CrmConnectionTest>;
  upsertContact(input: CrmContactInput): Promise<CrmContactResult>;
  logActivity(input: { contactId: string; body: string }): Promise<void>;
}

class CrmRequestError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function requiredToken(accessToken: string): string {
  if (!accessToken.trim()) throw new Error("CRM access token is required");
  return accessToken.trim();
}

async function hubSpotRequest<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`https://api.hubapi.com${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${requiredToken(accessToken)}`,
        accept: "application/json",
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) throw new CrmRequestError(response.status, `HubSpot request failed (${response.status})`);
    if (response.status === 204) return {} as T;
    return await response.json() as T;
  } catch (error) {
    if (error instanceof CrmRequestError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new Error("HubSpot request timed out");
    throw new Error("HubSpot request could not be completed");
  } finally {
    clearTimeout(timeout);
  }
}

function splitName(name: string | null): { firstName?: string; lastName?: string } {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return {};
  return { firstName: parts[0], ...(parts.length > 1 ? { lastName: parts.slice(1).join(" ") } : {}) };
}

function contactProperties(input: CrmContactInput): Record<string, string> {
  const name = splitName(input.name);
  return {
    ...(input.email ? { email: input.email } : {}),
    ...(input.phone ? { phone: input.phone } : {}),
    ...(name.firstName ? { firstname: name.firstName } : {}),
    ...(name.lastName ? { lastname: name.lastName } : {}),
    lifecyclestage: "lead",
  };
}

type HubSpotSearchResponse = { results?: Array<{ id: string }> };
type HubSpotObjectResponse = { id: string };
type HubSpotAccountResponse = { portalId?: number | string; accountName?: string };

export class HubSpotAdapter implements CrmAdapter {
  constructor(private readonly accessToken: string) {}

  async testConnection(): Promise<CrmConnectionTest> {
    const account = await hubSpotRequest<HubSpotAccountResponse>(this.accessToken, "/account-info/v3/details");
    return {
      ok: true,
      provider: "hubspot",
      portalId: account.portalId === undefined ? null : String(account.portalId),
      accountName: typeof account.accountName === "string" ? account.accountName : null,
    };
  }

  async upsertContact(input: CrmContactInput): Promise<CrmContactResult> {
    const properties = contactProperties(input);
    let existingId: string | undefined;
    for (const lookup of [
      input.email ? { propertyName: "email", value: input.email } : null,
      input.phone ? { propertyName: "phone", value: input.phone } : null,
    ]) {
      if (!lookup) continue;
      const search = await hubSpotRequest<HubSpotSearchResponse>(this.accessToken, "/crm/v3/objects/contacts/search", {
        method: "POST",
        body: JSON.stringify({
          filterGroups: [{ filters: [{ propertyName: lookup.propertyName, operator: "EQ", value: lookup.value }] }],
          properties: ["email", "phone"],
          limit: 1,
        }),
      });
      existingId = search.results?.[0]?.id;
      if (existingId) break;
    }

    if (existingId) {
      await hubSpotRequest(this.accessToken, `/crm/v3/objects/contacts/${encodeURIComponent(existingId)}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      return { externalId: existingId, created: false };
    }

    const created = await hubSpotRequest<HubSpotObjectResponse>(this.accessToken, "/crm/v3/objects/contacts", {
      method: "POST",
      body: JSON.stringify({ properties }),
    });
    return { externalId: created.id, created: true };
  }

  async logActivity(input: { contactId: string; body: string }): Promise<void> {
    await hubSpotRequest(this.accessToken, "/crm/v3/objects/notes", {
      method: "POST",
      body: JSON.stringify({
        properties: { hs_note_body: input.body.slice(0, 4_000), hs_timestamp: new Date().toISOString() },
        associations: [{
          to: { id: input.contactId },
          types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: 202 }],
        }],
      }),
    });
  }
}

export function createCrmAdapter(provider: CrmProvider, accessToken: string): CrmAdapter {
  if (provider === "hubspot") return new HubSpotAdapter(accessToken);
  throw new Error(`Unsupported CRM provider: ${provider}`);
}

export function integrationEncryptionConfigured(): boolean {
  return credentialsConfigured();
}

export function encryptIntegrationCredentials(credentials: WebhookCredentials | { accessToken: string }): string {
  return encryptSecret(JSON.stringify(credentials));
}

export function decryptIntegrationCredentials(payload: string): WebhookCredentials & { accessToken?: string } {
  const parsed = JSON.parse(decryptSecret(payload)) as unknown;
  if (!parsed || typeof parsed !== "object") throw new Error("CRM credentials are invalid");
  return parsed as WebhookCredentials & { accessToken?: string };
}

export function validateWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("webhookUrl is required");
  const url = new URL(value.trim());
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) throw new Error("webhookUrl must use HTTPS");
  return url.toString();
}

export async function sendWebhookEvent(credentials: WebhookCredentials, payload: CrmLeadPayload, idempotencyKey: string): Promise<{ remoteObjectId?: string; remoteUrl?: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const body = JSON.stringify(payload);
  try {
    const signature = credentials.signingSecret
      ? createHmac("sha256", credentials.signingSecret).update(body).digest("hex")
      : undefined;
    const response = await fetch(credentials.webhookUrl, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "user-agent": "FrontDeskWise-CRM/1.0",
        "x-frontdeskwise-event": payload.eventType,
        "x-frontdeskwise-idempotency-key": idempotencyKey,
        ...(signature ? { "x-frontdeskwise-signature": `sha256=${signature}` } : {}),
      },
      body,
    });
    if (!response.ok) throw new Error(`CRM webhook request failed (${response.status})`);
    let responseBody: unknown = null;
    try { responseBody = await response.json(); } catch { /* Empty 2xx responses are valid. */ }
    const record = responseBody && typeof responseBody === "object" ? responseBody as Record<string, unknown> : {};
    return {
      remoteObjectId: typeof record.id === "string" ? record.id : undefined,
      remoteUrl: typeof record.url === "string" ? record.url : undefined,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("CRM webhook request timed out");
    if (error instanceof Error && error.message.startsWith("CRM webhook request failed")) throw error;
    throw new Error("CRM webhook request could not be completed");
  } finally {
    clearTimeout(timeout);
  }
}
