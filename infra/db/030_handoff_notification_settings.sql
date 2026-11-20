-- Business-owned routing for human handoff alerts.
-- Delivery remains asynchronous through message_deliveries.

create table if not exists business_notification_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  handoff_enabled boolean not null default true,
  default_recipient_email text,
  additional_recipient_emails jsonb not null default '[]'::jsonb,
  handoff_delay_seconds integer not null default 0
    check (handoff_delay_seconds in (0, 120, 300)),
  repeat_enabled boolean not null default false,
  repeat_after_seconds integer not null default 600
    check (repeat_after_seconds between 60 and 86400),
  notify_explicit_human_request boolean not null default true,
  notify_knowledge_gap boolean not null default false,
  notify_high_value_lead boolean not null default true,
  notify_every_lead boolean not null default false,
  updated_at timestamptz not null default now()
);

create index if not exists business_notification_settings_updated_idx
  on business_notification_settings (updated_at desc);
