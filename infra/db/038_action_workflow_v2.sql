-- Versioned, business-neutral workflow steps for configurable actions.
-- Existing field-based actions remain valid when steps is an empty array.

alter table business_actions
  add column if not exists steps jsonb not null default '[]'::jsonb;

create index if not exists business_actions_workflow_idx
  on business_actions (business_id, updated_at desc)
  where jsonb_array_length(steps) > 0;

