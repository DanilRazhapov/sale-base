const DB_NAME = "salebase-cashier";
const DB_VERSION = 3;

let dbPromise: Promise<IDBDatabase> | null = null;

/** Открывает локальную базу кассы. Повторные вызовы используют одно соединение. */
export function openCashierDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;

    const opening = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === "undefined") {
            reject(new Error("IndexedDB недоступна в этом браузере."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);
        let blocked = false;

        // Создание и изменение структуры допускается только при обновлении версии.
        request.onupgradeneeded = (event) => {
            if (blocked) {
                request.transaction?.abort();
                return;
            }

            const db = request.result;
            if (event.oldVersion < 1) {
                // Составной ключ разделяет данные разных магазинов на одном устройстве.
                const products = db.createObjectStore("products", { keyPath: ["store_id", "id"] });
                products.createIndex("byStore", "store_id");

                const categories = db.createObjectStore("categories", { keyPath: ["store_id", "id"] });
                categories.createIndex("byStore", "store_id");
            }

            if (event.oldVersion < 2) {
                db.createObjectStore("terminalMeta", { keyPath: "key" });
            }
            if (event.oldVersion < 3) {
                db.createObjectStore("pendingOperations", { keyPath: "id"});
            }
        };

        request.onsuccess = () => {
            const db = request.result;
            // Заблокированный запрос может завершиться уже после отклонения Promise.
            if (blocked) {
                db.close();
                return;
            }

            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };
            db.onclose = () => {
                dbPromise = null;
            };
            resolve(db);
        };

        request.onerror = () => {
            reject(request.error ?? new Error("Не удалось открыть локальную базу кассы."));
        };

        request.onblocked = () => {
            blocked = true;
            reject(new Error("Закройте другие вкладки кассы и повторите открытие локальной базы."));
        };
    });

    dbPromise = opening;
    // После ошибки разрешаем повторить открытие, а не сохраняем отклонённый Promise.
    void opening.catch(() => {
        if (dbPromise === opening) dbPromise = null;
    });
    return opening;
}
