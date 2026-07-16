-- Starter schema for the account self-service chatbot challenge.
-- Candidates should evolve this shape as needed and document their final model.

create extension if not exists pgcrypto;

create table if not exists public.account_holders (
  id uuid primary key default gen_random_uuid(),
  account_id text not null unique,
  first_name text not null,
  last_name text not null,
  email text not null,
  phone text not null,
  address_line1 text not null,
  address_line2 text,
  city text not null,
  postal_code text not null,
  country text not null,
  preferred_contact_method text not null check (preferred_contact_method in ('email', 'sms', 'phone')),
  reference text not null,
  creditor_name text not null,
  currency text not null default 'EUR',
  balance_cents integer not null check (balance_cents >= 0),
  status text not null,
  days_past_due integer not null default 0,
  minimum_payment_cents integer not null default 0,
  last_payment_date date,
  last_payment_amount_cents integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.related_people (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null references public.account_holders(id) on delete cascade,
  name text not null,
  email text not null,
  phone text not null,
  relationship text,
  authorized_to_act boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.promises_to_pay (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null references public.account_holders(id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'EUR',
  due_date date not null,
  status text not null check (status in ('active', 'completed', 'cancelled', 'missed')),
  created_at timestamptz not null default now()
);

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null references public.account_holders(id) on delete cascade,
  type text not null check (type in ('payment', 'charge', 'fee', 'adjustment')),
  status text not null check (status in ('completed', 'pending', 'failed', 'posted')),
  amount_cents integer not null,
  currency text not null default 'EUR',
  description text not null,
  transaction_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.call_appointments (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null references public.account_holders(id) on delete cascade,
  scheduled_at timestamptz not null,
  phone text not null,
  reason text,
  status text not null check (status in ('scheduled', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_attempts (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null references public.account_holders(id) on delete cascade,
  trigger_action text not null,
  recipient_email text not null,
  email_provider text not null default 'resend',
  status text not null check (status in ('queued', 'sent', 'failed', 'logged')),
  sensitive_detail_in_pdf boolean not null default true,
  error_message text,
  created_at timestamptz not null default now()
);

insert into public.account_holders (
  account_id,
  first_name,
  last_name,
  email,
  phone,
  address_line1,
  address_line2,
  city,
  postal_code,
  country,
  preferred_contact_method,
  reference,
  creditor_name,
  currency,
  balance_cents,
  status,
  days_past_due,
  minimum_payment_cents,
  last_payment_date,
  last_payment_amount_cents
)
values (
  'acc_standard_001',
  'Jane',
  'Murphy',
  'jane.murphy@example.test',
  '+353831234567',
  '12 River Walk',
  'Rathmines',
  'Dublin',
  'D06 X123',
  'Ireland',
  'email',
  'EI-2026-000123',
  'Example Energy Ireland',
  'EUR',
  128500,
  'overdue',
  47,
  2500,
  '2026-01-10',
  5000
)
on conflict (account_id) do nothing;

with seeded_account as (
  select id
  from public.account_holders
  where account_id = 'acc_standard_001'
)
insert into public.related_people (
  account_holder_id,
  name,
  email,
  phone,
  relationship,
  authorized_to_act
)
select
  id,
  'John Murphy',
  'john.murphy@example.test',
  '+353831987654',
  'spouse',
  false
from seeded_account
on conflict do nothing;

with seeded_account as (
  select id
  from public.account_holders
  where account_id = 'acc_standard_001'
)
insert into public.promises_to_pay (
  account_holder_id,
  amount_cents,
  currency,
  due_date,
  status,
  created_at
)
select id, 25000, 'EUR', '2026-07-15', 'active', '2026-06-20 10:15:00+00'
from seeded_account
on conflict do nothing;

with seeded_account as (
  select id
  from public.account_holders
  where account_id = 'acc_standard_001'
)
insert into public.transactions (
  account_holder_id,
  type,
  status,
  amount_cents,
  currency,
  description,
  transaction_date
)
select id, 'payment', 'completed', 5000, 'EUR', 'Card payment', date '2026-01-10'
from seeded_account
union all
select id, 'charge', 'posted', 12500, 'EUR', 'Winter usage adjustment', date '2026-01-18'
from seeded_account
on conflict do nothing;

with seeded_account as (
  select id
  from public.account_holders
  where account_id = 'acc_standard_001'
)
insert into public.call_appointments (
  account_holder_id,
  scheduled_at,
  phone,
  reason,
  status
)
select
  id,
  timestamptz '2026-07-03 09:30:00+01',
  '+353831234567',
  'Discuss payment options',
  'scheduled'
from seeded_account
on conflict do nothing;
