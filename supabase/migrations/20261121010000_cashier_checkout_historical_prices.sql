alter table public.stock_movements
  add column sold_at_previous_price boolean not null default false,
  add column catalog_price_at_sync numeric(12, 2);

create table private.product_price_versions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  store_id uuid not null references public.stores(id),
  price numeric(12, 2) not null,
  replaced_at timestamptz
);

create unique index product_current_price_version
  on private.product_price_versions(product_id)
  where replaced_at is null;

revoke all on private.product_price_versions from public, anon, authenticated;
grant select on private.product_price_versions to service_role;

insert into private.product_price_versions (product_id, store_id, price)
select id, store_id, price
from public.products
where price is not null;

create function private.version_product_price()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if tg_op = 'UPDATE' then
    if new.price is not distinct from old.price and new.store_id = old.store_id then
      return new;
    end if;

    update private.product_price_versions
    set replaced_at = clock_timestamp()
    where product_id = new.id and replaced_at is null;
  end if;

  if new.price is not null then
    insert into private.product_price_versions (product_id, store_id, price)
    values (new.id, new.store_id, new.price);
  end if;

  return new;
end;
$$;

revoke all on function private.version_product_price() from public, anon, authenticated;

create trigger version_product_price
  after insert or update of price, store_id on public.products
  for each row
  execute function private.version_product_price();

create function private.cashier_record_movement(
  p_token_hash text,
  p_product_id uuid,
  p_kind text,
  p_quantity numeric,
  p_note text,
  p_sale_price numeric
)
  returns public.stock_movements
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  session private.cashier_sessions;
  s public.cashier_shifts;
  p public.products;
  m public.stock_movements;
  sale_price numeric;
begin
  session := private.require_cashier_session(p_token_hash);
  if p_kind is null or p_kind not in ('sale','receipt','writeoff') or p_quantity is null
    or p_quantity <= 0 or p_quantity >= 100000000000 or p_quantity <> round(p_quantity,3)
    or p_quantity::text in ('NaN','Infinity','-Infinity') or char_length(p_note) > 500 then
    raise exception 'Некорректное движение товара' using errcode = '22023';
  end if;
  -- Every cashier movement (including receipt/writeoff) belongs to that cashier's open shift.
  select * into s
  from public.cashier_shifts
  where store_id = session.store_id and closed_at is null for update;
  if not found or s.cashier_id <> session.cashier_id then
    raise exception 'Сначала откройте свою смену' using errcode = '42501';
  end if;
  select * into p
  from public.products
  where id = p_product_id and store_id = session.store_id and is_active for update;
  if not found then
    raise exception 'Товар не найден' using errcode = '22023';
  end if;
  sale_price := coalesce(p_sale_price, p.price);
  if p_kind = 'sale' and (sale_price is null or sale_price < 0) then
    raise exception 'Укажите цену товара' using errcode = '22023';
  end if;
  insert into public.stock_movements (
    store_id, product_id, movement_type, quantity, direction, price_at_time,
    note, created_by, shift_id, cashier_id, cashier_session_id,
    sold_at_previous_price, catalog_price_at_sync
  ) values (
    session.store_id,
    p.id,
    case when p_kind = 'receipt' then 'приход' else 'расход' end,
    p_quantity,
    case when p_kind = 'receipt' then 1 else -1 end,
    case when p_kind = 'sale' then sale_price end,
    concat(
      case p_kind when 'sale' then 'Продажа' when 'receipt' then 'Приход' else 'Списание' end,
      case when nullif(btrim(p_note), '') is not null then ': ' || btrim(p_note) else '' end
    ),
    null,
    s.id,
    session.cashier_id,
    session.id,
    p_kind = 'sale' and (sale_price is distinct from p.price),
    case when p_kind = 'sale' and (sale_price is distinct from p.price) then p.price end
  ) returning * into m;
  return m;
end;
$$;

revoke all on function private.cashier_record_movement(text, uuid, text, numeric, text, numeric)
  from public, anon, authenticated;
grant execute on function private.cashier_record_movement(text, uuid, text, numeric, text, numeric)
  to service_role;

create or replace function public.cashier_record_movement(
  p_token_hash text,
  p_product_id uuid,
  p_kind text,
  p_quantity numeric,
  p_note text default null
)
  returns public.stock_movements
  language sql
  security invoker
  set search_path = ''
  as $$
  select private.cashier_record_movement(p_token_hash, p_product_id, p_kind, p_quantity, p_note, null);
$$;

