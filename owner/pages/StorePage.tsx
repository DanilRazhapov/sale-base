import { ui } from "../../shared/lib/ui";
import { money, date } from "../../shared/lib/formatters";
import { StoreHeader } from "../components/store/StoreHeader";
import { TerminalDevices } from "../components/store/TerminalDevices";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useOutletContext, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import {
    isStoreId,
    readAllStoreRows,
    requireStoreOwner,
    storeErrorMessage,
} from "../lib/storeData";
import type { StoreLayoutContext } from "../layouts/StoreLayout";

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
function StoreWorkspace({ storeId }: { storeId: string }) {
    const [cashiers, setCashiers] = useState<Cashier[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [movements, setMovements] = useState<Movement[]>([]);
    const [revenue, setRevenue] = useState(0);

    const [error, setError] = useState("");

    const version = useRef(0);
    const pendingLoad = useRef<Promise<void> | null>(null);

    const [cashierBusy, setCashierBusy] = useState(false);
    const cashierBusyRef = useRef(false);

    const { store, products } = useOutletContext<StoreLayoutContext>();

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
            if (pendingLoad.current) await pendingLoad.current;
            await load();
        } catch (error) {
            setError(storeErrorMessage(error));
        } finally {
            setCashierBusy(false);
            cashierBusyRef.current = false;
        }
    }

    const load = useCallback(() => {
        if (pendingLoad.current) return pendingLoad.current;

        const currentVersion = ++version.current;
        const request = (async () => {
            try {
                await requireStoreOwner(storeId);

                const results = await Promise.all([
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

                const [cashierRows, shiftResult, movementResult] = results;

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
                
                setCashiers(cashierRows);
                setShifts(shiftRows);
                setMovements(movementResult.data ?? []);
                setRevenue(total);
                setError("");
            } catch (error) {
                if (currentVersion === version.current) setError(storeErrorMessage(error));
            }
        })();
        pendingLoad.current = request;
        void request.finally(() => {
            if (pendingLoad.current === request) pendingLoad.current = null;
        });
        return request;
    }, [storeId]);

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => void load();
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
    }, [load]);

    const activeShift = shifts.find((shift) => !shift.closed_at);
    const cashierName = (id: string) => cashiers.find((cashier) => cashier.id === id)?.name ?? "Кассир недоступен";

    return (
        <main className="management-page">
            <StoreHeader
                backTo="/"
                backLabel="На главную"
                title={store.name}
                description={store.address || undefined}
            >
                <button
                    className={ui.button}
                    onClick={() => void load()}
                >
                    Обновить данные
                </button>
                <TerminalDevices storeId={storeId} storeName={store.name} />
            </StoreHeader>
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
                                            className={`${ui.button} hover:bg-danger-soft`}
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
                        <Link to="/cashier/new">Создать кассира</Link>
                    </p>
                )}
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
                <Link to="/">На главную</Link>
                <p role="alert">Некорректный адрес магазина.</p>
            </main>
        );
    }
    return <StoreWorkspace key={storeId} storeId={storeId} />;
}
