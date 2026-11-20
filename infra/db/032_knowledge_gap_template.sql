-- Optional operator alert when the business explicitly enables knowledge-gap email.

insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body, cta_label, cta_url, footer, variables)
values
  ('knowledge_gap', 'Knowledge gap', 'A visitor question needs an authoritative answer.', 'operational', 'Answer gap needs review — {{business_name}}', '{{visitor_name}} asked about {{visitor_intent}}.', 'Answer gap needs review', 'Business: {{business_name}}\nVisitor: {{visitor_name}}\nIntent: {{visitor_intent}}\nQuestion: “{{last_message}}”\nReason: {{handoff_reason}}', 'Open conversation', '{{inbox_url}}', 'Optional knowledge-gap notification from FrontDeskWise.', '["business_name", "visitor_name", "visitor_intent", "last_message", "handoff_reason", "inbox_url"]'::jsonb)
on conflict (template_key) do nothing;

insert into message_automations
  (automation_key, template_key, event_type, delay_seconds, recipient_scope, mandatory)
values
  ('knowledge_gap', 'knowledge_gap', 'KNOWLEDGE_GAP', 0, 'business_team', false)
on conflict (automation_key) do nothing;
