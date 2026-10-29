-- Cashiers use PIN-authenticated terminal sessions, separate from owner Supabase Auth.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

alter table public.cashiers add column login_code text not null
  default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) unique;

create table private.cashier_login_attempts (
  cashier_id uuid primary key references public.cashiers(id),
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0
);
create table private.cashier_sessions (
  id uuid primary key default gen_random_uuid(),
  cashier_id uuid not null references public.cashiers(id),
  store_id uuid not null references public.stores(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp() + interval '12 hours'),
  revoked_at timestamptz
);
alter table private.cashier_login_attempts enable row level security;
alter table private.cashier_sessions enable row level security;
grant select, insert, update on private.cashier_login_attempts, private.cashier_sessions to service_role;

alter table public.cashier_shifts alter column opened_by drop not null;
alter table public.cashier_shifts add column opened_session_id uuid references private.cashier_sessions(id);
grant select, insert, update on public.cashier_shifts to service_role;
alter table public.stock_movements add column cashier_id uuid references public.cashiers(id);
alter table public.stock_movements add column cashier_session_id uuid references private.cashier_sessions(id);
create index stock_movements_cashier_time_idx on public.stock_movements(cashier_id, created_at desc);
-- Keep historical rows untouched, while requiring an unambiguous actor on every new movement.
alter table public.stock_movements add constraint stock_movement_actor_required check (
  (created_by is not null and cashier_id is null and cashier_session_id is null)
  or (created_by is null and cashier_id is not null and cashier_session_id is not null and shift_id is not null)
) not valid;
alter table public.cashier_shifts add constraint shift_opener_required check (
  (opened_by is not null and opened_session_id is null)
  or (opened_by is null and opened_session_id is not null)
) not valid;

-- Existing owner operations keep created_by; never attribute them to a cashier retroactively.
-- Remove owner-facing shift APIs entirely (not just their UI buttons).
alter function public.open_store_shift(uuid,uuid,numeric) set schema private;
alter function public.close_store_shift(uuid,numeric) set schema private;
revoke all on function private.open_store_shift(uuid,uuid,numeric) from public, anon, authenticated;
revoke all on function private.close_store_shift(uuid,numeric) from public, anon, authenticated;
alter function public.record_store_movement(uuid,uuid,text,numeric,text,uuid) set schema private;
revoke all on function private.record_store_movement(uuid,uuid,text,numeric,text,uuid) from public, anon, authenticated;

-- Owners may receive/write off stock as themselves, but cannot sell as a cashier.
create function public.record_store_movement(
  p_store_id uuid, p_product_id uuid, p_kind text, p_quantity numeric,
  p_note text default null, p_shift_id uuid default null
) returns public.stock_movements language plpgsql security definer set search_path = '' as $$
begin
  if p_kind is null or p_kind not in ('receipt', 'writeoff') or p_shift_id is not null then
    raise exception 'Продажи и управление сменой доступны только на рабочем месте кассира' using errcode = '42501';
  end if;
  return private.record_store_movement(p_store_id,p_product_id,p_kind,p_quantity,p_note,null);
end;
$$;
revoke all on function public.record_store_movement(uuid,uuid,text,numeric,text,uuid) from public, anon;
grant execute on function public.record_store_movement(uuid,uuid,text,numeric,text,uuid) to authenticated;

-- Service-only login gate. Increment attempts in its own committed RPC before checking the PIN.
-- Returning null instead of raising ensures failed attempts cannot roll back the counter.
create function public.cashier_login_attempt(p_login_code text) returns public.cashiers
language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; a private.cashier_login_attempts;
begin
  select * into c from public.cashiers where login_code = lower(p_login_code) and is_active;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    return null;
  end if;
  insert into private.cashier_login_attempts(cashier_id) values(c.id) on conflict do nothing;
  select * into a from private.cashier_login_attempts where cashier_id = c.id for update;
  if a.window_started_at <= clock_timestamp() - interval '15 minutes' then
    update private.cashier_login_attempts set attempts = 1, window_started_at = clock_timestamp() where cashier_id = c.id;
  elsif a.attempts >= 5 then
    return null;
  else
    update private.cashier_login_attempts set attempts = attempts + 1 where cashier_id = c.id;
  end if;
  return c;
