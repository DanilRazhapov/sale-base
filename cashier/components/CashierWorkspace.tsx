import { ui } from "../../shared/lib/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import type { TerminalSnapshot } from "../lib/cashierCart";
import { CashierPOS } from "./CashierPOS";
import Throbber from "../../shared/components/Throbber";
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить операцию.");

export function CashierWorkspace({ onLogout, onRestore }: { onLogout: () => void; onRestore: () => void }) {
    const [terminal, setTerminal] = useState<{ data: TerminalSnapshot; sessionId: string } | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const version = useRef(0);

    const load = useCallback(async () => {
        const current = ++version.current;
        try {
            const response = await terminalRequest<{ data: TerminalSnapshot; sessionId: string }>({ action: "snapshot" });
            if (current !== version.current) return;
            setTerminal(response);
            onRestore();
            setError("");
        } catch (error) {
            if (current !== version.current) return;
            if (error instanceof TerminalError && error.status === 401) {
                onLogout();
                return;
            }
            setError(errorText(error));
        }
    }, [onLogout, onRestore]);

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => {
            if (!working.current) void load();
        };
        const invalidate = () => {
            ++version.current;
        };
        const timer = window.setInterval(refresh, 15000);
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        return () => {
            invalidate();
            window.clearTimeout(initial);
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
        };
    }, [load]);

    async function run(action: () => Promise<void>, success: string) {
        if (working.current) return;

        working.current = true;
        ++version.current;
        setBusy(true);
        setError("");
        setNotice("");

        try {
            await action();
            setNotice(success);
            await load();
        } catch (error) {
            if (error instanceof TerminalError && error.status === 401) {
                onLogout();
                return;
            }
            setError(errorText(error));
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    return (
        <main className="pos-page">
            {terminal ? (
                <CashierPOS
                    key={terminal.sessionId}
                    sessionId={terminal.sessionId}
                    snapshot={terminal.data}
                    busy={busy}
                    refresh={load}
                    logout={onLogout}
                    run={run}
                    error={error}
                    notice={notice}
                />
            ) : (
                <div className="mx-auto mt-[15vh] max-w-lg text-center [&_h1]:mb-4 [&_button]:m-2">
                    <h1 className={ui.title}>Рабочее место кассира</h1>
                    {error ? (
                        <>
                            <p role="alert">{error}</p>
                            <button className={ui.button} onClick={() => void load()}>
                                Повторить
                            </button>
                            <button
                                className={ui.button}
                                disabled={busy}
                                onClick={() =>
                                    void run(async () => {
                                        await terminalRequest({
                                            action: "logout",
                                        });
                                        onLogout();
                                    }, "")
                                }
                            >
                                Выйти из кассы
                            </button>
                        </>
                    ) : (
                        <Throbber label="Загрузка товаров и смены..." className="min-h-vh"/>
                    )}
                </div>
            )}
        </main>
    );
}
