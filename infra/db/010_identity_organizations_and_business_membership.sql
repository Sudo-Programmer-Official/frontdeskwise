-- Account lifecycle and multi-business organization foundation.
-- Firebase owns authentication. FrontDeskWise owns the application user,
-- organization, business membership, and authorization records.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table businesses
  add column if not exists organization_id uuid references organizations(id) on delete cascade,
  add column if not exists is_internal_demo boolean not null default false;

-- Existing single-business workspaces become one organization each. The
-- deterministic slug keeps this migration repeatable and avoids guessing from
-- display names that may collide.
insert into organizations (name, slug)
select b.name || ' Organization', 'business-' || substr(md5(b.id::text), 1, 20)
from businesses b
where b.organization_id is null
on conflict (slug) do nothing;

update businesses b
set organization_id = o.id,
    updated_at = now()
from organizations o
where b.organization_id is null
  and o.slug = 'business-' || substr(md5(b.id::text), 1, 20);

alter table businesses
  alter column organization_id set not null;

create index if not exists businesses_organization_idx
  on businesses (organization_id, created_at);

create table if not exists app_users (
  id uuid primary key default gen_random_uuid(),
  identity_subject text unique,
  email text not null,
  email_normalized text not null unique,
  name text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table app_users
  drop constraint if exists app_users_status_check,
  add constraint app_users_status_check check (status in ('active', 'invited', 'disabled'));

create table if not exists organization_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

alter table organization_members
  drop constraint if exists organization_members_role_check,
  add constraint organization_members_role_check check (role in ('owner', 'admin', 'member', 'viewer'));

create index if not exists organization_members_user_idx
  on organization_members (user_id, organization_id);

create table if not exists business_members (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'staff',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, user_id)
);

alter table business_members
  drop constraint if exists business_members_role_check,
  add constraint business_members_role_check check (role in ('admin', 'staff', 'viewer'));

create index if not exists business_members_user_idx
  on business_members (user_id, business_id);

-- Preserve existing workspace owners/admins while moving authorization to the
-- stable user/org model. Legacy workspace_users remains for demo-token
-- compatibility during the transition.
insert into app_users (email, email_normalized, name, identity_subject)
select distinct on (lower(trim(wu.email)))
  trim(wu.email), lower(trim(wu.email)), trim(wu.name), nullif(trim(wu.identity_subject), '')
from workspace_users wu
where trim(wu.email) <> ''
order by lower(trim(wu.email)), wu.created_at
on conflict (email_normalized) do update set
  name = excluded.name,
  identity_subject = coalesce(app_users.identity_subject, excluded.identity_subject),
  updated_at = now();

insert into organization_members (organization_id, user_id, role)
select distinct b.organization_id,
  u.id,
  case when wu.role = 'owner' then 'owner' when wu.role = 'admin' then 'admin' else 'viewer' end
from workspace_users wu
join businesses b on b.id = wu.business_id
join app_users u on u.email_normalized = lower(trim(wu.email))
on conflict (organization_id, user_id) do update set
  role = case
    when organization_members.role = 'owner' or excluded.role = 'owner' then 'owner'
    when organization_members.role = 'admin' or excluded.role = 'admin' then 'admin'
    else organization_members.role
  end,
  updated_at = now();

insert into business_members (business_id, user_id, role)
select wu.business_id,
  u.id,
  case when wu.role in ('owner', 'admin') then 'admin' else 'viewer' end
from workspace_users wu
join app_users u on u.email_normalized = lower(trim(wu.email))
on conflict (business_id, user_id) do update set
  role = case when business_members.role = 'admin' or excluded.role = 'admin' then 'admin' else business_members.role end,
  updated_at = now();

alter table demo_access_sessions
  add column if not exists claimable boolean not null default true,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_user_id uuid references app_users(id) on delete set null;

create index if not exists demo_access_sessions_claimable_idx
  on demo_access_sessions (business_id, claimable, claimed_at);

-- Internal sales/demo account seed. This creates the application-side identity
-- only; no password is stored here. When the matching Firebase account signs
-- in, the server binds its verified identity_subject to this row.
insert into organizations (name, slug)
values ('FrontDeskWise Demo', 'frontdeskwise-demo')
on conflict (slug) do update set name = excluded.name, updated_at = now();

insert into app_users (email, email_normalized, name, status)
values ('demo@frontdeskwise.com', 'demo@frontdeskwise.com', 'FrontDeskWise Demo Owner', 'active')
on conflict (email_normalized) do update set name = excluded.name, status = 'active', updated_at = now();

update businesses b
set organization_id = o.id,
    is_internal_demo = true,
    is_demo = true,
    billing_mode = 'sandbox',
    billing_status = 'trial',
    plan_key = 'demo',
    updated_at = now()
from organizations o
where b.slug = 'british-swim-school-tampa-bay'
  and o.slug = 'frontdeskwise-demo';

insert into organization_members (organization_id, user_id, role)
select o.id, u.id, 'owner'
from organizations o
join app_users u on u.email_normalized = 'demo@frontdeskwise.com'
where o.slug = 'frontdeskwise-demo'
on conflict (organization_id, user_id) do update set role = 'owner', updated_at = now();

insert into business_members (business_id, user_id, role)
select b.id, u.id, 'admin'
from businesses b
join app_users u on u.email_normalized = 'demo@frontdeskwise.com'
where b.slug = 'british-swim-school-tampa-bay'
on conflict (business_id, user_id) do update set role = 'admin', updated_at = now();
