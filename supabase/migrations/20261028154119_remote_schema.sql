SET local check_function_bodies = off;

CREATE SEQUENCE "public"."categories_id_seq" AS integer INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1 NO CYCLE;

CREATE TABLE "public"."cashiers" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "store_id"   uuid                     NOT NULL,
  "name"       text                     NOT NULL,
  "pin_hash"   text                     NOT NULL,
  "is_active"  boolean                  NOT NULL DEFAULT true,
  "created_by" uuid                     NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cashiers_name_check" CHECK (((char_length(TRIM(BOTH FROM name)) >= 1) AND (char_length(TRIM(BOTH FROM name)) <= 120))),
  CONSTRAINT "cashiers_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."cashiers"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."categories" (
  "id"         integer NOT NULL DEFAULT nextval('public.categories_id_seq'::regclass),
  "store_id"   uuid,
  "name"       text    NOT NULL,
  "sort_order" integer DEFAULT 0,
  CONSTRAINT "categories_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."categories"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."products" (
  "id"          uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "store_id"    uuid,
  "category_id" integer,
  "name"        text                     NOT NULL,
  "unit"        text                     DEFAULT 'шт'::text,
  "price"       numeric(12,2),
  "stock"       numeric(14,3)            DEFAULT 0,
  "is_active"   boolean                  DEFAULT true,
  "created_at"  timestamp with time zone DEFAULT now(),
  "updated_at"  timestamp with time zone DEFAULT now(),
  CONSTRAINT "products_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."products"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."profiles" (
  "id"         uuid                     NOT NULL,
  "full_name"  text,
  "is_active"  boolean                  DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "profiles_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."profiles"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."stock_movements" (
  "id"            uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "store_id"      uuid                     NOT NULL,
  "product_id"    uuid                     NOT NULL,
  "movement_type" text                     NOT NULL,
  "quantity"      numeric(14,3)            NOT NULL,
  "direction"     smallint                 NOT NULL,
  "price_at_time" numeric(12,2),
  "note"          text,
  "created_by"    uuid,
  "created_at"    timestamp with time zone DEFAULT now(),
  CONSTRAINT "stock_movements_direction_check" CHECK ((direction = ANY (ARRAY[1, '-1'::integer]))),
  CONSTRAINT "stock_movements_movement_type_check" CHECK ((movement_type = ANY (ARRAY['приход'::text, 'расход'::text, 'корректировка'::text]))),
  CONSTRAINT "stock_movements_pkey" PRIMARY KEY (id),
  CONSTRAINT "stock_movements_quantity_check" CHECK ((quantity > (0)::numeric))
);

ALTER TABLE "public"."stock_movements"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."store_members" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "store_id"   uuid                     NOT NULL,
  "user_id"    uuid                     NOT NULL,
  "role"       text                     NOT NULL,
  "is_active"  boolean                  DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "store_members_pkey" PRIMARY KEY (id),
  CONSTRAINT "store_members_role_check" CHECK ((role = ANY (ARRAY['owner'::text, 'cashier'::text]))),
  CONSTRAINT "store_members_store_id_user_id_key" UNIQUE (store_id, user_id)
);

ALTER TABLE "public"."store_members"
  ENABLE ROW LEVEL SECURITY;

CREATE TABLE "public"."stores" (
  "id"         uuid                     NOT NULL DEFAULT gen_random_uuid(),
  "name"       text                     NOT NULL,
  "address"    text,
  "phone"      text,
  "created_by" uuid,
  "is_active"  boolean                  DEFAULT true,
  "created_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "stores_pkey" PRIMARY KEY (id)
);

ALTER TABLE "public"."stores"
  ENABLE ROW LEVEL SECURITY;

ALTER SEQUENCE "public"."categories_id_seq" OWNED BY "public"."categories"."id";

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$begin
  insert into public.profiles (
    id,
    full_name,
    role,
    is_active
  )
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    'owner',
    true
  );

  return new;
end;$function$;

CREATE OR REPLACE FUNCTION public.is_store_owner (
  target_store_id uuid
)
  RETURNS boolean
  LANGUAGE sql
  SECURITY DEFINER
  SET search_path TO ''
  AS $function$
    SELECT EXISTS (
        SELECT 1
        FROM public.store_members AS sm
        WHERE sm.store_id = target_store_id
          AND sm.user_id = (SELECT auth.uid())
          AND sm.role = 'owner'
          AND sm.is_active = true
    );
$function$;

CREATE OR REPLACE FUNCTION public.update_product_stock()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $function$
begin
  update products
  set
    stock = stock + (new.quantity * new.direction),
    updated_at = now()
  where id = new.product_id;

  return new;
end;
$function$;

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY (category_id) REFERENCES public.categories(id);

ALTER TABLE "public"."profiles"
  ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE "public"."cashiers"
  ADD CONSTRAINT "cashiers_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE RESTRICT;

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;

