create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  account_holder_id uuid not null
    references public.account_holders(id) on delete cascade,
  pending_action jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.conversations(id) on delete cascade,
  role text not null
    check (role in ('account_holder', 'assistant')),
  content text not null,
  action text,
  metadata jsonb,
  created_at timestamptz not null default now()
);
