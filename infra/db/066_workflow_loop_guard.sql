-- Loop detection is an auditable conversation event, not a silent runtime
-- fallback. The persisted action_state carries the compact fingerprint/count.

alter table conversation_events drop constraint if exists conversation_events_event_type_check;
alter table conversation_events add constraint conversation_events_event_type_check
  check (event_type in (
    'AI_HANDOFF_REQUESTED', 'STAFF_NOTIFIED', 'STAFF_ASSIGNED',
    'HUMAN_JOINED', 'MESSAGE_SENT_BY_HUMAN', 'RETURNED_TO_AI',
    'CONVERSATION_RESOLVED', 'CONVERSATION_EXPIRED', 'VISITOR_REPLIED',
    'INTERNAL_NOTE_ADDED', 'AI_RESPONSE_SENT', 'CONVERSATION_DECISION_TRACE',
    'LOOP_GUARD_TRIGGERED'
  ));

create index if not exists conversation_events_loop_guard_idx
  on conversation_events (business_id, conversation_id, created_at desc)
  where event_type = 'LOOP_GUARD_TRIGGERED';

alter table conversion_events
  drop constraint if exists conversion_events_event_check,
  add constraint conversion_events_event_check
    check (event in (
      'FLOW_STARTED', 'FIELD_VIEWED', 'FIELD_COMPLETED', 'FIELD_ABANDONED',
      'FORM_DISPLAYED', 'FORM_SUBMITTED', 'ACTION_STARTED', 'ACTION_SUCCEEDED',
      'ACTION_FAILED', 'FLOW_COMPLETED', 'CTA_SHOWN', 'CTA_CLICKED', 'DEMO_LINK_OPENED',
      'HANDOFF_REQUESTED', 'LEAD_CAPTURED', 'BOOKING_LINK_OPENED', 'CONVERSATION_ABANDONED',
      'IMPROVEMENT_SIGNAL'
    ));

create index if not exists conversion_events_improvement_signal_idx
  on conversion_events (business_id, occurred_at desc)
  where event = 'IMPROVEMENT_SIGNAL';
