alter table businesses
  add column if not exists website_url_key text;

-- Preserve any legacy duplicates while selecting one canonical row as the
-- protected owner of each organization + website pair. The key ignores the
-- protocol, a leading www, and trailing slashes. New records always set
-- website_url_key, so the unique index blocks future duplicates safely.
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
