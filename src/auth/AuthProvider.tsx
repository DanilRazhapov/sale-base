import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthContext, cashierStorageKey } from "./session";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [owner, setOwner] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [cashierToken, setToken] = useState(() => {
        try {
            return sessionStorage.getItem(cashierStorageKey) ?? "";
        } catch {
            return "";
        }
    });
    const setCashierToken = useCallback((token: string) => {
        try {
            if (token) sessionStorage.setItem(cashierStorageKey, token);
            else sessionStorage.removeItem(cashierStorageKey);
        } catch {
            /* In-memory sessions still work when browser storage is unavailable. */
        }
        setToken(token);
    }, []);
    useEffect(() => {
        let active = true;
        let authChanged = false;
        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            authChanged = true;
            if (active) {
                setOwner(session);
                setLoading(false);
            }
        });
        void supabase.auth
            .getSession()
            .then(({ data }) => {
                if (active && !authChanged) {
                    setOwner(data.session);
                    setLoading(false);
                }
            })
            .catch(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
            data.subscription.unsubscribe();
        };
    }, []);
    return (
        <AuthContext.Provider value={{ owner, cashierToken, loading, setCashierToken }}>
            {children}
        </AuthContext.Provider>
    );
}
