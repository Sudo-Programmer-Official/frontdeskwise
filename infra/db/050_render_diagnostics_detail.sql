alter table business_sources
  add column if not exists render_diagnostics jsonb;
