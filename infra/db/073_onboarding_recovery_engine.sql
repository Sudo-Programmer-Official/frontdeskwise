-- Durable state for contextual onboarding recovery. The scanner owns the
-- reminder cadence; the lifecycle outbox still owns rendering and delivery.

create table if not exists onboarding_recovery (
  business_id uuid primary key references businesses(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  onboarding_stage text not null default 'website'
    check (onboarding_stage in ('website', 'knowledge', 'agent', 'install', 'publish', 'complete')),
  completion_percent integer not null default 0 check (completion_percent between 0 and 100),
  last_activity_at timestamptz not null default now(),
  last_successful_step text,
  current_blocker text,
  last_error text,
  reminder_count integer not null default 0 check (reminder_count >= 0),
  last_reminder_at timestamptz,
  last_reminder_type text
    check (last_reminder_type is null or last_reminder_type in ('light', 'nearly_ready', 'rescue', 'recovery', 'nurture')),
  last_reminder_completion_percent integer check (last_reminder_completion_percent between 0 and 100),
  email_opened boolean not null default false,
  returned_after_email boolean not null default false,
  unsubscribed boolean not null default false,
  dormant boolean not null default false,
  unsubscribe_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists onboarding_recovery_queue_idx
  on onboarding_recovery (dormant, unsubscribed, last_activity_at, completion_percent);
create index if not exists onboarding_recovery_reminder_idx
  on onboarding_recovery (last_reminder_at desc, reminder_count);

insert into onboarding_recovery (business_id, organization_id, last_activity_at)
select b.id, b.organization_id, coalesce(b.updated_at, b.created_at)
from businesses b
where b.organization_id is not null
on conflict (business_id) do nothing;

insert into message_templates
  (template_key, name, description, category, subject, preview_text, heading, body, cta_label, cta_url, footer, variables)
values
  ('onboarding_recovery_light', 'Onboarding recovery · light', 'A contextual nudge for an early-stage setup that paused.', 'account',
   'Your {{business_name}} setup is off to a good start', 'You have already completed {{completion_percent}}% of your FrontDeskWise setup.',
   'You have already made a strong start',
   E'Hi {{first_name}},\n\nYou have completed {{completion_percent}}% of your FrontDeskWise setup for {{business_name}}. You have already {{completed_summary}}.\n\nYour next step is {{next_step}}. Completing it gives your AI front desk the context it needs to answer visitors and move them toward the right next action.',
   'Continue setup', '{{dashboard_url}}',
   E'You are receiving this onboarding recovery email because you started setting up FrontDeskWise. To stop recovery reminders: {{unsubscribe_url}}',
   '["first_name", "business_name", "completion_percent", "completed_summary", "next_step", "dashboard_url", "unsubscribe_url"]'::jsonb),
  ('onboarding_recovery_nearly_ready', 'Onboarding recovery · nearly ready', 'A stronger reminder for a setup that is more than halfway complete.', 'account',
   'You are almost ready to go live with {{business_name}}', 'Your FrontDeskWise setup is {{completion_percent}}% complete. One focused step remains.',
   'You are one focused step away',
   E'Hi {{first_name}},\n\nYour FrontDeskWise setup for {{business_name}} is {{completion_percent}}% complete. You have already {{completed_summary}}.\n\nThe remaining step is {{next_step}}. Finish it now so your website visitors can get an answer instead of leaving with an unanswered question.',
   'Finish my setup', '{{dashboard_url}}',
   E'You are receiving this onboarding recovery email because you started setting up FrontDeskWise. To stop recovery reminders: {{unsubscribe_url}}',
   '["first_name", "business_name", "completion_percent", "completed_summary", "next_step", "dashboard_url", "unsubscribe_url"]'::jsonb),
  ('onboarding_recovery_rescue', 'Onboarding recovery · rescue', 'A high-priority rescue email for a nearly complete setup with a blocker.', 'account',
   'Your FrontDeskWise setup is blocked at {{completion_percent}}%', 'We found the step keeping {{business_name}} from going live.',
   'Let us help you get unstuck',
   E'Hi {{first_name}},\n\nYour FrontDeskWise setup for {{business_name}} is {{completion_percent}}% complete. You have already {{completed_summary}}.\n\nThe current blocker is: {{current_blocker}}. Your next step is {{next_step}}. Once that is finished, FrontDeskWise can turn interested visitors into answered questions and actual appointments.\n\n{{last_error}}',
   'Resolve my blocker', '{{dashboard_url}}',
   E'You are receiving this onboarding recovery email because you started setting up FrontDeskWise. To stop recovery reminders: {{unsubscribe_url}}',
   '["first_name", "business_name", "completion_percent", "completed_summary", "current_blocker", "next_step", "last_error", "dashboard_url", "unsubscribe_url"]'::jsonb),
  ('onboarding_recovery_3_day', 'Onboarding recovery · 3 day', 'A recovery message with the exact next step after three days of inactivity.', 'account',
   'Your next FrontDeskWise step for {{business_name}}', 'Your setup is still here, along with the exact step to finish next.',
   'Your setup is ready when you are',
   E'Hi {{first_name}},\n\nYou have already {{completed_summary}} for {{business_name}}. The exact next step is {{next_step}}.\n\nFinishing this step gets your AI front desk closer to live conversations, lead capture, and bookings. Pick up where you left off whenever you are ready.',
   'Pick up my setup', '{{dashboard_url}}',
   E'You are receiving this onboarding recovery email because you started setting up FrontDeskWise. To stop recovery reminders: {{unsubscribe_url}}',
   '["first_name", "business_name", "completed_summary", "next_step", "dashboard_url", "unsubscribe_url"]'::jsonb),
  ('onboarding_recovery_7_day', 'Onboarding recovery · 7 day', 'The final nurture message before the recovery sequence goes dormant.', 'account',
   'Keep {{business_name}} moving toward a live AI front desk', 'Your FrontDeskWise setup is saved. Return whenever the timing is right.',
   'Your progress is saved',
   E'Hi {{first_name}},\n\nYour FrontDeskWise setup for {{business_name}} is saved at {{completion_percent}}%. You have already {{completed_summary}}.\n\nWhen you return, start with {{next_step}}. A few minutes of finishing work can give visitors a clear answer and your team a better path to the next appointment.',
   'Return to FrontDeskWise', '{{dashboard_url}}',
   E'This is the final onboarding recovery email in this sequence. To stop recovery reminders: {{unsubscribe_url}}',
   '["first_name", "business_name", "completion_percent", "completed_summary", "next_step", "dashboard_url", "unsubscribe_url"]'::jsonb),
  ('onboarding_recovery_rescue_alert', 'Onboarding rescue alert', 'Internal alert when a high-intent onboarding account is blocked near completion.', 'operational',
   'Onboarding rescue needed: {{business_name}}', 'A high-intent account is blocked at {{completion_percent}}%.',
   'Onboarding rescue needed',
   E'{{business_name}} is {{completion_percent}}% through onboarding and has been inactive with a blocker.\n\nOwner: {{first_name}}\nCompleted: {{completed_summary}}\nNext step: {{next_step}}\nBlocker: {{current_blocker}}\nLast error: {{last_error}}',
   'Open business in control plane', '{{admin_url}}',
   'Internal FrontDeskWise operator alert.',
   '["business_name", "completion_percent", "first_name", "completed_summary", "next_step", "current_blocker", "last_error", "admin_url"]'::jsonb)
on conflict (template_key) do update set
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  subject = excluded.subject,
  preview_text = excluded.preview_text,
  heading = excluded.heading,
  body = excluded.body,
  cta_label = excluded.cta_label,
  cta_url = excluded.cta_url,
  footer = excluded.footer,
  variables = excluded.variables,
  updated_at = now();

insert into message_automations
  (automation_key, template_key, event_type, delay_seconds, recipient_scope, mandatory)
values
  ('onboarding_recovery_light', 'onboarding_recovery_light', 'ONBOARDING_RECOVERY_LIGHT', 0, 'event_recipient', false),
  ('onboarding_recovery_nearly_ready', 'onboarding_recovery_nearly_ready', 'ONBOARDING_RECOVERY_NEARLY_READY', 0, 'event_recipient', false),
  ('onboarding_recovery_rescue', 'onboarding_recovery_rescue', 'ONBOARDING_RECOVERY_RESCUE', 0, 'event_recipient', false),
  ('onboarding_recovery_3_day', 'onboarding_recovery_3_day', 'ONBOARDING_RECOVERY_3_DAY', 0, 'event_recipient', false),
  ('onboarding_recovery_7_day', 'onboarding_recovery_7_day', 'ONBOARDING_RECOVERY_7_DAY', 0, 'event_recipient', false),
  ('onboarding_recovery_rescue_alert', 'onboarding_recovery_rescue_alert', 'ONBOARDING_RECOVERY_RESCUE_ALERT', 0, 'event_recipient', true)
on conflict (automation_key) do update set
  template_key = excluded.template_key,
  event_type = excluded.event_type,
  updated_at = now();