end;
$$;

create function public.cashier_create_session(p_cashier_id uuid, p_token_hash text) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; expiry timestamptz;
begin
  select * into c from public.cashiers where id = p_cashier_id and is_active for share;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    raise exception 'Кассир недоступен' using errcode = '42501';
  end if;
  insert into private.cashier_sessions(cashier_id, store_id, token_hash)
    values(c.id, c.store_id, p_token_hash) returning expires_at into expiry;
  update private.cashier_login_attempts set attempts = 0 where cashier_id = c.id;
  return expiry;
end;
$$;

create function private.require_cashier_session(p_token_hash text) returns private.cashier_sessions
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
  return s;
end;
$$;
revoke all on function private.require_cashier_session(text) from public, anon, authenticated;
grant execute on function private.require_cashier_session(text) to service_role;

create function public.cashier_logout(p_token_hash text) returns void
language sql security invoker set search_path = '' as $$
  update private.cashier_sessions set revoked_at = clock_timestamp()
  where token_hash = p_token_hash and revoked_at is null;
$$;

create function public.cashier_open_shift(p_token_hash text, p_opening_cash numeric) returns public.cashier_shifts
language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; s public.cashier_shifts;
begin
  session := private.require_cashier_session(p_token_hash);
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash >= 10000000000
    or p_opening_cash::text in ('NaN','Infinity','-Infinity') or p_opening_cash <> round(p_opening_cash,2) then
    raise exception 'Некорректная сумма в кассе' using errcode = '22023';
  end if;
  insert into public.cashier_shifts(store_id,cashier_id,opened_by,opening_cash,opened_session_id)
  values(session.store_id,session.cashier_id,null,p_opening_cash,session.id) returning * into s;
  return s;
end;
$$;

create function public.cashier_close_shift(p_token_hash text, p_shift_id uuid, p_closing_cash numeric) returns public.cashier_shifts
language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; s public.cashier_shifts; revenue numeric;
begin
  session := private.require_cashier_session(p_token_hash);
  select * into s from public.cashier_shifts where id = p_shift_id
    and store_id = session.store_id and cashier_id = session.cashier_id for update;
  if not found then raise exception 'Это смена другого кассира' using errcode = '42501'; end if;
  if s.closed_at is not null then raise exception 'Смена уже закрыта' using errcode = '22023'; end if;
  if p_closing_cash is null or p_closing_cash < 0 or p_closing_cash >= 10000000000
    or p_closing_cash::text in ('NaN','Infinity','-Infinity') or p_closing_cash <> round(p_closing_cash,2) then
    raise exception 'Некорректная сумма в кассе' using errcode = '22023';
  end if;
  select coalesce(sum(round(quantity * price_at_time,2)),0) into revenue
    from public.stock_movements where shift_id = s.id;
  update public.cashier_shifts set closed_at = clock_timestamp(), closing_cash = p_closing_cash,
    expected_cash = opening_cash + revenue where id = s.id returning * into s;
  return s;
end;
$$;

