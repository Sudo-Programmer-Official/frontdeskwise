-- Owner-authored answers are evidence by default. A fixed response is an
-- explicit exception for wording that must be returned nearly verbatim.
alter table knowledge_gaps
  add column if not exists answer_mode text not null default 'knowledge';

alter table knowledge_gaps
  drop constraint if exists knowledge_gaps_answer_mode_check,
  add constraint knowledge_gaps_answer_mode_check
    check (answer_mode in ('knowledge', 'fixed_response'));

create index if not exists knowledge_chunks_faq_question_idx
  on knowledge_chunks (business_id)
  where (metadata ->> 'sourceType') = 'knowledge_answer';

-- Custom tone instructions are optional; the selected built-in tone remains
-- the default when this field is blank.
alter table agent_configs
  add column if not exists tone_instructions text not null default '';
