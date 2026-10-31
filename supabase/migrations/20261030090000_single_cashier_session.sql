-- A cashier may have only one unrevoked session. Expired sessions are retired on login.
-- Preserve the active shift's session when upgrading databases with duplicate sessions.
update private.cashier_sessions set revoked_at = clock_timestamp()
where revoked_at is null and expires_at <= clock_timestamp();
with ranked as (
  select cs.id, row_number() over (
    partition by cs.cashier_id
    order by exists(select 1 from public.cashier_shifts sh
      where sh.opened_session_id = cs.id and sh.closed_at is null) desc,
      cs.created_at desc, cs.id
  ) as position
  from private.cashier_sessions cs where cs.revoked_at is null
)
update private.cashier_sessions cs set revoked_at = clock_timestamp()
from ranked r where cs.id = r.id and r.position > 1;

create unique index cashier_one_unrevoked_session_idx
  on private.cashier_sessions(cashier_id) where revoked_at is null;

create or replace function public.cashier_create_session(p_cashier_id uuid, p_token_hash text) returns timestamptz
language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; expiry timestamptz;
begin
  -- Serialize concurrent logins for this cashier before checking or retiring sessions.
  select * into c from public.cashiers where id = p_cashier_id and is_active for update;
  if not found or not exists(select 1 from public.stores where id = c.store_id and is_active) then
    raise exception 'Кассир недоступен' using errcode = '42501';
  end if;
  if exists(select 1 from private.cashier_sessions
    where cashier_id = c.id and revoked_at is null and expires_at > clock_timestamp()) then
    raise exception 'Этот кассир уже вошёл на другом рабочем месте. Сначала завершите текущую сессию.' using errcode = 'PT409';
  end if;
  update private.cashier_sessions set revoked_at = clock_timestamp()
    where cashier_id = c.id and revoked_at is null;
  insert into private.cashier_sessions(cashier_id,store_id,token_hash)
    values(c.id,c.store_id,p_token_hash) returning expires_at into expiry;
  update private.cashier_name_login_attempts set attempts = 0 where name = lower(btrim(c.name));
  return expiry;
end;
$$;
revoke all on function public.cashier_create_session(uuid,text) from public,anon,authenticated;
grant execute on function public.cashier_create_session(uuid,text) to service_role;
