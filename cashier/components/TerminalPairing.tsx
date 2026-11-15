import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import { ui } from "../../shared/lib/ui";

type Binding = {
    device: { id: string; store_id: string; name: string };
    store?: { id: string; name: string };
};

export function TerminalPairing() {
    const dialog = useRef<HTMLDialogElement>(null);
    const working = useRef(false);
    const [binding, setBinding] = useState<Binding | null>(null);
    const [checking, setChecking] = useState(true);
    const [statusError, setStatusError] = useState("");
    const [code, setCode] = useState("");
    const [name, setName] = useState("Касса №1");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const refresh = useCallback(async (signal?: AbortSignal) => {
        setChecking(true);
        setStatusError("");
        try {
            const result = await terminalRequest<Binding>({ action: "device" }, signal);
            if (!result.device?.id || typeof result.store?.name !== "string") throw new Error("Invalid device response");
            if (!signal?.aborted) setBinding(result);
        } catch (error) {
            if (signal?.aborted) return;
            if (error instanceof TerminalError && error.status === 401) setBinding(null);
            else setStatusError("Не удалось проверить привязку. Проверьте подключение.");
        } finally {
            if (!signal?.aborted) setChecking(false);
        }
    }, []);

    useEffect(() => {
        const controller = new AbortController();
        const initial = window.setTimeout(() => void refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)])), 0);
        const reconnect = () => void refresh(AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]));
        window.addEventListener("online", reconnect);
        return () => { controller.abort(); window.clearTimeout(initial); window.removeEventListener("online", reconnect); };
    }, [refresh]);

    function open() {
        setCode(""); setError(""); setNotice("");
        dialog.current?.showModal();
    }

    async function pair(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (working.current) return;
        working.current = true; setBusy(true); setError(""); setNotice("");
        try {
            // The same-origin API stores the token in HttpOnly cookie. React
            // receives device metadata only, never the credential itself.
            const result = await terminalRequest<Binding>({ action: "pairing", code, name: name.trim() });
            if (!result.device?.id) throw new Error("Сервис не подтвердил подключение кассы.");
            setBinding(result); setCode("");
            dialog.current?.close();
            setNotice("Касса подключена. Теперь войдите по имени и PIN.");
            await refresh(AbortSignal.timeout(8000));
            document.querySelector<HTMLInputElement>('input[name="username"]')?.focus();
        } catch (error) {
            setError(error instanceof Error ? error.message : "Не удалось подключить кассу.");
        } finally { working.current = false; setBusy(false); }
    }

    return <>
        <div className="pairing-login-status">
            <div>
                <strong>{checking ? "Проверяем кассу…" : statusError ? "Нет связи с кассой" : binding?.store?.name ?? (binding ? "Магазин подключён" : "Касса не привязана")}</strong>
                <small>{binding ? binding.device.name : "Привязка устройства к магазину"}</small>
            </div>
            <button type="button" className={ui.button} disabled={busy || checking} onClick={open}>
                {binding ? "Изменить привязку" : "Привязать кассу"}
            </button>
        </div>
        {statusError && <p className={ui.error} role="status">{statusError} <button type="button" onClick={() => void refresh(AbortSignal.timeout(8000))} disabled={checking}>Повторить</button></p>}
        {notice && <p className={ui.notice} role="status">{notice}</p>}
        <dialog ref={dialog} className="terminal-dialog pairing-dialog" aria-labelledby="cashier-pairing-title">
            <div className="terminal-dialog-header">
                <h2 id="cashier-pairing-title">Привязать кассу</h2>
                <button type="button" className={ui.button} aria-label="Закрыть" onClick={() => dialog.current?.close()}>×</button>
            </div>
            <p className={ui.muted}>В кабинете владельца откройте магазин → «Кассы» → «Создать код подключения».</p>
            {binding && <p className={ui.muted}>Новый код заменит привязку в этом браузере. Прежняя касса останется в списке владельца, пока её не отключат.</p>}
            <form onSubmit={pair} aria-busy={busy}>
                <fieldset className={ui.fieldset} disabled={busy}>
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
            <p className="pairing-hint">Код действует 5 минут и используется один раз. Привязка сохраняется после выхода кассира.</p>
        </dialog>
    </>;
}
