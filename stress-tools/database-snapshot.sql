select jsonb_build_object(
  'server_time', clock_timestamp(),
  'database_bytes', pg_database_size(current_database()),
  'tables', (select jsonb_agg(jsonb_build_object('schema',schemaname,'table',relname,'bytes',pg_total_relation_size(relid),'live_rows',n_live_tup,'dead_rows',n_dead_tup)) from pg_stat_user_tables where schemaname in ('public','private')),
  'database_stats', (select to_jsonb(d) - 'datid' - 'datname' from pg_stat_database d where datname=current_database()),
  'connections', (select jsonb_agg(to_jsonb(a)) from (select state,wait_event_type,count(*) as count from pg_stat_activity where datname=current_database() group by state,wait_event_type) a),
  'queries', (select jsonb_agg(to_jsonb(q)) from (
    select queryid::text, case when query ilike '%cashier_checkout%' then 'checkout' when query ilike '%cashier_tablet_snapshot%' then 'snapshot' when query ilike '%cashier_record_movement%' then 'movement' else 'other_cashier' end as operation,
      calls,total_exec_time,rows,shared_blks_hit,shared_blks_read,temp_blks_written,wal_bytes
    from extensions.pg_stat_statements where query ilike '%cashier_%' and query not ilike '%pg_stat_%'
  ) q)
) as snapshot;
