import assert from "node:assert/strict";
import test from "node:test";
import {
  actionResourceFromJackrabbit,
  normalizeActionResource,
  resolveAction,
} from "../src/action-registry.js";

const now = "2026-11-20T12:00:00.000Z";

function resource(input: Record<string, unknown>) {
  return normalizeActionResource({
    businessId: "business",
    type: "job_application",
    name: "Senior Backend Engineer",
    provider: "manual",
    destination: { url: "https://jobs.example/apply", label: "Apply now" },
    ...input,
  } as never, now);
}

test("action registry resolves only active resources and returns safe destinations", () => {
  const active = resource({ id: "active", location: "Tampa", department: "Engineering", role: "Backend Engineer" });
  const closed = resource({ id: "closed", location: "Tampa", status: "INACTIVE" });
  const expired = resource({ id: "expired", location: "Tampa", validUntil: "2026-11-19T23:59:59.000Z" });
  const result = resolveAction([active, closed, expired], {
    type: "job_application",
    filters: { location: "Tampa", department: "engineering", role: "backend" },
    now,
  });
  assert.equal(result.status, "matched");
  assert.deepEqual(result.matches.map((item) => item.id), ["active"]);
  assert.equal("conditions" in result.matches[0], false);
  assert.equal(result.matches[0].destination?.url, "https://jobs.example/apply");
});

test("multiple valid resources remain ambiguous instead of guessing a link", () => {
  const resources = [
    resource({ id: "one", name: "Turtle 2 Sunday", type: "registration", program: "Turtle 2", location: "Largo", destination: "https://register.example/one" }),
    resource({ id: "two", name: "Turtle 2 Wednesday", type: "registration", program: "Turtle 2", location: "Largo", destination: "https://register.example/two" }),
  ];
  const result = resolveAction(resources, { type: "registration", filters: { program: "Turtle 2", location: "Largo" }, now });
  assert.equal(result.status, "ambiguous");
  assert.equal(result.matches.length, 2);
});

test("Jackrabbit resources carry provider identity and live availability state", () => {
  const result = actionResourceFromJackrabbit({
    businessId: "business",
    option: {
      id: "19259740",
      name: "Turtle 2",
      location: "Largo",
      days: ["Sunday"],
      startTime: "10:30 AM",
      endTime: "11:15 AM",
      openings: 0,
      waitlistAvailable: true,
      tuition: 145,
      registrationUrl: "https://register.example/class",
    },
    now,
  });
  assert.equal(result.provider, "jackrabbit");
  assert.equal(result.providerObjectId, "19259740");
  assert.equal(result.status, "WAITLIST");
  assert.equal(result.destination?.url, "https://register.example/class");
});
