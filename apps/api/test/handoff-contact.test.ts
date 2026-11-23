import assert from "node:assert/strict";
import test from "node:test";
import { extractHandoffContact, hasHandoffContactChannel, mergeHandoffContacts } from "../src/handoff-contact.js";

test("handoff contact extraction accepts either email or phone", () => {
  assert.deepEqual(extractHandoffContact("I'm Alex. You can reach me at alex@example.com."), {
    name: "Alex",
    email: "alex@example.com",
    phone: null,
  });
  assert.equal(hasHandoffContactChannel(extractHandoffContact("Call me at (555) 555-0123")), true);
  assert.equal(hasHandoffContactChannel(extractHandoffContact("My name is Alex")), false);
});

test("known contact details are merged without asking for an existing channel again", () => {
  assert.deepEqual(mergeHandoffContacts(
    { name: "Alex", email: "alex@example.com" },
    { phone: "+1 555 555 0123" },
  ), {
    name: "Alex",
    email: "alex@example.com",
    phone: "+1 555 555 0123",
  });
});

