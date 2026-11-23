import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ui } from "../../shared/lib/ui";
import { money } from "../lib/cashierFormat";
import { useCashierPOS } from "./useCashierPOS";
import type { CashierPOSProps } from "./types";
import { CashierCatalog } from "./CashierCatalog";
import { CashierCart } from "./CashierCart";
import { CashierDialogs } from "./CashierDialogs";
import type { CachedCatalog } from "../lib/indexedDb/localCategories";

function CashierHeader({ storeName, children }: { storeName: string; children?: ReactNode }) {
    return (
        <header className="pos-header">
            <div className="pos-brand">
                <span className="pos-wordmark">salebase</span>
                <span className="pos-brand-label">Касса</span>
            </div>
            <h1 className="pos-store-name" title={storeName}>
                {storeName}
            </h1>
            {children}
        </header>
    );
}

export function CashierPOS(props: CashierPOSProps | { catalog: CachedCatalog; onRetry: () => Promise<void> }) {
    if ("catalog" in props) {
        const { catalog, onRetry } = props;
        const savedAt = new Date(catalog.savedAt);
        return (
            <div className="pos-screen" data-view="products">
                <CashierHeader storeName={catalog.store.name} />
                <div className="pos-shift-warning">
                    <span role="status">
                        Офлайн. Каталог сохранён <time dateTime={savedAt.toISOString()}>{savedAt.toLocaleString("ru-RU")}</time>.
                    </span>
                    <button type="button" className={ui.button} onClick={() => void onRetry()}>
                        Проверить связь
                    </button>
                </div>
                <div className="pos-layout pos-layout--catalog-only">
                    <div className="pos-catalog-view">
                        <CashierCatalog snapshot={catalog} />
                    </div>
                </div>
            </div>
        );
    }
    return <ActiveCashierPOS {...props} />;
}

function ActiveCashierPOS(props: CashierPOSProps) {
    const { snapshot, busy, error, notice } = props;
    const pos = useCashierPOS(props);
    const { lines, kind, ownShift, total, mobileView, setMobileView, setDialog, cartError } = pos;
    const openCart = useRef<HTMLButtonElement>(null);
    const backToCatalog = useRef<HTMLButtonElement>(null);
    const previousView = useRef(mobileView);

    useLayoutEffect(() => {
        if (previousView.current === mobileView) return;
        previousView.current = mobileView;
        const button = (mobileView === "cart" ? backToCatalog : openCart).current;
        if (button?.getClientRects().length) button.focus({ preventScroll: true });
    }, [mobileView]);

    return (
        <div className="pos-screen" data-view={mobileView}>
            <CashierHeader storeName={snapshot.store.name}>
                <nav aria-label="Действия кассира">
                    <span className="pos-shift-status" data-open={ownShift}>
                        {ownShift ? "Смена открыта" : "Смена не открыта"}
                    </span>
                    <button className={ui.button} disabled={busy} onClick={() => setDialog("history")}>
                        История
                    </button>
                    <button
                        className={ui.button}
                        disabled={busy}
                        aria-label={`${snapshot.cashier.name} · Смена`}
                        onClick={() => setDialog("shift")}
                    >
                        <span className="pos-cashier-name">{snapshot.cashier.name} · </span>Смена
                    </button>
                </nav>
            </CashierHeader>
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
            {cartError && (
                <p className={ui.error} role="alert">
                    {cartError}
                </p>
            )}
            <div className="pos-layout">
                <div className="pos-catalog-view">
                    <CashierCatalog snapshot={snapshot} actions={pos} />
                    <button
                        ref={openCart}
                        className={ui.button + " pos-open-cart"}
                        onClick={() => setMobileView("cart")}
                    >
                        Открыть {kind === "sale" ? "чек" : "документ"} · {lines.length} поз. · {money(total)} →
                    </button>
                </div>

                <div className="pos-receipt-view">
                    <button
                        ref={backToCatalog}
                        className={ui.button + " pos-back-to-catalog"}
                        onClick={() => setMobileView("products")}
                    >
                        ← К товарам
                    </button>
                    <CashierCart {...props} {...pos} />
                </div>
            </div>

            <CashierDialogs {...props} {...pos} />
        </div>
    );
}
