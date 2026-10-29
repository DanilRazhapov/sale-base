-- Read-only schema audit. A match can be legitimate when role belongs to store_members;
-- inspect definitions rather than removing every occurrence of the word role.
select jsonb_build_object(
  'profile_columns', (
    select jsonb_agg(column_name order by ordinal_position)
    from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
  ),
  'routines_to_review', coalesce((
    select jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', p.proname,
      'definition', pg_get_functiondef(p.oid)))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prokind in ('f','p')
      and p.prosrc ilike '%profiles%' and p.prosrc ~* '\mrole\M'
  ), '[]'::jsonb),
  'views_to_review', coalesce((
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'name', viewname, 'definition', definition))
    from pg_views where schemaname in ('public','private')
      and definition ilike '%profiles%' and definition ~* '\mrole\M'
  ), '[]'::jsonb),
  'materialized_views_to_review', coalesce((
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'name', matviewname, 'definition', definition))
    from pg_matviews where schemaname in ('public','private')
      and definition ilike '%profiles%' and definition ~* '\mrole\M'
  ), '[]'::jsonb),
  'signup_trigger_function', (
    select pg_get_functiondef(to_regprocedure('public.handle_new_user()'))
  ),
  'policies_to_review', coalesce((
    select jsonb_agg(jsonb_build_object('schema', schemaname, 'table', tablename,
      'name', policyname, 'using', qual, 'with_check', with_check))
    from pg_policies where schemaname in ('public','private')
      and (tablename = 'profiles' or concat(qual, with_check) ilike '%profiles%')
      and concat(qual, with_check) ~* '\mrole\M'
  ), '[]'::jsonb)
) as audit;
