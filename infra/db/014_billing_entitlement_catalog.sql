-- Complete the provider-neutral FrontDeskWise entitlement catalog for the
-- public plans. Checkout selects prices; application access selects these
-- entitlements, so plan behavior remains auditable and extensible.

insert into billing_plan_entitlements (plan_key, entitlement_key, entitlement_value)
values
  ('demo', 'crawl_limits', '{"maxPages":20,"maxDepth":2,"maxChunksPerPage":100}'),
  ('demo', 'lead_capture', '{"enabled":true}'),
  ('demo', 'booking_action', '{"enabled":true}'),
  ('demo', 'business_limits', '{"maxBusinesses":1}'),
  ('starter', 'crawl_limits', '{"maxPages":50,"maxDepth":3,"maxChunksPerPage":150}'),
  ('starter', 'lead_capture', '{"enabled":true}'),
  ('starter', 'booking_action', '{"enabled":true}'),
  ('starter', 'business_limits', '{"maxBusinesses":1}'),
  ('growth', 'crawl_limits', '{"maxPages":250,"maxDepth":4,"maxChunksPerPage":250}'),
  ('growth', 'lead_capture', '{"enabled":true}'),
  ('growth', 'booking_action', '{"enabled":true}'),
  ('growth', 'business_limits', '{"maxBusinesses":1}'),
  ('multi_business', 'crawl_limits', '{"maxPages":500,"maxDepth":5,"maxChunksPerPage":300}'),
  ('multi_business', 'lead_capture', '{"enabled":true}'),
  ('multi_business', 'booking_action', '{"enabled":true}'),
  ('multi_business', 'business_limits', '{"maxBusinesses":2}'),
  ('portfolio', 'crawl_limits', '{"maxPages":1000,"maxDepth":6,"maxChunksPerPage":400}'),
  ('portfolio', 'lead_capture', '{"enabled":true}'),
  ('portfolio', 'booking_action', '{"enabled":true}'),
  ('portfolio', 'business_limits', '{"maxBusinesses":5}')
on conflict (plan_key, entitlement_key) do update set
  entitlement_value = excluded.entitlement_value,
  updated_at = now();
