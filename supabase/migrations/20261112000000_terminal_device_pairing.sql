create schema if not exists private;

grant usage on schema private to service_role;

create table public.terminal_devices (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  paired_by uuid not null references public.profiles(id),
  created_at timestamptz not null default clock_timestamp(),
  revoked_at timestamptz,
  unique (id, store_id)
);

create index terminal_devices_store_idx on public.terminal_devices(store_id);

create index terminal_devices_paired_by_idx on public.terminal_devices(paired_by);

create table private.terminal_pairing_codes (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.stores(id),
  created_by uuid not null references public.profiles(id),
  code_hash text not null unique check (code_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz not null default (statement_timestamp() + interval '5 minutes'),
  consumed_at timestamptz,
  device_id uuid unique references public.terminal_devices(id),
  check (expires_at > created_at and expires_at <= created_at + interval '5 minutes'),
  check ((consumed_at is null) =(device_id is null))
);

create index terminal_pairing_codes_store_idx on private.terminal_pairing_codes(store_id);

create index terminal_pairing_codes_creator_idx on private.terminal_pairing_codes(created_by);

create table private.terminal_device_credentials (
  device_id uuid primary key references public.terminal_devices(id),
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$')
);

alter table private.terminal_pairing_codes
  drop constraint terminal_pairing_codes_device_id_fkey;

alter table private.terminal_pairing_codes
  add constraint terminal_pairing_codes_device_store_fkey foreign key (device_id, store_id) references public.terminal_devices(id, store_id);

alter table public.terminal_devices enable row level security;

alter table private.terminal_pairing_codes enable row level security;

alter table private.terminal_device_credentials enable row level security;

revoke all on public.terminal_devices, private.terminal_pairing_codes, private.terminal_device_credentials
  from public, anon, authenticated;
grant select on public.terminal_devices to authenticated;
grant select, insert, update on public.terminal_devices, private.terminal_pairing_codes, private.terminal_device_credentials
  to service_role;

create policy terminal_devices_owner_read on public.terminal_devices
  for select to authenticated
  using (public.is_store_owner(store_id)
    and exists (
      select
        1
      from
        public.profiles p
      where
        p.id =(
          select
            auth.uid())
          and p.is_active));

create function private.guard_terminal_device()
  returns trigger
  language plpgsql
  set search_path = ''
  as $$
begin
  if new.id is distinct from old.id or new.store_id is distinct from old.store_id
    or new.paired_by is distinct from old.paired_by or new.created_at is distinct from old.created_at
    or (old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at) then
    raise exception 'Device identity and revocation are immutable'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_terminal_device() from public, anon, authenticated;

create trigger guard_terminal_device
  before update on public.terminal_devices
  for each row
  execute function private.guard_terminal_device();

create function public.issue_terminal_pairing_code(
  p_owner_id uuid,
  p_store_id uuid,
  p_code_hash text
)
  returns timestamptz
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  expiry timestamptz;
begin
  perform 1 from public.store_members m
    join public.profiles p on p.id = m.user_id
    join public.stores s on s.id = m.store_id
    where m.user_id = p_owner_id and m.store_id = p_store_id
      and m.role = 'owner' and m.is_active and p.is_active and s.is_active
    for share of m, p, s;
  if not found then
    raise exception 'Active store owner required' using errcode = '42501';
  end if;
  insert into private.terminal_pairing_codes(store_id, created_by, code_hash)
    values(p_store_id, p_owner_id, p_code_hash) returning expires_at into expiry;
  return expiry;
end;
$$;

create function public.redeem_terminal_pairing_code(
  p_code_hash text,
  p_token_hash text,
  p_name text
)
  returns setof public.terminal_devices
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  code private.terminal_pairing_codes;
  device public.terminal_devices;
begin
  select * into code from private.terminal_pairing_codes
    where code_hash = p_code_hash and consumed_at is null and expires_at > clock_timestamp()
    for update;
  if not found then return;
  end if;
  if code.expires_at <= clock_timestamp() then
    return;
  end if;
  perform 1 from public.store_members m
    join public.profiles p on p.id = m.user_id
    join public.stores s on s.id = m.store_id
    where m.user_id = code.created_by and m.store_id = code.store_id
      and m.role = 'owner' and m.is_active and p.is_active and s.is_active
    for share of m, p, s;
  if not found then return;
  end if;
  insert into public.terminal_devices(store_id, name, paired_by)
    values(code.store_id, btrim(p_name), code.created_by) returning * into device;
  insert into private.terminal_device_credentials(device_id, token_hash)
    values(device.id, p_token_hash);
  update private.terminal_pairing_codes set consumed_at = clock_timestamp(), device_id = device.id
    where id = code.id;
  return next device;
end;
$$;

create function public.resolve_terminal_device(p_token_hash text)
  returns setof public.terminal_devices
  language sql
  security invoker
  set search_path = ''
  as $$
select d.* from public.terminal_devices d
    join private.terminal_device_credentials c on c.device_id = d.id
    join public.stores s on s.id = d.store_id
    where c.token_hash = p_token_hash and d.revoked_at is null and s.is_active;
$$;

create function public.revoke_terminal_device(p_device_id uuid)
  returns void
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  update public.terminal_devices d set revoked_at = coalesce(d.revoked_at, clock_timestamp())
    where d.id = p_device_id and public.is_store_owner(d.store_id)
      and exists(select 1 from public.profiles p where p.id = auth.uid() and p.is_active);
  if not found then
    raise exception 'Device unavailable' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.issue_terminal_pairing_code(uuid, uuid, text), public.redeem_terminal_pairing_code(text, text, text), public.resolve_terminal_device(text), public.revoke_terminal_device(uuid)
  from public, anon, authenticated;
grant execute on function public.issue_terminal_pairing_code(uuid, uuid, text), public.redeem_terminal_pairing_code(text, text, text), public.resolve_terminal_device(text)
  to service_role;
grant execute on function public.revoke_terminal_device(uuid) to authenticated;
