-- Make website onboarding outcomes durable and distinct from generic source
-- crawl status. This prevents an empty Business Brain from looking complete.
alter table businesses
  add column if not exists onboarding_status text not null default 'needs_attention',
  add column if not exists onboarding_failure_code text,
  add column if not exists onboarding_validation jsonb not null default '{}'::jsonb,
  add column if not exists onboarding_validated_at timestamptz;

alter table businesses
  drop constraint if exists businesses_onboarding_status_check,
  add constraint businesses_onboarding_status_check
    check (onboarding_status in ('valid', 'needs_attention')),
  drop constraint if exists businesses_onboarding_failure_code_check,
  add constraint businesses_onboarding_failure_code_check
    check (onboarding_failure_code is null or onboarding_failure_code in (
      'DOMAIN_NOT_FOUND', 'DNS_FAILURE', 'SSL_FAILURE', 'TIMEOUT',
      'ROBOTS_BLOCKED', 'AUTH_REQUIRED', 'SPA_RENDER_FAILURE',
      'NO_USEFUL_CONTENT', 'WRONG_BUSINESS_DETECTED', 'CRAWL_PARTIAL',
      'HTTP_ERROR', 'INVALID_URL', 'CRAWL_ERROR'
    ));

alter table business_sources
  add column if not exists error_code text;

alter table business_sources
  drop constraint if exists business_sources_error_code_check,
  add constraint business_sources_error_code_check
    check (error_code is null or error_code in (
      'DOMAIN_NOT_FOUND', 'DNS_FAILURE', 'SSL_FAILURE', 'TIMEOUT',
      'ROBOTS_BLOCKED', 'AUTH_REQUIRED', 'SPA_RENDER_FAILURE',
      'NO_USEFUL_CONTENT', 'WRONG_BUSINESS_DETECTED', 'CRAWL_PARTIAL',
      'HTTP_ERROR', 'INVALID_URL', 'CRAWL_ERROR'
    ));

create index if not exists businesses_onboarding_status_idx
  on businesses (onboarding_status, onboarding_failure_code, updated_at desc);
