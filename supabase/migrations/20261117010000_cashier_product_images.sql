create or replace function public.cashier_tablet_snapshot(p_token_hash text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare session private.cashier_sessions; result jsonb;
begin
  session := private.require_cashier_session(p_token_hash);
  select jsonb_build_object(
    'store', (select jsonb_build_object('id',id,'name',name) from public.stores where id = session.store_id),
    'cashier', (select jsonb_build_object('id',id,'name',name) from public.cashiers where id = session.cashier_id),
    'products', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'stock',stock,'unit',unit,
      'price',price,'category_id',category_id,'image_key',image_key) order by name)
      from public.products where store_id = session.store_id and is_active), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name) order by sort_order,name)
      from public.categories where store_id = session.store_id), '[]'::jsonb),
    'shift', (select jsonb_build_object('id',s.id,'cashier_id',s.cashier_id,'cashier_name',c.name,
      'opened_at',s.opened_at,'opening_cash',s.opening_cash,'revenue',
      (select coalesce(sum(round(quantity * price_at_time,2)),0) from public.stock_movements where shift_id = s.id))
      from public.cashier_shifts s join public.cashiers c on c.id = s.cashier_id
      where s.store_id = session.store_id and s.closed_at is null),
    'movements', coalesce((select jsonb_agg(to_jsonb(m) order by m.created_at desc) from (
      select id,product_id,quantity,direction,note,created_at,price_at_time,receipt_id from public.stock_movements
      where cashier_id = session.cashier_id order by created_at desc limit 30
    ) m), '[]'::jsonb),
    'expires_at', session.expires_at
  ) into result;
  return result;
end;
$$;

revoke all on function public.cashier_tablet_snapshot(text) from public, anon, authenticated;
grant execute on function public.cashier_tablet_snapshot(text) to service_role;

