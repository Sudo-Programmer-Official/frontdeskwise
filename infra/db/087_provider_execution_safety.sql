-- Provider execution safety metadata. Capabilities remain tenant-owned and
-- imported operations stay disabled until an owner approves them.

alter table business_api_capabilities
  add column if not exists requires_verified_customer boolean not null default false,
  add column if not exists fallback_behavior text not null default 'capture_request';

update business_api_capabilities
set requires_verified_customer = case
      when lower(coalesce(metadata->>'requiresVerifiedCustomer', '')) in ('true', 'false')
        then (metadata->>'requiresVerifiedCustomer')::boolean
      else capability_type = 'WRITE'
    end,
    fallback_behavior = case
      when metadata->>'customerLookup' = 'true' then 'retry_identity'
      when fallback_behavior in ('retry_identity', 'capture_request', 'handoff', 'stop') then fallback_behavior
      else 'capture_request'
    end;

-- Preserve an explicit owner override, but make legacy WRITE capabilities
-- confirmation-gated by default just like newly imported operations.
update business_api_capabilities
set confirmation_required = case
      when lower(coalesce(metadata->>'requiresConfirmation', metadata->>'confirmationRequired', '')) in ('true', 'false')
        then coalesce(metadata->>'requiresConfirmation', metadata->>'confirmationRequired')::boolean
      else capability_type = 'WRITE'
    end;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'business_api_capabilities_fallback_check'
  ) then
    alter table business_api_capabilities
      add constraint business_api_capabilities_fallback_check
      check (fallback_behavior in ('retry_identity', 'capture_request', 'handoff', 'stop'));
  end if;
end $$;

create index if not exists business_api_capabilities_execution_policy_idx
  on business_api_capabilities (business_id, capability_type, requires_verified_customer, lifecycle_status, enabled);
