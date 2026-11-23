import { createHmac } from "node:crypto";
import { createCrmAdapter, type CrmAdapter } from "./crm.js";
import { sendTransactionalEmail, sesConfigured } from "./email.js";
import { assertPublicUrl } from "./crawler.js";

export type ActionConnectorProvider =
  | "generic_webhook"
  | "email"
  | "hubspot"
  | "jackrabbit"
  | "square"
  | "mindbody"
  | "calendly";

export type ActionConnectorSettings = {
  provider: ActionConnectorProvider;
  integrationId?: string;
  recipients?: string[];
  endpoint?: string;
  signingSecret?: string;
  accessToken?: string;
  apiKey?: string;
};

export type ActionInput = {
  idempotencyKey: string;
  tenant: { id: string; slug: string; name: string };
  conversationId: string;
  flow: { id: string; key: string; name: string };
  values: Record<string, string>;
  lead: {
    id: string;
    name: string | null;
    email: string | null;
    phone: string | null;
    intent: string | null;
    status: string;
  } | null;
  completedAt: string;
};

export type ActionResult = {
  provider: ActionConnectorProvider;
  remoteObjectId?: string;
  remoteUrl?: string;
};

export interface ActionConnector {
  validateConfig(): Promise<boolean>;
  execute(input: ActionInput): Promise<ActionResult>;
}

type WebhookConfig = { webhookUrl: string; signingSecret?: string };

function requiredUrl(value: string): URL {
  const url = new URL(value);
  const localDevelopment = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(localDevelopment && url.protocol === "http:")) {
    throw new Error("Action webhook must use HTTPS");
  }
  return url;
}

async function safeEndpoint(value: string): Promise<URL> {
  const url = requiredUrl(value);
  const localDevelopment = process.env.NODE_ENV !== "production"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1");
  if (localDevelopment) return url;
  return assertPublicUrl(value);
}

function timeoutSignal(): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  return { signal: controller.signal, cleanup: () => clearTimeout(timeout) };
}

export class GenericWebhookConnector implements ActionConnector {
  constructor(private readonly config: WebhookConfig) {}

  async validateConfig(): Promise<boolean> {
    await safeEndpoint(this.config.webhookUrl);
    return true;
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    await this.validateConfig();
    const body = JSON.stringify({
      event: "action.completed",
      eventId: input.idempotencyKey,
      tenant: input.tenant,
      conversationId: input.conversationId,
      flow: input.flow,
      values: input.values,
      lead: input.lead,
      completedAt: input.completedAt,
    });
    const signature = this.config.signingSecret
      ? createHmac("sha256", this.config.signingSecret).update(body).digest("hex")
      : undefined;
    const request = timeoutSignal();
    try {
      const response = await fetch(requiredUrl(this.config.webhookUrl), {
        method: "POST",
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "FrontDeskWise-Actions/1.0",
          "x-frontdeskwise-event": "action.completed",
          "x-frontdeskwise-idempotency-key": input.idempotencyKey,
          ...(signature ? { "x-frontdeskwise-signature": `sha256=${signature}` } : {}),
        },
        redirect: "error",
        body,
      });
      if (!response.ok) throw new Error(`Action webhook request failed (${response.status})`);
      let responseBody: unknown = null;
      try { responseBody = await response.json(); } catch { /* Empty 2xx responses are valid. */ }
      const record = responseBody && typeof responseBody === "object" ? responseBody as Record<string, unknown> : {};
      return {
        provider: "generic_webhook",
        remoteObjectId: typeof record.id === "string" ? record.id : undefined,
        remoteUrl: typeof record.url === "string" ? record.url : undefined,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw new Error("Action webhook request timed out");
      throw error instanceof Error ? error : new Error("Action webhook request failed");
    } finally {
      request.cleanup();
    }
  }
}

export class EmailConnector implements ActionConnector {
  constructor(private readonly recipients: string[]) {}

  async validateConfig(): Promise<boolean> {
    if (!sesConfigured()) throw new Error("Email delivery is not configured");
    if (!this.recipients.length) throw new Error("At least one action email recipient is required");
    return true;
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    await this.validateConfig();
    const values = Object.entries(input.values).map(([key, value]) => `${key}: ${value}`).join("\n");
    await sendTransactionalEmail({
      to: this.recipients,
      subject: `${input.tenant.name}: ${input.flow.name} completed`,
      text: [
        `${input.flow.name} was completed through FrontDeskWise.`,
        `Conversation: ${input.conversationId}`,
        input.lead?.email ? `Email: ${input.lead.email}` : null,
        input.lead?.phone ? `Phone: ${input.lead.phone}` : null,
        "",
        values,
      ].filter(Boolean).join("\n"),
    });
    return { provider: "email" };
  }
}

