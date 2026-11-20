-- Generic owner-configurable actions and durable per-conversation flow state.

create table if not exists business_actions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action_key text not null,
  name text not null,
  description text not null default '',
  trigger_phrases jsonb not null default '[]'::jsonb,
  trigger_intents jsonb not null default '[]'::jsonb,
  capture_mode text not null default 'auto' check (capture_mode in ('auto', 'conversational', 'form', 'hybrid')),
  fields jsonb not null default '[]'::jsonb,
  completion jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, action_key)
);

create index if not exists business_actions_business_enabled_idx
  on business_actions (business_id, enabled, updated_at desc);

alter table conversations
  add column if not exists action_state jsonb;

alter table business_actions
  add column if not exists capture_mode text not null default 'auto';
