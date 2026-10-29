import { useEffect, useRef, useState } from "react";
import { terminalRequest, TerminalError } from "../lib/cashierTerminal";
import { lineCents, quantityMilli, readCartDraft, type CartDraft, type CartKind, type PendingCheckout, type TerminalProduct, type TerminalSnapshot } from "../lib/cashierCart";
import { TerminalDialog } from "./TerminalDialog";
import "../pages/CashierPage.css";

const money = (value: number) => value.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kindName = { sale: "Продажа", receipt: "Приход", writeoff: "Списание" };
type Props = {
    token: string; snapshot: TerminalSnapshot; busy: boolean;
    error: string; notice: string;
    refresh: () => Promise<void>; logout: () => void;
    run: (action: () => Promise<void>, success: string) => Promise<void>;
};

export function CashierPOS({ token, snapshot, busy, refresh, logout, run, error, notice }: Props) {
    const draftKey = `salebase.cart.${snapshot.cashier.id}`;
    const [draft, setDraft] = useState<CartDraft>(() => readCartDraft(draftKey));
    const [category, setCategory] = useState("all");
    const [search, setSearch] = useState("");
    const [mobileView, setMobileView] = useState<"products" | "cart">("products");
    const [dialog, setDialog] = useState<"clear" | "logout" | "shift" | "history" | "mode" | null>(null);
    const [nextKind, setNextKind] = useState<CartKind>("sale");
    const [openingCash, setOpeningCash] = useState("0");
    const [closingCash, setClosingCash] = useState("");
    const [cartError, setCartError] = useState("");
    const [savedTotal, setSavedTotal] = useState<number | null>(null);
    const [storageError, setStorageError] = useState(false);
    const checkoutBusy = useRef(false);
    useEffect(() => {
        try { sessionStorage.setItem(draftKey, JSON.stringify(draft)); }
        catch { /* The draft still works in memory; avoid auto-resubmitting after a reload. */ }
    }, [draft, draftKey]);

    const { lines, kind, pending } = draft;
    const ownShift = !!snapshot.shift && snapshot.shift.cashier_id === snapshot.cashier.id;
    const locked = busy || !!pending;
    const total = Number(lines.reduce((sum, line) => sum + lineCents(line), 0n)) / 100;
    const categories = snapshot.categories ?? [];
    const productMap = new Map(snapshot.products.map((product) => [product.id, product]));
    const issues = lines.map((line) => {
        const product = productMap.get(line.product_id);
        const quantity = quantityMilli(line.quantity);
        if (!product) return `${line.name}: товар недоступен`;
        if (quantity === null) return `${line.name}: введите количество больше нуля, до 3 знаков после запятой`;
        if (kind !== "receipt" && quantity > Math.round(Number(product.stock ?? 0) * 1000)) return `${line.name}: недостаточный остаток`;
        if (kind === "sale" && (product.price === null || Number(product.price) !== line.price)) return `${line.name}: цена изменилась`;
        return "";
    }).filter(Boolean);
    const pricesChanged = kind === "sale" && lines.some((line) => {
        const product = productMap.get(line.product_id);
        return product && product.price !== null && Number(product.price) !== line.price;
    });
    const filtered = snapshot.products.filter((product) =>
        (category === "all" || (category === "none" ? product.category_id === null : String(product.category_id) === category)) &&
        product.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));

    function changeKind(value: CartKind) {
        if (locked || value === kind) return;
        if (lines.length) { setNextKind(value); setDialog("mode"); }
        else setDraft({ lines: [], kind: value, pending: null });
    }
    function add(product: TerminalProduct) {
        if (locked || !ownShift) return;
        setCartError(""); setSavedTotal(null);
        const existing = lines.find((line) => line.product_id === product.id);
        if (!existing && lines.length >= 100) { setCartError("В корзине может быть до 100 товаров."); return; }
        const milli = existing ? quantityMilli(existing.quantity) ?? 0 : 0;
        if (kind !== "receipt" && milli + 1000 > Math.round(Number(product.stock ?? 0) * 1000) && milli > 0) {
            setCartError(`Недостаточно товара: ${product.name}. Количество можно изменить в корзине.`); return;
        }
        // A weighted item with less than 1 kg left can still be added and adjusted manually.
        const initial = kind !== "receipt" && Number(product.stock ?? 0) < 1 ? Number(product.stock ?? 0) : 1;
        setDraft({ ...draft, lines: existing ? lines.map((line) => line.product_id === product.id
            ? { ...line, quantity: String((milli + 1000) / 1000) } : line)
            : [...lines, { product_id: product.id, name: product.name, unit: product.unit ?? "шт", price: product.price === null ? null : Number(product.price), quantity: String(initial) }] });
    }
    function quantity(id: string, value: string) {
        if (locked) return;
        setDraft({ ...draft, lines: lines.map((line) => line.product_id === id ? { ...line, quantity: value } : line) });
        setCartError("");
    }
    function remove(id: string) {
        if (!locked) setDraft({ ...draft, lines: lines.filter((line) => line.product_id !== id) });
    }

    function save() {
        if (checkoutBusy.current || busy || (!pending && (!ownShift || !lines.length || issues.length))) return;
        checkoutBusy.current = true;
        setCartError(""); setStorageError(false);
        const request: PendingCheckout = pending ?? {
            request_id: crypto.randomUUID(), kind,
            items: lines.map((line) => ({ product_id: line.product_id, quantity: quantityMilli(line.quantity)! / 1000, expected_price: line.price })),
        };
        const submitted = { ...draft, pending: request };
        // Save the request ID before sending; an uncertain network result can be retried safely.
        try { sessionStorage.setItem(draftKey, JSON.stringify(submitted)); }
        catch { setStorageError(true); }
        setDraft(submitted);
        void run(async () => {
            try {
                const response = await terminalRequest<{ data: { id: string; total: number } }>({ action: "checkout", token, ...request });
                if (!response.data?.id || response.data.id !== request.request_id) throw new TerminalError("Не удалось подтвердить результат. Повторите сохранение этой корзины.", 0);
                const cleared: CartDraft = { lines: [], kind, pending: null };
                // Persist immediately: background refresh must not leave an already sold draft.
                try { sessionStorage.setItem(draftKey, JSON.stringify(cleared)); } catch { /* Cleared in memory below. */ }
                setDraft(cleared);
                setSavedTotal(Number(response.data.total));
            } catch (error) {
                // 4xx responses mean the database rejected the transaction. 0/5xx may be an uncertain result.
                if (error instanceof TerminalError && error.status >= 400 && error.status < 500 && error.status !== 401) {
                    setDraft({ ...draft, pending: null });
                    await refresh();
                }
                throw error;
            }
        }, kind === "sale" ? "Продажа сохранена, остатки и касса обновлены." : `Операция «${kindName[kind]}» сохранена.`).finally(() => { checkoutBusy.current = false; });
    }

    return <>
        <header className="pos-header">
            <div><span className="pos-eyebrow">РАБОЧЕЕ МЕСТО КАССИРА</span><h1>{snapshot.store.name}</h1><p>{snapshot.cashier.name} · {ownShift ? "Ваша смена открыта" : "Смена не открыта"}</p></div>
            <nav aria-label="Действия кассира"><button disabled={busy} onClick={() => void refresh()}>↻ Обновить</button><button disabled={busy} onClick={() => setDialog("shift")}>Смена и касса</button><button disabled={busy} onClick={() => setDialog("history")}>История</button><button disabled={busy} onClick={() => setDialog("logout")}>Выйти</button></nav>
        </header>
        {error && <p className="store-error" role="alert">{error}</p>}
        {notice && <p className="store-notice" role="status">{notice}</p>}
        {!ownShift && <div className="pos-shift-notice">{snapshot.shift ? `Сейчас работает ${snapshot.shift.cashier_name}. Дождитесь закрытия его смены.` : "Откройте смену, чтобы начать работу."}{!snapshot.shift && <button onClick={() => setDialog("shift")}>Открыть смену</button>}</div>}
        <div className="pos-mode" role="group" aria-label="Тип операции">{(["sale", "receipt", "writeoff"] as CartKind[]).map((value) => <button key={value} disabled={locked} aria-pressed={kind === value} onClick={() => changeKind(value)}>{kindName[value]}</button>)}</div>
        <div className="pos-mobile-switch" role="group" aria-label="Раздел кассы"><button aria-pressed={mobileView === "products"} onClick={() => setMobileView("products")}>Товары</button><button aria-pressed={mobileView === "cart"} onClick={() => setMobileView("cart")}>Корзина · {lines.length} · {money(total)}</button></div>
        {cartError && <p className="store-error" role="alert">{cartError}</p>}
        {savedTotal !== null && <p className="store-notice" role="status">{kind === "sale" ? `Продажа сохранена на сумму ${money(savedTotal)}.` : "Операция сохранена."}</p>}
        <div className={`pos-layout pos-show-${mobileView}`}>
            <section className="pos-catalog" aria-label="Каталог товаров">
                <div className="pos-catalog-top"><h2>Товары <span>{filtered.length}</span></h2><label className="pos-search"><span className="pos-sr-only">Поиск товаров</span><input placeholder="Поиск по названию" value={search} onChange={(event) => setSearch(event.target.value)} /></label></div>
                <div className="pos-categories" role="group" aria-label="Категории"><button aria-pressed={category === "all"} onClick={() => setCategory("all")}>Все товары</button>{categories.map((item) => <button key={item.id} aria-pressed={category === String(item.id)} onClick={() => setCategory(String(item.id))}>{item.name}</button>)}<button aria-pressed={category === "none"} onClick={() => setCategory("none")}>Без категории</button></div>
                <div className="pos-products">{filtered.map((product) => {
                    const selected = lines.find((line) => line.product_id === product.id);
                    const unavailable = kind !== "receipt" && Number(product.stock ?? 0) <= 0;
                    return <button className="pos-product" key={product.id} disabled={locked || !ownShift || unavailable || (kind === "sale" && product.price === null)} onClick={() => add(product)}>
                        <span className="pos-product-category">{categories.find((item) => item.id === product.category_id)?.name ?? "Без категории"}</span>
                        <strong>{product.name}</strong><span className="pos-product-price">{product.price === null ? "Цена не задана" : money(Number(product.price))}<small> / {product.unit ?? "шт"}</small></span>
                        <span className="pos-product-bottom"><span>{unavailable ? "Нет в наличии" : `Остаток: ${product.stock ?? 0} ${product.unit ?? "шт"}`}</span><span className="pos-product-add">{selected ? selected.quantity : "+"}</span></span>
                    </button>;
                })}</div>
                {!filtered.length && <div className="pos-empty">Товаров в этой категории пока нет.</div>}
            </section>

            <aside className="pos-cart" aria-label="Корзина">
                <div className="pos-cart-heading"><div><span className="pos-eyebrow">{kindName[kind]}</span><h2>Корзина <span>{lines.length}</span></h2></div><button className="pos-clear" disabled={locked || !lines.length} onClick={() => setDialog("clear")}>Очистить</button></div>
                <div className="pos-cart-lines">{!lines.length ? <div className="pos-empty"><span className="pos-empty-icon">＋</span><strong>Корзина пуста</strong><p>Нажмите на товар слева, чтобы добавить его.</p></div> : lines.map((line) => <article className="pos-cart-line" key={line.product_id}>
                    <div className="pos-line-title"><strong>{line.name}</strong><button disabled={locked} onClick={() => remove(line.product_id)} aria-label={`Удалить ${line.name}`}>✕</button></div>
                    <p>{line.price === null ? "Без цены" : money(line.price)} / {line.unit}</p>
                    <div className="pos-line-controls"><div className="pos-quantity"><button disabled={locked} aria-label={`Уменьшить количество ${line.name}`} onClick={() => {
                        const next = (quantityMilli(line.quantity) ?? 0) - 1000;
                        if (next <= 0) remove(line.product_id); else quantity(line.product_id, String(next / 1000));
                    }}>−</button><input aria-label={`Количество ${line.name}, ${line.unit}`} inputMode="decimal" disabled={locked} maxLength={16} value={line.quantity} onFocus={(event) => event.target.select()} onChange={(event) => quantity(line.product_id, event.target.value)} /><button disabled={locked} aria-label={`Увеличить количество ${line.name}`} onClick={() => quantity(line.product_id, String(((quantityMilli(line.quantity) ?? 0) + 1000) / 1000))}>+</button></div><b>{money(Number(lineCents(line)) / 100)}</b></div>
                </article>)}</div>
                <div className="pos-cart-footer">
                    {!!issues.length && !pending && <div className="pos-cart-issues" role="alert">{issues.map((issue) => <p key={issue}>{issue}</p>)}{pricesChanged && <button disabled={locked} onClick={() => setDraft({ ...draft, lines: lines.map((line) => ({ ...line, price: productMap.get(line.product_id)?.price ?? line.price })) })}>Обновить цены</button>}</div>}
                    {pending && <p className="pos-pending" role="status">{busy ? "Сохраняем корзину…" : "Результат запроса не подтверждён. Повторите сохранение — повторного списания не будет."}</p>}
                    {storageError && <p role="alert">Браузер не сохранил черновик. Не закрывайте страницу до подтверждения операции.</p>}
                    <div className="pos-total"><span>{kind === "sale" ? "К оплате" : "Стоимость товаров"}</span><strong>{money(total)}</strong></div>
                    <button className="pos-save" disabled={busy || (!pending && (!ownShift || !lines.length || issues.length > 0))} onClick={save}>{busy ? "Сохранение…" : pending ? "Повторить сохранение" : "Сохранить"}</button>
                    <p className="pos-cart-hint">{kind === "sale" ? "Наличные · до 3 знаков после запятой для весовых товаров" : kind === "receipt" ? "Товары будут добавлены к остатку" : "Товары будут списаны с остатка"}</p>
                </div>
            </aside>
        </div>

        {dialog === "clear" && <TerminalDialog title="Очистить корзину?" onClose={() => setDialog(null)}><p>Все выбранные товары будут удалены из корзины. Это действие нельзя отменить.</p><div className="pos-dialog-actions"><button autoFocus onClick={() => setDialog(null)}>Отмена</button><button className="pos-danger" onClick={() => { setDraft({ ...draft, lines: [] }); setCartError(""); setDialog(null); }}>Да, очистить</button></div></TerminalDialog>}
        {dialog === "mode" && <TerminalDialog title={`Переключить на «${kindName[nextKind]}»?`} onClose={() => setDialog(null)}><p>Текущая корзина будет очищена. Несохранённые товары не будут проведены.</p><div className="pos-dialog-actions"><button autoFocus onClick={() => setDialog(null)}>Отмена</button><button className="pos-danger" onClick={() => { setDraft({ lines: [], kind: nextKind, pending: null }); setDialog(null); setSavedTotal(null); }}>Очистить и переключить</button></div></TerminalDialog>}
        {dialog === "logout" && <TerminalDialog title="Выйти из кассы?" onClose={() => setDialog(null)}><p>Выход не закрывает смену.{lines.length > 0 ? " Корзина сохранится на этом устройстве для вашего следующего входа." : ""}</p><div className="pos-dialog-actions"><button autoFocus disabled={busy} onClick={() => setDialog(null)}>Отмена</button><button disabled={busy} onClick={() => void run(async () => { try { await terminalRequest({ action: "logout", token }); } finally { logout(); } }, "")}>Выйти</button></div></TerminalDialog>}
        {dialog === "shift" && <TerminalDialog title="Смена и касса" onClose={() => { if (!busy) setDialog(null); }}>
            {error && <p className="store-error" role="alert">{error}</p>}
            {!snapshot.shift ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await terminalRequest({ action: "open_shift", token, opening_cash: Number(openingCash) }); setDialog(null); }, "Вы открыли смену."); }}><label>Наличные на открытии<input required type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /></label><button className="pos-save" disabled={busy}>Открыть мою смену</button></form>
                : ownShift ? <><p>Открыта {new Date(snapshot.shift.opened_at).toLocaleString("ru-RU")}</p><dl className="pos-shift-totals"><dt>На открытии</dt><dd>{money(Number(snapshot.shift.opening_cash))}</dd><dt>Выручка</dt><dd>{money(Number(snapshot.shift.revenue))}</dd><dt>Ожидается в кассе</dt><dd>{money(Number(snapshot.shift.opening_cash) + Number(snapshot.shift.revenue))}</dd></dl>
                    <form onSubmit={(event) => { event.preventDefault(); void run(async () => { await terminalRequest({ action: "close_shift", token, shift_id: snapshot.shift!.id, closing_cash: Number(closingCash) }); setClosingCash(""); setDialog(null); }, "Смена закрыта."); }}><label>Фактически наличных<input required type="number" inputMode="decimal" min="0" max="9999999999.99" step="0.01" value={closingCash} onChange={(event) => setClosingCash(event.target.value)} /></label><button className="pos-save" disabled={busy || lines.length > 0 || !!pending}>Закрыть мою смену</button></form>{lines.length > 0 && <p>Сначала сохраните или очистите корзину.</p>}</>
                    : <p>Смена открыта кассиром {snapshot.shift.cashier_name}. Дождитесь её закрытия.</p>}
        </TerminalDialog>}
        {dialog === "history" && <TerminalDialog title="Мои последние операции" onClose={() => setDialog(null)}><div className="pos-history">{snapshot.movements.map((item) => <article key={item.id}><strong>{productMap.get(item.product_id)?.name ?? "Товар"}</strong><p>{item.note} · {item.direction > 0 ? "+" : "−"}{item.quantity}</p><small>{new Date(item.created_at).toLocaleString("ru-RU")}</small></article>)}{!snapshot.movements.length && <p>Операций пока нет.</p>}</div></TerminalDialog>}
    </>;
}
