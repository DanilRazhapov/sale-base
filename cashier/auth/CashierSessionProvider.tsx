import { useCallback, useEffect, useState, type ReactNode } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import { CashierSessionContext } from "./session";
import { flushPendingLogout, readCachedSessionId, rejectSession, type OfflineSession } from "./offlineCashier";

export function CashierSessionProvider({ children }: { children: ReactNode }) {
    const [cashierSession, setCashierSession] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(navigator.onLine);
    const [offlineSession, setOfflineSession] = useState<OfflineSession | null>(null);

    const startSession = useCallback((offline: OfflineSession | null) => {
        setOfflineSession(offline);
        setCashierSession(true);
    }, []);
    const endSession = useCallback(() => {
        setOfflineSession(null);
        setCashierSession(false);
    }, []);

    useEffect(() => {
        if (cashierSession !== null) return;
        const controller = new AbortController();

        async function restoreCashier() {
            let cachedSessionId: string | undefined;
            try {
                if (!navigator.onLine || await flushPendingLogout()) return;
                cachedSessionId = await readCachedSessionId();
                if (controller.signal.aborted) return;
                await terminalRequest(
                    { action: "snapshot" },
                    AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
                );
                if (!controller.signal.aborted) setCashierSession((previous) => previous ?? true);
            } catch (error) {
                if (!controller.signal.aborted && cachedSessionId && error instanceof TerminalError &&
                    error.status === 401 && error.code !== "CASHIER_SESSION_MISSING") {
                    await rejectSession(cachedSessionId);
                }
            } finally {
                if (!controller.signal.aborted) {
                    setCashierSession((previous) => previous ?? false);
                    setLoading(false);
                }
            }
        }

        void restoreCashier();
        return () => controller.abort();
    }, [cashierSession]);

    useEffect(() => {
        if (cashierSession !== false) return;
        const finishLogout = () => {
            if (navigator.onLine) void flushPendingLogout().catch(() => {
                // Keep the pending logout for the next connection or sign-in.
            });
        };
        finishLogout();
        window.addEventListener("online", finishLogout);
        return () => window.removeEventListener("online", finishLogout);
    }, [cashierSession]);

    return (
        <CashierSessionContext.Provider value={{ cashierSession, loading, offlineSession, startSession, endSession }}>
            {children}
        </CashierSessionContext.Provider>
    );
}
