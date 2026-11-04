import { useEffect, useState, type ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./session";
import { supabase } from "../lib/supabase";
import { ui } from "../lib/ui";
import { AuthLayout } from "../components/AuthLayout";

type OwnerRouteProps = { children: ReactNode };

export function OwnerRoute({ children }: OwnerRouteProps) {
    const { owner, cashierToken } = useAuth();
    const userId = owner?.user.id;
    const [access, setAccess] = useState<{
        userId: string;
        allowed: boolean;
    } | null>(null);
    const [error, setError] = useState("");

    useEffect(() => {
        if (!userId) return;
        let active = true;
        async function checkAccess() {
            let allowed = false;
            try {
                const {
                    data: { user },
                    error: authError,
                } = await supabase.auth.getUser();
                if (!authError && user?.id === userId) {
                    const { data: profile, error: profileError } = await supabase
                        .from("profiles")
                        .select("is_active")
                        .eq("id", userId)
                        .maybeSingle();
                    allowed = !profileError && profile?.is_active === true;
                }
            } catch {
                /* A failed access check must never grant owner access. */
            }
            if (active) setAccess({ userId: userId!, allowed });
        }
        void checkAccess();
        return () => {
            active = false;
        };
    }, [userId]);

    async function logout() {
        setError("");
        try {
            const { error } = await supabase.auth.signOut({ scope: "local" });
            if (error) throw error;
        } catch {
            setError("Не удалось выйти. Проверьте подключение и попробуйте снова.");
        }
    }

    if (!owner) return <Navigate to={cashierToken ? "/cashier" : "/login/owner"} replace />;
    if (!access || access.userId !== userId)
        return (
            <div className="session-loading" role="status">
                <span className="brand-mark" aria-hidden="true" />
                <span>Проверяем доступ…</span>
            </div>
        );
    if (!access.allowed)
        return (
            <AuthLayout
                title="Кабинет владельца недоступен"
                description="Не удалось подтвердить активный профиль владельца. Попробуйте войти снова."
                showRoleLink={false}
            >
                {error && (
                    <p className={ui.error} role="alert">
                        {error}
                    </p>
                )}
                <button className={ui.button} type="button" onClick={() => void logout()}>
                    Выйти из аккаунта
                </button>
            </AuthLayout>
        );
    return children;
}
