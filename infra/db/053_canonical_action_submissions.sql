-- Canonical action lifecycle fields and durable local-first submissions.
-- business_actions is the single owner/runtime definition. Provider resources
-- remain availability records and are not widget-specific action definitions.

alter table business_actions
  add column if not exists optional_fields jsonb not null default '[]'::jsonb,
  add column if not exists handoff_behavior jsonb not null default '{"mode":"none"}'::jsonb,
  add column if not exists version integer not null default 1;

alter table business_actions
  drop constraint if exists business_actions_version_check,
  add constraint business_actions_version_check check (version > 0);

update business_actions
set optional_fields = coalesce(
      (select jsonb_agg(field->>'key' order by ordinality)
       from jsonb_array_elements(fields) with ordinality as item(field, ordinality)
       where coalesce((field->>'required')::boolean, true) = false),
      '[]'::jsonb
    ),
    handoff_behavior = case
      when coalesce((completion->>'requiresStaff')::boolean, false) then '{"mode":"require_staff"}'::jsonb
      when coalesce((completion->>'notifyStaff')::boolean, false) then '{"mode":"notify_staff"}'::jsonb
      else '{"mode":"none"}'::jsonb
    end
where optional_fields = '[]'::jsonb;

create table if not exists action_submissions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action_id uuid not null references business_actions(id) on delete restrict,
  conversation_id uuid not null references conversations(id) on delete cascade,
  idempotency_key text not null,
  values jsonb not null default '{}'::jsonb,
  source_page text,
  status text not null default 'received',
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, idempotency_key)
);

alter table action_submissions
  drop constraint if exists action_submissions_status_check,
  add constraint action_submissions_status_check check (status in ('received', 'completed', 'failed'));

create index if not exists action_submissions_business_idx
  on action_submissions (business_id, created_at desc);
create index if not exists action_submissions_conversation_idx
  on action_submissions (conversation_id, created_at desc);
