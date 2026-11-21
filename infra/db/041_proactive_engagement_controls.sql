alter table agent_configs
  add column if not exists proactive_behavior text not null default 'teaser',
  add column if not exists proactive_frequency text not null default 'session';

alter table agent_configs
  alter column proactive_triggers set default '["delay", "scroll", "returning"]'::jsonb;

update agent_configs
set proactive_triggers = '["delay", "scroll", "returning"]'::jsonb
where proactive_triggers = '["delay", "scroll", "exit"]'::jsonb;

alter table agent_configs
  drop constraint if exists agent_configs_proactive_behavior_check,
  add constraint agent_configs_proactive_behavior_check check (proactive_behavior in ('teaser', 'open')),
  drop constraint if exists agent_configs_proactive_frequency_check,
  add constraint agent_configs_proactive_frequency_check check (proactive_frequency in ('session', '24h', 'visit'));
