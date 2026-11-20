-- Native HubSpot OAuth connection state and token metadata.
-- OAuth tokens remain encrypted in crm_integrations.encrypted_credentials.

alter table crm_integrations
  add column if not exists auth_type text not null default 'pat',
  add column if not exists provider_account_id text,
  add column if not exists provider_account_name text,
  add column if not exists provider_scopes text[] not null default '{}',
  add column if not exists access_token_expires_at timestamptz;

alter table crm_integrations
  drop constraint if exists crm_integrations_auth_type_check,
  add constraint crm_integrations_auth_type_check
    check (auth_type in ('oauth', 'pat'));

create index if not exists crm_integrations_provider_account_idx
  on crm_integrations (provider, provider_account_id);

create table if not exists hubspot_oauth_states (
  id uuid primary key default gen_random_uuid(),
  state_hash text not null unique,
  business_id uuid not null references businesses(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  initiating_user_id text,
  initiating_user_type text not null default 'app_user',
  redirect_uri text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists hubspot_oauth_states_expiry_idx
  on hubspot_oauth_states (expires_at)
  where consumed_at is null;
