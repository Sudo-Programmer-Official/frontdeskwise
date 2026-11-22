-- Repair deployments where the improvement-signal event constraint was not
-- applied or migration 066 was recorded before its conversion-event change.
-- Keep this idempotent so it is safe to run during a rolling deployment.

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
