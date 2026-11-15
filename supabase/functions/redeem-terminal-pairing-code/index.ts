import { withSupabase } from "@supabase/server";
import { handleRedeemPairingCode } from "./handler.ts";

export default {
  // A valid one-time pairing code authorizes enrollment; no owner login is needed.
  fetch: withSupabase({ auth: "none" }, (request, ctx) =>
    handleRedeemPairingCode(request, Deno.env.get("PAIRING_CODE_SECRET") ?? "", {
      attempt: () => ctx.supabaseAdmin.rpc("terminal_pairing_attempt"),
      redeem: args => ctx.supabaseAdmin.rpc("redeem_terminal_pairing_code", args),
    })),
};
