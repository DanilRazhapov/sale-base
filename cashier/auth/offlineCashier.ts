import type { TerminalSnapshot } from "../lib/cashierCart";
import { openCashierDb } from "../lib/indexedDb/localDb";
import { TerminalError, terminalRequest, terminalUnavailable, type TerminalResponse } from "../lib/cashierTerminal";

export type Binding = {
    device: { id: string; store_id: string; name: string };
    store?: { id: string; name: string };
};

type LoginReply = Binding & { cashierId: string; sessionId: string; expires_at: string };
type OfflineGrant = {
    cashierId: string;
    sessionId: string;
    name: string;
    expiresAt: number;
    salt: Uint8Array<ArrayBuffer>;
    verifier: Uint8Array<ArrayBuffer>;
    failedAttempts: number;
    blockedUntil: number;
    signedOut?: boolean;
    snapshot?: Omit<TerminalSnapshot, "products" | "categories">;
};
type LocalAuth = { key: "offlineAuth"; binding?: Binding; grant?: OfflineGrant; pendingLogout?: string };
const key = "offlineAuth";

async function localAuth(update?: (saved: LocalAuth) => void): Promise<LocalAuth> {
    const db = await openCashierDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction("terminalMeta", update ? "readwrite" : "readonly");
        const store = tx.objectStore("terminalMeta");
        const request = store.get(key);
        let saved: LocalAuth;
        let error: unknown;
        request.onsuccess = () => {
            saved = request.result ?? { key };
            if (update) {
                try {
                    update(saved);
                    store.put(saved);
                } catch (failure) {
                    error = failure;
                    tx.abort();
                }
            }
        };
        tx.oncomplete = () => resolve(saved);
        tx.onabort = () => reject(error ?? tx.error ?? new Error("Локальные данные кассы недоступны."));
    });
}

const quietStorage = (operation: Promise<unknown>) => operation.catch((error: unknown) => {
    console.warn("Не удалось сохранить данные офлайн-входа.", error);
});

export async function readBinding() {
    return (await localAuth().catch(() => undefined))?.binding ?? null;
}

export function saveBinding(binding: Binding | null) {
    return quietStorage(localAuth((saved) => {
        if (saved.binding?.device.id !== binding?.device.id ||
            saved.binding?.device.store_id !== binding?.device.store_id) {
            delete saved.grant;
        }
        if (binding) saved.binding = binding;
        else delete saved.binding;
    }));
}

async function pinVerifier(pin: string, salt: Uint8Array<ArrayBuffer>) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
        { name: "PBKDF2", hash: "SHA-256", salt, iterations: 600_000 }, key, 256,
    );
    return new Uint8Array(bits);
}

async function rememberLogin(result: LoginReply, name: string, pin: string) {
    const expiresAt = Date.parse(result.expires_at);
    if (!result.device?.id || !result.cashierId || !result.sessionId || !(expiresAt > Date.now())) return;
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const verifier = await pinVerifier(pin, salt);
    await localAuth((saved) => {
        const store = saved.binding?.store;
        saved.binding = {
            device: result.device,
            store: store?.id === result.device.store_id ? store : undefined,
        };
        saved.grant = {
            cashierId: result.cashierId, sessionId: result.sessionId, name: name.toLowerCase(),
            expiresAt, salt, verifier, failedAttempts: 0, blockedUntil: 0,
        };
        delete saved.pendingLogout;
    });
}

export type OfflineSession = {
    sessionId: string;
    expiresAt: number;
    snapshot: NonNullable<OfflineGrant["snapshot"]>;
};

