-- Retention is measured from creation, independently of redemption or expiry.
create index terminal_pairing_codes_created_at_idx on private.terminal_pairing_codes(created_at);

create function private.cleanup_terminal_pairing_codes()
  returns bigint
  language plpgsql
  security invoker
  set search_path = ''
  as $$
declare
  deleted_count bigint;
begin
  delete from private.terminal_pairing_codes
    where created_at <= statement_timestamp() - interval '24 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- The database scheduler runs as the migration owner. Neither app nor the API
-- needs permission to delete pairing history or invoke its maintenance function.
revoke all on function private.cleanup_terminal_pairing_codes()
  from public, anon, authenticated, service_role;
