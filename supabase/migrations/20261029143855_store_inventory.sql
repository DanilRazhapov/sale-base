-- Inventory writes go through transactional RPCs; reads remain protected by RLS.
create table public.cashier_shifts (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  cashier_id uuid not null references public.cashiers(id),
  opened_by uuid not null references public.profiles(id),
  opened_at timestamptz not null default now(),
  opening_cash numeric(12,2) not null check (opening_cash >= 0),
  closed_at timestamptz,
  closing_cash numeric(12,2) check (closing_cash >= 0),
  expected_cash numeric(12,2),
  check ((closed_at is null and closing_cash is null) or (closed_at is not null and closing_cash is not null))
);
create unique index one_open_shift_per_store on public.cashier_shifts(store_id) where closed_at is null;
alter table public.cashier_shifts enable row level security;
grant select on public.cashier_shifts to authenticated;
create policy "Owners view shifts" on public.cashier_shifts for select to authenticated
  using (public.is_store_owner(store_id));

alter table public.stock_movements add column shift_id uuid references public.cashier_shifts(id);
create index stock_movements_store_time_idx on public.stock_movements(store_id, created_at desc);
create index stock_movements_shift_idx on public.stock_movements(shift_id);
create index products_store_idx on public.products(store_id);
create index categories_store_idx on public.categories(store_id);

create policy "Owners view store cashiers" on public.cashiers for select to authenticated
  using (public.is_store_owner(store_id));
create policy "Owners create categories" on public.categories for insert to authenticated
  with check (public.is_store_owner(store_id) and char_length(btrim(name)) between 1 and 120);

create function public.touch_product_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := greatest(clock_timestamp(), old.updated_at + interval '1 microsecond');
  return new;
end;
$$;
create trigger touch_product_updated_at before update on public.products
for each row execute function public.touch_product_updated_at();

-- The existing AFTER INSERT movement trigger calls this function.
-- Locking the product serializes concurrent sales and prevents negative stock.
create or replace function public.update_product_stock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id for update;
  if not found or p.store_id is distinct from new.store_id then
    raise exception 'Product does not belong to store' using errcode = '22023';
  end if;
  if coalesce(p.stock, 0) + new.quantity * new.direction < 0 then
    raise exception 'Недостаточно товара на складе' using errcode = '22023';
  end if;
  update public.products set stock = coalesce(stock, 0) + new.quantity * new.direction
  where id = new.product_id;
  return new;
end;
$$;

revoke insert, update, delete on public.products from anon, authenticated;
revoke insert, update, delete on public.stock_movements from anon, authenticated;

create function public.save_store_product(
  p_store_id uuid, p_name text, p_category_id integer, p_unit text,
  p_price numeric, p_stock numeric, p_product_id uuid default null,
  p_updated_at timestamptz default null
) returns public.products
language plpgsql security definer set search_path = '' as $$
declare p public.products; delta numeric;
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then
    raise exception 'Нет доступа к магазину' using errcode = '42501';
  end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_unit is null or char_length(btrim(p_unit)) not between 1 and 20
    or p_price is null or p_price < 0 or p_price >= 10000000000
    or p_stock is null or p_stock < 0 or p_stock >= 100000000000
    or p_price::text in ('NaN', 'Infinity', '-Infinity')
    or p_stock::text in ('NaN', 'Infinity', '-Infinity')
    or p_price <> round(p_price, 2) or p_stock <> round(p_stock, 3) then
    raise exception 'Проверьте название, единицу, цену и остаток' using errcode = '22023';
  end if;
  if p_category_id is not null and not exists (
    select 1 from public.categories where id = p_category_id and store_id = p_store_id
  ) then
    raise exception 'Категория из другого магазина' using errcode = '22023';
  end if;
  if p_product_id is null then
    insert into public.products(store_id, name, category_id, unit, price, stock)
    values(p_store_id, btrim(p_name), p_category_id, btrim(p_unit), p_price, 0) returning * into p;
  else
    select * into p from public.products where id = p_product_id and store_id = p_store_id for update;
    if not found then raise exception 'Товар не найден' using errcode = '22023'; end if;
    if p_updated_at is null or p.updated_at is distinct from p_updated_at then
      raise exception 'Товар уже изменён. Обновите список и повторите редактирование' using errcode = '40001';
    end if;
    update public.products set name = btrim(p_name), category_id = p_category_id,
      unit = btrim(p_unit), price = p_price where id = p.id;
  end if;
  delta := p_stock - coalesce(p.stock, 0);
  if delta <> 0 then
    insert into public.stock_movements(store_id, product_id, movement_type, quantity, direction, created_by, note)
    values(p_store_id, p.id, 'корректировка', abs(delta), case when delta > 0 then 1 else -1 end,
      auth.uid(), case when p_product_id is null then 'Начальный остаток' else 'Изменение остатка владельцем' end);
  end if;
  select * into p from public.products where id = p.id;
  return p;
end;
$$;

