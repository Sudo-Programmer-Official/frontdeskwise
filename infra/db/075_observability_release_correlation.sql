-- Stable release/deployment/tenant/workflow/model dimensions for production
-- debugging. JSON metadata remains for replay, while these columns make the
-- most important dimensions filterable without parsing payloads.

alter table conversation_messages
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists publication_version integer,
  add column if not exists workflow_action_id text,
  add column if not exists workflow_key text,
  add column if not exists workflow_version integer,
  add column if not exists model_routing_version text,
  add column if not exists correlation_id text;

create index if not exists conversation_messages_correlation_idx
  on conversation_messages (correlation_id)
  where correlation_id is not null;

alter table conversation_events
  add column if not exists organization_id uuid references organizations(id) on delete set null,
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists publication_version integer,
  add column if not exists workflow_action_id text,
  add column if not exists workflow_key text,
  add column if not exists workflow_version integer,
  add column if not exists model_routing_version text,
  add column if not exists model_route text,
  add column if not exists model_name text,
  add column if not exists correlation_id text;

create index if not exists conversation_events_release_idx
  on conversation_events (release_version, created_at desc);
create index if not exists conversation_events_correlation_idx
  on conversation_events (correlation_id)
  where correlation_id is not null;
create index if not exists conversation_events_tenant_publication_idx
  on conversation_events (business_id, publication_version, created_at desc);

alter table conversion_events
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists publication_version integer,
  add column if not exists workflow_key text,
  add column if not exists workflow_version integer,
  add column if not exists model_routing_version text,
  add column if not exists model_route text,
  add column if not exists model_name text,
  add column if not exists correlation_id text;

create index if not exists conversion_events_release_idx
  on conversion_events (release_version, occurred_at desc);
create index if not exists conversion_events_correlation_idx
  on conversion_events (correlation_id)
  where correlation_id is not null;

alter table experience_signals
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists workflow_action_id text,
  add column if not exists workflow_key text,
  add column if not exists workflow_version integer,
  add column if not exists model_routing_version text,
  add column if not exists model_route text,
  add column if not exists model_name text,
  add column if not exists correlation_id text;

create index if not exists experience_signals_release_idx
  on experience_signals (release_version, occurred_at desc);
create index if not exists experience_signals_correlation_idx
  on experience_signals (correlation_id)
  where correlation_id is not null;

alter table widget_performance_events
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists publication_version integer,
  add column if not exists correlation_id text;

create index if not exists widget_performance_release_idx
  on widget_performance_events (release_version, occurred_at desc);
create index if not exists widget_performance_correlation_idx
  on widget_performance_events (correlation_id)
  where correlation_id is not null;

alter table security_events
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists correlation_id text;

alter table privileged_audit_events
  add column if not exists release_version text,
  add column if not exists deployment_version text,
  add column if not exists correlation_id text;

create index if not exists security_events_release_idx
  on security_events (release_version, created_at desc);
create index if not exists privileged_audit_events_release_idx
  on privileged_audit_events (release_version, created_at desc);
