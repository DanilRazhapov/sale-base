import { openCashierDb } from "./localDb";
import type { LocalProduct } from "./localTypes";

export async function saveProduct(product: LocalProduct): Promise<void> {
    const db = await openCashierDb();

    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction("products", "readwrite");

        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось сохранить товар."));

        const products = tx.objectStore("products");
        products.put(product);
    });
}

export async function getProducts(storeId: string): Promise<LocalProduct[]> {
    const db = await openCashierDb();

    return new Promise<LocalProduct[]>((resolve, reject) => {
        const tx = db.transaction("products", "readonly");
        const products = tx.objectStore("products");
        const request = products.index("byStore").getAll(storeId);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("Не удалось получить товары."));
    });
}