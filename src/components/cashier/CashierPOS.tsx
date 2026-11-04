import { ui } from "../../lib/ui";
import type { CartKind } from "../../lib/cashierCart";
import { money, kindName } from "../../lib/cashierFormat";
import { useCashierPOS } from "./useCashierPOS";
import type { CashierPOSProps } from "./types";
import { CashierCatalog } from "./CashierCatalog";
import { CashierCart } from "./CashierCart";
import { CashierDialogs } from "./CashierDialogs";
import { PosIcon } from "./PosIcon";

const operationKinds: CartKind[] = ["sale", "receipt", "writeoff"];

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
                <div className="pos-header-inner">
                    <div className="pos-identity">
                        <span className="brand-mark" aria-hidden="true" />
                        <div>
                            <span className="pos-eyebrow">SaleBase / Контур</span>
                            <h1>
                                Касса <span>/</span> {snapshot.store.name}
                            </h1>
                        </div>
                    </div>
                    <nav aria-label="Действия кассира">
                        <button
                            className={ui.button + " pos-header-action"}
                            disabled={busy}
                            onClick={() => void refresh()}
                        >
                            <PosIcon name="refresh" /> Обновить
                        </button>
                        <button
                            className={ui.button + " pos-header-action"}
                            disabled={busy}
                            onClick={() => setDialog("shift")}
                        >
                            <PosIcon name="clock" /> Смена и касса
                        </button>
                        <button
                            className={ui.button + " pos-header-action"}
                            disabled={busy}
                            onClick={() => setDialog("history")}
                        >
                            <PosIcon name="history" /> История
                        </button>
                        <button
                            className={ui.button + " pos-header-action"}
                            disabled={busy}
                            onClick={() => setDialog("logout")}
                        >
                            <PosIcon name="logout" /> Выйти
                        </button>
                    </nav>
                </div>
            </header>
            <div className="pos-workspace">
                <div className="pos-toolbar">
                    <div className="pos-operation-tabs" role="group" aria-label="Тип операции">
                        {operationKinds.map((value) => (
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
                    <div className="pos-shift-indicator" data-active={ownShift}>
                        <span className="pos-shift-dot" aria-hidden="true" />
                        <div>
                            <strong>{snapshot.cashier.name}</strong>
                            <p>
                                {ownShift
                                    ? "Ваша смена открыта"
                                    : snapshot.shift
                                      ? "Работает другой кассир"
                                      : "Смена не открыта"}
                            </p>
                        </div>
                    </div>
                </div>
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
                        <p>
                            {snapshot.shift
                                ? `Сейчас работает ${snapshot.shift.cashier_name}. Дождитесь закрытия его смены.`
                                : "Откройте смену, чтобы начать работу."}
                        </p>
                        {!snapshot.shift && (
                            <button
                                className={ui.button + " pos-shift-open"}
                                disabled={busy}
                                onClick={() => setDialog("shift")}
                            >
                                Открыть смену <PosIcon name="arrow" />
                            </button>
                        )}
                    </div>
                )}
                <div className="pos-mobile-tabs" role="group" aria-label="Раздел кассы">
                    <button
                        className={ui.button}
                        aria-pressed={mobileView === "products"}
                        aria-controls="pos-catalog"
                        onClick={() => setMobileView("products")}
                    >
                        <PosIcon name="box" /> Товары
                    </button>
                    <button
                        className={ui.button}
                        aria-pressed={mobileView === "cart"}
                        aria-controls="pos-cart"
                        onClick={() => setMobileView("cart")}
                    >
                        <PosIcon name="basket" /> <span>Корзина · {lines.length}</span> <strong>{money(total)}</strong>
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
            </div>

            <CashierDialogs {...props} {...pos} />
        </>
    );
}
