-- Internal RPC: only the Edge Function's admin client may call it.
-- SECURITY INVOKER preserves the caller's privileges (service_role bypasses RLS).
create function public.create_store_with_owner(
  p_user_id uuid,
  p_name text,
  p_address text
)
returns public.stores
language plpgsql
security invoker
set search_path = ''
as $$
declare
  new_store public.stores;
begin
  if p_name is null or char_length(btrim(p_name)) not between 1 and 120
    or p_address is null or char_length(btrim(p_address)) not between 1 and 500 then
    raise exception 'Invalid store name or address' using errcode = '22023';
  end if;

  -- Lock the profile so it cannot be deactivated or deleted during creation.
  perform 1 from public.profiles
  where id = p_user_id and is_active = true
  for share;
  if not found then
    raise exception 'An active profile is required' using errcode = '42501';
  end if;

  insert into public.stores (name, address, created_by)
  values (btrim(p_name), btrim(p_address), p_user_id)
  returning * into new_store;

  insert into public.store_members (store_id, user_id, role, is_active)
  values (new_store.id, p_user_id, 'owner', true);

  return new_store;
end;
$$;

revoke all on function public.create_store_with_owner(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.create_store_with_owner(uuid, text, text)
  to service_role;
