-- Aggregate sales on the server, retaining RLS and explicit owner scoping.
create function public.get_owner_dashboard(p_store_id uuid default null, p_days integer default 30)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare
  today date := (now() at time zone 'Asia/Bishkek')::date;
  first_day date;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Войдите в аккаунт' using errcode = '42501';
  end if;
  if p_days is null or p_days not in (7, 30, 90) then
    raise exception 'Недопустимый период' using errcode = '22023';
  end if;
  if p_store_id is not null and not exists (
    select 1 from public.stores s
    where s.id = p_store_id and s.is_active and public.is_store_owner(s.id)
  ) then
    raise exception 'Нет доступа к магазину' using errcode = '42501';
  end if;
  first_day := today - (p_days - 1);

  with owned_stores as (
    select s.id from public.stores s
    where s.is_active and public.is_store_owner(s.id)
      and (p_store_id is null or s.id = p_store_id)
  ), sales as materialized (
    select m.id, m.receipt_id,
      (m.created_at at time zone 'Asia/Bishkek')::date as day,
      coalesce(c.name, 'Без категории') as category,
      round(m.quantity * m.price_at_time, 2) as revenue
    from public.stock_movements m
    join owned_stores s on s.id = m.store_id
    left join public.products p on p.id = m.product_id and p.store_id = m.store_id
    left join public.categories c on c.id = p.category_id and c.store_id = m.store_id
    where m.direction = -1 and m.movement_type = 'расход' and m.price_at_time is not null
      and m.created_at >= (first_day::timestamp at time zone 'Asia/Bishkek')
      and m.created_at <= now()
  ), daily as (
    select day, sum(revenue) as revenue from sales group by day
  ), calendar as (
    select first_day + n as day from generate_series(0, p_days - 1) n
  ), categories as (
    select category as name, sum(revenue) as revenue from sales group by category
  )
  select jsonb_build_object(
    'revenue', (select coalesce(sum(revenue), 0) from sales),
    -- Cart lines count once per receipt; pre-cart sales count once per movement.
    'sales_count', (select count(distinct coalesce(receipt_id, id)) from sales),
    'daily', (select jsonb_agg(jsonb_build_object('date', c.day, 'revenue', coalesce(d.revenue, 0)) order by c.day)
      from calendar c left join daily d using (day)),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'revenue', revenue)
      order by revenue desc, name), '[]'::jsonb) from categories),
    'updated_at', now()
  ) into result;
  return result;
end;
$$;

revoke all on function public.get_owner_dashboard(uuid, integer) from public, anon;
grant execute on function public.get_owner_dashboard(uuid, integer) to authenticated;
