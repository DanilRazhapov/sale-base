alter table public.cashier_shifts add column offline_deadline_at timestamptz;

-- Every opener shares the same lock and the existing unique open-shift index.
create function private.lock_cashier_shift_opening()
  returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('cashier-shift:' || new.store_id::text, 0));
  return new;
end;
$$;

revoke all on function private.lock_cashier_shift_opening() from public, anon, authenticated;
create trigger lock_cashier_shift_opening before insert on public.cashier_shifts
  for each row execute function private.lock_cashier_shift_opening();

create function public.cashier_sync_shift_open(
  p_token_hash text, p_shift_id uuid, p_opened_at timestamptz, p_opening_cash numeric,
  p_offline boolean, p_closing_at timestamptz, p_closing_cash numeric
)
  returns public.cashier_shifts language plpgsql security invoker set search_path = '' as $$
declare
  session private.cashier_sessions;
  s public.cashier_shifts;
  deadline timestamptz := p_opened_at + case when p_offline then interval '14 hours' else interval '12 hours' end;
  imported_close timestamptz;
begin
  session := private.require_cashier_session(p_token_hash);
  if p_shift_id is null or p_offline is null or p_opened_at is null or not isfinite(p_opened_at)
    or p_opened_at > clock_timestamp() + interval '1 minute'
    or p_opening_cash is null or not (p_opening_cash >= 0 and p_opening_cash < 10000000000)
    or p_opening_cash <> round(p_opening_cash, 2)
    or (p_closing_at is null and p_closing_cash is not null)
    or (p_closing_at is not null and (
      p_closing_at < p_opened_at or p_closing_at > deadline or p_closing_at > clock_timestamp() + interval '1 minute'
      or (p_closing_cash is null and p_closing_at <> deadline)
      or (p_closing_cash is not null and (
        p_closing_at = deadline or not (p_closing_cash >= 0 and p_closing_cash < 10000000000)
        or p_closing_cash <> round(p_closing_cash, 2)
      ))
    )) then
    raise exception 'Некорректные данные открытия смены.' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('cashier-shift:' || session.store_id::text, 0));
  select * into s from public.cashier_shifts where id = p_shift_id;
  if found then
    if s.store_id <> session.store_id or s.cashier_id <> session.cashier_id
      or s.opened_at <> p_opened_at or s.opening_cash <> p_opening_cash
      or s.offline_deadline_at is distinct from (case when p_offline then deadline end) then
      raise exception 'Идентификатор уже относится к другой смене.' using errcode = 'PT409';
    end if;
    return s;
  end if;

  if exists (
    select 1 from public.cashier_shifts other
    where other.store_id = session.store_id
      and tstzrange(other.opened_at, case when other.closed_at is not null
        then greatest(other.opened_at, other.closed_at) end) && tstzrange(p_opened_at, coalesce(p_closing_at, deadline))
  ) then
    raise exception 'Время смены пересекается со сменой другой кассы.' using errcode = 'PT409';
  end if;

  -- An already elapsed shift, or one finished before a newer open shift, is
  -- imported as history. Receipts replay into its exact interval below.
  if deadline <= clock_timestamp() then
    imported_close := coalesce(p_closing_at, deadline);
  elsif p_closing_at is not null and exists (
    select 1 from public.cashier_shifts
      where store_id = session.store_id and closed_at is null
  ) then
    imported_close := p_closing_at;
  end if;

  insert into public.cashier_shifts (
    id, store_id, cashier_id, opened_session_id, opened_at, opening_cash, offline_deadline_at,
    closed_at, closing_cash, expected_cash, automatically_closed
  ) values (
    p_shift_id, session.store_id, session.cashier_id, session.id, p_opened_at, p_opening_cash,
    case when p_offline then deadline end,
    imported_close, case when imported_close is not null then p_closing_cash end,
    case when imported_close is not null then p_opening_cash end,
    imported_close is not null and p_closing_cash is null
  ) returning * into s;
  return s;
end;
$$;

-- Callers hold the shift lock before totaling its movements.
create function private.finish_cashier_shift(p_id uuid, p_closed_at timestamptz, p_cash numeric)
  returns public.cashier_shifts language sql security invoker set search_path = '' as $$
  update public.cashier_shifts set closed_at = p_closed_at, closing_cash = p_cash,
    automatically_closed = p_cash is null,
    expected_cash = opening_cash + coalesce((
      select sum(round(quantity * price_at_time, 2)) from public.stock_movements where shift_id = p_id
    ), 0)
  where id = p_id returning *;
$$;

revoke all on function private.finish_cashier_shift(uuid, timestamptz, numeric) from public, anon, authenticated;
grant execute on function private.finish_cashier_shift(uuid, timestamptz, numeric) to service_role;

