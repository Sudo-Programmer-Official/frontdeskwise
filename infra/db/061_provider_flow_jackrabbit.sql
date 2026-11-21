-- Persist the only safe legacy inference: the canonical swim-school enrollment
-- workflow is the Jackrabbit-backed provider flow. Future runtime decisions use
-- the explicit provider column instead of relying on this compatibility rule.
update business_actions
set provider = 'jackrabbit',
    updated_at = now()
where action_key = 'enroll_child'
  and action_type = 'enroll'
  and (provider is null or btrim(provider) = '');
