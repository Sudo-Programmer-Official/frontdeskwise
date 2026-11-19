-- The internal demo is reassigned to the named FrontDeskWise Demo
-- organization during migration 010. Remove only the now-empty deterministic
-- organization created by that backfill; user-created org slugs are untouched.
delete from organizations o
where o.slug like 'business-%'
  and not exists (select 1 from businesses b where b.organization_id = o.id)
  and not exists (select 1 from organization_members om where om.organization_id = o.id);
