-- Blocking ends both the cashier session and their open shift atomically.
create or replace function private.revoke_blocked_cashier_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s public.cashier_shifts; revenue numeric;
begin
  if new.is_active is distinct from true then
    update private.cashier_sessions set revoked_at = clock_timestamp()
      where cashier_id = new.id and revoked_at is null;

    -- Serialize with checkout/closure before calculating the final cash balance.
    for s in select * from public.cashier_shifts
      where cashier_id = new.id and closed_at is null order by id for update
    loop
      select coalesce(sum(round(quantity * price_at_time,2)),0) into revenue
        from public.stock_movements where shift_id = s.id;
      update public.cashier_shifts set
        closed_at = least(clock_timestamp(), s.opened_at + interval '12 hours'),
        expected_cash = s.opening_cash + revenue,
        automatically_closed = true
        where id = s.id;
    end loop;
  end if;
  return new;
end; $$;

-- Repair open shifts belonging to cashiers blocked before this migration.
update public.cashiers c set is_active = c.is_active
where c.is_active is distinct from true and exists (
  select 1 from public.cashier_shifts s where s.cashier_id = c.id and s.closed_at is null
);
