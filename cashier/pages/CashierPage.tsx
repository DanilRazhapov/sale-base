import { useCashierSession } from "../auth/session";
import { CashierWorkspace } from "../components/CashierWorkspace";

export default function CashierPage() {
    const { endSession, offlineSession } = useCashierSession();
    return <CashierWorkspace onLogout={endSession} offlineSession={offlineSession} />;
}
