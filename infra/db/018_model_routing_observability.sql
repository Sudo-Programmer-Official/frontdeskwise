alter table conversation_messages
  add column if not exists model_route text,
  add column if not exists model_name text,
  add column if not exists input_tokens integer not null default 0,
  add column if not exists output_tokens integer not null default 0,
  add column if not exists estimated_cost_usd numeric(12, 8),
  add column if not exists model_latency_ms integer;

alter table organization_usage_daily
  add column if not exists llm_estimated_cost_usd numeric(12, 8) not null default 0;

create index if not exists conversation_messages_model_route_idx
  on conversation_messages (model_route, created_at desc);
