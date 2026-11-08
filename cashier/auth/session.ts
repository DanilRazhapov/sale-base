import { createContext, useContext } from "react";

export const CashierSessionContext = createContext<{
    cashierSession: boolean | null;
    loading: boolean;
    setCashierSession: (active: boolean) => void;
} | null>(null);

export function useCashierSession() {
    const session = useContext(CashierSessionContext);
    if (!session) throw new Error("CashierSessionProvider is required");
    return session;
}
