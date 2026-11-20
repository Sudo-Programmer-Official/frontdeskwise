-- Complete the provider-backed subscription lifecycle without introducing a
-- second billing model. Organizations remain the billing aggregate; these
-- fields make Stripe's checkout, payment, cancellation, and reconciliation
-- state explicit and auditable.

alter table organizations
  add column if not exists stripe_checkout_session_id text,
  add column if not exists stripe_checkout_status text,
  add column if not exists stripe_checkout_created_at timestamptz,
  add column if not exists pending_plan_key text,
  add column if not exists pending_billing_interval text,
  add column if not exists pending_plan_change_at timestamptz,
  add column if not exists stripe_subscription_status text,
  add column if not exists stripe_subscription_event_created_at bigint,
  add column if not exists stripe_last_event_id text,
  add column if not exists cancel_at_period_end boolean not null default false,
  add column if not exists last_payment_status text,
  add column if not exists subscription_activated_at timestamptz,
  add column if not exists subscription_activation_email_queued_at timestamptz;

alter table organizations
  drop constraint if exists organizations_stripe_checkout_status_check,
  add constraint organizations_stripe_checkout_status_check
    check (stripe_checkout_status is null or stripe_checkout_status in ('open', 'complete', 'expired', 'canceled')),
  drop constraint if exists organizations_pending_billing_interval_check,
  add constraint organizations_pending_billing_interval_check
    check (pending_billing_interval is null or pending_billing_interval in ('month', 'year'));

create unique index if not exists organizations_stripe_checkout_session_idx
  on organizations (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

alter table billing_events
  add column if not exists processing_started_at timestamptz,
  add column if not exists processing_attempts integer not null default 0,
  add column if not exists last_error text;

create index if not exists billing_events_processing_idx
  on billing_events (provider, processed_at, processing_started_at);

create table if not exists billing_timeline_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  event_key text not null,
  event_name text not null,
  provider_event_id text,
  status text not null default 'recorded'
    check (status in ('recorded', 'queued', 'sent', 'failed')),
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, event_key)
);

create index if not exists billing_timeline_organization_idx
  on billing_timeline_events (organization_id, occurred_at desc);

alter table message_templates
  add column if not exists secondary_ctas jsonb not null default '[]'::jsonb;

update message_templates
set name = 'Subscription activated',
    description = 'The first successful subscription activation confirmation.',
    subject = 'Welcome to FrontDeskWise — your {{plan_name}} plan is active',
    preview_text = 'Your paid FrontDeskWise plan is active and ready for the next step.',
    heading = 'You’re all set',
    body = E'Hi {{customer_name}},\n\nYour {{plan_name}} plan for {{organization_name}} is now active.\n\nPlan: {{plan_name}}\nPrice: {{price_display}}\nStatus: Active\nBilling email: {{billing_email}}\nNext renewal: {{next_renewal_date}}\nBusinesses included: {{businesses_included}}\n\nNext steps:\n1. Review your AI front desk\n2. Test customer questions\n3. Install the widget\n4. Connect your tools',
    cta_label = 'Open FrontDeskWise',
    cta_url = '{{dashboard_url}}',
    secondary_ctas = '[{"label":"Manage billing","url":"{{billing_url}}"},{"label":"Get support","url":"{{support_url}}"}]'::jsonb,
    footer = 'FrontDeskWise is a product of Sudo Programmer, Inc. This transactional subscription email is sent because your plan changed.',
    variables = '["customer_name", "organization_name", "plan_name", "price_display", "billing_email", "next_renewal_date", "businesses_included", "dashboard_url", "billing_url", "support_url"]'::jsonb,
    status = 'active',
    version = version + 1,
    updated_at = now()
where template_key = 'subscription_activated';

insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body, cta_label, cta_url, secondary_ctas, footer, variables)
values
  ('subscription_updated', 'Subscription updated', 'A customer changed their FrontDeskWise plan.', 'account',
   'Your FrontDeskWise plan has been updated',
   'Your new FrontDeskWise plan is now active.',
   'Your plan has been updated',
   E'Hi {{customer_name}},\n\nYour FrontDeskWise plan for {{organization_name}} is now {{plan_name}} at {{price_display}}.\n\nStatus: {{status}}\nNext renewal: {{next_renewal_date}}\nBusinesses included: {{businesses_included}}',
   'Open FrontDeskWise', '{{dashboard_url}}',
   '[{"label":"Manage billing","url":"{{billing_url}}"},{"label":"Get support","url":"{{support_url}}"}]'::jsonb,
   'FrontDeskWise is a product of Sudo Programmer, Inc. This transactional subscription email is sent because your plan changed.',
   '["customer_name", "organization_name", "plan_name", "price_display", "status", "next_renewal_date", "businesses_included", "dashboard_url", "billing_url", "support_url"]'::jsonb)
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
  ('subscription_updated', 'subscription_updated', 'SUBSCRIPTION_UPDATED', 0, 'business_owners', true)
on conflict (automation_key) do update set
  template_key = excluded.template_key,
  event_type = excluded.event_type,
  recipient_scope = excluded.recipient_scope,
  mandatory = true,
  enabled = true,
  updated_at = now();
