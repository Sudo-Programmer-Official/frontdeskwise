-- One structured routing/workflow trace per visitor turn. The trace is stored
-- in the existing conversation_events stream so Inbox and Super Admin replay
-- share the same timeline without introducing a second observability system.

alter table conversation_events drop constraint if exists conversation_events_event_type_check;
alter table conversation_events add constraint conversation_events_event_type_check
  check (event_type in (
    'AI_HANDOFF_REQUESTED', 'STAFF_NOTIFIED', 'STAFF_ASSIGNED',
    'HUMAN_JOINED', 'MESSAGE_SENT_BY_HUMAN', 'RETURNED_TO_AI',
    'CONVERSATION_RESOLVED', 'CONVERSATION_EXPIRED', 'VISITOR_REPLIED',
    'INTERNAL_NOTE_ADDED', 'AI_RESPONSE_SENT', 'CONVERSATION_DECISION_TRACE'
  ));

create index if not exists conversation_events_decision_trace_idx
  on conversation_events (business_id, conversation_id, created_at desc)
  where event_type = 'CONVERSATION_DECISION_TRACE';
