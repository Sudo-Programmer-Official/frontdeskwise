create table if not exists organization_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid references businesses(id) on delete cascade,
  uploaded_by_user_id uuid references app_users(id) on delete set null,
  object_key text not null unique,
  original_file_name text not null,
  content_type text not null,
  size_bytes bigint not null default 0,
  etag text,
  status text not null default 'pending',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_documents_status_check check (status in ('pending', 'uploaded', 'processing', 'ready', 'failed', 'deleted')),
  constraint organization_documents_size_check check (size_bytes >= 0)
);

create index if not exists organization_documents_organization_idx
  on organization_documents (organization_id, created_at desc);

create index if not exists organization_documents_business_idx
  on organization_documents (business_id, created_at desc);

create index if not exists organization_documents_status_idx
  on organization_documents (organization_id, status, updated_at desc);
