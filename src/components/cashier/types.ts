import type { TerminalSnapshot } from "../../lib/cashierCart";
export type CashierPOSProps = {
    token: string;
    snapshot: TerminalSnapshot;
    busy: boolean;
    error: string;
    notice: string;
    refresh: () => Promise<void>;
    logout: () => void;
    run: (action: () => Promise<void>, success: string) => Promise<void>;
};
