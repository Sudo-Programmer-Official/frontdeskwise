-- Capture only the missing contact channel after a handoff is already queued.
-- This state keeps the visitor-facing AI available while the team is notified.
alter table conversations drop constraint if exists conversations_status_check;
alter table conversations add constraint conversations_status_check
  check (status in ('AI_ACTIVE', 'HANDOFF_REQUESTED', 'CONTACT_REQUIRED', 'WAITING_FOR_STAFF', 'FOLLOW_UP_PENDING', 'HUMAN_ACTIVE', 'AI_ASSISTED', 'RESOLVED', 'EXPIRED'));

