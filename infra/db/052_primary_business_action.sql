-- The business's preferred conversion action is an explicit operator decision,
-- separate from action confidence/priority and safe to clear at any time.
alter table businesses
  add column if not exists primary_action_id uuid references business_actions(id) on delete set null;

create index if not exists businesses_primary_action_idx
  on businesses (primary_action_id)
  where primary_action_id is not null;
