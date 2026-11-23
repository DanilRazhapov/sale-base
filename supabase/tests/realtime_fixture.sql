-- PGlite has no Realtime server. Simulate the database interface used by the
-- price trigger and run the actual receive policy against the recorded messages.
create schema realtime;
create table realtime.messages (
  payload jsonb,
  event text,
  topic text,
  private boolean,
  extension text
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon;
grant select, insert on realtime.messages to anon;

create function realtime.topic() returns text language sql stable as $$
  select current_setting('realtime.topic', true);
$$;

create function realtime.send(jsonb, text, text, boolean) returns void language sql as $$
  insert into realtime.messages values ($1, $2, $3, $4, 'broadcast');
$$;
