import { PGlite } from "@electric-sql/pglite";

Deno.test("terminal pairing: tenant isolation, atomic redemption, expiry and revocation", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const other = "10000000-0000-4000-8000-000000000002";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const code = "a".repeat(64), token = "b".repeat(64);
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
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      insert into auth.users(id) values('${owner}'),('${other}');
    `);
    for (const file of ["20261028154119_remote_schema.sql", "20261029135242_create_store_with_owner.sql",
      "20261029143855_store_inventory.sql", "20261029150620_cashier_terminal_identity.sql",
      "20261029151754_cashier_name_pin_login.sql", "20261112000000_terminal_device_pairing.sql",
      "20261112001000_terminal_pairing_code_retention.sql",
      "20261114000000_terminal_pairing_attempt_limit.sql"]) {
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${file}`, import.meta.url)));
    }
    await db.exec(`
      insert into public.profiles(id) values('${owner}'),('${other}');
      insert into public.stores(id,name,created_by) values
        ('${store}','One','${owner}'),('${otherStore}','Two','${other}');
      insert into public.store_members(store_id,user_id,role) values
        ('${store}','${owner}','owner'),('${otherStore}','${other}','owner');
      set role service_role;
    `);
    for (let i = 0; i < 30; i++) {
      assert((await rows("select public.terminal_pairing_attempt() as allowed"))[0].allowed === true, "Within attempt budget");
    }
    assert((await rows("select public.terminal_pairing_attempt() as allowed"))[0].allowed === false, "Thirty-first attempt blocked");
    await db.exec("update private.terminal_pairing_attempt_budget set window_started_at=clock_timestamp()-interval '2 minutes'");
    assert((await rows("select public.terminal_pairing_attempt() as allowed"))[0].allowed === true, "Attempt window resets");
    await rejects("select public.issue_terminal_pairing_code($1,$2,$3)", [other, store, code], "42501");
    await rows("select public.issue_terminal_pairing_code($1,$2,$3)", [owner, store, code]);
    await rejects("select * from public.redeem_terminal_pairing_code($1,$2,$3)", [code, "bad", "Till"], "23514");
    const [device] = await rows("select * from public.redeem_terminal_pairing_code($1,$2,$3)", [code, token, "Till"]);
    assert(device?.store_id === store, "Valid code survives failed transaction and binds correct store");
    assert((await rows("select * from public.redeem_terminal_pairing_code($1,$2,$3)", [code, "c".repeat(64), "Again"])).length === 0,
      "Consumed code cannot be reused");
    assert((await rows("select * from public.resolve_terminal_device($1)", [token])).length === 1, "Token resolves device");
    assert((await rows("select * from public.resolve_terminal_device($1)", ["f".repeat(64)])).length === 0, "Unknown token rejected");
    await rejects("update public.terminal_devices set store_id=$1 where id=$2", [otherStore, device.id], "22023");
    await rows("select public.issue_terminal_pairing_code($1,$2,$3)", [owner, store, "d".repeat(64)]);
    await db.exec("update private.terminal_pairing_codes set created_at=clock_timestamp()-interval '10 minutes', expires_at=clock_timestamp()-interval '6 minutes' where consumed_at is null");
    assert((await rows("select * from public.redeem_terminal_pairing_code($1,$2,$3)", ["d".repeat(64), "e".repeat(64), "Expired"])).length === 0,
      "Expired code rejected");
    await rejects("select private.cleanup_terminal_pairing_codes()", [], "42501");
    await db.exec("reset role;");
    await rows(`update private.terminal_pairing_codes
      set created_at=statement_timestamp()-interval '25 hours',
          expires_at=statement_timestamp()-interval '25 hours'+interval '5 minutes'
      where code_hash=$1`, [code]);
    await rows(`insert into private.terminal_pairing_codes(store_id,created_by,code_hash,created_at,expires_at)
      values ($1,$2,$3,statement_timestamp()-interval '25 hours',
        statement_timestamp()-interval '25 hours'+interval '5 minutes')`, [store, owner, "1".repeat(64)]);
    await rows(`insert into private.terminal_pairing_codes(store_id,created_by,code_hash,created_at,expires_at)
      values ($1,$2,$3,statement_timestamp()-interval '23 hours 59 minutes',
        statement_timestamp()-interval '23 hours 54 minutes')`, [store, owner, "2".repeat(64)]);
    assert(Number((await rows("select private.cleanup_terminal_pairing_codes() as n"))[0].n) === 2,
      "Cleanup deletes both consumed and unused codes older than 24 hours");
    assert((await rows("select * from private.terminal_pairing_codes")).length === 2,
      "Expired codes younger than 24 hours are retained");
    assert((await rows("select * from public.resolve_terminal_device($1)", [token])).length === 1,
      "Deleting a consumed code preserves the paired device and token");
    assert(Number((await rows("select private.cleanup_terminal_pairing_codes() as n"))[0].n) === 0,
      "Repeated cleanup is harmless");
    await db.exec("set role service_role;");
    await rows("select public.issue_terminal_pairing_code($1,$2,$3)", [owner, store, code]);
    assert((await rows("select * from public.redeem_terminal_pairing_code($1,$2,$3)", [code, "c".repeat(64), "New till"])).length === 1,
      "A deleted code hash can be issued and redeemed again");
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${other}',false); set role authenticated;`);
    assert((await rows("select * from public.terminal_devices")).length === 0, "Other owner cannot list device");
    await rejects("select public.terminal_pairing_attempt()", [], "42501");
    await rejects("select public.revoke_terminal_device($1)", [device.id], "42501");
    await rejects("select * from private.terminal_device_credentials", [], "42501");
    await rejects("select * from public.resolve_terminal_device($1)", [token], "42501");
    await rejects("select public.issue_terminal_pairing_code($1,$2,$3)", [owner, store, code], "42501");
    await db.exec(`reset role; select set_config('request.jwt.claim.sub','${owner}',false); set role authenticated;`);
    assert((await rows("select * from public.terminal_devices")).length === 2, "Owner can list own devices");
    await rejects("select private.cleanup_terminal_pairing_codes()", [], "42501");
    await rejects("update public.terminal_devices set name='Changed'", [], "42501");
    await rows("select public.revoke_terminal_device($1)", [device.id]);
    await rows("select public.revoke_terminal_device($1)", [device.id]);
    await db.exec("reset role; set role service_role;");
    assert((await rows("select * from public.resolve_terminal_device($1)", [token])).length === 0, "Revoked token rejected");
    await rejects("update public.terminal_devices set revoked_at=null where id=$1", [device.id], "22023");
    await rows("select public.issue_terminal_pairing_code($1,$2,$3)", [owner, store, "e".repeat(64)]);
    await db.exec(`reset role; update public.profiles set is_active=false where id='${owner}'; set role service_role;`);
    assert((await rows("select * from public.redeem_terminal_pairing_code($1,$2,$3)", ["e".repeat(64), "f".repeat(64), "Blocked"])).length === 0,
      "Code issuer must still be an active owner");
    await db.exec("reset role; set role anon;");
    await rejects("select * from public.terminal_devices", [], "42501");
  } finally { await db.close(); }
});
