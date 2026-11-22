-- Time-bounded human handoff: keep AI available after the live-human window
-- expires, while preserving the request for asynchronous team follow-up.

alter table conversations drop constraint if exists conversations_status_check;
alter table conversations add constraint conversations_status_check
  check (status in ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'WAITING_FOR_STAFF', 'FOLLOW_UP_PENDING', 'HUMAN_ACTIVE', 'AI_ASSISTED', 'RESOLVED', 'EXPIRED'));

alter table conversation_events drop constraint if exists conversation_events_event_type_check;
alter table conversation_events add constraint conversation_events_event_type_check
  check (event_type in (
    'AI_HANDOFF_REQUESTED', 'STAFF_NOTIFIED', 'HANDOFF_FOLLOW_UP_PENDING', 'STAFF_ASSIGNED',
    'HUMAN_JOINED', 'MESSAGE_SENT_BY_HUMAN', 'RETURNED_TO_AI',
    'CONVERSATION_RESOLVED', 'CONVERSATION_EXPIRED', 'VISITOR_REPLIED',
    'INTERNAL_NOTE_ADDED', 'AI_RESPONSE_SENT', 'CONVERSATION_DECISION_TRACE',
    'LOOP_GUARD_TRIGGERED'
  ));

alter table business_notification_settings
  add column if not exists handoff_timeout_seconds integer not null default 900
    check (handoff_timeout_seconds in (120, 300, 600, 900, 1800));
