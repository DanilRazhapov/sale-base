create index cashier_sessions_active_store_idx on private.cashier_sessions(store_id)
  where revoked_at is null;

-- The topic is a separate capability derived from the session hash. It can
-- only receive empty notifications, and cannot authorize terminal API calls.
create view private.cashier_price_channels as
select s.store_id,
  'cashier-prices:' || encode(sha256(convert_to('cashier-prices:' || s.token_hash, 'UTF8')), 'hex') as topic
from private.cashier_sessions s
join public.terminal_devices d on d.id = s.device_id and d.store_id = s.store_id
join public.cashiers c on c.id = s.cashier_id and c.store_id = s.store_id
join public.stores st on st.id = s.store_id
where s.revoked_at is null and s.expires_at > statement_timestamp()
  and d.revoked_at is null and c.is_active and st.is_active;

revoke all on private.cashier_price_channels from public, anon, authenticated;

create function private.can_receive_cashier_price_changes(p_topic text)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
  as $$
    select exists(select 1 from private.cashier_price_channels where topic = p_topic);
  $$;

revoke all on function private.can_receive_cashier_price_changes(text) from public, anon, authenticated;
grant execute on function private.can_receive_cashier_price_changes(text) to anon;

create policy "Cashier terminals receive price changes" on realtime.messages
  for select to anon
  using (
    extension = 'broadcast'
    and topic = (select realtime.topic())
    and (select private.can_receive_cashier_price_changes(realtime.topic()))
  );

create function private.broadcast_cashier_price_change()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
  as $$
begin
  perform realtime.send('{}'::jsonb, 'price_changed', channel.topic, true)
    from private.cashier_price_channels channel where channel.store_id = new.store_id;
  return null;
end;
$$;

revoke all on function private.broadcast_cashier_price_change() from public, anon, authenticated;

create trigger broadcast_cashier_price_change
  after update on public.products
  for each row when (old.price is distinct from new.price)
  execute function private.broadcast_cashier_price_change();
