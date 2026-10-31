-- Blocking a cashier invalidates their token permanently, including after unblocking.
create function private.revoke_blocked_cashier_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.is_active is distinct from true then
    update private.cashier_sessions set revoked_at = clock_timestamp()
      where cashier_id = new.id and revoked_at is null;
  end if;
  return new;
end; $$;
revoke all on function private.revoke_blocked_cashier_sessions() from public, anon, authenticated;
create trigger revoke_blocked_cashier_sessions after update of is_active on public.cashiers
  for each row execute function private.revoke_blocked_cashier_sessions();
update private.cashier_sessions cs set revoked_at = clock_timestamp()
  from public.cashiers c where c.id = cs.cashier_id and c.is_active is distinct from true and cs.revoked_at is null;

alter table public.cashier_shifts add column automatically_closed boolean not null default false;
alter table public.cashier_shifts drop constraint cashier_shifts_check;
alter table public.cashier_shifts add constraint shift_closure_cash_check check (
  (closed_at is null and closing_cash is null and not automatically_closed)
  or (closed_at is not null and (
    (automatically_closed and closing_cash is null)
    or (not automatically_closed and closing_cash is not null)
  ))
);
create index cashier_shifts_expiry_idx on public.cashier_shifts(opened_at) where closed_at is null;

create function private.close_expired_cashier_shifts(p_store_id uuid default null) returns void
language plpgsql security invoker set search_path = '' as $$
declare s public.cashier_shifts; revenue numeric;
begin
  -- Use the same shift lock as checkout, so totals include every committed sale.
  for s in select * from public.cashier_shifts
    where closed_at is null and opened_at + interval '12 hours' <= clock_timestamp()
      and (p_store_id is null or store_id = p_store_id)
    order by id for update
  loop
    select coalesce(sum(round(quantity * price_at_time,2)),0) into revenue
      from public.stock_movements where shift_id = s.id;
    update public.cashier_shifts set closed_at = s.opened_at + interval '12 hours',
      expected_cash = s.opening_cash + revenue, automatically_closed = true
      where id = s.id;
  end loop;
end; $$;
revoke all on function private.close_expired_cashier_shifts(uuid) from public, anon, authenticated;
grant execute on function private.close_expired_cashier_shifts(uuid) to service_role;

-- Also sweep before valid terminal requests; the cron job handles idle terminals.
create or replace function private.require_cashier_session(p_token_hash text) returns private.cashier_sessions
language plpgsql security invoker set search_path = '' as $$
declare s private.cashier_sessions;
begin
  select cs.* into s from private.cashier_sessions cs
  join public.cashiers c on c.id = cs.cashier_id and c.store_id = cs.store_id
  join public.stores st on st.id = cs.store_id
  where cs.token_hash = p_token_hash and cs.revoked_at is null
    and cs.expires_at > clock_timestamp() and c.is_active and st.is_active
  for share of cs, c, st;
  if not found then raise exception 'Сессия кассира истекла. Войдите снова.' using errcode = '28000'; end if;
  perform private.close_expired_cashier_shifts(s.store_id);
  return s;
end; $$;

-- A new session can continue the same cashier's existing shift. The opener remains
-- historical attribution; shift ownership is checked by cashier_id in terminal RPCs.
create or replace function public.cashier_create_session(p_cashier_id uuid, p_token_hash text) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; expiry timestamptz;
begin
  select * into c from public.cashiers where id = p_cashier_id and is_active for update;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    raise exception 'Кассир недоступен' using errcode = '42501';
  end if;
  if exists(select 1 from private.cashier_sessions
    where cashier_id = c.id and revoked_at is null and expires_at > clock_timestamp()) then
    raise exception 'Этот кассир уже вошёл на другом рабочем месте. Сначала завершите текущую сессию.' using errcode = 'PT409';
  end if;
  update private.cashier_sessions set revoked_at = clock_timestamp()
    where cashier_id = c.id and revoked_at is null;
  perform private.close_expired_cashier_shifts(c.store_id);
  insert into private.cashier_sessions(cashier_id,store_id,token_hash)
    values(c.id,c.store_id,p_token_hash) returning expires_at into expiry;
  update private.cashier_name_login_attempts set attempts = 0 where name = lower(btrim(c.name));
  return expiry;
end; $$;

-- Enforce the deadline even when a request waited for a shift/product lock.
create function private.check_cashier_movement_shift() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  if new.cashier_id is not null then
    select * into s from public.cashier_shifts where id = new.shift_id for update;
    if not found or s.closed_at is not null or s.opened_at + interval '12 hours' <= clock_timestamp() then
      raise exception 'Смена завершена. Обновите данные и откройте новую смену.' using errcode = '22023';
    end if;
  end if;
  return new;
end; $$;
revoke all on function private.check_cashier_movement_shift() from public, anon, authenticated;
create trigger check_cashier_movement_shift before insert on public.stock_movements
  for each row execute function private.check_cashier_movement_shift();

-- Repair shifts already stranded by expired sessions.
select private.close_expired_cashier_shifts();
