import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export const cashierStorageKey = "salebase.cashier-session";
export type AuthState = {
    owner: Session | null;
    cashierToken: string;
    loading: boolean;
    setCashierToken: (token: string) => void;
};
export const AuthContext = createContext<AuthState | null>(null);
export function useAuth() {
    const auth = useContext(AuthContext);
    if (!auth) throw new Error("AuthProvider is required");
    return auth;
}