create or replace function public.cashier_checkout(
  p_token_hash text,
  p_request_id uuid,
  p_items jsonb,
  p_kind text default 'sale'
)
  returns public.cashier_receipts
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  session private.cashier_sessions;
  shift public.cashier_shifts;
  receipt public.cashier_receipts;
  item jsonb;
  product public.products;
  movement public.stock_movements;
  quantity numeric;
  expected_price numeric;
  price_version_id uuid;
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
    then
      raise exception 'Запрос уже использован для другой корзины'
        using errcode = '22023';
    end if;

    return receipt;
  end if;

  select * into shift
  from public.cashier_shifts
  where store_id = session.store_id
    and closed_at is null
  for update;

  if not found or shift.cashier_id <> session.cashier_id then
    raise exception 'Сначала откройте свою смену' using errcode = '42501';
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

      if product.price is distinct from expected_price then
        price_version_id := null;
        if (item ->> 'price_version_id') ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
          price_version_id := (item ->> 'price_version_id')::uuid;
        end if;

        -- A queued sale may use a catalog price that was valid during this shift.
        if not exists (
          select 1
          from private.product_price_versions version
          where version.id = price_version_id
            and version.product_id = product.id
            and version.store_id = session.store_id
            and version.price = expected_price
            and version.replaced_at >= shift.opened_at
        ) then
          raise exception 'Цена товара изменилась, прежняя цена не подтверждена: %.', product.name
            using errcode = '22023';
        end if;
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
    id, store_id, cashier_id, cashier_session_id, shift_id, kind, total, request_items
  ) values (
    p_request_id, session.store_id, session.cashier_id, session.id, shift.id, p_kind, total, p_items
  ) returning * into receipt;

  for item in
    select entry
    from jsonb_array_elements(p_items) entry
    order by (entry ->> 'product_id')::uuid
  loop
    movement := private.cashier_record_movement(
      p_token_hash,
      (item ->> 'product_id')::uuid,
      p_kind,
      (item ->> 'quantity')::numeric,
      null,
      case when p_kind = 'sale' then (item ->> 'expected_price')::numeric end
    );

    update public.stock_movements
    set receipt_id = receipt.id
    where id = movement.id;
  end loop;

  return receipt;
end;
$$;

create or replace function public.cashier_tablet_snapshot(p_token_hash text)
  returns jsonb
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  session private.cashier_sessions;
  result jsonb;
begin
  session := private.require_cashier_session(p_token_hash);

  select jsonb_build_object(
    'store', (
      select jsonb_build_object('id', id, 'name', name)
      from public.stores
      where id = session.store_id
    ),

    'cashier', (
      select jsonb_build_object('id', id, 'name', name)
      from public.cashiers
      where id = session.cashier_id
    ),

    'products', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', product.id,
            'name', product.name,
            'stock', product.stock,
            'unit', product.unit,
            'price', product.price,
            'category_id', product.category_id,
            'image_key', product.image_key,
            'price_version_id', version.id
          ) order by product.name
        )
        from public.products product
        left join private.product_price_versions version on version.product_id = product.id
          and version.store_id = product.store_id
          and version.replaced_at is null
        where product.store_id = session.store_id and product.is_active
      ),
      '[]'::jsonb
    ),

    'categories', coalesce(
      (
        select jsonb_agg(
          jsonb_build_object('id', id, 'name', name) order by sort_order, name
        )
        from public.categories
        where store_id = session.store_id
      ),
      '[]'::jsonb
    ),

    'shift', (
      select jsonb_build_object(
        'id', s.id,
        'cashier_id', s.cashier_id,
        'cashier_name', c.name,
        'opened_at', s.opened_at,
        'opening_cash', s.opening_cash,
        'revenue', (
          select coalesce(sum(round(quantity * price_at_time, 2)), 0)
          from public.stock_movements
          where shift_id = s.id
        )
      )
      from public.cashier_shifts s
      join public.cashiers c on c.id = s.cashier_id
      where s.store_id = session.store_id and s.closed_at is null
    ),

    'movements', coalesce(
      (
        select jsonb_agg(to_jsonb(m) order by m.created_at desc)
        from (
          select
            id,
            product_id,
            quantity,
            direction,
            note,
            created_at,
            price_at_time,
            sold_at_previous_price,
            catalog_price_at_sync,
            receipt_id
          from public.stock_movements
          where cashier_id = session.cashier_id
          order by created_at desc
          limit 30
        ) m
      ),
      '[]'::jsonb
    ),

    'expires_at', session.expires_at
  ) into result;

  return result;
end;
$$;
