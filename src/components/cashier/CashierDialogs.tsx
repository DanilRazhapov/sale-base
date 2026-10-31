import { useState } from "react";
import { ui } from "../../lib/ui";
import { money, kindName } from "../../lib/cashierFormat";
import type { CashierPOSProps } from "./types";
import type { CashierPOSState } from "./useCashierPOS";
import { TerminalDialog } from "../TerminalDialog";
import { terminalRequest } from "../../lib/cashierTerminal";

type Props = Pick<
    CashierPOSState,
    | "draft"
    | "setDraft"
    | "lines"
    | "pending"
    | "ownShift"
    | "productMap"
    | "dialog"
    | "setDialog"
    | "nextKind"
    | "setCartError"
    | "setSavedTotal"
> &
    Pick<CashierPOSProps, "token" | "snapshot" | "busy" | "error" | "logout" | "run">;

export function CashierDialogs({
    draft,
    setDraft,
    lines,
    pending,
    ownShift,
    productMap,
    dialog,
    setDialog,
    nextKind,
    setCartError,
    setSavedTotal,
    token,
    snapshot,
    busy,
    error,
    logout,
    run,
}: Props) {
    const [openingCash, setOpeningCash] = useState("0");
    const [closingCash, setClosingCash] = useState("");
    return (
        <>
            {dialog === "clear" && (
                <TerminalDialog title="Очистить корзину?" onClose={() => setDialog(null)}>
                    <p>Все выбранные товары будут удалены из корзины. Это действие нельзя отменить.</p>
                    <div className="dialog-actions">
                        <button className={ui.button} autoFocus onClick={() => setDialog(null)}>
                            Отмена
                        </button>
                        <button
                            className={ui.buttonBase + " button-danger"}
                            onClick={() => {
                                setDraft({ ...draft, lines: [] });
                                setCartError("");
                                setDialog(null);
                            }}
                        >
                            Да, очистить
                        </button>
                    </div>
                </TerminalDialog>
            )}
            {dialog === "mode" && (
                <TerminalDialog title={`Переключить на «${kindName[nextKind]}»?`} onClose={() => setDialog(null)}>
                    <p>Текущая корзина будет очищена. Несохранённые товары не будут проведены.</p>
                    <div className="dialog-actions">
                        <button className={ui.button} autoFocus onClick={() => setDialog(null)}>
                            Отмена
                        </button>
                        <button
                            className={ui.buttonBase + " button-danger"}
                            onClick={() => {
                                setDraft({
                                    lines: [],
                                    kind: nextKind,
                                    pending: null,
                                });
                                setDialog(null);
                                setSavedTotal(null);
                            }}
                        >
                            Очистить и переключить
                        </button>
                    </div>
                </TerminalDialog>
            )}
            {dialog === "logout" && (
                <TerminalDialog title="Выйти из кассы?" onClose={() => setDialog(null)}>
                    {error && (
                        <p className={ui.error} role="alert">
                            {error}
                        </p>
                    )}
                    <p>
                        Выход не закрывает смену.
                        {lines.length > 0 ? " Корзина сохранится на этом устройстве для вашего следующего входа." : ""}
                    </p>
                    <div className="dialog-actions">
                        <button className={ui.button} autoFocus disabled={busy} onClick={() => setDialog(null)}>
                            Отмена
                        </button>
                        <button
                            className={ui.button}
                            disabled={busy}
                            onClick={() =>
                                void run(async () => {
                                    await terminalRequest({
                                        action: "logout",
                                        token,
                                    });
                                    logout();
                                }, "")
                            }
                        >
                            Выйти
                        </button>
                    </div>
                </TerminalDialog>
            )}
            {dialog === "shift" && (
                <TerminalDialog
                    title="Смена и касса"
                    onClose={() => {
                        if (!busy) setDialog(null);
                    }}
                >
                    {error && (
                        <p className={ui.error} role="alert">
                            {error}
                        </p>
                    )}
                    {!snapshot.shift ? (
                        <form
                            onSubmit={(event) => {
                                event.preventDefault();
                                void run(async () => {
                                    await terminalRequest({
                                        action: "open_shift",
                                        token,
                                        opening_cash: Number(openingCash),
                                    });
                                    setDialog(null);
                                }, "Вы открыли смену.");
                            }}
                        >
                            <label className={ui.label}>
                                Наличные на открытии
                                <input
                                    className={ui.input}
                                    required
                                    type="number"
                                    inputMode="decimal"
                                    min="0"
                                    max="9999999999.99"
                                    step="0.01"
                                    value={openingCash}
                                    onChange={(event) => setOpeningCash(event.target.value)}
                                />
                            </label>
                            <button className={ui.buttonBase + " button-primary"} disabled={busy}>
                                Открыть мою смену
                            </button>
                        </form>
                    ) : ownShift ? (
                        <>
                            <p>Открыта {new Date(snapshot.shift.opened_at).toLocaleString("ru-RU")}</p>
                            <dl className="pos-shift-totals">
                                <dt>На открытии</dt>
                                <dd>{money(Number(snapshot.shift.opening_cash))}</dd>
                                <dt>Выручка</dt>
                                <dd>{money(Number(snapshot.shift.revenue))}</dd>
                                <dt>Ожидается в кассе</dt>
                                <dd>{money(Number(snapshot.shift.opening_cash) + Number(snapshot.shift.revenue))}</dd>
                            </dl>
                            <form
                                onSubmit={(event) => {
                                    event.preventDefault();
                                    void run(async () => {
                                        await terminalRequest({
                                            action: "close_shift",
                                            token,
                                            shift_id: snapshot.shift!.id,
                                            closing_cash: Number(closingCash),
                                        });
                                        setClosingCash("");
                                        setDialog(null);
                                    }, "Смена закрыта.");
                                }}
                            >
                                <label className={ui.label}>
                                    Фактически наличных
                                    <input
                                        className={ui.input}
                                        required
                                        type="number"
                                        inputMode="decimal"
                                        min="0"
                                        max="9999999999.99"
                                        step="0.01"
                                        value={closingCash}
                                        onChange={(event) => setClosingCash(event.target.value)}
                                    />
                                </label>
                                <button
                                    className={ui.buttonBase + " button-primary"}
                                    disabled={busy || lines.length > 0 || !!pending}
                                >
                                    Закрыть мою смену
                                </button>
                            </form>
                            {lines.length > 0 && <p>Сначала сохраните или очистите корзину.</p>}
                        </>
                    ) : (
                        <p>Смена открыта кассиром {snapshot.shift.cashier_name}. Дождитесь её закрытия.</p>
                    )}
                </TerminalDialog>
            )}
            {dialog === "history" && (
                <TerminalDialog title="Мои последние операции" onClose={() => setDialog(null)}>
                    <div className="pos-history">
                        {snapshot.movements.map((item) => (
                            <article key={item.id}>
                                <strong>{productMap.get(item.product_id)?.name ?? "Товар"}</strong>
                                <p>
                                    {item.note} · {item.direction > 0 ? "+" : "−"}
                                    {item.quantity}
                                </p>
                                <small>{new Date(item.created_at).toLocaleString("ru-RU")}</small>
                            </article>
                        ))}
                        {!snapshot.movements.length && <p>Операций пока нет.</p>}
                    </div>
                </TerminalDialog>
            )}
        </>
    );
}
