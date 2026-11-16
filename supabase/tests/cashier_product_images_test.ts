import { PGlite } from "@electric-sql/pglite";

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

Deno.test("cashier snapshot includes image keys only for active products in its store", async () => {
  const db = new PGlite();
  const owner = "10000000-0000-4000-8000-000000000001";
  const store = "20000000-0000-4000-8000-000000000001";
  const otherStore = "20000000-0000-4000-8000-000000000002";
  const cashier = "30000000-0000-4000-8000-000000000001";
  const device = "40000000-0000-4000-8000-000000000001";
  const product = "50000000-0000-4000-8000-000000000001";
  const key = `stores/${store}/products/${product}/60000000-0000-4000-8000-000000000001.png`;
  const hash = "a".repeat(64);
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
    const migrations: string[] = [];
    for await (const entry of Deno.readDir(new URL("../migrations/", import.meta.url))) {
      if (entry.name.endsWith(".sql") && !entry.name.includes("schedule")) migrations.push(entry.name);
    }
    for (const name of migrations.sort()) {
      await db.exec(await Deno.readTextFile(new URL(`../migrations/${name}`, import.meta.url)));
    }
    await db.exec(`
      insert into public.profiles(id) values('${owner}');
      insert into public.stores(id,name,created_by) values
        ('${store}','One','${owner}'),('${otherStore}','Two','${owner}');
      insert into public.store_members(store_id,user_id,role) values('${store}','${owner}','owner');
      insert into public.cashiers(id,store_id,name,pin_hash,created_by)
        values('${cashier}','${store}','Cashier','test','${owner}');
      insert into public.terminal_devices(id,store_id,name,paired_by)
        values('${device}','${store}','Till','${owner}');
      insert into public.products(id,store_id,name,price,stock,unit,image_key,is_active) values
        ('${product}','${store}','Photo',10,2,'шт','${key}',true),
        ('50000000-0000-4000-8000-000000000002','${store}','No photo',20,3,'кг',null,true),
        ('50000000-0000-4000-8000-000000000003','${store}','Inactive',10,2,'шт','inactive.png',false),
        ('50000000-0000-4000-8000-000000000004','${otherStore}','Foreign',10,2,'шт','foreign.png',true);
      set role service_role;
    `);
    await db.query("select public.cashier_create_session($1,$2,$3)", [cashier, hash, device]);
    const { rows } = await db.query<{ data: { products: { id: string; image_key: string | null }[] } }>(
      "select public.cashier_tablet_snapshot($1) as data", [hash],
    );
    const products = rows[0].data.products;
    assert(products.length === 2, "Foreign and inactive products are excluded");
    assert(products.find(p => p.id === product)?.image_key === key, "Photo key is included");
    assert(products.find(p => p.id !== product)?.image_key === null, "Products without photos retain null");
    await db.exec("reset role; set role anon");
    let denied = false;
    try {
      await db.query("select public.cashier_tablet_snapshot($1)", [hash]);
    } catch (error) {
      denied = (error as { code?: string }).code === "42501";
    }
    assert(denied, "Anonymous clients cannot call snapshot RPC directly");
  } finally {
    await db.close();
  }
});
