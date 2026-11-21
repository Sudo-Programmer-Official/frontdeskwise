-- Owner-confirmed conversion semantics for deterministic CTA selection.
alter table business_actions
  add column if not exists execution_mode text not null default 'FORM_FLOW',
  add column if not exists attachment_policy text not null default 'explicit_request_only',
  add column if not exists tracking_key text;

update business_actions
set execution_mode = case
      when action_type in ('call_business', 'call_emergency') then 'PHONE'
      when coalesce(destination->>'url', completion->>'linkUrl', '') <> '' then 'DIRECT_LINK'
      when completion->>'completionMode' in ('external_provider', 'booking_connector') then 'PROVIDER_FLOW'
      when coalesce(completion->'connector'->>'provider', '') <> '' then 'API_ACTION'
      else 'FORM_FLOW'
    end,
    attachment_policy = case
      when action_type = 'call_emergency' then 'explicit_request_only'
      when action_key in ('request_demo', 'contact_team', 'capture_lead') then 'explicit_request_only'
      when action_type in ('external_booking', 'enroll', 'book_appointment') then 'high_intent_only'
      else 'sales_intent'
    end,
    tracking_key = coalesce(nullif(tracking_key, ''), action_key)
where tracking_key is null
   or tracking_key = ''
   or execution_mode = 'FORM_FLOW' and (
        action_type in ('call_business', 'call_emergency')
        or coalesce(destination->>'url', completion->>'linkUrl', '') <> ''
        or completion->>'completionMode' in ('external_provider', 'booking_connector')
        or coalesce(completion->'connector'->>'provider', '') <> ''
      )
   or attachment_policy = 'explicit_request_only'
      and action_type <> 'call_emergency'
      and action_key not in ('request_demo', 'contact_team', 'capture_lead');

alter table business_actions
  drop constraint if exists business_actions_execution_mode_check,
  add constraint business_actions_execution_mode_check check (execution_mode in ('DIRECT_LINK', 'FORM_FLOW', 'PROVIDER_FLOW', 'PHONE', 'EMAIL', 'HANDOFF', 'API_ACTION')),
  drop constraint if exists business_actions_attachment_policy_check,
  add constraint business_actions_attachment_policy_check check (attachment_policy in ('always', 'sales_intent', 'high_intent_only', 'explicit_request_only', 'never_auto'));

create index if not exists business_actions_conversion_semantics_idx
  on business_actions (business_id, enabled, attachment_policy, execution_mode);
