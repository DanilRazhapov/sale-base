export type TerminalProduct = {
    id: string;
    name: string;
    stock: number | null;
    price: number | null;
    unit: string | null;
    category_id: number | null;
};
export type TerminalSnapshot = {
    store: { id: string; name: string };
    cashier: { id: string; name: string };
    categories: { id: number; name: string }[];
    products: TerminalProduct[];
    shift: {
        id: string;
        cashier_id: string;
        cashier_name: string;
        opened_at: string;
        opening_cash: number;
        revenue: number;
    } | null;
    movements: {
        id: string;
        product_id: string;
        quantity: number;
        direction: number;
        note: string;
        created_at: string;
    }[];
};
export type CartLine = {
    product_id: string;
    name: string;
    unit: string;
    price: number | null;
    quantity: string;
};
export type CartKind = "sale" | "receipt" | "writeoff";
export type CheckoutItem = {
    product_id: string;
    quantity: number;
    expected_price: number | null;
};
export type PendingCheckout = {
    request_id: string;
    items: CheckoutItem[];
    kind: CartKind;
};
export type CartDraft = {
    lines: CartLine[];
    kind: CartKind;
    pending: PendingCheckout | null;
};

export function quantityMilli(value: string): number | null {
    const normalized = value.trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,3})?$/.test(normalized)) return null;
    const parts = normalized.split(".");
    const milli = Number(parts[0]) * 1000 + Number((parts[1] ?? "").padEnd(3, "0"));

    return Number.isSafeInteger(milli) && milli > 0 && milli < 100000000000000 ? milli : null;
}

export function lineCents(line: Pick<CartLine, "price" | "quantity">): bigint {
    const milli = quantityMilli(line.quantity);
    if (milli === null || line.price === null || !Number.isFinite(line.price) || line.price < 0) return 0n;
    const cents = BigInt(Math.round(line.price * 100));
    return (cents * BigInt(milli) + 500n) / 1000n;
}

export function readCartDraft(key: string): CartDraft {
    const empty: CartDraft = { lines: [], kind: "sale", pending: null };
    try {
        const draft = JSON.parse(sessionStorage.getItem(key) ?? "null");
        if (
            !draft ||
            !Array.isArray(draft.lines) ||
            draft.lines.length > 100 ||
            !["sale", "receipt", "writeoff"].includes(draft.kind) ||
            draft.lines.some(
                (line: CartLine) =>
                    typeof line.product_id !== "string" ||
                    typeof line.name !== "string" ||
                    typeof line.unit !== "string" ||
                    typeof line.quantity !== "string" ||
                    (line.price !== null && (typeof line.price !== "number" || !Number.isFinite(line.price))),
            )
        )
            return empty;
        if (
            draft.pending &&
            (typeof draft.pending.request_id !== "string" ||
                !Array.isArray(draft.pending.items) ||
                !["sale", "receipt", "writeoff"].includes(draft.pending.kind))
        )
            return empty;
        return draft;
    } catch {
        return empty;
    }
}
