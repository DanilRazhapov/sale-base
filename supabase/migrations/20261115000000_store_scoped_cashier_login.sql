-- A name identifies candidates only inside the shop resolved from the device.
-- Deploy the matching Edge Function change (p_store_id) with this migration.
create table private.cashier_store_login_attempts (
  store_id uuid not null references public.stores(id),
  name text not null check (char_length(name) between 1 and 120 and name = lower(btrim(name))),
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts >= 0),
  primary key (store_id, name)
);

alter table private.cashier_store_login_attempts enable row level security;

revoke all on private.cashier_store_login_attempts from public, anon, authenticated;
grant select, insert, update on private.cashier_store_login_attempts to service_role;

-- Preserve existing limits conservatively for every shop containing that name.
insert into private.cashier_store_login_attempts(store_id, name, window_started_at, attempts)
select distinct
  c.store_id,
  a.name,
  a.window_started_at,
  a.attempts
from
  private.cashier_name_login_attempts a
  join public.cashiers c on lower(btrim(c.name)) = a.name;

create index cashiers_store_login_name_idx on public.cashiers(store_id, lower(btrim(name)))
where
  is_active;

-- Remove the global-name entry point: callers must supply a server-resolved shop.
drop function public.cashier_login_attempt(text);

create function public.cashier_login_attempt(p_store_id uuid, p_name text)
  returns setof public.cashiers
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  login_name text := lower(btrim(p_name));
  budget private.cashier_store_login_attempts;
begin
  if p_store_id is null or login_name is null or char_length(login_name) not between 1 and 120 then return;
  end if;
  if not exists (
    select 1 from public.cashiers c join public.stores s on s.id = c.store_id
    where c.store_id = p_store_id and lower(btrim(c.name)) = login_name and c.is_active and s.is_active
  ) then return; end if;

  -- The counter RPC commits before Edge Function PIN verification.
  insert into private.cashier_store_login_attempts(store_id, name)
    values(p_store_id, login_name) on conflict do nothing;
  select * into budget from private.cashier_store_login_attempts
    where store_id = p_store_id and name = login_name for update;
  if budget.window_started_at <= clock_timestamp() - interval '15 minutes' then
    update private.cashier_store_login_attempts
      set attempts = 1, window_started_at = clock_timestamp()
      where store_id = p_store_id and name = login_name;
  elsif budget.attempts >= 5 then
    return;
  else
    update private.cashier_store_login_attempts set attempts = attempts + 1
      where store_id = p_store_id and name = login_name;
  end if;

  return query select c.* from public.cashiers c join public.stores s on s.id = c.store_id
    where c.store_id = p_store_id and lower(btrim(c.name)) = login_name and c.is_active and s.is_active
    order by c.id;
end;
$$;

revoke all on function public.cashier_login_attempt(uuid, text) from public, anon, authenticated;
grant execute on function public.cashier_login_attempt(uuid, text) to service_role;

-- Preserve the single-session rule; successful login resets only this shop/name.
create or replace function public.cashier_create_session(
  p_cashier_id uuid,
  p_token_hash text
)
  returns timestamptz
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  c public.cashiers;
  expiry timestamptz;
begin
  select * into c
  from public.cashiers
  where id = p_cashier_id and is_active for update;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    raise exception 'Cashier unavailable' using errcode = '42501';
  end if;
  if exists(select 1 from private.cashier_sessions
    where cashier_id = c.id and revoked_at is null and expires_at > clock_timestamp()) then
    raise exception 'Cashier already has an active session' using errcode = 'PT409';
  end if;
  update private.cashier_sessions set revoked_at = clock_timestamp()
    where cashier_id = c.id and revoked_at is null;
  insert into private.cashier_sessions(cashier_id,store_id,token_hash)
    values(c.id,c.store_id,p_token_hash) returning expires_at into expiry;
  update private.cashier_store_login_attempts set attempts = 0
    where store_id = c.store_id and name = lower(btrim(c.name));
  return expiry;
end;
$$;

revoke all on function public.cashier_create_session(uuid, text) from public, anon, authenticated;
grant execute on function public.cashier_create_session(uuid, text) to service_role;

drop table private.cashier_name_login_attempts;
