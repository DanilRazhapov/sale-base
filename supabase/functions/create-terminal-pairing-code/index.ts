import { withSupabase } from "@supabase/server";
import { handleCreatePairingCode } from "./handler.ts";

export default {
  fetch: withSupabase({ auth: "user" }, (request, ctx) =>
    handleCreatePairingCode(
      request,
      ctx.userClaims?.id,
      Deno.env.get("PAIRING_CODE_SECRET") ?? "",
      (args) => ctx.supabaseAdmin.rpc("issue_terminal_pairing_code", args),
    )),
};
