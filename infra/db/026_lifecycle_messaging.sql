-- Lifecycle messaging is the product source of truth for transactional email.
-- Provider delivery is deliberately kept behind the message delivery queue so
-- product requests never depend on an email provider being available.

create table if not exists message_templates (
  template_key text primary key,
  name text not null,
  description text not null default '',
  category text not null default 'transactional'
    check (category in ('transactional', 'operational', 'account')),
  subject text not null,
  preview_text text not null default '',
  heading text not null,
  body text not null,
  cta_label text,
  cta_url text,
  footer text not null default '',
  variables jsonb not null default '[]'::jsonb,
  status text not null default 'active'
    check (status in ('draft', 'active', 'disabled')),
  version integer not null default 1 check (version > 0),
  updated_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists message_automations (
  id uuid primary key default gen_random_uuid(),
  automation_key text not null unique,
  template_key text not null references message_templates(template_key),
  event_type text not null,
  delay_seconds integer not null default 0 check (delay_seconds between 0 and 2_592_000),
  recipient_scope text not null default 'event_recipient'
    check (recipient_scope in ('event_recipient', 'business_owners', 'business_team')),
  conditions jsonb not null default '{}'::jsonb,
  mandatory boolean not null default false,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists message_automations_event_idx
  on message_automations (event_type, enabled, delay_seconds);

create table if not exists message_deliveries (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references message_automations(id) on delete cascade,
  template_key text not null references message_templates(template_key),
  event_type text not null,
  event_key text not null,
  organization_id uuid references organizations(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  recipient_user_id uuid references app_users(id) on delete set null,
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz not null default now(),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'sent', 'delivered', 'deferred', 'failed', 'canceled')),
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  last_attempt_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  provider text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (automation_id, event_key, recipient_email)
);

create index if not exists message_deliveries_queue_idx
  on message_deliveries (status, scheduled_at, created_at);
create index if not exists message_deliveries_admin_idx
  on message_deliveries (created_at desc, status, template_key);
create index if not exists message_deliveries_recipient_idx
  on message_deliveries (recipient_email, created_at desc);

create table if not exists message_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app_users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  preference_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, organization_id, business_id, preference_key)
);

create index if not exists message_preferences_user_idx
  on message_preferences (user_id, organization_id, business_id, preference_key);

create table if not exists message_provider_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  delivery_id uuid references message_deliveries(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now(),
  unique (provider, provider_event_id)
);

create index if not exists message_provider_events_delivery_idx
  on message_provider_events (delivery_id, received_at desc);

insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body, cta_label, cta_url, footer, variables)
values
  ('welcome', 'Welcome', 'Account created and ready for the next activation step.', 'account', 'Your FrontDeskWise account is ready', 'Your AI front desk is ready to learn your business.', 'Your AI front desk is ready', 'Welcome, {{first_name}}.\n\nYour AI front desk is ready to start learning {{business_name}}. Add your website so FrontDeskWise can build your business knowledge and generate your first agent.\n\n• Answer visitor questions\n• Capture leads\n• Move customers toward booking', 'Build my AI front desk', '{{dashboard_url}}', 'You are receiving this transactional account email from FrontDeskWise.', '["first_name", "business_name", "dashboard_url"]'::jsonb),
  ('demo_ready', 'Demo ready', 'A generated demo is ready to review.', 'account', 'Your FrontDeskWise demo is ready', 'Review the AI front desk built from your website.', 'Your demo is ready', 'Hi {{first_name}},\n\nWe crawled {{business_name}} and created a FrontDeskWise demo for you. Review the answers, try a few customer questions, and decide what to improve next.', 'Open my demo', '{{demo_url}}', 'This is a transactional message about your FrontDeskWise demo.', '["first_name", "business_name", "demo_url"]'::jsonb),
  ('trial_started', 'Trial started', 'Trial access has started for a workspace.', 'account', 'Your FrontDeskWise trial has started', 'Your workspace is ready to configure.', 'Your trial is live', 'Your {{business_name}} workspace is ready. You have {{trial_days}} days to configure the agent, verify your website, and install the widget.', 'Continue setup', '{{dashboard_url}}', 'FrontDeskWise account notification.', '["business_name", "trial_days", "dashboard_url"]'::jsonb),
  ('business_verification_needed', 'Business verification needed', 'Ownership verification is required before production publishing.', 'account', 'Verify {{business_name}} before going live', 'Complete website verification to publish your live widget.', 'One step before going live', 'FrontDeskWise needs to verify ownership of {{business_name}} before the live widget can be published and production leads can be collected.', 'Verify my business', '{{verification_url}}', 'FrontDeskWise security and account notification.', '["business_name", "verification_url"]'::jsonb),
  ('widget_installed', 'Widget installed', 'The live widget has been detected on the website.', 'account', 'Your FrontDeskWise widget is live', 'Your AI front desk has been detected on your website.', 'Your AI front desk is live', 'We detected the FrontDeskWise widget on {{business_name}}. Your visitors can now ask questions and start conversations with your team.', 'Open workspace', '{{dashboard_url}}', 'FrontDeskWise account notification.', '["business_name", "dashboard_url"]'::jsonb),
  ('trial_midpoint', 'Trial midpoint', 'Activation reminder for a trial that has not converted.', 'account', 'Keep building your AI front desk', 'A few setup steps can unlock more value from your trial.', 'Make the most of your trial', 'You have {{trial_days_remaining}} days left in your FrontDeskWise trial. Your next best step is {{next_activation_step}}.', 'Continue setup', '{{dashboard_url}}', 'You are receiving this transactional trial reminder from FrontDeskWise.', '["business_name", "trial_days_remaining", "next_activation_step", "dashboard_url"]'::jsonb),
  ('trial_ending_soon', 'Trial ending soon', 'Reminder before trial access ends.', 'account', 'Your FrontDeskWise trial ends soon', 'Your trial ends in {{trial_days_remaining}} days.', 'Your trial is ending soon', 'Your FrontDeskWise trial for {{business_name}} ends in {{trial_days_remaining}} days. Upgrade to keep your workspace active and continue serving visitors.', 'Choose a plan', '{{billing_url}}', 'FrontDeskWise billing notification.', '["business_name", "trial_days_remaining", "billing_url"]'::jsonb),
  ('trial_expired', 'Trial expired', 'Trial access has ended.', 'account', 'Your FrontDeskWise trial has ended', 'Your workspace is still here when you are ready to continue.', 'Your trial has ended', 'Your FrontDeskWise trial for {{business_name}} has ended. Your data remains available, and you can restore active access whenever you are ready.', 'Restore access', '{{billing_url}}', 'FrontDeskWise billing notification.', '["business_name", "billing_url"]'::jsonb),
  ('subscription_activated', 'Subscription activated', 'Subscription is active.', 'account', 'FrontDeskWise billing is active', 'Your subscription is active and your workspace is ready.', 'You are all set', 'Your {{plan_name}} subscription for {{business_name}} is active. Thanks for building with FrontDeskWise.', 'Open workspace', '{{dashboard_url}}', 'FrontDeskWise billing notification.', '["business_name", "plan_name", "dashboard_url"]'::jsonb),
  ('payment_failed', 'Payment failed', 'Payment needs attention.', 'account', 'Action needed: FrontDeskWise payment failed', 'Update your billing method to keep your workspace active.', 'Payment needs attention', 'We could not process the latest payment for {{business_name}}. Update your billing method before {{grace_end_at}} to avoid an interruption.', 'Update billing', '{{billing_url}}', 'FrontDeskWise billing notification. Payment notices cannot be disabled.', '["business_name", "grace_end_at", "billing_url"]'::jsonb),
  ('subscription_canceled', 'Subscription canceled', 'Subscription is ending or canceled.', 'account', 'Your FrontDeskWise subscription is ending', 'Your workspace will remain available until {{access_end_at}}.', 'Your subscription is ending', 'Your FrontDeskWise subscription for {{business_name}} is scheduled to end on {{access_end_at}}. You can reactivate it before then.', 'Manage billing', '{{billing_url}}', 'FrontDeskWise billing notification.', '["business_name", "access_end_at", "billing_url"]'::jsonb),
  ('team_invitation', 'Team invitation', 'A teammate has been invited to a workspace.', 'account', '{{inviter_name}} invited you to FrontDeskWise', 'Join {{business_name}} and help manage the AI front desk.', 'You have been invited', '{{inviter_name}} invited you to help manage {{business_name}} on FrontDeskWise.', 'Open FrontDeskWise', '{{dashboard_url}}', 'FrontDeskWise team invitation.', '["inviter_name", "business_name", "dashboard_url"]'::jsonb),
  ('human_handoff', 'Human handoff', 'A visitor is waiting for a team member.', 'operational', '{{business_name}} needs a team member', 'A visitor requested human help.', 'Human help requested', '{{business_name}} has a visitor waiting for a team member. Reason: {{handoff_reason}}.', 'Open inbox', '{{inbox_url}}', 'Operational notification from FrontDeskWise.', '["business_name", "handoff_reason", "inbox_url"]'::jsonb),
  ('qualified_lead', 'New qualified lead', 'A new lead met the configured qualification criteria.', 'operational', 'New qualified lead for {{business_name}}', '{{lead_name}} shared a new inquiry with your team.', 'New qualified lead', '{{lead_name}} submitted a {{lead_intent}} inquiry for {{business_name}}. Contact: {{lead_contact}}.', 'Open leads', '{{leads_url}}', 'Operational notification from FrontDeskWise.', '["business_name", "lead_name", "lead_intent", "lead_contact", "leads_url"]'::jsonb),
  ('integration_failure', 'Integration failure', 'An integration needs operator attention.', 'operational', 'FrontDeskWise integration needs attention', '{{integration_name}} could not complete a delivery.', 'Integration delivery failed', '{{integration_name}} could not deliver an event for {{business_name}}. Error: {{failure_reason}}.', 'Review integrations', '{{integrations_url}}', 'Operational notification from FrontDeskWise.', '["business_name", "integration_name", "failure_reason", "integrations_url"]'::jsonb)
