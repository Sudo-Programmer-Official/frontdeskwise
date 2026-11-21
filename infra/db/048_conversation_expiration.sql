-- Returning visitors must not inherit a stale handoff forever.
alter table conversations drop constraint if exists conversations_status_check;
alter table conversations add constraint conversations_status_check
  check (status in ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'WAITING_FOR_STAFF', 'HUMAN_ACTIVE', 'AI_ASSISTED', 'RESOLVED', 'EXPIRED'));

-- Keep the event type constraint compatible with the new expiration audit event.
alter table conversation_events drop constraint if exists conversation_events_event_type_check;
alter table conversation_events add constraint conversation_events_event_type_check
  check (event_type in (
    'AI_HANDOFF_REQUESTED', 'STAFF_NOTIFIED', 'STAFF_ASSIGNED',
    'HUMAN_JOINED', 'MESSAGE_SENT_BY_HUMAN', 'RETURNED_TO_AI',
    'CONVERSATION_RESOLVED', 'CONVERSATION_EXPIRED', 'VISITOR_REPLIED',
    'INTERNAL_NOTE_ADDED', 'AI_RESPONSE_SENT'
  ));

create index if not exists conversations_session_activity_idx
  on conversations (business_id, session_id, last_activity_at desc);
