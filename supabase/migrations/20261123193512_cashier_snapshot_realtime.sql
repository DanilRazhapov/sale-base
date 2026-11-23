-- Keep the price event for existing cashiers. All other changes to the snapshot
-- can now wake up the same subscription instead of waiting for a poll.
create function private.broadcast_cashier_snapshot_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
declare
  previous_store uuid;
  current_store uuid;
  event_name text := 'snapshot_changed';
begin
  if tg_table_name = 'stores' then
    current_store := new.id;
  else
    if tg_op <> 'INSERT' then
      previous_store := old.store_id;
    end if;
    if tg_op <> 'DELETE' then
      current_store := new.store_id;
    end if;
    if tg_table_name = 'products' and tg_op = 'UPDATE' then
      if old.price is distinct from new.price then
        event_name := 'price_changed';
      end if;
    end if;
  end if;

  -- Include connected sessions when a store is disabled, so they revalidate.
  perform realtime.send('{}'::jsonb, event_name,
    'cashier-prices:' || encode(sha256(convert_to('cashier-prices:' || s.token_hash, 'UTF8')), 'hex'), true)
  from private.cashier_sessions s
  where s.store_id in (previous_store, current_store)
    and s.revoked_at is null and s.expires_at > statement_timestamp();
  return null;
end;
$$;

revoke all on function private.broadcast_cashier_snapshot_change() from public, anon, authenticated;

drop trigger broadcast_cashier_price_change on public.products;
drop function private.broadcast_cashier_price_change();

create trigger broadcast_cashier_product_change
  after insert or update or delete on public.products
  for each row execute function private.broadcast_cashier_snapshot_change();

create trigger broadcast_cashier_category_change
  after insert or update or delete on public.categories
  for each row execute function private.broadcast_cashier_snapshot_change();

create trigger broadcast_cashier_shift_change
  after insert or update or delete on public.cashier_shifts
  for each row execute function private.broadcast_cashier_snapshot_change();

create trigger broadcast_cashier_name_change
  after update of name on public.cashiers
  for each row when (old.name is distinct from new.name)
  execute function private.broadcast_cashier_snapshot_change();

create trigger broadcast_cashier_store_change
  after update of name, is_active on public.stores
  for each row when (old.name is distinct from new.name or old.is_active is distinct from new.is_active)
  execute function private.broadcast_cashier_snapshot_change();

create function private.broadcast_cashier_session_revoked()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  perform realtime.send('{}'::jsonb, 'snapshot_changed',
    'cashier-prices:' || encode(sha256(convert_to('cashier-prices:' || old.token_hash, 'UTF8')), 'hex'), true);
  return null;
end;
$$;

revoke all on function private.broadcast_cashier_session_revoked() from public, anon, authenticated;

create trigger broadcast_cashier_session_revoked
  after update of revoked_at on private.cashier_sessions
  for each row when (old.revoked_at is null and new.revoked_at is not null
    and old.expires_at > statement_timestamp())
  execute function private.broadcast_cashier_session_revoked();
