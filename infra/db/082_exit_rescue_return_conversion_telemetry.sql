-- Track whether a saved Exit Rescue journey returned and later converted.
-- These are journey-level metrics, so the application de-duplicates them by
-- conversation when building the owner funnel.

alter table conversion_events
  drop constraint if exists conversion_events_event_check,
  add constraint conversion_events_event_check
    check (event in (
      'FLOW_STARTED', 'FIELD_VIEWED', 'FIELD_COMPLETED', 'FIELD_ABANDONED',
      'FORM_DISPLAYED', 'FORM_SUBMITTED', 'ACTION_STARTED', 'ACTION_SUCCEEDED',
      'ACTION_FAILED', 'FLOW_COMPLETED', 'CTA_SHOWN', 'CTA_CLICKED', 'DEMO_LINK_OPENED',
      'HANDOFF_REQUESTED', 'LEAD_CAPTURED', 'EXIT_RESCUE_OFFERED', 'EXIT_RESCUE_SAVED',
      'EXIT_RESCUE_RETURNED', 'EXIT_RESCUE_CONVERTED', 'EXIT_RESCUE_DECLINED',
      'BOOKING_LINK_OPENED', 'CONVERSATION_ABANDONED', 'IMPROVEMENT_SIGNAL'
    ));

drop index if exists conversion_events_exit_rescue_idx;
create index if not exists conversion_events_exit_rescue_idx
  on conversion_events (business_id, flow_id, event, occurred_at desc)
  where event in (
    'EXIT_RESCUE_OFFERED', 'EXIT_RESCUE_SAVED', 'EXIT_RESCUE_RETURNED',
    'EXIT_RESCUE_CONVERTED', 'EXIT_RESCUE_DECLINED'
  );
