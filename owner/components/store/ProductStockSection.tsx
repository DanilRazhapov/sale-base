import { ui } from "../../../shared/lib/ui";
import { Link } from "react-router-dom";
import type { Product, Category } from "./types";
import { money, date } from "../../../shared/lib/formatters";
import { useState } from "react";

type ProductStockSectionProps = {
    products: Product[];
    categories: Category[];
    storeId: string;
};

function needsCriticalRestock(product: Pick<Product, "stock" | "unit">) {
    const currentStock = Number(product.stock ?? 0);
    const threshold = product.unit === "кг" ? 0.5 : product.unit === "л" ? 10 : 2;
    return currentStock <= threshold;
}
    
function needsRestock(product: Pick<Product, "stock" | "unit">) {
    const currentStock = Number(product.stock ?? 0);
    const threshold = product.unit === "кг" ? 1 : product.unit === "л" ? 15 : 5;
    return currentStock <= threshold && !needsCriticalRestock(product);
}

export function ProductStockSection({products, categories, storeId,}: ProductStockSectionProps) {
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [lowOnly, setLowOnly] = useState(false);

    const visibleProducts = products.filter(
        (product) =>
            product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
            (!categoryFilter || String(product.category_id) === categoryFilter) &&
            (!lowOnly || needsRestock(product)),
    );

    return (
        <section className="store-section">
                <h2 className={ui.heading}>Остатки товаров</h2>
                <div className="flex flex-wrap items-end gap-4">
                    <label className={ui.label}>
                        Поиск
                        <input
                            className={ui.input}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Название товара"
                        />
                    </label>
                    <label className={ui.label}>
                        Категория
                        <select
                            className={ui.input}
                            value={categoryFilter}
                            onChange={(e) => setCategoryFilter(e.target.value)}
                        >
                            <option value="">Все категории</option>
                            {categories.map((category) => (
                                <option key={category.id} value={category.id}>
                                    {category.name}
                                </option>
                            ))}
                        </select>
                    </label>
                    <div className={ui.label}>
                        Порог для заказа
                        <span className="text-sm font-normal">5 шт · 1 кг · 10 л</span>
                    </div>
                    <label className="flex cursor-pointer flex-row items-center gap-2 text-sm font-medium">
                        <input
                            className={ui.checkbox}
                            type="checkbox"
                            checked={lowOnly}
                            onChange={(e) => setLowOnly(e.target.checked)}
                        />
                        Только остаток ≤ порога
                    </label>
                </div>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>Товар</th>
                                <th>Категория</th>
                                <th>Цена</th>
                                <th>Остаток</th>
                                <th>Обновлён</th>
                                <th>Действие</th>
                            </tr>
                        </thead>
                        <tbody>
                            {visibleProducts.map((product) => (
                                <tr key={product.id} className={`${needsCriticalRestock(product) ? "stock-critical" : ""} ${needsRestock(product) ? "stock-warning" : ""}`.trim()}>
                                    <td className="align-middle">{product.name}</td>
                                    <td className="align-middle">
                                        {categories.find((category) => category.id === product.category_id)?.name ??
                                            "Без категории"}
                                    </td>
                                    <td className="align-middle">{money(Number(product.price ?? 0))}</td>
                                    <td className="align-middle">
                                        <b>
                                            {product.stock ?? 0} {product.unit}
                                        </b>
                                    </td>
                                    <td className="align-middle">{date(product.updated_at)}</td>
                                    <td>
                                        <Link
                                            className={ui.button + " inline-flex items-center !no-underline"}
                                            to={`/store/${storeId}/inventory?product=${encodeURIComponent(product.id)}`}
                                        >
                                            Редактировать
                                        </Link>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!visibleProducts.length && <p>Товары не найдены.</p>}
            </section>
    )
}