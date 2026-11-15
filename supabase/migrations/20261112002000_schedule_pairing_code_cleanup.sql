-- Run without any connected browser. Rows are retained for at least 24 hours
-- from creation, then removed on the next successful run (normally within 12h).
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('cleanup-terminal-pairing-codes', '0 */12 * * *',
  $$select private.cleanup_terminal_pairing_codes();$$);
