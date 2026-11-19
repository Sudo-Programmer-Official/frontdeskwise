-- Plan metadata is deliberately small and provider-neutral. Stripe checkout and
-- provider-specific price IDs belong in a later live-billing migration.

create table if not exists billing_plans (
  plan_key text primary key,
  display_name text not null,
  description text not null,
  public boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into billing_plans (plan_key, display_name, description, public, active)
values
  ('demo', 'Demo', 'Sandbox workspace for evaluating FrontDeskWise.', false, true),
  ('starter', 'Starter', 'One location with grounded website answers and lead capture.', false, true),
  ('growth', 'Growth', 'Higher-volume workspace with richer routing and reporting.', false, true)
on conflict (plan_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  updated_at = now();

create table if not exists billing_plan_entitlements (
  plan_key text not null references billing_plans(plan_key) on delete cascade,
  entitlement_key text not null,
  entitlement_value jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (plan_key, entitlement_key)
);

insert into billing_plan_entitlements (plan_key, entitlement_key, entitlement_value)
values
  ('demo', 'crawl_limits', '{"maxPages":20,"maxDepth":2,"maxChunksPerPage":100}'),
  ('demo', 'lead_capture', '{"enabled":true}'),
  ('demo', 'booking_action', '{"enabled":true}'),
  ('starter', 'crawl_limits', '{"maxPages":50,"maxDepth":3,"maxChunksPerPage":150}'),
  ('starter', 'lead_capture', '{"enabled":true}'),
  ('starter', 'booking_action', '{"enabled":true}'),
  ('growth', 'crawl_limits', '{"maxPages":250,"maxDepth":4,"maxChunksPerPage":250}'),
  ('growth', 'lead_capture', '{"enabled":true}'),
  ('growth', 'booking_action', '{"enabled":true}')
on conflict (plan_key, entitlement_key) do update set
  entitlement_value = excluded.entitlement_value,
  updated_at = now();
