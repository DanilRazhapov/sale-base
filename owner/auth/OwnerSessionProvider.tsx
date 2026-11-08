import { useEffect, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { OwnerSessionContext } from "./session";

export function OwnerSessionProvider({ children }: { children: ReactNode }) {
    const [owner, setOwner] = useState<Session | null>(null);
    const [loading, setLoading] = useState(navigator.onLine);

    useEffect(() => {
        let active = true;
        let authChanged = false;
        // An unavailable session refresh must not prevent the login page from opening.
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
        <OwnerSessionContext.Provider value={{ owner, loading }}>
            {children}
        </OwnerSessionContext.Provider>
    );
}