ALTER TABLE "public"."store_members"
  ADD CONSTRAINT "store_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

ALTER TABLE "public"."stores"
  ADD CONSTRAINT "stores_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL;

ALTER TABLE "public"."cashiers"
  ADD CONSTRAINT "cashiers_store_id_fkey" FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE "public"."categories"
  ADD CONSTRAINT "categories_store_id_fkey" FOREIGN KEY (store_id) REFERENCES public.stores(id);

ALTER TABLE "public"."products"
  ADD CONSTRAINT "products_store_id_fkey" FOREIGN KEY (store_id) REFERENCES public.stores(id);

ALTER TABLE "public"."stock_movements"
  ADD CONSTRAINT "stock_movements_store_id_fkey" FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

ALTER TABLE "public"."store_members"
  ADD CONSTRAINT "store_members_store_id_fkey" FOREIGN KEY (store_id) REFERENCES public.stores(id) ON DELETE CASCADE;

CREATE INDEX cashiers_store_id_idx ON public.cashiers USING btree (store_id);

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER trg_update_stock
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_product_stock();

CREATE POLICY "Members can view categories" ON "public"."categories"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = categories.store_id) AND (store_members.user_id = auth.uid()) AND (store_members.is_active = true)))));

CREATE POLICY "Members can view products" ON "public"."products"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = products.store_id) AND (store_members.user_id = auth.uid()) AND (store_members.is_active = true)))));

CREATE POLICY "Owners can manage products" ON "public"."products"
  FOR ALL
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = products.store_id) AND (store_members.user_id = auth.uid()) AND (store_members.role = 'owner'::text) AND (store_members.is_active = true)))));

CREATE POLICY "Owners can view cashiers" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members sm
  WHERE ((sm.user_id = auth.uid()) AND (sm.role = 'owner'::text) AND (sm.is_active = true)))));

CREATE POLICY "Users can view own profiles" ON "public"."profiles"
  FOR SELECT
  TO PUBLIC
  USING ((id = auth.uid()));

CREATE POLICY "Members can insert movements" ON "public"."stock_movements"
  FOR INSERT
  TO PUBLIC
  WITH CHECK (((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = stock_movements.store_id) AND (store_members.user_id = auth.uid()) AND (store_members.is_active = true)))) AND (created_by = auth.uid())));

CREATE POLICY "Members can view movements" ON "public"."stock_movements"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = stock_movements.store_id) AND (store_members.user_id = auth.uid()) AND (store_members.is_active = true)))));

CREATE POLICY "Owners can manage members" ON "public"."store_members"
  FOR ALL
  TO "authenticated"
  USING ((( SELECT public.is_store_owner(store_members.store_id) AS is_store_owner) AND (ROLE = 'cashier'::text)))
  WITH CHECK ((( SELECT public.is_store_owner(store_members.store_id) AS is_store_owner) AND (role = 'cashier'::text)));

CREATE POLICY "Users can view own memberships" ON "public"."store_members"
  FOR SELECT
  TO PUBLIC
  USING ((user_id = auth.uid()));

CREATE POLICY "Members can view their stores" ON "public"."stores"
  FOR SELECT
  TO PUBLIC
  USING ((EXISTS ( SELECT 1
   FROM public.store_members
  WHERE ((store_members.store_id = stores.id) AND (store_members.user_id = auth.uid()) AND (store_members.is_active = true)))));

CREATE POLICY "Owners can insert stores" ON "public"."stores"
  FOR INSERT
  TO PUBLIC
  WITH CHECK ((created_by = auth.uid()));

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."handle_new_user"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_store_owner"(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION "public"."is_store_owner"(uuid) TO "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."is_store_owner"(uuid) FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_store_owner"(uuid) TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."is_store_owner"(uuid) TO "service_role";

GRANT EXECUTE ON FUNCTION "public"."update_product_stock"() TO PUBLIC, "anon", "authenticated";

REVOKE ALL ON FUNCTION "public"."update_product_stock"() FROM "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_product_stock"() TO "postgres";

GRANT EXECUTE ON FUNCTION "public"."update_product_stock"() TO "service_role";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."categories_id_seq" TO "anon", "authenticated";

REVOKE ALL ON SEQUENCE "public"."categories_id_seq" FROM "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."categories_id_seq" TO "postgres";

GRANT SELECT, UPDATE, USAGE ON SEQUENCE "public"."categories_id_seq" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cashiers" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."cashiers" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cashiers" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."cashiers" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categories" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."categories" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categories" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."categories" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."products" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."products" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."profiles" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."profiles" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stock_movements" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."stock_movements" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stock_movements" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stock_movements" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."store_members" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."store_members" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."store_members" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."store_members" TO "service_role";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stores" TO "anon", "authenticated";

REVOKE ALL ON TABLE "public"."stores" FROM "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stores" TO "postgres";

GRANT DELETE, INSERT, MAINTAIN, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE "public"."stores" TO "service_role";