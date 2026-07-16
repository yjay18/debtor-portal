-- The browser has no direct account-data path. With no policies, RLS denies
-- anonymous and publishable-key access while the server secret key bypasses it.
alter table public.account_holders enable row level security;
alter table public.related_people enable row level security;
alter table public.promises_to_pay enable row level security;
alter table public.transactions enable row level security;
alter table public.call_appointments enable row level security;
alter table public.notification_attempts enable row level security;
alter table public.conversations enable row level security;
alter table public.chat_messages enable row level security;
