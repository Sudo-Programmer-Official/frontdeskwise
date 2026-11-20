-- Repair deployments where the duplicate-website migration was recorded as
-- applied but the businesses column was not present in the restored database.
-- Keep this additive and idempotent so the normal migration runner can safely
-- reconcile the schema before the API starts accepting writes.

alter table businesses
  add column if not exists website_url_key text;

-- Preserve one canonical owner for any legacy duplicates before recreating the
-- protection index. New writes populate this key in the API.
with canonical_businesses as (
  select id,
         organization_id,
         created_at,
         regexp_replace(
           regexp_replace(
             regexp_replace(website_url, '^https?://', '', 'i'),
             '^www\.', '', 'i'
           ),
           '/+$', ''
         ) as website_key
  from businesses
  where website_url is not null
), ranked_businesses as (
  select id,
         website_key,
         row_number() over (
           partition by organization_id, website_key
           order by created_at, id
         ) as duplicate_rank
  from canonical_businesses
)
update businesses b
set website_url_key = case when ranked.duplicate_rank = 1 then ranked.website_key else null end
from ranked_businesses ranked
where b.id = ranked.id;

create unique index if not exists businesses_organization_website_key_idx
  on businesses (organization_id, website_url_key)
  where website_url_key is not null;
