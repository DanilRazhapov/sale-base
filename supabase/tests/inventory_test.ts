import { PGlite } from "npm:@electric-sql/pglite@0.3.14";

function assert(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

Deno.test("inventory transactions, ownership, timestamps and shift cash", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const outsider = "10000000-0000-4000-8000-000000000002";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  async function row(sql: string, params: unknown[] = []) {
    return (await db.query<Record<string, unknown>>(sql, params)).rows[0];
  }
  async function fails(sql: string, params: unknown[], code: string) {
    try { await db.query(sql, params); } catch (error) {
      assert((error as { code?: string }).code === code, `Expected SQLSTATE ${code}: ${error}`);
      return;
    }
    throw new Error(`Expected failure: ${sql}`);
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
      insert into auth.users(id) values('${owner}'), ('${outsider}');
    `);
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261028154119_remote_schema.sql", import.meta.url)));
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261029143855_store_inventory.sql", import.meta.url)));
    await db.exec(`
      insert into public.profiles(id) values('${owner}'), ('${outsider}');
      insert into public.stores(id, name, created_by) values('${store}', 'Store', '${owner}'), ('${otherStore}', 'Other', '${outsider}');
      insert into public.store_members(store_id,user_id,role) values('${store}', '${owner}', 'owner'), ('${otherStore}', '${outsider}', 'owner');
      insert into public.cashiers(id,store_id,name,pin_hash,created_by) values('${cashier}', '${store}', 'Cashier', 'test-hash', '${owner}');
      set role authenticated;
    `);
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [owner]);
    const category = await row("insert into public.categories(store_id,name) values($1, 'Food') returning id", [store]);
    const p = await row("select *, updated_at::text as updated_at from public.save_store_product($1,'Bread',$2,'шт',10,10)", [store, category.id]);
    assert(Number(p.stock) === 10, "Initial stock");
    assert((await row("select count(*) as n from public.stock_movements")).n === 1, "Initial movement");
    const shift = await row("select * from public.open_store_shift($1,$2,100)", [store, cashier]);
    await fails("select * from public.open_store_shift($1,$2,0)", [store, cashier], "23505");
    await db.query("select public.record_store_movement($1,$2,'sale',2,null,$3)", [store, p.id, shift.id]);
    assert(Number((await row("select public.store_shift_revenue($1) as revenue", [shift.id])).revenue) === 20, "Live shift revenue");
    let updated = await row("select *, updated_at::text as updated_at from public.products where id=$1", [p.id]);
    assert(Number(updated.stock) === 8, "Sale reduces stock");
    assert(String(updated.updated_at) !== String(p.updated_at), "Sale changes updated_at");
    await fails("select public.record_store_movement($1,$2,'writeoff',20)", [store, p.id], "22023");
    assert(Number((await row("select stock from public.products where id=$1", [p.id])).stock) === 8, "Failed writeoff rolls back stock");
    assert((await row("select count(*) as n from public.stock_movements")).n === 2, "Failed movement rolled back");
    await fails("select public.save_store_product($1,'Stale',$2,'шт',10,10,$3,$4)", [store, category.id, p.id, p.updated_at], "40001");
    await db.query("select public.record_store_movement($1,$2,'writeoff',3)", [store, p.id]);
    updated = await row("select *, updated_at::text as updated_at from public.products where id=$1", [p.id]);
    assert(Number(updated.stock) === 5, "Writeoff reduces stock");
    const saved = await row("select *, updated_at::text as updated_at from public.save_store_product($1,'Bread new',$2,'шт',12,8,$3,$4)", [store, category.id, p.id, updated.updated_at]);
    assert(Number(saved.stock) === 8 && Number(saved.price) === 12, "Correction and metadata saved");
    assert(String(saved.updated_at) !== String(updated.updated_at), "Edit changes updated_at");
    await fails("update public.products set stock=999 where id=$1", [p.id], "42501");
    await fails("select public.record_store_movement($1,$2,'receipt',1)", [otherStore, p.id], "42501");
    const closed = await row("select * from public.close_store_shift($1,125)", [shift.id]);
    assert(Number(closed.expected_cash) === 120, "Cash uses sale-time price and excludes writeoff/correction");
    assert(Number(closed.closing_cash) === 125, "Actual closing cash");
    await fails("select public.record_store_movement($1,$2,'sale',1,null,$3)", [store, p.id, shift.id], "22023");
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [outsider]);
    await fails("select public.save_store_product($1,'Intruder',null,'шт',1,1)", [store], "42501");
    assert((await row("select count(*) as n from public.cashier_shifts where store_id=$1", [store])).n === 0, "Other owner cannot read shifts");
    assert((await row("select count(*) as n from public.cashiers where store_id=$1", [store])).n === 0, "Other owner cannot read cashiers");
    assert(Number((await row("select public.store_shift_revenue($1) as revenue", [shift.id])).revenue) === 0, "Other owner cannot read shift revenue");
    await fails("select public.record_store_movement($1,$2,'receipt',1)", [otherStore, p.id], "22023");
  } finally { await db.close(); }
});
