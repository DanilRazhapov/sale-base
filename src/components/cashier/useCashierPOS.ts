import { useEffect, useRef, useState } from "react";
import { terminalRequest, TerminalError } from "../../lib/cashierTerminal";
import {
    lineCents,
    quantityMilli,
    readCartDraft,
    type CartDraft,
    type CartKind,
    type PendingCheckout,
    type TerminalProduct,
} from "../../lib/cashierCart";
import { kindName } from "../../lib/cashierFormat";
import type { CashierPOSProps } from "./types";

export function useCashierPOS({ token, snapshot, busy, refresh, run }: CashierPOSProps) {
    const draftKey = `salebase.cart.${snapshot.cashier.id}`;
    const [draft, setDraft] = useState<CartDraft>(() => readCartDraft(draftKey));
    const [mobileView, setMobileView] = useState<"products" | "cart">("products");
    const [dialog, setDialog] = useState<"clear" | "logout" | "shift" | "history" | "mode" | null>(null);
    const [nextKind, setNextKind] = useState<CartKind>("sale");
    const [cartError, setCartError] = useState("");
    const [savedTotal, setSavedTotal] = useState<number | null>(null);
    const [storageError, setStorageError] = useState(false);
    const checkoutBusy = useRef(false);

    useEffect(() => {
        try {
            sessionStorage.setItem(draftKey, JSON.stringify(draft));
        } catch {
            /* Checkout reports storage failures before sending a transaction. */
        }
    }, [draft, draftKey]);

    const { lines, kind, pending } = draft;
    const ownShift = !!snapshot.shift && snapshot.shift.cashier_id === snapshot.cashier.id;
    const locked = busy || !!pending;
    const total = Number(lines.reduce((sum, line) => sum + lineCents(line), 0n)) / 100;
    const productMap = new Map(snapshot.products.map((product) => [product.id, product]));

    const issues = lines
        .map((line) => {
            const product = productMap.get(line.product_id);
            const quantity = quantityMilli(line.quantity);

            if (!product) return `${line.name}: товар недоступен`;

            if (quantity === null) return `${line.name}: введите количество больше нуля, до 3 знаков после запятой`;

            if (kind !== "receipt" && quantity > Math.round(Number(product.stock ?? 0) * 1000))
                return `${line.name}: недостаточный остаток`;

            if (kind === "sale" && (product.price === null || Number(product.price) !== line.price))
                return `${line.name}: цена изменилась`;

            return "";
        })
        .filter(Boolean);

    const pricesChanged =
        kind === "sale" &&
        lines.some((line) => {
            const product = productMap.get(line.product_id);
            return product && product.price !== null && Number(product.price) !== line.price;
        });

    function changeKind(value: CartKind) {
        if (locked || value === kind) return;
        if (lines.length) {
            setNextKind(value);
            setDialog("mode");
        } else setDraft({ lines: [], kind: value, pending: null });
    }
    function add(product: TerminalProduct) {
        if (locked || !ownShift) return;
        setCartError("");
        setSavedTotal(null);
        const existing = lines.find((line) => line.product_id === product.id);
        if (!existing && lines.length >= 100) {
            setCartError("В корзине может быть до 100 товаров.");
            return;
        }

        const milli = existing ? (quantityMilli(existing.quantity) ?? 0) : 0;
        if (kind !== "receipt" && milli + 1000 > Math.round(Number(product.stock ?? 0) * 1000) && milli > 0) {
            setCartError(`Недостаточно товара: ${product.name}. Количество можно изменить в корзине.`);
            return;
        }
        // A weighted item with less than 1 kg left can still be added and adjusted manually.
        const initial = kind !== "receipt" && Number(product.stock ?? 0) < 1 ? Number(product.stock ?? 0) : 1;

        setDraft({
            ...draft,
            lines: existing
                ? lines.map((line) =>
                      line.product_id === product.id ? { ...line, quantity: String((milli + 1000) / 1000) } : line,
                  )
                : [
                      ...lines,
                      {
                          product_id: product.id,
                          name: product.name,
                          unit: product.unit ?? "шт",
                          price: product.price === null ? null : Number(product.price),
                          quantity: String(initial),
                      },
                  ],
        });
    }
    function quantity(id: string, value: string) {
        if (locked) return;
        setDraft({
            ...draft,
            lines: lines.map((line) => (line.product_id === id ? { ...line, quantity: value } : line)),
        });
        setCartError("");
    }
    function remove(id: string) {
        if (!locked)
            setDraft({
                ...draft,
                lines: lines.filter((line) => line.product_id !== id),
            });
    }

    function save() {
        if (checkoutBusy.current || busy || (!pending && (!ownShift || !lines.length || issues.length))) return;
        checkoutBusy.current = true;
        setCartError("");
        setStorageError(false);
        const request: PendingCheckout = pending ?? {
            request_id: crypto.randomUUID(),
            kind,
            items: lines.map((line) => ({
                product_id: line.product_id,
                quantity: quantityMilli(line.quantity)! / 1000,
                expected_price: line.price,
            })),
        };
        const submitted = { ...draft, pending: request };
        // Save the request ID before sending; an uncertain network result can be retried safely.
        try {
            sessionStorage.setItem(draftKey, JSON.stringify(submitted));
        } catch {
            setStorageError(true);
        }
        setDraft(submitted);
        void run(
            async () => {
                try {
                    const response = await terminalRequest<{
                        data: { id: string; total: number };
                    }>({ action: "checkout", token, ...request });
                    if (!response.data?.id || response.data.id !== request.request_id)
                        throw new TerminalError(
                            "Не удалось подтвердить результат. Повторите сохранение этой корзины.",
                            0,
                        );
                    const cleared: CartDraft = {
                        lines: [],
                        kind,
                        pending: null,
                    };
                    // Persist immediately: background refresh must not leave an already sold draft.
                    try {
                        sessionStorage.setItem(draftKey, JSON.stringify(cleared));
                    } catch {
                        /* Cleared in memory below. */
                    }
                    setDraft(cleared);
                    setSavedTotal(Number(response.data.total));
                } catch (error) {
                    // 4xx responses mean the database rejected the transaction. 0/5xx may be an uncertain result.
                    if (
                        error instanceof TerminalError &&
                        error.status >= 400 &&
                        error.status < 500 &&
                        error.status !== 401
                    ) {
                        setDraft({ ...draft, pending: null });
                        await refresh();
                    }
                    throw error;
                }
            },
            kind === "sale"
                ? "Продажа сохранена, остатки и касса обновлены."
                : `Операция «${kindName[kind]}» сохранена.`,
        ).finally(() => {
            checkoutBusy.current = false;
        });
    }

    return {
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
        setMobileView,
        dialog,
        setDialog,
        nextKind,
        cartError,
        setCartError,
        savedTotal,
        setSavedTotal,
        storageError,
        changeKind,
        add,
        quantity,
        remove,
        save,
    };
}

export type CashierPOSState = ReturnType<typeof useCashierPOS>;
