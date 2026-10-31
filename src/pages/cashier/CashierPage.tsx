import { useCallback } from "react";
import { useAuth } from "../../auth/session";
import { CashierWorkspace } from "../../components/cashier/CashierWorkspace";

export default function CashierPage() {
    const { cashierToken, setCashierToken } = useAuth();
    const logout = useCallback(() => setCashierToken(""), [setCashierToken]);
    return <CashierWorkspace key={cashierToken} token={cashierToken} onLogout={logout} />;
}
