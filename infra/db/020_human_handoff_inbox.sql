-- Production conversation operations: team access, human handoff, inbox state,
-- notifications, assignments, audit events, and private staff notes.

alter table conversations
  add column if not exists status text not null default 'AI_ACTIVE',
  add column if not exists assigned_user_id uuid references app_users(id) on delete set null,
  add column if not exists assigned_at timestamptz,
  add column if not exists handoff_reason text,
  add column if not exists handoff_requested_at timestamptz,
  add column if not exists human_joined_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists unread_count integer not null default 0,
  add column if not exists last_activity_at timestamptz not null default now();

update conversations set status = 'AI_ACTIVE' where status is null or status = 'open';
update conversations set last_activity_at = coalesce(last_activity_at, updated_at, created_at, now());

alter table conversations drop constraint if exists conversations_status_check;
alter table conversations add constraint conversations_status_check
  check (status in ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'WAITING_FOR_STAFF', 'HUMAN_ACTIVE', 'AI_ASSISTED', 'RESOLVED'));

create index if not exists conversations_inbox_idx
  on conversations (business_id, status, last_activity_at desc);
create index if not exists conversations_assignee_idx
  on conversations (assigned_user_id, status, last_activity_at desc);

alter table conversation_messages
  add column if not exists author_user_id uuid references app_users(id) on delete set null,
  add column if not exists kind text not null default 'message';

alter table conversation_messages drop constraint if exists conversation_messages_role_check;
alter table conversation_messages add constraint conversation_messages_role_check
  check (role in ('user', 'assistant', 'human', 'system'));

alter table conversation_messages drop constraint if exists conversation_messages_kind_check;
alter table conversation_messages add constraint conversation_messages_kind_check
  check (kind in ('message', 'system', 'internal_note'));

create table if not exists conversation_assignments (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  assigned_by_user_id uuid references app_users(id) on delete set null,
  status text not null default 'active' check (status in ('active', 'released')),
  assigned_at timestamptz not null default now(),
  released_at timestamptz
);

create unique index if not exists conversation_assignments_active_idx
  on conversation_assignments (conversation_id) where status = 'active';
create index if not exists conversation_assignments_user_idx
  on conversation_assignments (business_id, user_id, status, assigned_at desc);

create table if not exists conversation_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  event_type text not null check (event_type in (
    'AI_HANDOFF_REQUESTED', 'STAFF_NOTIFIED', 'STAFF_ASSIGNED',
    'HUMAN_JOINED', 'MESSAGE_SENT_BY_HUMAN', 'RETURNED_TO_AI',
    'CONVERSATION_RESOLVED', 'VISITOR_REPLIED', 'INTERNAL_NOTE_ADDED',
    'AI_RESPONSE_SENT'
  )),
  actor_user_id uuid references app_users(id) on delete set null,
  actor_type text not null default 'system' check (actor_type in ('visitor', 'ai', 'staff', 'system')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conversation_events_conversation_idx
  on conversation_events (conversation_id, created_at desc);
create index if not exists conversation_events_business_idx
  on conversation_events (business_id, event_type, created_at desc);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  user_id uuid not null references app_users(id) on delete cascade,
  type text not null,
  conversation_id uuid references conversations(id) on delete cascade,
  lead_id uuid references leads(id) on delete set null,
  title text not null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on notifications (user_id, read_at, created_at desc);
create index if not exists notifications_business_idx
  on notifications (business_id, created_at desc);

create table if not exists internal_notes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  author_user_id uuid not null references app_users(id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists internal_notes_conversation_idx
  on internal_notes (conversation_id, created_at desc);

alter table business_actions
  add column if not exists requires_staff boolean not null default false,
  add column if not exists notify_targets jsonb not null default '{"mode":"business_team"}'::jsonb,
  add column if not exists notify_channels jsonb not null default '["in_app", "email"]'::jsonb;

