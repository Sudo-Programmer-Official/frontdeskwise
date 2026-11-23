-- Exit rescue is a conversion safety net inside a workflow. Keep the
-- telemetry events constrained so funnel reporting can distinguish an offer,
-- a saved pause, and an explicit decline.

alter table conversion_events
  drop constraint if exists conversion_events_event_check,
  add constraint conversion_events_event_check
    check (event in (
      'FLOW_STARTED', 'FIELD_VIEWED', 'FIELD_COMPLETED', 'FIELD_ABANDONED',
      'FORM_DISPLAYED', 'FORM_SUBMITTED', 'ACTION_STARTED', 'ACTION_SUCCEEDED',
      'ACTION_FAILED', 'FLOW_COMPLETED', 'CTA_SHOWN', 'CTA_CLICKED', 'DEMO_LINK_OPENED',
      'HANDOFF_REQUESTED', 'LEAD_CAPTURED', 'EXIT_RESCUE_OFFERED', 'EXIT_RESCUE_SAVED',
      'EXIT_RESCUE_DECLINED', 'BOOKING_LINK_OPENED', 'CONVERSATION_ABANDONED',
      'IMPROVEMENT_SIGNAL'
    ));

create index if not exists conversion_events_exit_rescue_idx
  on conversion_events (business_id, flow_id, event, occurred_at desc)
  where event in ('EXIT_RESCUE_OFFERED', 'EXIT_RESCUE_SAVED', 'EXIT_RESCUE_DECLINED');
