-- Durable visitor-facing resilience state. The widget can tell the difference
-- between a notification that was delivered, queued, or not delivered.
alter table conversations
  add column if not exists handoff_notification_status text
    check (handoff_notification_status in ('sent', 'pending', 'failed'));

create index if not exists conversations_handoff_notification_idx
  on conversations (business_id, handoff_notification_status, last_activity_at desc)
  where handoff_notification_status is not null;

alter table agent_configs
  add column if not exists fallback_phone text,
  add column if not exists fallback_email text,
  add column if not exists fallback_contact_url text;
