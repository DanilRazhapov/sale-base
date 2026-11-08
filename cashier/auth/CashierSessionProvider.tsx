import { useEffect, useState, type ReactNode } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import { CashierSessionContext } from "./session";

export function CashierSessionProvider({ children }: { children: ReactNode }) {
    const [cashierSession, setCashierSession] = useState<boolean | null>(null);
    const [loading, setLoading] = useState(navigator.onLine);

    useEffect(() => {
        const controller = new AbortController();
        let checking = false;

        async function restoreCashier() {
            if (checking) return;
            checking = true;
            try {
                await terminalRequest(
                    { action: "snapshot" },
                    AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
                );
                finish(true);
            } catch (error) {
                if (error instanceof TerminalError && error.status === 401) finish(false);
            } finally {
                checking = false;
                if (!controller.signal.aborted) setLoading(false);
            }

            function finish(active: boolean) {
                if (controller.signal.aborted) return;
                setCashierSession((previous) => previous ?? active);
            }
        }

        const offline = () => setLoading(false);

        if (cashierSession === null) {
            if (navigator.onLine) void restoreCashier();
            window.addEventListener("online", restoreCashier);
            window.addEventListener("offline", offline);
        }
        return () => {
            controller.abort();
            window.removeEventListener("online", restoreCashier);
            window.removeEventListener("offline", offline);
        };
    }, [cashierSession]);

    return (
        <CashierSessionContext.Provider value={{ cashierSession, loading, setCashierSession }}>
            {children}
        </CashierSessionContext.Provider>
    );
}
