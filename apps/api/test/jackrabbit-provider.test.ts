import assert from "node:assert/strict";
import test from "node:test";
import { decryptIntegrationCredentials, encryptIntegrationCredentials } from "../src/crm.js";
import { JackrabbitProvider } from "../src/jackrabbit-provider.js";
import { credentialHint } from "../src/secrets.js";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("Jackrabbit provider verifies the organization, merges classes with live listings, and finds Largo Turtle 2 options", async () => {
  const requests: Array<{ url: string; headers: Headers }> = [];
  const provider = new JackrabbitProvider({
    accessToken: "test-token",
    baseUrl: "http://127.0.0.1:9999",
    organizationId: "org-123",
    fetcher: async (input, init) => {
      const url = String(input);
      requests.push({ url, headers: new Headers(init?.headers) });
      if (url.includes("Options/me")) return response({ organizationId: "org-123", organizationName: "BSS" });
      if (url.includes("/Classes?")) {
        return response({ items: [
          { Id: "class-wed", Name: "Turtle 2", LocationName: "Largo", Days: ["Wednesday"], StartTime: "10:30 AM" },
          { Id: "class-sun", Name: "Turtle 2", LocationName: "Largo", Days: ["Sunday"], StartTime: "10:30 AM" },
        ], totalCount: 2 });
      }
      if (url.includes("/ClassListings?")) {
        return response({ data: [
          { Id: "listing-wed", ClassId: "class-wed", ClassName: "Turtle 2", Location: { Name: "Largo" }, DayOfWeek: "Wednesday", Openings: 3, OnlineRegistrationUrl: "https://register.example/wed" },
          { Id: "listing-sun", ClassId: "class-sun", ClassName: "Turtle 2", Location: { Name: "Largo" }, DayOfWeek: "Sunday", Openings: 0, WaitlistAvailable: true },
          { ClassId: "other-location", ClassName: "Turtle 2", LocationName: "Clearwater", DayOfWeek: "Sunday" },
        ], totalCount: 3 });
      }
      throw new Error(`Unexpected request: ${url}`);
    },
  });

  assert.deepEqual(await provider.verifyConnection(), {
    id: "org-123",
    name: "BSS",
    raw: { organizationId: "org-123", organizationName: "BSS" },
  });
  const options = await provider.findClassOptions({ name: "Turtle 2", location: "Largo" });
  assert.deepEqual(options.map((item) => ({ id: item.id, day: item.days[0], openings: item.openings })), [
    { id: "class-sun", day: "Sunday", openings: 0 },
    { id: "class-wed", day: "Wednesday", openings: 3 },
  ]);
  assert.equal(options[0].waitlistAvailable, true);
  assert.equal(options[1].registrationUrl, "https://register.example/wed");
  assert.equal(requests.filter((item) => item.url.includes("Classes?")).length, 1);
  assert.equal(requests.every((item) => item.headers.get("authorization") === "Bearer test-token"), true);
  assert.equal(requests.every((item) => item.headers.get("x-org-id") === "org-123"), true);
});

test("Jackrabbit provider generates a class-id-prefilled registration link without exposing the API token", () => {
  const provider = new JackrabbitProvider({ accessToken: "secret-token", baseUrl: "http://127.0.0.1:9999" });
  const result = provider.buildRegistrationLink(
    {
      baseUrl: "https://register.example/start",
      classIdParam: "class_id",
      fieldMappings: { email: "email", parent_name: "guardian" },
      staticParams: { source: "frontdeskwise" },
    },
    { id: "class-wed" },
    { email: "parent@example.com", parent_name: "Parent" },
  );
  assert.equal(result.url, "https://register.example/start?email=parent%40example.com&guardian=Parent&class_id=class-wed&source=frontdeskwise");
  assert.equal(result.url.includes("secret-token"), false);
  assert.deepEqual(result.missingFields, []);
});

test("Jackrabbit provider includes correlation context on API failures", async () => {
  const provider = new JackrabbitProvider({
    accessToken: "test-token",
    baseUrl: "http://127.0.0.1:9999",
    fetcher: async () => new Response(JSON.stringify({ title: "Unauthorized" }), {
      status: 401,
      headers: { "x-correlation-id": "corr-123" },
    }),
  });
  await assert.rejects(() => provider.verifyConnection(), /Jackrabbit API request failed \(401; correlation corr-123\)/);
});

test("Jackrabbit credentials are encrypted and only expose a last-four display hint", () => {
  const previousKey = process.env.FRONTDESKWISE_CREDENTIAL_KEY;
  process.env.FRONTDESKWISE_CREDENTIAL_KEY = "12345678901234567890123456789012";
  try {
    const token = "customer-secret-token-8F2A";
    const encrypted = encryptIntegrationCredentials({ apiToken: token });
    assert.equal(encrypted.includes(token), false);
    assert.deepEqual(decryptIntegrationCredentials(encrypted), { apiToken: token });
    assert.equal(credentialHint(token), "••••8F2A");
  } finally {
    if (previousKey === undefined) delete process.env.FRONTDESKWISE_CREDENTIAL_KEY;
    else process.env.FRONTDESKWISE_CREDENTIAL_KEY = previousKey;
  }
});
