import { ui } from "../../lib/ui";
import { money } from "../../lib/cashierFormat";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { useState } from "react";
import { PosIcon } from "./PosIcon";

type Props = Pick<CashierPOSState, "lines" | "kind" | "ownShift" | "locked" | "mobileView" | "add"> &
    Pick<CashierPOSProps, "snapshot">;

export function CashierCatalog({ lines, kind, ownShift, locked, mobileView, add, snapshot }: Props) {
    const [category, setCategory] = useState("all");
    const [search, setSearch] = useState("");
    const categories = snapshot.categories ?? [];
    const filtered = snapshot.products.filter(
        (product) =>
            (category === "all" ||
                (category === "none" ? product.category_id === null : String(product.category_id) === category)) &&
            product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
    );
    return (
        <section
            className="pos-catalog"
            id="pos-catalog"
            data-mobile-hidden={mobileView === "cart"}
            aria-label="Каталог товаров"
        >
            <div className="pos-catalog-header">
                <div className="pos-panel-title">
                    <span className="pos-panel-icon">
                        <PosIcon name="box" />
                    </span>
                    <h2 className={ui.heading}>
                        Каталог <span>{filtered.length}</span>
                    </h2>
                </div>
                <label className="pos-search">
                    <span className="sr-only">Поиск товаров</span>
                    <PosIcon name="search" />
                    <input
                        className={ui.input}
                        placeholder="Поиск по названию"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </label>
            </div>
            <div className="pos-categories" role="group" aria-label="Категории">
                <button className={ui.button} aria-pressed={category === "all"} onClick={() => setCategory("all")}>
                    Все товары
                </button>
                {categories.map((item) => (
                    <button
                        className={ui.button}
                        key={item.id}
                        aria-pressed={category === String(item.id)}
                        onClick={() => setCategory(String(item.id))}
                    >
                        {item.name}
                    </button>
                ))}
                <button className={ui.button} aria-pressed={category === "none"} onClick={() => setCategory("none")}>
                    Без категории
                </button>
            </div>
            {filtered.length > 0 && (
                <div className="pos-product-columns" aria-hidden="true">
                    <span>Товар</span>
                    <span>Остаток</span>
                    <span>Цена</span>
                    <span />
                </div>
            )}
            <div className="pos-product-list">
                {filtered.map((product) => {
                    const selected = lines.find((line) => line.product_id === product.id);
                    const unavailable = kind !== "receipt" && Number(product.stock ?? 0) <= 0;
                    return (
                        <button
                            className={ui.buttonBase + " pos-product"}
                            key={product.id}
                            data-selected={Boolean(selected)}
                            data-unavailable={unavailable}
                            disabled={locked || !ownShift || unavailable || (kind === "sale" && product.price === null)}
                            onClick={() => add(product)}
                        >
                            <span className="pos-product-name">
                                <strong>{product.name}</strong>
                                <span>
                                    {categories.find((item) => item.id === product.category_id)?.name ??
                                        "Без категории"}
                                </span>
                            </span>
                            <span className="pos-product-stock">
                                {unavailable ? (
                                    "Нет в наличии"
                                ) : (
                                    <>
                                        <span className="sr-only">Остаток </span>
                                        {product.stock ?? 0} {product.unit ?? "шт"}
                                    </>
                                )}
                            </span>
                            <span className="pos-product-price">
                                {product.price !== null && <span className="sr-only">Цена </span>}
                                {product.price === null ? "Цена не задана" : money(Number(product.price))}
                                {product.price !== null && <small> / {product.unit ?? "шт"}</small>}
                            </span>
                            <span className="pos-product-quantity">
                                {selected && <span className="sr-only">В корзине </span>}
                                {selected ? selected.quantity : <PosIcon name="plus" />}
                            </span>
                        </button>
                    );
                })}
            </div>
            {!filtered.length && (
                <div className="empty-state pos-empty-state">
                    <span className="pos-empty-icon">
                        <PosIcon name="search" />
                    </span>
                    <strong>{search ? "Совпадений нет" : "Здесь пока нет товаров"}</strong>
                    {search && <p>Попробуйте изменить запрос или выбрать другую категорию.</p>}
                </div>
            )}
        </section>
    );
}
