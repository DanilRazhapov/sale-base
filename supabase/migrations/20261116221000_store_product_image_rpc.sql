create or replace function public.set_store_product_image(
  p_store_id uuid,
  p_product_id uuid,
  p_expected_image_key text,
  p_new_image_key text
)
  returns boolean
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  if auth.uid() is null
     or not public.is_store_owner(p_store_id) then
    raise exception 'Нет доступа к магазину'
      using errcode = '42501';
  end if;

  if p_new_image_key is null
     or p_new_image_key !~ (
       '^stores/' || p_store_id::text ||
       '/products/' || p_product_id::text ||
       '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$'
     ) then
    raise exception 'Некорректный ключ фотографии'
      using errcode = '22023';
  end if;

  update public.products
  set image_key = p_new_image_key
  where id = p_product_id
    and store_id = p_store_id
    and is_active = true
    and image_key is not distinct from p_expected_image_key;

  return found;
end;
$$;

revoke all on function public.set_store_product_image(uuid, uuid, text, text) from public, anon;
grant execute on function public.set_store_product_image(uuid, uuid, text, text) to authenticated;
