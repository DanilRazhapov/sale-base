import { useEffect, useRef, useState } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";
import { CategoryForm } from "../components/store/CategoryForm";
import { OwnerMovementForm } from "../components/store/OwnerMovementForm";
import { ProductForm } from "../components/store/ProductForm";
import { storeErrorMessage } from "../lib/storeData";
import { ui } from "../../shared/lib/ui";
import { StoreHeader } from "../components/store/StoreHeader";
import type { StoreLayoutContext } from "../layouts/StoreLayout";

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

    useEffect(() => {
        if (productId !== null && window.matchMedia("(width < 80rem)").matches) {
            document.getElementById("product-editor")?.scrollIntoView({ block: "start" });
        }
    }, [productId]);

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

    return (
        <main className="management-page !max-w-[1600px]">
            <StoreHeader
                backTo={`/store/${storeId}`}
                backLabel="Вернуться в магазин"
                title="Управление товарами"
                description="Создавайте категории и обновляйте товары, чтобы управлять ассортиментом вашего магазина."
            >
                <button
                    className={ui.button}
                    disabled={busy}
                    onClick={() => void reloadCatalog()}
                >
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
            <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
                <section className="inventory-catalog">
                    <div className="flex items-center justify-between gap-3">
                        <h2 className={ui.heading}>
                            Товары <span className="text-muted">{products.length}</span>
                        </h2>
                        <button className={ui.button} disabled={busy} onClick={() => {
                            resetProductEditor();
                            document.getElementById("product-editor")?.scrollIntoView({ block: "start" });
                        }}>
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
                    <div className="inventory-product-list mt-4 max-h-[65vh] space-y-2 overflow-y-auto">
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
