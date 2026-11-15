import { PGlite } from "@electric-sql/pglite";
import { findCashierByPin } from "../functions/cashier-terminal/credentials.ts";

Deno.test("store-scoped login isolates identical credentials, attempts and successful resets", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const otherOwner = "10000000-0000-4000-8000-000000000002";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  const otherCashier = "30000000-0000-4000-8000-000000000002";
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
      insert into auth.users(id) values('${owner}'),('${otherOwner}');
    `);
    for (const file of ["20261028154119_remote_schema.sql", "20261029135242_create_store_with_owner.sql",
      "20261029143855_store_inventory.sql", "20261029150620_cashier_terminal_identity.sql",
      "20261029151754_cashier_name_pin_login.sql", "20261030090000_single_cashier_session.sql"]) {
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${file}`, import.meta.url)));
    }
    const salt = new Uint8Array(16).fill(7);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("1234"), "PBKDF2", false, ["deriveBits"]);
    const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, key, 256));
    const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const pinHash = `pbkdf2_sha256$310000$${hex(salt)}$${hex(bits)}`;
    await db.exec(`
      insert into public.profiles(id) values('${owner}'),('${otherOwner}');
      insert into public.stores(id,name,created_by) values
        ('${store}','One','${owner}'),('${otherStore}','Two','${otherOwner}');
      insert into public.store_members(store_id,user_id,role) values
        ('${store}','${owner}','owner'),('${otherStore}','${otherOwner}','owner');
    `);
    await rows("insert into public.cashiers(id,store_id,name,pin_hash,created_by) values($1,$2,'Alex',$3,$4),($5,$6,' alex ',$3,$7)",
      [cashier, store, pinHash, owner, otherCashier, otherStore, otherOwner]);
    await db.exec("insert into private.cashier_name_login_attempts(name,attempts) values('alex',2)");
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261115000000_store_scoped_cashier_login.sql", import.meta.url)));
    assert((await rows("select * from private.cashier_store_login_attempts where attempts=2")).length === 2, "Upgrade preserves old limits");
    await db.exec("set role service_role");
    const a = await rows("select * from public.cashier_login_attempt($1,$2)", [store, "  ALEX  "]);
    const b = await rows("select * from public.cashier_login_attempt($1,$2)", [otherStore, "alex"]);
    assert(a.length === 1 && a[0].id === cashier && b.length === 1 && b[0].id === otherCashier, "Candidates never cross shops");
    const matchA = await findCashierByPin("1234", a as { id: string; pin_hash: string }[]);
    const matchB = await findCashierByPin("1234", b as { id: string; pin_hash: string }[]);
    assert(matchA?.id === cashier && matchB?.id === otherCashier, "Identical name and PIN log into their own stores");
    for (let i = 0; i < 2; i++) await rows("select * from public.cashier_login_attempt($1,$2)", [store, "alex"]);
    assert((await rows("select * from public.cashier_login_attempt($1,$2)", [store, "alex"])).length === 0, "Sixth attempt blocked");
    assert((await rows("select * from public.cashier_login_attempt($1,$2)", [otherStore, "alex"])).length === 1, "Other store remains available");
    await rows("select public.cashier_create_session($1,$2)", [otherCashier, "a".repeat(64)]);
    assert((await rows("select attempts from private.cashier_store_login_attempts where store_id=$1", [store]))[0].attempts === 5,
      "Successful login does not reset another store");
    assert((await rows("select attempts from private.cashier_store_login_attempts where store_id=$1", [otherStore]))[0].attempts === 0,
      "Successful login resets own store");
    await rejects("select public.cashier_create_session($1,$2)", [otherCashier, "b".repeat(64)], "PT409");
    await rows("update private.cashier_store_login_attempts set window_started_at=clock_timestamp()-interval '16 minutes' where store_id=$1", [store]);
    assert((await rows("select * from public.cashier_login_attempt($1,$2)", [store, "alex"])).length === 1, "Expired budget resets");
    await db.exec(`reset role; update public.stores set is_active=false where id='${store}'; set role service_role;`);
    assert((await rows("select * from public.cashier_login_attempt($1,$2)", [store, "alex"])).length === 0, "Inactive store rejected");
    await rejects("select * from public.cashier_login_attempt('alex')", [], "42883");
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`reset role; set role ${role}`);
      await rejects("select * from public.cashier_login_attempt($1,$2)", [otherStore, "alex"], "42501");
      await rejects("select * from private.cashier_store_login_attempts", [], "42501");
    }
  } finally { await db.close(); }
});
