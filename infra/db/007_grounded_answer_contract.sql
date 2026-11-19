-- Grounded answer contract and owner-facing retrieval diagnostics.

alter table conversation_messages
  add column if not exists confidence_score numeric(5,4),
  add column if not exists confidence_band text,
  add column if not exists citations jsonb not null default '[]'::jsonb,
  add column if not exists retrieval jsonb;

alter table conversation_messages
  drop constraint if exists conversation_messages_confidence_band_check,
  add constraint conversation_messages_confidence_band_check
    check (confidence_band is null or confidence_band in ('high', 'medium', 'low'));

create index if not exists conversation_messages_retrieval_idx
  on conversation_messages (conversation_id, created_at desc)
  where retrieval is not null;
