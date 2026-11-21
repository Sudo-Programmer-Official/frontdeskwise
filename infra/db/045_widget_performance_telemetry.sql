-- Internal widget performance telemetry. This table intentionally stores
-- bounded timings and request metadata, never visitor message content.
create table if not exists widget_performance_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete set null,
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  request_id text,
  event_type text not null,
  duration_ms integer,
  occurred_at timestamptz not null default now(),
  source_page text,
  device text,
  metrics jsonb not null default '{}'::jsonb
);

create index if not exists widget_performance_business_time_idx
  on widget_performance_events (business_id, occurred_at desc);

create index if not exists widget_performance_event_type_time_idx
  on widget_performance_events (event_type, occurred_at desc);

create index if not exists widget_performance_request_idx
  on widget_performance_events (request_id)
  where request_id is not null;
