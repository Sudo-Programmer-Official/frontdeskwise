-- Ownership verification for live publishing and production lead capture.
-- Temporary demos remain usable in sandbox mode, but a claimed business must
-- prove control of its website before the public widget is enabled.

alter table businesses
  add column if not exists ownership_status text not null default 'pending',
  add column if not exists ownership_verification_method text,
  add column if not exists ownership_verification_token_hash text,
  add column if not exists ownership_verification_expires_at timestamptz,
  add column if not exists ownership_verified_at timestamptz,
  add column if not exists ownership_verified_by_user_id uuid references app_users(id) on delete set null;

alter table businesses
  drop constraint if exists businesses_ownership_status_check,
  add constraint businesses_ownership_status_check
    check (ownership_status in ('pending', 'verified', 'rejected')),
  drop constraint if exists businesses_ownership_method_check,
  add constraint businesses_ownership_method_check
    check (ownership_verification_method is null or ownership_verification_method in ('email', 'meta_tag', 'file', 'dns_txt', 'manual'));

create index if not exists businesses_ownership_status_idx
  on businesses (ownership_status, updated_at desc);

update businesses
set ownership_status = 'verified',
    ownership_verification_method = coalesce(ownership_verification_method, 'manual'),
    ownership_verified_at = coalesce(ownership_verified_at, now())
where is_internal_demo = true;
