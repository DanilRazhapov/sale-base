import { createContext, useContext } from "react";
import type { OfflineSession } from "./offlineCashier";

export const CashierSessionContext = createContext<{
    cashierSession: boolean | null;
    loading: boolean;
    offlineSession: OfflineSession | null;
    startSession: (offlineSession: OfflineSession | null) => void;
    endSession: () => void;
} | null>(null);

export function useCashierSession() {
    const session = useContext(CashierSessionContext);
    if (!session) throw new Error("CashierSessionProvider is required");
    return session;
}
