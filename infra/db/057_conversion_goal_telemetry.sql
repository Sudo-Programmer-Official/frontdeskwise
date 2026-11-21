-- Track the primary conversion CTA as it is shown and when a direct demo link opens.

alter table conversion_events
  drop constraint if exists conversion_events_event_check,
  add constraint conversion_events_event_check
    check (event in (
      'FLOW_STARTED', 'FIELD_VIEWED', 'FIELD_COMPLETED', 'FIELD_ABANDONED',
      'FORM_DISPLAYED', 'FORM_SUBMITTED', 'ACTION_STARTED', 'ACTION_SUCCEEDED',
      'ACTION_FAILED', 'FLOW_COMPLETED', 'CTA_SHOWN', 'CTA_CLICKED', 'DEMO_LINK_OPENED',
      'HANDOFF_REQUESTED', 'LEAD_CAPTURED', 'BOOKING_LINK_OPENED', 'CONVERSATION_ABANDONED'
    ));
