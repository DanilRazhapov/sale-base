import { useEffect, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { CategoryForm } from "../../components/store/CategoryForm";
import { OwnerMovementForm } from "../../components/store/OwnerMovementForm";
import { ProductForm } from "../../components/store/ProductForm";
import { storeErrorMessage } from "../../lib/storeData";
import { ui } from "../../lib/ui";
import { StoreHeader } from "../../components/store/StoreHeader";
import type { StoreLayoutContext } from "../../layouts/StoreLayout";

export default function StoreInventoryPage() {
    const { store, categories, products, catalogError, reloadCatalog } =
        useOutletContext<StoreLayoutContext>();

    const storeId = store.id;

    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [search, setSearch] = useState("");
    const [editorVersion, setEditorVersion] = useState(0);

    const [searchParams, setSearchParams] = useSearchParams();
    const productId = searchParams.get("product");

    const busyRef = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    async function run(action: () => Promise<void>, success: string) {
        if (busyRef.current) return;
        busyRef.current = true;
        setBusy(true);
        setError("");
        setNotice("");
        try {
            await action();
            if (!mounted.current) return;
            setNotice(success);
            await reloadCatalog();
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

    const editing = products.find((product) => product.id === productId) ?? null;
    const filteredProducts = products.filter((product) =>
        product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );

    return (
        <main className="owner-page store-page">
            <StoreHeader
                store={store}
                title="Каталог товаров"
                description="Управляйте ассортиментом, ценами и категориями."
            >
                <button className={ui.button} disabled={busy} onClick={() => void reloadCatalog()}>
                    Обновить данные
                </button>
            </StoreHeader>
            {(error || catalogError) && (
                <p className={ui.error} role="alert">
                    {error || catalogError}
                </p>
            )}
            {notice && (
                <p className={ui.notice} role="status">
                    {notice}
                </p>
            )}
            <div className="inventory-workspace">
                <section className="inventory-catalog">
                    <div className="inventory-toolbar">
                        <h2 className={ui.heading}>
                            Товары <span className="store-count">{products.length}</span>
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
                    <div className="inventory-products">
                        {filteredProducts.map((product) => (
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
                                <span className="inventory-product-copy">
                                    <strong>{product.name}</strong>
                                    <small>
                                        {product.stock ?? 0} {product.unit ?? "шт"} ·{" "}
                                        {Number(product.price ?? 0).toLocaleString("ru-RU")} за {product.unit ?? "шт"}
                                    </small>
                                </span>
                                <span aria-hidden="true">↗</span>
                            </button>
                        ))}
                        {!products.length && (
                            <p className="py-6 text-sm text-muted">Добавьте первый товар через форму.</p>
                        )}
                        {products.length > 0 && filteredProducts.length === 0 && (
                            <p className="py-6 text-sm text-muted">Товары не найдены.</p>
                        )}
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
            <div className="inventory-workspace inventory-tools">
                <CategoryForm storeId={storeId} categories={categories} busy={busy} runAction={run} />
                <OwnerMovementForm storeId={storeId} products={products} busy={busy} runAction={run} />
            </div>
        </main>
    );
}
