-- Keep owner-deleted actions for audit/history without showing them as active Actions.

alter table business_actions
  add column if not exists archived boolean not null default false;

-- Recover owner deletes that happened before this explicit flag existed. The
-- audit event distinguishes Delete from the normal owner "Active" toggle.
update business_actions action
set archived = true
where action.enabled = false
  and action.lifecycle_status = 'disabled'
  and exists (
    select 1
    from action_registry_audit audit
    where audit.action_id = action.id
      and audit.actor_type = 'owner'
      and audit.event_type = 'disabled'
      and audit.reason = 'owner_override'
  );

create index if not exists business_actions_archived_idx
  on business_actions (business_id, archived, updated_at desc);
