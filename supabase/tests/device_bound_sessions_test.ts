import { PGlite } from "@electric-sql/pglite";

Deno.test("device-bound sessions: upgrade, tenant checks, revocation and shift continuity", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  const secondCashier = "30000000-0000-4000-8000-000000000002";
  const first = "40000000-0000-4000-8000-000000000001";
  const second = "40000000-0000-4000-8000-000000000002";
  const foreign = "40000000-0000-4000-8000-000000000003";
  function assert(value: unknown, message: string): asserts value {
    if (!value) throw new Error(message);
  }
  async function rows(sql: string, args: unknown[] = []) {
    return (await db.query<Record<string, unknown>>(sql, args)).rows;
  }
  async function rejects(sql: string, args: unknown[], expected: string) {
    try { await db.query(sql, args); } catch (error) {
      assert((error as { code: string }).code === expected, String(error)); return;
    }
    throw new Error(`Expected ${expected}: ${sql}`);
  }
  const newMigration = "20261115010000_device_bound_cashier_sessions.sql";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      insert into auth.users(id) values('${owner}');
    `);
    // Exercise the complete migration history, except scheduler extensions that
    // are not available inside PGlite. No production database is touched.
    const migrations: string[] = [];
    for await (const entry of Deno.readDir(new URL("../migrations/", import.meta.url))) {
      if (entry.name.endsWith(".sql") && entry.name < newMigration && !entry.name.includes("schedule")) migrations.push(entry.name);
    }
    for (const file of migrations.sort()) {
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${file}`, import.meta.url)));
    }
    await db.exec(`
      insert into public.profiles(id) values('${owner}');
      insert into public.stores(id,name,created_by) values
        ('${store}','One','${owner}'),('${otherStore}','Two','${owner}');
      insert into public.store_members(store_id,user_id,role) values
        ('${store}','${owner}','owner'),('${otherStore}','${owner}','owner');
      insert into public.cashiers(id,store_id,name,pin_hash,created_by) values
        ('${cashier}','${store}','Alex','test','${owner}'),
        ('${secondCashier}','${store}','Sam','test','${owner}');
      insert into public.terminal_devices(id,store_id,name,paired_by) values
        ('${first}','${store}','Till 1','${owner}'),('${second}','${store}','Till 2','${owner}'),
        ('${foreign}','${otherStore}','Foreign till','${owner}');
      set role service_role;
    `);
    await rows("select public.cashier_create_session($1,$2)", [cashier, "a".repeat(64)]);
    const [shift] = await rows("select * from public.cashier_open_shift($1,100)", ["a".repeat(64)]);
    await db.exec("reset role");
    await db.exec(await Deno.readTextFile(new URL(`../migrations/${newMigration}`, import.meta.url)));
    assert((await rows("select revoked_at from private.cashier_sessions"))[0].revoked_at !== null, "Upgrade revokes legacy session");
    await db.exec("set role service_role");
    await rejects("select * from private.require_cashier_session($1)", ["a".repeat(64)], "28000");
    await rejects("select public.cashier_create_session($1,$2)", [cashier, "b".repeat(64)], "42883");
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "b".repeat(64), foreign], "42501");
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "b".repeat(64), null], "28000");
    await rows("select public.cashier_create_session($1,$2,$3)", [cashier, "b".repeat(64), first]);
    const [session] = await rows("select * from private.require_cashier_session($1)", ["b".repeat(64)]);
    assert(session.device_id === first && session.store_id === store, "Session bound to correct device and store");
    const [snapshot] = await rows("select public.cashier_tablet_snapshot($1) as data", ["b".repeat(64)]);
    assert((snapshot.data as { shift: { id: string } }).shift.id === shift.id, "New session continues historical open shift");
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "c".repeat(64), second], "PT409");
    await rows("select public.cashier_create_session($1,$2,$3)", [secondCashier, "c".repeat(64), second]);
    await rejects("update private.cashier_sessions set device_id=$1 where token_hash=$2", [foreign, "b".repeat(64)], "23503");
    await rejects("insert into private.cashier_sessions(cashier_id,store_id,token_hash) values($1,$2,$3)",
      [cashier, store, "d".repeat(64)], "23514");
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`);
    await rows("select public.revoke_terminal_device($1)", [first]);
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "d".repeat(64), second], "42501");
    await db.exec("reset role; set role service_role");
    assert((await rows("select revoked_at from private.cashier_sessions where token_hash=$1", ["b".repeat(64)]))[0].revoked_at !== null,
      "Owner revocation retires session immediately");
    await rejects("select public.cashier_tablet_snapshot($1)", ["b".repeat(64)], "28000");
    await rejects("select * from public.cashier_open_shift($1,0)", ["b".repeat(64)], "28000");
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "d".repeat(64), first], "28000");
    assert((await rows("select * from private.require_cashier_session($1)", ["c".repeat(64)])).length === 1,
      "Other terminal session remains usable");
    await rows("select public.cashier_create_session($1,$2,$3)", [cashier, "d".repeat(64), second]);
    const [resumed] = await rows("select public.cashier_tablet_snapshot($1) as data", ["d".repeat(64)]);
    assert((resumed.data as { shift: { id: string } }).shift.id === shift.id, "Paired replacement device can resume same cashier shift");
    await rows("update private.cashier_sessions set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", ["d".repeat(64)]);
    await rejects("select * from private.require_cashier_session($1)", ["d".repeat(64)], "28000");
    await db.exec(`reset role; update public.cashiers set is_active=false where id='${secondCashier}'; set role service_role;`);
    await rejects("select * from private.require_cashier_session($1)", ["c".repeat(64)], "28000");
    await db.exec("reset role; set role anon");
    await rejects("select public.cashier_create_session($1,$2,$3)", [cashier, "e".repeat(64), second], "42501");
  } finally { await db.close(); }
});
