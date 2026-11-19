-- Uploaded files are private organization knowledge and become searchable document sources.
alter table business_sources
  drop constraint if exists business_sources_page_type_check,
  add constraint business_sources_page_type_check
    check (page_type in ('web_page', 'service', 'pricing', 'faq', 'policy', 'location', 'document'));
