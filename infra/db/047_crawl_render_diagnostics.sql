-- Preserve bounded crawl provenance so owners and audits can distinguish
-- static extraction from browser-rendered ingestion without storing secrets or
-- rendered browser state.
alter table business_sources
  add column if not exists raw_html_bytes integer,
  add column if not exists extracted_character_count integer,
  add column if not exists discovered_link_count integer,
  add column if not exists crawl_mode text not null default 'static',
  add column if not exists render_attempted boolean not null default false,
  add column if not exists render_success boolean not null default false,
  add column if not exists render_duration_ms integer,
  add column if not exists crawl_depth integer,
  add column if not exists discovery_parent_url text;

alter table business_sources
  drop constraint if exists business_sources_crawl_mode_check,
  add constraint business_sources_crawl_mode_check
    check (crawl_mode in ('static', 'rendered'));
