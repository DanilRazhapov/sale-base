import { openCashierDb } from "./localDb";
import { withPendingStock } from "./localStock";
import type { LocalOperation, LocalProduct } from "./localTypes";
import { shiftDeadline, type LocalShift, type Shift } from "./localShifts";

export async function enqueueOperation(operation: LocalOperation, shift: Shift): Promise<LocalProduct[]> {
    const db = await openCashierDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction(["products", "pendingOperations", "shifts"], "readwrite");
        const queue = tx.objectStore("pendingOperations");
        const products = tx.objectStore("products").index("byStore").getAll(operation.store_id);
        const localShift = tx.objectStore("shifts").get(operation.shift_id);
        const pending = queue.getAll();
        let updatedProducts: LocalProduct[] = [];
        let stockError: Error | undefined;

        tx.oncomplete = () => resolve(updatedProducts);
        tx.onabort = () => {
            reject(stockError ?? tx.error ?? new Error("Не удалось записать операцию в очередь."));
        };

        pending.onsuccess = () => {
            const saved: LocalShift | undefined = localShift.result;
            if (saved?.close || Date.now() >= shiftDeadline(shift)) {
                stockError = new Error("Смена уже закрыта. Откройте новую смену.");
                tx.abort();
                return;
            }
            operation.created_at = Date.now();
            const operations = (pending.result as LocalOperation[]).filter(
                (queued) => queued.store_id === operation.store_id,
            );
            const available = withPendingStock(products.result as LocalProduct[], operations);
            const byId = new Map(available.map((product) => [product.id, product]));

            for (const item of operation.checkout.items) {
                const product = byId.get(item.product_id);
                if (!product) {
                    stockError = new Error("Товар недоступен. Обновите каталог.");
                    break;
                }
                const stock = Math.round(Number(product.stock ?? 0) * 1000);
                const quantity = Math.round(item.quantity * 1000);
                if (operation.checkout.kind !== "receipt" && quantity > stock) {
                    stockError = new Error(`${product.name}: недостаточный остаток`);
                    break;
                }
            }

            if (stockError) {
                tx.abort();
                return;
            }

            queue.add(operation);
            updatedProducts = withPendingStock(products.result as LocalProduct[], [...operations, operation]);
        };
    });
}

export async function getPendingOperation(id: string): Promise<LocalOperation | undefined> {
    const db = await openCashierDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction("pendingOperations", "readonly");
        const request = tx.objectStore("pendingOperations").get(id);
        tx.oncomplete = () => resolve(request.result as LocalOperation | undefined);
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось прочитать операцию из очереди."));
    });
}

export async function listPendingOperations(storeId: string, cashierId?: string): Promise<LocalOperation[]> {
    const db = await openCashierDb();

    return new Promise((resolve, reject) => {
        const tx = db.transaction("pendingOperations", "readonly");
        const request = tx.objectStore("pendingOperations").getAll();
        tx.oncomplete = () => resolve((request.result as LocalOperation[])
            .filter((operation) => operation.store_id === storeId && (cashierId === undefined || operation.cashier_id === cashierId))
            .sort((first, second) => first.created_at - second.created_at));
        tx.onabort = () => reject(tx.error ?? new Error("Не удалось прочитать очередь операций."));
    });
}

