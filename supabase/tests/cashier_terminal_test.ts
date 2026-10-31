import { PGlite } from "@electric-sql/pglite";
import { createToken, findCashierByPin, hashToken, verifyPin } from "../functions/cashier-terminal/credentials.ts";

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

Deno.test("cashier PIN compatibility and random session tokens", async () => {
  const salt = new Uint8Array(16).fill(7);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode("1234"), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 310000 }, key, 256));
  const hex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  const stored = `pbkdf2_sha256$310000$${hex(salt)}$${hex(bits)}`;
  assert(await verifyPin("1234", stored), "Existing PIN format accepted");
  assert(!(await verifyPin("4321", stored)), "Wrong PIN rejected");
  assert(!(await verifyPin("1234", "broken")), "Malformed hash rejected");
  const candidates = [{ id: "first", pin_hash: stored }, { id: "second", pin_hash: "broken" }];
  assert((await findCashierByPin("1234", candidates))?.id === "first", "Name candidates identified by correct PIN");
  assert(await findCashierByPin("4321", candidates) === null, "Incorrect PIN never selects an account");
  assert(await findCashierByPin("1234", [{ id: "first", pin_hash: stored }, { id: "other", pin_hash: stored }]) === null, "Ambiguous name/PIN never selects the wrong store");
  const token = createToken();
  assert(/^[0-9a-f]{64}$/.test(token) && token !== createToken(), "Random 256-bit session");
  assert((await hashToken(token)) !== token, "Only session hash stored");
});