export class HubSpotConnector implements ActionConnector {
  private readonly adapter: CrmAdapter;

  constructor(accessToken: string) {
    this.adapter = createCrmAdapter("hubspot", accessToken);
  }

  async validateConfig(): Promise<boolean> {
    await this.adapter.testConnection();
    return true;
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    await this.validateConfig();
    if (!input.lead) throw new Error("HubSpot action delivery requires a captured lead");
    const contact = await this.adapter.upsertContact({
      email: input.lead.email,
      phone: input.lead.phone,
      name: input.lead.name,
      intent: input.lead.intent,
    });
    await this.adapter.logActivity({
      contactId: contact.externalId,
      body: `FrontDeskWise action completed: ${input.flow.name}.`,
    });
    return { provider: "hubspot", remoteObjectId: contact.externalId };
  }
}

/**
 * Vendor connectors share a deliberately small HTTP contract until the
 * provider-specific OAuth and field mapping are configured for a tenant.
 * Keeping these adapters explicit prevents a vendor from being smuggled into
 * the generic CRM lead pipeline while still giving us a stable extension seam.
 */
class VendorApiConnector implements ActionConnector {
  constructor(
    private readonly provider: ActionConnectorProvider,
    private readonly config: Pick<ActionConnectorSettings, "endpoint" | "accessToken" | "apiKey">,
  ) {}

  async validateConfig(): Promise<boolean> {
    if (!this.config.endpoint) throw new Error(`${this.provider} endpoint is required`);
    await safeEndpoint(this.config.endpoint);
    if (!this.config.accessToken && !this.config.apiKey) throw new Error(`${this.provider} credentials are required`);
    return true;
  }

  async execute(input: ActionInput): Promise<ActionResult> {
    await this.validateConfig();
    const request = timeoutSignal();
    try {
      const response = await fetch(requiredUrl(this.config.endpoint!), {
        method: "POST",
        signal: request.signal,
        headers: {
          "content-type": "application/json",
          "user-agent": "FrontDeskWise-Actions/1.0",
          "x-frontdeskwise-idempotency-key": input.idempotencyKey,
          ...(this.config.accessToken ? { authorization: `Bearer ${this.config.accessToken}` } : {}),
          ...(this.config.apiKey ? { "x-api-key": this.config.apiKey } : {}),
        },
        redirect: "error",
        body: JSON.stringify({ provider: this.provider, ...input }),
      });
      if (!response.ok) throw new Error(`${this.provider} action request failed (${response.status})`);
      let responseBody: unknown = null;
      try { responseBody = await response.json(); } catch { /* Empty 2xx responses are valid. */ }
      const record = responseBody && typeof responseBody === "object" ? responseBody as Record<string, unknown> : {};
      return {
        provider: this.provider,
        remoteObjectId: typeof record.id === "string" ? record.id : undefined,
        remoteUrl: typeof record.url === "string" ? record.url : undefined,
      };
    } finally {
      request.cleanup();
    }
  }
}

export class JackrabbitConnector extends VendorApiConnector { constructor(config: ActionConnectorSettings) { super("jackrabbit", config); } }
export class SquareConnector extends VendorApiConnector { constructor(config: ActionConnectorSettings) { super("square", config); } }
export class MindbodyConnector extends VendorApiConnector { constructor(config: ActionConnectorSettings) { super("mindbody", config); } }
export class CalendlyConnector extends VendorApiConnector { constructor(config: ActionConnectorSettings) { super("calendly", config); } }

export function createActionConnector(provider: ActionConnectorProvider, config: Omit<ActionConnectorSettings, "provider">): ActionConnector {
  switch (provider) {
    case "generic_webhook": return new GenericWebhookConnector({ webhookUrl: String(config.endpoint ?? ""), signingSecret: config.signingSecret });
    case "email": return new EmailConnector(config.recipients ?? []);
    case "hubspot": return new HubSpotConnector(String(config.accessToken ?? ""));
    case "jackrabbit": return new JackrabbitConnector({ provider, ...config });
    case "square": return new SquareConnector({ provider, ...config });
    case "mindbody": return new MindbodyConnector({ provider, ...config });
    case "calendly": return new CalendlyConnector({ provider, ...config });
  }
}
