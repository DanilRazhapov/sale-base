import { ui } from "../../lib/ui";
import { money } from "../../lib/cashierFormat";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { useState } from "react";

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
            className={"pos-catalog" + (mobileView === "cart" ? " max-sm:hidden" : "")}
            aria-label="Каталог товаров"
        >
            <div className="pos-catalog-header">
                <h2 className={ui.heading}>
                    Товары <span>{filtered.length}</span>
                </h2>
                <label className="pos-search">
                    <span className="sr-only">Поиск товаров</span>
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
            <div className="pos-product-grid">
                {filtered.map((product) => {
                    const selected = lines.find((line) => line.product_id === product.id);
                    const unavailable = kind !== "receipt" && Number(product.stock ?? 0) <= 0;
                    return (
                        <button
                            className={ui.buttonBase + " pos-product"}
                            key={product.id}
                            disabled={locked || !ownShift || unavailable || (kind === "sale" && product.price === null)}
                            onClick={() => add(product)}
                        >
                            <span className="pos-product-category">
                                {categories.find((item) => item.id === product.category_id)?.name ?? "Без категории"}
                            </span>
                            <strong>{product.name}</strong>
                            <span className="pos-product-price">
                                {product.price === null ? "Цена не задана" : money(Number(product.price))}
                                <small> / {product.unit ?? "шт"}</small>
                            </span>
                            <span className="pos-product-stock">
                                <span>
                                    {unavailable
                                        ? "Нет в наличии"
                                        : `Остаток: ${product.stock ?? 0} ${product.unit ?? "шт"}`}
                                </span>
                                <span className="pos-product-quantity">{selected ? selected.quantity : "+"}</span>
                            </span>
                        </button>
                    );
                })}
            </div>
            {!filtered.length && <div className="empty-state">Товаров в этой категории пока нет.</div>}
        </section>
    );
}
