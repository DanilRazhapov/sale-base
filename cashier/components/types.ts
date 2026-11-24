import type { ReactNode } from "react";
import type { TerminalSnapshot } from "../lib/cashierCart";
import type { LocalOperation } from "../lib/indexedDb/localTypes";
export type CashierPOSProps = {
    sessionId: string;
    snapshot: TerminalSnapshot;
    busy: boolean;
    error: string;
    notice: string;
    syncNotice?: ReactNode;
    refresh: () => Promise<void>;
    logout: () => void;
    queueOperation: (operation: LocalOperation) => Promise<void>;
    changeShift: (cash: number, action: "open" | "close") => Promise<void>;
    run: (action: () => Promise<void>, success: string, refreshInBackground?: boolean) => Promise<void>;
};
