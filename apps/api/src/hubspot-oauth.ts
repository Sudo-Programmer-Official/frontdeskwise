import { URLSearchParams } from "node:url";

export const HUBSPOT_AUTHORIZATION_URL = "https://app.hubspot.com/oauth/authorize";

export type HubSpotOAuthTokenSet = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scopes: string[];
  portalId: string | null;
};

export class HubSpotOAuthError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
    this.name = "HubSpotOAuthError";
  }
}

function configuredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new HubSpotOAuthError(503, `HubSpot OAuth is not configured: ${name} is missing`);
  return value;
}

export function hubSpotOAuthClientId(): string {
  return configuredValue("FRONTDESKWISE_HUBSPOT_CLIENT_ID");
}

export function hubSpotOAuthClientSecret(): string {
  return configuredValue("FRONTDESKWISE_HUBSPOT_CLIENT_SECRET");
}

export function hubSpotOAuthRedirectUri(): string {
  const configured = process.env.FRONTDESKWISE_HUBSPOT_REDIRECT_URI?.trim();
  if (configured) return configured;
  const apiOrigin = process.env.FRONTDESKWISE_PUBLIC_API_ORIGIN?.trim();
  if (!apiOrigin) throw new HubSpotOAuthError(503, "HubSpot OAuth is not configured: FRONTDESKWISE_PUBLIC_API_ORIGIN is missing");
  return `${apiOrigin.replace(/\/$/, "")}/api/v1/integrations/hubspot/callback`;
}

export function hubSpotOAuthVersion(): string {
  const version = process.env.FRONTDESKWISE_HUBSPOT_OAUTH_VERSION?.trim() || "2026-03";
  if (!/^\d{4}-\d{2}$/.test(version)) throw new HubSpotOAuthError(503, "FRONTDESKWISE_HUBSPOT_OAUTH_VERSION must use YYYY-MM format");
  return version;
}

export function hubSpotOAuthScopes(): string[] {
  const configured = process.env.FRONTDESKWISE_HUBSPOT_SCOPES?.trim();
  const scopes = (configured || "oauth crm.objects.contacts.read crm.objects.contacts.write")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  return [...new Set(scopes)].slice(0, 40);
}

export function buildHubSpotAuthorizationUrl(state: string, redirectUri = hubSpotOAuthRedirectUri()): string {
  const url = new URL(HUBSPOT_AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: hubSpotOAuthClientId(),
    redirect_uri: redirectUri,
    scope: hubSpotOAuthScopes().join(" "),
    state,
  }).toString();
  return url.toString();
}

function oauthEndpoint(path: string): string {
  return `https://api.hubapi.com/oauth/${hubSpotOAuthVersion()}${path}`;
}

async function oauthRequest(path: string, parameters: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch(oauthEndpoint(path), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(parameters).toString(),
  });
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object") body = parsed as Record<string, unknown>;
  } catch {
    // Keep OAuth error messages generic when HubSpot returns non-JSON content.
  }
  if (!response.ok) {
    const description = typeof body.error_description === "string" ? body.error_description : "HubSpot OAuth request failed";
    throw new HubSpotOAuthError(response.status, description.slice(0, 300));
  }
  return body;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scopesValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((scope): scope is string => typeof scope === "string" && Boolean(scope.trim())).map((scope) => scope.trim());
  return typeof value === "string" ? value.split(/[\s,]+/).map((scope) => scope.trim()).filter(Boolean) : [];
}

function tokenSetFromResponse(body: Record<string, unknown>, previousRefreshToken?: string): HubSpotOAuthTokenSet {
  const accessToken = stringValue(body.access_token);
  const refreshToken = stringValue(body.refresh_token) ?? previousRefreshToken ?? null;
  if (!accessToken || !refreshToken) throw new HubSpotOAuthError(502, "HubSpot did not return a complete OAuth token set");
  const expiresIn = Number(body.expires_in ?? 1_800);
  const expiresAt = new Date(Date.now() + Math.max(60, Number.isFinite(expiresIn) ? expiresIn : 1_800) * 1_000).toISOString();
  return {
    accessToken,
    refreshToken,
    expiresAt,
    scopes: scopesValue(body.scopes),
    portalId: stringValue(body.hub_id) ?? stringValue(body.portal_id),
  };
}

export async function exchangeHubSpotAuthorizationCode(code: string, redirectUri = hubSpotOAuthRedirectUri()): Promise<HubSpotOAuthTokenSet> {
  const body = await oauthRequest("/token", {
    grant_type: "authorization_code",
    code,
    client_id: hubSpotOAuthClientId(),
    client_secret: hubSpotOAuthClientSecret(),
    redirect_uri: redirectUri,
  });
  return tokenSetFromResponse(body);
}

export async function refreshHubSpotAccessToken(refreshToken: string): Promise<HubSpotOAuthTokenSet> {
  const body = await oauthRequest("/token", {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: hubSpotOAuthClientId(),
    client_secret: hubSpotOAuthClientSecret(),
  });
  return tokenSetFromResponse(body, refreshToken);
}

export async function revokeHubSpotRefreshToken(refreshToken: string): Promise<void> {
  await oauthRequest("/token/revoke", {
    token: refreshToken,
    token_type_hint: "refresh_token",
    client_id: hubSpotOAuthClientId(),
    client_secret: hubSpotOAuthClientSecret(),
  });
}

export function hubSpotOAuthConfigured(): boolean {
  try {
    hubSpotOAuthClientId();
    hubSpotOAuthClientSecret();
    hubSpotOAuthRedirectUri();
    hubSpotOAuthVersion();
    return true;
  } catch {
    return false;
  }
}
