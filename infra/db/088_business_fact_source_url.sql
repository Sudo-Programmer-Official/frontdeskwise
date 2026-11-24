-- Keep the applied 084 migration immutable. The source_url addition was
-- discovered after 084 had already been recorded in some databases, so it
-- belongs in its own additive migration.

alter table business_facts
  add column if not exists source_url text;

update business_facts fact
set source_url = source.source_url
from business_sources source
where fact.source_url is null
  and fact.source_id = source.id::text;
