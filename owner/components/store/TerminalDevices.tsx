import { useEffect, useRef, useState } from "react";
import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "../../lib/supabase";
import { ui } from "../../../shared/lib/ui";

type Device = { id: string; name: string; created_at: string; revoked_at: string | null };
type Code = { code: string; expires_at: string };

export function TerminalDevices({ storeId, storeName }: { storeId: string; storeName: string }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const working = useRef(false);
    const [devices, setDevices] = useState<Device[]>([]);
    const [code, setCode] = useState<Code | null>(null);
    const [now, setNow] = useState(Date.now);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [revoking, setRevoking] = useState<Device | null>(null);

    useEffect(() => {
        if (!code) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [code]);
    const remaining = code ? Math.max(0, Math.ceil((Date.parse(code.expires_at) - now) / 1000)) : 0;

    async function loadDevices() {
        setLoading(true);
        try {
            const { data, error } = await supabase.from("terminal_devices")
                .select("id, name, created_at, revoked_at").eq("store_id", storeId).order("created_at", { ascending: false });
            if (error) throw error;
            setDevices(data ?? []);
        } catch {
            setError("Не удалось загрузить кассы. Попробуйте обновить список.");
        } finally { setLoading(false); }
    }

    function open() {
        setError(""); setNotice(""); setRevoking(null);
        dialog.current?.showModal();
        void loadDevices();
    }

    async function generate() {
        if (working.current) return;
        working.current = true; setBusy(true); setError(""); setNotice(""); setCode(null);
        try {
            const { data, error } = await supabase.functions.invoke("create-terminal-pairing-code", { body: { store_id: storeId } });
            if (error) {
                if (error instanceof FunctionsHttpError) {
                    const body = await error.context.json().catch(() => null);
                    throw new Error(typeof body?.error === "string" ? body.error : "Не удалось создать код.");
                }
                throw new Error("Нет связи с сервисом. Проверьте интернет и повторите.");
            }
            if (typeof data?.code !== "string" || !/^\d{7}$/.test(data.code) ||
                typeof data.expires_at !== "string" || !Number.isFinite(Date.parse(data.expires_at))) {
                throw new Error("Сервис вернул некорректный код подключения.");
            }
            if (dialog.current?.open) { setNow(Date.now()); setCode(data); }
        } catch (error) { setError(error instanceof Error ? error.message : "Не удалось создать код."); }
        finally { working.current = false; setBusy(false); }
    }

    async function revoke() {
        if (!revoking || working.current) return;
        working.current = true; setBusy(true); setError(""); setNotice("");
        try {
            const { error } = await supabase.rpc("revoke_terminal_device", { p_device_id: revoking.id });
            if (error) throw error;
            setNotice(`Касса «${revoking.name}» отключена.`); setRevoking(null);
            await loadDevices();
        } catch { setError("Не удалось отключить кассу. Повторите попытку."); }
        finally { working.current = false; setBusy(false); }
    }

    return <>
        <button type="button" className={ui.button} onClick={open}>Кассы</button>
        <dialog ref={dialog} className="terminal-dialog pairing-dialog" aria-labelledby="owner-terminals-title"
            onClose={() => { setCode(null); setRevoking(null); }}>
            <div className="terminal-dialog-header">
                <h2 id="owner-terminals-title">Кассы магазина</h2>
                <button className={ui.button} type="button" aria-label="Закрыть" onClick={() => dialog.current?.close()}>×</button>
            </div>
            <p className={ui.muted}>{storeName}</p>
            <section className="pairing-panel" aria-labelledby="pair-code-title">
                <h3 id="pair-code-title" className={ui.subheading}>Подключить кассу</h3>
                <p className={ui.muted}>Создайте код и введите его на странице входа кассы. Один код подключает одно устройство.</p>
                {code && (remaining > 0 ? <div className="pairing-code-box">
                    <output className="pairing-code" aria-label={`Код подключения: ${code.code.split("").join(" ")}`}>{code.code}</output>
                    <p className={ui.muted}>Действует ещё {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}</p>
                    <button type="button" className={ui.button} onClick={async () => {
                        try { await navigator.clipboard.writeText(code.code); setNotice("Код скопирован."); }
                        catch { setNotice("Выделите код и скопируйте его вручную."); }
                    }}>Скопировать код</button>
                </div> : <p role="status" className={ui.muted}>Срок кода истёк. Создайте новый.</p>)}
                <button type="button" className={ui.button + " button-link-primary"} disabled={busy} onClick={() => void generate()}>
                    {busy && !revoking ? "Создаём код…" : code ? "Создать другой код" : "Создать код подключения"}
                </button>
                {code && <p className="pairing-hint">Ранее выданные коды действуют до истечения своего срока.</p>}
            </section>
            {error && <p className={ui.error} role="alert">{error}</p>}
            {notice && <p className={ui.notice} role="status">{notice}</p>}
            <div className="row-between pairing-list-heading">
                <h3 className={ui.subheading}>Подключённые устройства</h3>
                <button className={ui.button} type="button" disabled={loading || busy} onClick={() => { setError(""); void loadDevices(); }}>Обновить</button>
            </div>
            {loading ? <p role="status" className={ui.muted}>Загружаем кассы…</p> : !devices.length ?
                <p className={ui.muted}>К этому магазину пока не подключали кассы.</p> :
                <ul className="pairing-devices">{devices.map(device => <li key={device.id}>
                    <div><strong>{device.name}</strong><small>{device.revoked_at ? "Отключена" : "Подключена"} · {new Date(device.created_at).toLocaleDateString("ru-RU")}</small></div>
                    {!device.revoked_at && <button type="button" className={ui.button} disabled={busy} onClick={() => { setRevoking(device); setNotice(""); }}>Отключить</button>}
                </li>)}</ul>}
            {revoking && <section className="pairing-panel" role="group" aria-label="Подтверждение отключения">
                <p>Отключить кассу «{revoking.name}»? Её текущая сессия будет отозвана. Для подключения понадобится новый код.</p>
                <div className="dialog-actions">
                    <button type="button" className={ui.button} disabled={busy} onClick={() => setRevoking(null)}>Отмена</button>
                    <button type="button" className={ui.buttonBase + " button-danger"} disabled={busy} onClick={() => void revoke()}>{busy ? "Отключаем…" : "Отключить кассу"}</button>
                </div>
            </section>}
        </dialog>
    </>;
}
