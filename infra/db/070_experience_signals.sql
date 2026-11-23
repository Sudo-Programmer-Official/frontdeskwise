-- Durable, privacy-bounded visitor experience signals. The redacted excerpt and
-- compact trace support Super Admin debugging; owner-facing views use only the
-- aggregate fields and never expose this table's raw trace.
create table if not exists experience_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references organizations(id) on delete cascade,
  business_id uuid not null references businesses(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  type text not null check (type in (
    'frustration', 'repeated_question', 'correction_loop', 'wrong_answer',
    'failed_action', 'provider_error', 'confusing_workflow', 'handoff_request',
    'abandonment'
  )),
  severity text not null check (severity in ('low', 'medium', 'high', 'critical')),
  confidence numeric(4, 3) not null check (confidence >= 0 and confidence <= 1),
  likely_layer text not null check (likely_layer in (
    'crawl', 'retrieval', 'generation', 'routing', 'workflow', 'provider',
    'widget', 'ux'
  )),
  reason text,
  message_excerpt_redacted text,
  workflow_step text,
  publication_version integer,
  model_role text,
  provider_state jsonb not null default '{}'::jsonb,
  validation_result jsonb not null default '{}'::jsonb,
  session_trace jsonb not null default '{}'::jsonb,
  cluster_key text not null,
  status text not null default 'open' check (status in ('open', 'reviewed', 'resolved', 'ignored')),
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists experience_signals_business_time_idx
  on experience_signals (business_id, occurred_at desc);
create index if not exists experience_signals_triage_idx
  on experience_signals (severity, status, occurred_at desc);
create index if not exists experience_signals_cluster_idx
  on experience_signals (business_id, cluster_key, occurred_at desc);
create index if not exists experience_signals_conversation_idx
  on experience_signals (conversation_id, occurred_at desc)
  where conversation_id is not null;
