import { withSupabase } from "@supabase/server";
import { createToken, findCashierByPin, hashToken } from "./credentials.ts";

const headers = { "Cache-Control": "no-store" };
const json = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers });
const uuid = (value: unknown): value is string => typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const numeric = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// The terminal has its own cashier authentication; an owner's JWT never identifies a cashier.
export default {
  fetch: withSupabase({ auth: "none" }, async (req, ctx) => {
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    let body: Record<string, unknown>;
    try {
      const text = await req.text();
      if (text.length > 16000) return json({ error: "Слишком большой запрос" }, 413);
      const payload: unknown = JSON.parse(text);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error();
      body = payload as Record<string, unknown>;
    } catch {
      return json({ error: "Некорректный JSON" }, 400);
    }

    try {
      const { action } = body;
      if (action === "login") {
        if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 120 ||
          typeof body.pin !== "string" || !/^\d{4,12}$/.test(body.pin)) {
          return json({ error: "Введите имя кассира и PIN (4–12 цифр)." }, 400);
        }
        const { data: candidates, error } = await ctx.supabaseAdmin.rpc("cashier_login_attempt", {
          p_name: body.name.trim(),
        });
        if (error) throw error;
        const cashier = await findCashierByPin<{ id: string; pin_hash: string }>(body.pin, candidates ?? []);
        if (!cashier) {
          return json({ error: "Не удалось войти. Проверьте имя и PIN. После пяти попыток подождите 15 минут." }, 401);
        }
        const token = createToken();
        const { data: expiresAt, error: sessionError } = await ctx.supabaseAdmin.rpc("cashier_create_session", {
          p_cashier_id: cashier.id, p_token_hash: await hashToken(token),
        });
        if (sessionError) throw sessionError;
        return json({ token, expires_at: expiresAt });
      }

      if (typeof body.token !== "string" || !/^[0-9a-f]{64}$/.test(body.token)) {
        return json({ error: "Войдите как кассир." }, 401);
      }
      const sessionHash = await hashToken(body.token);
      let rpc: string;
      let args: Record<string, unknown> = { p_token_hash: sessionHash };
      switch (action) {
        case "snapshot": rpc = "cashier_tablet_snapshot"; break;
        case "logout": rpc = "cashier_logout"; break;
        case "checkout":
          if (!uuid(body.request_id) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100 ||
            !["sale", "receipt", "writeoff"].includes(String(body.kind ?? "sale")) ||
            body.items.some((item) => !item || typeof item !== "object" || !uuid(item.product_id) ||
              !numeric(item.quantity) || item.quantity <= 0 ||
              ((body.kind ?? "sale") === "sale" && (!numeric(item.expected_price) || item.expected_price < 0)))) {
            return json({ error: "Проверьте товары, количество и цены в корзине." }, 400);
          }
          rpc = "cashier_checkout";
          args = { ...args, p_request_id: body.request_id, p_items: body.items, p_kind: body.kind ?? "sale" };
          break;
        case "open_shift":
          if (!numeric(body.opening_cash)) return json({ error: "Введите сумму наличных." }, 400);
          rpc = "cashier_open_shift";
          args.p_opening_cash = body.opening_cash;
          break;
        case "close_shift":
          if (!uuid(body.shift_id) || !numeric(body.closing_cash)) return json({ error: "Проверьте смену и сумму наличных." }, 400);
          rpc = "cashier_close_shift";
          args = { ...args, p_shift_id: body.shift_id, p_closing_cash: body.closing_cash };
          break;
        case "movement":
          if (!uuid(body.product_id) || !numeric(body.quantity) ||
            !["sale", "receipt", "writeoff"].includes(String(body.kind)) ||
            (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 500))) {
            return json({ error: "Проверьте товар, тип операции и количество." }, 400);
          }
          rpc = "cashier_record_movement";
          args = { ...args, p_product_id: body.product_id, p_kind: body.kind,
            p_quantity: body.quantity, p_note: body.note ?? null };
          break;
        default: return json({ error: "Неизвестная операция" }, 400);
      }
      const { data, error } = await ctx.supabaseAdmin.rpc(rpc, args);
      if (error) throw error;
      return json({ data });
    } catch (error) {
      const failure = error as { code?: string; message?: string };
      const status = failure.code === "28000" ? 401 : failure.code === "42501" ? 403
        : failure.code === "23505" ? 409 : ["22023", "22P02"].includes(failure.code ?? "") ? 400 : 500;
      if (status === 500) console.error("Cashier terminal failure:", failure.code, failure.message);
      return json({ error: status === 500 ? "Не удалось выполнить операцию кассира."
        : status === 409 ? "В магазине уже открыта смена. Обновите данные."
        : failure.message ?? "Операция недоступна." }, status);
    }
  }),
};
