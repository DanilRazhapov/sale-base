import { PGlite } from "@electric-sql/pglite";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

type Dashboard = {
  revenue: number;
  sales_count: number;
  daily: { date: string; revenue: number }[];
  categories: { name: string; revenue: number }[];
};

Deno.test("owner dashboard: money rounding, Bishkek days, receipts and tenant isolation", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const outsider = "10000000-0000-4000-8000-000000000002";
  const store = "20000000-0000-4000-8000-000000000001";
  const second = "20000000-0000-4000-8000-000000000002";
  const foreign = "20000000-0000-4000-8000-000000000003";
  const inactive = "20000000-0000-4000-8000-000000000004";
  const product = "30000000-0000-4000-8000-000000000001";
  const uncategorized = "30000000-0000-4000-8000-000000000002";
  const otherProduct = "30000000-0000-4000-8000-000000000003";
  const foreignProduct = "30000000-0000-4000-8000-000000000004";
  const inactiveProduct = "30000000-0000-4000-8000-000000000005";
  const cashier = "40000000-0000-4000-8000-000000000001";
  const shift = "50000000-0000-4000-8000-000000000001";
  const session = "60000000-0000-4000-8000-000000000001";
  const receipt = "70000000-0000-4000-8000-000000000001";
  async function dashboard(id: string | null = null, days = 7) {
    return (await db.query<{ data: Dashboard }>(
      "select public.get_owner_dashboard($1, $2) as data", [id, days],
    )).rows[0].data;
  }
  async function rejects(sql: string, params: unknown[], code: string) {
    try { await db.query(sql, params); } catch (error) {
      assert((error as { code: string }).code === code, `Expected ${code}: ${error}`);
      return;
    }
    throw new Error(`Expected rejection: ${sql}`);
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public, auth to authenticated, anon, service_role;
      grant execute on function auth.uid() to authenticated, anon, service_role;
      insert into auth.users(id) values('${owner}'),('${outsider}');
    `);
    for (const file of [
      "20261028154119_remote_schema.sql", "20261029143855_store_inventory.sql",
      "20261029150620_cashier_terminal_identity.sql", "20261029152723_cashier_cart_checkout.sql",
      "20261115020000_owner_dashboard.sql",
    ]) await db.exec(await Deno.readTextFile(new URL(`../migrations/${file}`, import.meta.url)));
    await db.exec(`
      insert into public.profiles(id) values('${owner}'),('${outsider}');
      insert into public.stores(id,name,created_by,is_active) values
        ('${store}','One','${owner}',true),('${second}','Two','${owner}',true),
        ('${foreign}','Foreign','${outsider}',true),('${inactive}','Inactive','${owner}',false);
      insert into public.store_members(store_id,user_id,role) values
        ('${store}','${owner}','owner'),('${second}','${owner}','owner'),
        ('${foreign}','${outsider}','owner'),('${inactive}','${owner}','owner');
      insert into public.categories(id,store_id,name) values(1,'${store}','Напитки'),(2,'${second}','Напитки');
      insert into public.products(id,store_id,category_id,name,price,stock) values
        ('${product}','${store}',1,'One',999,1000),('${uncategorized}','${store}',null,'None',999,1000),
        ('${otherProduct}','${second}',2,'Two',999,1000),('${foreignProduct}','${foreign}',null,'Foreign',999,1000),
        ('${inactiveProduct}','${inactive}',null,'Inactive',999,1000);
      insert into public.cashiers(id,store_id,name,pin_hash,created_by) values('${cashier}','${store}','Cashier','test','${owner}');
      insert into private.cashier_sessions(id,cashier_id,store_id,token_hash) values('${session}','${cashier}','${store}',repeat('a',64));
      insert into public.cashier_shifts(id,store_id,cashier_id,opened_by,opening_cash)
        values('${shift}','${store}','${cashier}','${owner}',0);
      insert into public.cashier_receipts(id,store_id,cashier_id,cashier_session_id,shift_id,kind,total,request_items)
        values('${receipt}','${store}','${cashier}','${session}','${shift}','sale',20.01,'[]');
    `);
    const firstDay = (await db.query<{ day: string }>(
      "select to_char((now() at time zone 'Asia/Bishkek')::date - 6, 'YYYY-MM-DD') as day",
    )).rows[0].day;
    async function movement(storeId: string, productId: string, quantity: number, price: number | null, at: string, receiptId: string | null = null, direction = -1) {
      await db.query(`insert into public.stock_movements(store_id,product_id,quantity,price_at_time,created_at,receipt_id,direction,movement_type,created_by)
        values($1,$2,$3,$4,$5::timestamptz,$6,$7::smallint,case when $7::smallint = 1 then 'приход' else 'расход' end,$8)`,
      [storeId, productId, quantity, price, at, receiptId, direction, owner]);
    }
    await movement(store, product, 0.125, 0.04, `${firstDay}T00:00:00+06:00`, receipt);
    await movement(store, product, 2, 10, `${firstDay}T00:00:00+06:00`, receipt);
    await movement(store, uncategorized, 3, 5, `${firstDay}T23:59:59+06:00`);
    // Same UTC date, next Bishkek day.
    await db.query(`insert into public.stock_movements(store_id,product_id,quantity,price_at_time,created_at,direction,movement_type,created_by)
      values($1,$2,1,7,$3::timestamptz + interval '1 day',-1,'расход',$4)`, [second, otherProduct, `${firstDay}T00:00:00+06:00`, owner]);
    await movement(foreign, foreignProduct, 1, 1000, `${firstDay}T12:00:00+06:00`);
    await movement(inactive, inactiveProduct, 1, 1000, `${firstDay}T12:00:00+06:00`);
    await movement(store, product, 1, null, `${firstDay}T12:00:00+06:00`); // writeoff
    await movement(store, product, 1, 1000, `${firstDay}T12:00:00+06:00`, null, 1); // receipt
    await db.query(`insert into public.stock_movements(store_id,product_id,quantity,price_at_time,created_at,direction,movement_type,created_by)
      values($1,$2,1,500,$3::timestamptz - interval '1 second',-1,'расход',$4),
            ($1,$2,1,500,now() + interval '1 day',-1,'расход',$4)`, [store, product, `${firstDay}T00:00:00+06:00`, owner]);

    await db.exec("set role authenticated");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const all = await dashboard();
    assert(all.revenue === 42.01, "Historical line prices, rounding, excluded writeoff/receipt/out-of-range/foreign/inactive rows");
    assert(all.sales_count === 3, "Two receipt lines count once, legacy movements separately");
    assert(all.daily.length === 7 && all.daily[0].date === firstDay, "Complete seven-day calendar");
    assert(all.daily[0].revenue === 35.01 && all.daily[1].revenue === 7 && all.daily[2].revenue === 0, "Bishkek boundaries and zero days");
    assert(all.categories[0].name === "Напитки" && all.categories[0].revenue === 27.01, "Same named categories across stores combine");
    assert(all.categories[1].name === "Без категории" && all.categories[1].revenue === 15, "Missing categories preserved");
    assert((await dashboard(store)).revenue === 35.01, "Single store filter");
    assert((await dashboard(null, 30)).daily.length === 30 && (await dashboard(null, 90)).daily.length === 90, "Supported periods");
    await rejects("select public.get_owner_dashboard($1,7)", [foreign], "42501");
    await rejects("select public.get_owner_dashboard($1,7)", [inactive], "42501");
    await rejects("select public.get_owner_dashboard(null,365)", [], "22023");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [outsider]);
    assert((await dashboard()).revenue === 1000, "Another owner sees only own store");
    await rejects("select public.get_owner_dashboard($1,7)", [store], "42501");
    await db.exec(`reset role; update public.store_members set is_active=false where user_id='${owner}'; set role authenticated;`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const empty = await dashboard();
    assert(empty.revenue === 0 && empty.sales_count === 0 && empty.categories.length === 0, "Revoked memberships yield empty aggregate");
    await db.exec("set role anon");
    await rejects("select public.get_owner_dashboard()", [], "42501");
  } finally { await db.close(); }
});
