import { useCallback, useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { AuthContext, cashierStorageKey } from "./session";

export function AuthProvider({ children }: { children: ReactNode }) {
    const [owner, setOwner] = useState<Session | null>(null);
    const [loading, setLoading] = useState(navigator.onLine);
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
            // Keep the token in memory if browser storage is unavailable.
        }
        setToken(token);
    }, []);
    useEffect(() => {
        let active = true;
        let authChanged = false;
        // An unavailable session refresh must not prevent the offline app from opening.
        const offline = () => { if (active) setLoading(false); };
        window.addEventListener("offline", offline);
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
            window.removeEventListener("offline", offline);
            data.subscription.unsubscribe();
        };
    }, []);
    return (
        <AuthContext.Provider value={{ owner, cashierToken, loading, setCashierToken }}>
            {children}
        </AuthContext.Provider>
    );
}
