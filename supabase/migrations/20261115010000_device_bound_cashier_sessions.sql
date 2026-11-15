-- Existing sessions have no reliable device identity. Keep their history but
-- retire them: cashiers must sign in again from a paired terminal after rollout.
alter table private.cashier_sessions add column device_id uuid;
update private.cashier_sessions set revoked_at = clock_timestamp()
  where device_id is null and revoked_at is null;
alter table private.cashier_sessions
  add constraint cashier_sessions_device_store_fkey foreign key (device_id, store_id)
    references public.terminal_devices(id, store_id),
  add constraint cashier_sessions_device_required check (device_id is not null or revoked_at is not null);
create index cashier_sessions_device_idx on private.cashier_sessions(device_id);

-- Old callers must not be able to mint sessions without a device.
drop function public.cashier_create_session(uuid,text);
create function public.cashier_create_session(p_cashier_id uuid, p_token_hash text, p_device_id uuid)
returns timestamptz language plpgsql security invoker set search_path = '' as $$
declare c public.cashiers; d public.terminal_devices; expiry timestamptz;
begin
  -- Lock device FIRST, just like request validation. Revocation either waits for
  -- this transaction and retires its new session, or wins and prevents login.
  select * into d from public.terminal_devices where id = p_device_id and revoked_at is null for share;
  if not found then raise exception 'Terminal unavailable; pair the device again' using errcode = '28000'; end if;
  perform 1 from public.stores where id = d.store_id and is_active for share;
  if not found then raise exception 'Store unavailable' using errcode = '42501'; end if;
  select * into c from public.cashiers where id = p_cashier_id and is_active for update;
  if not found or c.store_id <> d.store_id then
    raise exception 'Cashier does not belong to this terminal store' using errcode = '42501';
  end if;
  if exists(select 1 from private.cashier_sessions
    where cashier_id = c.id and revoked_at is null and expires_at > clock_timestamp()) then
    raise exception 'Cashier already has an active session' using errcode = 'PT409';
  end if;
  update private.cashier_sessions set revoked_at = clock_timestamp()
    where cashier_id = c.id and revoked_at is null;
  perform private.close_expired_cashier_shifts(c.store_id);
  insert into private.cashier_sessions(cashier_id,store_id,token_hash,device_id)
    values(c.id,c.store_id,p_token_hash,d.id) returning expires_at into expiry;
  update private.cashier_store_login_attempts set attempts = 0
    where store_id = c.store_id and name = lower(btrim(c.name));
  return expiry;
end;
$$;
revoke all on function public.cashier_create_session(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.cashier_create_session(uuid,text,uuid) to service_role;

-- All protected terminal operations already call this function. Preserve the
-- cashier/store/expiry checks and shift sweep, adding a live device check.
create or replace function private.require_cashier_session(p_token_hash text)
returns private.cashier_sessions language plpgsql security invoker set search_path = '' as $$
declare s private.cashier_sessions; terminal_id uuid;
begin
  -- Lock the device before any session row; the revocation trigger uses the
  -- same order, so an in-flight authorized operation can finish before revoke.
  select d.id into terminal_id from public.terminal_devices d
    join private.cashier_sessions cs on cs.device_id = d.id and cs.store_id = d.store_id
    where cs.token_hash = p_token_hash and cs.revoked_at is null and d.revoked_at is null
    for share of d;
  if not found then raise exception 'Cashier session unavailable; sign in again' using errcode = '28000'; end if;
  select cs.* into s from private.cashier_sessions cs
    join public.cashiers c on c.id = cs.cashier_id and c.store_id = cs.store_id
    join public.stores st on st.id = cs.store_id
    where cs.token_hash = p_token_hash and cs.device_id = terminal_id and cs.revoked_at is null
      and cs.expires_at > clock_timestamp() and c.is_active and st.is_active
    for share of cs, c, st;
  if not found then raise exception 'Cashier session unavailable; sign in again' using errcode = '28000'; end if;
  perform private.close_expired_cashier_shifts(s.store_id);
  return s;
end;
$$;
revoke all on function private.require_cashier_session(text) from public, anon, authenticated;
grant execute on function private.require_cashier_session(text) to service_role;

-- Retire sessions immediately on any device revocation, including the owner's
-- revoke_terminal_device RPC. Other devices and historical shifts are retained.
create function private.revoke_terminal_device_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update private.cashier_sessions set revoked_at = new.revoked_at
    where device_id = new.id and revoked_at is null;
  return new;
end;
$$;
revoke all on function private.revoke_terminal_device_sessions() from public, anon, authenticated, service_role;
create trigger revoke_terminal_device_sessions after update of revoked_at on public.terminal_devices
  for each row when (old.revoked_at is null and new.revoked_at is not null)
  execute function private.revoke_terminal_device_sessions();
