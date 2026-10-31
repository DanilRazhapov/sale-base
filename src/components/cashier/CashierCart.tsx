import { ui } from "../../lib/ui";
import { money, kindName } from "../../lib/cashierFormat";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { lineCents, quantityMilli, type CartLine } from "../../lib/cashierCart";

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
    | "mobileView"
    | "setDialog"
    | "storageError"
    | "quantity"
    | "remove"
    | "save"
> &
    Pick<CashierPOSProps, "busy">;

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
            <div className="row-between">
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
    mobileView,
    setDialog,
    storageError,
    quantity,
    remove,
    save,
    busy,
}: Props) {
    return (
        <aside className={"pos-cart" + (mobileView === "products" ? " max-sm:hidden" : "")} aria-label="Корзина">
            <div className="pos-cart-header">
                <div>
                    <span className="pos-eyebrow">{kindName[kind]}</span>
                    <h2 className={ui.heading}>
                        Корзина <span>{lines.length}</span>
                    </h2>
                </div>
                <button
                    className={ui.buttonBase + " button-soft-danger"}
                    disabled={locked || !lines.length}
                    onClick={() => setDialog("clear")}
                >
                    Очистить
                </button>
            </div>
            <div className="pos-cart-lines">
                {!lines.length ? (
                    <div className="empty-state">
                        <span className="pos-empty-icon">＋</span>
                        <strong>Корзина пуста</strong>
                        <p>Нажмите на товар слева, чтобы добавить его.</p>
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
                            <p>
                                {line.price === null ? "Без цены" : money(line.price)} / {line.unit}
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
                            ? "Сохраняем корзину…"
                            : "Результат запроса не подтверждён. Повторите сохранение — повторного списания не будет."}
                    </p>
                )}
                {storageError && (
                    <p role="alert">Браузер не сохранил черновик. Не закрывайте страницу до подтверждения операции.</p>
                )}
                <div className="pos-total">
                    <span>{kind === "sale" ? "К оплате" : "Стоимость товаров"}</span>
                    <strong>{money(total)}</strong>
                </div>
                <button
                    className={ui.buttonBase + " button-primary"}
                    disabled={busy || (!pending && (!ownShift || !lines.length || issues.length > 0))}
                    onClick={save}
                >
                    {busy ? "Сохранение…" : pending ? "Повторить сохранение" : "Сохранить"}
                </button>
                <p className="pos-checkout-hint">
                    {kind === "sale"
                        ? "Наличные · до 3 знаков после запятой для весовых товаров"
                        : kind === "receipt"
                          ? "Товары будут добавлены к остатку"
                          : "Товары будут списаны с остатка"}
                </p>
            </div>
        </aside>
    );
}
