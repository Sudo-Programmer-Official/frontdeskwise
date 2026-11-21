-- Keep plan_key entitlement-authoritative while Stripe transitions are pending.
-- Stripe's subscription price can represent a requested or scheduled change;
-- plan_key remains the last successfully paid plan until invoice.paid confirms it.

alter table organizations
  add column if not exists stripe_subscription_schedule_id text,
  add column if not exists pending_plan_change_type text;

alter table organizations
  drop constraint if exists organizations_pending_plan_change_type_check,
  add constraint organizations_pending_plan_change_type_check
    check (pending_plan_change_type is null or pending_plan_change_type in ('upgrade', 'downgrade'));

create unique index if not exists organizations_stripe_subscription_schedule_idx
  on organizations (stripe_subscription_schedule_id)
  where stripe_subscription_schedule_id is not null;

insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body,
   cta_label, cta_url, secondary_ctas, footer, variables)
values
  ('subscription_change_scheduled', 'Subscription change scheduled',
   'A downgrade will take effect at the end of the current billing period.',
   'account', 'Your FrontDeskWise plan change is scheduled',
   '{{current_plan_name}} stays active until {{effective_date}}.',
   'Your plan change is scheduled',
   E'Hi {{customer_name}},\n\nYour FrontDeskWise plan change for {{organization_name}} is scheduled.\n\nCurrent plan: {{current_plan_name}}\nNext plan: {{plan_name}}\n{{current_plan_name}} stays active until {{effective_date}}.\n{{plan_name}} begins on {{effective_date}}.\n\nBusinesses included after the change: {{businesses_included}}',
   'Manage billing', '{{billing_url}}',
   '[{"label":"Open FrontDeskWise","url":"{{dashboard_url}}"},{"label":"Get support","url":"{{support_url}}"}]'::jsonb,
   'FrontDeskWise is a product of Sudo Programmer, Inc. This transactional subscription email is sent because your plan change was scheduled.',
   '["customer_name", "organization_name", "current_plan_name", "plan_name", "effective_date", "businesses_included", "dashboard_url", "billing_url", "support_url"]'::jsonb)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  subject = excluded.subject,
  preview_text = excluded.preview_text,
  heading = excluded.heading,
  body = excluded.body,
  cta_label = excluded.cta_label,
  cta_url = excluded.cta_url,
  secondary_ctas = excluded.secondary_ctas,
  footer = excluded.footer,
  variables = excluded.variables,
  status = 'active',
  version = message_templates.version + 1,
  updated_at = now();

insert into message_automations
  (automation_key, template_key, event_type, delay_seconds, recipient_scope, mandatory)
values
  ('subscription_change_scheduled', 'subscription_change_scheduled', 'SUBSCRIPTION_CHANGE_SCHEDULED', 0, 'event_recipient', true)
on conflict (automation_key) do update set
  template_key = excluded.template_key,
  event_type = excluded.event_type,
  recipient_scope = excluded.recipient_scope,
  mandatory = excluded.mandatory,
  enabled = true,
  updated_at = now();
