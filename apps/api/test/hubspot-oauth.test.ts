import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHubSpotAuthorizationUrl,
  exchangeHubSpotAuthorizationCode,
  refreshHubSpotAccessToken,
  revokeHubSpotRefreshToken,
} from "../src/hubspot-oauth.js";

const environment = {
  clientId: process.env.FRONTDESKWISE_HUBSPOT_CLIENT_ID,
  clientSecret: process.env.FRONTDESKWISE_HUBSPOT_CLIENT_SECRET,
  redirectUri: process.env.FRONTDESKWISE_HUBSPOT_REDIRECT_URI,
  oauthVersion: process.env.FRONTDESKWISE_HUBSPOT_OAUTH_VERSION,
  scopes: process.env.FRONTDESKWISE_HUBSPOT_SCOPES,
};

function configureOAuthEnvironment(): void {
  process.env.FRONTDESKWISE_HUBSPOT_CLIENT_ID = "client-id";
  process.env.FRONTDESKWISE_HUBSPOT_CLIENT_SECRET = "client-secret";
  process.env.FRONTDESKWISE_HUBSPOT_REDIRECT_URI = "https://api.example.test/api/v1/integrations/hubspot/callback";
  process.env.FRONTDESKWISE_HUBSPOT_OAUTH_VERSION = "2026-03";
  process.env.FRONTDESKWISE_HUBSPOT_SCOPES = "oauth crm.objects.contacts.read crm.objects.contacts.write";
}

function restoreOAuthEnvironment(): void {
  const values: Record<string, string | undefined> = {
    FRONTDESKWISE_HUBSPOT_CLIENT_ID: environment.clientId,
    FRONTDESKWISE_HUBSPOT_CLIENT_SECRET: environment.clientSecret,
    FRONTDESKWISE_HUBSPOT_REDIRECT_URI: environment.redirectUri,
    FRONTDESKWISE_HUBSPOT_OAUTH_VERSION: environment.oauthVersion,
    FRONTDESKWISE_HUBSPOT_SCOPES: environment.scopes,
  };
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("HubSpot authorization URL uses configured redirect and least-privilege scopes", () => {
  configureOAuthEnvironment();
  try {
    const url = new URL(buildHubSpotAuthorizationUrl("opaque-state"));
    assert.equal(url.origin, "https://app.hubspot.com");
    assert.equal(url.pathname, "/oauth/authorize");
    assert.equal(url.searchParams.get("state"), "opaque-state");
    assert.equal(url.searchParams.get("redirect_uri"), environment.redirectUri);
    assert.equal(url.searchParams.get("scope"), "oauth crm.objects.contacts.read crm.objects.contacts.write");
  } finally {
    restoreOAuthEnvironment();
  }
});

test("HubSpot OAuth token operations send credentials in the POST body", async () => {
  configureOAuthEnvironment();
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", expires_in: 1800, hub_id: 248076659, scopes: "oauth crm.objects.contacts.read" }), { status: 200 });
  };
  try {
    await exchangeHubSpotAuthorizationCode("authorization-code");
    await refreshHubSpotAccessToken("refresh");
    await revokeHubSpotRefreshToken("refresh");
    assert.deepEqual(requests.map((request) => request.url), [
      "https://api.hubapi.com/oauth/2026-03/token",
      "https://api.hubapi.com/oauth/2026-03/token",
      "https://api.hubapi.com/oauth/2026-03/token/revoke",
    ]);
    assert.match(requests[0].body, /grant_type=authorization_code/);
    assert.match(requests[0].body, /client_secret=client-secret/);
    assert.match(requests[1].body, /grant_type=refresh_token/);
    assert.match(requests[2].body, /token_type_hint=refresh_token/);
  } finally {
    globalThis.fetch = originalFetch;
    restoreOAuthEnvironment();
  }
});
