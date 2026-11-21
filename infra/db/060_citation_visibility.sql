alter table agent_configs
  add column if not exists citation_visibility text not null default 'always';

alter table agent_configs
  drop constraint if exists agent_configs_citation_visibility_check;

alter table agent_configs
  add constraint agent_configs_citation_visibility_check
  check (citation_visibility in ('always', 'contextual', 'hidden'));
