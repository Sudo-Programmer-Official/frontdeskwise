import assert from "node:assert/strict";
import test from "node:test";
import { allowedDocumentTypeList, isAllowedDocumentType, organizationDocumentKey } from "../src/storage.ts";

test("document storage accepts only parsers supported by ingestion", () => {
  assert.equal(isAllowedDocumentType("application/pdf"), true);
  assert.equal(isAllowedDocumentType("application/vnd.openxmlformats-officedocument.wordprocessingml.document"), true);
  assert.equal(isAllowedDocumentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), true);
  assert.equal(isAllowedDocumentType("application/msword"), false);
  assert.equal(allowedDocumentTypeList().includes("application/msword"), false);
});

test("document object keys keep uploads scoped to the organization and business", () => {
  assert.equal(
    organizationDocumentKey({ organizationId: "org-1", businessId: "biz-1", documentId: "doc-1", fileName: "  pricing plan.pdf  " }),
    "organizations/org-1/businesses/biz-1/documents/doc-1/pricing-plan.pdf",
  );
});
