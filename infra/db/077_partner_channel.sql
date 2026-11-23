-- Partner / agency channel MVP.
-- Partners are application users who receive explicit access to client
-- organizations. Client organizations remain isolated from one another and
-- partner access is never inferred from a browser-supplied organization id.

create table if not exists partner_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references app_users(id) on delete cascade,
  company_name text not null,
  slug text not null unique,
  website_url text,
  partner_type text not null default 'agency',
  status text not null default 'active',
  commission_rate numeric(5,2) not null default 20.00,
  commission_window_months integer not null default 12,
  referral_code text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table partner_accounts
  drop constraint if exists partner_accounts_type_check,
  add constraint partner_accounts_type_check check (partner_type in ('referral', 'agency', 'reseller', 'consultant')),
  drop constraint if exists partner_accounts_status_check,
  add constraint partner_accounts_status_check check (status in ('active', 'paused')),
  drop constraint if exists partner_accounts_commission_rate_check,
  add constraint partner_accounts_commission_rate_check check (commission_rate >= 0 and commission_rate <= 100),
  drop constraint if exists partner_accounts_commission_window_check,
  add constraint partner_accounts_commission_window_check check (commission_window_months between 1 and 60);

create index if not exists partner_accounts_status_idx
  on partner_accounts (status, created_at);

create table if not exists partner_client_links (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner_accounts(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  relationship_status text not null default 'active',
  pricing_tier text not null default 'standard',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_id, organization_id)
);

alter table partner_client_links
  drop constraint if exists partner_client_links_status_check,
  add constraint partner_client_links_status_check check (relationship_status in ('pending', 'active', 'paused')),
  drop constraint if exists partner_client_links_tier_check,
  add constraint partner_client_links_tier_check check (pricing_tier in ('standard', 'volume', 'negotiated'));

create index if not exists partner_client_links_partner_idx
  on partner_client_links (partner_id, relationship_status, created_at);

create index if not exists partner_client_links_organization_idx
  on partner_client_links (organization_id, relationship_status);

create table if not exists partner_referrals (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references partner_accounts(id) on delete cascade,
  referral_code text not null,
  demo_request_id uuid references demo_requests(id) on delete set null,
  business_id uuid references businesses(id) on delete set null,
  prospect_name text,
  prospect_email text,
  website_url text not null,
  demo_url text,
  status text not null default 'demo_created',
  commission_rate numeric(5,2) not null default 20.00,
  created_at timestamptz not null default now(),
  converted_at timestamptz
);

alter table partner_referrals
  drop constraint if exists partner_referrals_status_check,
  add constraint partner_referrals_status_check check (status in ('demo_created', 'claimed', 'converted', 'lost')),
  drop constraint if exists partner_referrals_commission_rate_check,
  add constraint partner_referrals_commission_rate_check check (commission_rate >= 0 and commission_rate <= 100);

create index if not exists partner_referrals_partner_idx
  on partner_referrals (partner_id, created_at desc);

create unique index if not exists partner_referrals_demo_idx
  on partner_referrals (partner_id, demo_request_id)
  where demo_request_id is not null;
