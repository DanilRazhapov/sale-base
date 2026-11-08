import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { CashierSessionProvider } from "./auth/CashierSessionProvider";
import { useCashierSession } from "./auth/session";
import { PwaStatus } from "./components/PwaStatus";
import CashierLoginPage from "./pages/CashierLoginPage";
import CashierPage from "./pages/CashierPage";

const ownerOrigin = import.meta.env.VITE_OWNER_APP_URL?.trim();
const ownerAppUrl = ownerOrigin && new URL(ownerOrigin).origin !== window.location.origin ? ownerOrigin : undefined;
const oldOwnerRoutes = ["/login/owner", "/register", "/owner", "/cashier/new", "/store/*"];

function OpenOwnerApp({ origin }: { origin: string }) {
    const { pathname, search } = useLocation();
    const destination = new URL(origin);
    destination.pathname = pathname;
    destination.search = search;
    const href = destination.href;

    useEffect(() => {
        window.location.replace(href);
    }, [href]);

    return <a href={href}>Открыть кабинет владельца</a>;
}

function CashierRoutes() {
    const { cashierSession, loading } = useCashierSession();
    if (loading) {
        return <div className="session-loading" role="status">Загрузка…</div>;
    }

    return (
        <Routes>
            <Route
                path="/login/cashier"
                element={cashierSession
                    ? <Navigate to="/cashier" replace />
                    : <CashierLoginPage ownerAppUrl={ownerAppUrl} />}
            />
            <Route
                path="/cashier"
                element={cashierSession === false ? <Navigate to="/login/cashier" replace /> : <CashierPage />}
            />
            <Route path="*" element={<Navigate to="/login/cashier" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <BrowserRouter>
            <Routes>
                {ownerAppUrl && oldOwnerRoutes.map((path) => (
                    <Route key={path} path={path} element={<OpenOwnerApp origin={ownerAppUrl} />} />
                ))}
                <Route path="*" element={
                    <CashierSessionProvider>
                        <PwaStatus />
                        <CashierRoutes />
                    </CashierSessionProvider>
                } />
            </Routes>
        </BrowserRouter>
    );
}
