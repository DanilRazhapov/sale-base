import type { PendingCheckout, TerminalProduct, TerminalSnapshot } from "../cashierCart";

export type LocalProduct = TerminalProduct & {
    store_id: string;
};

export type LocalCategory = TerminalSnapshot["categories"][number] & {
    store_id: string;
};

export type LocalOperation = {
    id: string;
    store_id: string;
    cashier_id: string;
    shift_id: string;
    created_at: number;
    checkout: PendingCheckout;
};