-- Immutable tenant configuration snapshots. Draft business rows may change at
-- any time; production channels execute the latest explicitly published row.

create table if not exists business_config_publications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  version integer not null check (version > 0),
  config_hash text not null,
  agent_config jsonb not null default '{}'::jsonb,
  actions jsonb not null default '[]'::jsonb,
  primary_action_id uuid,
  context_version integer,
  published_at timestamptz not null default now(),
  unique (business_id, version)
);

create index if not exists business_config_publications_latest_idx
  on business_config_publications (business_id, version desc);

alter table businesses
  add column if not exists current_published_config_version integer;

-- Preserve the behavior of businesses that were already live before immutable
-- tenant publications existed. business_actions are stored as raw rows so the
-- application can normalize them through the same action boundary on load.
insert into business_config_publications
  (business_id, version, config_hash, agent_config, actions, primary_action_id, published_at)
select
  b.id,
  1,
  coalesce(ac.published_config_hash, encode(digest(coalesce(ac.published_config::text, '{}') || coalesce(string_agg(a.id::text, ',' order by a.created_at), ''), 'sha256'), 'hex')),
  coalesce(ac.published_config, '{}'::jsonb),
  coalesce(jsonb_agg(to_jsonb(a) order by a.created_at) filter (where a.id is not null), '[]'::jsonb),
  b.primary_action_id,
  coalesce(b.agent_published_at, ac.updated_at, now())
from businesses b
join agent_configs ac on ac.business_id = b.id
left join business_actions a on a.business_id = b.id
where b.agent_published_at is not null
  and ac.published_config is not null
group by b.id, ac.published_config_hash, ac.published_config, b.primary_action_id, b.agent_published_at, ac.updated_at
on conflict (business_id, version) do nothing;

update businesses b
set current_published_config_version = 1
where current_published_config_version is null
  and exists (
    select 1 from business_config_publications p
    where p.business_id = b.id and p.version = 1
  );
