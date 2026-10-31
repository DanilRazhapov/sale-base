import { ui } from "../lib/ui";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import type { TerminalSnapshot } from "../lib/cashierCart";
import { CashierPOS } from "../components/cashier/CashierPOS";

const storageKey = "salebase.cashier-session";
const errorText = (error: unknown) => error instanceof Error ? error.message : "Не удалось выполнить операцию.";

function CashierWorkspace({ token, onLogout }: { token: string; onLogout: () => void }) {
    const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const version = useRef(0);

    const load = useCallback(async () => {
        const current = ++version.current;
        try {
            const response = await terminalRequest<{ data: TerminalSnapshot }>({ action: "snapshot", token });
            if (current !== version.current) return;
            setSnapshot(response.data); setError("");
        } catch (error) {
            if (current !== version.current) return;
            if (error instanceof TerminalError && error.status === 401) { onLogout(); return; }
            setError(errorText(error));
        }
    }, [token, onLogout]);

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => { if (!working.current) void load(); };
        const invalidate = () => { ++version.current; };
        const timer = window.setInterval(refresh, 15000);
        window.addEventListener("focus", refresh);
        return () => { invalidate(); window.clearTimeout(initial); window.clearInterval(timer); window.removeEventListener("focus", refresh); };
    }, [load]);

    async function run(action: () => Promise<void>, success: string) {
        if (working.current) return;

        working.current = true; ++version.current;
        setBusy(true); setError(""); setNotice("");

        try { await action(); setNotice(success); await load(); } 
        catch (error) {
            if (error instanceof TerminalError && error.status === 401) { onLogout(); return; }
            setError(errorText(error));
        } finally { working.current = false; setBusy(false); }
    }

    return <main className="pos-page">
        {snapshot ? <CashierPOS token={token} snapshot={snapshot} busy={busy} refresh={load} logout={onLogout} run={run} error={error} notice={notice} />
            : <div className="mx-auto mt-[15vh] max-w-lg text-center [&_h1]:mb-4 [&_button]:m-2"><h1 className={ui.title}>Рабочее место кассира</h1>{error ? <><p role="alert">{error}</p><button className={ui.button} onClick={() => void load()}>Повторить</button><button className={ui.button} onClick={onLogout}>К входу</button></> : <p role="status">Загрузка товаров и смены…</p>}</div>}
    </main>;
}
export default function CashierPage() {
    const [token, setToken] = useState(() => { try { return sessionStorage.getItem(storageKey) ?? ""; } catch { return ""; } });
    const [name, setName] = useState("");
    const [pin, setPin] = useState("");
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const [error, setError] = useState("");
    const logout = useCallback(() => {
        try { sessionStorage.removeItem(storageKey); } catch { /* Storage can be unavailable. */ }
        setToken(""); setPin("");
    }, []);
    async function login(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (working.current) return;
        working.current = true; setBusy(true); setError("");
        try {
            const response = await terminalRequest<{ token: string }>({ action: "login", name: name.trim(), pin });
            if (!/^[0-9a-f]{64}$/.test(response.token)) throw new Error("Некорректный ответ авторизации.");
            try { sessionStorage.setItem(storageKey, response.token); } catch { /* Continue for this page lifetime. */ }
            setPin(""); setToken(response.token);
        } catch (error) { setError(errorText(error)); }
        finally { working.current = false; setBusy(false); }
    }
    if (token) return <CashierWorkspace key={token} token={token} onLogout={logout} />;
    return <main className="management-page"><h1 className={ui.title}>Вход кассира</h1><p>Введите своё имя и PIN.</p>
        <form onSubmit={login}><fieldset className={ui.fieldset} disabled={busy}>
            <label className={ui.label}>Имя кассира<input className={ui.input} name="username" autoComplete="username" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className={ui.label}>PIN<input className={ui.input} name="password" type="password" inputMode="numeric" autoComplete="current-password" required pattern="[0-9]{4,12}" minLength={4} maxLength={12} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} /></label>
            <button className={ui.button}>{busy ? "Вход..." : "Войти"}</button>
        </fieldset></form>
        {error && <p className={ui.error} role="alert">{error}</p>}
        <p>После пяти попыток входа за 15 минут вход временно блокируется. Сессия действует 12 часов.</p>
        <Link to="/login">Вход владельца</Link>
    </main>;
}
