-- Evidence-backed, business-neutral website conversion actions.
alter table business_actions
  add column if not exists action_type text not null default 'contact_team',
  add column if not exists mode text not null default 'transactional',
  add column if not exists destination jsonb,
  add column if not exists provider text,
  add column if not exists priority integer not null default 500,
  add column if not exists required_fields jsonb not null default '[]'::jsonb,
  add column if not exists conditions jsonb not null default '[]'::jsonb,
  add column if not exists safety_policy text not null default 'standard',
  add column if not exists source_url text,
  add column if not exists evidence jsonb not null default '[]'::jsonb,
  add column if not exists confidence numeric(4,3) not null default 0.5;

update business_actions
set action_type = case action_key
  when 'book_appointment' then 'book_appointment'
  when 'schedule_consultation' then 'book_appointment'
  when 'book_tour' then 'external_booking'
  when 'enroll_child' then 'enroll'
  when 'request_quote' then 'request_quote'
  when 'schedule_service' then 'schedule_service'
  when 'request_demo' then 'request_demo'
  when 'call_business' then 'call_business'
  when 'call_emergency' then 'call_emergency'
  when 'external_booking' then 'external_booking'
  when 'join_waitlist' then 'join_waitlist'
  when 'capture_lead' then 'contact_team'
  else action_type
end
where action_type = 'contact_team';

create index if not exists business_actions_type_priority_idx
  on business_actions (business_id, action_type, enabled, priority desc);