create function public.open_store_shift(p_store_id uuid, p_cashier_id uuid, p_opening_cash numeric)
returns public.cashier_shifts language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts;
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then
    raise exception 'Нет доступа к магазину' using errcode = '42501';
  end if;
  if p_opening_cash is null or p_opening_cash < 0 or p_opening_cash >= 10000000000
    or p_opening_cash::text in ('NaN', 'Infinity', '-Infinity') or p_opening_cash <> round(p_opening_cash, 2) then
    raise exception 'Некорректная сумма в кассе' using errcode = '22023';
  end if;
  perform 1 from public.cashiers where id = p_cashier_id and store_id = p_store_id and is_active for share;
  if not found then raise exception 'Активный кассир не найден' using errcode = '22023'; end if;
  insert into public.cashier_shifts(store_id, cashier_id, opened_by, opening_cash)
  values(p_store_id, p_cashier_id, auth.uid(), p_opening_cash) returning * into s;
  return s;
end;
$$;

create function public.close_store_shift(p_shift_id uuid, p_closing_cash numeric)
returns public.cashier_shifts language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; revenue numeric;
begin
  select * into s from public.cashier_shifts where id = p_shift_id for update;
  if not found or auth.uid() is null or not public.is_store_owner(s.store_id) then
    raise exception 'Нет доступа к смене' using errcode = '42501';
  end if;
  if s.closed_at is not null then raise exception 'Смена уже закрыта' using errcode = '22023'; end if;
  if p_closing_cash is null or p_closing_cash < 0 or p_closing_cash >= 10000000000
    or p_closing_cash::text in ('NaN', 'Infinity', '-Infinity') or p_closing_cash <> round(p_closing_cash, 2) then
    raise exception 'Некорректная сумма в кассе' using errcode = '22023';
  end if;
  select coalesce(sum(round(quantity * price_at_time, 2)), 0) into revenue
  from public.stock_movements where shift_id = s.id;
  update public.cashier_shifts set closed_at = clock_timestamp(), closing_cash = p_closing_cash,
    expected_cash = s.opening_cash + revenue where id = s.id returning * into s;
  return s;
end;
$$;

-- Calculate currency with Postgres numeric arithmetic, matching shift closure exactly.
create function public.store_shift_revenue(p_shift_id uuid) returns numeric
language sql stable security invoker set search_path = '' as $$
  select coalesce(sum(round(m.quantity * m.price_at_time, 2)), 0)
  from public.stock_movements m
  join public.cashier_shifts s on s.id = m.shift_id
  where s.id = p_shift_id;
$$;
revoke all on function public.store_shift_revenue(uuid) from public, anon;
grant execute on function public.store_shift_revenue(uuid) to authenticated;

create function public.record_store_movement(
  p_store_id uuid, p_product_id uuid, p_kind text, p_quantity numeric,
  p_note text default null, p_shift_id uuid default null
) returns public.stock_movements language plpgsql security definer set search_path = '' as $$
declare p public.products; m public.stock_movements; s public.cashier_shifts;
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then
    raise exception 'Нет доступа к магазину' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('sale', 'receipt', 'writeoff') or p_quantity is null
    or p_quantity <= 0 or p_quantity >= 100000000000 or p_quantity <> round(p_quantity, 3)
    or p_quantity::text in ('NaN', 'Infinity', '-Infinity') or char_length(p_note) > 500 then
    raise exception 'Некорректное движение товара' using errcode = '22023';
  end if;
  -- Same lock order as close_store_shift: shift first, then product.
  if p_kind = 'sale' then
    select * into s from public.cashier_shifts where id = p_shift_id and store_id = p_store_id for update;
    if not found or s.closed_at is not null then
      raise exception 'Для продажи откройте смену' using errcode = '22023';
    end if;
  end if;
  select * into p from public.products where id = p_product_id and store_id = p_store_id and is_active for update;
  if not found then raise exception 'Товар не найден' using errcode = '22023'; end if;
  if p_kind = 'sale' and (p.price is null or p.price < 0) then
    raise exception 'Укажите цену товара' using errcode = '22023';
  end if;
  insert into public.stock_movements(store_id, product_id, movement_type, quantity, direction,
    price_at_time, note, created_by, shift_id)
  values(p_store_id, p_product_id, case when p_kind = 'receipt' then 'приход' else 'расход' end,
    p_quantity, case when p_kind = 'receipt' then 1 else -1 end,
    case when p_kind = 'sale' then p.price else null end,
    concat(case p_kind when 'sale' then 'Продажа' when 'receipt' then 'Приход' else 'Списание' end,
      case when nullif(btrim(p_note), '') is not null then ': ' || btrim(p_note) else '' end),
    auth.uid(), case when p_kind = 'sale' then s.id else null end) returning * into m;
  return m;
end;
$$;

revoke all on function public.save_store_product(uuid,text,integer,text,numeric,numeric,uuid,timestamptz) from public, anon;
revoke all on function public.open_store_shift(uuid,uuid,numeric) from public, anon;
revoke all on function public.close_store_shift(uuid,numeric) from public, anon;
revoke all on function public.record_store_movement(uuid,uuid,text,numeric,text,uuid) from public, anon;
grant execute on function public.save_store_product(uuid,text,integer,text,numeric,numeric,uuid,timestamptz) to authenticated;
grant execute on function public.open_store_shift(uuid,uuid,numeric) to authenticated;
grant execute on function public.close_store_shift(uuid,numeric) to authenticated;
grant execute on function public.record_store_movement(uuid,uuid,text,numeric,text,uuid) to authenticated;
