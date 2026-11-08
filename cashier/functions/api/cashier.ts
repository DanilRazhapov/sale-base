type Env = {
    VITE_SUPABASE_URL?: string;
    VITE_SUPABASE_PUBLISHABLE_KEY?: string;
};
type TerminalReply = {
    data?: { expires_at?: string } | null;
    error?: string;
    token?: string;
    expires_at?: string;
};

const cookieName = "__Secure-salebase_cashier";
const cookieOptions = "Path=/api/cashier; HttpOnly; Secure; SameSite=Strict";
const tokenPattern = /^[0-9a-f]{64}$/;

function reply(body: object, status = 200, cookie?: string) {
    const headers = new Headers({ "Cache-Control": "no-store" });
    if (cookie) headers.set("Set-Cookie", cookie);
    return Response.json(body, { status, headers });
}

function sessionCookie(token: string, expiresAt: unknown) {
    const expiration = typeof expiresAt === "string" ? Date.parse(expiresAt) : NaN;
    const maxAge = Math.floor((expiration - Date.now()) / 1000);
    if (!Number.isFinite(maxAge) || maxAge <= 0) return;
    return `${cookieName}=${token}; ${cookieOptions}; Max-Age=${maxAge}`;
}

async function sessionId(token: string) {
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`cashier-tab:${token}`));
    return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function onRequest({ request, env }: { request: Request; env: Env }) {
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    if (request.headers.get("Origin") !== new URL(request.url).origin) {
        return reply({ error: "Запрос должен быть отправлен со страницы кассы." }, 403);
    }
    if (request.headers.get("Content-Type")?.split(";")[0] !== "application/json") {
        return reply({ error: "Ожидался JSON." }, 415);
    }

    let body: Record<string, unknown>;
    try {
        const text = await request.text();
        if (text.length > 16000) return reply({ error: "Слишком большой запрос." }, 413);

        const payload: unknown = JSON.parse(text);
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
        body = payload as Record<string, unknown>;
    } catch {
        return reply({ error: "Некорректный JSON." }, 400);
    }

    const { action, legacyToken, sessionId: expectedSession, ...fields } = body;

    delete fields.token;

    const cookieToken = request.headers.get("Cookie")
        ?.split(/;\s*/).find((cookie) => cookie.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
    const migrating = action === "snapshot" && !cookieToken && typeof legacyToken === "string";
    const token = cookieToken ?? (migrating ? legacyToken : "");

    let currentSession: string | undefined;
    if (action !== "login") {
        if (!tokenPattern.test(token)) return reply({ error: "Войдите как кассир." }, 401);
        currentSession = await sessionId(token);
        if (
            action !== "snapshot" &&
            !(action === "logout" && expectedSession === undefined) &&
            expectedSession !== currentSession
        ) {
            return reply({ error: "Сессия кассира изменилась. Обновите данные." }, 409);
        }
    }

    const { VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key } = env;
    if (!url || !key) return reply({ error: "Кассовый API не настроен." }, 503);

    try {
        const upstream = await fetch(`${url.replace(/\/$/, "")}/functions/v1/cashier-terminal`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                apikey: key,
                Authorization: request.headers.get("Authorization") ?? `Bearer ${key}`,
            },
            body: JSON.stringify(action === "login" ? { action, ...fields } : { action, ...fields, token }),
            redirect: "error",
        });
        const result = await upstream.json() as TerminalReply | null;
        if (!upstream.ok) {
            return reply({ error: result?.error ?? "Операция кассира недоступна." }, upstream.status);
        }
        if (!result) return reply({ error: "Сервис вернул пустой ответ." }, 502);
        if (action === "login") {
            const loginToken = result?.token;
            const cookie = typeof loginToken === "string" && tokenPattern.test(loginToken)
                ? sessionCookie(loginToken, result.expires_at) : undefined;
            if (!cookie) return reply({ error: "Некорректный ответ авторизации." }, 502);
            return reply({ expires_at: result.expires_at }, 200, cookie);
        }
        if (action === "logout") {
            return reply(result, 200, `${cookieName}=; ${cookieOptions}; Max-Age=0`);
        }
        if (action === "snapshot") {
            if (!result.data) return reply({ error: "Сервис не вернул данные кассы." }, 502);
            const cookie = migrating ? sessionCookie(token, result?.data?.expires_at) : undefined;
            if (migrating && !cookie) return reply({ error: "Срок действия сессии истёк." }, 401);
            return reply({ data: result.data, sessionId: currentSession }, 200, cookie);
        }
        return reply(result);
    } catch {
        return reply({ error: "Сервис кассира недоступен. Проверьте подключение и обновите данные." }, 502);
    }
}
