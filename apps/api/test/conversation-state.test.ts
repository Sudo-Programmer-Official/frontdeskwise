import assert from "node:assert/strict";
import test from "node:test";
import {
  answerConversationAcknowledgement,
  answerConversationStateQuestion,
  classifyConversationStateQuestion,
  isAcknowledgement,
} from "../src/conversation-state.js";

test("acknowledgements are recognized without treating them as knowledge questions", () => {
  for (const phrase of ["okay", "sounds good", "great", "perfect", "awesome", "got it", "thanks", "thank you", "cool", "works for me"]) {
    assert.equal(isAcknowledgement(phrase), true, phrase);
  }
  assert.equal(isAcknowledgement("What are your hours?"), false);
});

test("acknowledgement responses follow saved, waiting, workflow, and neutral state", () => {
  assert.equal(
    answerConversationAcknowledgement("sounds good", { requestSaved: true, waitingForStaff: true }),
    "Perfect — the team has your request. I’m still here if you need anything else.",
  );
  assert.equal(
    answerConversationAcknowledgement("thanks", { requestSaved: true }),
    "Perfect — your request is saved. Let me know if you need anything else.",
  );
  assert.equal(
    answerConversationAcknowledgement("great", { workflowPrompt: "Which days work best?" }),
    "Got it — which days work best?",
  );
  assert.equal(
    answerConversationAcknowledgement("cool"),
    "Sounds good — let me know if you need anything else.",
  );
});

test("contact-state questions are classified before knowledge retrieval", () => {
  assert.equal(classifyConversationStateQuestion("do you have my details"), "details");
  assert.equal(classifyConversationStateQuestion("did you save my email?"), "email");
  assert.equal(classifyConversationStateQuestion("am I waiting for someone?"), "waiting");
  assert.equal(classifyConversationStateQuestion("which class did I choose?"), "selected_class");
});

test("details answer reports known channels without exposing an internal failure", () => {
  const answer = answerConversationStateQuestion("do you have my details?", {
    email: "visitor@example.com",
    handoffState: "WAITING_FOR_STAFF",
  });

  assert.equal(answer?.answer, "I have your email, but I’m still missing your phone number.");
});

test("details answer asks for contact information when state is empty", () => {
  const answer = answerConversationStateQuestion("do you have my details?", { handoffState: "AI_ACTIVE" });
  assert.equal(answer?.answer, "I don’t have your contact details yet. What’s the best email or phone number to reach you?");
});

test("waiting and selected-class questions read structured state", () => {
  assert.equal(
    answerConversationStateQuestion("am I waiting for someone?", { handoffState: "WAITING_FOR_STAFF" })?.answer,
    "Yes — your message has been saved for the team. A team member will reply here shortly.",
  );
  assert.equal(
    answerConversationStateQuestion("which class did I choose?", { selectedClass: "Saturday 10am" })?.answer,
    "You selected Saturday 10am.",
  );
});

