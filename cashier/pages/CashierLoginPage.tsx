import { useRef, useState, type FormEvent } from "react";
import { useCashierSession } from "../auth/session";
import { terminalRequest } from "../lib/cashierTerminal";
import { ui } from "../../shared/lib/ui";
import { TerminalPairing } from "../components/TerminalPairing";

export default function CashierLoginPage({ ownerAppUrl }: { ownerAppUrl?: string }) {
    const { setCashierSession } = useCashierSession();
    const [name, setName] = useState("");
    const [pin, setPin] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const working = useRef(false);
    async function login(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();

        if (working.current) return;
        working.current = true;

        setBusy(true);
        setError("");

        try {
            await terminalRequest({
                action: "login",
                name: name.trim(),
                pin,
            });

            setPin("");
            setCashierSession(true);
        } catch (error) {
            setError(error instanceof Error ? error.message : "Не удалось войти.");
        } finally {
            working.current = false;
            setBusy(false);
        }
    }
    return (
        <main className="login-page">
            <section className="login-card">
                <TerminalPairing />
                <span className={ui.eyebrow}>РАБОЧЕЕ МЕСТО КАССИРА</span>
                <h1 className={ui.title}>Вход кассира</h1>
                <p>Введите имя и PIN, выданные владельцем магазина.</p>
                <form onSubmit={login} aria-busy={busy}>
                    <fieldset className={ui.fieldset} disabled={busy}>
                        <label className={ui.label}>
                            Имя кассира
                            <input
                                className={ui.input}
                                name="username"
                                autoComplete="username"
                                required
                                maxLength={120}
                                value={name}
                                onChange={(event) => setName(event.target.value)}
                            />
                        </label>
                        <label className={ui.label}>
                            PIN
                            <input
                                className={ui.input}
                                name="password"
                                type="password"
                                inputMode="numeric"
                                autoComplete="current-password"
                                required
                                pattern="[0-9]{4,12}"
                                minLength={4}
                                maxLength={12}
                                value={pin}
                                onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
                            />
                        </label>
                        {error && (
                            <p className={ui.error} role="alert">
                                {error}
                            </p>
                        )}
                        <button className={ui.buttonBase + " button-primary"} type="submit">
                            {busy ? "Входим…" : "Войти в кассу"}
                        </button>
                    </fieldset>
                </form>
                <p>
                    Один аккаунт — одно рабочее место. Если кассир уже вошёл, повторный вход недоступен до выхода или
                    истечения сессии.
                </p>
                <p>После пяти попыток входа подождите 15 минут. Сессия действует 12 часов.</p>
                {ownerAppUrl && <a href={ownerAppUrl}>Кабинет владельца</a>}
            </section>
        </main>
    );
}
