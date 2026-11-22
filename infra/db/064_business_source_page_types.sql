-- Keep the source table aligned with the page taxonomy emitted by the crawler.
-- New businesses can otherwise fail during the first source insert when a
-- contact, booking, blog, or other classified page is discovered.
alter table business_sources
  drop constraint if exists business_sources_page_type_check,
  add constraint business_sources_page_type_check
    check (page_type in (
      'web_page', 'service', 'pricing', 'booking', 'demo', 'contact',
      'location', 'emergency', 'faq', 'policy', 'blog', 'cart', 'checkout',
      'account', 'other', 'document'
    ));
