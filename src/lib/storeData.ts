import { supabase } from "./supabase";
import type { Category, Product, Store } from "../components/store/types";

export function isStoreId(value: string | undefined): value is string {
    return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export const storeErrorMessage = (error: unknown) =>
    error && typeof error === "object" && "message" in error
        ? String(error.message)
        : "Не удалось выполнить запрос. Проверьте подключение.";

export async function requireStoreOwner(storeId: string) {
    const {
        data: { user },
        error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Войдите в аккаунт снова.");

    const { data: membership, error } = await supabase
        .from("store_members")
        .select("id")
        .eq("store_id", storeId)
        .eq("user_id", user.id)
        .eq("role", "owner")
        .eq("is_active", true)
        .maybeSingle();
    if (error) throw error;
    if (!membership) throw new Error("Магазин не найден или у вас нет прав владельца.");
}

export async function readAllStoreRows<T>(table: string, columns: string, storeId: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 500) {
        const { data, error } = await supabase
            .from(table)
            .select(columns)
            .eq("store_id", storeId)
            .order("id")
            .range(from, from + 499);
        if (error) throw error;
        rows.push(...(data as unknown as T[]));
        if (data.length < 500) return rows;
    }
}

export async function readStoreCatalog(storeId: string) {
    const [storeResult, categories, products] = await Promise.all([
        supabase.from("stores").select("id, name, address").eq("id", storeId).single(),
        readAllStoreRows<Category>("categories", "id, name", storeId),
        readAllStoreRows<Product>(
            "products",
            "id, name, category_id, unit, price, stock, updated_at, is_active",
            storeId,
        ),
    ]);
    if (storeResult.error) throw storeResult.error;
    return {
        store: storeResult.data as Store,
        categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
        products: products
            .filter((product) => product.is_active !== false)
            .sort((a, b) => a.name.localeCompare(b.name)),
    };
}
