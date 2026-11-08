import { useState, useCallback, useRef, useEffect } from "react";
import { Outlet, useParams } from "react-router-dom";
import type { Store, Category, Product } from "../components/store/types";
import { readStoreCatalog, requireStoreOwner, storeErrorMessage, isStoreId} from "../lib/storeData";
import Throbber from "../../shared/components/Throbber";

export type StoreLayoutContext = {
    store: Store;
    products: Product[];
    categories: Category[];
    catalogError: string;
    reloadCatalog: () => Promise<void>;
};

export function StoreLayout() {
    const { storeId } = useParams();
    return <StoreCatalogLayout key={storeId} storeId={storeId} />;
}

function StoreCatalogLayout({ storeId }: { storeId: string | undefined }) {
    const [store, setStore] = useState<Store | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);

    const version = useRef(0);
    const pendingLoad = useRef<Promise<void> | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");

    const loadCatalog = useCallback((force = false) => {
            if (!force && pendingLoad.current) return pendingLoad.current;
    
            const currentVersion = ++version.current;
            const request = (async () => {
                try {
                    if (!isStoreId(storeId)) {
                        throw new Error("Invalid store ID");
                    }

                    await requireStoreOwner(storeId);
    
                    const catalog = await readStoreCatalog(storeId);

                    if (currentVersion !== version.current) return;
    
                    setStore(catalog.store);
                    setCategories(catalog.categories);
                    setProducts(catalog.products);
                    setError("");
                } catch (error) {
                    if (currentVersion === version.current) setError(storeErrorMessage(error));
                } finally {
                    if (currentVersion === version.current) setLoading(false);
                }
            })();
            pendingLoad.current = request;
            void request.finally(() => {
                if (pendingLoad.current === request) pendingLoad.current = null;
            });
            return request;
        }, [storeId]);

    useEffect(() => {
            const initial = window.setTimeout(() => void loadCatalog(), 0);
            const refresh = () => void loadCatalog();
            const invalidate = () => {
                ++version.current;
                pendingLoad.current = null;
            };
            const timer = window.setInterval(refresh, 15000);
            window.addEventListener("focus", refresh);
            return () => {
                invalidate();
                window.clearTimeout(initial);
                window.clearInterval(timer);
                window.removeEventListener("focus", refresh);
            };
        }, [loadCatalog]);
        
    if (loading) {
        return (
            <main className="management-page">
                <Throbber 
                    label="Загрузка магазина..."
                    className="min-h-[50vh]"
                />
            </main>
        )
    }

    if (!store) {
        return (
            <main className="management-page">
                <p>{error || "Магазин не найден."}</p>

                <button onClick={() => void loadCatalog()}>
                    Повторить
                </button>
            </main>
        )
    }

    return (    
        <Outlet 
            context={{
                store,
                products,
                categories,
                catalogError: error,
                reloadCatalog: () => loadCatalog(true),
            } satisfies StoreLayoutContext}
        />
    )
};