create function public.cashier_sync_shift_close(
  p_token_hash text, p_shift_id uuid, p_closed_at timestamptz, p_closing_cash numeric
)
  returns public.cashier_shifts language plpgsql security invoker set search_path = '' as $$
declare
  session private.cashier_sessions;
  s public.cashier_shifts;
  deadline timestamptz;
begin
  session := private.require_cashier_session(p_token_hash);
  select * into s from public.cashier_shifts where id = p_shift_id
    and store_id = session.store_id and cashier_id = session.cashier_id for update;
  if not found then
    raise exception 'Это смена другого кассира или магазина.' using errcode = '42501';
  end if;
  deadline := coalesce(s.offline_deadline_at, s.opened_at + interval '12 hours');
  if p_closed_at is null or p_closed_at < s.opened_at or p_closed_at > deadline
    or p_closed_at > clock_timestamp() + interval '1 minute'
    or (p_closing_cash is null and p_closed_at <> deadline)
    or (p_closing_cash is not null and (
      p_closed_at = deadline or not (p_closing_cash >= 0 and p_closing_cash < 10000000000)
      or p_closing_cash <> round(p_closing_cash, 2)
    )) then
    raise exception 'Некорректные данные закрытия смены.' using errcode = '22023';
  end if;
  if s.closed_at is not null and (p_closing_cash is null
    or (s.closed_at = p_closed_at and s.closing_cash is not distinct from p_closing_cash)) then
    return s;
  end if;
  if s.closed_at is not null and not (s.automatically_closed and s.closed_at = deadline) then
    raise exception 'Смена уже закрыта с другими данными.' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.cashier_receipts where shift_id = s.id and created_at > p_closed_at) then
    raise exception 'После указанного закрытия в смене есть проведённые операции.' using errcode = 'PT409';
  end if;

  return private.finish_cashier_shift(s.id, p_closed_at, p_closing_cash);
end;
$$;

revoke all on function public.cashier_sync_shift_open(text, uuid, timestamptz, numeric, boolean, timestamptz, numeric),
  public.cashier_sync_shift_close(text, uuid, timestamptz, numeric) from public, anon, authenticated;
grant execute on function public.cashier_sync_shift_open(text, uuid, timestamptz, numeric, boolean, timestamptz, numeric),
  public.cashier_sync_shift_close(text, uuid, timestamptz, numeric) to service_role;

create or replace function private.close_expired_cashier_shifts(p_store_id uuid default null)
  returns void language plpgsql security invoker set search_path = '' as $$
declare
  s public.cashier_shifts;
begin
  for s in select * from public.cashier_shifts
    where closed_at is null and coalesce(offline_deadline_at, opened_at + interval '12 hours') <= clock_timestamp()
      and (p_store_id is null or store_id = p_store_id)
    order by id for update
  loop
    perform private.finish_cashier_shift(s.id, coalesce(s.offline_deadline_at, s.opened_at + interval '12 hours'), null);
  end loop;
end;
$$;

create or replace function private.revoke_blocked_cashier_sessions()
  returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.cashier_shifts;
begin
  if new.is_active is distinct from true then
    update private.cashier_sessions set revoked_at = clock_timestamp()
      where cashier_id = new.id and revoked_at is null;
    for s in select * from public.cashier_shifts
      where cashier_id = new.id and closed_at is null order by id for update
    loop
      perform private.finish_cashier_shift(
        s.id, least(clock_timestamp(), coalesce(s.offline_deadline_at, s.opened_at + interval '12 hours')), null
      );
    end loop;
  end if;
  return new;
end;
$$;

create or replace function private.check_cashier_movement_shift()
  returns trigger language plpgsql security definer set search_path = '' as $$
declare
  s public.cashier_shifts;
  deadline timestamptz;
begin
  if new.cashier_id is null then return new; end if;
  select * into s from public.cashier_shifts where id = new.shift_id for update;
  if not found or s.cashier_id <> new.cashier_id or s.store_id <> new.store_id then
    raise exception 'Операция относится к другой смене.' using errcode = '22023';
  end if;
  deadline := coalesce(s.offline_deadline_at, s.opened_at + interval '12 hours');
  if new.receipt_id is not null then
    if new.created_at >= s.opened_at and new.created_at < deadline
      and (s.closed_at is null or new.created_at <= s.closed_at)
      and exists (select 1 from public.cashier_receipts r where r.id = new.receipt_id
        and r.shift_id = s.id and r.cashier_session_id = new.cashier_session_id and r.created_at = new.created_at)
    then return new;
    end if;
  elsif s.closed_at is null and deadline > clock_timestamp() then
    return new;
  end if;
  raise exception 'Смена завершена. Проверьте время операции.' using errcode = '22023';
