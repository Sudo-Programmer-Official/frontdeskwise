alter table agent_configs
  add column if not exists tone text not null default 'friendly',
  add column if not exists primary_language text not null default 'English',
  add column if not exists fallback_behavior text not null default 'contact_form',
  add column if not exists human_handoff_enabled boolean not null default true,
  add column if not exists widget_theme text not null default 'auto',
  add column if not exists widget_position text not null default 'bottom-right';

alter table agent_configs
  drop constraint if exists agent_configs_tone_check,
  add constraint agent_configs_tone_check check (tone in ('friendly', 'professional', 'concise', 'custom')),
  drop constraint if exists agent_configs_fallback_behavior_check,
  add constraint agent_configs_fallback_behavior_check check (fallback_behavior in ('contact_form', 'human', 'unavailable')),
  drop constraint if exists agent_configs_widget_theme_check,
  add constraint agent_configs_widget_theme_check check (widget_theme in ('light', 'dark', 'auto')),
  drop constraint if exists agent_configs_widget_position_check,
  add constraint agent_configs_widget_position_check check (widget_position in ('bottom-right', 'bottom-left'));
