create extension if not exists pgcrypto;
-- The RDS instance must have the pgvector extension available for this migration.
create extension if not exists vector;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  vertical text not null default 'local_business',
  website_url text,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists business_sources (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_url text not null,
  title text,
  content_type text not null default 'web_page',
  content_hash text,
  last_crawled_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists business_sources_business_hash_idx
  on business_sources (business_id, content_hash)
  where content_hash is not null;

create table if not exists knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  source_id uuid references business_sources(id) on delete set null,
  content text not null,
  content_hash text not null,
  metadata jsonb not null default '{}'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_business_idx on knowledge_chunks (business_id);
create unique index if not exists knowledge_chunks_business_hash_idx
  on knowledge_chunks (business_id, content_hash);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  session_id text not null,
  status text not null default 'open',
  lead_captured boolean not null default false,
  action_taken text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists conversations_business_idx on conversations (business_id, created_at desc);

create table if not exists conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  grounded boolean,
  source_url text,
  created_at timestamptz not null default now()
);

create index if not exists conversation_messages_conversation_idx
  on conversation_messages (conversation_id, created_at);

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  name text,
  email text,
  phone text,
  intent text,
  status text not null default 'new',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists leads_business_idx on leads (business_id, created_at desc);

create table if not exists knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  question text not null,
  occurrence_count integer not null default 1,
  status text not null default 'open',
  approved_answer text,
  last_seen_at timestamptz not null default now(),
  unique (business_id, question)
);

create table if not exists agent_configs (
  business_id uuid primary key references businesses(id) on delete cascade,
  assistant_name text not null default 'Assistant',
  welcome_message text not null,
  widget_color text not null default '#0d6efd',
  collect_leads boolean not null default true,
  show_booking_action boolean not null default true,
  fallback_message text not null default 'I do not have enough information to answer that confidently. I can take your details and have the team follow up.',
  updated_at timestamptz not null default now()
);

