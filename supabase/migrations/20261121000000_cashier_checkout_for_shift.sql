create function public.cashier_checkout_for_shift(
  p_token_hash text,
  p_request_id uuid,
  p_items jsonb,
  p_kind text,
  p_shift_id uuid
)
  returns public.cashier_receipts
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  receipt public.cashier_receipts;
begin
  receipt := public.cashier_checkout(p_token_hash, p_request_id, p_items, p_kind);
  if receipt.shift_id is distinct from p_shift_id then
    raise exception 'Чек относится к другой смене.' using errcode = 'PT409';
  end if;
  return receipt;
end;
$$;

revoke all on function public.cashier_checkout_for_shift(text, uuid, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.cashier_checkout_for_shift(text, uuid, jsonb, text, uuid) to service_role;
