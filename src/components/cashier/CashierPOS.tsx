import { ui } from "../../lib/ui";
import type { CartKind } from "../../lib/cashierCart";
import { money, kindName } from "../../lib/cashierFormat";
import { useCashierPOS } from "./useCashierPOS";
import type { CashierPOSProps } from "./types";
import { CashierCatalog } from "./CashierCatalog";
import { CashierCart } from "./CashierCart";
import { CashierDialogs } from "./CashierDialogs";

export function CashierPOS(props: CashierPOSProps) {
    const { snapshot, busy, error, notice, refresh } = props;
    const pos = useCashierPOS(props);
    const {
        lines,
        kind,
        ownShift,
        locked,
        total,
        mobileView,
        setMobileView,
        setDialog,
        cartError,
        savedTotal,
        changeKind,
    } = pos;
    return (
        <>
            <header className="pos-header">
                <div>
                    <span className="pos-eyebrow">РАБОЧЕЕ МЕСТО КАССИРА</span>
                    <h1 className={ui.title}>{snapshot.store.name}</h1>
                    <p>
                        {snapshot.cashier.name} · {ownShift ? "Ваша смена открыта" : "Смена не открыта"}
                    </p>
                </div>
                <nav aria-label="Действия кассира">
                    <button className={ui.button} disabled={busy} onClick={() => void refresh()}>
                        ↻ Обновить
                    </button>
                    <button className={ui.button} disabled={busy} onClick={() => setDialog("shift")}>
                        Смена и касса
                    </button>
                    <button className={ui.button} disabled={busy} onClick={() => setDialog("history")}>
                        История
                    </button>
                    <button className={ui.button} disabled={busy} onClick={() => setDialog("logout")}>
                        Выйти
                    </button>
                </nav>
            </header>
            {error && (
                <p className={ui.error} role="alert">
                    {error}
                </p>
            )}
            {notice && (
                <p className={ui.notice} role="status">
                    {notice}
                </p>
            )}
            {!ownShift && (
                <div className="pos-shift-warning">
                    {snapshot.shift
                        ? `Сейчас работает ${snapshot.shift.cashier_name}. Дождитесь закрытия его смены.`
                        : "Откройте смену, чтобы начать работу."}
                    {!snapshot.shift && (
                        <button className={ui.button} onClick={() => setDialog("shift")}>
                            Открыть смену
                        </button>
                    )}
                </div>
            )}
            <div className="pos-operation-tabs" role="group" aria-label="Тип операции">
                {(["sale", "receipt", "writeoff"] as CartKind[]).map((value) => (
                    <button
                        className={ui.button}
                        key={value}
                        disabled={locked}
                        aria-pressed={kind === value}
                        onClick={() => changeKind(value)}
                    >
                        {kindName[value]}
                    </button>
                ))}
            </div>
            <div className="pos-mobile-tabs" role="group" aria-label="Раздел кассы">
                <button
                    className={ui.button}
                    aria-pressed={mobileView === "products"}
                    onClick={() => setMobileView("products")}
                >
                    Товары
                </button>
                <button
                    className={ui.button}
                    aria-pressed={mobileView === "cart"}
                    onClick={() => setMobileView("cart")}
                >
                    Корзина · {lines.length} · {money(total)}
                </button>
            </div>
            {cartError && (
                <p className={ui.error} role="alert">
                    {cartError}
                </p>
            )}
            {savedTotal !== null && (
                <p className={ui.notice} role="status">
                    {kind === "sale" ? `Продажа сохранена на сумму ${money(savedTotal)}.` : "Операция сохранена."}
                </p>
            )}
            <div className="pos-layout">
                <CashierCatalog snapshot={snapshot} {...pos} />

                <CashierCart {...props} {...pos} />
            </div>

            <CashierDialogs {...props} {...pos} />
        </>
    );
}
