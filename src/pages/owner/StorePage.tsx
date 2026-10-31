import { ui } from "../../lib/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { Category, Product, Store } from "../../components/store/types";
import {
    isStoreId,
    readAllStoreRows,
    readStoreCatalog,
    requireStoreOwner,
    storeErrorMessage,
} from "../../lib/storeData";

type Cashier = { id: string; name: string; is_active: boolean };
type Shift = {
    id: string;
    cashier_id: string;
    opened_at: string;
    closed_at: string | null;
    opening_cash: number;
    closing_cash: number | null;
    expected_cash: number | null;
    opened_by: string | null;
};
type Movement = {
    id: string;
    product_id: string;
    quantity: number;
    direction: number;
    movement_type: string;
    note: string | null;
    created_at: string;
    price_at_time: number | null;
    cashier_id: string | null;
    created_by: string | null;
};
const money = (value: number) =>
    value.toLocaleString("ru-RU", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
const date = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

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

function StoreWorkspace({ storeId }: { storeId: string }) {
    const [store, setStore] = useState<Store | null>(null);
    const [categories, setCategories] = useState<Category[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [cashiers, setCashiers] = useState<Cashier[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [movements, setMovements] = useState<Movement[]>([]);
    const [revenue, setRevenue] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [lowOnly, setLowOnly] = useState(false);
    const version = useRef(0);
    const [cashierBusy, setCashierBusy] = useState(false);
    const cashierBusyRef = useRef(false);

    async function toggleCashier(cashier: Cashier) {
        if (cashierBusyRef.current) return;
        cashierBusyRef.current = true;
        setCashierBusy(true);
        try {
            const { error } = await supabase.rpc("set_store_cashier_active", {
                p_store_id: storeId,
                p_cashier_id: cashier.id,
                p_active: !cashier.is_active,
            });
            if (error) throw error;
            await load();
        } catch (error) {
            setError(storeErrorMessage(error));
        } finally {
            setCashierBusy(false);
            cashierBusyRef.current = false;
        }
    }

    const load = useCallback(async () => {
        const currentVersion = ++version.current;
        try {
            await requireStoreOwner(storeId);

            const results = await Promise.all([
                readStoreCatalog(storeId),
                readAllStoreRows<Cashier>("cashiers", "id, name, is_active", storeId),

                supabase
                    .from("cashier_shifts")
                    .select("*")
                    .eq("store_id", storeId)
                    .order("opened_at", { ascending: false })
                    .limit(10),

                supabase
                    .from("stock_movements")
                    .select(
                        "id, product_id, quantity, direction, movement_type, note, created_at, price_at_time, cashier_id, created_by",
                    )
                    .eq("store_id", storeId)
                    .order("created_at", { ascending: false })
                    .limit(30),
            ]);

            const [catalog, cashierRows, shiftResult, movementResult] = results;

            if (shiftResult.error) throw shiftResult.error;
            if (movementResult.error) throw movementResult.error;

            const shiftRows: Shift[] = shiftResult.data ?? [];
            const active = shiftRows.find((shift) => !shift.closed_at);
            let total = 0;

            if (active) {
                const { data, error } = await supabase.rpc("store_shift_revenue", { p_shift_id: active.id });
                if (error) throw error;
                total = Number(data);
            }

            if (currentVersion !== version.current) return;

            setStore(catalog.store);
            setCategories(catalog.categories);
            setProducts(catalog.products);
            setCashiers(cashierRows);
            setShifts(shiftRows);
            setMovements(movementResult.data ?? []);
            setRevenue(total);
            setError("");
        } catch (error) {
            if (currentVersion === version.current) setError(storeErrorMessage(error));
        } finally {
            if (currentVersion === version.current) setLoading(false);
        }
    }, [storeId]);

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => void load();
        const invalidate = () => {
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

    const activeShift = shifts.find((shift) => !shift.closed_at);
    const cashierName = (id: string) => cashiers.find((cashier) => cashier.id === id)?.name ?? "Кассир недоступен";
    const visibleProducts = products.filter(
        (product) =>
            product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
            (!categoryFilter || String(product.category_id) === categoryFilter) &&
            (!lowOnly || needsRestock(product)),
    );

    if (loading)
        return (
            <main className="management-page">
                <p role="status">Загрузка магазина...</p>
            </main>
        );
    if (!store)
        return (
            <main className="management-page">
                <Link to="/owner">Мои магазины</Link>
                <p role="alert">{error}</p>
                <button className={ui.button} onClick={() => void load()}>
                    Повторить
                </button>
            </main>
        );

    return (
        <main className="management-page">
            <header>
                <Link to="/owner">← Мои магазины</Link>
                <h1 className={ui.title}>{store.name}</h1>
                <p>{store.address}</p>
                <div className="flex flex-wrap gap-3">
                    <Link
                        className={ui.button + " inline-flex items-center !no-underline"}
                        to={`/store/${storeId}/inventory`}
                    >
                        Управление товарами
                    </Link>
                    <button className={ui.button} onClick={() => void load()}>
                        Обновить данные
                    </button>
                </div>
            </header>
            {error && (
                <p className={ui.error} role="alert">
                    {error}
                </p>
            )}
            <div className="store-statistics">
                <article>
                    <span>Товаров</span>
                    <strong>{products.length}</strong>
                </article>
                <article>
                    <span>Закончились</span>
                    <strong>{products.filter((p) => Number(p.stock ?? 0) <= 0).length}</strong>
                </article>
                <article>
                    <span>Текущий кассир</span>
                    <strong>{activeShift ? cashierName(activeShift.cashier_id) : "Смена не открыта"}</strong>
                </article>
                <article>
                    <span>Выручка открытой смены</span>
                    <strong>{money(revenue)}</strong>
                </article>
            </div>

            <section className="store-section">
                <h2 className={ui.heading}>Смена и касса</h2>
                <p>Смену открывает и закрывает кассир на рабочем планшете. Здесь отображаются данные смены.</p>
                {activeShift ? (
                    <>
                        <p>
                            Кассир: <b>{cashierName(activeShift.cashier_id)}</b> · Начало: {date(activeShift.opened_at)}
                        </p>
                        <p>
                            Наличные на открытии: <b>{money(Number(activeShift.opening_cash))}</b>
                        </p>
                        <p>
                            Выручка: {money(revenue)} · Ожидается в кассе:{" "}
                            <b>{money(Number(activeShift.opening_cash) + revenue)}</b>
                        </p>
                        {activeShift.opened_by && (
                            <p>Эта смена была открыта владельцем до перехода на рабочее место кассира.</p>
                        )}
                    </>
                ) : (
                    <p>Открытой смены нет.</p>
                )}
                {!!shifts.filter((shift) => shift.closed_at).length && (
                    <details>
                        <summary>Последние закрытые смены</summary>
                        <div className="table-scroll">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Кассир</th>
                                        <th>Открытие</th>
                                        <th>Наличные на открытии</th>
                                        <th>Закрытие</th>
                                        <th>Ожидалось</th>
                                        <th>Фактически</th>
                                        <th>Разница</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {shifts
                                        .filter((shift) => shift.closed_at)
                                        .map((shift) => (
                                            <tr key={shift.id}>
                                                <td>{cashierName(shift.cashier_id)}</td>
                                                <td>{date(shift.opened_at)}</td>
                                                <td>{money(Number(shift.opening_cash))}</td>
                                                <td>{date(shift.closed_at)}</td>
                                                <td>{money(Number(shift.expected_cash))}</td>
                                                <td>{shift.closing_cash === null ? "Автозакрытие · не пересчитано" : money(Number(shift.closing_cash))}</td>
                                                <td>
                                                    {shift.closing_cash === null ? "—" : money(Number(shift.closing_cash) - Number(shift.expected_cash))}
                                                </td>
                                            </tr>
                                        ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                )}
            </section>

            <section className="store-section">
                <h2 className={ui.heading}>Кассиры</h2>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>Кассир</th>
                                <th>Статус</th>
                                <th>Действие</th>
                            </tr>
                        </thead>
                        <tbody>
                            {cashiers.map((cashier) => (
                                <tr key={cashier.id}>
                                    <td className="align-middle">{cashier.name}</td>
                                    <td className="align-middle">{cashier.is_active ? "Активен" : "Отключён"}</td>
                                    <td className="align-middle">
                                        <button
                                            className={`${ui.button} hover:bg-red-800`}
                                            disabled={cashierBusy}
                                            onClick={() => void toggleCashier(cashier)}
                                        >
                                            {cashier.is_active ? "Заблокировать" : "Разблокировать"}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!cashiers.length && (
                    <p>
                        <Link to="/owner">Создать кассира</Link>
                    </p>
                )}
            </section>
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

            <section className="store-section">
                <h2 className={ui.heading}>Последние 30 движений</h2>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>Время</th>
                                <th>Товар</th>
                                <th>Операция</th>
                                <th>Кто выполнил</th>
                                <th>Количество</th>
                                <th>Сумма продажи</th>
                            </tr>
                        </thead>
                        <tbody>
                            {movements.map((item) => (
                                <tr key={item.id}>
                                    <td>{date(item.created_at)}</td>
                                    <td>
                                        {products.find((product) => product.id === item.product_id)?.name ??
                                            item.product_id}
                                    </td>
                                    <td>{item.note || item.movement_type}</td>
                                    <td title={item.created_by ?? item.cashier_id ?? undefined}>
                                        {item.cashier_id
                                            ? cashierName(item.cashier_id)
                                            : item.created_by
                                              ? `Владелец · ${item.created_by.slice(0, 8)}`
                                              : "Автор не записан (старое движение)"}
                                    </td>
                                    <td>
                                        {item.direction > 0 ? "+" : "−"}
                                        {item.quantity}
                                    </td>
                                    <td>
                                        {item.price_at_time !== null
                                            ? money(
                                                  Math.round(Number(item.price_at_time) * Number(item.quantity) * 100) /
                                                      100,
                                              )
                                            : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {!movements.length && <p>Операций пока нет.</p>}
            </section>
        </main>
    );
}

export default function StorePage() {
    const { storeId } = useParams();
    if (!isStoreId(storeId)) {
        return (
            <main className={ui.page + " p-6 [&_a]:text-brand [&_p]:mt-4"}>
                <Link to="/owner">Мои магазины</Link>
                <p role="alert">Некорректный адрес магазина.</p>
            </main>
        );
    }
    return <StoreWorkspace key={storeId} storeId={storeId} />;
}
