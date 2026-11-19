-- Organization-level billing is the source of truth for a multi-business
-- account. Business billing columns remain as a compatibility projection for
-- existing workspace code and are synchronized by the API.

alter table organizations
  add column if not exists billing_mode text not null default 'live',
  add column if not exists billing_status text not null default 'trial',
  add column if not exists plan_key text not null default 'starter',
  add column if not exists billing_interval text,
  add column if not exists trial_start_at timestamptz,
  add column if not exists trial_end_at timestamptz,
  add column if not exists current_period_start_at timestamptz,
  add column if not exists current_period_end_at timestamptz,
  add column if not exists grace_end_at timestamptz,
  add column if not exists billing_provider text,
  add column if not exists stripe_customer_id text,
  add column if not exists stripe_subscription_id text,
  add column if not exists stripe_price_id text,
  add column if not exists billing_amount_cents integer,
  add column if not exists billing_currency text not null default 'usd';

alter table organizations
  drop constraint if exists organizations_billing_mode_check,
  add constraint organizations_billing_mode_check
    check (billing_mode in ('sandbox', 'live')),
  drop constraint if exists organizations_billing_status_check,
  add constraint organizations_billing_status_check
    check (billing_status in ('trial', 'active', 'grace', 'paused', 'cancelled')),
  drop constraint if exists organizations_billing_interval_check,
  add constraint organizations_billing_interval_check
    check (billing_interval is null or billing_interval in ('month', 'year')),
  drop constraint if exists organizations_billing_currency_check,
  add constraint organizations_billing_currency_check
    check (billing_currency ~ '^[a-z]{3}$');

update organizations
set trial_start_at = coalesce(trial_start_at, created_at),
    trial_end_at = case
      when slug = 'frontdeskwise-demo' then null
      else coalesce(trial_end_at, created_at + interval '14 days')
    end,
    billing_mode = case when slug = 'frontdeskwise-demo' then 'sandbox' else billing_mode end,
    billing_status = case when slug = 'frontdeskwise-demo' then 'trial' else billing_status end,
    plan_key = case when slug = 'frontdeskwise-demo' then 'demo' else plan_key end,
    updated_at = now();

create index if not exists organizations_billing_status_idx
  on organizations (billing_status, plan_key, created_at);

create unique index if not exists organizations_stripe_customer_idx
  on organizations (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists organizations_stripe_subscription_idx
  on organizations (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table billing_plans
  add column if not exists monthly_amount_cents integer,
  add column if not exists currency text not null default 'usd',
  add column if not exists stripe_monthly_price_id text,
  add column if not exists stripe_yearly_price_id text,
  add column if not exists max_businesses integer;

alter table billing_plans
  drop constraint if exists billing_plans_currency_check,
  add constraint billing_plans_currency_check check (currency ~ '^[a-z]{3}$'),
  drop constraint if exists billing_plans_monthly_amount_check,
  add constraint billing_plans_monthly_amount_check check (monthly_amount_cents is null or monthly_amount_cents >= 0),
  drop constraint if exists billing_plans_max_businesses_check,
  add constraint billing_plans_max_businesses_check check (max_businesses is null or max_businesses > 0);

insert into billing_plans
  (plan_key, display_name, description, public, active, monthly_amount_cents, currency, max_businesses)
values
  ('demo', 'Demo', 'Sandbox workspace for evaluating FrontDeskWise.', false, true, 0, 'usd', 1),
  ('starter', 'Starter', 'One business with grounded website answers and lead capture.', true, true, 9900, 'usd', 1),
  ('growth', 'Growth', 'Higher-volume workspace with richer routing and reporting.', true, true, 19900, 'usd', 1),
  ('multi_business', 'Multi-Business', 'Two businesses under one organization and one billing relationship.', true, true, 34900, 'usd', 2),
  ('portfolio', 'Portfolio', 'Multi-business operations with higher limits and priority support.', true, true, 49900, 'usd', 5)
on conflict (plan_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  public = excluded.public,
  active = excluded.active,
  monthly_amount_cents = excluded.monthly_amount_cents,
  currency = excluded.currency,
  max_businesses = excluded.max_businesses,
  updated_at = now();

insert into billing_plan_entitlements (plan_key, entitlement_key, entitlement_value)
values
  ('demo', 'business_limits', '{"maxBusinesses":1}'),
  ('starter', 'business_limits', '{"maxBusinesses":1}'),
  ('growth', 'business_limits', '{"maxBusinesses":1}'),
  ('multi_business', 'business_limits', '{"maxBusinesses":2}'),
  ('portfolio', 'business_limits', '{"maxBusinesses":5}')
on conflict (plan_key, entitlement_key) do update set
  entitlement_value = excluded.entitlement_value,
  updated_at = now();

create table if not exists organization_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  plan_key text not null references billing_plans(plan_key),
  billing_interval text not null default 'month',
  amount_cents integer not null,
  currency text not null default 'usd',
  stripe_price_id text,
  max_businesses integer,
  reason text not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

alter table organization_plan_overrides
  drop constraint if exists organization_plan_overrides_interval_check,
  add constraint organization_plan_overrides_interval_check check (billing_interval in ('month', 'year')),
  drop constraint if exists organization_plan_overrides_amount_check,
  add constraint organization_plan_overrides_amount_check check (amount_cents >= 0),
  drop constraint if exists organization_plan_overrides_currency_check,
  add constraint organization_plan_overrides_currency_check check (currency ~ '^[a-z]{3}$'),
  drop constraint if exists organization_plan_overrides_max_businesses_check,
  add constraint organization_plan_overrides_max_businesses_check check (max_businesses is null or max_businesses > 0);

create table if not exists organization_usage_daily (
  organization_id uuid not null references organizations(id) on delete cascade,
  usage_date date not null,
  conversations integer not null default 0,
  leads integer not null default 0,
  bookings integer not null default 0,
  llm_requests integer not null default 0,
  llm_input_tokens bigint not null default 0,
  llm_output_tokens bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, usage_date)
);

create table if not exists organization_support_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  author_user_id uuid references app_users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists super_admin_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  role text not null default 'super_admin',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

alter table super_admin_users
  drop constraint if exists super_admin_users_role_check,
  add constraint super_admin_users_role_check check (role in ('super_admin', 'support')),
  drop constraint if exists super_admin_users_status_check,
  add constraint super_admin_users_status_check check (status in ('active', 'disabled'));

alter table billing_events
  add column if not exists organization_id uuid references organizations(id) on delete set null;

create index if not exists billing_events_organization_created_idx
  on billing_events (organization_id, created_at desc);

