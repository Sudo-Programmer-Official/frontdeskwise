-- Jackrabbit stores an encrypted Customer API token in the existing generic
-- integration connection table. The hint is display-only and never replaces
-- the encrypted credential.

alter table crm_integrations
  add column if not exists credential_hint text;
