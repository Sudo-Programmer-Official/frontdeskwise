import assert from "node:assert/strict";
import test from "node:test";
import { nextTenantPublicationVersion, tenantPublicationHash, workflowConfigHash } from "../src/tenant-publication.js";

test("tenant publication versions advance from the last published snapshot", () => {
  assert.equal(nextTenantPublicationVersion(null), 1);
  assert.equal(nextTenantPublicationVersion(undefined), 1);
  assert.equal(nextTenantPublicationVersion(1), 2);
  assert.equal(nextTenantPublicationVersion(8), 9);
});

test("tenant publication hashes change when tenant behavior changes", () => {
  const base = {
    agentConfig: { assistantName: "Assistant" },
    actions: [{ key: "book", name: "Book", version: 1 }],
    primaryActionId: "action-1",
    contextVersion: 4,
  };
  assert.equal(tenantPublicationHash(base), tenantPublicationHash({ ...base, actions: [{ key: "book", name: "Book", version: 2 }] }));
  assert.notEqual(tenantPublicationHash(base), tenantPublicationHash({ ...base, actions: [{ key: "book", name: "Book now", version: 2 }] }));
  assert.notEqual(tenantPublicationHash(base), tenantPublicationHash({ ...base, contextVersion: 5 }));
});

test("publication hashes ignore persistence metadata and object key order", () => {
  const first = {
    id: "workflow-1",
    name: "SalonFlow fit",
    steps: [{ id: "capture", type: "capture", config: { topic: "business" } }],
    version: 2,
    updatedAt: "2026-11-23T12:00:00.000Z",
    readiness: { ready: true },
  };
  const second = {
    readiness: { ready: false, reason: "temporary check" },
    updatedAt: "2026-11-23T13:00:00.000Z",
    steps: [{ config: { topic: "business" }, type: "capture", id: "capture" }],
    name: "SalonFlow fit",
    id: "workflow-1",
    version: 3,
  };

  assert.equal(workflowConfigHash(first), workflowConfigHash(second));
  assert.equal(
    tenantPublicationHash({ agentConfig: { fallbackBehavior: "human" }, actions: [first], primaryActionId: null, contextVersion: 4 }),
    tenantPublicationHash({ agentConfig: { fallbackBehavior: "human" }, actions: [second], primaryActionId: null, contextVersion: 4 }),
  );
});