on conflict (template_key) do nothing;

insert into message_automations
  (automation_key, template_key, event_type, delay_seconds, recipient_scope, mandatory)
values
  ('welcome', 'welcome', 'USER_CREATED', 0, 'event_recipient', true),
  ('demo_ready', 'demo_ready', 'DEMO_READY', 0, 'event_recipient', false),
  ('trial_started', 'trial_started', 'TRIAL_STARTED', 0, 'business_owners', true),
  ('business_verification_needed', 'business_verification_needed', 'BUSINESS_VERIFICATION_NEEDED', 0, 'business_owners', true),
  ('widget_installed', 'widget_installed', 'WIDGET_INSTALLED', 0, 'business_owners', false),
  ('trial_midpoint', 'trial_midpoint', 'TRIAL_STARTED', 259200, 'business_owners', false),
  ('trial_ending_soon', 'trial_ending_soon', 'TRIAL_ENDING_SOON', 0, 'business_owners', true),
  ('trial_expired', 'trial_expired', 'TRIAL_EXPIRED', 0, 'business_owners', true),
  ('subscription_activated', 'subscription_activated', 'SUBSCRIPTION_ACTIVATED', 0, 'business_owners', true),
  ('payment_failed', 'payment_failed', 'PAYMENT_FAILED', 0, 'business_owners', true),
  ('subscription_canceled', 'subscription_canceled', 'SUBSCRIPTION_CANCELED', 0, 'business_owners', true),
  ('team_invitation', 'team_invitation', 'TEAM_INVITED', 0, 'event_recipient', true),
  ('human_handoff', 'human_handoff', 'HUMAN_HANDOFF', 0, 'business_team', false),
  ('qualified_lead', 'qualified_lead', 'QUALIFIED_LEAD', 0, 'business_team', false),
  ('integration_failure', 'integration_failure', 'INTEGRATION_FAILURE', 0, 'business_team', false)
on conflict (automation_key) do nothing;
