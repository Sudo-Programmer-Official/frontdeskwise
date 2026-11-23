-- Optional Web Push delivery for installed owner and staff operator devices.
-- A subscription is scoped to the business where it was enabled so a user with
-- multiple businesses never receives another business's conversation alerts.

create table if not exists web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  endpoint text not null,
  subscription jsonb not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (endpoint)
);

create index if not exists web_push_subscriptions_recipient_idx
  on web_push_subscriptions (business_id, user_id, last_seen_at desc);
