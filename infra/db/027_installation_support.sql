-- Installation assistance requests keep the website setup path self-service
-- while giving the FrontDeskWise team enough context to step in quickly.

create table if not exists installation_support_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  requester_user_id uuid references app_users(id) on delete set null,
  requester_name text not null,
  requester_email text not null,
  business_name text not null,
  website_url text not null,
  platform text not null check (platform in ('wordpress', 'wix', 'shopify', 'squarespace', 'custom', 'not_sure')),
  help_request text not null,
  preferred_contact_method text not null check (preferred_contact_method in ('email', 'phone')),
  contact_value text not null,
  message text,
  screenshot_url text,
  ownership_status text not null default 'pending',
  widget_detected boolean not null default false,
  widget_last_loaded_at timestamptz,
  widget_load_count integer not null default 0,
  assigned_user_id uuid references app_users(id) on delete set null,
  status text not null default 'new' check (status in ('new', 'in_progress', 'resolved')),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists installation_support_requests_queue_idx
  on installation_support_requests (status, created_at desc);
create index if not exists installation_support_requests_business_idx
  on installation_support_requests (business_id, created_at desc);
create index if not exists installation_support_requests_assignee_idx
  on installation_support_requests (assigned_user_id, status, created_at desc);
