alter table public.transactions
  add column if not exists idempotency_key text;

create unique index if not exists transactions_account_idempotency_uidx
  on public.transactions (account_holder_id, idempotency_key)
  where idempotency_key is not null;

create or replace function public.record_payment(
  p_account_holder_id uuid,
  p_amount_cents integer,
  p_idempotency_key text
)
returns table (transaction_id uuid, new_balance_cents integer, replayed boolean)
language plpgsql
set search_path = public
as $$
declare
  v_existing public.transactions%rowtype;
  v_balance integer;
  v_currency text;
  v_transaction_id uuid;
begin
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' or length(p_idempotency_key) > 128 then
    raise exception 'INVALID_IDEMPOTENCY_KEY';
  end if;

  select transaction_row.* into v_existing
  from public.transactions as transaction_row
  where transaction_row.account_holder_id = p_account_holder_id
    and transaction_row.idempotency_key = p_idempotency_key;
  if found then
    select holder.balance_cents into v_balance
    from public.account_holders as holder
    where holder.id = p_account_holder_id;
    return query select v_existing.id, v_balance, true;
    return;
  end if;

  update public.account_holders as holder
  set balance_cents = holder.balance_cents - p_amount_cents,
      updated_at = now()
  where holder.id = p_account_holder_id
    and holder.balance_cents >= p_amount_cents
  returning holder.balance_cents, holder.currency into v_balance, v_currency;

  if not found then
    if exists (select 1 from public.account_holders as holder where holder.id = p_account_holder_id) then
      raise exception 'INSUFFICIENT_BALANCE';
    end if;
    raise exception 'ACCOUNT_NOT_FOUND';
  end if;

  insert into public.transactions (
    account_holder_id, type, status, amount_cents, currency,
    description, transaction_date, idempotency_key
  ) values (
    p_account_holder_id, 'payment', 'completed', p_amount_cents, v_currency,
    'Chat payment using saved payment details', current_date, p_idempotency_key
  ) returning id into v_transaction_id;

  return query select v_transaction_id, v_balance, false;
end;
$$;

revoke execute on function public.record_payment(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.record_payment(uuid, integer, text) to service_role;