create function public.cashier_record_movement(
  p_token_hash text, p_product_id uuid, p_kind text, p_quantity numeric,
  p_note text default null
) returns public.stock_movements language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; s public.cashier_shifts; p public.products; m public.stock_movements;
begin
  session := private.require_cashier_session(p_token_hash);
  if p_kind is null or p_kind not in ('sale','receipt','writeoff') or p_quantity is null
    or p_quantity <= 0 or p_quantity >= 100000000000 or p_quantity <> round(p_quantity,3)
    or p_quantity::text in ('NaN','Infinity','-Infinity') or char_length(p_note) > 500 then
    raise exception 'Некорректное движение товара' using errcode = '22023';
  end if;
  -- Every cashier movement (including receipt/writeoff) belongs to that cashier's open shift.
  select * into s from public.cashier_shifts where store_id = session.store_id and closed_at is null for update;
  if not found or s.cashier_id <> session.cashier_id then
    raise exception 'Сначала откройте свою смену' using errcode = '42501';
  end if;
  select * into p from public.products where id = p_product_id and store_id = session.store_id and is_active for update;
  if not found then raise exception 'Товар не найден' using errcode = '22023'; end if;
  if p_kind = 'sale' and (p.price is null or p.price < 0) then
    raise exception 'Укажите цену товара' using errcode = '22023';
  end if;
  insert into public.stock_movements(store_id,product_id,movement_type,quantity,direction,price_at_time,
    note,created_by,shift_id,cashier_id,cashier_session_id)
  values(session.store_id,p.id,case when p_kind = 'receipt' then 'приход' else 'расход' end,p_quantity,
    case when p_kind = 'receipt' then 1 else -1 end,case when p_kind = 'sale' then p.price else null end,
    concat(case p_kind when 'sale' then 'Продажа' when 'receipt' then 'Приход' else 'Списание' end,
      case when nullif(btrim(p_note),'') is not null then ': ' || btrim(p_note) else '' end),
    null,s.id,session.cashier_id,session.id) returning * into m;
  return m;
end;
$$;

create function public.cashier_tablet_snapshot(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; result jsonb;
begin
  session := private.require_cashier_session(p_token_hash);
  select jsonb_build_object(
    'store', (select jsonb_build_object('id',id,'name',name) from public.stores where id = session.store_id),
    'cashier', (select jsonb_build_object('id',id,'name',name) from public.cashiers where id = session.cashier_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'stock',stock,'unit',unit,'price',price) order by name)
      from public.products where store_id = session.store_id and is_active), '[]'::jsonb),
    'shift', (select jsonb_build_object('id',s.id,'cashier_id',s.cashier_id,'cashier_name',c.name,
      'opened_at',s.opened_at,'opening_cash',s.opening_cash,'revenue',
      (select coalesce(sum(round(quantity * price_at_time,2)),0) from public.stock_movements where shift_id = s.id))
      from public.cashier_shifts s join public.cashiers c on c.id = s.cashier_id
      where s.store_id = session.store_id and s.closed_at is null),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (
      select id,product_id,quantity,direction,note,created_at,price_at_time from public.stock_movements
      where cashier_id = session.cashier_id order by created_at desc limit 30
    ) m), '[]'::jsonb),
    'expires_at', session.expires_at
  ) into result;
  return result;
end;
$$;

-- These are internal RPCs: only cashier-terminal may call them after checking PIN/session.
revoke all on function public.cashier_login_attempt(text) from public,anon,authenticated;
revoke all on function public.cashier_create_session(uuid,text) from public,anon,authenticated;
revoke all on function public.cashier_logout(text) from public,anon,authenticated;
revoke all on function public.cashier_open_shift(text,numeric) from public,anon,authenticated;
revoke all on function public.cashier_close_shift(text,uuid,numeric) from public,anon,authenticated;
revoke all on function public.cashier_record_movement(text,uuid,text,numeric,text) from public,anon,authenticated;
revoke all on function public.cashier_tablet_snapshot(text) from public,anon,authenticated;
grant execute on function public.cashier_login_attempt(text) to service_role;
grant execute on function public.cashier_create_session(uuid,text) to service_role;
grant execute on function public.cashier_logout(text) to service_role;
grant execute on function public.cashier_open_shift(text,numeric) to service_role;
grant execute on function public.cashier_close_shift(text,uuid,numeric) to service_role;
grant execute on function public.cashier_record_movement(text,uuid,text,numeric,text) to service_role;
grant execute on function public.cashier_tablet_snapshot(text) to service_role;
