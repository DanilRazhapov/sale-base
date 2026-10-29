import { useState, useEffect } from "react";
import { supabase } from "./lib/supabase";
import type { Session } from "@supabase/supabase-js";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { ProtectedRoute } from "./components/ProtectedRoute";
import RegistrationPage from "./pages/RegistrationPage";
import LogInPage from "./pages/LogInPage";
import HomePage from "./pages/HomePage";
import OwnerPage from "./pages/OwnerPage";
import CreateStorePage from "./pages/CreateStorePage";
import StorePage from "./pages/StorePage";
import CashierPage from "./pages/CashierPage";

const App = () => {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        supabase.auth.getSession().then(({ data }) => {
            setSession(data.session);
            setLoading(false);
        })

        const { data } = supabase.auth.onAuthStateChange((_event, session) => {
            setSession(session);
        });

        return () => data.subscription.unsubscribe();
    }, []);

    if (loading) return <div>Loading...</div>;

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/cashier" element={<CashierPage />} />
                <Route
                    path="/login"
                    element={session ? <Navigate to="/" /> : <LogInPage />}
                />
                <Route
                    path="/register"
                    element={session ? <Navigate to="/" /> : <RegistrationPage />}
                />

                <Route
                    path="/"
                    element={session ? <HomePage /> : <Navigate to="/login" />}
                />

                <Route
                    path="/owner"
                    element={
                        <ProtectedRoute>
                            <OwnerPage />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/store/new"
                    element={
                        <ProtectedRoute>
                            <CreateStorePage />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="/store/:storeId"
                    element={
                        <ProtectedRoute>
                            <StorePage />
                        </ProtectedRoute>
                    }
                />

                <Route
                    path="*"
                    element={<Navigate to="/login" />}
                />
            </Routes>
        </BrowserRouter>
    )
}

export default App;