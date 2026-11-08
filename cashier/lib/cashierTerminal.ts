const legacyStorageKey = "salebase.cashier-session";

export class TerminalError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.status = status;
    }
}

export async function terminalRequest<T>(body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    let legacyToken: string | null = null;
    if (body.action === "snapshot") {
        try {
            legacyToken = sessionStorage.getItem(legacyStorageKey);
        } catch {
            // Cookie sessions work even if web storage is unavailable.
        }
    }

    let response: Response;
    try {
        response = await fetch("/api/cashier", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(legacyToken ? { ...body, legacyToken } : body),
            credentials: "same-origin",
            signal,
        });
    } catch {
        throw new TerminalError(
            "Сервис кассира недоступен. Проверьте подключение. Перед повтором операции обновите данные.",
            0,
        );
    }
    const data = await response.json().catch(() => null);
    if (legacyToken && (response.status === 401 || (response.ok && data?.sessionId))) {
        try {
            sessionStorage.removeItem(legacyStorageKey);
        } catch {
            // Ignore unavailable web storage.
        }
    }
    if (!response.ok) {
        throw new TerminalError(
            typeof data?.error === "string" ? data.error : "Ошибка рабочего места кассира.",
            response.status,
        );
    }
    if (!data) throw new TerminalError("Сервис вернул пустой ответ.", 0);
    return data;
}
