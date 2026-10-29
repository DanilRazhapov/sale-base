create table public.cashier_receipts (
  id uuid primary key,
  store_id uuid not null references public.stores(id),
  cashier_id uuid not null references public.cashiers(id),
  cashier_session_id uuid not null references private.cashier_sessions(id),
  shift_id uuid not null references public.cashier_shifts(id),
  kind text not null check (kind in ('sale','receipt','writeoff')),
  total numeric(14,2) not null default 0 check (total >= 0),
  request_items jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table public.cashier_receipts enable row level security;
grant select on public.cashier_receipts to authenticated;
grant select,insert,update on public.cashier_receipts to service_role;
create policy "Owners view receipts" on public.cashier_receipts for select to authenticated
  using (public.is_store_owner(store_id));
create index cashier_receipts_store_time_idx on public.cashier_receipts(store_id,created_at desc);
alter table public.stock_movements add column receipt_id uuid references public.cashier_receipts(id);
create index stock_movements_receipt_idx on public.stock_movements(receipt_id);

create function public.cashier_checkout(
  p_token_hash text, p_request_id uuid, p_items jsonb, p_kind text default 'sale'
) returns public.cashier_receipts language plpgsql security invoker set search_path = '' as $$
declare
  session private.cashier_sessions; shift public.cashier_shifts; receipt public.cashier_receipts;
  item jsonb; product public.products; movement public.stock_movements;
  quantity numeric; total numeric := 0; shift_revenue numeric;
begin
  session := private.require_cashier_session(p_token_hash);
  if p_request_id is null or p_kind is null or p_kind not in ('sale','receipt','writeoff')
    or p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Некорректная корзина' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'В корзине должно быть от 1 до 100 товаров' using errcode = '22023';
  end if;

  -- A retry of the same request must never sell the same cart twice.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
  select * into receipt from public.cashier_receipts where id = p_request_id;
  if found then
    if receipt.cashier_id <> session.cashier_id or receipt.store_id <> session.store_id
      or receipt.kind <> p_kind or receipt.request_items <> p_items then
      raise exception 'Запрос уже использован для другой корзины' using errcode = '22023';
    end if;
    return receipt;
  end if;

  select * into shift from public.cashier_shifts
    where store_id = session.store_id and closed_at is null for update;
  if not found or shift.cashier_id <> session.cashier_id then
    raise exception 'Сначала откройте свою смену' using errcode = '42501';
  end if;
  if exists(select 1 from jsonb_array_elements(p_items) entry
    where jsonb_typeof(entry) <> 'object' or jsonb_typeof(entry->'product_id') is distinct from 'string'
      or jsonb_typeof(entry->'quantity') is distinct from 'number') then
    raise exception 'Некорректные позиции корзины' using errcode = '22023';
  end if;
  if (select count(distinct (entry->>'product_id')::uuid) from jsonb_array_elements(p_items) entry)
    <> jsonb_array_length(p_items) then
    raise exception 'Объедините повторяющиеся товары' using errcode = '22023';
  end if;

  -- Lock products in a deterministic order, and validate the entire cart before writing.
  for item in select entry from jsonb_array_elements(p_items) entry order by (entry->>'product_id')::uuid loop
    quantity := (item->>'quantity')::numeric;
    if quantity <= 0 or quantity >= 100000000000 or quantity <> round(quantity,3) then
      raise exception 'Количество должно быть больше нуля, до трёх знаков после запятой' using errcode = '22023';
    end if;
    select * into product from public.products where id = (item->>'product_id')::uuid
      and store_id = session.store_id and is_active for update;
    if not found then raise exception 'Товар недоступен. Обновите каталог.' using errcode = '22023'; end if;
    if p_kind <> 'receipt' and coalesce(product.stock,0) < quantity then
      raise exception 'Недостаточно товара: %', product.name using errcode = '22023';
    end if;
    if p_kind = 'receipt' and coalesce(product.stock,0) + quantity >= 100000000000 then
      raise exception 'Превышен максимальный остаток товара: %', product.name using errcode = '22023';
    end if;
    if p_kind = 'sale' then
      if product.price is null or product.price < 0
        or jsonb_typeof(item->'expected_price') is distinct from 'number'
        or product.price is distinct from (item->>'expected_price')::numeric then
        raise exception 'Цена товара изменилась: %. Обновите цены в корзине.', product.name using errcode = '22023';
      end if;
      total := total + round(product.price * quantity,2);
    end if;
  end loop;
  if p_kind = 'sale' then
    select coalesce(sum(round(m.quantity * m.price_at_time,2)),0) into shift_revenue
      from public.stock_movements m where m.shift_id = shift.id;
    if shift.opening_cash + shift_revenue + total >= 10000000000 then
      raise exception 'Превышена максимальная сумма кассы' using errcode = '22023';
    end if;
  end if;
  insert into public.cashier_receipts(id,store_id,cashier_id,cashier_session_id,shift_id,kind,total,request_items)
    values(p_request_id,session.store_id,session.cashier_id,session.id,shift.id,p_kind,total,p_items) returning * into receipt;
  for item in select entry from jsonb_array_elements(p_items) entry order by (entry->>'product_id')::uuid loop
    movement := public.cashier_record_movement(p_token_hash,(item->>'product_id')::uuid,p_kind,(item->>'quantity')::numeric,null);
    update public.stock_movements set receipt_id = receipt.id where id = movement.id;
  end loop;
  return receipt;
end;
$$;
revoke all on function public.cashier_checkout(text,uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.cashier_checkout(text,uuid,jsonb,text) to service_role;

create or replace function public.cashier_tablet_snapshot(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; result jsonb;
begin
  session := private.require_cashier_session(p_token_hash);
  select jsonb_build_object(
    'store', (select jsonb_build_object('id',id,'name',name) from public.stores where id = session.store_id),
    'cashier', (select jsonb_build_object('id',id,'name',name) from public.cashiers where id = session.cashier_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'stock',stock,'unit',unit,
      'price',price,'category_id',category_id) order by name)
      from public.products where store_id = session.store_id and is_active), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,name)
      from public.categories where store_id = session.store_id), '[]'::jsonb),
    'shift', (select jsonb_build_object('id',s.id,'cashier_id',s.cashier_id,'cashier_name',c.name,
      'opened_at',s.opened_at,'opening_cash',s.opening_cash,'revenue',
      (select coalesce(sum(round(quantity * price_at_time,2)),0) from public.stock_movements where shift_id = s.id))
      from public.cashier_shifts s join public.cashiers c on c.id = s.cashier_id
      where s.store_id = session.store_id and s.closed_at is null),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (
      select id,product_id,quantity,direction,note,created_at,price_at_time,receipt_id from public.stock_movements
      where cashier_id = session.cashier_id order by created_at desc limit 30
    ) m), '[]'::jsonb),
    'expires_at', session.expires_at
  ) into result;
  return result;
end;
$$;
