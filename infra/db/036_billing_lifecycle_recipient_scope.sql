-- Organization-level billing notices must target the billing owner directly.
-- They cannot depend on a business row, especially during first purchase.
update message_automations
set recipient_scope = 'event_recipient', updated_at = now()
where event_type in (
  'SUBSCRIPTION_ACTIVATED',
  'SUBSCRIPTION_UPDATED',
  'PAYMENT_FAILED',
  'SUBSCRIPTION_CANCELED'
);
