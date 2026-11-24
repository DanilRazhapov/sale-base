import type { TerminalSnapshot } from "../cashierCart";
import { openCashierDb } from "./localDb";

export type Shift = NonNullable<TerminalSnapshot["shift"]>;
export type LocalShift = {
    storeId: string;
    shift: Shift;
    openingPending: boolean;
    openedOffline?: boolean;
    close?: { at: number; cash: number | null; sent?: boolean };
};

const hour = 60 * 60 * 1000;

export function shiftDeadline(shift: Shift) {
    return shift.deadline_at ? Date.parse(shift.deadline_at) : Date.parse(shift.opened_at) + 12 * hour;
}

async function readShifts(storeId: string | undefined, change?: (rows: LocalShift[], store: IDBObjectStore) => void) {
    const db = await openCashierDb();
    return new Promise<LocalShift[]>((resolve, reject) => {
        const tx = db.transaction("shifts", change ? "readwrite" : "readonly");
        const store = tx.objectStore("shifts");
        const query = storeId === undefined ? store.getAll() : store.index("byStore").getAll(storeId);
        let failure: unknown;
        query.onsuccess = () => {
            try {
                change?.(query.result, store);
            } catch (error) {
                failure = error;
                tx.abort();
            }
        };
        tx.oncomplete = () => resolve(query.result);
        tx.onabort = () => reject(failure ?? tx.error ?? new Error("Не удалось сохранить смену на устройстве."));
    });
}

export function expireLocalShifts(storeId?: string) {
    return readShifts(storeId, (rows, store) => {
        const now = Date.now();
        for (const row of rows) {
            const deadline = shiftDeadline(row.shift);
            if (!row.close && deadline <= now) {
                row.close = { at: deadline, cash: null };
                store.put(row);
            }
        }
    });
}

export function watchSignedOutShiftExpiry() {
    let active = true;
    let timer: number | undefined;
    async function check() {
        try {
            const shifts = await expireLocalShifts();
            if (!active) return;
            const next = shifts.reduce((earliest, row) => row.close
                ? earliest
                : Math.min(earliest, shiftDeadline(row.shift)), Infinity);
            window.clearTimeout(timer);
            if (Number.isFinite(next)) timer = window.setTimeout(() => void check(), Math.max(0, next - Date.now()));
        } catch (error) {
            if (active) console.warn("Не удалось проверить срок локальной смены.", error);
        }
    }
    const recheck = () => void check();
    recheck();
    document.addEventListener("visibilitychange", recheck);
    return () => {
        active = false;
        window.clearTimeout(timer);
        document.removeEventListener("visibilitychange", recheck);
    };
}

export function openLocalShift(snapshot: TerminalSnapshot, openingCash: number, offline: boolean) {
    return readShifts(snapshot.store.id, (rows, store) => {
        const now = Date.now();
        if (snapshot.shift || rows.some((row) => !row.close && shiftDeadline(row.shift) > now)) {
            throw new Error("В магазине уже открыта смена.");
        }
        const row: LocalShift = {
            storeId: snapshot.store.id,
            openingPending: true,
            openedOffline: offline,
            shift: {
                id: crypto.randomUUID(),
                cashier_id: snapshot.cashier.id,
                cashier_name: snapshot.cashier.name,
                opened_at: new Date(now).toISOString(),
                deadline_at: new Date(now + (offline ? 14 : 12) * hour).toISOString(),
                opening_cash: openingCash,
                revenue: 0,
            },
        };
        store.add(row);
        rows.push(row);
    });
}

export function closeLocalShift(storeId: string, shift: Shift, cash: number | null) {
    return readShifts(storeId, (rows, store) => {
        const existing = rows.find((row) => row.shift.id === shift.id);
        if (existing?.close) return;
        const deadline = shiftDeadline(shift);
        const at = Math.min(Date.now(), deadline);
        const row = existing ?? { storeId, shift, openingPending: false };
        row.close = { at, cash: at === deadline ? null : cash };
        store.put(row);
        if (!existing) rows.push(row);
    });
}

export function confirmShift(storeId: string, id: string, event: "open" | "close") {
    return readShifts(storeId, (rows, store) => {
        const row = rows.find((entry) => entry.shift.id === id);
        if (!row) return;
        if (event === "open") row.openingPending = false;
        else if (row.close) row.close.sent = true;
        store.put(row);
    });
}

export function reconcileLocalShifts(storeId: string, serverShift: Shift | null) {
    return readShifts(storeId, (rows, store) => {
        for (const row of rows) {
            if (!row.openingPending && !row.close && row.shift.id !== serverShift?.id) {
                row.close = { at: Math.min(Date.now(), shiftDeadline(row.shift)), cash: null, sent: true };
                store.put(row);
            }
        }
    });
}

export function visibleShift(serverShift: Shift | null, rows: LocalShift[], allowCached: boolean) {
    const now = Date.now();
    const open = (shift: Shift) =>
        shiftDeadline(shift) > now && !rows.some((row) => row.shift.id === shift.id && row.close);
    if (serverShift && open(serverShift)) return serverShift;
    return rows.find((row) => !row.close && open(row.shift) && (row.openingPending || allowCached))?.shift ?? null;
}
