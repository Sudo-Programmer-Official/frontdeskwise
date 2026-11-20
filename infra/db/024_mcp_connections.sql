-- MCP connections are separate from CRM lead-delivery integrations.
-- Tokens are encrypted by the API; tool permissions are explicit per business.

create table if not exists mcp_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null,
  display_name text not null,
  server_url text not null,
  encrypted_credentials text not null,
  protocol_version text not null default '2025-06-18',
  connection_status text not null default 'pending',
  tool_catalog jsonb not null default '[]'::jsonb,
  allowed_tools jsonb not null default '[]'::jsonb,
  last_tested_at timestamptz,
  last_successful_call_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, provider, server_url)
);

alter table mcp_connections
  drop constraint if exists mcp_connections_provider_check,
  add constraint mcp_connections_provider_check
    check (provider in ('hubspot', 'zapier', 'make', 'custom')),
  drop constraint if exists mcp_connections_status_check,
  add constraint mcp_connections_status_check
    check (connection_status in ('pending', 'active', 'error', 'disabled'));

create index if not exists mcp_connections_business_status_idx
  on mcp_connections (business_id, connection_status);
