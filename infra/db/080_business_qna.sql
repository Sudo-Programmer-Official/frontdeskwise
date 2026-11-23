-- Owner-maintained Business Q&A. Q&A is a structured layer over the existing
-- Business Brain and keeps provenance back to the visitor question that
-- created it.
create table if not exists business_qna (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  canonical_question text not null,
  canonical_answer text not null,
  variants text[] not null default '{}',
  status text not null default 'NEEDS_REVIEW',
  source_type text not null default 'OWNER',
  source_references jsonb not null default '[]'::jsonb,
  answer_gap_id uuid references knowledge_gaps(id) on delete set null,
  created_by uuid references app_users(id) on delete set null,
  updated_by uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_reviewed_at timestamptz,
  valid_until timestamptz,
  times_used integer not null default 0,
  last_used_at timestamptz,
  constraint business_qna_status_check check (status in ('VERIFIED', 'NEEDS_REVIEW', 'CONFLICTED', 'STALE', 'ARCHIVED')),
  constraint business_qna_source_type_check check (source_type in ('OWNER', 'OWNER_CONFIRMED', 'WEBSITE_DERIVED')),
  constraint business_qna_times_used_check check (times_used >= 0)
);

create unique index if not exists business_qna_business_question_idx
  on business_qna (business_id, lower(canonical_question));

create index if not exists business_qna_business_status_idx
  on business_qna (business_id, status, updated_at desc);

create index if not exists business_qna_business_usage_idx
  on business_qna (business_id, times_used desc, last_used_at desc);

alter table knowledge_gaps
  add column if not exists resolution_type text,
  add column if not exists resolved_qna_id uuid references business_qna(id) on delete set null,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references app_users(id) on delete set null;

alter table knowledge_gaps
  drop constraint if exists knowledge_gaps_resolution_type_check,
  add constraint knowledge_gaps_resolution_type_check
    check (resolution_type is null or resolution_type in ('OWNER_QNA'));
