-- Login requires only the cashier's name and PIN. No codes or tablet pairing.
drop function public.cashier_login_attempt(text);
alter table public.cashiers drop column login_code;
create index cashiers_login_name_idx on public.cashiers(lower(btrim(name))) where is_active;

create table private.cashier_name_login_attempts (
  name text primary key,
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0
);
alter table private.cashier_name_login_attempts enable row level security;
grant select, insert, update on private.cashier_name_login_attempts to service_role;

-- Multiple cashiers can have the same name. The Edge Function verifies the PIN
-- against all candidates and only logs in when exactly one account matches.
create function public.cashier_login_attempt(p_name text) returns setof public.cashiers
language plpgsql security invoker set search_path = '' as $$
declare login_name text := lower(btrim(p_name)); a private.cashier_name_login_attempts;
begin
  if login_name is null or char_length(login_name) not between 1 and 120 then return; end if;
  if not exists(select 1 from public.cashiers c join public.stores s on s.id = c.store_id
    where lower(btrim(c.name)) = login_name and c.is_active and s.is_active) then return; end if;
  insert into private.cashier_name_login_attempts(name) values(login_name) on conflict do nothing;
  select * into a from private.cashier_name_login_attempts where name = login_name for update;
  if a.window_started_at <= clock_timestamp() - interval '15 minutes' then
    update private.cashier_name_login_attempts set attempts = 1, window_started_at = clock_timestamp() where name = login_name;
  elsif a.attempts >= 5 then
    return;
  else
    update private.cashier_name_login_attempts set attempts = attempts + 1 where name = login_name;
  end if;
  return query select c.* from public.cashiers c join public.stores s on s.id = c.store_id
    where lower(btrim(c.name)) = login_name and c.is_active and s.is_active order by c.id;
end;
$$;
revoke all on function public.cashier_login_attempt(text) from public,anon,authenticated;
grant execute on function public.cashier_login_attempt(text) to service_role;

create or replace function public.cashier_create_session(p_cashier_id uuid, p_token_hash text) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; expiry timestamptz;
begin
  select * into c from public.cashiers where id = p_cashier_id and is_active for share;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    raise exception 'Кассир недоступен' using errcode = '42501';
  end if;
  insert into private.cashier_sessions(cashier_id,store_id,token_hash)
    values(c.id,c.store_id,p_token_hash) returning expires_at into expiry;
  update private.cashier_name_login_attempts set attempts = 0 where name = lower(btrim(c.name));
  return expiry;
end;
$$;
drop table private.cashier_login_attempts;
