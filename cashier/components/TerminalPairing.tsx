import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import { ui } from "../../shared/lib/ui";
import { readBinding, saveBinding, type Binding } from "../auth/offlineCashier";

export function TerminalPairing({ loginBusy }: { loginBusy: boolean }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const working = useRef(false);
    const request = useRef<AbortController | null>(null);
    const [binding, setBinding] = useState<Binding | null>(null);
    const [checking, setChecking] = useState(true);
    const [online, setOnline] = useState(navigator.onLine);
    const [statusError, setStatusError] = useState("");
    const [code, setCode] = useState("");
    const [name, setName] = useState("Касса №1");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const refresh = useCallback(async () => {
        request.current?.abort();
        const controller = new AbortController();
        request.current = controller;
        setChecking(true);
        setStatusError("");
        try {
            const cached = await readBinding();
            if (controller.signal.aborted) return;
            setBinding(cached);
            if (!navigator.onLine) return;
            const result = await terminalRequest<Binding>(
                { action: "device" },
                AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
            );
            if (controller.signal.aborted) return;
            if (!result.device?.id || typeof result.store?.name !== "string") throw new Error("Invalid device response");
            setBinding(result);
            await saveBinding(result);
        } catch (error) {
            if (controller.signal.aborted) return;
            if (error instanceof TerminalError && error.status === 401) {
                setBinding(null);
                await saveBinding(null);
            } else setStatusError("Не удалось проверить привязку. Проверьте подключение.");
        } finally {
            if (!controller.signal.aborted) setChecking(false);
        }
    }, []);

    useEffect(() => {
        const initial = window.setTimeout(() => void refresh(), 0);
        const connectionChanged = () => {
            setOnline(navigator.onLine);
            if (!working.current) void refresh();
        };
        window.addEventListener("online", connectionChanged);
        window.addEventListener("offline", connectionChanged);
        return () => {
            request.current?.abort();
            window.clearTimeout(initial);
            window.removeEventListener("online", connectionChanged);
            window.removeEventListener("offline", connectionChanged);
        };
    }, [refresh]);

    function open() {
        setCode(""); setError(""); setNotice("");
        dialog.current?.showModal();
    }

    async function pair(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (working.current || !navigator.onLine || loginBusy) return;
        working.current = true; setBusy(true); setError(""); setNotice("");
        try {
            // The same-origin API stores the token in HttpOnly cookie. React
            // receives device metadata only, never the credential itself.
            const result = await terminalRequest<Binding>({ action: "pairing", code, name: name.trim() }, AbortSignal.timeout(20_000));
            if (!result.device?.id) throw new Error("Сервис не подтвердил подключение кассы.");
            setBinding(result); setCode("");
            await saveBinding(result);
            dialog.current?.close();
            setNotice("Касса подключена. Теперь войдите по имени и PIN.");
            if (navigator.onLine) await refresh();
            document.querySelector<HTMLInputElement>('input[name="username"]')?.focus();
        } catch (error) {
            setError(error instanceof Error ? error.message : "Не удалось подключить кассу.");
        } finally { working.current = false; setBusy(false); }
    }

    return <>
        <div className="pairing-login-status">
            <div>
                <strong>{binding?.store?.name ?? (binding ? "Магазин подключён" : online
                    ? (checking ? "Проверяем кассу…" : statusError ? "Нет связи с кассой" : "Касса не привязана")
                    : "Для проверки привязки нужна сеть")}</strong>
                <small>{binding ? binding.device.name : "Привязка устройства к магазину"}</small>
            </div>
            <button type="button" className={ui.button} disabled={!online || busy || checking || loginBusy} onClick={open}>
                {binding ? "Изменить привязку" : "Привязать кассу"}
            </button>
        </div>
        {online && statusError && <p className={ui.error} role="status">{statusError} <button type="button" onClick={() => void refresh()} disabled={checking || busy || loginBusy}>Повторить</button></p>}
        {notice && <p className={ui.notice} role="status">{notice}</p>}
        <dialog ref={dialog} className="terminal-dialog pairing-dialog" aria-labelledby="cashier-pairing-title">
            <div className="terminal-dialog-header">
                <h2 id="cashier-pairing-title">Привязать кассу</h2>
                <button type="button" className={ui.button} aria-label="Закрыть" onClick={() => dialog.current?.close()}>×</button>
            </div>
            <p className={ui.muted}>В кабинете владельца откройте магазин → «Кассы» → «Создать код подключения».</p>
            {binding && <p className={ui.muted}>Новый код заменит привязку в этом браузере. Прежняя касса останется в списке владельца, пока её не отключат.</p>}
            <form onSubmit={pair} aria-busy={busy}>
                <fieldset className={ui.fieldset} disabled={busy || !online}>
                    <label className={ui.label}>Код подключения
                        <input className={ui.input + " pairing-code-input"} name="pairing-code" inputMode="numeric" autoComplete="off"
                            required pattern="[0-9]{7}" minLength={7} maxLength={7} placeholder="0000000" value={code}
                            onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 7))} />
                    </label>
                    <label className={ui.label}>Название кассы
                        <input className={ui.input} name="device-name" autoComplete="off" required maxLength={120}
                            value={name} onChange={event => setName(event.target.value)} placeholder="Например, касса у входа" />
                    </label>
                    {error && <p className={ui.error} role="alert">{error}</p>}
                    <button className={ui.buttonBase + " button-primary"} type="submit" disabled={code.length !== 7 || !name.trim()}>
                        {busy ? "Подключаем…" : "Подключить кассу"}
                    </button>
                </fieldset>
            </form>
            {!online && <p className={ui.muted}>Подключитесь к сети, чтобы привязать кассу.</p>}
            <p className="pairing-hint">Код действует 5 минут и используется один раз. Привязка сохраняется после выхода кассира.</p>
        </dialog>
    </>;
}
