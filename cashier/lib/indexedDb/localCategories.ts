import type { TerminalSnapshot } from "../cashierCart";
import { openCashierDb } from "./localDb";
import { withPendingStock } from "./localStock";
import type { LocalCategory, LocalOperation, LocalProduct } from "./localTypes";

const LAST_CATALOG_KEY = "lastCatalog";

type CatalogMeta = {
    key: typeof LAST_CATALOG_KEY;
    store: TerminalSnapshot["store"];
    savedAt: number;
};

export type CachedCatalog = {
    store: CatalogMeta["store"];
    savedAt: number;
    products: LocalProduct[];
    categories: LocalCategory[];
};

export async function saveCategory(category: LocalCategory): Promise<void> {
    const db = await openCashierDb();

    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("categories", "readwrite");

        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось сохранить категорию."));

        const categories = tx.objectStore("categories");
        categories.put(category);
    });
}

export async function getCategories(storeId: string): Promise<LocalCategory[]> {
    const db = await openCashierDb();

    return new Promise<LocalCategory[]>((resolve, reject) => {
        const tx = db.transaction("categories", "readonly");
        const categories = tx.objectStore("categories");
        const request = categories.index("byStore").getAll(storeId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Не удалось получить категории."));
    });
}

export async function saveCatalog(snapshot: TerminalSnapshot, confirmedIds: string[]): Promise<TerminalSnapshot> {
    const db = await openCashierDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(["products", "categories", "terminalMeta", "pendingOperations"], "readwrite");
        const products = tx.objectStore("products");
        const categories = tx.objectStore("categories"); 
        const queue = tx.objectStore("pendingOperations");
        const storeId = snapshot.store.id;
        let availableProducts = snapshot.products;

        tx.oncomplete = () => resolve({ ...snapshot, products: availableProducts });
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось сохранить каталог."));

        for (const id of confirmedIds) queue.delete(id);
        const remaining = queue.getAll();
        remaining.onsuccess = () => {
            const operations = (remaining.result as LocalOperation[]).filter((operation) => operation.store_id === storeId);
            availableProducts = withPendingStock(snapshot.products, operations);
        };

        for (const product of snapshot.products) {
            products.put({ ...product, store_id: storeId})
        }

        for (const category of snapshot.categories) {
            categories.put({ ...category, store_id: storeId})
        }

        const productKeysRequests = products.index("byStore").getAllKeys(storeId)
        const categoryKeysRequests = categories.index("byStore").getAllKeys(storeId)

        productKeysRequests.onsuccess = () => {
            for (const key of productKeysRequests.result) {
                if (!Array.isArray(key)) continue;

                const productId = key[1]
                const exists = snapshot.products.some((product) => product.id === productId)

                if (!exists) {
                    products.delete(key)
                }
            }
        }

        categoryKeysRequests.onsuccess = () => {
            for (const key of categoryKeysRequests.result) {
                if (!Array.isArray(key)) continue;

                const categoryId = key[1]
                const exists = snapshot.categories.some((category) => category.id === categoryId)

                if (!exists) {
                    categories.delete(key)
                }
            }
        };

        const meta: CatalogMeta = {
            key: LAST_CATALOG_KEY,
            store: snapshot.store,
            savedAt: Date.now(),
        };
        tx.objectStore("terminalMeta").put(meta);
    });
}

export async function readLastCatalog(storeId?: string): Promise<CachedCatalog | null> {
    const db = await openCashierDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(["terminalMeta", "products", "categories", "pendingOperations"], "readonly");
        let catalog: CachedCatalog | null = null;

        tx.oncomplete = () => resolve(catalog);
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось прочитать сохранённый каталог."));

        const metaRequest = tx.objectStore("terminalMeta").get(LAST_CATALOG_KEY);
        metaRequest.onsuccess = () => {
            const meta: CatalogMeta | undefined = metaRequest.result;
            if (!meta || (storeId !== undefined && meta.store.id !== storeId)) return;

            // Запускаем оба запроса в той же транзакции, пока она активна.
            const products = tx.objectStore("products").index("byStore").getAll(meta.store.id);
            const categories = tx.objectStore("categories").index("byStore").getAll(meta.store.id);
            const pending = tx.objectStore("pendingOperations").getAll();
            pending.onsuccess = () => {
                const operations = (pending.result as LocalOperation[]).filter(
                    (operation) => operation.store_id === meta.store.id,
                );
                catalog = {
                    store: meta.store,
                    savedAt: meta.savedAt,
                    products: withPendingStock(products.result, operations),
                    categories: categories.result,
                };
            };
        };
    });
}
