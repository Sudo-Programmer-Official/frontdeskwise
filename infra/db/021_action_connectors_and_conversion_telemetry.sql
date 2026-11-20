-- Durable completion actions and conversion telemetry.
-- Leads remain the source of truth; action delivery can fail and retry without
-- changing the lead or the customer-facing completion response.

create table if not exists action_outbox (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action_id uuid not null references business_actions(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  integration_id uuid references crm_integrations(id) on delete set null,
  connector_provider text not null,
  connector_config jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued',
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  delivered_at timestamptz,
  remote_object_id text,
  remote_url text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

alter table action_outbox
  drop constraint if exists action_outbox_status_check,
  add constraint action_outbox_status_check
    check (status in ('queued', 'running', 'succeeded', 'retrying', 'failed'));

create index if not exists action_outbox_ready_idx
  on action_outbox (status, next_attempt_at);
create index if not exists action_outbox_business_idx
  on action_outbox (business_id, created_at desc);

create table if not exists conversion_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  flow_id uuid references business_actions(id) on delete set null,
  field_id text,
  event text not null,
  occurred_at timestamptz not null default now(),
  source_page text,
  device text,
  metadata jsonb not null default '{}'::jsonb
);

alter table conversion_events
  drop constraint if exists conversion_events_event_check,
  add constraint conversion_events_event_check
    check (event in (
      'FLOW_STARTED', 'FIELD_VIEWED', 'FIELD_COMPLETED', 'FIELD_ABANDONED',
      'FORM_DISPLAYED', 'FORM_SUBMITTED', 'ACTION_STARTED', 'ACTION_SUCCEEDED',
      'ACTION_FAILED', 'FLOW_COMPLETED', 'CTA_CLICKED', 'HANDOFF_REQUESTED',
      'LEAD_CAPTURED', 'BOOKING_LINK_OPENED', 'CONVERSATION_ABANDONED'
    ));

create index if not exists conversion_events_business_time_idx
  on conversion_events (business_id, occurred_at desc);
create index if not exists conversion_events_flow_event_idx
  on conversion_events (business_id, flow_id, event, occurred_at desc);
create index if not exists conversion_events_conversation_idx
  on conversion_events (conversation_id, occurred_at desc);
