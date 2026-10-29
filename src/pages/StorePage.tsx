import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "../lib/supabase";
import "../css/StorePage.css";

type Store = { id: string; name: string; address: string | null };
type Category = { id: number; name: string };
type Product = {
    id: string; name: string; category_id: number | null; unit: string | null;
    price: number | null; stock: number | null; updated_at: string | null;
};
type Cashier = { id: string; name: string; is_active: boolean };
type Shift = {
    id: string; cashier_id: string; opened_at: string; closed_at: string | null;
    opening_cash: number; closing_cash: number | null; expected_cash: number | null;
    opened_by: string | null;
};
type Movement = {
    id: string; product_id: string; quantity: number; direction: number;
    movement_type: string; note: string | null; created_at: string; price_at_time: number | null;
    cashier_id: string | null; created_by: string | null;
};
const emptyDraft = { name: "", category: "", unit: "шт", price: "", stock: "0" };
const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const date = (value: string | null) => value ? new Date(value).toLocaleString("ru-RU") : "—";
const message = (error: unknown) => error && typeof error === "object" && "message" in error
    ? String(error.message) : "Не удалось выполнить запрос. Проверьте подключение.";

// Supabase limits responses; inventory must not silently omit products after the first page.
async function readAll<T>(table: string, columns: string, storeId: string): Promise<T[]> {
    const rows: T[] = [];
    for (let from = 0; ; from += 500) {
        const { data, error } = await supabase.from(table).select(columns)
            .eq("store_id", storeId).order("id").range(from, from + 499);
        if (error) throw error;
        rows.push(...(data as unknown as T[]));
        if (data.length < 500) return rows;
    }
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
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [categoryName, setCategoryName] = useState("");
    const [draft, setDraft] = useState(emptyDraft);
    const [editing, setEditing] = useState<Product | null>(null);
    const [search, setSearch] = useState("");
    const [categoryFilter, setCategoryFilter] = useState("");
    const [lowOnly, setLowOnly] = useState(false);
    const [threshold, setThreshold] = useState("5");
    const [movement, setMovement] = useState({ product: "", kind: "receipt", quantity: "1", note: "" });
    const version = useRef(0);

    const load = useCallback(async () => {
        const currentVersion = ++version.current;
        try {
            const { data: { user }, error: authError } = await supabase.auth.getUser();
            if (authError || !user) throw new Error("Войдите в аккаунт снова.");
            const { data: membership, error: accessError } = await supabase.from("store_members")
                .select("id").eq("store_id", storeId).eq("user_id", user.id)
                .eq("role", "owner").eq("is_active", true).maybeSingle();
            if (accessError) throw accessError;
            if (!membership) throw new Error("Магазин не найден или у вас нет прав владельца.");

            const results = await Promise.all([
                supabase.from("stores").select("id, name, address").eq("id", storeId).single(),
                readAll<Category>("categories", "id, name", storeId),
                readAll<Product>("products", "id, name, category_id, unit, price, stock, updated_at", storeId),
                readAll<Cashier>("cashiers", "id, name, is_active", storeId),
                supabase.from("cashier_shifts").select("*").eq("store_id", storeId)
                    .order("opened_at", { ascending: false }).limit(10),
                supabase.from("stock_movements").select("id, product_id, quantity, direction, movement_type, note, created_at, price_at_time, cashier_id, created_by")
                    .eq("store_id", storeId).order("created_at", { ascending: false }).limit(30),
            ]);
            const [storeResult, categoryRows, productRows, cashierRows, shiftResult, movementResult] = results;
            if (storeResult.error) throw storeResult.error;
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
            setStore(storeResult.data);
            setCategories(categoryRows.sort((a, b) => a.name.localeCompare(b.name)));
            setProducts(productRows.sort((a, b) => a.name.localeCompare(b.name)));
            setCashiers(cashierRows);
            setShifts(shiftRows);
            setMovements(movementResult.data ?? []);
            setRevenue(total);
            setError("");
        } catch (error) {
            if (currentVersion === version.current) setError(message(error));
        } finally {
            if (currentVersion === version.current) setLoading(false);
        }
    }, [storeId]);

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => { if (!busyRef.current) void load(); };
        const invalidate = () => { ++version.current; };
        const timer = window.setInterval(refresh, 15000);
        window.addEventListener("focus", refresh);
        return () => { invalidate(); window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
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
            setNotice(success);
            await load();
        } catch (error) {
            setError(message(error));
        } finally {
            setBusy(false);
            busyRef.current = false;
        }
    }

    async function rpc(name: string, args: Record<string, unknown>) {
        const { error } = await supabase.rpc(name, args);
        if (error) throw error;
    }

    function saveProduct(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        void run(async () => {
            await rpc("save_store_product", {
                p_store_id: storeId, p_product_id: editing?.id ?? null,
                p_updated_at: editing?.updated_at ?? null, p_name: draft.name.trim(),
                p_category_id: draft.category ? Number(draft.category) : null,
                p_unit: draft.unit.trim(), p_price: Number(draft.price), p_stock: Number(draft.stock),
            });
            setDraft(emptyDraft);
            setEditing(null);
        }, "Товар сохранён.");
    }

    function editProduct(product: Product) {
        setEditing(product);
        setDraft({ name: product.name, category: String(product.category_id ?? ""), unit: product.unit ?? "шт",
            price: String(product.price ?? 0), stock: String(product.stock ?? 0) });
        document.getElementById("product-editor")?.scrollIntoView({ behavior: "smooth" });
    }

    const activeShift = shifts.find((shift) => !shift.closed_at);
    const cashierName = (id: string) => cashiers.find((cashier) => cashier.id === id)?.name ?? "Кассир недоступен";
    const visibleProducts = products.filter((product) =>
        product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
        (!categoryFilter || String(product.category_id) === categoryFilter) &&
        (!lowOnly || Number(product.stock ?? 0) <= Number(threshold)));

    if (loading) return <main className="store-workspace"><p role="status">Загрузка магазина...</p></main>;
    if (!store) return <main className="store-workspace"><Link to="/owner">Мои магазины</Link><p role="alert">{error}</p><button onClick={() => void load()}>Повторить</button></main>;

    return (
        <main className="store-workspace">
            <header><Link to="/owner">← Мои магазины</Link><h1>{store.name}</h1><p>{store.address}</p>
                <button disabled={busy} onClick={() => void load()}>Обновить данные</button></header>
            {error && <p className="store-error" role="alert">{error}</p>}
            {notice && <p className="store-notice" role="status">{notice}</p>}
            <div className="store-summary">
                <article><span>Товаров</span><strong>{products.length}</strong></article>
                <article><span>Закончились</span><strong>{products.filter((p) => Number(p.stock ?? 0) <= 0).length}</strong></article>
                <article><span>Текущий кассир</span><strong>{activeShift ? cashierName(activeShift.cashier_id) : "Смена не открыта"}</strong></article>
                <article><span>Выручка открытой смены</span><strong>{money(revenue)}</strong></article>
            </div>

            <section className="store-panel"><h2>Смена и касса</h2>
                <p>Смену открывает и закрывает кассир на <Link to="/cashier">рабочем планшете</Link>. Здесь отображаются данные смены.</p>
                {activeShift ? <>
                    <p>Кассир: <b>{cashierName(activeShift.cashier_id)}</b> · Начало: {date(activeShift.opened_at)}</p>
                    <p>Наличные на открытии: <b>{money(Number(activeShift.opening_cash))}</b></p>
                    <p>Выручка: {money(revenue)} · Ожидается в кассе: <b>{money(Number(activeShift.opening_cash) + revenue)}</b></p>
                    {activeShift.opened_by && <p>Эта смена была открыта владельцем до перехода на рабочее место кассира.</p>}
                </> : <p>Открытой смены нет.</p>}
                {!!shifts.filter((shift) => shift.closed_at).length && <details><summary>Последние закрытые смены</summary><div className="store-table"><table><thead><tr><th>Кассир</th><th>Открытие</th><th>Наличные на открытии</th><th>Закрытие</th><th>Ожидалось</th><th>Фактически</th><th>Разница</th></tr></thead><tbody>{shifts.filter((shift) => shift.closed_at).map((shift) => <tr key={shift.id}><td>{cashierName(shift.cashier_id)}</td><td>{date(shift.opened_at)}</td><td>{money(Number(shift.opening_cash))}</td><td>{date(shift.closed_at)}</td><td>{money(Number(shift.expected_cash))}</td><td>{money(Number(shift.closing_cash))}</td><td>{money(Number(shift.closing_cash) - Number(shift.expected_cash))}</td></tr>)}</tbody></table></div></details>}
            </section>

            <section className="store-panel"><h2>Кассиры и вход на планшете</h2>
                <p>Откройте адрес <Link to="/cashier">/cashier</Link> на планшете. Для входа кассир вводит только своё имя и PIN.</p>
                <div className="store-table"><table><thead><tr><th>Кассир</th><th>Статус</th></tr></thead><tbody>{cashiers.map((cashier) => <tr key={cashier.id}><td>{cashier.name}</td><td>{cashier.is_active ? "Активен" : "Отключён"}</td></tr>)}</tbody></table></div>
                {!cashiers.length && <p><Link to="/owner">Создать кассира</Link></p>}
            </section>
            <section className="store-panel"><h2>Категории</h2>
                <p>{categories.map((category) => category.name).join(" · ") || "Категорий пока нет."}</p>
                <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
                    if (!categoryName.trim()) throw new Error("Введите название категории.");
                    const { error } = await supabase.from("categories").insert({ store_id: storeId, name: categoryName.trim() });
                    if (error) throw error;
                    setCategoryName("");
                }, "Категория создана."); }}><fieldset disabled={busy}><label>Новая категория<input required maxLength={120} value={categoryName} onChange={(e) => setCategoryName(e.target.value)} /></label><button>Добавить категорию</button></fieldset></form>
            </section>

            <section id="product-editor" className="store-panel"><h2>{editing ? `Редактирование: ${editing.name}` : "Добавить товар"}</h2>
                <form onSubmit={saveProduct}><fieldset disabled={busy}>
                    <label>Название<input required maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></label>
                    <label>Категория<select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}><option value="">Без категории</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                    <label>Единица измерения<input required maxLength={20} value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value })} /></label>
                    <label>Цена за единицу<input type="number" required min="0" max="9999999999.99" step="0.01" value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} /></label>
                    <label>Остаток<input type="number" required min="0" max="99999999999.999" step="0.001" value={draft.stock} onChange={(e) => setDraft({ ...draft, stock: e.target.value })} /></label>
                    <button>{busy ? "Сохранение..." : "Сохранить товар"}</button>
                    {editing && <button type="button" onClick={() => { setEditing(null); setDraft(emptyDraft); }}>Отмена</button>}
                </fieldset></form>
                <p>Количество на складе — это остаток. Его ручное изменение сохраняется в истории как корректировка.</p>
            </section>

            <section className="store-panel"><h2>Приход и списание владельцем</h2>
                <p>Эти операции записываются на ваш аккаунт. Продажи и действия кассира проводятся на рабочем планшете.</p>
                <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
                    await rpc("record_store_movement", { p_store_id: storeId, p_product_id: movement.product,
                        p_kind: movement.kind, p_quantity: Number(movement.quantity), p_note: movement.note,
                        p_shift_id: null });
                    setMovement({ ...movement, quantity: "1", note: "" });
                }, "Операция проведена, остаток обновлён."); }}><fieldset disabled={busy || !products.length}>
                    <label>Товар<select required value={movement.product} onChange={(e) => setMovement({ ...movement, product: e.target.value })}><option value="">Выберите товар</option>{products.map((product) => <option key={product.id} value={product.id}>{product.name} — {product.stock ?? 0} {product.unit}</option>)}</select></label>
                    <label>Операция<select value={movement.kind} onChange={(e) => setMovement({ ...movement, kind: e.target.value })}><option value="receipt">Приход</option><option value="writeoff">Списание</option></select></label>
                    <label>Количество<input required type="number" min="0.001" max="99999999999.999" step="0.001" value={movement.quantity} onChange={(e) => setMovement({ ...movement, quantity: e.target.value })} /></label>
                    <label>Комментарий<input maxLength={500} value={movement.note} onChange={(e) => setMovement({ ...movement, note: e.target.value })} /></label>
                    <button>Провести операцию</button>
                </fieldset></form>
            </section>

            <section className="store-panel"><h2>Остатки товаров</h2>
                <div className="store-filters"><label>Поиск<input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Название товара" /></label>
                    <label>Категория<select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}><option value="">Все категории</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
                    <label>Порог для заказа<input type="number" min="0" step="0.001" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></label>
                    <label><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} />Только остаток ≤ порога</label>
                </div>
                <p>Данные обновляются каждые 15 секунд и при возвращении на страницу. Порог используется для фильтрации товаров к заказу.</p>
                <div className="store-table"><table><thead><tr><th>Товар</th><th>Категория</th><th>Цена</th><th>Остаток</th><th>Обновлён</th><th>Действие</th></tr></thead><tbody>{visibleProducts.map((product) => <tr key={product.id} className={Number(product.stock ?? 0) <= Number(threshold) ? "store-low" : ""}>
                    <td>{product.name}</td><td>{categories.find((category) => category.id === product.category_id)?.name ?? "Без категории"}</td><td>{money(Number(product.price ?? 0))}</td><td><b>{product.stock ?? 0} {product.unit}</b></td><td>{date(product.updated_at)}</td><td><button disabled={busy} onClick={() => editProduct(product)}>Редактировать</button></td>
                </tr>)}</tbody></table></div>
                {!visibleProducts.length && <p>Товары не найдены.</p>}
            </section>

            <section className="store-panel"><h2>Последние 30 движений</h2><div className="store-table"><table><thead><tr><th>Время</th><th>Товар</th><th>Операция</th><th>Кто выполнил</th><th>Количество</th><th>Сумма продажи</th></tr></thead><tbody>{movements.map((item) => <tr key={item.id}><td>{date(item.created_at)}</td><td>{products.find((product) => product.id === item.product_id)?.name ?? item.product_id}</td><td>{item.note || item.movement_type}</td><td title={item.created_by ?? item.cashier_id ?? undefined}>{item.cashier_id ? cashierName(item.cashier_id) : item.created_by ? `Владелец · ${item.created_by.slice(0, 8)}` : "Автор не записан (старое движение)"}</td><td>{item.direction > 0 ? "+" : "−"}{item.quantity}</td><td>{item.price_at_time !== null ? money(Math.round(Number(item.price_at_time) * Number(item.quantity) * 100) / 100) : "—"}</td></tr>)}</tbody></table></div>{!movements.length && <p>Операций пока нет.</p>}</section>
        </main>
    );
}

export default function StorePage() {
    const { storeId } = useParams();
    if (!storeId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storeId)) {
        return <main><Link to="/owner">Мои магазины</Link><p role="alert">Некорректный адрес магазина.</p></main>;
    }
    return <StoreWorkspace key={storeId} storeId={storeId} />;
}
