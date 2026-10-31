import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./session";

export function LoginRoute({ children }: { children: ReactNode }) {
    const { owner, cashierToken } = useAuth();
    if (owner) return <Navigate to="/" replace />;
    if (cashierToken) return <Navigate to="/cashier" replace />;
    return children;
}

export function CashierRoute({ children }: { children: ReactNode }) {
    const { owner, cashierToken } = useAuth();
    if (owner) return <Navigate to="/" replace />;
    if (!cashierToken) return <Navigate to="/login/cashier" replace />;
    return children;
}
