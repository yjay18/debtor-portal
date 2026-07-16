alter table public.account_holders
  add column if not exists billing_due_date date,
  add column if not exists last_statement_amount_cents integer,
  add column if not exists meta jsonb not null default '{}'::jsonb;

update public.account_holders
set
  billing_due_date = date '2026-01-24',
  last_statement_amount_cents = 116000,
  meta = '{
    "support": {
      "humanSupportAvailable": true,
      "supportPhone": "+35318000000",
      "supportEmail": "support@example.test"
    },
    "paymentOptions": {
      "payNowEnabled": true,
      "promiseToPayEnabled": true,
      "mockPaymentsEnabled": true,
      "arrangementEnabled": false,
      "eligibleArrangementOptions": []
    },
    "notificationRules": {
      "sendEmailOnDataChange": true,
      "pdfPasswordSource": "account_phone_last4"
    },
    "faqContext": {
      "recentStatementReason": "Higher winter usage and one missed direct debit",
      "acceptedPaymentMethods": ["card", "bank_transfer"]
    }
  }'::jsonb
where account_id = 'acc_standard_001';
