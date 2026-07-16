create or replace function public.enqueue_account_change_notification()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_account_id uuid;
  v_recipient_email text;
begin
  if tg_op = 'UPDATE' and to_jsonb(new) - 'updated_at' = to_jsonb(old) - 'updated_at' then
    return new;
  end if;

  if tg_table_name = 'account_holders' then
    v_account_id := coalesce(new.id, old.id);
    v_recipient_email := coalesce(new.email, old.email);
  else
    v_account_id := coalesce(new.account_holder_id, old.account_holder_id);
    select email into v_recipient_email from public.account_holders where id = v_account_id;
  end if;

  insert into public.notification_attempts
    (account_holder_id, trigger_action, recipient_email, status)
  values
    (v_account_id, tg_table_name || ':' || lower(tg_op), coalesce(v_recipient_email, 'unknown'), 'queued');

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists account_holders_notification_outbox on public.account_holders;
create trigger account_holders_notification_outbox after insert or update or delete on public.account_holders
for each row execute function public.enqueue_account_change_notification();
drop trigger if exists related_people_notification_outbox on public.related_people;
create trigger related_people_notification_outbox after insert or update or delete on public.related_people
for each row execute function public.enqueue_account_change_notification();
drop trigger if exists promises_to_pay_notification_outbox on public.promises_to_pay;
create trigger promises_to_pay_notification_outbox after insert or update or delete on public.promises_to_pay
for each row execute function public.enqueue_account_change_notification();
drop trigger if exists transactions_notification_outbox on public.transactions;
create trigger transactions_notification_outbox after insert or update or delete on public.transactions
for each row execute function public.enqueue_account_change_notification();
drop trigger if exists call_appointments_notification_outbox on public.call_appointments;
create trigger call_appointments_notification_outbox after insert or update or delete on public.call_appointments
for each row execute function public.enqueue_account_change_notification();
