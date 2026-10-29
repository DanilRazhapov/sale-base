import { PGlite } from "npm:@electric-sql/pglite@0.3.14";
function assert(value: unknown, label: string): asserts value { if (!value) throw new Error(label); }

Deno.test("baseline and upgraded signup triggers create profiles under Auth privileges", async () => {
  const db = new PGlite();
  const id = "10000000-0000-4000-8000-000000000001";
  const secondId = "10000000-0000-4000-8000-000000000002";
  const baselineId = "10000000-0000-4000-8000-000000000003";
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create role supabase_auth_admin;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb);
      create function auth.uid() returns uuid language sql stable as
        $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    `);
    await db.exec(await Deno.readTextFile(new URL("../migrations/20261028154119_remote_schema.sql", import.meta.url)));
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [baselineId, { full_name: "Baseline owner" }]);
    assert((await db.query("select id from public.profiles where id=$1", [baselineId])).rows.length === 1, "Clean install creates a profile without requiring the repair migration");

    await db.exec(await Deno.readTextFile(new URL("../migrations/20261029175531_fix_signup_profile_trigger.sql", import.meta.url)));
    await db.exec(`grant usage on schema auth to supabase_auth_admin;
      grant insert,select on auth.users to supabase_auth_admin;
      set role supabase_auth_admin;`);
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2)", [id, { full_name: "  Test owner  ", role: "owner", is_active: false }]);
    await db.query("insert into auth.users(id,raw_user_meta_data) values($1,null)", [secondId]);
    let denied = false;
    try { await db.query("insert into public.profiles(id) values($1)", [id]); }
    catch (error) { denied = (error as { code?: string }).code === "42501"; }
    assert(denied, "Auth role cannot insert profiles directly; trigger uses its definer");
    await db.exec("reset role;");
    const profiles = (await db.query<{ id: string; full_name: string | null; is_active: boolean }>("select id,full_name,is_active from public.profiles where id in ($1,$2) order by id", [id, secondId])).rows;
    assert(profiles.length === 2, "Exactly one profile per successful signup");
    assert(profiles[0].full_name === "Test owner" && profiles[0].is_active === true, "Name trimmed and active status set by server");
    assert(profiles[1].full_name === null && profiles[1].is_active === true, "Missing metadata does not block signup");
    assert((await db.query("select * from public.store_members")).rows.length === 0, "Signup never grants store ownership from metadata");
  } finally { await db.close(); }
});
