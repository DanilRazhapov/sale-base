import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";

export class TerminalError extends Error {
    status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
}

export async function terminalRequest<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke<T>("cashier-terminal", { body });
    if (error) {
        if (error instanceof FunctionsHttpError) {
            const response = await error.context.json().catch(() => null);
            throw new TerminalError(typeof response?.error === "string" ? response.error : "Ошибка рабочего места кассира.", error.context.status);
        }
        throw new TerminalError("Сервис кассира недоступен. Проверьте подключение. Перед повтором операции обновите данные.", 0);
    }
    if (!data) throw new TerminalError("Сервис вернул пустой ответ.", 0);
    return data;
}
