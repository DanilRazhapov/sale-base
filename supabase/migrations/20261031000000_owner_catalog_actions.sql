create function public.remove_store_product(p_store_id uuid, p_product_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  update public.products set is_active = false where id = p_product_id and store_id = p_store_id;
  if not found then raise exception 'Товар не найден'; end if;
end; $$;

create function public.remove_store_category(p_store_id uuid, p_category_id integer) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  perform 1 from public.categories where id = p_category_id and store_id = p_store_id for update;
  if not found then raise exception 'Категория не найдена'; end if;
  update public.products set category_id = null where category_id = p_category_id and store_id = p_store_id;
  delete from public.categories where id = p_category_id and store_id = p_store_id;
end; $$;

create function public.set_store_cashier_active(p_store_id uuid, p_cashier_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_store_owner(p_store_id) then raise exception 'Нет доступа' using errcode = '42501'; end if;
  if p_active is null then raise exception 'Укажите статус кассира'; end if;
  update public.cashiers set is_active = p_active where id = p_cashier_id and store_id = p_store_id;
  if not found then raise exception 'Кассир не найден'; end if;
end; $$;
revoke all on function public.remove_store_product(uuid, uuid), public.remove_store_category(uuid, integer), public.set_store_cashier_active(uuid, uuid, boolean) from public, anon;
grant execute on function public.remove_store_product(uuid, uuid), public.remove_store_category(uuid, integer), public.set_store_cashier_active(uuid, uuid, boolean) to authenticated;
