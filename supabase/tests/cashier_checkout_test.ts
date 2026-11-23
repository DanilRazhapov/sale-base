import { PGlite } from "@electric-sql/pglite";
import { lineCents, quantityMilli } from "../../cashier/lib/cashierCart.ts";
import { hashToken } from "../functions/_shared/tokens.ts";
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }

Deno.test("weighted cart quantities and money rounding", () => {
  assert(quantityMilli("0,125") === 125, "Comma decimal input");
  assert(quantityMilli("2.5") === 2500, "Fractional quantity");
  assert(quantityMilli("0") === null && quantityMilli("-1") === null && quantityMilli("1.0001") === null && quantityMilli("") === null, "Invalid quantities");
  assert(lineCents({ price: 0.04, quantity: "0.125" }) === 1n, "Half cent rounds like Postgres numeric");
  assert(lineCents({ price: 10.01, quantity: "2.5" }) === 2503n, "Fractional line rounds once");
});

Deno.test("cart checkout: atomicity, prices, cashier attribution and idempotent retries", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  const secondCashier = "30000000-0000-4000-8000-000000000002";
  const device = "31000000-0000-4000-8000-000000000001";
  const first = "40000000-0000-4000-8000-000000000001";
  const second = "40000000-0000-4000-8000-000000000002";
  const foreign = "40000000-0000-4000-8000-000000000003";
  const request = "50000000-0000-4000-8000-000000000001";
  const hash = "a".repeat(64);
  const otherHash = "b".repeat(64);
  async function row(sql: string, args: unknown[] = []) { return (await db.query<Record<string, unknown>>(sql, args)).rows[0]; }
  async function fails(sql: string, args: unknown[], code: string) {
    try { await db.query(sql, args); } catch (error) { assert((error as { code?: string }).code === code, `Expected ${code}: ${error}`); return; }
    throw new Error(`Expected rejection: ${sql}`);
  }
  const checkout = "select * from public.cashier_checkout($1,$2,$3::jsonb,$4)";
  const checkoutForShift = "select * from public.cashier_checkout_for_shift($1,$2,$3::jsonb,$4,$5)";
  const items = [{ product_id: first, quantity: 0.125, expected_price: 0.04 }, { product_id: second, quantity: 2, expected_price: 10 }];
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;
      insert into auth.users(id) values('${owner}');
    `);
    await db.exec(await Deno.readTextFile(new URL("./realtime_fixture.sql", import.meta.url)));
    const migrations: string[] = [];
    for await (const entry of Deno.readDir(new URL("../migrations/", import.meta.url))) if (entry.name.endsWith(".sql")) migrations.push(entry.name);
    for (const name of migrations.sort()) {
      // PGlite has no background workers/pg_cron; exercise the scheduled function
      // directly in cashier_terminal_test instead. Apply all business migrations.
      if (name.includes("schedule")) continue;
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${name}`, import.meta.url)));
    }
    await db.exec(`
      insert into public.profiles(id) values('${owner}');
      insert into public.stores(id,name,created_by) values('${store}','Store','${owner}'),('${otherStore}','Other','${owner}');
      insert into public.store_members(store_id,user_id,role) values('${store}','${owner}','owner');
      insert into public.cashiers(id,store_id,name,pin_hash,created_by) values
        ('${cashier}','${store}','First','test','${owner}'),('${secondCashier}','${store}','Second','test','${owner}');
      insert into public.terminal_devices(id,store_id,name,paired_by)
        values ('${device}','${store}','Till','${owner}');
      insert into public.categories(id,store_id,name) values(1,'${store}','Food'),(2,'${otherStore}','Other');
      insert into public.products(id,store_id,category_id,name,price,stock,unit) values
        ('${first}','${store}',1,'Weighted',0.04,10,'кг'),('${second}','${store}',1,'Bread',10,5,'шт'),
        ('${foreign}','${otherStore}',2,'Foreign',10,5,'шт');
      set role service_role;
    `);
    await db.query("select public.cashier_create_session($1,$2,$3)", [cashier, hash, device]);
    await db.query("select public.cashier_create_session($1,$2,$3)", [secondCashier, otherHash, device]);
    const shift = await row("select * from public.cashier_open_shift($1,100)", [hash]);
    const snapshot = (await row("select public.cashier_tablet_snapshot($1) as data", [hash])).data as { categories: unknown[]; products: { category_id: number }[] };
    assert(snapshot.categories.length === 1 && snapshot.products.length === 2 && snapshot.products[0].category_id === 1, "Only own categories and categorized products");
    await fails(checkout, [otherHash, request, JSON.stringify(items), "sale"], "42501");
    await fails(checkout, [hash, request, JSON.stringify([...items, { product_id: foreign, quantity: 1, expected_price: 10 }]), "sale"], "22023");
    await fails(checkout, [hash, request, JSON.stringify([items[0], { ...items[1], quantity: 999 }]), "sale"], "22023");
    await fails(checkout, [hash, request, JSON.stringify([items[0], { ...items[1], expected_price: 9 }]), "sale"], "22023");
    await fails(checkout, [hash, request, JSON.stringify([items[0], items[0]]), "sale"], "22023");
    assert((await row("select count(*) as n from public.cashier_receipts")).n === 0, "Rejected carts create no receipt");
    // Force a failure after the first product was already sold to verify a full rollback.
    await db.exec("reset role;");
    await db.exec(`create function public.fail_cart_test() returns trigger language plpgsql as $$ begin
      if new.id = '${second}' then raise exception 'Injected second-line failure'; end if; return new; end $$;
      create trigger fail_cart_test before update on public.products for each row execute function public.fail_cart_test();
      set role service_role;`);
    await fails(checkout, [hash, request, JSON.stringify(items), "sale"], "P0001");
    assert(Number((await row("select stock from public.products where id=$1", [first])).stock) === 10, "First line stock rolled back");
    assert((await row("select count(*) as n from public.stock_movements")).n === 0 && (await row("select count(*) as n from public.cashier_receipts")).n === 0, "Entire receipt and its movements rolled back");
    await db.exec("reset role; drop trigger fail_cart_test on public.products; drop function public.fail_cart_test(); set role service_role;");
    const receipt = await row(checkout, [hash, request, JSON.stringify(items), "sale"]);
    assert(Number(receipt.total) === 20.01 && receipt.cashier_id === cashier, "Exact total and cashier");
    assert(Number((await row("select stock from public.products where id=$1", [first])).stock) === 9.875, "Fractional stock deducted");
    assert(Number((await row("select stock from public.products where id=$1", [second])).stock) === 3, "Second line deducted");
    assert((await row("select count(*) as n from public.stock_movements where receipt_id=$1 and cashier_id=$2 and shift_id=$3", [request, cashier, shift.id])).n === 2, "Every sale line has cashier, shift and receipt");
    await row(checkout, [hash, request, JSON.stringify(items), "sale"]);
    assert((await row("select count(*) as n from public.stock_movements")).n === 2, "Retry does not sell twice");
    await fails(checkout, [hash, request, JSON.stringify([items[0]]), "sale"], "22023");
    await row(checkout, [hash, "50000000-0000-4000-8000-000000000002", JSON.stringify([{ product_id: first, quantity: 1 }]), "receipt"]);
    await row(checkout, [hash, "50000000-0000-4000-8000-000000000003", JSON.stringify([{ product_id: second, quantity: 1 }]), "writeoff"]);
    const closed = await row("select * from public.cashier_close_shift($1,$2,120.01)", [hash, shift.id]);
    assert(Number(closed.expected_cash) === 120.01, "Receipts and writeoffs do not increase cash");
    await row(checkout, [hash, request, JSON.stringify(items), "sale"]);
    assert((await row("select count(*) as n from public.cashier_receipts")).n === 3, "Retry succeeds even after closing without creating a new receipt");
    await db.exec("reset role; set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    assert((await row("select count(*) as n from public.cashier_receipts")).n === 3, "Owner can read receipts");
    await fails(checkout, [hash, request, JSON.stringify(items), "sale"], "42501");
    await db.exec("reset role; set role service_role;");
    const overdue = await row("select * from public.cashier_open_shift($1,0)", [hash]);
    await db.exec("reset role;");
    await db.query("update public.cashier_shifts set opened_at=clock_timestamp()-interval '12 hours 1 second' where id=$1", [overdue.id]);
    await db.exec("set role service_role;");
    const stockBefore = (await row("select stock from public.products where id=$1", [first])).stock;
    await fails(checkout, [hash, "50000000-0000-4000-8000-000000000004", JSON.stringify(items), "sale"], "42501");
    assert((await row("select stock from public.products where id=$1", [first])).stock === stockBefore, "Expired shift cannot sell stock");
    assert((await row("select count(*) as n from public.cashier_receipts")).n === 3, "Expired checkout creates no receipt");
    // A snapshot commits the cleanup even after a rejected checkout rolled back.
    await row("select public.cashier_tablet_snapshot($1)", [hash]);
    assert((await row("select automatically_closed from public.cashier_shifts where id=$1", [overdue.id])).automatically_closed, "Overdue checkout shift subsequently closes");

    const offlineShift = await row("select * from public.cashier_open_shift($1,0)", [hash]);
    type HistoricalSnapshot = {
      products: { id: string; price_version_id: string }[];
      movements: { receipt_id: string; sold_at_previous_price: boolean; catalog_price_at_sync: number }[];
      shift: { revenue: number };
    };
    const savedCatalog = (await row("select public.cashier_tablet_snapshot($1) as data", [hash])).data as HistoricalSnapshot;
    const priceVersion = savedCatalog.products.find((product) => product.id === second)?.price_version_id;
    assert(priceVersion, "The catalog includes a server-issued price version");
    await db.exec("reset role;");
    assert((await row("select count(*) as n from realtime.messages")).n === 0, "Stock changes do not broadcast price updates");
    await db.query("update public.products set price = 11 where id=$1", [foreign]);
    assert((await row("select count(*) as n from realtime.messages")).n === 0, "Other store changes do not notify these sessions");
    await db.query("update public.products set price = 12 where id=$1", [second]);
    const topic = `cashier-prices:${await hashToken(`cashier-prices:${hash}`)}`;
    const message = await row("select * from realtime.messages where topic=$1", [topic]);
    assert(message?.private === true && message.event === "price_changed" &&
      JSON.stringify(message.payload) === "{}", "Price changes send a private, empty notification");
    assert((await row("select count(*) as n from realtime.messages")).n === 2, "Every active session in the store is notified");
    await db.exec("set role anon;");
    await db.query("select set_config('realtime.topic',$1,false)", ["cashier-prices:unknown"]);
    assert((await row("select count(*) as n from realtime.messages")).n === 0, "Unknown topics cannot receive notifications");
    await db.query("select set_config('realtime.topic',$1,false)", [topic]);
    assert(await row("select 1 from realtime.messages where topic=$1", [topic]), "The terminal can receive on its topic");
    assert((await row("select count(*) as n from realtime.messages")).n === 1, "The terminal cannot receive another session's message");
    await fails("select realtime.send('{}','price_changed',$1,true)", [topic], "42501");
    await db.exec("reset role;");
    await db.exec("set role service_role;");

    const offlineId = "50000000-0000-4000-8000-000000000005";
    const offlineItem = { product_id: second, quantity: 1.5, expected_price: 10, price_version_id: priceVersion };
    const submit = (item: typeof offlineItem) => [hash, offlineId, JSON.stringify([item]), "sale", offlineShift.id];
    await fails(checkoutForShift, submit({ ...offlineItem, price_version_id: "invalid" }), "22023");
    await fails(checkoutForShift, submit({ ...offlineItem, expected_price: 9 }), "22023");
    await fails(checkoutForShift, submit({ ...offlineItem, product_id: first }), "22023");
    const offlineReceipt = await row(checkoutForShift, submit(offlineItem));
    assert(Number(offlineReceipt.total) === 15, "Offline receipt keeps the confirmed previous price");
    await row(checkoutForShift, submit(offlineItem));
    assert(Number((await row("select stock from public.products where id=$1", [second])).stock) === 0.5, "Retry deducts stock once");
    const movement = await row("select * from public.stock_movements where receipt_id=$1", [offlineId]);
    assert(movement.sold_at_previous_price === true, "The receipt movement records the old price");
    assert(Number(movement.price_at_time) === 10 && Number(movement.catalog_price_at_sync) === 12, "The movement keeps both prices");
    const updated = (await row("select public.cashier_tablet_snapshot($1) as data", [hash])).data as HistoricalSnapshot;
    assert(Number(updated.shift.revenue) === 15, "Shift revenue reflects the amount received");
    assert(updated.movements.some((item) => item.receipt_id === offlineId && item.sold_at_previous_price && item.catalog_price_at_sync === 12), "POS history includes the price difference");
    assert(updated.products.find((product) => product.id === second)?.price_version_id !== priceVersion, "Updated catalog has a new price version");

    await row("select * from public.cashier_close_shift($1,$2,15)", [hash, offlineShift.id]);
    const nextShift = await row("select * from public.cashier_open_shift($1,0)", [hash]);
    await fails(checkoutForShift, [
      hash, "50000000-0000-4000-8000-000000000006",
      JSON.stringify([{ ...offlineItem, quantity: 0.5 }]), "sale", nextShift.id,
    ], "22023");

    await db.exec("reset role;");
    await db.query("update public.products set price = 13 where id=$1", [second]);
    await db.exec("set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
    const ownerMovement = await row("select * from public.stock_movements where receipt_id=$1", [offlineId]);
    assert(Number(ownerMovement.catalog_price_at_sync) === 12, "Owner history retains the price at checkout after another price change");
    const summary = (await row("select public.get_owner_dashboard($1, 7) as data", [store])).data as { revenue: number };
    assert(Number(summary.revenue) === 35.01, "Owner dashboard reports revenue at the prices paid");
    await db.exec("reset role; set role service_role;");
    await db.query("select public.cashier_logout($1)", [hash]);
    await db.exec("reset role;");
    await db.query("update public.products set price = 14 where id=$1", [second]);
    assert((await row("select count(*) as n from realtime.messages where topic=$1", [topic])).n === 2,
      "A revoked session stops receiving new messages");
    await db.exec("set role anon;");
    assert(!(await row("select 1 from realtime.messages where topic=$1", [topic])), "A revoked session cannot rejoin");
  } finally { await db.close(); }
});