export async function loginCashier(name: string, pin: string): Promise<OfflineSession | null> {
    if (navigator.onLine) {
        try {
            await flushPendingLogout();
            const result = await terminalRequest<LoginReply>(
                { action: "login", name, pin }, AbortSignal.timeout(20_000),
            );
            await quietStorage(rememberLogin(result, name, pin));
            return null;
        } catch (error) {
            if (!terminalUnavailable(error)) throw error;
        }
    }

    const { binding, grant } = await localAuth();
    if (!binding) throw new Error("Для привязки кассы требуется подключение к сети.");
    if (!grant?.snapshot || grant.expiresAt <= Date.now()) {
        throw new Error("Войдите в кассу с подключением к сети, чтобы подготовить офлайн-вход.");
    }
    const blockedMessage = "Слишком много попыток офлайн-входа. Подождите 15 минут.";
    if (grant.blockedUntil > Date.now()) throw new Error(blockedMessage);
    const actual = await pinVerifier(pin, grant.salt);
    const matches = actual.reduce((difference, byte, index) => difference | (byte ^ grant.verifier[index]), 0) === 0
        && name.toLowerCase() === grant.name;

    const saved = await localAuth((current) => {
        const active = current.grant;
        const now = Date.now();
        if (!active?.snapshot || active.sessionId !== grant.sessionId || active.expiresAt <= now) {
            throw new Error("Локальные данные для входа изменились. Повторите вход.");
        }
        if (active.blockedUntil > now) throw new Error(blockedMessage);
        if (matches) {
            active.failedAttempts = 0;
            active.blockedUntil = 0;
            if (current.pendingLogout === active.sessionId) delete current.pendingLogout;
        } else if (++active.failedAttempts >= 5) {
            active.failedAttempts = 0;
            active.blockedUntil = now + 15 * 60_000;
        }
    });
    if (!matches) {
        throw new Error((saved.grant?.blockedUntil ?? 0) > Date.now() ? blockedMessage : "Проверьте имя кассира и PIN.");
    }
    return { sessionId: grant.sessionId, expiresAt: grant.expiresAt, snapshot: grant.snapshot };
}

export function rememberSnapshot({ sessionId, data }: TerminalResponse) {
    return quietStorage(localAuth((saved) => {
        const { grant, binding } = saved;
        if (grant?.sessionId !== sessionId || grant.cashierId !== data.cashier.id ||
            binding?.device.store_id !== data.store.id) return;
        const { store, cashier, shift, movements, expires_at } = data;
        grant.snapshot = { store, cashier, shift, movements, expires_at };
        binding.store = store;
    }));
}

export function rejectSession(sessionId: string) {
    return quietStorage(localAuth((saved) => {
        if (saved.grant?.sessionId === sessionId && !saved.grant.signedOut) delete saved.grant;
    }));
}

export async function readCachedSessionId() {
    return (await localAuth().catch(() => undefined))?.grant?.sessionId;
}

export async function isOfflineSessionCurrent(session: OfflineSession) {
    return session.expiresAt > Date.now() && await readCachedSessionId() === session.sessionId;
}

async function finishLogout(sessionId: string) {
    await quietStorage(localAuth((saved) => {
        if (saved.grant?.sessionId === sessionId) saved.grant.signedOut = true;
        if (saved.pendingLogout === sessionId) delete saved.pendingLogout;
    }));
}

export async function flushPendingLogout() {
    const pending = (await localAuth().catch(() => undefined))?.pendingLogout;
    if (!pending) return false;
    await serverLogout(pending);
    await finishLogout(pending);
    return true;
}

async function serverLogout(sessionId: string) {
    try {
        await terminalRequest({ action: "logout", sessionId }, AbortSignal.timeout(20_000));
    } catch (error) {
        // A missing session or a different cookie leaves no matching session to end.
        if (!(error instanceof TerminalError && [401, 409].includes(error.status))) throw error;
    }
}

export async function logoutCashier(sessionId: string) {
    if (navigator.onLine) {
        try {
            await serverLogout(sessionId);
            await finishLogout(sessionId);
            return;
        } catch (error) {
            if (!terminalUnavailable(error)) throw error;
        }
    }
    await localAuth((saved) => {
        if (saved.grant?.sessionId === sessionId && saved.grant.signedOut) return;
        saved.pendingLogout = sessionId;
    });
}
