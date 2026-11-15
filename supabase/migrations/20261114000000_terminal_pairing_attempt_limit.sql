create table private.terminal_pairing_attempt_budget (
  id boolean primary key default true check (id),
  window_started_at timestamptz not null default clock_timestamp(),
  attempts integer not null default 0 check (attempts between 0 and 30)
);
insert into private.terminal_pairing_attempt_budget(id) values(true);
alter table private.terminal_pairing_attempt_budget enable row level security;
revoke all on private.terminal_pairing_attempt_budget from public, anon, authenticated;
grant select, update on private.terminal_pairing_attempt_budget to service_role;

create function public.terminal_pairing_attempt() returns boolean
language plpgsql security invoker set search_path = '' as 
$$
declare budget private.terminal_pairing_attempt_budget;
begin
  select * into budget from private.terminal_pairing_attempt_budget where id for update;
  if not found then return false; 
  end if;
  if budget.window_started_at <= clock_timestamp() - interval '1 minute' then
    update private.terminal_pairing_attempt_budget
      set attempts = 1, window_started_at = clock_timestamp() where id;
    return true;
  end if;
  if budget.attempts >= 30 then return false; end if;
  update private.terminal_pairing_attempt_budget set attempts = attempts + 1 where id;
  return true;
end;
$$;
revoke all on function public.terminal_pairing_attempt() from public, anon, authenticated;
grant execute on function public.terminal_pairing_attempt() to service_role;