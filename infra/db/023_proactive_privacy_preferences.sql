alter table agent_configs
  add column if not exists proactive_enabled boolean not null default false,
  add column if not exists proactive_delay_seconds integer not null default 20,
  add column if not exists proactive_message text not null default 'Looking for the right service? I can help.',
  add column if not exists proactive_triggers jsonb not null default '["delay", "scroll", "exit"]'::jsonb,
  add column if not exists require_lead_consent boolean not null default false,
  add column if not exists privacy_notice_url text,
  add column if not exists retention_days integer not null default 90,
  add column if not exists show_ai_disclosure boolean not null default true;

alter table agent_configs
  drop constraint if exists agent_configs_proactive_delay_check,
  add constraint agent_configs_proactive_delay_check check (proactive_delay_seconds between 10 and 120),
  drop constraint if exists agent_configs_retention_days_check,
  add constraint agent_configs_retention_days_check check (retention_days in (30, 60, 90, 365));
