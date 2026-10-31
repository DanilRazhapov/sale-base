-- Supabase Cron runs in Postgres even with no browser or terminal connected.
create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('close-expired-cashier-shifts', '* * * * *',
  $$select private.close_expired_cashier_shifts();$$);
