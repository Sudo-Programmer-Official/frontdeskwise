-- Super-admin controlled feature flags with deterministic staged rollout.
-- Organizations are the rollout identity so a tenant stays in one cohort
-- across requests, devices, and deployments.

create table if not exists feature_flags (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text not null default '',
  stage text not null default 'off',
  rollout_percentage numeric(5,2) not null default 0,
  created_by_user_id uuid references app_users(id) on delete set null,
  updated_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint feature_flags_key_check check (key ~ '^[a-z][a-z0-9._-]{1,79}$'),
  constraint feature_flags_stage_check check (stage in ('off', 'internal', 'reference_tenants', 'percentage', 'all')),
  constraint feature_flags_rollout_percentage_check check (rollout_percentage >= 0 and rollout_percentage <= 100)
);

create index if not exists feature_flags_stage_idx on feature_flags (stage, updated_at desc);

create table if not exists feature_flag_reference_organizations (
  feature_flag_id uuid not null references feature_flags(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (feature_flag_id, organization_id)
);

create index if not exists feature_flag_reference_organizations_org_idx
  on feature_flag_reference_organizations (organization_id, feature_flag_id);

create table if not exists feature_flag_overrides (
  feature_flag_id uuid not null references feature_flags(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  state text not null,
  reason text not null default '',
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (feature_flag_id, organization_id),
  constraint feature_flag_overrides_state_check check (state in ('on', 'off'))
);

create index if not exists feature_flag_overrides_org_idx
  on feature_flag_overrides (organization_id, feature_flag_id);

insert into feature_flags (key, description, stage, rollout_percentage)
values
  ('response_validation.semantic_verifier', 'Run the semantic grounding verifier after deterministic response validation.', 'all', 0),
  ('operator.mobile_shell', 'Enable the installable mobile operator shell and takeover experience.', 'off', 0)
on conflict (key) do update set
  description = excluded.description,
  updated_at = now();
