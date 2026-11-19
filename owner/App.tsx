import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { OwnerSessionProvider } from "./auth/OwnerSessionProvider";
import { useOwnerSession } from "./auth/session";
import { OwnerRoute } from "./auth/OwnerRoute";
import { OwnerLayout } from "./layouts/OwnerLayout";
import { StoreLayout } from "./layouts/StoreLayout";
import OwnerLoginPage from "./pages/OwnerLoginPage";
import RegistrationPage from "./pages/RegistrationPage";
import ForgotPasswordPage from "./pages/ForgotPasswordPage";
import HomePage from "./pages/HomePage";
import { CreateCashierPage } from "./pages/CreateCashierPage";
import CreateStorePage from "./pages/CreateStorePage";
import StorePage from "./pages/StorePage";
import StoreStockPage from "./pages/StoreStockPage";
import StoreInventoryPage from "./pages/StoreInventoryPage";

function OwnerRoutes() {
    const { owner, loading } = useOwnerSession();
    const { state } = useLocation();
    if (loading) {
        return <div className="session-loading" role="status">Загрузка…</div>;
    }

    return (
        <Routes>
            <Route path="/login" element={<Navigate to="/login/owner" replace />} />
            <Route
                path="/login/owner"
                element={owner ? <Navigate to={state?.from ?? "/"} replace /> : <OwnerLoginPage />}
            />
            <Route path="/register" element={owner ? <Navigate to="/" replace /> : <RegistrationPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
            <Route element={<OwnerRoute><OwnerLayout /></OwnerRoute>}>
                <Route path="/" element={<HomePage />} />
                <Route path="/owner" element={<Navigate to="/" replace />} />
                <Route path="/cashier/new" element={<CreateCashierPage />} />
                <Route path="/store/new" element={<CreateStorePage />} />
                <Route path="/store/:storeId" element={<StoreLayout />}>
                    <Route index element={<StorePage />} />
                    <Route path="stock" element={<StoreStockPage />} />
                    <Route path="inventory" element={<StoreInventoryPage />} />
                </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <OwnerSessionProvider>
            <BrowserRouter>
                <OwnerRoutes />
            </BrowserRouter>
        </OwnerSessionProvider>
    );
}
