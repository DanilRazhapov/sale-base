import { useCallback } from "react";
import { useCashierSession } from "../auth/session";
import { CashierWorkspace } from "../components/CashierWorkspace";

export default function CashierPage() {
    const { setCashierSession } = useCashierSession();
    const logout = useCallback(() => setCashierSession(false), [setCashierSession]);
    const restore = useCallback(() => setCashierSession(true), [setCashierSession]);
    return <CashierWorkspace onLogout={logout} onRestore={restore} />;
}
