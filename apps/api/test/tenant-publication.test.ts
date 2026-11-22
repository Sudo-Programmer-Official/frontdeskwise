import assert from "node:assert/strict";
import test from "node:test";
import { nextTenantPublicationVersion, tenantPublicationHash } from "../src/tenant-publication.js";

test("tenant publication versions advance from the last published snapshot", () => {
  assert.equal(nextTenantPublicationVersion(null), 1);
  assert.equal(nextTenantPublicationVersion(undefined), 1);
  assert.equal(nextTenantPublicationVersion(1), 2);
  assert.equal(nextTenantPublicationVersion(8), 9);
});

test("tenant publication hashes change when tenant behavior changes", () => {
  const base = {
    agentConfig: { assistantName: "Assistant" },
    actions: [{ key: "book", version: 1 }],
    primaryActionId: "action-1",
    contextVersion: 4,
  };
  assert.equal(tenantPublicationHash(base), tenantPublicationHash({ ...base, actions: [{ key: "book", version: 1 }] }));
  assert.notEqual(tenantPublicationHash(base), tenantPublicationHash({ ...base, actions: [{ key: "book", version: 2 }] }));
  assert.notEqual(tenantPublicationHash(base), tenantPublicationHash({ ...base, contextVersion: 5 }));
});
