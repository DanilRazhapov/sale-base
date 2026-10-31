import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthProvider";
import { useAuth } from "./auth/session";
import { OwnerRoute } from "./auth/OwnerRoute";
import { CashierRoute, LoginRoute } from "./auth/SessionRoutes";
import LoginPage from "./pages/auth/LoginPage";
import OwnerLoginPage from "./pages/owner/OwnerLoginPage";
import RegistrationPage from "./pages/owner/RegistrationPage";
import HomePage from "./pages/owner/HomePage";
import OwnerPage from "./pages/owner/OwnerPage";
import CreateStorePage from "./pages/owner/CreateStorePage";
import StorePage from "./pages/owner/StorePage";
import StoreInventoryPage from "./pages/owner/StoreInventoryPage";
import CashierPage from "./pages/cashier/CashierPage";
import CashierLoginPage from "./pages/cashier/CashierLoginPage";

function AppRoutes() {
    const { loading } = useAuth();
    if (loading)
        return (
            <div className="session-loading" role="status">
                Загрузка…
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
                path="/"
                element={
                    <OwnerRoute>
                        <HomePage />
                    </OwnerRoute>
                }
            />
            <Route
                path="/owner"
                element={
                    <OwnerRoute>
                        <OwnerPage />
                    </OwnerRoute>
                }
            />
            <Route
                path="/store/new"
                element={
                    <OwnerRoute>
                        <CreateStorePage />
                    </OwnerRoute>
                }
            />
            <Route
                path="/store/:storeId"
                element={
                    <OwnerRoute>
                        <StorePage />
                    </OwnerRoute>
                }
            />
            <Route
                path="/store/:storeId/inventory"
                element={
                    <OwnerRoute>
                        <StoreInventoryPage />
                    </OwnerRoute>
                }
            />
            <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
    );
}

export default function App() {
    return (
        <AuthProvider>
            <BrowserRouter>
                <AppRoutes />
            </BrowserRouter>
        </AuthProvider>
    );
}
