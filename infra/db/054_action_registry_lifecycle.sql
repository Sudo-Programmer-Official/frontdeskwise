-- Reviewable, provenance-first lifecycle for discovered and configured actions.

alter table business_actions
  add column if not exists origin text not null default 'configured',
  add column if not exists lifecycle_status text not null default 'active',
  add column if not exists review_reason text,
  add column if not exists source_type text,
  add column if not exists source_label text,
  add column if not exists classification_reason text,
  add column if not exists discovered_at timestamptz;

update business_actions
set origin = 'discovered'
where origin = 'configured'
  and source_url is not null
  and jsonb_typeof(evidence) = 'array'
  and jsonb_array_length(evidence) > 0;

update business_actions
set source_type = coalesce(source_type, 'website'),
    source_label = coalesce(source_label, name),
    classification_reason = coalesce(classification_reason, 'Imported from existing website action evidence'),
    discovered_at = coalesce(discovered_at, created_at)
where origin = 'discovered';

update business_actions
set source_type = coalesce(source_type, 'manual'),
    source_label = coalesce(source_label, name)
where origin = 'configured';

update business_actions
set lifecycle_status = case when enabled then 'approved' else 'needs_review' end,
    enabled = false
where origin = 'discovered'
  and not exists (
    select 1 from businesses
    where businesses.primary_action_id = business_actions.id
  );

update business_actions
set lifecycle_status = case when enabled then 'approved' else 'disabled' end
where origin = 'discovered'
  and exists (
    select 1 from businesses
    where businesses.primary_action_id = business_actions.id
  );

update business_actions
set lifecycle_status = case when enabled then 'active' else 'disabled' end
where origin = 'configured';

alter table business_actions
  drop constraint if exists business_actions_origin_check,
  add constraint business_actions_origin_check check (origin in ('discovered', 'configured')),
  drop constraint if exists business_actions_lifecycle_status_check,
  add constraint business_actions_lifecycle_status_check check (lifecycle_status in ('discovered', 'needs_review', 'approved', 'active', 'disabled')),
  drop constraint if exists business_actions_review_reason_check,
  add constraint business_actions_review_reason_check check (review_reason is null or review_reason in ('low_confidence', 'unsafe_destination', 'duplicate_action', 'owner_override', 'source_removed'));

create index if not exists business_actions_registry_status_idx
  on business_actions (business_id, origin, lifecycle_status, updated_at desc);

create table if not exists action_registry_audit (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  action_id uuid references business_actions(id) on delete set null,
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null check (actor_type in ('super_admin', 'owner', 'system')),
  event_type text not null check (event_type in ('created', 'updated', 'approved', 'enabled', 'disabled', 'primary_set', 'primary_cleared', 'source_removed')),
  previous_value jsonb,
  new_value jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists action_registry_audit_business_idx
  on action_registry_audit (business_id, created_at desc);
create index if not exists action_registry_audit_action_idx
  on action_registry_audit (action_id, created_at desc);
