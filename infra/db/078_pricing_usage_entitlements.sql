-- Align the public catalog with the launch pricing test:
-- outcome-led packaging, explicit AI conversation allowances, and custom
-- pooled capacity for agencies instead of an unprotected five-location bundle.

insert into billing_plans
  (plan_key, display_name, description, public, active, monthly_amount_cents, currency, max_businesses)
values
  ('starter', 'Starter', 'One business with grounded website answers, lead capture, and a clear usage allowance.', true, true, 9900, 'usd', 1),
  ('growth', 'Growth', 'One business with booking workflows, integrations, human handoff, and reporting.', true, true, 19900, 'usd', 1),
  ('multi_business', 'Business Plus', 'Two businesses under one organization with shared workflows and pooled usage.', true, true, 34900, 'usd', 2),
  ('portfolio', 'Portfolio / Agency', 'Custom per-location pricing with pooled capacity and centralized administration.', true, true, null, 'usd', 5)
on conflict (plan_key) do update set
  display_name = excluded.display_name,
  description = excluded.description,
  public = excluded.public,
  active = excluded.active,
  monthly_amount_cents = excluded.monthly_amount_cents,
  currency = excluded.currency,
  max_businesses = excluded.max_businesses,
  updated_at = now();

insert into billing_plan_entitlements (plan_key, entitlement_key, entitlement_value)
values
  ('starter', 'ai_conversations', '{"included":300,"period":"month","billing":"included"}'),
  ('growth', 'ai_conversations', '{"included":1000,"period":"month","billing":"included"}'),
  ('multi_business', 'ai_conversations', '{"included":2000,"period":"month","billing":"shared"}'),
  ('portfolio', 'ai_conversations', '{"included":null,"period":"month","billing":"custom_pooled"}'),
  ('starter', 'setup_support', '{"mode":"self_serve_checklist"}'),
  ('growth', 'setup_support', '{"mode":"guided"}'),
  ('multi_business', 'setup_support', '{"mode":"guided"}'),
  ('portfolio', 'setup_support', '{"mode":"priority"}')
on conflict (plan_key, entitlement_key) do update set
  entitlement_value = excluded.entitlement_value,
  updated_at = now();
