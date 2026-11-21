insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body,
   cta_label, cta_url, secondary_ctas, footer, variables)
values
  ('subscription_upgrade_payment_failed', 'Subscription upgrade payment failed',
   'A requested plan upgrade needs payment attention without changing current entitlements.',
   'account', 'Action needed to complete your FrontDeskWise upgrade',
   'Your current plan stays active while the upgrade payment is incomplete.',
   'Your upgrade needs attention',
   E'Hi {{customer_name}},\n\nWe could not complete the payment for your requested upgrade from {{current_plan_name}} to {{plan_name}}.\n\nYour current {{current_plan_name}} plan and entitlements remain active. Update your payment method, then retry the upgrade from Billing.',
   'Update billing', '{{billing_url}}',
   '[{"label":"Open FrontDeskWise","url":"{{dashboard_url}}"},{"label":"Get support","url":"{{support_url}}"}]'::jsonb,
   'FrontDeskWise billing notification. Your current plan remains active until an upgrade payment succeeds.',
   '["customer_name", "current_plan_name", "plan_name", "dashboard_url", "billing_url", "support_url"]'::jsonb)
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
  ('subscription_upgrade_payment_failed', 'subscription_upgrade_payment_failed', 'SUBSCRIPTION_UPGRADE_PAYMENT_FAILED', 0, 'business_owners', true)
on conflict (automation_key) do update set
  template_key = excluded.template_key,
  event_type = excluded.event_type,
  recipient_scope = excluded.recipient_scope,
  mandatory = excluded.mandatory,
  enabled = true,
  updated_at = now();
