import { ui } from "../../shared/lib/ui";
import { money } from "../lib/cashierFormat";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { lineCents, quantityMilli, type CartLine } from "../lib/cashierCart";

type Props = Pick<
    CashierPOSState,
    | "draft"
    | "setDraft"
    | "lines"
    | "kind"
    | "pending"
    | "ownShift"
    | "locked"
    | "total"
    | "productMap"
    | "issues"
    | "pricesChanged"
    | "setDialog"
    | "storageError"
    | "quantity"
    | "remove"
    | "save"
> &
    Pick<CashierPOSProps, "busy">;

const cartTitle = {
    sale: "Текущая продажа",
    receipt: "Текущий приход",
    writeoff: "Текущее списание",
};

const checkoutLabel = {
    sale: "Завершить продажу",
    receipt: "Провести приход",
    writeoff: "Провести списание",
};

function QuantityControl({
    line,
    locked,
    kind,
    stock,
    quantity,
    remove,
}: Pick<Props, "locked" | "kind" | "quantity" | "remove"> & { line: CartLine; stock: number }) {
    const isWeight = line.unit === "кг";
    const isVolume = line.unit === "л";
    const milli = quantityMilli(line.quantity) ?? 0;
    const sliderMax =
        kind === "receipt" ? Math.max(10000, Math.ceil(milli / 1000) * 1000) : Math.max(1, Math.round(stock * 1000));
    const sliderValue = Math.min(sliderMax, Math.max(1, milli)) / 1000;

    function adjust(delta: number) {
        const next = milli + delta;
        if (next <= 0) remove(line.product_id);
        else quantity(line.product_id, String(next / 1000));
    }

    return (
        <div className="pos-quantity-editor">
            <div className="pos-quantity-row">
                <div className="pos-quantity-control">
                    {!isWeight && (
                        <button
                            className={ui.button}
                            disabled={locked}
                            aria-label={`Уменьшить количество ${line.name}`}
                            onClick={() => adjust(-1000)}
                        >
                            −
                        </button>
                    )}
                    <input
                        className={ui.input}
                        aria-label={`Количество ${line.name}, ${line.unit}`}
                        inputMode="decimal"
                        disabled={locked}
                        maxLength={16}
                        value={line.quantity}
                        onFocus={(event) => event.target.select()}
                        onChange={(event) => quantity(line.product_id, event.target.value)}
                    />
                    {!isWeight && !isVolume && (
                        <button
                            className={ui.button}
                            disabled={locked}
                            aria-label={`Увеличить количество ${line.name}`}
                            onClick={() => adjust(1000)}
                        >
                            +
                        </button>
                    )}
                </div>
                <b>{money(Number(lineCents(line)) / 100)}</b>
            </div>
            {isWeight && (
                <input
                    className="pos-quantity-slider"
                    type="range"
                    aria-label={`Вес ${line.name}, кг`}
                    aria-valuetext={`${sliderValue} кг`}
                    min={0.001}
                    max={sliderMax / 1000}
                    step={0.001}
                    disabled={locked || (kind !== "receipt" && stock < 0.001)}
                    value={sliderValue}
                    onChange={(event) => quantity(line.product_id, event.target.value)}
                />
            )}
            {isVolume && (
                <div className="pos-volume-increments" role="group" aria-label={`Добавить литры: ${line.name}`}>
                    {[500, 1000, 1500, 2000].map((increment) => (
                        <button
                            key={increment}
                            className={ui.button}
                            disabled={locked}
                            aria-label={`Добавить ${increment / 1000} л: ${line.name}`}
                            onClick={() => adjust(increment)}
                        >
                            +{increment / 1000}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export function CashierCart({
    draft,
    setDraft,
    lines,
    kind,
    pending,
    ownShift,
    locked,
    total,
    productMap,
    issues,
    pricesChanged,
    setDialog,
    storageError,
    quantity,
    remove,
    save,
    busy,
}: Props) {
    return (
        <aside className="pos-cart" aria-label={cartTitle[kind]}>
            <div className="pos-cart-header">
                <h2 className={ui.heading}>{cartTitle[kind]}</h2>
                <p>
                    {kind === "sale" ? "Новый чек" : "Новый документ"} · {lines.length} поз.
                </p>
            </div>
            <div className="pos-cart-lines">
                {!lines.length ? (
                    <div className="pos-cart-empty">
                        <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                        >
                            <path d="M3 3h2l2.4 12h11.2l2-8H5.8" />
                            <circle cx="9" cy="20" r="1" />
                            <circle cx="18" cy="20" r="1" />
                        </svg>
                        <strong>Нет Товаров</strong>
                    </div>
                ) : (
                    lines.map((line) => (
                        <article className="pos-cart-line" key={line.product_id}>
                            <div className="pos-cart-line-header">
                                <strong>{line.name}</strong>
                                <button
                                    className={ui.button}
                                    disabled={locked}
                                    onClick={() => remove(line.product_id)}
                                    aria-label={`Удалить ${line.name}`}
                                >
                                    ✕
                                </button>
                            </div>
                            <p className="pos-cart-line-price">
                                {line.quantity.replace(".", ",")} {line.unit}
                                {line.price === null ? " · Без цены" : ` × ${money(line.price)}`}
                            </p>
                            <QuantityControl
                                line={line}
                                locked={locked}
                                kind={kind}
                                stock={Number(productMap.get(line.product_id)?.stock ?? 0)}
                                quantity={quantity}
                                remove={remove}
                            />
                        </article>
                    ))
                )}
            </div>
            <div className="pos-cart-footer">
                {!!issues.length && !pending && (
                    <div className="pos-cart-issues" role="alert">
                        {issues.map((issue) => (
                            <p key={issue}>{issue}</p>
                        ))}
                        {pricesChanged && (
                            <button
                                className={ui.button}
                                disabled={locked}
                                onClick={() =>
                                    setDraft({
                                        ...draft,
                                        lines: lines.map((line) => ({
                                            ...line,
                                            price: productMap.get(line.product_id)?.price ?? line.price,
                                        })),
                                    })
                                }
                            >
                                Обновить цены
                            </button>
                        )}
                    </div>
                )}
                {pending && (
                    <p className="pos-pending" role="status">
                        {busy
                            ? "Сохраняем документ…"
                            : "Восстановлен черновик сохранения. Завершите его запись в очередь."}
                    </p>
                )}
                {storageError && (
                    <p role="alert">Браузер не смог обновить черновик корзины.</p>
                )}
                {kind === "sale" && <p className="pos-payment-method">Наличные</p>}
                <div className="pos-total">
                    <span>{kind === "sale" ? "К оплате" : "Стоимость товаров"}</span>
                    <strong>{money(total)}</strong>
                </div>
                <button
                    className={ui.buttonBase + " button-primary"}
                    disabled={busy || (!pending && (!ownShift || !lines.length || issues.length > 0))}
                    onClick={save}
                >
                    {busy ? "Сохранение…" : pending ? "Повторить сохранение" : `${checkoutLabel[kind]} →`}
                </button>
                <button
                    className={ui.button + " pos-clear-document"}
                    disabled={locked || !lines.length}
                    onClick={() => setDialog("clear")}
                >
                    Очистить документ
                </button>
            </div>
        </aside>
    );
}
