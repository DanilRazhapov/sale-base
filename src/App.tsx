import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/session";
import { OwnerRoute } from "./auth/OwnerRoute";
import { CashierRoute, LoginRoute } from "./auth/SessionRoutes";
import LoginPage from "./pages/auth/LoginPage";
import OwnerLoginPage from "./pages/owner/OwnerLoginPage";
import RegistrationPage from "./pages/owner/RegistrationPage";
import HomePage from "./pages/owner/HomePage";
import { CreateCashierPage } from "./pages/owner/CreateCashierPage";
import CreateStorePage from "./pages/owner/CreateStorePage";
import StorePage from "./pages/owner/StorePage";
import StoreStockPage from "./pages/owner/StoreStockPage";
import StoreInventoryPage from "./pages/owner/StoreInventoryPage";
import CashierPage from "./pages/cashier/CashierPage";
import CashierLoginPage from "./pages/cashier/CashierLoginPage";
import { PwaStatus } from "./components/PwaStatus";
import { StoreLayout } from "./layouts/StoreLayout";
import { OwnerLayout } from "./layouts/OwnerLayout";

function AppRoutes() {
    const { loading } = useAuth();
    if (loading)
        return (
            <div className="session-loading" role="status">
                <span className="brand-mark" aria-hidden="true" />
                <span>Загрузка…</span>
            </div>
        );
    return (
        <Routes>
            <Route
                path="/login"
                element={
                    <LoginRoute>
                        <LoginPage />
                    </LoginRoute>
                }
            />
            <Route
                path="/login/owner"
                element={
                    <LoginRoute>
                        <OwnerLoginPage />
                    </LoginRoute>
                }
            />
            <Route
                path="/login/cashier"
                element={
                    <LoginRoute>
                        <CashierLoginPage />
                    </LoginRoute>
                }
            />
            <Route
                path="/register"
                element={
                    <LoginRoute>
                        <RegistrationPage />
                    </LoginRoute>
                }
            />
            <Route
                path="/cashier"
                element={
                    <CashierRoute>
                        <CashierPage />
                    </CashierRoute>
                }
            />
            <Route
                element={
                    <OwnerRoute>
                        <OwnerLayout />
                    </OwnerRoute>
                }
            >
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
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <PwaStatus />
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}
