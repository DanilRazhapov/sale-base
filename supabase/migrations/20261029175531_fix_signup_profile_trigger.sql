-- profiles has no role column; store roles belong to store_members.
-- The existing on_auth_user_created trigger continues calling this function.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, is_active)
  values (
    new.id,
    nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
    true
  );
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;
