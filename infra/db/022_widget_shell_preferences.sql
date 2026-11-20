alter table agent_configs
  add column if not exists widget_default_mode text not null default 'compact',
  add column if not exists widget_allow_expand boolean not null default true,
  add column if not exists widget_quick_actions jsonb not null default '[]'::jsonb,
  add column if not exists widget_logo_url text;

update agent_configs
set widget_quick_actions = jsonb_build_array(
  jsonb_build_object('label', 'Explore services', 'question', 'What services do you offer?'),
  jsonb_build_object('label', 'Pricing', 'question', 'What does pricing look like?'),
  jsonb_build_object('label', 'Get started', 'question', 'How do I get started?'),
  jsonb_build_object('label', 'Ask a question', 'question', '')
)
where widget_quick_actions = '[]'::jsonb;
