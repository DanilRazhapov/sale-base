import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { CategoryForm } from "../../components/store/CategoryForm";
import { OwnerMovementForm } from "../../components/store/OwnerMovementForm";
import { ProductForm } from "../../components/store/ProductForm";
import { isStoreId, readStoreCatalog, requireStoreOwner, storeErrorMessage } from "../../lib/storeData";
import { ui } from "../../lib/ui";

function StoreInventoryWorkspace({ storeId }: { storeId: string }) {
    const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof readStoreCatalog>> | null>(null);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [editorVersion, setEditorVersion] = useState(0);
    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get("product");
    const busyRef = useRef(false);
    const mounted = useRef(false);
    const version = useRef(0);

    const load = useCallback(async () => {
        const currentVersion = ++version.current;
        try {
            await requireStoreOwner(storeId);
            const data = await readStoreCatalog(storeId);
            if (currentVersion !== version.current) return;
            setCatalog(data);
            setError("");
        } catch (error) {
            if (currentVersion === version.current) setError(storeErrorMessage(error));
        } finally {
            if (currentVersion === version.current) setLoading(false);
        }
    }, [storeId]);

    useEffect(() => {
        mounted.current = true;
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => {
            if (!busyRef.current) void load();
        };
        const invalidate = () => {
            mounted.current = false;
            ++version.current;
        };
        const timer = window.setInterval(refresh, 15000);
        window.addEventListener("focus", refresh);
        return () => {
            invalidate();
            window.clearTimeout(initial);
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
        };
    }, [load]);

    async function run(action: () => Promise<void>, success: string) {
        if (busyRef.current) return;
        busyRef.current = true;
        ++version.current;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await action();
            if (!mounted.current) return;
            setNotice(success);
            await load();
        } catch (error) {
            setError(storeErrorMessage(error));
        } finally {
            setBusy(false);
            busyRef.current = false;
        }
    }

    function resetProductEditor() {
        if (!mounted.current) return;
        setEditorVersion((current) => current + 1);
        if (productId !== null) {
            setSearchParams(
                (current) => {
                    const next = new URLSearchParams(current);
                    next.delete("product");
                    return next;
                },
                { replace: true },
            );
        }
    }

    if (loading)
        return (
            <main className="management-page">
                <p role="status">Загрузка товаров и категорий...</p>
            </main>
        );

    if (!catalog)
        return (
            <main className="management-page">
                <Link to={`/store/${storeId}`}>← Вернуться в магазин</Link>
                <p className={ui.error} role="alert">
                    {error}
                </p>
                <button className={ui.button} onClick={() => void load()}>
                    Повторить
                </button>
            </main>
        );

    const { store, categories, products } = catalog;
    const editing = products.find((product) => product.id === productId) ?? null;

    return (
        <main className="management-page !max-w-[1600px]">
            <header>
                <Link to={`/store/${storeId}`}>← Вернуться в магазин</Link>
                <h1 className={ui.title}>Управление товарами</h1>
                <p>{store.name}</p>
                <p>Создавайте категории и товары, оформляйте приход и списание.</p>
                <button className={ui.button} disabled={busy} onClick={() => void load()}>
                    Обновить данные
                </button>
            </header>
            {error && (
                <p className={ui.error} role="alert">
                    {error}
                </p>
            )}
            {notice && (
                <p className={ui.notice} role="status">
                    {notice}
                </p>
            )}
            <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
                <section className="inventory-catalog">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className={ui.heading}>
                            Товары <span className="text-muted">{products.length}</span>
                        </h2>
                        <button className={ui.button} disabled={busy} onClick={resetProductEditor}>
                            + Добавить
                        </button>
                    </div>
                    <label className={ui.label}>
                        Поиск товара
                        <input
                            className={ui.input}
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Название товара"
                        />
                    </label>
                    <div className="mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
                        {products
                            .filter((product) => product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
                            .map((product) => (
                                <button
                                    key={product.id}
                                    disabled={busy}
                                    aria-pressed={product.id === productId}
                                    className="inventory-product"
                                    onClick={() =>
                                        setSearchParams((current) => {
                                            const next = new URLSearchParams(current);
                                            next.set("product", product.id);
                                            return next;
                                        })
                                    }
                                >
                                    <strong className="block break-words">{product.name}</strong>
                                    <span className="mt-1 block text-sm text-muted">
                                        {product.stock ?? 0} {product.unit ?? "шт"} ·{" "}
                                        {Number(product.price ?? 0).toLocaleString("ru-RU")} за {product.unit ?? "шт"}
                                    </span>
                                </button>
                            ))}
                        {!products.length && (
                            <p className="py-6 text-sm text-muted">Добавьте первый товар через форму.</p>
                        )}
                        {!!products.length &&
                            !products.some((product) =>
                                product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                            ) && <p className="py-6 text-sm text-muted">Товары не найдены.</p>}
                    </div>
                </section>
                {productId !== null && !editing ? (
                    <section className="store-section">
                        <p role="alert">Товар не найден в этом магазине.</p>
                        <button className={ui.button} disabled={busy} onClick={resetProductEditor}>
                            Добавить новый товар
                        </button>
                    </section>
                ) : (
                    <ProductForm
                        key={`${productId ?? "new"}:${editorVersion}`}
                        storeId={storeId}
                        categories={categories}
                        editing={editing}
                        busy={busy}
                        runAction={run}
                        onClose={resetProductEditor}
                    />
                )}
            </div>
            <div className="grid items-start gap-6 lg:grid-cols-2">
                <CategoryForm storeId={storeId} categories={categories} busy={busy} runAction={run} />
                <OwnerMovementForm storeId={storeId} products={products} busy={busy} runAction={run} />
            </div>
        </main>
    );
}

export default function StoreInventoryPage() {
    const { storeId } = useParams();
    if (!isStoreId(storeId))
        return (
            <main className="management-page">
                <Link to="/owner">Мои магазины</Link>
                <p role="alert">Некорректный адрес магазина.</p>
            </main>
        );
    return <StoreInventoryWorkspace key={storeId} storeId={storeId} />;
}
