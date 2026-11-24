import { ui } from "../../shared/lib/ui";
import { RealtimeClient } from "@supabase/supabase-js";
import { readLastCatalog, saveCatalog } from "../lib/indexedDb/localCategories";
import { enqueueOperation, listPendingOperations } from "../lib/indexedDb/localOperations";
import type { LocalOperation } from "../lib/indexedDb/localTypes";
import {
    closeLocalShift, expireLocalShifts, openLocalShift, reconcileLocalShifts, shiftDeadline, visibleShift, type LocalShift,
} from "../lib/indexedDb/localShifts";
import { syncCashierShifts } from "../lib/syncCashierShifts";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { TerminalError, terminalRequest, terminalUnavailable, type TerminalResponse } from "../lib/cashierTerminal";
import {
    isOfflineSessionCurrent, rejectSession, rememberSnapshot, sessionForOnlineSignIn, signInForSync, type OfflineSession,
} from "../auth/offlineCashier";
import { CashierPOS } from "./CashierPOS";
import { TerminalDialog } from "./TerminalDialog";
import Throbber from "../../shared/components/Throbber";
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить операцию.");
export function CashierWorkspace({ onLogout, offlineSession }: {
    onLogout: () => void;
    offlineSession: OfflineSession | null;
}) {
    const [terminal, setTerminal] = useState<TerminalResponse | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const [localSession, setLocalSession] = useState(offlineSession);
    const [requiresSignIn, setRequiresSignIn] = useState(false);
    const [showSignIn, setShowSignIn] = useState(false);
    const [signInError, setSignInError] = useState("");
    const [shifts, setShifts] = useState<LocalShift[]>([]);
    const [usingCachedSnapshot, setUsingCachedSnapshot] = useState(false);
    const working = useRef(false);
    const loadingSnapshot = useRef(false);
    const syncing = useRef(false);
    const refreshPending = useRef<(() => void) | null>(null);
    const version = useRef(0);
    const storeIdRef = useRef(offlineSession?.snapshot.store.id);
    const sessionIdRef = useRef(offlineSession?.sessionId);

    const load = useCallback(async function loadSnapshot(): Promise<void> {
        if (syncing.current) {
            refreshPending.current = () => void loadSnapshot();
            return;
        }
        const current = ++version.current;
        loadingSnapshot.current = true;
        try {
            if (!navigator.onLine) {
                throw new TerminalError("Нет подключения. Каталог откроется, если он сохранён на устройстве.", 0);
            }
            async function refreshCatalog() {
                if (current !== version.current) return;
                syncing.current = true;
                try {
                    const getSnapshot = async () => {
                        const response = await terminalRequest<TerminalResponse>(
                            { action: "snapshot" },
                            AbortSignal.timeout(20000),
                        );
                        if (sessionIdRef.current && sessionIdRef.current !== response.sessionId) {
                            throw new TerminalError("Сессия кассира изменилась. Войдите заново.", 401);
                        }
                        return response;
                    };
                    let response = await getSnapshot();
                    if (current !== version.current) return;
                    const { store, cashier } = response.data;
                    const localShifts = await expireLocalShifts(store.id);
                    const operations = await listPendingOperations(store.id);
                    const confirmedIds: string[] = [];
                    const pendingShifts = localShifts.filter((row) => row.openingPending || (row.close && !row.close.sent));
                    const otherCashierPending = operations.some((operation) => operation.cashier_id !== cashier.id) ||
                        pendingShifts.some((row) => row.shift.cashier_id !== cashier.id);
                    let syncError = otherCashierPending ? "На устройстве есть неотправленные данные другого кассира." : "";
                    let useCachedStock = otherCashierPending;
                    let changed = false;

                    if (working.current) {
                        useCachedStock ||= operations.length > 0;
                    } else if (!otherCashierPending) {
                        try {
                            changed = await syncCashierShifts(
                                response.sessionId, pendingShifts, operations, confirmedIds, () => current === version.current,
                            );
                        } catch (error) {
                            if (error instanceof TerminalError && error.status === 401) throw error;
                            syncError = `Очередь сохранена на устройстве. Синхронизация приостановлена. ${errorText(error)}`;
                            // A lost reply can leave a committed receipt in the queue. Keep the matched local catalog and queue.
                            useCachedStock ||= !(error instanceof TerminalError && [400, 409].includes(error.status));
                        }
                    }

                    if (current !== version.current) return;
                    if (useCachedStock) {
                        const catalog = await readLastCatalog(store.id);
                        if (!catalog) throw new Error(syncError || "Дождитесь синхронизации сохранённых операций.");
                        response.data = { ...response.data, products: catalog.products, categories: catalog.categories };
                    } else {
                        if (changed || confirmedIds.length || syncError) response = await getSnapshot();
                        if (current !== version.current) return;
                        if (response.data.store.id !== store.id || response.data.cashier.id !== cashier.id) {
                            throw new Error("Сессия кассира изменилась. Обновите данные.");
                        }
                        response.data = await saveCatalog(response.data, confirmedIds);
                    }

                    if (current !== version.current) return;
                    await rememberSnapshot(response);
                    if (current !== version.current) return;
                    const latestShifts = useCachedStock
                        ? await expireLocalShifts(store.id)
                        : await reconcileLocalShifts(store.id, response.data.shift);
                    if (current !== version.current) return;
                    storeIdRef.current = store.id;
                    sessionIdRef.current = response.sessionId;
                    setTerminal(response);
                    setShifts(latestShifts);
                    setUsingCachedSnapshot(useCachedStock);
                    setRequiresSignIn(false);
                    setError(syncError);
                } finally {
                    syncing.current = false;
                    const refresh = refreshPending.current;
                    refreshPending.current = null;
                    if (!working.current) refresh?.();
                }
            }

            // Only one tab can reconcile the shared queue with a server snapshot at a time.
            if (navigator.locks) await navigator.locks.request("salebase-cashier-sync", refreshCatalog);
            else await refreshCatalog();
        } catch (error) {
            if (current !== version.current) return;
            let reconnectSession: OfflineSession | null = null;
            if (error instanceof TerminalError && error.status === 401) {
                const sessionId = sessionIdRef.current;
                if (sessionId) reconnectSession = await sessionForOnlineSignIn(sessionId, error, AbortSignal.timeout(8000));
                if (current !== version.current) return;
                if (!reconnectSession) {
                    if (sessionId) void rejectSession(sessionId);
                    onLogout();
                    return;
                }
                setLocalSession(localSession ?? reconnectSession);
                setRequiresSignIn(true);
            }

            const storeId = storeIdRef.current;
            const cachedSession = localSession ?? reconnectSession;

            if ((reconnectSession || terminalUnavailable(error)) && storeId) {
                try {
                    if (cachedSession && !await isOfflineSessionCurrent(cachedSession)) {
                        if (current === version.current) onLogout();
                        return;
                    }
                    const catalog = await readLastCatalog(storeId);
                    const localShifts = await expireLocalShifts(storeId);
                    if (current !== version.current) return;
                    if (catalog) {
                        setShifts(localShifts);
                        setUsingCachedSnapshot(true);
                        const { products, categories } = catalog;
                        setTerminal((previous) => {
                            if (previous) return { ...previous, data: { ...previous.data, products, categories } };
                            if (!cachedSession || cachedSession.expiresAt <= Date.now()) return null;
                            return {
                                sessionId: cachedSession.sessionId,
                                data: { ...cachedSession.snapshot, products, categories },
                            };
                        });
                        setError(reconnectSession ? "" : "Нет связи с сервером. Операции сохраняются на устройстве.");
                        return;
                    }
                } catch (cacheError) {
                    console.warn("Не удалось прочитать каталог из IndexedDB", cacheError);
                }
            }

            if (current !== version.current) return;
            setError(errorText(error));
        } finally {
            if (current === version.current) loadingSnapshot.current = false;
        }
    }, [localSession, onLogout]);

    const shift = terminal ? visibleShift(terminal.data.shift, shifts, usingCachedSnapshot) : null;

    async function queueOperation(operation: LocalOperation) {
        if (localSession && !await isOfflineSessionCurrent(localSession)) {
            onLogout();
            throw new Error("Локальная сессия кассира завершена. Войдите заново.");
        }
        if (shift?.id !== operation.shift_id || shift.cashier_id !== operation.cashier_id) {
            throw new Error("Смена уже закрыта. Откройте новую смену.");
        }
        const products = await enqueueOperation(operation, shift);
        setTerminal((previous) => previous?.data.store.id === operation.store_id
            ? { ...previous, data: { ...previous.data, products } }
            : previous);
    }

    useEffect(() => {
        const initial = window.setTimeout(() => void load(), 0);
        const refresh = () => {
            if (!working.current && !loadingSnapshot.current) void load();
        };
        const invalidate = () => {
            ++version.current;
            loadingSnapshot.current = false;
            refreshPending.current = null;
        };
        window.addEventListener("focus", refresh);
        window.addEventListener("online", refresh);
        return () => {
            invalidate();
            window.clearTimeout(initial);
            window.removeEventListener("focus", refresh);
            window.removeEventListener("online", refresh);
        };
    }, [load]);

    const ownLocalShift = shifts.find((row) => !row.close && row.shift.cashier_id === terminal?.data.cashier.id);
    const timedShift = ownLocalShift?.shift ?? terminal?.data.shift;
    const shiftExpiry = timedShift && timedShift.cashier_id === terminal?.data.cashier.id &&
        !shifts.some((row) => row.shift.id === timedShift.id && row.close) ? shiftDeadline(timedShift) : undefined;
    const storeId = terminal?.data.store.id;
    useEffect(() => {
        if (shiftExpiry === undefined || !storeId || !timedShift) return;
        let active = true;
        let timer: number | undefined;
        const closeExpired = async () => {
            window.clearTimeout(timer);
            const remaining = shiftExpiry - Date.now();
            if (remaining > 0) {
                timer = window.setTimeout(() => void closeExpired(), remaining);
                return;
            }
            try {
                const localShifts = ownLocalShift
                    ? await expireLocalShifts(storeId)
                    : await closeLocalShift(storeId, timedShift, null);
                if (!active) return;
                setShifts(localShifts);
                setNotice("Смена закрыта автоматически по истечении срока.");
                if (navigator.onLine && !working.current && !loadingSnapshot.current) void load();
            } catch (failure) {
                if (active) setError(errorText(failure));
            }
        };
        timer = window.setTimeout(() => void closeExpired(), Math.max(0, shiftExpiry - Date.now()));
        const checkExpiry = () => void closeExpired();
        document.addEventListener("visibilitychange", checkExpiry);
        return () => {
            active = false;
            window.clearTimeout(timer);
            document.removeEventListener("visibilitychange", checkExpiry);
        };
    }, [load, ownLocalShift, shiftExpiry, storeId, timedShift]);

    const priceChannel = terminal?.priceChannel;
    const expiresAt = terminal?.data.expires_at;
    const expiry = expiresAt ? Date.parse(expiresAt) : localSession?.expiresAt;

    useEffect(() => {
        if (expiry === undefined || !Number.isFinite(expiry)) return;
        const checkExpiry = () => {
            if (Date.now() >= expiry) onLogout();
        };
        const timer = window.setTimeout(checkExpiry, Math.max(0, expiry - Date.now()));
        window.addEventListener("focus", checkExpiry);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("focus", checkExpiry);
        };
    }, [expiry, onLogout]);

    useEffect(() => {
        let active = true;
        let timer: number | undefined;
        let poll: number | undefined;
        let realtime: RealtimeClient | undefined;

        function canRefresh() {
            return !working.current && !loadingSnapshot.current && !syncing.current;
        }

        function refreshWhenIdle() {
            timer = undefined;
            if (!active || !navigator.onLine) return;
            if (!canRefresh()) {
                timer = window.setTimeout(refreshWhenIdle, 250);
                return;
            }
            void load();
        }

        function requestRefresh() {
            if (active && timer === undefined) timer = window.setTimeout(refreshWhenIdle, 100);
        }

        function startPolling() {
            if (poll !== undefined) return;
            poll = window.setInterval(() => {
                if (navigator.onLine && canRefresh()) void load();
            }, 15000);
        }

        startPolling();
        const url = import.meta.env.VITE_SUPABASE_URL;
        const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        if (priceChannel && url && key) {
            const endpoint = new URL("realtime/v1", url.replace(/\/?$/, "/"));
            endpoint.protocol = endpoint.protocol === "https:" ? "wss:" : "ws:";
            realtime = new RealtimeClient(endpoint.href, { params: { apikey: key } });
            realtime.channel(priceChannel, { config: { private: true } })
                .on("broadcast", { event: "price_changed" }, requestRefresh)
                .on("broadcast", { event: "snapshot_changed" }, requestRefresh)
                .subscribe((status) => {
                    if (!active) return;
                    if (status === "SUBSCRIBED") {
                        window.clearInterval(poll);
                        poll = undefined;
                        requestRefresh();
                    } else {
                        startPolling();
                    }
                });
        }

        return () => {
            active = false;
            window.clearTimeout(timer);
            window.clearInterval(poll);
            void realtime?.removeAllChannels();
        };
    }, [load, priceChannel]);

    async function reconnect(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (working.current || !localSession) return;
        const form = event.currentTarget;
        const pin = new FormData(form).get("pin");
        if (typeof pin !== "string" || !/^\d{4,12}$/.test(pin)) return;

        working.current = true;
        ++version.current;
        loadingSnapshot.current = false;
        setBusy(true);
        setSignInError("");
        form.reset();
        try {
            const result = await signInForSync(localSession, pin);
            sessionIdRef.current = result.sessionId;
            setTerminal((previous) => previous && {
                sessionId: result.sessionId,
                data: { ...previous.data, expires_at: result.expires_at },
            });
            setLocalSession(null);
            setRequiresSignIn(false);
            setShowSignIn(false);
        } catch (failure) {
            setSignInError(errorText(failure));
        } finally {
            working.current = false;
            setBusy(false);
        }
    }

    async function run(action: () => Promise<void>, success: string, refreshInBackground = false) {
        if (working.current) return;
        if (expiry !== undefined && Date.now() >= expiry) {
            onLogout();
            return;
        }

        working.current = true;
        ++version.current;
        loadingSnapshot.current = false;
        setBusy(true);
        setError("");
        setNotice("");

        let saved = false;
        try {
            await action();
            saved = true;
            setNotice(success);
            if (!refreshInBackground) await load();
        } catch (error) {
            if (error instanceof TerminalError && error.status === 401) {
                const sessionId = sessionIdRef.current;
                const reconnectSession = sessionId
                    ? await sessionForOnlineSignIn(sessionId, error, AbortSignal.timeout(8000))
                    : null;
                if (reconnectSession) {
                    setLocalSession(localSession ?? reconnectSession);
                    setRequiresSignIn(true);
                    setError("Для этого действия войдите онлайн.");
                    return;
                }
                if (sessionId) void rejectSession(sessionId);
                onLogout();
                return;
            }
            setError(errorText(error));
        } finally {
            working.current = false;
            setBusy(false);
            if (saved && refreshInBackground && navigator.onLine) void load();
        }
    }

    async function changeShift(cash: number, action: "open" | "close") {
        if (!terminal) return;
        if (localSession && !await isOfflineSessionCurrent(localSession)) {
            onLogout();
            throw new Error("Локальная сессия кассира завершена. Войдите заново.");
        }
        if (!Number.isFinite(cash) || cash < 0 || cash >= 10_000_000_000 ||
            Math.abs(cash * 100 - Math.round(cash * 100)) > 0.0001) {
            throw new Error("Введите корректную сумму наличных.");
        }
        if (action === "open") {
            setShifts(await openLocalShift(
                { ...terminal.data, shift }, cash, !navigator.onLine || usingCachedSnapshot || requiresSignIn,
            ));
        } else if (shift?.cashier_id === terminal.data.cashier.id) {
            setShifts(await closeLocalShift(terminal.data.store.id, shift, cash));
        } else {
            throw new Error("Смена уже закрыта.");
        }
    }

    const syncNotice = requiresSignIn && (
        <div className="pos-shift-warning">
            <span role="status">Для синхронизации войдите онлайн. Продажи пока сохраняются на устройстве.</span>
            <button type="button" className={ui.button} disabled={busy} onClick={() => {
                setSignInError("");
                setShowSignIn(true);
            }}>
                Войти онлайн
            </button>
        </div>
    );

    return (
        <main className="pos-page">
            {showSignIn && (
                <TerminalDialog title="Войти онлайн" onClose={() => {
                    if (!working.current) setShowSignIn(false);
                }}>
                    <form onSubmit={reconnect} aria-busy={busy}>
                        <fieldset className={ui.fieldset} disabled={busy}>
                            <label className={ui.label}>
                                PIN кассира {localSession?.snapshot.cashier.name}
                                <input className={ui.input} type="password" name="pin" autoComplete="current-password"
                                    inputMode="numeric" pattern="[0-9]{4,12}" maxLength={12} required autoFocus />
                            </label>
                            {signInError && <p className={ui.error} role="alert">{signInError}</p>}
                            <button className={ui.buttonBase + " button-primary"} type="submit">Войти</button>
                        </fieldset>
                    </form>
                </TerminalDialog>
            )}
            {terminal ? (
                <CashierPOS
                    key={terminal.data.cashier.id}
                    sessionId={terminal.sessionId}
                    snapshot={{ ...terminal.data, shift }}
                    busy={busy}
                    refresh={load}
                    logout={onLogout}
                    queueOperation={queueOperation}
                    changeShift={changeShift}
                    run={run}
                    error={error}
                    notice={notice}
                    syncNotice={syncNotice}
                />
            ) : (
                <div className="mx-auto mt-[15vh] max-w-lg text-center [&_h1]:mb-4 [&_button]:m-2">
                    <h1 className={ui.title}>Рабочее место кассира</h1>
                    {syncNotice}
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