Deno.test("terminal identity, permissions, all movement authors, shift ownership and revocation", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  const secondCashier = "30000000-0000-4000-8000-000000000002";
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  const thirdHash = "c".repeat(64);
  async function row(sql: string, args: unknown[] = []) {
    return (await db.query<Record<string, unknown>>(sql, args)).rows[0];
  }
  async function fails(sql: string, args: unknown[], code: string) {
    try { await db.query(sql, args); } catch (error) {
      assert((error as { code?: string }).code === code, `Expected ${code}: ${error}`); return;
    }
    throw new Error(`Expected rejection: ${sql}`);
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      insert into auth.users(id) values('${owner}');
    `);
    for (const name of ["20261028154119_remote_schema.sql", "20261029135242_create_store_with_owner.sql",
      "20261029143855_store_inventory.sql", "20261029150620_cashier_terminal_identity.sql", "20261029151754_cashier_name_pin_login.sql"]) {
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${name}`, import.meta.url)));
    }
    await db.exec(`
      insert into public.profiles(id) values('${owner}');
      insert into public.stores(id,name,created_by) values('${store}','Store','${owner}'),('${otherStore}','Other','${owner}');
      insert into public.store_members(store_id,user_id,role) values('${store}','${owner}','owner'),('${otherStore}','${owner}','owner');
      insert into public.cashiers(id,store_id,name,pin_hash,created_by) values
        ('${cashier}','${store}','First','test','${owner}'),
        ('${secondCashier}','${store}','Second','test','${owner}');
      set role authenticated;
    `);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const product = await row("select * from public.save_store_product($1,'Bread',null,'шт',10,10)", [store]);
    const foreignProduct = await row("select * from public.save_store_product($1,'Other product',null,'шт',10,10)", [otherStore]);
    await fails("select public.cashier_open_shift($1,100)", [hash], "42501");
    await fails("select private.open_store_shift($1,$2,100)", [store, cashier], "42501");
    await fails("select public.cashier_create_session($1,$2)", [cashier, hash], "42501");
    await fails("select public.record_store_movement($1,$2,'sale',1)", [store, product.id], "42501");
    const ownerMovement = await row("select * from public.record_store_movement($1,$2,'receipt',1)", [store, product.id]);
    assert(ownerMovement.created_by === owner && ownerMovement.cashier_id === null, "Owner action remains owner action");
    await db.exec("reset role; set role service_role;");
    await fails("insert into public.stock_movements(store_id,product_id,movement_type,quantity,direction) values($1,$2,'приход',1,1)", [store, product.id], "23514");
    for (let i = 0; i < 5; i++) assert((await row("select id from public.cashier_login_attempt('  FIRST  ')")).id === cashier, "Name login ignores case and surrounding spaces");
    assert((await row("select count(*) as n from public.cashier_login_attempt('first')")).n === 0, "Sixth login attempt blocked");
    assert((await row("select id from public.cashier_login_attempt('second')")).id === secondCashier, "Other name remains available");
    await db.query("select public.cashier_create_session($1,$2)", [cashier, hash]);
    await db.query("select public.cashier_create_session($1,$2)", [secondCashier, otherHash]);
    const shift = await row("select * from public.cashier_open_shift($1,100)", [hash]);
    // Upgrade a database that already has duplicate sessions: keep the open shift's token.
    const duplicateHash = "e".repeat(64);
    await db.query("select public.cashier_create_session($1,$2)", [cashier, duplicateHash]);
    await db.exec("reset role;");
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261030090000_single_cashier_session.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261031010000_cashier_shift_lifecycle.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261031000000_owner_catalog_actions.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261031020000_close_shift_on_cashier_block.sql", import.meta.url)));
    await db.exec("set role service_role;");
    await fails("select public.cashier_tablet_snapshot($1)", [duplicateHash], "28000");
    await fails("select public.cashier_create_session($1,$2)", [cashier, "f".repeat(64)], "PT409");
    const stillActive = (await row("select public.cashier_tablet_snapshot($1) as data", [hash])).data as Record<string, unknown>;
    assert(!!stillActive.shift, "Rejected login leaves the original session and shift usable");
    assert(shift.cashier_id === cashier && shift.opened_by === null && !!shift.opened_session_id, "Cashier session opens shift");
    await fails("select public.cashier_open_shift($1,0)", [otherHash], "23505");
    for (const kind of ["sale", "receipt", "writeoff"]) {
      const movement = await row("select * from public.cashier_record_movement($1,$2,$3,1)", [hash, product.id, kind]);
      assert(movement.cashier_id === cashier && movement.created_by === null && !!movement.cashier_session_id, `Actor captured for ${kind}`);
      assert(movement.shift_id === shift.id, `Shift captured for ${kind}`);
    }
    await fails("select public.cashier_record_movement($1,$2,'sale',1)", [otherHash, product.id], "42501");
    await fails("select public.cashier_close_shift($1,$2,110)", [otherHash, shift.id], "42501");
    await fails("select public.cashier_record_movement($1,$2,'receipt',1)", [hash, foreignProduct.id], "22023");
    await fails("select public.cashier_record_movement($1,$2,'writeoff',999)", [hash, product.id], "22023");
    const snapshot = (await row("select public.cashier_tablet_snapshot($1) as data", [hash])).data as Record<string, unknown>;
    assert(!JSON.stringify(snapshot).includes("pin_hash") && !JSON.stringify(snapshot).includes("token_hash"), "Snapshot excludes credentials");
    const closed = await row("select * from public.cashier_close_shift($1,$2,110)", [hash, shift.id]);
    assert(Number(closed.expected_cash) === 110, "Only sale affects shift revenue");
    await fails("select public.cashier_record_movement($1,$2,'receipt',1)", [hash, product.id], "42501");
    await db.query("select public.cashier_logout($1)", [hash]);
    await fails("select public.cashier_tablet_snapshot($1)", [hash], "28000");
    await fails("select public.cashier_tablet_snapshot($1)", ["d".repeat(64)], "28000");
    await db.query("select public.cashier_create_session($1,$2)", [cashier, thirdHash]);
    await fails("select public.cashier_create_session($1,$2)", [cashier, "f".repeat(64)], "PT409");
    await db.exec("reset role;");
    await db.query("update private.cashier_sessions set expires_at=clock_timestamp()-interval '1 second' where token_hash=$1", [thirdHash]);
    await db.exec("set role service_role;");
    const contenders = ["f".repeat(64), "9".repeat(64)];
    const results = await Promise.allSettled(contenders.map(token => db.query("select public.cashier_create_session($1,$2)", [cashier, token])));
    assert(results.filter(result => result.status === "fulfilled").length === 1, "Only one competing login succeeds");
    const rejected = results.find(result => result.status === "rejected") as PromiseRejectedResult;
    assert(rejected.reason.code === "PT409", "Competing login reports occupied account");
    await fails("select public.cashier_tablet_snapshot($1)", [thirdHash], "28000");
    const currentHash = contenders[results.findIndex(result => result.status === "fulfilled")];
    assert((await row("select count(*) as n from private.cashier_sessions where cashier_id=$1 and revoked_at is null", [cashier])).n === 1, "Expired token retired before issuing replacement");
    await db.exec("reset role;");
    await db.query("update public.cashiers set is_active=false where id=$1", [cashier]);
    await db.exec("set role service_role;");
    await fails("select public.cashier_open_shift($1,0)", [currentHash], "28000");
    // Blocking permanently revokes the token and closes the shift. Unblocking
    // permits a fresh login and opening a new shift.
    await db.exec("reset role;");
    await db.query("update public.cashiers set is_active=true where id=$1", [cashier]);
    await db.exec("set role service_role;");
    await fails("select public.cashier_tablet_snapshot($1)", [currentHash], "28000");
    const resumeHash = "1".repeat(64);
    await db.query("select public.cashier_create_session($1,$2)", [cashier, resumeHash]);
    const resumedShift = await row("select * from public.cashier_open_shift($1,50)", [resumeHash]);
    await db.query("select public.cashier_record_movement($1,$2,'sale',1)", [resumeHash, product.id]);
    await db.exec("reset role; set role authenticated;");
    await db.query("select public.set_store_cashier_active($1,$2,false)", [store, cashier]);
    const blockedShift = await row("select * from public.cashier_shifts where id=$1", [resumedShift.id]);
    assert(blockedShift.closed_at && blockedShift.automatically_closed, "Owner blocking immediately closes shift");
    assert(blockedShift.closing_cash === null && Number(blockedShift.expected_cash) === 60, "Blocked shift retains sales total without inventing counted cash");
    await db.query("select public.set_store_cashier_active($1,$2,false)", [store, cashier]);
    assert(String((await row("select closed_at from public.cashier_shifts where id=$1", [resumedShift.id])).closed_at) === String(blockedShift.closed_at), "Repeated blocking preserves closed shift");
    await db.exec("reset role; set role service_role;");
    await fails("select public.cashier_record_movement($1,$2,'sale',1)", [resumeHash, product.id], "28000");
    const otherShift = await row("select * from public.cashier_open_shift($1,0)", [otherHash]);
    await db.query("select public.cashier_close_shift($1,$2,0)", [otherHash, otherShift.id]);
    await db.exec("reset role; set role authenticated;");
    await db.query("select public.set_store_cashier_active($1,$2,true)", [store, cashier]);
    await db.exec("set role service_role;");
    await fails("select public.cashier_tablet_snapshot($1)", [resumeHash], "28000");
    const replacementHash = "2".repeat(64);
    await db.query("select public.cashier_create_session($1,$2)", [cashier, replacementHash]);
    const resumed = (await row("select public.cashier_tablet_snapshot($1) as data", [replacementHash])).data as { shift: unknown };
    assert(resumed.shift === null, "Unblocking does not reopen the closed shift");

    const expiredShift = await row("select * from public.cashier_open_shift($1,100)", [replacementHash]);
    await db.query("select public.cashier_record_movement($1,$2,'sale',1)", [replacementHash, product.id]);
    await db.query("select public.cashier_record_movement($1,$2,'receipt',1)", [replacementHash, product.id]);
    await db.exec("reset role;");
    await db.query("update public.cashier_shifts set opened_at=clock_timestamp()-interval '12 hours 1 second' where id=$1", [expiredShift.id]);
    // Simulate cron without any active cashier session or browser.
    await db.query("select public.cashier_logout($1)", [replacementHash]);
    await db.query("select private.close_expired_cashier_shifts()");
    const automatic = await row("select *, closed_at = opened_at + interval '12 hours' as deadline from public.cashier_shifts where id=$1", [expiredShift.id]);
    assert(automatic.automatically_closed && automatic.deadline, "Idle shift closed at its exact deadline");
    assert(automatic.closing_cash === null && Number(automatic.expected_cash) === 110, "Automatic close calculates sales but never fabricates counted cash");
    await db.query("select private.close_expired_cashier_shifts()");
    assert(String((await row("select closed_at from public.cashier_shifts where id=$1", [expiredShift.id])).closed_at) === String(automatic.closed_at), "Repeated cleanup leaves closure unchanged");
    await db.exec("set role service_role;");
    const finalHash = "3".repeat(64);
    await db.query("select public.cashier_logout($1)", [otherHash]);
    await db.query("select public.cashier_create_session($1,$2)", [secondCashier, finalHash]);
    const nextShift = await row("select * from public.cashier_open_shift($1,0)", [finalHash]);
    await db.query("select private.close_expired_cashier_shifts()");
    assert((await row("select closed_at from public.cashier_shifts where id=$1", [nextShift.id])).closed_at === null, "Fresh shift stays open");
    await db.exec("reset role;");
    await db.query("update public.cashier_shifts set opened_at=clock_timestamp()-interval '12 hours 1 second' where id=$1", [nextShift.id]);
    await db.exec("set role service_role;");
    const afterDeadline = (await row("select public.cashier_tablet_snapshot($1) as data", [finalHash])).data as { shift: unknown };
    assert(afterDeadline.shift === null, "Snapshot closes an overdue shift before cron runs");
    await fails("select public.cashier_record_movement($1,$2,'sale',1)", [finalHash, product.id], "42501");
    await db.exec("reset role; set role anon;");
    await fails("select private.close_expired_cashier_shifts()", [], "42501");
    await fails("select public.cashier_tablet_snapshot($1)", [otherHash], "42501");
  } finally { await db.close(); }
});
