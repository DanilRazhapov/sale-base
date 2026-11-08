import { createContext, useContext } from "react";
import type { Session } from "@supabase/supabase-js";

export const OwnerSessionContext = createContext<{ owner: Session | null; loading: boolean } | null>(null);

export function useOwnerSession() {
    const session = useContext(OwnerSessionContext);
    if (!session) throw new Error("OwnerSessionProvider is required");
    return session;
}
