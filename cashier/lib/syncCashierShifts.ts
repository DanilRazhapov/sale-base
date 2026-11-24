import { TerminalError, terminalRequest } from "./cashierTerminal";
import { confirmShift, type LocalShift } from "./indexedDb/localShifts";
import type { LocalOperation } from "./indexedDb/localTypes";

export async function syncCashierShifts(
    sessionId: string,
    shifts: LocalShift[],
    operations: LocalOperation[],
    confirmedIds: string[],
    isCurrent: () => boolean,
) {
    // A shift's opening precedes its receipts, even when the whole shift happened offline.
    const events = new Map<string, { at: number; shift?: LocalShift; operations: LocalOperation[] }>();
    for (const shift of shifts) {
        if (shift.openingPending || (shift.close && !shift.close.sent)) {
            events.set(shift.shift.id, { at: Date.parse(shift.shift.opened_at), shift, operations: [] });
        }
    }
    for (const operation of operations) {
        const group = events.get(operation.shift_id) ?? { at: operation.created_at, operations: [] };
        group.operations.push(operation);
        events.set(operation.shift_id, group);
    }

    async function send(shiftId: string, body: Record<string, unknown>, receiptId?: string) {
        const { data } = await terminalRequest<{ data: { id: string; shift_id?: string } }>(
            { ...body, sessionId, shift_id: shiftId }, AbortSignal.timeout(20_000),
        );
        if (receiptId ? data?.id !== receiptId || data.shift_id !== shiftId : data?.id !== shiftId) {
            throw new TerminalError("Сервер не подтвердил сохранённые данные смены.", 502);
        }
    }

    let changed = false;
    for (const [id, { shift, operations }] of [...events].sort(([, first], [, second]) => first.at - second.at)) {
        if (!isCurrent()) break;
        if (shift?.openingPending) {
            await send(id, {
                action: "sync_shift_open",
                opened_at: new Date(shift.shift.opened_at).toISOString(),
                opening_cash: shift.shift.opening_cash,
                opened_offline: shift.openedOffline === true,
                closing_at: shift.close ? new Date(shift.close.at).toISOString() : undefined,
                closing_cash: shift.close?.cash,
            });
            await confirmShift(shift.storeId, id, "open");
            changed = true;
        }
        for (const operation of operations) {
            if (!isCurrent()) return changed;
            await send(id, {
                action: "checkout_for_shift", ...operation.checkout,
                recorded_at: new Date(operation.created_at).toISOString(),
            }, operation.id);
            confirmedIds.push(operation.id);
            changed = true;
        }
        if (!isCurrent()) return changed;
        if (shift?.close && !shift.close.sent) {
            await send(id, {
                action: "sync_shift_close",
                closed_at: new Date(shift.close.at).toISOString(),
                closing_cash: shift.close.cash,
            });
            await confirmShift(shift.storeId, id, "close");
            changed = true;
        }
    }
    return changed;
}