end;
$$;

-- Existing online checkout and offline replay use the same stock and price checks.
create function private.commit_cashier_checkout(
  p_token_hash text,
  p_request_id uuid,
  p_items jsonb,
  p_kind text,
  p_shift_id uuid,
  p_recorded_at timestamptz
)
  returns public.cashier_receipts language plpgsql security invoker set search_path = '' as $$
declare
  session private.cashier_sessions;
  shift public.cashier_shifts;
  receipt public.cashier_receipts;
  item jsonb;
  product public.products;
  quantity numeric;
  expected_price numeric;
  total numeric := 0;
  shift_revenue numeric;
begin
  session := private.require_cashier_session(p_token_hash);

  if p_request_id is null
    or p_kind is null
    or p_kind not in ('sale', 'receipt', 'writeoff')
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    raise exception 'Некорректная корзина' using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'В корзине должно быть от 1 до 100 товаров'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));

  select * into receipt
  from public.cashier_receipts
  where id = p_request_id;

  if found then
    if receipt.cashier_id <> session.cashier_id
      or receipt.store_id <> session.store_id
      or receipt.kind <> p_kind
      or receipt.request_items <> p_items
      or (p_shift_id is not null and receipt.shift_id <> p_shift_id)
    then
      raise exception 'Запрос уже использован для другой корзины'
        using errcode = '22023';
    end if;

    return receipt;
  end if;

  select * into shift
  from public.cashier_shifts
  where store_id = session.store_id
    and ((p_shift_id is null and closed_at is null) or id = p_shift_id)
  for update;

  if not found or shift.cashier_id <> session.cashier_id then
    if p_shift_id is null then
      raise exception 'Сначала откройте свою смену' using errcode = '42501';
    end if;
    raise exception 'Чек относится к другой смене.' using errcode = 'PT409';
  end if;
  if p_recorded_at is not null and (
    p_recorded_at < shift.opened_at
    or p_recorded_at >= coalesce(shift.offline_deadline_at, shift.opened_at + interval '12 hours')
    or p_recorded_at > clock_timestamp() + interval '1 minute'
    or (shift.closed_at is not null and p_recorded_at > shift.closed_at)
  ) then
    raise exception 'Время операции вне срока смены.' using errcode = 'PT409';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) entry
    where jsonb_typeof(entry) <> 'object'
      or jsonb_typeof(entry -> 'product_id') is distinct from 'string'
      or jsonb_typeof(entry -> 'quantity') is distinct from 'number'
  ) then
    raise exception 'Некорректные позиции корзины' using errcode = '22023';
  end if;

  if (
    select count(distinct (entry ->> 'product_id')::uuid)
    from jsonb_array_elements(p_items) entry
  ) <> jsonb_array_length(p_items) then
    raise exception 'Объедините повторяющиеся товары' using errcode = '22023';
  end if;

  for item in
    select entry
    from jsonb_array_elements(p_items) entry
    order by (entry ->> 'product_id')::uuid
  loop
    quantity := (item ->> 'quantity')::numeric;

    if quantity <= 0 or quantity >= 100000000000 or quantity <> round(quantity, 3) then
      raise exception 'Количество должно быть больше нуля, до трёх знаков после запятой'
        using errcode = '22023';
    end if;

    select * into product
    from public.products
    where id = (item ->> 'product_id')::uuid
      and store_id = session.store_id
      and is_active
    for update;

    if not found then
      raise exception 'Товар недоступен. Обновите каталог.' using errcode = '22023';
    end if;

    if p_kind <> 'receipt' and coalesce(product.stock, 0) < quantity then
      raise exception 'Недостаточно товара: %', product.name
        using errcode = '22023';
    end if;

    if p_kind = 'receipt' and coalesce(product.stock, 0) + quantity >= 100000000000 then
      raise exception 'Превышен максимальный остаток товара: %', product.name
        using errcode = '22023';
    end if;

    if p_kind = 'sale' then
      if jsonb_typeof(item -> 'expected_price') is distinct from 'number' then
        raise exception 'Укажите цену товара: %', product.name using errcode = '22023';
      end if;

      expected_price := (item ->> 'expected_price')::numeric;
      if expected_price < 0 then
        raise exception 'Некорректная цена товара: %', product.name using errcode = '22023';
      end if;

      if product.price is distinct from expected_price and not exists (
        select 1 from private.product_price_versions version
        where version.id = case
          when (item ->> 'price_version_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$'
          then (item ->> 'price_version_id')::uuid end
          and version.product_id = product.id and version.store_id = session.store_id
          and version.price = expected_price and version.replaced_at >= shift.opened_at
      ) then
        raise exception 'Цена товара изменилась, прежняя цена не подтверждена: %.', product.name using errcode = '22023';
      end if;

      total := total + round(expected_price * quantity, 2);
    end if;
  end loop;

  if p_kind = 'sale' then
    select coalesce(sum(round(m.quantity * m.price_at_time, 2)), 0) into shift_revenue
    from public.stock_movements m
    where m.shift_id = shift.id;

    if shift.opening_cash + shift_revenue + total >= 10000000000 then
      raise exception 'Превышена максимальная сумма кассы' using errcode = '22023';
    end if;
  end if;

  insert into public.cashier_receipts (
    id, store_id, cashier_id, cashier_session_id, shift_id, kind, total, request_items, created_at
  ) values (
    p_request_id, session.store_id, session.cashier_id, session.id, shift.id, p_kind, total, p_items,
    coalesce(p_recorded_at, clock_timestamp())
  ) returning * into receipt;

  insert into public.stock_movements (
    store_id, product_id, movement_type, quantity, direction, price_at_time, note,
    shift_id, cashier_id, cashier_session_id, sold_at_previous_price, catalog_price_at_sync,
    receipt_id, created_at
  )
  select session.store_id, catalog_product.id, case when p_kind = 'receipt' then 'приход' else 'расход' end,
    line.quantity, case when p_kind = 'receipt' then 1 else -1 end,
    price.sale_price,
    case p_kind when 'sale' then 'Продажа' when 'receipt' then 'Приход' else 'Списание' end,
    shift.id, session.cashier_id, session.id,
    p_kind = 'sale' and price.sale_price is distinct from catalog_product.price,
    case when p_kind = 'sale' and price.sale_price is distinct from catalog_product.price then catalog_product.price end,
    receipt.id, receipt.created_at
  from jsonb_to_recordset(p_items) line(product_id uuid, quantity numeric, expected_price jsonb)
  join public.products catalog_product on catalog_product.id = line.product_id
  cross join lateral (select case when p_kind = 'sale' then line.expected_price::numeric end as sale_price) price
  order by catalog_product.id;

  if shift.closed_at is not null and p_kind = 'sale' then
    update public.cashier_shifts set expected_cash = shift.opening_cash + shift_revenue + total
      where id = shift.id;
  end if;
  return receipt;
end;
$$;

create or replace function public.cashier_checkout(
  p_token_hash text, p_request_id uuid, p_items jsonb, p_kind text default 'sale'
)
  returns public.cashier_receipts language sql security invoker set search_path = '' as $$
  select private.commit_cashier_checkout(p_token_hash, p_request_id, p_items, p_kind, null, null);
$$;

create function public.cashier_sync_checkout(
  p_token_hash text, p_request_id uuid, p_items jsonb, p_kind text, p_shift_id uuid, p_recorded_at timestamptz
)
  returns public.cashier_receipts language plpgsql security invoker set search_path = '' as $$
begin
  if p_shift_id is null or p_recorded_at is null or not isfinite(p_recorded_at) then
    raise exception 'Укажите смену и время операции.' using errcode = '22023';
  end if;
  return private.commit_cashier_checkout(p_token_hash, p_request_id, p_items, p_kind, p_shift_id, p_recorded_at);
end;
$$;

revoke all on function private.commit_cashier_checkout(text, uuid, jsonb, text, uuid, timestamptz),
  public.cashier_sync_checkout(text, uuid, jsonb, text, uuid, timestamptz) from public, anon, authenticated;
grant execute on function private.commit_cashier_checkout(text, uuid, jsonb, text, uuid, timestamptz),
  public.cashier_sync_checkout(text, uuid, jsonb, text, uuid, timestamptz) to service_role;

-- Reuse the existing snapshot and add only the shift's effective deadline.
alter function public.cashier_tablet_snapshot(text) set schema private;

create function public.cashier_tablet_snapshot(p_token_hash text)
  returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  snapshot jsonb := private.cashier_tablet_snapshot(p_token_hash);
  deadline timestamptz;
begin
  select coalesce(offline_deadline_at, opened_at + interval '12 hours') into deadline
    from public.cashier_shifts where id = (snapshot #>> '{shift,id}')::uuid;
  if deadline is not null then
    return jsonb_set(snapshot, '{shift,deadline_at}', to_jsonb(deadline));
  end if;
  return snapshot;
end;
$$;

revoke all on function public.cashier_tablet_snapshot(text) from public, anon, authenticated;
grant execute on function public.cashier_tablet_snapshot(text) to service_role;
