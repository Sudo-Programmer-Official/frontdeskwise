-- Preserve the evidence lifecycle for promoted website facts. Pricing and
-- other critical facts need to be traceable to the crawl that produced them.
alter table business_facts
  add column if not exists source_hash text,
  add column if not exists extracted_at timestamptz,
  add column if not exists last_seen_at timestamptz,
  add column if not exists verification_status text not null default 'NEEDS_REVIEW';

update business_facts
set extracted_at = coalesce(extracted_at, observed_at),
    last_seen_at = coalesce(last_seen_at, observed_at),
    verification_status = case
      when authority in ('system_of_record', 'owner_verified') then 'VERIFIED'
      else coalesce(nullif(verification_status, ''), 'NEEDS_REVIEW')
    end
where extracted_at is null or last_seen_at is null or verification_status is null or verification_status = '';

alter table business_facts
  drop constraint if exists business_facts_verification_status_check,
  add constraint business_facts_verification_status_check
    check (verification_status in ('VERIFIED', 'NEEDS_REVIEW', 'STALE', 'CONFLICTED'));

-- Allow a stale historical version and a current active version to share the
-- same source key while keeping one active fact per source key.
drop index if exists business_facts_source_key_idx;
create unique index if not exists business_facts_active_source_key_idx
  on business_facts (business_id, kind, subject, predicate, source_type, coalesce(source_id, ''))
  where active;

create index if not exists business_facts_source_hash_idx
  on business_facts (business_id, source_hash, last_seen_at desc);
