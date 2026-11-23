import { ui } from "../../shared/lib/ui";
import { RealtimeClient } from "@supabase/supabase-js";
import { readLastCatalog, saveCatalog, type CachedCatalog } from "../lib/indexedDb/localCategories";
import { enqueueOperation, listPendingOperations } from "../lib/indexedDb/localOperations";
import type { LocalOperation } from "../lib/indexedDb/localTypes";
import { useCallback, useEffect, useRef, useState } from "react";
import { TerminalError, terminalRequest } from "../lib/cashierTerminal";
import type { TerminalSnapshot } from "../lib/cashierCart";
import { CashierPOS } from "./CashierPOS";
import Throbber from "../../shared/components/Throbber";
const errorText = (error: unknown) => (error instanceof Error ? error.message : "Не удалось выполнить операцию.");
const unavailableStatuses = new Set([0, 502, 503, 504]);
type TerminalResponse = { data: TerminalSnapshot; sessionId: string; priceChannel?: string };

export function CashierWorkspace({ onLogout, onRestore }: { onLogout: () => void; onRestore: () => void }) {
    const [terminal, setTerminal] = useState<TerminalResponse | null>(null);
    const [cachedCatalog, setCachedCatalog] = useState<CachedCatalog | null>(null);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");
    const [busy, setBusy] = useState(false);
    const working = useRef(false);
    const loadingSnapshot = useRef(false);
    const syncing = useRef(false);
    const version = useRef(0);
    const storeIdRef = useRef<string | null>(null);

    const load = useCallback(async () => {
        if (syncing.current) return;
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
                    const getSnapshot = () => terminalRequest<TerminalResponse>(
                        { action: "snapshot" },
                        AbortSignal.timeout(20000),
                    );
                    let response = await getSnapshot();
                    if (current !== version.current) return;
                    const { store, cashier } = response.data;
                    const operations = await listPendingOperations(store.id);
                    const confirmedIds: string[] = [];
                    const otherCashierPending = operations.some((operation) => operation.cashier_id !== cashier.id);
                    let syncError = otherCashierPending ? "На устройстве есть неотправленные операции другого кассира." : "";
                    let useCachedStock = otherCashierPending;

                    if (working.current) {
                        useCachedStock ||= operations.length > 0;
                    } else if (!otherCashierPending) {
                        try {
                            for (const operation of operations) {
                                if (current !== version.current) return;
                                const receipt = await terminalRequest<{ data: { id: string; shift_id: string } }>(
                                    {
                                        action: "checkout_for_shift",
                                        sessionId: response.sessionId,
                                        ...operation.checkout,
                                        shift_id: operation.shift_id,
                                    },
                                    AbortSignal.timeout(20000),
                                );
                                if (receipt.data?.id !== operation.id || receipt.data.shift_id !== operation.shift_id) {
                                    throw new Error("Сервер не подтвердил чек для сохранённой смены.");
                                }
                                confirmedIds.push(operation.id);
                            }
                        } catch (error) {
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
                        if (confirmedIds.length) response = await getSnapshot();
                        if (current !== version.current) return;
                        if (response.data.store.id !== store.id || response.data.cashier.id !== cashier.id) {
                            throw new Error("Сессия кассира изменилась. Обновите данные.");
                        }
                        response.data = await saveCatalog(response.data, confirmedIds);
                    }

                    if (current !== version.current) return;
                    storeIdRef.current = store.id;
                    setTerminal(response);
                    setCachedCatalog(null);
                    onRestore();
                    setError(syncError);
                } finally {
                    syncing.current = false;
                }
            }

            // Only one tab can reconcile the shared queue with a server snapshot at a time.
            if (navigator.locks) await navigator.locks.request("salebase-cashier-sync", refreshCatalog);
            else await refreshCatalog();
        } catch (error) {
            if (current !== version.current) return;
            if (error instanceof TerminalError && error.status === 401) {
                onLogout();
                return;
            }

            const storeId = storeIdRef.current;
            const serverUnavailable = error instanceof TerminalError && unavailableStatuses.has(error.status);

            if (serverUnavailable) {
                try {
                    const catalog = await readLastCatalog(storeId ?? undefined);
                    if (current !== version.current) return;
                    if (catalog) {
                        if (!storeId) {
                            setCachedCatalog(catalog);
                        } else {
                            const { products, categories } = catalog;
                            setTerminal((previous) => previous?.data.store.id === storeId
                                ? { ...previous, data: { ...previous.data, products, categories } }
                                : previous);
                            setError("Сервер недоступен. Показан сохранённый каталог.");
                        }
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
    }, [onLogout, onRestore]);

    async function queueOperation(operation: LocalOperation) {
        const products = await enqueueOperation(operation);
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

    const priceChannel = terminal?.priceChannel;
    const expiresAt = terminal?.data.expires_at;
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

        const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
        const expiryTimer = Number.isFinite(expiry)
            ? window.setTimeout(requestRefresh, Math.max(0, expiry - Date.now()))
            : undefined;

        return () => {
            active = false;
            window.clearTimeout(timer);
            window.clearTimeout(expiryTimer);
            window.clearInterval(poll);
            void realtime?.removeAllChannels();
        };
    }, [load, priceChannel, expiresAt]);

    async function run(action: () => Promise<void>, success: string, refreshInBackground = false) {
        if (working.current) return;

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
                    queueOperation={queueOperation}
                    run={run}
                    error={error}
                    notice={notice}
                />
            ) : cachedCatalog ? (
                <CashierPOS key="offline-catalog" catalog={cachedCatalog} onRetry={load} />
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
